CREATE TYPE "SubscriptionPlan" AS ENUM ('MONTHLY', 'SIX_MONTHS', 'SEVEN_MONTHS', 'LEGACY');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELED');

CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscriptions_organizationId_status_startsAt_endsAt_idx"
ON "subscriptions"("organizationId", "status", "startsAt", "endsAt");

ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "subscriptions_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "subscriptions" ("id", "organizationId", "plan", "status", "startsAt", "updatedAt")
SELECT 'legacy_' || "id", "id", 'LEGACY', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations";
