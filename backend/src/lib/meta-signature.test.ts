import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { isValidMetaSignature } from "./meta-signature";

test("accepts a valid Meta SHA-256 signature", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = "test-meta-app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(isValidMetaSignature(body, signature, secret), true);
});

test("rejects missing configuration, invalid signatures, and altered bodies", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`;

  assert.equal(isValidMetaSignature(undefined, signature, "test-secret"), false);
  assert.equal(isValidMetaSignature(body, undefined, "test-secret"), false);
  assert.equal(isValidMetaSignature(body, signature, undefined), false);
  assert.equal(isValidMetaSignature(body, signature, "wrong-secret"), false);
  assert.equal(isValidMetaSignature(Buffer.from("altered"), signature, "test-secret"), false);
});
