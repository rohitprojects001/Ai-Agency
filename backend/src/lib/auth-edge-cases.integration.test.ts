import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { app } from "../server";
import { prisma } from "./prisma";

const suffix = randomUUID();
const existingEmail = `existing-${suffix}@example.test`;
const registrationEmail = `new-${suffix}@example.test`;
const raceEmail = `race-${suffix}@example.test`;
const lockedEmail = `locked-${suffix}@example.test`;
const progressiveEmail = `progressive-${suffix}@example.test`;
const rateLimitEmail = `limited-${suffix}@example.test`;
const testEmails = [existingEmail, registrationEmail, raceEmail, lockedEmail, progressiveEmail];
let baseUrl: string;
let testServer: ReturnType<typeof app.listen>;
let authOrigin: string;
let originalResendApiKey: string | undefined;
let originalResendFromEmail: string | undefined;
let ipSequence = 1;

before(async () => {
  app.set("trust proxy", 1);
  originalResendApiKey = process.env.RESEND_API_KEY;
  originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  await prisma.user.create({
    data: {
      email: existingEmail,
      name: "Existing User",
      passwordHash: await bcrypt.hash("Fixture-password-strong", 12),
    },
  });
  await prisma.user.create({
    data: {
      email: lockedEmail,
      name: "Locked User",
      passwordHash: await bcrypt.hash("Fixture-password-strong", 12),
      lockedUntil: new Date(Date.now() + 5 * 60 * 1000),
      loginLockoutLevel: 1,
    },
  });
  await prisma.user.create({
    data: {
      email: progressiveEmail,
      name: "Progressive Lock User",
      passwordHash: await bcrypt.hash("Fixture-password-strong", 12),
      failedLoginAttempts: 9,
    },
  });

  authOrigin = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim();
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
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `auth-edge-${suffix}` } } });
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
  if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendApiKey;
  if (originalResendFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
  await prisma.$disconnect();
});

function nextIp() {
  return `198.51.100.${ipSequence++}`;
}

async function api(path: string, body: unknown, ip = nextIp()) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: authOrigin,
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
}

function registrationBody(email: string, businessName: string) {
  return {
    name: "Registration Test",
    email,
    password: "Fixture-password-strong",
    businessName: `Auth Edge ${suffix} ${businessName}`,
  };
}

test("registration creates a workspace immediately without email verification", async () => {
  const existing = await api("/api/auth/register", registrationBody(existingEmail, "Existing"));
  const fresh = await api("/api/auth/register", registrationBody(registrationEmail, "Fresh"));
  assert.equal(existing.status, 202);
  assert.equal(fresh.status, 201);
  const existingBody = await existing.json() as { message: string };
  const freshBody = await fresh.json() as { user: { email: string }; organization: { name: string }; role: string };
  assert.match(existingBody.message, /next steps/);
  assert.equal(freshBody.user.email, registrationEmail);
  assert.equal(freshBody.role, "OWNER");

  const created = await prisma.user.findUnique({ where: { email: registrationEmail } });
  assert.ok(created);
  assert.equal(created.emailVerifiedAt, null);
});

test("registration handles a concurrent duplicate-email P2002 as an accepted request", async () => {
  const [first, second] = await Promise.all([
    api("/api/auth/register", registrationBody(raceEmail, "Race One")),
    api("/api/auth/register", registrationBody(raceEmail, "Race Two")),
  ]);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(await prisma.user.count({ where: { email: raceEmail } }), 1);
});

test("locked accounts return the same generic 401 for valid and invalid passwords", async () => {
  const valid = await api("/api/auth/login", { email: lockedEmail, password: "Fixture-password-strong" });
  const invalid = await api("/api/auth/login", { email: lockedEmail, password: "wrong-password" });
  assert.equal(valid.status, 401);
  assert.equal(invalid.status, 401);
  assert.deepEqual(await valid.json(), await invalid.json());

  const missing = await api("/api/auth/login", { email: `missing-${suffix}@example.test`, password: "wrong-password" });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "Invalid email or password" });
});

test("login lockout duration grows after repeated lockouts", async () => {
  const firstLock = await api("/api/auth/login", { email: progressiveEmail, password: "wrong-password" });
  assert.equal(firstLock.status, 401);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: progressiveEmail },
    select: { failedLoginAttempts: true, loginLockoutLevel: true, lockedUntil: true },
  });
  assert.equal(user.loginLockoutLevel, 1);
  assert.equal(user.failedLoginAttempts, 0);
  assert.ok(user.lockedUntil && user.lockedUntil.getTime() - Date.now() > 14 * 60 * 1000);

  await prisma.user.update({
    where: { email: progressiveEmail },
    data: { failedLoginAttempts: 9, lockedUntil: new Date(Date.now() - 1000) },
  });
  const secondLock = await api("/api/auth/login", { email: progressiveEmail, password: "wrong-password" });
  assert.equal(secondLock.status, 401);
  const secondUser = await prisma.user.findUniqueOrThrow({
    where: { email: progressiveEmail },
    select: { loginLockoutLevel: true, lockedUntil: true },
  });
  assert.equal(secondUser.loginLockoutLevel, 2);
  assert.ok(secondUser.lockedUntil && secondUser.lockedUntil.getTime() - Date.now() > 29 * 60 * 1000);
});

test("login attempts are limited by email as well as by IP", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await api("/api/auth/login", { email: rateLimitEmail, password: "wrong-password" });
    assert.equal(response.status, 401);
  }
  const emailLimited = await api("/api/auth/login", { email: rateLimitEmail, password: "wrong-password" });
  assert.equal(emailLimited.status, 429);

  const ip = nextIp();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await api("/api/auth/login", {
      email: `ip-${attempt}-${suffix}@example.test`,
      password: "wrong-password",
    }, ip);
    assert.equal(response.status, 401);
  }
  const ipLimited = await api("/api/auth/login", {
    email: `ip-final-${suffix}@example.test`,
    password: "wrong-password",
  }, ip);
  assert.equal(ipLimited.status, 429);
});
