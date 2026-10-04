import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  userId: string;
  organizationId: string;
  role: string;
  sessionId: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Copy .env.example to .env and set it.");
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), {
    expiresIn: getSessionTtlSeconds(),
    issuer: "rohit-ai-studio-api",
    audience: "rohit-ai-studio",
  });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, getSecret(), {
    issuer: "rohit-ai-studio-api",
    audience: "rohit-ai-studio",
  });
  if (
    typeof payload === "string"
    || typeof payload.userId !== "string"
    || typeof payload.organizationId !== "string"
    || typeof payload.role !== "string"
    || typeof payload.sessionId !== "string"
  ) {
    throw new Error("Invalid session token");
  }
  return payload as AuthTokenPayload;
}

export function getSessionTtlSeconds(): number {
  const configured = process.env.JWT_EXPIRES_IN ?? "7d";
  const match = /^(\d+)(s|m|h|d)$/.exec(configured);
  if (!match) throw new Error("JWT_EXPIRES_IN must use a duration such as 30m, 12h, or 7d");
  const amount = Number(match[1]);
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "s" | "m" | "h" | "d"];
  const seconds = amount * factor;
  if (!Number.isSafeInteger(seconds) || seconds < 900 || seconds > 30 * 86400) {
    throw new Error("JWT_EXPIRES_IN must be between 15 minutes and 30 days");
  }
  return seconds;
}
