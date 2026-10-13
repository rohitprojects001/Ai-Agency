import { timingSafeEqual } from "node:crypto";

export interface WhatsAppMessage {
  id?: string;
  from?: string;
  text?: { body?: string };
  type?: string;
}

export interface WhatsAppWebhookMessage {
  phoneNumberId?: string;
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  message: WhatsAppMessage;
}

export interface WhatsAppWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: WhatsAppMessage[];
      };
    }[];
  }[];
}

export function isValidWhatsAppVerifyToken(
  mode: unknown,
  receivedToken: unknown,
  configuredToken: string | undefined,
): boolean {
  if (
    mode !== "subscribe" ||
    typeof receivedToken !== "string" ||
    !configuredToken
  ) {
    return false;
  }

  const received = Buffer.from(receivedToken);
  const configured = Buffer.from(configuredToken);
  return received.length === configured.length && timingSafeEqual(received, configured);
}

export async function processWhatsAppMessages(
  payload: WhatsAppWebhookPayload,
  processMessage: (message: WhatsAppWebhookMessage) => Promise<void>,
): Promise<void> {
  const seenMessageIds = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const message of value?.messages ?? []) {
        if (message.id) {
          if (seenMessageIds.has(message.id)) continue;
          seenMessageIds.add(message.id);
        }
        await processMessage({
          phoneNumberId: value?.metadata?.phone_number_id,
          contacts: value?.contacts,
          message,
        });
      }
    }
  }
}
