import { Router, type Request } from "express";
import Twilio from "twilio";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { sendOutboundMessage } from "../services/outbound-messages";
import { handleIncomingMessage } from "../services/orchestrator";
import { enforceTrialMessageLimit, getOrganizationRuntime, hasActiveSubscription } from "../services/organization-runtime";

export const twilioWebhooksRouter = Router();

function isValidTwilioRequest(req: Request): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.header("X-Twilio-Signature");
  const publicApiUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (!authToken || !signature || !publicApiUrl) return false;
  const url = `${publicApiUrl}${req.originalUrl}`;
  return Twilio.validateRequest(authToken, signature, url, req.body as Record<string, string>);
}

function xmlResponse(xml: string) {
  return { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" };
}

function getVoiceTurnUrl(organizationId: string, contactId: string, agentId?: string) {
  const baseUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("PUBLIC_API_URL must be configured for Twilio voice webhooks");
  const url = new URL(`${baseUrl}/api/webhooks/twilio/voice/turn`);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("contactId", contactId);
  if (agentId) url.searchParams.set("agentId", agentId);
  return url.toString();
}

function voiceGather(response: InstanceType<typeof Twilio.twiml.VoiceResponse>, actionUrl: string, prompt: string) {
  const gather = response.gather({ input: ["speech"], action: actionUrl, method: "POST", speechTimeout: "auto" });
  gather.say(prompt);
  response.say("I didn't hear a response. Please call again when you're ready.");
  response.hangup();
}

twilioWebhooksRouter.post("/sms", asyncHandler(async (req, res) => {
  if (!isValidTwilioRequest(req)) return res.sendStatus(403);
  const from = String(req.body?.From ?? "");
  const to = String(req.body?.To ?? "");
  const text = String(req.body?.Body ?? "").trim();
  if (!from || !to || !text) return res.status(400).send("Missing SMS fields");

  const profile = await prisma.businessProfile.findFirst({ where: { twilioPhoneNumber: to } });
  if (!profile) return res.status(404).send("Number is not linked to a workspace");
  const smsOrganization = await prisma.organization.findUnique({
    where: { id: profile.organizationId },
    select: { mode: true, status: true },
  });
  if (!smsOrganization || smsOrganization.mode !== "LIVE" || smsOrganization.status !== "ACTIVE") {
    return res.set(xmlResponse("")).type("text/xml").send("<Response/>");
  }

  try {
    const { conversation, aiMessage } = await handleIncomingMessage({
      organizationId: profile.organizationId,
      channel: "SMS",
      contact: { name: from, phone: from },
      messageText: text,
      isDemo: false,
    });
    if (aiMessage) {
      await sendOutboundMessage({
        organizationId: profile.organizationId,
        contactId: conversation.contactId,
        conversationId: conversation.id,
        existingMessageId: aiMessage.id,
        channel: "SMS",
        content: aiMessage.content,
        sender: "AI",
      });
    }
    res.set(xmlResponse("" )).type("text/xml").send("<Response/>");
  } catch (error) {
    console.error("Twilio SMS processing failed:", error);
    res.set(xmlResponse("" )).type("text/xml").send("<Response/>");
  }
}));

twilioWebhooksRouter.post("/voice", asyncHandler(async (req, res) => {
  if (!isValidTwilioRequest(req)) return res.sendStatus(403);
  const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;
  const requestedContactId = typeof req.query.contactId === "string" ? req.query.contactId : undefined;
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const from = String(req.body?.From ?? "");
  const to = String(req.body?.To ?? "");

  let profile = organizationId
    ? await prisma.businessProfile.findUnique({ where: { organizationId } })
    : await prisma.businessProfile.findFirst({ where: { twilioPhoneNumber: to } });
  if (!profile) {
    const response = new Twilio.twiml.VoiceResponse();
    response.say("This number is not connected to a business workspace.");
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }
  const voiceOrganization = await prisma.organization.findUnique({
    where: { id: profile.organizationId },
    select: { mode: true, status: true },
  });
  if (!voiceOrganization || voiceOrganization.mode !== "LIVE" || voiceOrganization.status !== "ACTIVE") {
    const response = new Twilio.twiml.VoiceResponse();
    response.say("This workspace is not enabled for live voice.");
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }
  const voiceRuntime = await getOrganizationRuntime(profile.organizationId);
  if (!(await hasActiveSubscription(voiceRuntime))) {
    console.warn("Incoming Twilio voice call rejected: the workspace has no active plan");
    const response = new Twilio.twiml.VoiceResponse();
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }

  let contact = requestedContactId
    ? await prisma.contact.findFirst({ where: { id: requestedContactId, organizationId: profile.organizationId } })
    : await prisma.contact.findFirst({ where: { organizationId: profile.organizationId, phone: from } });
  if (!contact) {
    contact = await prisma.contact.create({ data: { organizationId: profile.organizationId, name: from, phone: from } });
  }

  const actionUrl = getVoiceTurnUrl(profile.organizationId, contact.id, agentId);
  const response = new Twilio.twiml.VoiceResponse();
  voiceGather(response, actionUrl, `Hello, this is the AI assistant for ${profile.businessName}. How can I help you today?`);
  res.set(xmlResponse("")).type("text/xml").send(response.toString());
}));

twilioWebhooksRouter.post("/voice/turn", asyncHandler(async (req, res) => {
  if (!isValidTwilioRequest(req)) return res.sendStatus(403);
  const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  const contactId = typeof req.query.contactId === "string" ? req.query.contactId : "";
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  const profile = await prisma.businessProfile.findUnique({ where: { organizationId } });
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { mode: true, status: true },
  });
  const speech = String(req.body?.SpeechResult ?? "").trim();
  const response = new Twilio.twiml.VoiceResponse();
  if (!organization || organization.mode !== "LIVE" || organization.status !== "ACTIVE") {
    response.say("This workspace is not enabled for live voice.");
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }
  if (!(await hasActiveSubscription(await getOrganizationRuntime(organizationId)))) {
    console.warn("Twilio voice turn rejected: the workspace has no active plan");
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }
  if (!contact || !profile || !speech) {
    response.say("I couldn't hear that. Please call back when you're ready.");
    response.hangup();
    return res.set(xmlResponse("")).type("text/xml").send(response.toString());
  }

  const { aiMessage } = await handleIncomingMessage({
    organizationId,
    channel: "VOICE",
    contact: { name: contact.name, phone: contact.phone ?? undefined },
    messageText: speech,
    isDemo: false,
    agentId,
  });
  if (!aiMessage) {
    response.say("A member of our team will follow up with you. Goodbye.");
    response.hangup();
  } else {
    voiceGather(response, getVoiceTurnUrl(organizationId, contact.id, agentId), aiMessage.content);
  }
  res.set(xmlResponse("")).type("text/xml").send(response.toString());
}));

twilioWebhooksRouter.post("/voice/status", asyncHandler(async (req, res) => {
  if (!isValidTwilioRequest(req)) return res.sendStatus(403);
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : "";
  const callSid = String(req.body?.CallSid ?? "");
  const callStatus = String(req.body?.CallStatus ?? "").toUpperCase();
  if (!conversationId || !callSid) return res.sendStatus(400);

  const deliveryStatus = ["FAILED", "BUSY", "NO-ANSWER", "CANCELED"].includes(callStatus)
    ? "FAILED"
    : callStatus === "COMPLETED" ? "COMPLETED" : callStatus;
  await prisma.message.updateMany({
    where: { conversationId, providerMessageId: callSid },
    data: { deliveryStatus },
  });
  res.sendStatus(204);
}));