import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverMessage, getChannelAvailability, startVoiceCall } from "./channel-providers";

const profile = {
  whatsappPhoneNumberId: null,
  twilioPhoneNumber: null,
  outboundEmail: null,
};

test("Trial mode selects demo delivery without requiring provider credentials", async () => {
  const availability = getChannelAvailability(profile, "TRIAL");
  assert.deepEqual(availability, { whatsapp: true, sms: true, voice: true, email: true, ai: true, demo: true });

  const delivery = await deliverMessage({
    mode: "TRIAL",
    channel: "WHATSAPP",
    profile,
    to: "+15555550123",
    content: "This should stay inside the demo.",
  });
  assert.equal(delivery.isDemo, true);
  assert.match(delivery.providerMessageId ?? "", /^demo_/);
});

test("Live mode rejects a missing provider instead of falling back to demo", async () => {
  const envKeys = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"] as const;
  const previousValues = envKeys.map((key) => process.env[key]);
  try {
    for (const key of envKeys) delete process.env[key];
    const availability = getChannelAvailability(profile, "LIVE");
    assert.equal(availability.email, false);
    await assert.rejects(
      deliverMessage({
        mode: "LIVE",
        channel: "EMAIL",
        profile,
        to: "customer@example.test",
        content: "This must fail clearly.",
      }),
      /Email is not configured for this workspace/,
    );
  } finally {
    envKeys.forEach((key, index) => {
      const value = previousValues[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });

    test("Trial voice simulation does not attempt a phone call", async () => {
      const call = await startVoiceCall({
        mode: "TRIAL",
        profile,
        to: "+15555550123",
        organizationId: "trial-workspace",
        contactId: "trial-contact",
        conversationId: "trial-conversation",
      });
      assert.equal(call.isDemo, true);
      assert.match(call.callId, /^demo_/);
    });
  }
});
