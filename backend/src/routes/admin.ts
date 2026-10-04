import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { getChannelAvailability } from "../lib/channel-providers";
import { requireAuth, requireSuperAdmin } from "../middleware/requireAuth";
import { parseTrialSettings } from "../services/organization-runtime";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperAdmin);

const confirmationSchema = z.object({ confirmation: z.enum(["SUSPEND", "RESTORE"]) });

const activationSchema = z.object({
  confirmation: z.literal("ACTIVATE"),
  plan: z.enum(["MONTHLY", "SIX_MONTHS", "SEVEN_MONTHS"]),
  paymentReference: z.string().trim().min(1).max(120).optional(),
});
const modeSchema = z.object({
  confirmation: z.enum(["ACTIVATE LIVE", "RETURN TO TRIAL", "SUSPEND", "RESTORE"]),
  mode: z.enum(["TRIAL", "LIVE", "SUSPENDED"]),
});
const integrationSchema = z.object({
  whatsappPhoneNumberId: z.string().trim().max(120).optional().or(z.literal("")),
  twilioPhoneNumber: z.string().trim().max(30).optional().or(z.literal("")),
  outboundEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
});
const trialSettingsSchema = z.object({
  trialDurationDays: z.number().int().min(1).max(365),
  maxWhatsAppDemoMessages: z.number().int().min(0).max(100000),
  maxSmsDemoMessages: z.number().int().min(0).max(100000),
  maxEmailDemoMessages: z.number().int().min(0).max(100000),
  maxVoiceDemoMessages: z.number().int().min(0).max(100000),
  maxUsers: z.number().int().min(1).max(1000),
  enabledFeatures: z.array(z.enum(["CRM", "AI", "AUTOMATIONS", "MESSAGING", "VOICE"])).max(5),
});

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

const subscriptionExtensionSchema = z.object({
  days: z.number().int().min(1).max(3650),
  confirmation: z.enum(["EXTEND"]).optional(),
  paymentReference: z.string().trim().max(120).optional(),
});

const renewalSchema = z.object({
  days: z.number().int().min(1).max(3650).optional(),
  plan: z.enum(["MONTHLY", "SIX_MONTHS", "SEVEN_MONTHS"]).optional(),
  paymentReference: z.string().trim().max(120).optional(),
  confirmation: z.enum(["RENEW"]).optional(),
});

adminRouter.get("/organizations", asyncHandler(async (_req, res) => {
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      mode: true,
      status: true,
      trialStartedAt: true,
      trialEndsAt: true,
      trialSettings: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        orderBy: { startsAt: "desc" },
        take: 1,
        select: { plan: true, status: true, endsAt: true },
      },
      businessProfile: {
        select: { whatsappPhoneNumberId: true, twilioPhoneNumber: true, outboundEmail: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    organizations: organizations.map(({ businessProfile, ...organization }) => ({
      ...organization,
      channels: getChannelAvailability({
        whatsappPhoneNumberId: businessProfile?.whatsappPhoneNumberId ?? null,
        twilioPhoneNumber: businessProfile?.twilioPhoneNumber ?? null,
        outboundEmail: businessProfile?.outboundEmail ?? null,
      }, "LIVE"),
      integrations: {
        whatsappPhoneNumberId: businessProfile?.whatsappPhoneNumberId ?? "",
        twilioPhoneNumber: businessProfile?.twilioPhoneNumber ?? "",
        outboundEmail: businessProfile?.outboundEmail ?? "",
      },
    })),
  });
}));

adminRouter.get("/organizations/:organizationId/subscription", asyncHandler(async (req, res) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });

  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId: organization.id },
    orderBy: { startsAt: "desc" },
  });

  const activeSubscription = subscriptions.find((subscription) => subscription.status === "ACTIVE" && (!subscription.endsAt || subscription.endsAt > new Date()));
  return res.json({ activeSubscription: activeSubscription ?? null, history: subscriptions });
}));

