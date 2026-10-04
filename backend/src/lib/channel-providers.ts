import { Resend } from "resend";
import Twilio from "twilio";
import { randomUUID } from "node:crypto";
import type { OrganizationMode } from "@prisma/client";
import type { BusinessProfile } from "@prisma/client";
import { sendWhatsAppMessage } from "./whatsapp";

export type OutboundChannel = "WHATSAPP" | "SMS" | "EMAIL";
type SenderProfile = Pick<BusinessProfile, "twilioPhoneNumber" | "outboundEmail" | "whatsappPhoneNumberId">;
type SendInput = { profile: SenderProfile; to: string; content: string; subject?: string };
type Delivery = { providerMessageId: string | null; isDemo: boolean };

interface MessageProvider {
  send(input: SendInput): Promise<Delivery>;
}

export class DemoMessageProvider implements MessageProvider {
  async send(): Promise<Delivery> {
    return { providerMessageId: `demo_${randomUUID()}`, isDemo: true };
  }
}

export class DemoWhatsAppProvider extends DemoMessageProvider {}
export class DemoSmsProvider extends DemoMessageProvider {}
export class DemoEmailProvider extends DemoMessageProvider {}

let twilioClient: ReturnType<typeof Twilio> | null = null;
let resendClient: Resend | null = null;

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
  twilioClient ??= Twilio(accountSid, authToken);
  return twilioClient;
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email is not configured. Add RESEND_API_KEY.");
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

export function getChannelAvailability(profile: SenderProfile, mode: OrganizationMode) {
  if (mode === "TRIAL") {
    return { whatsapp: true, sms: true, voice: true, email: true, ai: true, demo: true };
  }
  return {
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && (profile.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID)),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (profile.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER)),
    voice: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (profile.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER) && process.env.PUBLIC_API_URL),
    email: Boolean(process.env.RESEND_API_KEY && (profile.outboundEmail || process.env.RESEND_FROM_EMAIL)),
    ai: Boolean(process.env.OPENAI_API_KEY),
    demo: false,
  };
}

export class RealWhatsAppProvider implements MessageProvider {
  async send(input: SendInput): Promise<Delivery> {
    const providerMessageId = await sendWhatsAppMessage(input.to, input.content, input.profile.whatsappPhoneNumberId);
    return { providerMessageId, isDemo: false };
  }
}

export class RealSmsProvider implements MessageProvider {
  async send(input: SendInput): Promise<Delivery> {
    const from = input.profile.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;
    if (!from) throw new Error("SMS is not configured for this workspace.");
    const message = await getTwilioClient().messages.create({ body: input.content, from, to: input.to });
    return { providerMessageId: message.sid, isDemo: false };
  }
}

export class RealEmailProvider implements MessageProvider {
  async send(input: SendInput): Promise<Delivery> {
    const from = input.profile.outboundEmail || process.env.RESEND_FROM_EMAIL;
    if (!from) throw new Error("Email is not configured for this workspace.");
    const result = await getResendClient().emails.send({
      from,
      to: input.to,
      subject: input.subject || "A message from your business",
      text: input.content,
    });
    if (result.error) throw new Error(result.error.message);
    return { providerMessageId: result.data?.id ?? null, isDemo: false };
  }
}

function getMessageProvider(mode: OrganizationMode, channel: OutboundChannel): MessageProvider {
  if (mode === "TRIAL" && channel === "WHATSAPP") return new DemoWhatsAppProvider();
  if (mode === "TRIAL" && channel === "SMS") return new DemoSmsProvider();
  if (mode === "TRIAL") return new DemoEmailProvider();
  if (channel === "WHATSAPP") return new RealWhatsAppProvider();
  if (channel === "SMS") return new RealSmsProvider();
  return new RealEmailProvider();
}

export async function deliverMessage(input: {
  mode: OrganizationMode;
  channel: OutboundChannel;
  profile: SenderProfile;
  to: string;
  content: string;
  subject?: string;
}): Promise<Delivery> {
  if (input.mode === "LIVE" && !getChannelAvailability(input.profile, input.mode)[input.channel.toLowerCase() as "whatsapp" | "sms" | "email"]) {
    throw new Error(`${input.channel === "WHATSAPP" ? "WhatsApp" : input.channel === "SMS" ? "SMS" : "Email"} is not configured for this workspace.`);
  }
  return getMessageProvider(input.mode, input.channel).send(input);
}

export class DemoVoiceProvider {
  async startCall(): Promise<{ callId: string; isDemo: true }> {
    return { callId: `demo_${randomUUID()}`, isDemo: true };
  }
}

type VoiceInput = {
  profile: SenderProfile;
  to: string;
  organizationId: string;
  contactId: string;
  conversationId: string;
  agentId?: string;
};

export class RealVoiceProvider {
  async startCall(input: VoiceInput): Promise<{ callId: string; isDemo: false }> {
  const from = input.profile.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;
  const publicApiUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (!from || !publicApiUrl || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Voice is not configured for this workspace.");
  }
  const url = new URL(`${publicApiUrl}/api/webhooks/twilio/voice`);
  url.searchParams.set("organizationId", input.organizationId);
  url.searchParams.set("contactId", input.contactId);
  if (input.agentId) url.searchParams.set("agentId", input.agentId);
  const statusUrl = new URL(`${publicApiUrl}/api/webhooks/twilio/voice/status`);
  statusUrl.searchParams.set("conversationId", input.conversationId);
  const call = await getTwilioClient().calls.create({
    to: input.to,
    from,
    url: url.toString(),
    method: "POST",
    statusCallback: statusUrl.toString(),
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
  return { callId: call.sid, isDemo: false };
  }
}

export async function startVoiceCall(input: VoiceInput & { mode: OrganizationMode }): Promise<{ callId: string; isDemo: boolean }> {
  if (input.mode === "TRIAL") return new DemoVoiceProvider().startCall();
  return new RealVoiceProvider().startCall(input);
}