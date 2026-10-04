import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { app } from "../server";
import { prisma } from "./prisma";
import { signAuthToken } from "./jwt";

const suffix = randomUUID();
const userId = `security-user-${suffix}`;
const organizationId = `security-org-${suffix}`;
const foreignOrganizationId = `security-foreign-org-${suffix}`;
const slug = `security-test-${suffix}`;
const foreignSlug = `security-test-foreign-${suffix}`;
let baseUrl: string;
let cookie: string;
let authOrigin: string;
let testServer: ReturnType<typeof app.listen>;
let originalSuperAdminEmails: string | undefined;

before(async () => {
  const user = await prisma.user.create({
    data: {
      id: userId,
      name: "Security Test",
      email: `security-${suffix}@example.test`,
      passwordHash: await bcrypt.hash("Fixture-password-strong", 12),
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.organization.createMany({
    data: [
      { id: organizationId, name: "Security Test Workspace", slug },
      { id: foreignOrganizationId, name: "Foreign Test Workspace", slug: foreignSlug },
    ],
  });
  await prisma.organizationMember.create({
    data: { userId: user.id, organizationId, role: "VIEWER", status: "ACTIVE" },
  });
  const session = await prisma.session.create({
    data: { userId, organizationId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  cookie = `studio_session=${signAuthToken({ userId, organizationId, role: "OWNER", sessionId: session.id })}`;
  authOrigin = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim();
  originalSuperAdminEmails = process.env.SUPER_ADMIN_EMAILS;
  process.env.SUPER_ADMIN_EMAILS = `security-${suffix}@example.test`;

  testServer = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    testServer.once("listening", resolve);
    testServer.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(testServer.address() as AddressInfo).port}`;
  testServer.unref();
});

after(async () => {
  if (testServer?.listening) {
    await new Promise<void>((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
  }
  await prisma.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrganizationId] } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  if (originalSuperAdminEmails === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = originalSuperAdminEmails;
  await prisma.$disconnect();
});

async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") headers.set("Origin", authOrigin);
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
}

test("requires a server session cookie for protected workspace data", async () => {
  const unauthenticated = await api("/api/contacts");
  assert.equal(unauthenticated.status, 401);

  const authenticated = await api("/api/contacts", { headers: { Cookie: cookie } });
  assert.equal(authenticated.status, 200);
  const trialFeature = await api("/api/agents", { headers: { Cookie: cookie } });
  assert.equal(trialFeature.status, 200);
  await prisma.organization.update({ where: { id: organizationId }, data: { mode: "LIVE" } });
  const unpaidFeature = await api("/api/agents", { headers: { Cookie: cookie } });
  assert.equal(unpaidFeature.status, 402);

  const startsAt = new Date();
  await prisma.subscription.create({
    data: {
      organizationId,
      plan: "MONTHLY",
      status: "ACTIVE",
      startsAt,
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  const paidFeature = await api("/api/agents", { headers: { Cookie: cookie } });
  assert.equal(paidFeature.status, 200);
  await prisma.subscription.updateMany({ where: { organizationId }, data: { status: "EXPIRED" } });
  const expiredFeature = await api("/api/agents", { headers: { Cookie: cookie } });
  assert.equal(expiredFeature.status, 402);
  await prisma.subscription.deleteMany({ where: { organizationId } });
  await prisma.organization.update({ where: { id: organizationId }, data: { mode: "TRIAL" } });
});

test("only platform admins can activate Live mode and the transition is audited", async () => {
  const ordinaryUserId = `ordinary-user-${suffix}`;
  const ordinaryUser = await prisma.user.create({
    data: {
      id: ordinaryUserId,
      email: `ordinary-${suffix}@example.test`,
      name: "Ordinary Workspace User",
      passwordHash: await bcrypt.hash("Fixture-password-strong", 12),
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: ordinaryUser.id, role: "ADMIN", status: "ACTIVE" },
  });
  const ordinarySession = await prisma.session.create({
    data: { userId: ordinaryUser.id, organizationId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const ordinaryCookie = `studio_session=${signAuthToken({ userId: ordinaryUser.id, organizationId, role: "ADMIN", sessionId: ordinarySession.id })}`;
  const integrationEnvKeys = [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "PUBLIC_API_URL",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "OPENAI_API_KEY",
  ] as const;
  const previousIntegrationEnv = integrationEnvKeys.map((key) => process.env[key]);
  try {
    const denied = await api(`/api/admin/organizations/${organizationId}/mode`, {
      method: "POST",
      headers: { Cookie: ordinaryCookie },
      body: JSON.stringify({ mode: "LIVE", confirmation: "ACTIVATE LIVE" }),
    });
    assert.equal(denied.status, 403);

    integrationEnvKeys.forEach((key) => delete process.env[key]);
    const noProviderActivation = await api(`/api/admin/organizations/${organizationId}/mode`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ mode: "LIVE", confirmation: "ACTIVATE LIVE" }),
    });
    assert.equal(noProviderActivation.status, 409);

    process.env.WHATSAPP_ACCESS_TOKEN = "test-only-token";
    process.env.OPENAI_API_KEY = "test-only-key";
    const integrationConfig = await api(`/api/admin/organizations/${organizationId}/integrations`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: JSON.stringify({ whatsappPhoneNumberId: "test-phone-number-id" }),
    });
    assert.equal(integrationConfig.status, 200);
    const noPlanActivation = await api(`/api/admin/organizations/${organizationId}/mode`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ mode: "LIVE", confirmation: "ACTIVATE LIVE" }),
    });
    assert.equal(noPlanActivation.status, 409);
    const subscriptionActivation = await api(`/api/admin/organizations/${organizationId}/subscription`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ confirmation: "ACTIVATE", plan: "MONTHLY", paymentReference: "TRIAL-CONVERSION-TEST" }),
    });
    assert.equal(subscriptionActivation.status, 201);
    const activation = await api(`/api/admin/organizations/${organizationId}/mode`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ mode: "LIVE", confirmation: "ACTIVATE LIVE" }),
    });
    assert.equal(activation.status, 200);
    const changedOrganization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { mode: true, status: true },
    });
    assert.equal(changedOrganization.mode, "LIVE");
    assert.equal(changedOrganization.status, "ACTIVE");
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId, action: "organization.mode_changed" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    const metadata = audit.metadata as { previousMode: string; newMode: string; changedById: string; changedAt: string };
    assert.equal(metadata.previousMode, "TRIAL");
    assert.equal(metadata.newMode, "LIVE");
    assert.equal(metadata.changedById, userId);
    assert.ok(Number.isFinite(Date.parse(metadata.changedAt)));

    await prisma.organization.update({ where: { id: organizationId }, data: { mode: "TRIAL" } });
    await prisma.businessProfile.update({
      where: { organizationId },
      data: { whatsappPhoneNumberId: null },
    });
  } finally {
    integrationEnvKeys.forEach((key, index) => {
      const value = previousIntegrationEnv[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    await prisma.organization.updateMany({ where: { id: organizationId }, data: { mode: "TRIAL", status: "ACTIVE" } });
    await prisma.businessProfile.updateMany({ where: { organizationId }, data: { whatsappPhoneNumberId: null } });
    await prisma.session.deleteMany({ where: { userId: ordinaryUserId } });
    await prisma.organizationMember.deleteMany({ where: { userId: ordinaryUserId } });
    await prisma.user.deleteMany({ where: { id: ordinaryUserId } });
  }
});

test("uses the current database role instead of trusting the role in a signed token", async () => {
  const viewerWrite = await api("/api/business-profile", {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify({ businessName: "Should be denied" }),
  });
  assert.equal(viewerWrite.status, 403);

  await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { role: "ADMIN" },
  });
  const elevatedWrite = await api("/api/business-profile", {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify({ businessName: "Authorized Test Workspace" }),
  });
  assert.equal(elevatedWrite.status, 200);
});

test("prevents cross-tenant reads and immediately invalidates suspended and revoked access", async () => {
  const foreignContact = await prisma.contact.create({
    data: { organizationId: foreignOrganizationId, name: "Foreign contact" },
  });
  const crossTenant = await api(`/api/contacts/${foreignContact.id}`, { headers: { Cookie: cookie } });
  assert.equal(crossTenant.status, 404);

  await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { status: "SUSPENDED" },
  });
  const suspended = await api("/api/contacts", { headers: { Cookie: cookie } });
  assert.equal(suspended.status, 401);

  await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { status: "ACTIVE" },
  });
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
  const revoked = await api("/api/contacts", { headers: { Cookie: cookie } });
  assert.equal(revoked.status, 401);
});

test("requires explicit approval before access and switches only to an active membership", async () => {
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: null } });
  await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { status: "ACTIVE", role: "ADMIN" },
  });
  const session = await prisma.session.create({
    data: { userId, organizationId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  cookie = `studio_session=${signAuthToken({ userId, organizationId, role: "ADMIN", sessionId: session.id })}`;

  const requested = await api("/api/access-requests", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ organizationSlug: foreignSlug, organizationId }),
  });
  assert.equal(requested.status, 201);
  const requestPayload = await requested.json() as { request: { id: string } };
  assert.equal(await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: foreignOrganizationId, userId } },
  }), null);

  const approved = await api(`/api/access-requests/admin/${requestPayload.request.id}/approve`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(approved.status, 200);
  const newMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: foreignOrganizationId, userId } },
  });
  assert.equal(newMembership?.status, "ACTIVE");
  assert.equal(newMembership?.role, "AGENT");

  const switched = await api("/api/auth/switch-workspace", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ slug: foreignSlug }),
  });
  assert.equal(switched.status, 200);
  const rotatedCookie = switched.headers.get("set-cookie");
  assert.ok(rotatedCookie?.startsWith("studio_session="));
  assert.match(rotatedCookie ?? "", /HttpOnly/i);
  assert.match(rotatedCookie ?? "", /SameSite=Strict/i);
  const currentCookie = rotatedCookie!.split(";", 1)[0];
  const activeWorkspace = await api("/api/contacts", {
    headers: { Cookie: currentCookie },
  });
  assert.equal(activeWorkspace.status, 200);
  const oldWorkspace = await api("/api/contacts", { headers: { Cookie: cookie } });
  assert.equal(oldWorkspace.status, 401);

  const primarySession = await prisma.session.create({
    data: { userId, organizationId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const primaryCookie = `studio_session=${signAuthToken({ userId, organizationId, role: "OWNER", sessionId: primarySession.id })}`;
  const suspendedWorkspace = await api(`/api/admin/organizations/${organizationId}/suspend`, {
    method: "POST",
    headers: { Cookie: currentCookie },
    body: JSON.stringify({ confirmation: "SUSPEND" }),
  });
  assert.equal(suspendedWorkspace.status, 200);
  const blockedWorkspace = await api("/api/contacts", { headers: { Cookie: primaryCookie } });
  assert.equal(blockedWorkspace.status, 401);
  const restoredWorkspace = await api(`/api/admin/organizations/${organizationId}/restore`, {
    method: "POST",
    headers: { Cookie: currentCookie },
    body: JSON.stringify({ confirmation: "RESTORE" }),
  });
  assert.equal(restoredWorkspace.status, 200);

  const anotherSession = await prisma.session.create({
    data: { userId, organizationId: foreignOrganizationId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const anotherCookie = `studio_session=${signAuthToken({ userId, organizationId: foreignOrganizationId, role: "AGENT", sessionId: anotherSession.id })}`;
  const sessionListResponse = await api("/api/auth/sessions", { headers: { Cookie: currentCookie } });
  assert.equal(sessionListResponse.status, 200);
  const sessionList = await sessionListResponse.json() as { sessions: { id: string }[] };
  assert.ok(sessionList.sessions.some((item) => item.id === anotherSession.id));
  const revokedSession = await api(`/api/auth/sessions/${anotherSession.id}/revoke`, {
    method: "POST",
    headers: { Cookie: currentCookie },
  });
  assert.equal(revokedSession.status, 200);
  const revokedSessionRequest = await api("/api/contacts", { headers: { Cookie: anotherCookie } });
  assert.equal(revokedSessionRequest.status, 401);

  const activation = await api(`/api/admin/organizations/${foreignOrganizationId}/subscription`, {
    method: "POST",
    headers: { Cookie: currentCookie },
    body: JSON.stringify({ confirmation: "ACTIVATE", plan: "SIX_MONTHS", paymentReference: "TEST-REFERENCE" }),
  });
  assert.equal(activation.status, 201);
  const activeSubscription = await api("/api/subscription", { headers: { Cookie: currentCookie } });
  assert.equal(activeSubscription.status, 200);
  assert.equal((await activeSubscription.json() as { hasPaidAccess: boolean }).hasPaidAccess, true);

  const logoutAll = await api("/api/auth/logout-all", { method: "POST", headers: { Cookie: currentCookie } });
  assert.equal(logoutAll.status, 204);
  const loggedOutRequest = await api("/api/contacts", { headers: { Cookie: cookie } });
  assert.equal(loggedOutRequest.status, 401);
});

test("locks a user account after repeated failed password attempts", async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: `security-${suffix}@example.test`, password: "incorrect-password" }),
    });
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 401);
  const locked = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  assert.equal(locked?.failedLoginAttempts, 0);
  assert.ok(locked?.lockedUntil && locked.lockedUntil.getTime() > Date.now());
});
