import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrganizationFeature } from "../middleware/requireAuth";

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);
appointmentsRouter.use(requireOrganizationFeature("CRM"));

// GET /api/appointments - upcoming first, for the calendar/list view.
// These are created by the AI orchestrator's book_appointment tool, or
// manually later once a booking UI exists.
appointmentsRouter.get("/", asyncHandler(async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { contact: true },
    orderBy: { scheduledAt: "asc" },
  });
  res.json({ appointments });
}));
