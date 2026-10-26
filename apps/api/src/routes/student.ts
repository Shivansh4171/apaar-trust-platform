import { Router } from "express";
import { DiscrepancyStatus, PrismaClient, ReviewActor, ReviewEventAction } from "../generated/prisma/client.js";
import { z } from "zod";
import { authenticatedUser, requireAuthentication, requireRoles } from "../auth.js";
import {
  emptyStudentConfirmationSchema,
  studentDiscrepancyInputSchema,
  studentRecordIdSchema,
  validateClaimedValue,
  valueForField,
} from "../services/student-review.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const prototypeStatus = {
  authentication: "synthetic_demo_account",
  officialApaarVerification: false,
  missingStudentResponseIsNotFraudEvidence: true,
} as const;

function invalidInput(response: { status: (code: number) => typeof response; json: (body: unknown) => void }, message: string) {
  response.status(400).json({ error: "invalid_input", message, prototype: prototypeStatus });
}

export function createStudentRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuthentication(prisma), requireRoles("STUDENT"));

  router.get("/records", async (request, response) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: "invalid_pagination", message: "Page must be positive and pageSize must be between 1 and 50.", prototype: prototypeStatus });
      return;
    }

    const { page, pageSize } = parsedQuery.data;
    const user = authenticatedUser(request);
    if (!user.studentRecordId) {
      response.status(403).json({ error: "student_record_not_linked", message: "This student account has no linked synthetic record." });
      return;
    }
    try {
      const [records, totalRecords] = await prisma.$transaction([
        prisma.studentRecord.findMany({
          where: { id: user.studentRecordId, synthetic: true },
          orderBy: [{ createdAt: "desc" }, { reference: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, reference: true, fullName: true, program: true, status: true, createdAt: true },
        }),
        prisma.studentRecord.count({ where: { id: user.studentRecordId, synthetic: true } }),
      ]);

      response.json({
        records,
        pagination: { page, pageSize, totalRecords, totalPages: Math.ceil(totalRecords / pageSize) },
        prototype: prototypeStatus,
      });
    } catch {
      response.status(503).json({ error: "records_unavailable", message: "Demo student records are temporarily unavailable.", prototype: prototypeStatus });
    }
  });

  router.post("/records/:recordId/confirm", async (request, response) => {
    const parsedId = studentRecordIdSchema.safeParse(request.params.recordId);
    const parsedBody = emptyStudentConfirmationSchema.safeParse(request.body ?? {});
    if (!parsedId.success || !parsedBody.success) {
      invalidInput(response, "Select a demo record and submit an empty confirmation request.");
      return;
    }
    const user = authenticatedUser(request);
    if (parsedId.data !== user.studentRecordId) {
      response.status(404).json({ error: "demo_record_not_found", message: "The linked synthetic record was not found.", prototype: prototypeStatus });
      return;
    }

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const record = await transaction.studentRecord.findFirst({
          where: { id: parsedId.data, synthetic: true },
          select: { id: true, reference: true },
        });
        if (!record) return null;

        const confirmation = await transaction.studentConfirmation.create({
          data: { studentRecordId: record.id, actorUserId: user.id, synthetic: true },
          select: { id: true, createdAt: true },
        });
        return { record, confirmation };
      });

      if (!result) {
        response.status(404).json({ error: "demo_record_not_found", message: "The selected synthetic record was not found.", prototype: prototypeStatus });
        return;
      }

      response.status(201).json({
        confirmation: { ...result.confirmation, reference: result.record.reference },
        message: "Demo confirmation recorded. It does not verify identity or official APAAR status.",
        prototype: prototypeStatus,
      });
    } catch (error) {
      console.error("Student demo confirmation failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      response.status(503).json({ error: "confirmation_unavailable", message: "The confirmation could not be recorded.", prototype: prototypeStatus });
    }
  });

  router.post("/records/:recordId/discrepancies", async (request, response) => {
    const parsedId = studentRecordIdSchema.safeParse(request.params.recordId);
    const parsedBody = studentDiscrepancyInputSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      invalidInput(response, "Provide a valid affected field, claimed value, and reason (10–1000 characters).");
      return;
    }
    const user = authenticatedUser(request);
    if (parsedId.data !== user.studentRecordId) {
      response.status(404).json({ error: "demo_record_not_found", message: "The linked synthetic record was not found.", prototype: prototypeStatus });
      return;
    }

    const claimedValueCheck = validateClaimedValue(parsedBody.data.field, parsedBody.data.claimedValue);
    if (!claimedValueCheck.success) {
      invalidInput(response, claimedValueCheck.error.issues[0]?.message ?? "The claimed value format is invalid.");
      return;
    }

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const record = await transaction.studentRecord.findFirst({
          where: { id: user.studentRecordId!, synthetic: true },
          select: { id: true, reference: true, fullName: true, program: true },
        });
        if (!record) return { kind: "missing" as const };

        const institutionValue = valueForField(record, parsedBody.data.field);
        if (institutionValue.normalize("NFKC").trim().toLocaleLowerCase("en")
          === claimedValueCheck.data.normalize("NFKC").trim().toLocaleLowerCase("en")) {
          return { kind: "unchanged" as const };
        }

        const duplicate = await transaction.discrepancyReport.findFirst({
          where: {
            studentRecordId: record.id,
            field: parsedBody.data.field,
            institutionValue,
            claimedValue: claimedValueCheck.data,
            reason: parsedBody.data.reason,
            status: { in: [DiscrepancyStatus.OPEN, DiscrepancyStatus.UNDER_REVIEW] },
            synthetic: true,
          },
          select: { id: true },
        });
        if (duplicate) return { kind: "duplicate" as const };

        const report = await transaction.discrepancyReport.create({
          data: {
            studentRecordId: record.id,
            field: parsedBody.data.field,
            institutionValue,
            claimedValue: claimedValueCheck.data,
            reason: parsedBody.data.reason,
            status: DiscrepancyStatus.OPEN,
            synthetic: true,
            history: {
              create: {
                actor: ReviewActor.STUDENT,
                action: ReviewEventAction.SUBMITTED,
                toStatus: DiscrepancyStatus.OPEN,
                note: parsedBody.data.reason,
                actorUserId: user.id,
              },
            },
          },
          select: {
            id: true,
            field: true,
            institutionValue: true,
            claimedValue: true,
            reason: true,
            status: true,
            createdAt: true,
          },
        });
        return { kind: "created" as const, report, reference: record.reference };
      }, { isolationLevel: "Serializable" });

      if (result.kind === "missing") {
        response.status(404).json({ error: "demo_record_not_found", message: "The selected synthetic record was not found.", prototype: prototypeStatus });
        return;
      }
      if (result.kind === "unchanged") {
        response.status(400).json({ error: "no_discrepancy", message: "The claimed value must differ from the institution-reported value.", prototype: prototypeStatus });
        return;
      }
      if (result.kind === "duplicate") {
        response.status(409).json({ error: "duplicate_discrepancy", message: "An open or in-review discrepancy with the same claim and reason already exists.", prototype: prototypeStatus });
        return;
      }

      response.status(201).json({
        report: { ...result.report, reference: result.reference },
        message: "Discrepancy recorded for review. The institution-reported value was preserved.",
        prototype: prototypeStatus,
      });
    } catch (error) {
      console.error("Student demo discrepancy submission failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      response.status(503).json({ error: "discrepancy_unavailable", message: "The discrepancy could not be recorded.", prototype: prototypeStatus });
    }
  });

  return router;
}
