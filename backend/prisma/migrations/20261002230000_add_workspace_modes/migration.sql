CREATE TYPE "OrganizationMode" AS ENUM ('TRIAL', 'LIVE');

ALTER TABLE "organizations"
ADD COLUMN "mode" "OrganizationMode" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN "trialStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "trialSettings" JSONB;

UPDATE "organizations"
SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days',
    "trialSettings" = '{"trialDurationDays":14,"maxWhatsAppDemoMessages":100,"maxSmsDemoMessages":100,"maxEmailDemoMessages":50,"maxVoiceDemoMessages":30,"maxUsers":3,"enabledFeatures":["CRM","AI","AUTOMATIONS","MESSAGING","VOICE"]}'::jsonb;
