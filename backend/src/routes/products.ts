import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature, requireRole } from "../middleware/requireAuth";

export const productsRouter = Router();
productsRouter.use(requireAuth);
productsRouter.use(requireOrganizationFeature("CRM"));

// GET /api/products
productsRouter.get("/", asyncHandler(async (req, res) => {
  const products = await prisma.product.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ products });
}));

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().nonnegative(),
  category: z.string().optional(),
  durationMin: z.number().int().positive().optional(),
});

// POST /api/products
productsRouter.post("/", requireRole("OWNER", "ADMIN", "MANAGER"), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const product = await prisma.product.create({
    data: { ...parsed.data, organizationId: req.auth!.organizationId },
  });
  res.status(201).json({ product });
}));

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

// PATCH /api/products/:id
productsRouter.patch("/:id", requireRole("OWNER", "ADMIN", "MANAGER"), asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const product = await prisma.product.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ product });
}));

// DELETE /api/products/:id
productsRouter.delete("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  await prisma.product.delete({ where: { id: existing.id } });
  res.status(204).send();
}));
