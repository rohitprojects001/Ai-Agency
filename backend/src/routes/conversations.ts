import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";
import { sendOutboundMessage } from "../services/outbound-messages";
import { handleIncomingMessage } from "../services/orchestrator";
import { getOrganizationRuntime } from "../services/organization-runtime";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);
conversationsRouter.use(requireOrganizationFeature("CRM"));

// GET /api/conversations - list, newest activity first, for the inbox/simulator sidebar
conversationsRouter.get("/", asyncHandler(async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ conversations });
}));

// GET /api/conversations/:id - full message history for one conversation
conversationsRouter.get("/:id", asyncHandler(async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  res.json({ conversation });
}));

const replySchema = z.object({ content: z.string().min(1) });

// POST /api/conversations/:id/reply - a human team member replies directly,
// bypassing the AI. Used from the Inbox once someone takes a conversation
// over (e.g. after it was escalated).
conversationsRouter.post("/:id/reply", requireRole("OWNER", "ADMIN", "MANAGER", "AGENT"), asyncHandler(async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });

  if (["WHATSAPP", "SMS", "EMAIL"].includes(conversation.channel)) {
    await sendOutboundMessage({
      organizationId: req.auth!.organizationId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      channel: conversation.channel as "WHATSAPP" | "SMS" | "EMAIL",
      content: parsed.data.content,
      sender: "HUMAN",
    });
  } else {
    await prisma.message.create({
      data: { conversationId: conversation.id, sender: "HUMAN", content: parsed.data.content, isDemo: true },
    });
  }

  const updated = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
  });

  res.status(201).json({ conversation: updated });
}));

const statusSchema = z.object({ status: z.enum(["OPEN", "ESCALATED", "CLOSED"]) });

// PATCH /api/conversations/:id/status - manual takeover / resolve / reopen
conversationsRouter.patch("/:id/status", requireRole("OWNER", "ADMIN", "MANAGER"), asyncHandler(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: parsed.data.status },
    include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
  });

  res.json({ conversation: updated });
}));

const simulateSchema = z.object({
  contactName: z.string().min(1),
  contactPhone: z.string().min(1),
  message: z.string().min(1),
  agentId: z.string().optional(),
});

// POST /api/conversations/whatsapp/simulate
// Acts as a stand-in for a real WhatsApp webhook: "pretend this customer
// just messaged your WhatsApp number." Runs the same orchestrator that a
// real webhook will call once WhatsApp Business API is connected - only
// the source of the message changes, not the AI logic.
conversationsRouter.post("/whatsapp/simulate", requireOrganizationFeature("AI"), requireRole("OWNER", "ADMIN", "MANAGER"), asyncHandler(async (req, res) => {
  const runtime = await getOrganizationRuntime(req.auth!.organizationId);
  if (runtime.mode !== "TRIAL") return res.status(409).json({ error: "The WhatsApp simulator is available only in Trial mode." });
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const result = await handleIncomingMessage({
    organizationId: req.auth!.organizationId,
    channel: "WHATSAPP",
    contact: { name: parsed.data.contactName, phone: parsed.data.contactPhone },
    messageText: parsed.data.message,
    agentId: parsed.data.agentId,
  });

  res.status(201).json(result);
}));
