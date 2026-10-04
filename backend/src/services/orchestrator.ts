import { ChannelType, Message } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { runChatTurn, ChatMessage, ChatTool, ToolCall } from "../lib/openai";
import { runAutomationEvent } from "./automation-engine";
import { enforceTrialMessageLimit, getOrganizationRuntime } from "./organization-runtime";

interface IncomingMessageInput {
  organizationId: string;
  channel: ChannelType;
  contact: { name: string; phone?: string; email?: string };
  messageText: string;
  agentId?: string;
  // false for a real message from a connected provider (e.g. real WhatsApp
  // webhook); true for the in-app simulator. Defaults to true so nothing
  // is accidentally mislabeled as real.
  isDemo?: boolean;
}

// ---------------------------------------------------------------------------
// TOOLS
// The AI can only do what's listed here - nothing more. Each tool touches
// the real database, so if the AI "books an appointment" it's a real row,
// not a claim. If a tool fails, the AI is told it failed and must say so
// honestly (see the system prompt below) rather than pretending it worked.
// ---------------------------------------------------------------------------

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check whether a given date/time slot is free for a booking.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time in 24-hour HH:MM format" },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Book an appointment for the customer. Only call this after confirming availability and getting the customer's clear agreement.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time in 24-hour HH:MM format" },
          service: { type: "string", description: "The service being booked" },
        },
        required: ["date", "time", "service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_or_update_lead",
      description:
        "Record this conversation as a sales lead once the customer shows real interest (asked about pricing, availability, or wants to book).",
      parameters: {
        type: "object",
        properties: {
          notes: { type: "string", description: "Short note on what the customer wants" },
        },
        required: ["notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Hand this conversation off to a human team member. Use this when the customer explicitly asks for a human, raises a complaint, disputes a payment, or asks something outside what you know.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Short reason for the handoff" },
        },
        required: ["reason"],
      },
    },
  },
];

function slotToDate(date: string, time: string): Date | null {
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { organizationId: string; contactId: string; conversationId: string }
): Promise<Record<string, unknown>> {
  if (name === "check_availability") {
    const scheduledAt = slotToDate(String(args.date), String(args.time));
    if (!scheduledAt) return { error: "Invalid date/time format" };

    const clash = await prisma.appointment.findFirst({
      where: { organizationId: ctx.organizationId, scheduledAt, status: "SCHEDULED" },
    });
    return { available: !clash };
  }

  if (name === "book_appointment") {
    const scheduledAt = slotToDate(String(args.date), String(args.time));
    if (!scheduledAt) return { success: false, reason: "Invalid date/time format" };

    const clash = await prisma.appointment.findFirst({
      where: { organizationId: ctx.organizationId, scheduledAt, status: "SCHEDULED" },
    });
    if (clash) return { success: false, reason: "That slot is already booked" };

    const appointment = await prisma.appointment.create({
      data: {
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        service: String(args.service),
        scheduledAt,
      },
    });
    const bookedContact = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: ctx.organizationId } });
    await runAutomationEvent({
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      trigger: "APPOINTMENT_BOOKED",
      payload: {
        appointment: { id: appointment.id, service: appointment.service, scheduledAt: appointment.scheduledAt.toISOString() },
        contact: bookedContact ? { name: bookedContact.name, phone: bookedContact.phone, email: bookedContact.email, company: bookedContact.company } : {},
      },
    });
    return { success: true, appointmentId: appointment.id, scheduledAt: appointment.scheduledAt };
  }

  if (name === "create_or_update_lead") {
    const existing = await prisma.lead.findFirst({
      where: { organizationId: ctx.organizationId, contactId: ctx.contactId },
    });
    let leadId: string;
    let isNew: boolean;
    let status: string;
    if (existing) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: { status: existing.status === "NEW" ? "CONTACTED" : existing.status },
      });
      leadId = updated.id;
      isNew = false;
      status = updated.status;
    } else {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ctx.organizationId,
          contactId: ctx.contactId,
          status: "CONTACTED",
          source: "whatsapp",
          score: 40,
          scoreReasons: [{ label: "Engaged in conversation", points: 40 }],
        },
      });
      leadId = lead.id;
      isNew = true;
      status = lead.status;
    }
    if (isNew) {
      const leadContact = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: ctx.organizationId } });
      await runAutomationEvent({
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        trigger: "LEAD_CREATED",
        payload: {
          lead: { id: leadId, status, isNew },
          contact: leadContact ? { name: leadContact.name, phone: leadContact.phone, email: leadContact.email, company: leadContact.company } : {},
        },
      });
    }
    return { success: true, leadId, status, isNew };
  }

  if (name === "escalate_to_human") {
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { status: "ESCALATED" },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        action: "conversation.escalated",
        metadata: { conversationId: ctx.conversationId, reason: String(args.reason ?? "") },
      },
    });
    return { success: true, escalated: true };
  }

  return { error: `Unknown tool: ${name}` };
}

