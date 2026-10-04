CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "users"
ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "organizations"
ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "sessions"
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT;
