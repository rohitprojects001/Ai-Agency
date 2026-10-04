import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireActiveSubscription, requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";

export const agentsRouter = Router();
agentsRouter.use(requireAuth);
agentsRouter.use(requireOrganizationFeature("AI"));
agentsRouter.use(requireActiveSubscription);

const agentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().trim().min(1).max(12000),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

agentsRouter.get("/", asyncHandler(async (req, res) => {
  const agents = await prisma.agent.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  res.json({ agents });
}));

agentsRouter.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

  const agent = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.agent.updateMany({ where: { organizationId: req.auth!.organizationId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.agent.create({ data: { ...parsed.data, organizationId: req.auth!.organizationId } });
  });

  res.status(201).json({ agent });
}));

agentsRouter.patch("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const parsed = agentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "At least one field is required" });

  const existing = await prisma.agent.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) return res.status(404).json({ error: "Agent not found" });

  const agent = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.agent.updateMany({ where: { organizationId: req.auth!.organizationId, isDefault: true, id: { not: existing.id } }, data: { isDefault: false } });
    }
    return tx.agent.update({ where: { id: existing.id }, data: parsed.data });
  });

  res.json({ agent });
}));

agentsRouter.delete("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const existing = await prisma.agent.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) return res.status(404).json({ error: "Agent not found" });
  await prisma.agent.delete({ where: { id: existing.id } });
  res.status(204).send();
}));