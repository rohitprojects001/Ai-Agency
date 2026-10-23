import { NextFunction, Request, Response } from "express";
import { AuthTokenPayload, getSessionTtlSeconds, verifyAuthToken } from "../lib/jwt";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { getOrganizationRuntime, hasActiveSubscription } from "../services/organization-runtime";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload & { email: string };
    }
  }
}

const cookieName = "studio_session";

function getAllowedOrigins() {
  const configured = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((item) => item.trim());
  return process.env.NODE_ENV === "production"
    ? configured
    : [...new Set([...configured, "http://127.0.0.1:3000"])];
}

export function readSessionToken(req: Request) {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(cookieName.length + 1));
  } catch {
    return undefined;
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: getSessionTtlSeconds() * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let claims: AuthTokenPayload;
  try {
    claims = verifyAuthToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const origin = req.get("origin");
    const allowedOrigins = getAllowedOrigins();
    if ((origin && !allowedOrigins.includes(origin)) || (!origin && process.env.NODE_ENV === "production")) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }
  }

  const session = await prisma.session.findFirst({
    where: {
      id: claims.sessionId,
      userId: claims.userId,
      organizationId: claims.organizationId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { status: "ACTIVE" },
      organization: {
        status: "ACTIVE",
        members: { some: { userId: claims.userId, status: "ACTIVE" } },
      },
    },
    select: {
      id: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true } },
      organization: {
        select: {
          members: {
            where: { userId: claims.userId, status: "ACTIVE" },
            select: { role: true },
            take: 1,
          },
        },
      },
    },
  });
  const membership = session?.organization.members[0];
  if (!session || !membership) {
    res.status(401).json({ error: "Your session or workspace access is no longer active." });
    return;
  }

  if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
  }

  req.auth = {
    userId: session.user.id,
    organizationId: claims.organizationId,
    role: membership.role,
    sessionId: session.id,
    email: session.user.email,
  };
  return next();
});

// Restrict a route to specific org roles, e.g. requireRole("OWNER", "ADMIN")
export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !allowed.includes(req.auth.role)) {
      return res.status(403).json({ error: "You don't have permission to do that" });
    }
    return next();
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const administrators = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!req.auth || !administrators.includes(req.auth.email.toLowerCase())) {
    return res.status(403).json({ error: "Platform administrator access required" });
  }
  return next();
}

export const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  const runtime = await getOrganizationRuntime(req.auth!.organizationId);
  if (!(await hasActiveSubscription(runtime))) {
    res.status(402).json({ error: "An active workspace plan is required for this feature.", code: "SUBSCRIPTION_REQUIRED" });
    return;
  }
  return next();
});

export function requireOrganizationFeature(feature: string) {
  return asyncHandler(async (req, res, next) => {
    const runtime = await getOrganizationRuntime(req.auth!.organizationId);
    if (runtime.mode === "TRIAL" && !runtime.trialSettings.enabledFeatures.includes(feature)) {
      res.status(403).json({ error: `${feature} is not enabled for this trial workspace.`, code: "FEATURE_NOT_ENABLED" });
      return;
    }
    if (runtime.mode === "TRIAL" && runtime.trialEndsAt && runtime.trialEndsAt <= new Date()) {
      res.status(402).json({ error: "This workspace trial has ended. Contact support to activate Live mode.", code: "TRIAL_EXPIRED" });
      return;
    }
    return next();
  });
}
