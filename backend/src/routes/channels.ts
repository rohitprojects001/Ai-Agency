import { Router } from "express";
import { z } from "zod";
import { getChannelAvailability } from "../lib/channel-providers";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireActiveSubscription, requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";
import { sendOutboundMessage } from "../services/outbound-messages";
import { getOrganizationRuntime } from "../services/organization-runtime";
import { OrganizationRuntimeError } from "../services/organization-runtime";

export const channelsRouter = Router();
channelsRouter.use(requireAuth);

channelsRouter.get("/status", asyncHandler(async (req, res) => {
  const [profile, runtime] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { organizationId: req.auth!.organizationId } }),
    getOrganizationRuntime(req.auth!.organizationId),
  ]);
  res.json({ channels: getChannelAvailability({
    twilioPhoneNumber: profile?.twilioPhoneNumber ?? null,
    outboundEmail: profile?.outboundEmail ?? null,
    whatsappPhoneNumberId: profile?.whatsappPhoneNumberId ?? null,
  }, runtime.mode), mode: runtime.mode });
}));

const sendSchema = z.object({
  contactId: z.string().min(1),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  content: z.string().trim().min(1).max(4000),
  subject: z.string().max(200).optional(),
});

channelsRouter.post("/send", requireActiveSubscription, requireOrganizationFeature("MESSAGING"), requireRole("OWNER", "ADMIN", "MANAGER", "AGENT"), asyncHandler(async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  try {
    const result = await sendOutboundMessage({ ...parsed.data, organizationId: req.auth!.organizationId });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof OrganizationRuntimeError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(502).json({
      error: error instanceof Error ? error.message : "The provider could not accept this message",
      deliveryStatus: "FAILED",
    });
  }
}));