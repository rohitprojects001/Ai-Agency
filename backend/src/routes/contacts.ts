import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);
contactsRouter.use(requireOrganizationFeature("CRM"));

const createContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// GET /api/contacts
contactsRouter.get("/", asyncHandler(async (req, res) => {
  const contacts = await prisma.contact.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ contacts });
}));

// POST /api/contacts
contactsRouter.post("/", requireRole("OWNER", "ADMIN", "MANAGER", "AGENT"), asyncHandler(async (req, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const contact = await prisma.contact.create({
    data: {
      ...parsed.data,
      organizationId: req.auth!.organizationId,
    },
  });

  res.status(201).json({ contact });
}));

// GET /api/contacts/:id - scoped by organizationId so no cross-tenant reads are possible
contactsRouter.get("/:id", asyncHandler(async (req, res) => {
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    include: { leads: true, conversations: true },
  });

  if (!contact) return res.status(404).json({ error: "Contact not found" });
  res.json({ contact });
}));