adminRouter.put("/organizations/:organizationId/integrations", asyncHandler(async (req, res) => {
  const parsed = integrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter valid workspace integration settings." });
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, mode: true, status: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  if (organization.mode === "LIVE" && organization.status === "ACTIVE") return res.status(409).json({ error: "Suspend or return the workspace to Trial before editing live integrations." });

  const existing = await prisma.businessProfile.findUnique({ where: { organizationId: organization.id } });
  const businessProfile = existing
    ? await prisma.businessProfile.update({
        where: { organizationId: organization.id },
        data: {
          ...(parsed.data.whatsappPhoneNumberId !== undefined ? { whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId || null } : {}),
          ...(parsed.data.twilioPhoneNumber !== undefined ? { twilioPhoneNumber: parsed.data.twilioPhoneNumber || null } : {}),
          ...(parsed.data.outboundEmail !== undefined ? { outboundEmail: parsed.data.outboundEmail || null } : {}),
        },
      })
    : await prisma.businessProfile.create({
        data: {
          organizationId: organization.id,
          businessName: (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { name: true } })).name,
          whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId || null,
          twilioPhoneNumber: parsed.data.twilioPhoneNumber || null,
          outboundEmail: parsed.data.outboundEmail || null,
        },
      });
  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: req.auth!.userId,
      action: "organization.live_integrations_updated",
      metadata: { changedById: req.auth!.userId, configuredFields: Object.keys(parsed.data) },
    },
  });
  return res.json({
    integrations: {
      whatsappPhoneNumberId: businessProfile.whatsappPhoneNumberId,
      twilioPhoneNumber: businessProfile.twilioPhoneNumber,
      outboundEmail: businessProfile.outboundEmail,
    },
    channels: getChannelAvailability(businessProfile, "LIVE"),
  });
}));

adminRouter.put("/organizations/:organizationId/trial-settings", asyncHandler(async (req, res) => {
  const parsed = trialSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter valid trial limits." });
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, trialStartedAt: true, mode: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  const trialEndsAt = new Date(organization.trialStartedAt);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + parsed.data.trialDurationDays);
  await prisma.organization.update({
    where: { id: organization.id },
    data: { trialSettings: parsed.data, trialEndsAt },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: req.auth!.userId,
      action: "organization.trial_settings_updated",
      metadata: { changedById: req.auth!.userId, settings: parsed.data },
    },
  });
  return res.json({ trialSettings: parsed.data, trialEndsAt });
}));

adminRouter.post("/organizations/:organizationId/mode", asyncHandler(async (req, res) => {
  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid target mode and explicit confirmation." });
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, name: true, mode: true, status: true, trialSettings: true, businessProfile: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });

  const previousMode = organization.status === "SUSPENDED" ? "SUSPENDED" : organization.mode;
  const { mode: targetMode, confirmation } = parsed.data;
  const expectedConfirmation = organization.status === "SUSPENDED" && targetMode !== "SUSPENDED"
    ? "RESTORE"
    : targetMode === "LIVE" ? "ACTIVATE LIVE" : targetMode === "SUSPENDED" ? "SUSPEND" : "RETURN TO TRIAL";
  if (confirmation !== expectedConfirmation) return res.status(400).json({ error: `Type ${expectedConfirmation} to confirm this change.` });
  if (targetMode === "LIVE") {
    const profile = organization.businessProfile ?? { whatsappPhoneNumberId: null, twilioPhoneNumber: null, outboundEmail: null };
    const availability = getChannelAvailability(profile, "LIVE");
    if (!availability.whatsapp && !availability.sms && !availability.voice && !availability.email) {
      return res.status(409).json({ error: "Connect and configure at least one real communication channel before activating Live mode." });
    }
    if (!availability.ai) return res.status(409).json({ error: "Configure the real OpenAI provider in backend environment settings before activating Live mode." });
    const now = new Date();
    const paidSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: organization.id,
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!paidSubscription) return res.status(409).json({ error: "Activate an organization plan before switching it to Live mode." });
  }

  const now = new Date();
  const trialSettings = parseTrialSettings(organization.trialSettings);
  const trialReset = targetMode === "TRIAL"
    ? {
        trialStartedAt: now,
        trialEndsAt: new Date(now.getTime() + trialSettings.trialDurationDays * 24 * 60 * 60 * 1000),
      }
    : {};
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organization.id },
      data: targetMode === "SUSPENDED"
        ? { status: "SUSPENDED" }
        : { status: "ACTIVE", mode: targetMode, ...trialReset },
    });
    if (targetMode === "SUSPENDED") {
      await tx.session.updateMany({
        where: { organizationId: organization.id, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: req.auth!.userId,
        action: "organization.mode_changed",
        metadata: {
          organizationName: organization.name,
          previousMode,
          newMode: targetMode,
          changedById: req.auth!.userId,
          changedAt: now.toISOString(),
        },
      },
    });
  });
  return res.json({
    message: targetMode === "TRIAL"
      ? `Workspace returned to Trial mode; its ${trialSettings.trialDurationDays}-day trial has started.`
      : `Workspace mode changed from ${previousMode} to ${targetMode}.`,
    previousMode,
    mode: targetMode,
  });
}));

