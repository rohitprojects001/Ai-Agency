ALTER TABLE "messages"
ADD COLUMN "organizationId" TEXT,
ADD COLUMN "externalMessageId" TEXT;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "messages_organizationId_externalMessageId_key"
ON "messages"("organizationId", "externalMessageId");
