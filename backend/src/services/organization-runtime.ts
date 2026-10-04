import { OrganizationMode, OrganizationStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type TrialSettings = {
  trialDurationDays: number;
  maxWhatsAppDemoMessages: number;
  maxSmsDemoMessages: number;
  maxEmailDemoMessages: number;
  maxVoiceDemoMessages: number;
  maxUsers: number;
  enabledFeatures: string[];
};

export const DEFAULT_TRIAL_SETTINGS: TrialSettings = {
  trialDurationDays: 14,
  maxWhatsAppDemoMessages: 100,
  maxSmsDemoMessages: 100,
  maxEmailDemoMessages: 50,
  maxVoiceDemoMessages: 30,
  maxUsers: 3,
  enabledFeatures: ["CRM", "AI", "AUTOMATIONS", "MESSAGING", "VOICE"],
};

export type OrganizationRuntime = {
  id: string;
  mode: OrganizationMode;
  status: OrganizationStatus;
  trialStartedAt: Date;
  trialEndsAt: Date | null;
  trialSettings: TrialSettings;
};

export class OrganizationRuntimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "OrganizationRuntimeError";
  }
}

export function parseTrialSettings(value: Prisma.JsonValue | null): TrialSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_TRIAL_SETTINGS;
  const settings = value as Record<string, unknown>;
  return {
    trialDurationDays: typeof settings.trialDurationDays === "number" ? settings.trialDurationDays : DEFAULT_TRIAL_SETTINGS.trialDurationDays,
    maxWhatsAppDemoMessages: typeof settings.maxWhatsAppDemoMessages === "number" ? settings.maxWhatsAppDemoMessages : DEFAULT_TRIAL_SETTINGS.maxWhatsAppDemoMessages,
    maxSmsDemoMessages: typeof settings.maxSmsDemoMessages === "number" ? settings.maxSmsDemoMessages : DEFAULT_TRIAL_SETTINGS.maxSmsDemoMessages,
    maxEmailDemoMessages: typeof settings.maxEmailDemoMessages === "number" ? settings.maxEmailDemoMessages : DEFAULT_TRIAL_SETTINGS.maxEmailDemoMessages,
    maxVoiceDemoMessages: typeof settings.maxVoiceDemoMessages === "number" ? settings.maxVoiceDemoMessages : DEFAULT_TRIAL_SETTINGS.maxVoiceDemoMessages,
    maxUsers: typeof settings.maxUsers === "number" ? settings.maxUsers : DEFAULT_TRIAL_SETTINGS.maxUsers,
    enabledFeatures: Array.isArray(settings.enabledFeatures) && settings.enabledFeatures.every((item) => typeof item === "string")
      ? settings.enabledFeatures
      : DEFAULT_TRIAL_SETTINGS.enabledFeatures,
  };
}

export async function getOrganizationRuntime(organizationId: string): Promise<OrganizationRuntime> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, mode: true, status: true, trialStartedAt: true, trialEndsAt: true, trialSettings: true },
  });
  if (!organization) throw new Error("Workspace not found");
  return { ...organization, trialSettings: parseTrialSettings(organization.trialSettings) };
}

export function defaultTrialPeriod(now = new Date()) {
  const trialEndsAt = new Date(now);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + DEFAULT_TRIAL_SETTINGS.trialDurationDays);
  return {
    mode: OrganizationMode.TRIAL,
    trialStartedAt: now,
    trialEndsAt,
    trialSettings: DEFAULT_TRIAL_SETTINGS as Prisma.InputJsonValue,
  };
}

export async function hasActiveSubscription(runtime: OrganizationRuntime): Promise<boolean> {
  if (runtime.mode === "TRIAL") return true;
  const now = new Date();
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId: runtime.id,
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { id: true },
  });
  return Boolean(subscription);
}

export async function enforceTrialMessageLimit(runtime: OrganizationRuntime, channel: "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "WEBSITE" | "INSTAGRAM") {
  if (runtime.status !== "ACTIVE") throw new OrganizationRuntimeError("This workspace is suspended.", 403, "WORKSPACE_SUSPENDED");
  if (runtime.mode === "LIVE" && !(await hasActiveSubscription(runtime))) {
    throw new OrganizationRuntimeError("An active workspace plan is required for live communication.", 402, "SUBSCRIPTION_REQUIRED");
  }
  if (runtime.mode === "LIVE") return;
  if (runtime.trialEndsAt && runtime.trialEndsAt <= new Date()) {
    throw new OrganizationRuntimeError("This workspace trial has ended. Contact support to activate Live mode.", 402, "TRIAL_EXPIRED");
  }
  if (!runtime.trialSettings.enabledFeatures.includes("MESSAGING") && channel !== "VOICE") {
    throw new OrganizationRuntimeError("Messaging is not enabled for this trial workspace.", 403, "FEATURE_NOT_ENABLED");
  }
  if (!runtime.trialSettings.enabledFeatures.includes("VOICE") && channel === "VOICE") {
    throw new OrganizationRuntimeError("Voice is not enabled for this trial workspace.", 403, "FEATURE_NOT_ENABLED");
  }
  const limit = channel === "VOICE"
    ? runtime.trialSettings.maxVoiceDemoMessages
    : channel === "SMS"
      ? runtime.trialSettings.maxSmsDemoMessages
      : channel === "EMAIL"
        ? runtime.trialSettings.maxEmailDemoMessages
        : runtime.trialSettings.maxWhatsAppDemoMessages;
  const used = await prisma.message.count({
    where: {
      isDemo: true,
      conversation: { organizationId: runtime.id, channel },
    },
  });
  if (used >= limit) {
    throw new OrganizationRuntimeError(`The trial ${channel.toLowerCase()} demo limit has been reached.`, 429, "TRIAL_LIMIT_REACHED");
  }
}
