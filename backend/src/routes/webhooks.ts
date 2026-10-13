import { Router } from "express";
import { prisma } from "../lib/prisma";
import { isValidMetaSignature } from "../lib/meta-signature";
import { sendOutboundMessage } from "../services/outbound-messages";
import { handleIncomingMessage } from "../services/orchestrator";
import { isValidWhatsAppVerifyToken, processWhatsAppMessages, type WhatsAppWebhookPayload } from "../lib/whatsapp-webhook";

export const webhooksRouter = Router();

// GET /api/webhooks/whatsapp - Meta's one-time verification handshake.
// When you register this URL in the Meta App dashboard, Meta calls this
// with hub.verify_token and expects hub.challenge echoed back if it matches.
webhooksRouter.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (isValidWhatsAppVerifyToken(mode, token, process.env.WHATSAPP_VERIFY_TOKEN)) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST /api/webhooks/whatsapp - real incoming customer messages.
// Runs the exact same orchestrator as the demo simulator - only the source
// of the message and isDemo flag differ. Acknowledges Meta immediately with
// 200 regardless of outcome (that's what Meta's retry behavior expects);
// errors are logged, not thrown back at Meta.
webhooksRouter.post("/whatsapp", async (req, res) => {
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.get("x-hub-signature-256");
  if (!appSecret || !signature || !req.rawBody) {
    console.error("WhatsApp webhook rejected: Meta signature verification is not configured");
    return res.sendStatus(403);
  }
  if (!isValidMetaSignature(req.rawBody, signature, appSecret)) {
    console.warn("WhatsApp webhook rejected: invalid Meta signature");
    return res.sendStatus(403);
  }

  res.sendStatus(200); // acknowledge receipt right away

  try {
    const payload = req.body as WhatsAppWebhookPayload;
    await processWhatsAppMessages(payload, async ({ phoneNumberId, contacts, message }) => {
      try {
        if (message.type !== "text" || !message.from || !message.text?.body) return;
        if (!phoneNumberId) return;

        const businessProfile = await prisma.businessProfile.findUnique({
          where: { whatsappPhoneNumberId: phoneNumberId },
        });
        if (!businessProfile) {
          console.warn(`WhatsApp webhook: no organization linked to phone_number_id ${phoneNumberId}`);
          return;
        }
        if (message.id) {
          const duplicate = await prisma.message.findFirst({
            where: {
              organizationId: businessProfile.organizationId,
              externalMessageId: message.id,
            },
            select: { id: true },
          });
          if (duplicate) return;
        }

        const organization = await prisma.organization.findUnique({
          where: { id: businessProfile.organizationId },
          select: { mode: true, status: true },
        });
        if (!organization || organization.status !== "ACTIVE" || organization.mode !== "LIVE") {
          console.warn("WhatsApp webhook ignored: workspace is not active in Live mode");
          return;
        }

        const contactName = contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name
          ?? contacts?.[0]?.profile?.name
          ?? message.from;
        const { conversation, aiMessage } = await handleIncomingMessage({
          organizationId: businessProfile.organizationId,
          channel: "WHATSAPP",
          contact: { name: contactName, phone: message.from },
          messageText: message.text.body,
          externalMessageId: message.id,
          isDemo: false,
        });

        if (aiMessage) {
          await sendOutboundMessage({
            organizationId: businessProfile.organizationId,
            contactId: conversation.contactId,
            conversationId: conversation.id,
            existingMessageId: aiMessage.id,
            channel: "WHATSAPP",
            content: aiMessage.content,
            sender: "AI",
          });
        }
      } catch (err) {
        console.error(`WhatsApp webhook message ${message.id ?? "(missing id)"} processing failed:`, err);
      }
    });
  } catch (err) {
    console.error("WhatsApp webhook processing failed:", err);
  }
});
