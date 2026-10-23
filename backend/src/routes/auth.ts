import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { hashAuthToken, sendAuthChallenge, sendExistingAccountNotice } from "../lib/auth-email";
import { prisma } from "../lib/prisma";
import { getSessionTtlSeconds, signAuthToken, verifyAuthToken, type AuthTokenPayload } from "../lib/jwt";
import { clearSessionCookie, readSessionToken, requireAuth, setSessionCookie } from "../middleware/requireAuth";
import { defaultTrialPeriod } from "../services/organization-runtime";

export const authRouter = Router();

const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again in 15 minutes." },
});

const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => typeof req.body?.email !== "string",
  keyGenerator: (req) => `email:${normalizedEmail(req.body.email)}`,
  message: { error: "Too many sign-in attempts for this email. Try again in 15 minutes." },
});

const dummyPasswordHash = bcrypt.hash("unused-account-password", 12);
const registrationAcceptedMessage = "Your workspace is ready. You can continue with your account immediately.";

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace";
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function isEmailUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes("email")
    : typeof target === "string" && target.includes("email");
}

async function notifyExistingAccount(user: { name: string; email: string }) {
  try {
    await sendExistingAccountNotice(user);
  } catch (error) {
    console.error("Existing-account notice could not be sent:", error);
  }
}

function respondToRegistration(res: Response, message = registrationAcceptedMessage) {
  return res.status(201).json({ message });
}

async function createRegisteredWorkspace(input: { email: string; name: string; businessName: string; passwordHash: string }) {
  const baseSlug = slugify(input.businessName);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) slug = `${baseSlug}-${++suffix}`;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash: input.passwordHash } });
    const organization = await tx.organization.create({
      data: { name: input.businessName, slug, ...defaultTrialPeriod() },
    });
    const membership = await tx.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
    await tx.auditLog.create({ data: { organizationId: organization.id, userId: user.id, action: "organization.created" } });
    return { user, organization, membership };
  });
}

function writeAuthCookie(res: Response, userId: string, organizationId: string, role: string, sessionId: string) {
  setSessionCookie(res, signAuthToken({ userId, organizationId, role, sessionId }));
}

async function createSession(userId: string, organizationId: string, role: string, req: Request) {
  const expiresAt = new Date(Date.now() + getSessionTtlSeconds() * 1000);
  return prisma.session.create({
    data: {
      userId,
      organizationId,
      expiresAt,
      ipAddress: req.ip,
      userAgent: req.get("user-agent")?.slice(0, 512),
    },
  });
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12, "Password must be at least 12 characters").max(128),
  businessName: z.string().trim().min(1).max(120),
});

async function beginRegistration(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  const { name, password, businessName } = parsed.data;
  const email = normalizedEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { name: true, email: true } });
  if (existingUser) {
    await notifyExistingAccount(existingUser);
    return respondToRegistration(res);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let user; let organization; let membership;
  try {
    ({ user, organization, membership } = await createRegisteredWorkspace({ email, name, businessName, passwordHash }));
  } catch (error) {
    if (!isEmailUniqueConstraintError(error)) throw error;
    const racedUser = await prisma.user.findUnique({ where: { email }, select: { name: true, email: true } });
    if (racedUser) await notifyExistingAccount(racedUser);
    return respondToRegistration(res);
  }

  const session = await createSession(user.id, organization.id, membership.role, req);
  writeAuthCookie(res, user.id, organization.id, membership.role, session.id);
  await prisma.auditLog.create({
    data: { organizationId: organization.id, userId: user.id, action: "auth.session_created" },
  });

  return res.status(201).json({
    message: registrationAcceptedMessage,
    user: { id: user.id, name: user.name, email: user.email },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    role: membership.role,
    expiresAt: session.expiresAt,
  });
}

authRouter.post("/register", authAttemptLimiter, asyncHandler(beginRegistration));
authRouter.post("/register/start", authAttemptLimiter, asyncHandler(beginRegistration));

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

