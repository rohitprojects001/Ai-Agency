import { Prisma } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { automationWorkflowSchema } from "../lib/automation-schema";
import { prisma } from "../lib/prisma";
import { requireActiveSubscription, requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";

export const automationsRouter = Router();
automationsRouter.use(requireAuth);
automationsRouter.use(requireOrganizationFeature("AUTOMATIONS"));
automationsRouter.use(requireActiveSubscription);

automationsRouter.get("/runs", asyncHandler(async (req, res) => {
  const runs = await prisma.automationRun.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { workflow: { select: { id: true, name: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  res.json({ runs });
}));

automationsRouter.get("/", asyncHandler(async (req, res) => {
  const workflows = await prisma.automationWorkflow.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { _count: { select: { runs: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ workflows });
}));

automationsRouter.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const parsed = automationWorkflowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  const { conditions, actions, ...fields } = parsed.data;
  const workflow = await prisma.automationWorkflow.create({
    data: {
      ...fields,
      organizationId: req.auth!.organizationId,
      conditions: conditions as Prisma.InputJsonValue | undefined,
      actions: actions as Prisma.InputJsonValue,
    },
  });
  res.status(201).json({ workflow });
}));

automationsRouter.get("/:id/runs", asyncHandler(async (req, res) => {
  const workflow = await prisma.automationWorkflow.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });
  const runs = await prisma.automationRun.findMany({
    where: { workflowId: workflow.id, organizationId: req.auth!.organizationId },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  res.json({ runs });
}));

automationsRouter.patch("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const parsed = automationWorkflowSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "At least one field is required" });
  const existing = await prisma.automationWorkflow.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) return res.status(404).json({ error: "Workflow not found" });
  const { conditions, actions, ...fields } = parsed.data;
  const workflow = await prisma.automationWorkflow.update({
    where: { id: existing.id },
    data: {
      ...fields,
      ...(conditions !== undefined ? { conditions: conditions as Prisma.InputJsonValue } : {}),
      ...(actions !== undefined ? { actions: actions as Prisma.InputJsonValue } : {}),
    },
  });
  res.json({ workflow });
}));

automationsRouter.delete("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const existing = await prisma.automationWorkflow.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) return res.status(404).json({ error: "Workflow not found" });
  await prisma.automationWorkflow.delete({ where: { id: existing.id } });
  res.status(204).send();
}));