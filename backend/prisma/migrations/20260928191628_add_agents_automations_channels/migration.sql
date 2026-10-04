-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('LEAD_CREATED', 'MESSAGE_RECEIVED', 'APPOINTMENT_BOOKED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "outboundEmail" TEXT,
ADD COLUMN     "twilioPhoneNumber" TEXT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "providerMessageId" TEXT;

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" "AutomationTrigger" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agents_organizationId_idx" ON "agents"("organizationId");

-- CreateIndex
CREATE INDEX "automation_workflows_organizationId_trigger_isActive_idx" ON "automation_workflows"("organizationId", "trigger", "isActive");

-- CreateIndex
CREATE INDEX "automation_runs_organizationId_startedAt_idx" ON "automation_runs"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_runs_workflowId_startedAt_idx" ON "automation_runs"("workflowId", "startedAt");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
