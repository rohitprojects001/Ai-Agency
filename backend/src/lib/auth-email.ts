import { createHash, randomBytes } from "node:crypto";
import { Resend } from "resend";
import { AuthChallengePurpose } from "@prisma/client";
import { prisma } from "./prisma";

const challengeLifetimeMs = 30 * 60 * 1000;

function frontendUrl() {
  const configured = process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN?.split(",")[0]?.trim();
  if (!configured) throw new Error("Set FRONTEND_URL or CORS_ORIGIN to send authentication emails");
  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTPS in production");
  }
  return url.origin;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function sendAuthChallenge(user: { id: string; name: string; email: string }, purpose: AuthChallengePurpose) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Authentication email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + challengeLifetimeMs);
  await prisma.authChallenge.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const challenge = await prisma.authChallenge.create({
    data: { userId: user.id, purpose, tokenHash, expiresAt },
  });

  const verify = purpose === "VERIFY_EMAIL";
  const action = verify ? "verify-email" : "reset-password";
  const url = new URL("/", frontendUrl());
  url.searchParams.set("authAction", action);
  url.searchParams.set("token", token);
  const subject = verify ? "Verify your Rohit AI Studio email" : "Reset your Rohit AI Studio password";
  const instruction = verify
    ? "Verify your email address to activate your secure workspace access."
    : "Choose a new password for your Rohit AI Studio account.";
  const resendClient = new Resend(apiKey);
  const result = await resendClient.emails.send({
    from,
    to: user.email,
    subject,
    text: `Hi ${user.name},\n\n${instruction}\n\nThis link expires in 30 minutes:\n${url}\n\nIf you did not request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201c"><h1>${escapeHtml(subject)}</h1><p>Hi ${escapeHtml(user.name)},</p><p>${escapeHtml(instruction)}</p><p><a href="${escapeHtml(url.toString())}" style="display:inline-block;padding:12px 18px;background:#d1f36b;color:#17201c;text-decoration:none">Continue securely</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p></div>`,
  });

  if (result.error) {
    await prisma.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw new Error(`Authentication email could not be sent: ${result.error.message}`);
  }
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
