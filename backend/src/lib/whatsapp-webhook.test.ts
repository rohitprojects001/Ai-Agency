import assert from "node:assert/strict";
import test from "node:test";
import { isValidWhatsAppVerifyToken, processWhatsAppMessages, type WhatsAppWebhookPayload } from "./whatsapp-webhook";

test("rejects WhatsApp verification when the configured token is missing or empty", () => {
  assert.equal(isValidWhatsAppVerifyToken("subscribe", "token", undefined), false);
  assert.equal(isValidWhatsAppVerifyToken("subscribe", "token", ""), false);
  assert.equal(isValidWhatsAppVerifyToken("subscribe", "token", "configured"), false);
});

test("processes every message from every entry and change", async () => {
  const payload: WhatsAppWebhookPayload = {
    entry: [
      { changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "m1" }, { id: "m2" }] } }] },
      { changes: [
        { value: { metadata: { phone_number_id: "phone-2" }, messages: [{ id: "m3" }] } },
        { value: { metadata: { phone_number_id: "phone-3" }, messages: [{ id: "m4" }] } },
      ] },
    ],
  };
  const processed: string[] = [];

  await processWhatsAppMessages(payload, async ({ message }) => {
    processed.push(message.id!);
  });

  assert.deepEqual(processed, ["m1", "m2", "m3", "m4"]);
});

test("skips duplicate WhatsApp message IDs, including across webhook retries", async () => {
  const payload: WhatsAppWebhookPayload = {
    entry: [{ changes: [{ value: { messages: [{ id: "duplicate" }, { id: "duplicate" }] } }] }],
  };
  const persistedIds = new Set<string>();
  const processed: string[] = [];
  const processWebhook = () => processWhatsAppMessages(payload, async ({ message }) => {
    const id = message.id!;
    if (persistedIds.has(id)) return;
    persistedIds.add(id);
    processed.push(id);
  });

  await processWebhook();
  await processWebhook();

  assert.deepEqual(processed, ["duplicate"]);
});
