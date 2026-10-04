import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";

export const subscriptionRouter = Router();
subscriptionRouter.use(requireAuth);

subscriptionRouter.get("/", asyncHandler(async (req, res) => {
  const now = new Date();
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { plan: true, status: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "desc" },
  });
  return res.json({ subscription, hasPaidAccess: Boolean(subscription) });
}));
