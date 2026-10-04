// Thin wrapper around the WhatsApp Business Cloud API (Meta).
// This is the "real provider" - the demo simulator never calls this file.
// Nothing here runs unless WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID
// are set in .env.

const GRAPH_VERSION = "v21.0";

export function isWhatsAppConfigured(phoneNumberId?: string | null): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && (phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID));
}

// Sends a real WhatsApp message. Throws if credentials aren't configured or
// the API call fails - callers should catch this and handle it explicitly
// rather than silently pretending the message went out.
export async function sendWhatsAppMessage(to: string, text: string, linkedPhoneNumberId?: string | null): Promise<string | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = linkedPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp is not configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errorBody}`);
  }

  const result = await res.json() as { messages?: { id?: string }[] };
  return result.messages?.[0]?.id ?? null;
}
