CREATE TYPE "UserRole" AS ENUM ('AICTE_ADMIN', 'INSTITUTION_ADMIN', 'INSTITUTION_OPERATOR', 'STUDENT', 'REVIEWER');

ALTER TYPE "ReviewActor" ADD VALUE 'AICTE_ADMIN';
ALTER TYPE "ReviewActor" ADD VALUE 'INSTITUTION_ADMIN';
ALTER TYPE "ReviewActor" ADD VALUE 'INSTITUTION_OPERATOR';
ALTER TYPE "ReviewActor" ADD VALUE 'STUDENT';
ALTER TYPE "ReviewActor" ADD VALUE 'REVIEWER';

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "institutionId" TEXT,
    "studentRecordId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "sid" VARCHAR(255) NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("sid")
);

ALTER TABLE "StudentConfirmation" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "DiscrepancyReportEvent" ADD COLUMN "actorUserId" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_studentRecordId_key" ON "User"("studentRecordId");
CREATE INDEX "User_institutionId_role_idx" ON "User"("institutionId", "role");
CREATE INDEX "AuthSession_expire_idx" ON "AuthSession"("expire");

ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_studentRecordId_fkey"
  FOREIGN KEY ("studentRecordId") REFERENCES "StudentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentConfirmation" ADD CONSTRAINT "StudentConfirmation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscrepancyReportEvent" ADD CONSTRAINT "DiscrepancyReportEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
