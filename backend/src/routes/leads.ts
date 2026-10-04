import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";
import { runAutomationEvent } from "../services/automation-engine";

export const leadsRouter = Router();
leadsRouter.use(requireAuth);
leadsRouter.use(requireOrganizationFeature("CRM"));

const createLeadSchema = z.object({
  contactId: z.string().min(1),
  source: z.string().optional(),
  value: z.number().int().optional(),
});

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

// GET /api/leads - powers the Kanban pipeline board
leadsRouter.get("/", asyncHandler(async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { contact: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ leads });
}));

// POST /api/leads
leadsRouter.post("/", requireRole("OWNER", "ADMIN", "MANAGER", "AGENT"), asyncHandler(async (req, res) => {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  // Confirm the contact actually belongs to this org before attaching a lead to it.
  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, organizationId: req.auth!.organizationId },
  });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  const lead = await prisma.lead.create({
    data: {
      ...parsed.data,
      organizationId: req.auth!.organizationId,
    },
  });

  await runAutomationEvent({
    organizationId: req.auth!.organizationId,
    contactId: contact.id,
    trigger: "LEAD_CREATED",
    payload: {
      lead: { id: lead.id, status: lead.status, source: lead.source, value: lead.value },
      contact: { name: contact.name, phone: contact.phone, email: contact.email, company: contact.company },
    },
  });

  res.status(201).json({ lead });
}));

// PATCH /api/leads/:id/status - drag-and-drop pipeline moves
leadsRouter.patch("/:id/status", requireRole("OWNER", "ADMIN", "MANAGER", "AGENT"), asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${LEAD_STATUSES.join(", ")}` });
  }

  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { status },
  });

  res.json({ lead: updated });
}));
