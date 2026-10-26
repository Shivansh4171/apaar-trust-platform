import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { DiscrepancyStatus, PrismaClient, RecordStatus, ReviewActor, ReviewEventAction } from "../generated/prisma/client.js";
import { authenticatedUser, requireAuthentication, requireRoles, type AuthenticatedUser } from "../auth.js";
import { z } from "zod";
import {
  CsvImportInputError,
  CsvImportDatabaseError,
  importStudentCsv,
  type CsvImportRepository,
  type CsvImportTransaction,
  type StudentCsvRow,
} from "../services/csv-import.js";
import { reviewerUpdateSchema } from "../services/student-review.js";
import { correctionSnapshot, studentRecordCorrectionInputSchema } from "../services/student-correction.js";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const discrepancyListSchema = paginationSchema.extend({
  status: z.nativeEnum(DiscrepancyStatus).optional(),
  institutionId: z.string().trim().min(10).max(32).optional(),
  program: z.string().trim().min(1).max(120).optional(),
});
const discrepancyIdSchema = z.string().min(10).max(32);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1, fields: 0 },
});

function institutionFilter(user: AuthenticatedUser): { institutionId?: string } {
  if (user.role === "AICTE_ADMIN" || user.role === "REVIEWER") return {};
  if (!user.institutionId) throw new Error("Institution account is missing its institution scope.");
  return { institutionId: user.institutionId };
}

function auditActor(user: AuthenticatedUser): ReviewActor {
  switch (user.role) {
    case "AICTE_ADMIN": return ReviewActor.AICTE_ADMIN;
    case "INSTITUTION_ADMIN": return ReviewActor.INSTITUTION_ADMIN;
    case "INSTITUTION_OPERATOR": return ReviewActor.INSTITUTION_OPERATOR;
    case "REVIEWER": return ReviewActor.REVIEWER;
    default: throw new Error("This role cannot review discrepancy reports.");
  }
}

function createCsvImportRepository(prisma: PrismaClient): CsvImportRepository {
  return {
    withTransaction: <T>(institutionId: string, operation: (transaction: CsvImportTransaction) => Promise<T>) =>
      prisma.$transaction(async (transaction) => operation({
        findPotentialDuplicates: async (rows: StudentCsvRow[]) => {
          const references = [...new Set(rows.map((row) => row.reference))];
          return transaction.studentRecord.findMany({
            where: {
              institutionId,
              reference: { in: references, mode: "insensitive" },
            },
            orderBy: [{ reference: "asc" }, { id: "asc" }],
            select: { id: true, reference: true, fullName: true, program: true },
          });
        },
        insert: async (rows: StudentCsvRow[]) => {
          await transaction.studentRecord.createMany({
            data: rows.map(({ reference, fullName, program }) => ({
              institutionId,
              reference,
              fullName,
              program,
              status: RecordStatus.UNVERIFIED,
              synthetic: true,
            })),
          });
        },
      }), { isolationLevel: "Serializable" }),
  };
}

function counts(report: Awaited<ReturnType<typeof importStudentCsv>>) {
  return {
    accepted: report.acceptedRows.length,
    rejected: report.rejectedRows.length,
    flaggedForReview: report.flaggedForReviewRows.length,
  };
}

function uploadFailureReport(reason: string) {
  const report = {
    totalRows: 0,
    acceptedRows: [],
    rejectedRows: [{ rowNumber: 1, reference: null, reasons: [reason] }],
    flaggedForReviewRows: [],
  };
  return { report, counts: { accepted: 0, rejected: 1, flaggedForReview: 0 } };
}

