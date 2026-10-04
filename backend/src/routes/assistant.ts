import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { runChatTurn, type ChatMessage } from "../lib/openai";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature } from "../middleware/requireAuth";
import { getOrganizationRuntime } from "../services/organization-runtime";

export const assistantRouter = Router();
assistantRouter.use(requireAuth);
assistantRouter.use(requireOrganizationFeature("AI"));

const miraRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Mira has reached the hourly message limit. Please try again later." },
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const requestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(messageSchema).max(12).default([]),
  view: z.string().max(80).optional(),
  context: z.object({
    contacts: z.number().int().nonnegative(),
    leads: z.number().int().nonnegative(),
    newLeads: z.number().int().nonnegative(),
    openConversations: z.number().int().nonnegative(),
    appointments: z.number().int().nonnegative(),
    products: z.number().int().nonnegative(),
  }),
});

function hasConfiguredOpenAiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  return Boolean(key && key.length > 20 && !/\.{3}|your[_ -]?api[_ -]?key|replace/i.test(key));
}

async function askLocalMira(prompt: string) {
  const endpoint = process.env.OLLAMA_URL ?? "http://localhost:11434/api/generate";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
      prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("response" in payload) || typeof payload.response !== "string") {
    throw new Error("Ollama returned an invalid response");
  }
  return payload.response.trim();
}

assistantRouter.post("/chat", miraRateLimit, asyncHandler(async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send a message and valid dashboard context." });

  const organization = await prisma.organization.findUnique({
    where: { id: req.auth!.organizationId },
    include: { businessProfile: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found" });
  const runtime = await getOrganizationRuntime(req.auth!.organizationId);

  const { message, history, context, view } = parsed.data;
  const businessName = organization.businessProfile?.businessName ?? organization.name;
  const systemContent = [
    `You are Mira, the calm and practical AI business advisor inside ${businessName}'s dashboard.`,
    "Give concise, specific advice grounded in the dashboard snapshot. Never invent metrics.",
    "Prioritize one or two actions the owner can take today. If data is missing, say so.",
    "Be warm but direct. Use short paragraphs or bullets. Do not mention being an API or system.",
    `Current dashboard view: ${view ?? "overview"}.`,
    `Dashboard snapshot: ${JSON.stringify(context)}.`,
    `Business category: ${organization.businessProfile?.category ?? "not configured"}.`,
    `Business instructions: ${organization.businessProfile?.aiInstructions ?? "none provided"}.`,
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: message },
  ];

  if (runtime.mode === "TRIAL") {
    const result = await runChatTurn(messages, undefined, runtime.mode);
    return res.json({ reply: result.content });
  }

  if (hasConfiguredOpenAiKey()) {
    if (!process.env.OLLAMA_URL) {
      return res.status(503).json({ error: "AI is not configured for this Live workspace. Configure a real AI provider before using the advisor." });
    }

    try {
      const result = await runChatTurn(messages);
      if (result.content) return res.json({ reply: result.content });
      throw new Error("OpenAI returned an empty response");
    } catch (error) {
      console.error("Mira OpenAI request failed; trying local Ollama", error);
    }
  }

  try {
    const prompt = [
      `SYSTEM: ${systemContent}`,
      ...history.map((item) => `${item.role.toUpperCase()}: ${item.content}`),
      `USER: ${message}`,
    ].join("\n\n");
    const reply = await askLocalMira(`${prompt}\n\nASSISTANT:`);
    if (reply) return res.json({ reply });
    throw new Error("Ollama returned an empty response");
  } catch (error) {
    console.error("Mira local Ollama request failed", error);
    return res.status(503).json({
      error: "The configured Live AI provider is unavailable. Check its backend configuration and try again.",
    });
  }
}));