authRouter.post("/login", authAttemptLimiter, loginEmailLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  const email = normalizedEmail(parsed.data.email);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { where: { status: "ACTIVE", organization: { status: "ACTIVE" } }, include: { organization: true }, orderBy: { createdAt: "asc" } } },
  });
  const invalid = () => res.status(401).json({ error: "Invalid email or password" });
  if (!user) {
    await bcrypt.compare(parsed.data.password, await dummyPasswordHash);
    return invalid();
  }
  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (user.lockedUntil && user.lockedUntil > new Date()) return invalid();
  if (!validPassword) {
    if (!user.lockedUntil || user.lockedUntil <= new Date()) {
      const attempt = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, loginLockoutLevel: true },
      });
      if (attempt.failedLoginAttempts >= 10) {
        const loginLockoutLevel = attempt.loginLockoutLevel + 1;
        const lockDurationMs = Math.min(15 * 60 * 1000 * 2 ** (loginLockoutLevel - 1), 24 * 60 * 60 * 1000);
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            loginLockoutLevel,
            lockedUntil: new Date(Date.now() + lockDurationMs),
          },
        });
      }
    }
    return invalid();
  }
  if (user.status !== "ACTIVE") return res.status(403).json({ error: "This account is suspended. Contact support." });
  if (user.failedLoginAttempts > 0 || user.lockedUntil || user.loginLockoutLevel > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, loginLockoutLevel: 0, lockedUntil: null },
    });
  }
  const membership = user.memberships[0];
  if (!membership) return res.status(403).json({ error: "This account has no active workspace. Request access to a workspace to continue." });

  const session = await createSession(user.id, membership.organizationId, membership.role, req);
  writeAuthCookie(res, user.id, membership.organizationId, membership.role, session.id);
  await prisma.auditLog.create({
    data: { organizationId: membership.organizationId, userId: user.id, action: "auth.session_created" },
  });
  return res.json({
    user: { id: user.id, name: user.name, email: user.email },
    organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug },
    role: membership.role,
    expiresAt: session.expiresAt,
  });
}));

const emailOnlySchema = z.object({ email: z.string().trim().email().max(254) });

authRouter.post("/forgot-password", authAttemptLimiter, asyncHandler(async (req, res) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail(parsed.data.email) } });
  if (user) {
    try {
      await sendAuthChallenge(user, "RESET_PASSWORD");
    } catch (error) {
      console.error("Password reset email could not be sent:", error);
    }
  }
  return res.status(202).json({ message: "If an account exists for this email, password reset instructions will be sent." });
}));