export function createInstitutionRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuthentication(prisma));

  router.get("/records", requireRoles("AICTE_ADMIN", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"), async (request, response) => {
    const parsedQuery = paginationSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: "invalid_pagination", message: "Page must be positive and pageSize must be between 1 and 100." });
      return;
    }

    const user = authenticatedUser(request);
    const scope = institutionFilter(user);
    const { page, pageSize } = parsedQuery.data;
    try {
      const where = { synthetic: true, ...scope };
      const [records, totalRecords] = await prisma.$transaction([
        prisma.studentRecord.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { reference: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, reference: true, fullName: true, program: true, status: true, synthetic: true, createdAt: true, institution: { select: { name: true, code: true } } },
        }),
        prisma.studentRecord.count({ where }),
      ]);

      response.json({
        institution: { code: user.institutionCode, name: user.institutionName },
        records,
        pagination: { page, pageSize, totalRecords, totalPages: Math.ceil(totalRecords / pageSize) },
      });
    } catch {
      response.status(503).json({ error: "database_unavailable", message: "Student records are temporarily unavailable." });
    }
  });

  router.get("/records/:recordId/corrections", requireRoles("AICTE_ADMIN", "REVIEWER", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"), async (request, response) => {
    const parsedId = discrepancyIdSchema.safeParse(request.params.recordId);
    if (!parsedId.success) {
      response.status(400).json({ error: "invalid_record_id", message: "Choose a valid student record." });
      return;
    }

    const user = authenticatedUser(request);
    const scope = institutionFilter(user);
    try {
      const result = await prisma.$transaction(async (transaction) => {
        const record = await transaction.studentRecord.findFirst({
          where: { id: parsedId.data, synthetic: true, ...scope },
          select: { id: true, reference: true },
        });
        if (!record) return null;
        const corrections = await transaction.studentRecordCorrection.findMany({
          where: { studentRecordId: record.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            studentRecordId: true,
            previousValues: true,
            newValues: true,
            reason: true,
            actorEmail: true,
            actorRole: true,
            createdAt: true,
          },
        });
        return { record, corrections };
      });

      if (!result) {
        response.status(404).json({ error: "record_not_found", message: "No student record exists in this institution scope." });
        return;
      }
      response.json(result);
    } catch (error) {
      console.error("Student record correction history failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      response.status(503).json({ error: "correction_history_unavailable", message: "Correction history is temporarily unavailable." });
    }
  });

  router.patch("/records/:recordId/corrections", requireRoles("INSTITUTION_ADMIN"), async (request, response) => {
    const parsedId = discrepancyIdSchema.safeParse(request.params.recordId);
    const parsedBody = studentRecordCorrectionInputSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      response.status(400).json({ error: "invalid_correction", message: "Choose one or more valid record fields and provide a correction reason of 10–1000 characters." });
      return;
    }

    const user = authenticatedUser(request);
    const scope = institutionFilter(user);
    try {
      const result = await prisma.$transaction(async (transaction) => {
        const existing = await transaction.studentRecord.findFirst({
          where: { id: parsedId.data, synthetic: true, ...scope },
          select: { id: true, reference: true, fullName: true, program: true, status: true },
        });
        if (!existing) return { kind: "missing" as const };

        const snapshot = correctionSnapshot(existing, parsedBody.data);
        if (Object.keys(snapshot.update).length === 0) return { kind: "unchanged" as const };

        const updated = await transaction.studentRecord.update({
          where: { id: existing.id },
          data: {
            ...snapshot.update,
            corrections: {
              create: {
                previousValues: snapshot.previousValues,
                newValues: snapshot.newValues,
                reason: parsedBody.data.reason,
                actorEmail: user.email,
                actorRole: user.role,
                actorUserId: user.id,
              },
            },
          },
          select: {
            id: true,
            reference: true,
            fullName: true,
            program: true,
            status: true,
            updatedAt: true,
            corrections: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                id: true,
                studentRecordId: true,
                previousValues: true,
                newValues: true,
                reason: true,
                actorEmail: true,
                actorRole: true,
                createdAt: true,
              },
            },
          },
        });
        return { kind: "updated" as const, record: updated };
      }, { isolationLevel: "Serializable" });

      if (result.kind === "missing") {
        response.status(404).json({ error: "record_not_found", message: "No student record exists in this institution scope." });
        return;
      }
      if (result.kind === "unchanged") {
        response.status(400).json({ error: "correction_unchanged", message: "At least one submitted field must differ from the current institution record." });
        return;
      }
      const { corrections, ...record } = result.record;
      response.json({ record, correction: corrections[0] });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        response.status(409).json({ error: "duplicate_reference", message: "A record with this reference already exists in your institution." });
        return;
      }
      console.error("Student record correction failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      response.status(503).json({ error: "correction_unavailable", message: "The student record correction could not be saved." });
    }
  });

  router.get("/discrepancies", requireRoles("AICTE_ADMIN", "REVIEWER", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"), async (request, response) => {
    const parsedQuery = discrepancyListSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: "invalid_pagination", message: "Invalid discrepancy list filters." });
      return;
    }

    const user = authenticatedUser(request);
    const scope = institutionFilter(user);
    const { page, pageSize, status, institutionId, program } = parsedQuery.data;
    if (scope.institutionId && institutionId && institutionId !== scope.institutionId) {
      response.status(404).json({ error: "institution_not_found", message: "No discrepancy reports match this institution scope." });
      return;
    }
    const selectedInstitutionId = scope.institutionId ?? institutionId;
    const where = {
      synthetic: true,
      ...(status ? { status } : {}),
      studentRecord: { is: { ...scope, ...(selectedInstitutionId ? { institutionId: selectedInstitutionId } : {}), ...(program ? { program } : {}), synthetic: true } },
    };
    try {
      const [reports, totalReports, institutions, programs] = await prisma.$transaction([
        prisma.discrepancyReport.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            studentRecord: { select: { id: true, reference: true, fullName: true, program: true, institution: { select: { id: true, code: true, name: true } } } },
            history: { orderBy: { createdAt: "asc" }, include: { actorUser: { select: { email: true } } } },
          },
        }),
        prisma.discrepancyReport.count({ where }),
        prisma.institution.findMany({
          where: selectedInstitutionId
            ? { id: selectedInstitutionId, students: { some: { synthetic: true } } }
            : { students: { some: { synthetic: true } } },
          orderBy: [{ name: "asc" }, { code: "asc" }],
          select: { id: true, name: true, code: true },
        }),
        prisma.studentRecord.findMany({
          where: { synthetic: true, ...(selectedInstitutionId ? { institutionId: selectedInstitutionId } : {}) },
          distinct: ["program"],
          orderBy: { program: "asc" },
          select: { program: true },
        }),
      ]);

      response.json({
        reports,
        pagination: { page, pageSize, totalReports, totalPages: Math.ceil(totalReports / pageSize) },
        options: { institutions, programs: programs.map((entry) => entry.program) },
        filters: { status: status ?? "ALL", institutionId: selectedInstitutionId ?? "ALL", program: program ?? "ALL" },
      });
    } catch {
      response.status(503).json({ error: "discrepancies_unavailable", message: "Discrepancy reports are temporarily unavailable." });
    }
  });

  router.patch("/discrepancies/:reportId", requireRoles("AICTE_ADMIN", "REVIEWER", "INSTITUTION_ADMIN"), async (request, response) => {
    const parsedId = discrepancyIdSchema.safeParse(request.params.reportId);
    const parsedBody = reviewerUpdateSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      response.status(400).json({ error: "invalid_review_update", message: "Choose UNDER_REVIEW or RESOLVED and provide a 5–1000 character review note." });
      return;
    }

    const user = authenticatedUser(request);
    const scope = institutionFilter(user);
    try {
      const result = await prisma.$transaction(async (transaction) => {
        const existing = await transaction.discrepancyReport.findFirst({
          where: {
            id: parsedId.data,
            synthetic: true,
            studentRecord: { is: { ...scope, synthetic: true } },
          },
          select: { id: true, status: true },
        });
        if (!existing) return { kind: "missing" as const };
        if (existing.status === DiscrepancyStatus.RESOLVED) return { kind: "resolved" as const };

        const report = await transaction.discrepancyReport.update({
          where: { id: existing.id },
          data: {
            status: parsedBody.data.status,
            resolutionNote: parsedBody.data.resolutionNote,
            history: {
              create: {
                actor: auditActor(user),
                actorUserId: user.id,
                action: ReviewEventAction.REVIEW_UPDATED,
                fromStatus: existing.status,
                toStatus: parsedBody.data.status,
                note: parsedBody.data.resolutionNote,
              },
            },
          },
          include: {
            studentRecord: { select: { id: true, reference: true, fullName: true, program: true, institution: { select: { id: true, code: true, name: true } } } },
            history: { orderBy: { createdAt: "asc" }, include: { actorUser: { select: { email: true } } } },
          },
        });
        return { kind: "updated" as const, report };
      });

      if (result.kind === "missing") {
        response.status(404).json({ error: "discrepancy_not_found", message: "No discrepancy report exists in this institution scope." });
        return;
      }
      if (result.kind === "resolved") {
        response.status(409).json({ error: "discrepancy_already_resolved", message: "Resolved reports cannot be changed." });
        return;
      }
      response.json({ report: result.report });
    } catch (error) {
      console.error("Discrepancy review failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      response.status(503).json({ error: "review_unavailable", message: "The discrepancy review could not be saved." });
    }
  });

  router.post("/records/import", requireRoles("INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"), upload.single("file"), async (request, response) => {
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "csv_file_required", message: "Choose a CSV file to import." });
      return;
    }
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      const message = "Only .csv files are accepted.";
      response.status(415).json({ error: "csv_file_required", message, ...uploadFailureReport(message) });
      return;
    }

    try {
      const user = authenticatedUser(request);
      if (!user.institutionId) throw new Error("Institution account is missing its institution scope.");
      const report = await importStudentCsv(file.buffer, user.institutionId, createCsvImportRepository(prisma));
      response.status(200).json({ report, counts: counts(report) });
    } catch (error) {
      if (error instanceof CsvImportInputError) {
        response.status(error.statusCode).json({
          error: "invalid_csv",
          message: error.message,
          report: error.report,
          counts: counts(error.report),
        });
        return;
      }

      if (error instanceof CsvImportDatabaseError) {
        console.error("Student CSV import transaction failed.", {
          errorType: error.cause instanceof Error ? error.cause.name : "UnknownError",
        });
        response.status(503).json({
          error: "import_unavailable",
          message: "The import could not be confirmed. Review the listed rows and check the record list before retrying.",
          report: error.report,
          counts: counts(error.report),
        });
        return;
      }

      console.error("Student CSV import transaction failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      response.status(503).json({
        error: "import_unavailable",
        message: "The import could not be completed. Check the record list before retrying.",
      });
    }
  });

  return router;
}

export function csvUploadErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction) {
  if (!(error instanceof multer.MulterError)) {
    next(error);
    return;
  }

  const tooLarge = error.code === "LIMIT_FILE_SIZE";
  const message = tooLarge ? "CSV files must be 1 MB or smaller." : "Upload one CSV file using the file field.";
  response.status(tooLarge ? 413 : 400).json({
    error: "invalid_upload",
    message,
    ...uploadFailureReport(message),
  });
}