function buildSystemPrompt(
  businessName: string,
  aiInstructions: string | null,
  products: { name: string; price: number; description: string | null; durationMin: number | null }[],
  agentInstructions?: string | null
): string {
  const today = new Date().toISOString().slice(0, 10);

  const catalog =
    products.length > 0
      ? `Products/services catalog (authoritative prices - always use these, never round or estimate):\n` +
        products
          .map(
            (p) =>
              `- ${p.name}: ₹${p.price}${p.durationMin ? ` (${p.durationMin} min)` : ""}${
                p.description ? ` — ${p.description}` : ""
              }`
          )
          .join("\n")
      : null;

  const knowledge = [catalog, aiInstructions].filter(Boolean).join("\n\n");

  return [
    `You are the AI customer-communication employee for "${businessName}". Today's date is ${today}.`,
    `Speak naturally and briefly, like a helpful staff member replying on WhatsApp - not like a chatbot.`,
    knowledge
      ? `Here is what you know about this business. Only use this information - never invent prices or facts that aren't here:\n${knowledge}`
      : `No business information has been configured yet. If asked something specific (prices, availability), say you don't have that information yet and a team member will follow up.`,
    agentInstructions ? `Agent instructions:\n${agentInstructions}` : null,
    `You have tools to check availability, book appointments, and log leads. Use check_availability before book_appointment. Only call book_appointment after the customer clearly agrees to a specific slot. If a tool returns success: false, tell the customer honestly what went wrong - never claim a booking succeeded when it didn't.`,
    `Call create_or_update_lead once the customer shows real buying interest (asked pricing, availability, or wants to book).`,
    `Call escalate_to_human if the customer explicitly asks for a person, has a complaint, a payment dispute, or asks something you genuinely can't help with. After escalating, tell them a team member will take over shortly - don't keep trying to solve it yourself.`,
  ].filter(Boolean).join("\n\n");
}

export async function handleIncomingMessage(input: IncomingMessageInput) {
  const { organizationId, channel, contact, messageText } = input;
  const runtime = await getOrganizationRuntime(organizationId);
  if (runtime.status !== "ACTIVE") throw new Error("This workspace is suspended.");
  await enforceTrialMessageLimit(runtime, channel);
  const isDemo = runtime.mode === "TRIAL" || input.isDemo !== false;

  // 1. Find or create the contact for this business.
  let dbContact = contact.phone
    ? await prisma.contact.findFirst({ where: { organizationId, phone: contact.phone } })
    : null;

  if (!dbContact) {
    dbContact = await prisma.contact.create({
      data: { organizationId, name: contact.name, phone: contact.phone, email: contact.email },
    });
  }

  // 2. Find an active (not closed) conversation on this channel, or start one.
  let conversation = await prisma.conversation.findFirst({
    where: {
      organizationId,
      contactId: dbContact.id,
      channel,
      status: { in: ["OPEN", "ESCALATED"] },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { organizationId, contactId: dbContact.id, channel, status: "OPEN" },
      include: { messages: true },
    });
  }

  const agent = input.agentId
    ? await prisma.agent.findFirst({ where: { id: input.agentId, organizationId, isActive: true } })
    : conversation.agentId
      ? await prisma.agent.findFirst({ where: { id: conversation.agentId, organizationId, isActive: true } })
      : await prisma.agent.findFirst({ where: { organizationId, isActive: true, isDefault: true } });
  if (input.agentId && !agent) throw new Error("Selected agent is not active in this workspace");
  if (agent && conversation.agentId !== agent.id) {
    conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: { agentId: agent.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  }

  // 3. Store the incoming customer message.
  await prisma.message.create({
    data: { conversationId: conversation.id, sender: "CUSTOMER", content: messageText, isDemo },
  });

  await runAutomationEvent({
    organizationId,
    contactId: dbContact.id,
    trigger: "MESSAGE_RECEIVED",
    payload: {
      message: { text: messageText, channel },
      contact: { name: dbContact.name, phone: dbContact.phone, email: dbContact.email, company: dbContact.company },
    },
  });

  // If a human already took this conversation over, the AI stays quiet -
  // that's the entire point of escalation. Just record the message and stop.
  if (conversation.status === "ESCALATED") {
    const fullConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { messages: { orderBy: { createdAt: "asc" } }, contact: true },
    });
    return { conversation: fullConversation, aiMessage: null };
  }

  // 4. Build the conversation history for the model.
  const businessProfile = await prisma.businessProfile.findUnique({ where: { organizationId } });
  const businessName = businessProfile?.businessName ?? "the business";
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    select: { name: true, price: true, description: true, durationMin: true },
  });

  const history: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(businessName, businessProfile?.aiInstructions ?? null, products, agent?.instructions),
    },
    ...conversation.messages.map((m: Message) => ({
      role: (m.sender === "CUSTOMER" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: messageText },
  ];

  // 5. Run the tool-calling loop: the AI can call tools, see results, and
  // call more tools, up to a few rounds, before giving its final reply.
  let aiReplyText =
    "Sorry, I'm having trouble responding right now. A team member will follow up with you shortly.";
  try {
    for (let round = 0; round < 4; round++) {
      const { content, toolCalls } = await runChatTurn(history, TOOLS, runtime.mode);

      if (!toolCalls) {
        aiReplyText = content ?? aiReplyText;
        break;
      }

      // Record the assistant's tool-call turn, then execute each tool and
      // feed the real result back in before asking the model to continue.
      history.push({ role: "assistant", content, tool_calls: toolCalls });

      for (const call of toolCalls as ToolCall[]) {
        if (call.type !== "function") continue;
        const args = JSON.parse(call.function.arguments || "{}");
        const result = await executeTool(call.function.name, args, {
          organizationId,
          contactId: dbContact.id,
          conversationId: conversation.id,
        });
        history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  } catch (error) {
    if (runtime.mode === "LIVE") {
      console.error("Live AI provider failed:", error);
      throw new Error("The configured Live AI provider failed. No AI reply was sent.");
    }
    console.error("Trial AI simulation failed:", error);
  }

  // 6. Store the AI's reply.
  const aiMessage = await prisma.message.create({
    data: { conversationId: conversation.id, sender: "AI", content: aiReplyText, isDemo },
  });

  const fullConversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, contact: true },
  });

  return { conversation: fullConversation, aiMessage };
}
