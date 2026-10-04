CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');
CREATE TYPE "AuthChallengePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

ALTER TABLE "users"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "users"
ALTER COLUMN "emailVerifiedAt" DROP NOT NULL,
ALTER COLUMN "emailVerifiedAt" DROP DEFAULT;

ALTER TABLE "organization_members"
ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_requests_organizationId_userId_key" ON "access_requests"("organizationId", "userId");
CREATE INDEX "access_requests_organizationId_status_createdAt_idx" ON "access_requests"("organizationId", "status", "createdAt");
CREATE INDEX "sessions_userId_revokedAt_expiresAt_idx" ON "sessions"("userId", "revokedAt", "expiresAt");
CREATE INDEX "sessions_organizationId_userId_idx" ON "sessions"("organizationId", "userId");
CREATE UNIQUE INDEX "auth_challenges_tokenHash_key" ON "auth_challenges"("tokenHash");
CREATE INDEX "auth_challenges_userId_purpose_expiresAt_idx" ON "auth_challenges"("userId", "purpose", "expiresAt");

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_requests"
ADD CONSTRAINT "access_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "access_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_challenges"
ADD CONSTRAINT "auth_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
