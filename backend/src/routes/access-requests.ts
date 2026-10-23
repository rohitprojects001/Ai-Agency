import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, requireSuperAdmin } from "../middleware/requireAuth";
import { parseTrialSettings } from "../services/organization-runtime";

export const accessRequestsRouter = Router();
const organizationAdmin = requireRole("OWNER", "ADMIN");

accessRequestsRouter.use(requireAuth);

accessRequestsRouter.get("/", asyncHandler(async (req, res) => {
  const requests = await prisma.accessRequest.findMany({
    where: { userId: req.auth!.userId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      organization: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ requests });
}));

accessRequestsRouter.post("/", asyncHandler(async (req, res) => {
  const slug = typeof req.body?.organizationSlug === "string" ? req.body.organizationSlug.trim() : "";
  if (!slug || slug.length > 120) return res.status(400).json({ error: "A valid workspace slug is required." });

  const organization = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: organization.id, userId: req.auth!.userId } },
    select: { status: true },
  });
  if (membership?.status === "ACTIVE") return res.status(409).json({ error: "You already have access to this workspace." });
  if (membership?.status === "SUSPENDED") return res.status(403).json({ error: "Your access to this workspace is suspended. Contact its administrator." });

  const request = await prisma.accessRequest.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: req.auth!.userId } },
    create: { organizationId: organization.id, userId: req.auth!.userId },
    update: { status: "PENDING", reviewedAt: null, reviewedById: null },
    select: { id: true, status: true, createdAt: true },
  });
  await prisma.auditLog.create({
    data: { organizationId: organization.id, userId: req.auth!.userId, action: "access_request.submitted" },
  });
  return res.status(201).json({ request });
}));

accessRequestsRouter.get("/organization/:slug", organizationAdmin, asyncHandler(async (req, res) => {
  const organization = await prisma.organization.findFirst({
    where: { id: req.auth!.organizationId, slug: req.params.slug },
    select: { id: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });

  const requests = await prisma.accessRequest.findMany({
    where: { organizationId: organization.id, status: "PENDING" },
    select: {
      id: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ requests });
}));

async function decideRequest(input: {
  requestId: string;
  organizationId: string;
  reviewerId: string;
  approve: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const accessRequest = await tx.accessRequest.findFirst({
      where: { id: input.requestId, organizationId: input.organizationId, status: "PENDING" },
      include: { user: { select: { id: true } } },
    });
    if (!accessRequest) return false;
    if (input.approve) {
      const organization = await tx.organization.findUnique({
        where: { id: input.organizationId },
        select: { mode: true, trialSettings: true },
      });
      if (!organization) return false;
      if (organization.mode === "TRIAL") {
        const memberCount = await tx.organizationMember.count({
          where: { organizationId: input.organizationId, status: "ACTIVE" },
        });
        if (memberCount >= parseTrialSettings(organization.trialSettings).maxUsers) return "trial_limit" as const;
      }
    }

    const updated = await tx.accessRequest.updateMany({
      where: { id: accessRequest.id, status: "PENDING" },
      data: {
        status: input.approve ? "APPROVED" : "DENIED",
        reviewedAt: new Date(),
        reviewedById: input.reviewerId,
      },
    });
    if (updated.count !== 1) return false;

    if (input.approve) {
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: accessRequest.userId } },
        create: { organizationId: input.organizationId, userId: accessRequest.userId, role: "AGENT", status: "ACTIVE" },
        update: { role: "AGENT", status: "ACTIVE" },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.reviewerId,
        action: input.approve ? "access_request.approved" : "access_request.denied",
        metadata: { accessRequestId: accessRequest.id, requestedUserId: accessRequest.userId },
      },
    });
    return true;
  });
}

accessRequestsRouter.post("/organization/:slug/:requestId/:decision", organizationAdmin, asyncHandler(async (req, res) => {
  const { slug, requestId, decision } = req.params;
  if (decision !== "approve" && decision !== "deny") return res.status(404).json({ error: "Not found." });
  const organization = await prisma.organization.findFirst({
    where: { id: req.auth!.organizationId, slug },
    select: { id: true },
  });
  if (!organization) return res.status(404).json({ error: "Workspace not found." });
  const result = await decideRequest({
    requestId,
    organizationId: organization.id,
    reviewerId: req.auth!.userId,
    approve: decision === "approve",
  });
  if (result === "trial_limit") return res.status(409).json({ error: "The workspace trial user limit has been reached." });
  if (!result) return res.status(409).json({ error: "This pending request was not found or has already been reviewed." });
  return res.json({ message: decision === "approve" ? "Workspace access approved." : "Workspace access denied." });
}));

accessRequestsRouter.get("/admin/pending", requireSuperAdmin, asyncHandler(async (_req, res) => {
  const requests = await prisma.accessRequest.findMany({
    where: { status: "PENDING" },
    select: {
      id: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ requests });
}));

accessRequestsRouter.post("/admin/:requestId/:decision", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { requestId, decision } = req.params;
  if (decision !== "approve" && decision !== "deny") return res.status(404).json({ error: "Not found." });
  const accessRequest = await prisma.accessRequest.findFirst({
    where: { id: requestId, status: "PENDING" },
    select: { organizationId: true },
  });
  if (!accessRequest) return res.status(409).json({ error: "This pending request was not found or has already been reviewed." });
  const result = await decideRequest({
    requestId,
    organizationId: accessRequest.organizationId,
    reviewerId: req.auth!.userId,
    approve: decision === "approve",
  });
  if (result === "trial_limit") return res.status(409).json({ error: "The workspace trial user limit has been reached." });
  if (!result) return res.status(409).json({ error: "This pending request was already reviewed." });
  return res.json({ message: decision === "approve" ? "Workspace access approved." : "Workspace access denied." });
}));
