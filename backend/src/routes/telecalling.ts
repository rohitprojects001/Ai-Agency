import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireActiveSubscription, requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";
import { startVoiceCall } from "../lib/channel-providers";
import { enforceTrialMessageLimit, getOrganizationRuntime, OrganizationRuntimeError } from "../services/organization-runtime";

export const telecallingRouter = Router();
telecallingRouter.use(requireAuth);

const callSchema = z.object({
  contactId: z.string().min(1),
  to: z.string().trim().min(7).max(25).optional(),
  agentId: z.string().optional(),
});

telecallingRouter.post("/calls", requireActiveSubscription, requireOrganizationFeature("VOICE"), requireRole("OWNER", "ADMIN", "MANAGER"), asyncHandler(async (req, res) => {
  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

  const organizationId = req.auth!.organizationId;
  const runtime = await getOrganizationRuntime(organizationId);
  if (runtime.status !== "ACTIVE") return res.status(403).json({ error: "This workspace is suspended." });
  await enforceTrialMessageLimit(runtime, "VOICE");
  const contact = await prisma.contact.findFirst({ where: { id: parsed.data.contactId, organizationId } });
  if (!contact) return res.status(404).json({ error: "Contact not found" });
  const to = parsed.data.to || contact.phone;
  if (!to) return res.status(400).json({ error: "The contact needs a phone number before you can call" });

  const agent = parsed.data.agentId
    ? await prisma.agent.findFirst({ where: { id: parsed.data.agentId, organizationId, isActive: true } })
    : await prisma.agent.findFirst({ where: { organizationId, isDefault: true, isActive: true } });
  if (parsed.data.agentId && !agent) return res.status(404).json({ error: "Agent not found or inactive" });

  const profile = await prisma.businessProfile.findUnique({ where: { organizationId } });
  if (!profile) return res.status(400).json({ error: "Set up the business profile before calling" });
  const conversation = await prisma.conversation.create({
    data: { organizationId, contactId: contact.id, channel: "VOICE", status: "OPEN", agentId: agent?.id },
  });

  try {
    const call = await startVoiceCall({ mode: runtime.mode, profile, to, organizationId, contactId: contact.id, conversationId: conversation.id, agentId: agent?.id });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "AI",
        content: call.isDemo ? `Demo voice call simulated to ${to}` : `Outbound AI call initiated to ${to}`,
        isDemo: call.isDemo,
        deliveryStatus: call.isDemo ? "SIMULATED" : "CALLING",
        providerMessageId: call.callId,
      },
    });
    res.status(201).json({ callSid: call.callId, demo: call.isDemo, conversationId: conversation.id, message });
  } catch (error) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "AI",
        content: `Outbound AI call could not be initiated to ${to}`,
        isDemo: false,
        deliveryStatus: "FAILED",
      },
    });
    if (error instanceof OrganizationRuntimeError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(503).json({ error: error instanceof Error ? error.message : "Voice call could not be started" });
  }
}));