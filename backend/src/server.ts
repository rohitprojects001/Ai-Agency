import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { asyncHandler } from "./lib/async-handler";
import { prisma } from "./lib/prisma";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { leadsRouter } from "./routes/leads";
import { conversationsRouter } from "./routes/conversations";
import { appointmentsRouter } from "./routes/appointments";
import { businessProfileRouter } from "./routes/business-profile";
import { productsRouter } from "./routes/products";
import { webhooksRouter } from "./routes/webhooks";
import { agentsRouter } from "./routes/agents";
import { automationsRouter } from "./routes/automations";
import { channelsRouter } from "./routes/channels";
import { telecallingRouter } from "./routes/telecalling";
import { twilioWebhooksRouter } from "./routes/twilio-webhooks";
import { assistantRouter } from "./routes/assistant";
import { salesRouter } from "./routes/sales";
import { accessRequestsRouter } from "./routes/access-requests";
import { adminRouter } from "./routes/admin";
import { subscriptionRouter } from "./routes/subscription";
import { OrganizationRuntimeError } from "./services/organization-runtime";

const app = express();

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
}
if (trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

const configuredCorsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = process.env.NODE_ENV === "production"
  ? configuredCorsOrigins
  : [...new Set([...configuredCorsOrigins, "http://127.0.0.1:3000"])];
if (corsOrigins.length === 0) {
  throw new Error("CORS_ORIGIN must include at least one allowed frontend origin");
}
if (process.env.NODE_ENV === "production") {
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32 || /replace|change[-_ ]?me|example/i.test(jwtSecret)) {
    throw new Error("Set JWT_SECRET to a unique random value of at least 32 characters before production");
  }
  if (corsOrigins.some((origin) => origin === "*" || origin.includes("localhost"))) {
    throw new Error("Set CORS_ORIGIN to your exact production frontend URL(s), not localhost or *");
  }
}

app.use(helmet());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, body) => {
    req.rawBody = Buffer.from(body);
  },
}));
app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ status: "ok", service: "ai-agency-backend" });
});

app.get("/api/health/ready", asyncHandler(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.set("Cache-Control", "no-store").json({ status: "ready", service: "ai-agency-backend" });
}));

app.use("/api/auth", authRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/business-profile", businessProfileRouter);
app.use("/api/products", productsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/automations", automationsRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/telecalling", telecallingRouter);
app.use("/api/webhooks/twilio", twilioWebhooksRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/sales", salesRouter);
app.use("/api/access-requests", accessRequestsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/subscription", subscriptionRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler - so a thrown/rejected error never crashes the
// process or leaks a stack trace to the client.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err instanceof OrganizationRuntimeError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: "Something went wrong on our end" });
});

const port = Number(process.env.PORT) || 4000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`AI Agency backend listening on http://localhost:${port}`);
  });
}

export { app };
