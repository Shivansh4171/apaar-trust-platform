-- CreateEnum
CREATE TYPE "DiscrepancyField" AS ENUM ('REFERENCE', 'FULL_NAME', 'PROGRAM');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewActor" AS ENUM ('STUDENT_DEMO', 'INSTITUTION_DEMO');

-- CreateEnum
CREATE TYPE "ReviewEventAction" AS ENUM ('SUBMITTED', 'REVIEW_UPDATED');

-- CreateTable
CREATE TABLE "StudentConfirmation" (
    "id" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscrepancyReport" (
    "id" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "field" "DiscrepancyField" NOT NULL,
    "institutionValue" VARCHAR(120) NOT NULL,
    "claimedValue" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" VARCHAR(1000),
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscrepancyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscrepancyReportEvent" (
    "id" TEXT NOT NULL,
    "discrepancyReportId" TEXT NOT NULL,
    "actor" "ReviewActor" NOT NULL,
    "action" "ReviewEventAction" NOT NULL,
    "fromStatus" "DiscrepancyStatus",
    "toStatus" "DiscrepancyStatus" NOT NULL,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscrepancyReportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentConfirmation_studentRecordId_createdAt_idx" ON "StudentConfirmation"("studentRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscrepancyReport_studentRecordId_status_idx" ON "DiscrepancyReport"("studentRecordId", "status");

-- CreateIndex
CREATE INDEX "DiscrepancyReport_status_createdAt_idx" ON "DiscrepancyReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DiscrepancyReportEvent_discrepancyReportId_createdAt_idx" ON "DiscrepancyReportEvent"("discrepancyReportId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentConfirmation" ADD CONSTRAINT "StudentConfirmation_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "StudentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyReport" ADD CONSTRAINT "DiscrepancyReport_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "StudentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyReportEvent" ADD CONSTRAINT "DiscrepancyReportEvent_discrepancyReportId_fkey" FOREIGN KEY ("discrepancyReportId") REFERENCES "DiscrepancyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
