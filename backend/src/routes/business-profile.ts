import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";
import { isWhatsAppConfigured } from "../lib/whatsapp";
import { getOrganizationRuntime } from "../services/organization-runtime";

export const businessProfileRouter = Router();
businessProfileRouter.use(requireAuth);
businessProfileRouter.use(requireOrganizationFeature("CRM"));

// GET /api/business-profile - creates an empty one on first visit so the
// Settings page always has something to render/edit.
businessProfileRouter.get("/", asyncHandler(async (req, res) => {
  const organizationId = req.auth!.organizationId;

  let profile = await prisma.businessProfile.findUnique({ where: { organizationId } });

  if (!profile) {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    profile = await prisma.businessProfile.create({
      data: { organizationId, businessName: org.name },
    });
  }

  res.json({ profile });
}));

// GET /api/business-profile/whatsapp-status - is real WhatsApp wired up?
// Checked in two parts: server has credentials (.env), AND this org has
// linked its number (Settings). Both must be true for real messages to flow.
businessProfileRouter.get("/whatsapp-status", asyncHandler(async (req, res) => {
  const [profile, runtime] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { organizationId: req.auth!.organizationId } }),
    getOrganizationRuntime(req.auth!.organizationId),
  ]);

  res.json({
    mode: runtime.mode,
    serverConfigured: runtime.mode === "LIVE" && Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    numberLinked: runtime.mode === "LIVE" && Boolean(profile?.whatsappPhoneNumberId),
    connected: runtime.mode === "LIVE" && isWhatsAppConfigured(profile?.whatsappPhoneNumberId),
  });
}));

const updateSchema = z.object({
  businessName: z.string().min(1).optional(),
  category: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  timezone: z.string().optional(),
  aiInstructions: z.string().optional(),
});

// PUT /api/business-profile - partial update, used by the Settings page.
businessProfileRouter.put("/", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const organizationId = req.auth!.organizationId;

  // Make sure a profile row exists before updating it (same as GET above).
  const existing = await prisma.businessProfile.findUnique({ where: { organizationId } });
  if (!existing) {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    await prisma.businessProfile.create({ data: { organizationId, businessName: org.name } });
  }

  const profile = await prisma.businessProfile.update({
    where: { organizationId },
    data: parsed.data,
  });

  await prisma.auditLog.create({
    data: {
      organizationId,
      userId: req.auth!.userId,
      action: "business_profile.updated",
    },
  });

  res.json({ profile });
}));