authRouter.post("/reset-password", authAttemptLimiter, asyncHandler(async (req, res) => {
  const parsed = z.object({
    token: z.string().min(32).max(200),
    password: z.string().min(12).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Use a valid reset link and a password of at least 12 characters." });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const challenge = await prisma.authChallenge.findFirst({
    where: { tokenHash, purpose: "RESET_PASSWORD", consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true },
  });
  if (!challenge) return res.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const changed = await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return false;
    await tx.user.update({ where: { id: challenge.userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: challenge.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
  if (!changed) return res.status(400).json({ error: "This password reset link has already been used or has expired." });
  return res.json({ message: "Password updated. Sign in with your new password." });
}));

authRouter.post("/change-password", requireAuth, authAttemptLimiter, asyncHandler(async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Current password and a new password of at least 12 characters are required." });
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId: user.id, id: { not: req.auth!.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await prisma.auditLog.create({ data: { organizationId: req.auth!.organizationId, userId: user.id, action: "auth.password_changed" } });
  return res.json({ message: "Password updated. Other sessions have been signed out." });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    const origin = req.get("origin");
    const allowedOrigins = process.env.NODE_ENV === "production"
      ? (process.env.CORS_ORIGIN ?? "").split(",").map((item) => item.trim())
      : [...new Set([...(process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((item) => item.trim()), "http://127.0.0.1:3000"])];
    if ((origin && !allowedOrigins.includes(origin)) || (!origin && process.env.NODE_ENV === "production")) {
      clearSessionCookie(res);
      return res.status(403).json({ error: "Request origin is not allowed" });
    }
    let claims: AuthTokenPayload;
    try {
      claims = verifyAuthToken(token);
    } catch {
      clearSessionCookie(res);
      return res.status(204).send();
    }
    await prisma.session.updateMany({
      where: { id: claims.sessionId, userId: claims.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: claims.userId, organizationId: claims.organizationId },
      select: { organizationId: true },
    });
    if (membership) {
      await prisma.auditLog.create({
        data: { organizationId: membership.organizationId, userId: claims.userId, action: "auth.session_revoked" },
      });
    }
  }
  clearSessionCookie(res);
  return res.status(204).send();
}));

authRouter.get("/sessions", requireAuth, asyncHandler(async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, organizationId: true, createdAt: true, lastSeenAt: true, expiresAt: true, ipAddress: true, userAgent: true },
    orderBy: { lastSeenAt: "desc" },
  });
  return res.json({ sessions, currentSessionId: req.auth!.sessionId });
}));

authRouter.post("/logout-all", requireAuth, asyncHandler(async (req, res) => {
  await prisma.session.updateMany({
    where: { userId: req.auth!.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { organizationId: req.auth!.organizationId, userId: req.auth!.userId, action: "auth.sessions_revoked" },
  });
  clearSessionCookie(res);
  return res.status(204).send();
}));

authRouter.post("/sessions/:sessionId/revoke", requireAuth, asyncHandler(async (req, res) => {
  const result = await prisma.session.updateMany({
    where: { id: req.params.sessionId, userId: req.auth!.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return res.status(404).json({ error: "Active session not found." });
  await prisma.auditLog.create({
    data: { organizationId: req.auth!.organizationId, userId: req.auth!.userId, action: "auth.session_revoked" },
  });
  if (req.params.sessionId === req.auth!.sessionId) clearSessionCookie(res);
  return res.json({ message: "Session revoked." });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const [user, organization] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, name: true, email: true } }),
    prisma.organization.findUnique({
      where: { id: req.auth!.organizationId },
      select: { id: true, name: true, slug: true, mode: true, status: true, trialStartedAt: true, trialEndsAt: true },
    }),
  ]);
  if (!user || !organization) return res.status(401).json({ error: "Account or workspace access is no longer active." });
  const administrators = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase());
  return res.json({ user, organization, role: req.auth!.role, isPlatformAdmin: administrators.includes(user.email.toLowerCase()) });
}));

authRouter.get("/workspaces", requireAuth, asyncHandler(async (req, res) => {
  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId: req.auth!.userId,
      status: "ACTIVE",
      organization: { status: "ACTIVE", members: { some: { userId: req.auth!.userId, status: "ACTIVE" } } },
    },
    select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ workspaces: memberships.map(({ role, organization }) => ({ ...organization, role })) });
}));

authRouter.post("/switch-workspace", requireAuth, asyncHandler(async (req, res) => {
  const parsed = z.object({ slug: z.string().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid workspace slug is required." });
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.auth!.userId, status: "ACTIVE", organization: { slug: parsed.data.slug, status: "ACTIVE" } },
    include: { organization: true },
  });
  if (!membership) return res.status(403).json({ error: "You don't have active access to that workspace." });
  await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { organizationId: membership.organizationId } });
  writeAuthCookie(res, req.auth!.userId, membership.organizationId, membership.role, req.auth!.sessionId);
  await prisma.auditLog.create({ data: { organizationId: membership.organizationId, userId: req.auth!.userId, action: "auth.workspace_switched" } });
  return res.json({
    organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug },
    role: membership.role,
  });
}));