adminRouter.post("/organizations/:organizationId/subscription", asyncHandler(async (req, res) => {
  const parsed = activationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a valid plan and confirm activation." });
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, status: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  if (organization.status !== "ACTIVE") return res.status(409).json({ error: "Restore the workspace before activating a plan." });

  const startsAt = new Date();
  const monthCount = { MONTHLY: 1, SIX_MONTHS: 6, SEVEN_MONTHS: 7 }[parsed.data.plan];
  const subscription = await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { organizationId: organization.id, status: "ACTIVE" },
      data: { status: "CANCELED" },
    });
    const activated = await tx.subscription.create({
      data: {
        organizationId: organization.id,
        plan: parsed.data.plan,
        status: "ACTIVE",
        startsAt,
        endsAt: addUtcMonths(startsAt, monthCount),
        activatedById: req.auth!.userId,
        paymentReference: parsed.data.paymentReference,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: req.auth!.userId,
        action: "billing.subscription_activated",
        metadata: { subscriptionId: activated.id, plan: activated.plan },
      },
    });
    return activated;
  });
  return res.status(201).json({ subscription });
}));

adminRouter.post("/organizations/:organizationId/subscription/extend", asyncHandler(async (req, res) => {
  const parsed = subscriptionExtensionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid extension in whole days and confirm with EXTEND." });

  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, status: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  if (organization.status !== "ACTIVE") return res.status(409).json({ error: "Restore the workspace before extending its plan." });

  const now = new Date();
  const existing = await prisma.subscription.findFirst({
    where: { organizationId: organization.id },
    orderBy: { startsAt: "desc" },
    select: { id: true, plan: true, status: true, startsAt: true, endsAt: true, paymentReference: true },
  });

  const anchor = existing?.endsAt && existing.endsAt > now ? new Date(existing.endsAt) : now;
  const startsAt = existing && existing.startsAt <= now && existing.endsAt && existing.endsAt > now ? existing.startsAt : now;
  const endsAt = addDays(anchor, parsed.data.days);
  const updated = await prisma.$transaction(async (tx) => {
    const subscription = existing
      ? await tx.subscription.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            startsAt,
            endsAt,
            paymentReference: parsed.data.paymentReference ?? existing.paymentReference,
            updatedAt: new Date(),
          },
        })
      : await tx.subscription.create({
          data: {
            organizationId: organization.id,
            plan: "MONTHLY",
            status: "ACTIVE",
            startsAt: now,
            endsAt,
            paymentReference: parsed.data.paymentReference,
            activatedById: req.auth!.userId,
          },
        });

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: req.auth!.userId,
        action: "billing.subscription_extended",
        metadata: {
          subscriptionId: subscription.id,
          days: parsed.data.days,
          previousEndsAt: existing?.endsAt?.toISOString() ?? null,
          nextEndsAt: endsAt.toISOString(),
          renewedFrom: anchor.toISOString(),
        },
      },
    });
    return subscription;
  });

  return res.status(200).json({ subscription: updated, message: `Subscription extended by ${parsed.data.days} days.` });
}));

adminRouter.post("/organizations/:organizationId/subscription/renew", asyncHandler(async (req, res) => {
  const parsed = renewalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a valid renewal plan and confirm." });

  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, status: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  if (organization.status !== "ACTIVE") return res.status(409).json({ error: "Restore the workspace before renewing the plan." });

  const startsAt = new Date();
  const durationDays = parsed.data.days ?? ({ MONTHLY: 30, SIX_MONTHS: 180, SEVEN_MONTHS: 210 }[parsed.data.plan ?? "MONTHLY"] ?? 30);
  const renewalPlan = parsed.data.plan ?? "MONTHLY";

  const subscription = await prisma.$transaction(async (tx) => {
    const current = await tx.subscription.findFirst({
      where: { organizationId: organization.id },
      orderBy: { startsAt: "desc" },
    });
    if (current?.status === "ACTIVE") {
      await tx.subscription.update({
        where: { id: current.id },
        data: {
          status: "CANCELED",
          updatedAt: new Date(),
        },
      });
    }

    const renewed = await tx.subscription.create({
      data: {
        organizationId: organization.id,
        plan: renewalPlan,
        status: "ACTIVE",
        startsAt,
        endsAt: addDays(startsAt, durationDays),
        activatedById: req.auth!.userId,
        paymentReference: parsed.data.paymentReference,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: req.auth!.userId,
        action: "billing.subscription_renewed",
        metadata: { subscriptionId: renewed.id, plan: renewed.plan, days: durationDays },
      },
    });

    return renewed;
  });

  return res.status(201).json({ subscription, message: `Subscription renewed for ${durationDays} days.` });
}));

