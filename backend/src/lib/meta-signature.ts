import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidMetaSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  appSecret: string | undefined
): boolean {
  if (!rawBody || !signature || !appSecret) return false;

  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
