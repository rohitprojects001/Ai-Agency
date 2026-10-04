import { ChannelType, SenderType } from "@prisma/client";
import { deliverMessage, type OutboundChannel } from "../lib/channel-providers";
import { prisma } from "../lib/prisma";
import { enforceTrialMessageLimit, getOrganizationRuntime } from "./organization-runtime";

export async function sendOutboundMessage(input: {
  organizationId: string;
  contactId: string;
  channel: OutboundChannel;
  content: string;
  subject?: string;
  sender?: SenderType;
  conversationId?: string;
  existingMessageId?: string;
}) {
  const runtime = await getOrganizationRuntime(input.organizationId);
  if (runtime.status !== "ACTIVE") throw new Error("This workspace is suspended.");
  await enforceTrialMessageLimit(runtime, input.channel);

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
  });
  if (!contact) throw new Error("Contact not found in this workspace");

  const recipient = input.channel === "EMAIL" ? contact.email : contact.phone;
  if (!recipient) throw new Error(input.channel === "EMAIL" ? "Contact has no email address" : "Contact has no phone number");

  const profile = await prisma.businessProfile.findUnique({ where: { organizationId: input.organizationId } });
  const conversation = input.conversationId
    ? await prisma.conversation.findFirst({ where: { id: input.conversationId, organizationId: input.organizationId, contactId: contact.id, channel: input.channel as ChannelType } })
    : await prisma.conversation.findFirst({
        where: {
          organizationId: input.organizationId,
          contactId: contact.id,
          channel: input.channel as ChannelType,
          status: { in: ["OPEN", "ESCALATED"] },
        },
        orderBy: { updatedAt: "desc" },
      }) ?? await prisma.conversation.create({
        data: {
          organizationId: input.organizationId,
          contactId: contact.id,
          channel: input.channel as ChannelType,
          status: "OPEN",
        },
      });
  if (!conversation) throw new Error("Conversation not found in this workspace");

  const content = input.channel === "EMAIL" && input.subject
    ? `Subject: ${input.subject}\n\n${input.content}`
    : input.content;
  const message = input.existingMessageId
    ? await prisma.message.findFirst({ where: { id: input.existingMessageId, conversationId: conversation.id } })
    : await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: input.sender ?? "HUMAN",
          content,
          isDemo: runtime.mode === "TRIAL",
          deliveryStatus: "PENDING",
        },
      });
  if (!message) throw new Error("Message not found in this conversation");
  if (input.existingMessageId) {
    await prisma.message.update({ where: { id: message.id }, data: { deliveryStatus: "PENDING" } });
  }

  try {
    const delivery = await deliverMessage({
      mode: runtime.mode,
      channel: input.channel,
      profile: {
        twilioPhoneNumber: profile?.twilioPhoneNumber ?? null,
        outboundEmail: profile?.outboundEmail ?? null,
        whatsappPhoneNumberId: profile?.whatsappPhoneNumberId ?? null,
      },
      to: recipient,
      content: input.content,
      subject: input.subject,
    });
    const sentMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: delivery.isDemo ? "SIMULATED" : "SENT",
        providerMessageId: delivery.providerMessageId,
        isDemo: delivery.isDemo,
      },
    });
    return { conversationId: conversation.id, message: sentMessage };
  } catch (error) {
    await prisma.message.update({ where: { id: message.id }, data: { deliveryStatus: "FAILED" } });
    throw error;
  }
}