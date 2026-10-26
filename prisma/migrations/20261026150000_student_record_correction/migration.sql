-- Immutable correction events are additive; existing institution-submitted rows remain the current record state.
CREATE TABLE "StudentRecordCorrection" (
    "id" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "previousValues" JSONB NOT NULL,
    "newValues" JSONB NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actorEmail" VARCHAR(254) NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRecordCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentRecordCorrection_studentRecordId_createdAt_idx"
    ON "StudentRecordCorrection"("studentRecordId", "createdAt");

ALTER TABLE "StudentRecordCorrection"
    ADD CONSTRAINT "StudentRecordCorrection_studentRecordId_fkey"
    FOREIGN KEY ("studentRecordId") REFERENCES "StudentRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentRecordCorrection"
    ADD CONSTRAINT "StudentRecordCorrection_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