adminRouter.post("/organizations/:organizationId/subscription/disable", asyncHandler(async (req, res) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });

  const subscription = await prisma.subscription.findFirst({
    where: { organizationId: organization.id },
    orderBy: { startsAt: "desc" },
  });
  if (!subscription) return res.status(404).json({ error: "No active subscription was found." });

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CANCELED",
      endsAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return res.json({ subscription: updated, message: "Workshop access disabled." });
}));

adminRouter.post("/organizations/:organizationId/subscription/enable", asyncHandler(async (req, res) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });

  const existing = await prisma.subscription.findFirst({
    where: { organizationId: organization.id },
    orderBy: { startsAt: "desc" },
  });
  if (!existing) return res.status(404).json({ error: "No subscription record exists to enable." });

  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: "ACTIVE",
      startsAt: existing.startsAt > now ? now : existing.startsAt,
      endsAt: existing.endsAt && existing.endsAt > now ? existing.endsAt : addDays(now, 30),
      updatedAt: now,
    },
  });
  return res.json({ subscription: updated, message: "Workshop access enabled." });
}));

adminRouter.post("/users/:userId/suspend", asyncHandler(async (req, res) => {
  const parsed = confirmationSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmation !== "SUSPEND") {
    return res.status(400).json({ error: "Explicit SUSPEND confirmation is required." });
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "User not found." });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const memberships = await tx.organizationMember.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    await tx.auditLog.createMany({
      data: memberships.map(({ organizationId }) => ({
        organizationId,
        userId: req.auth!.userId,
        action: "security.account_suspended",
        metadata: { targetUserId: user.id },
      })),
    });
  });
  return res.json({ message: "Account suspended and active sessions revoked." });
}));

adminRouter.post("/users/:userId/restore", asyncHandler(async (req, res) => {
  const parsed = confirmationSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmation !== "RESTORE") {
    return res.status(400).json({ error: "Explicit RESTORE confirmation is required." });
  }
  const result = await prisma.user.updateMany({ where: { id: req.params.userId }, data: { status: "ACTIVE" } });
  if (result.count === 0) return res.status(404).json({ error: "User not found." });
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.params.userId },
    select: { organizationId: true },
  });
  await prisma.auditLog.createMany({
    data: memberships.map(({ organizationId }) => ({
      organizationId,
      userId: req.auth!.userId,
      action: "security.account_restored",
      metadata: { targetUserId: req.params.userId },
    })),
  });
  return res.json({ message: "Account restored. The user must sign in again." });
}));

adminRouter.post("/organizations/:organizationId/suspend", asyncHandler(async (req, res) => {
  const parsed = confirmationSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmation !== "SUSPEND") {
    return res.status(400).json({ error: "Explicit SUSPEND confirmation is required." });
  }
  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.updateMany({
      where: { id: req.params.organizationId },
      data: { status: "SUSPENDED" },
    });
    if (organization.count === 0) return false;
    const currentOrganization = await tx.organization.findUniqueOrThrow({
      where: { id: req.params.organizationId },
      select: { name: true, mode: true },
    });
    await tx.session.updateMany({
      where: { organizationId: req.params.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.params.organizationId,
        userId: req.auth!.userId,
        action: "security.organization_suspended",
        metadata: {
          organizationName: currentOrganization.name,
          previousMode: currentOrganization.mode,
          newMode: "SUSPENDED",
          changedById: req.auth!.userId,
          changedAt: new Date().toISOString(),
        },
      },
    });
    return true;
  });
  if (!result) return res.status(404).json({ error: "Workspace not found." });
  return res.json({ message: "Workspace suspended and its sessions revoked." });
}));

adminRouter.post("/organizations/:organizationId/restore", asyncHandler(async (req, res) => {
  const parsed = confirmationSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmation !== "RESTORE") {
    return res.status(400).json({ error: "Explicit RESTORE confirmation is required." });
  }
  const organization = await prisma.organization.findUnique({
    where: { id: req.params.organizationId },
    select: { id: true, name: true, mode: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  await prisma.organization.update({ where: { id: organization.id }, data: { status: "ACTIVE" } });
  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: req.auth!.userId,
      action: "security.organization_restored",
      metadata: {
        organizationName: organization.name,
        previousMode: "SUSPENDED",
        newMode: organization.mode,
        changedById: req.auth!.userId,
        changedAt: new Date().toISOString(),
      },
    },
  });
  return res.json({ message: "Workspace restored. Users must sign in again." });
}));
