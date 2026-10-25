import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { PrismaClient, RecordStatus } from "../generated/prisma/client.js";
import { z } from "zod";
import {
  CsvImportInputError,
  CsvImportDatabaseError,
  importStudentCsv,
  type CsvImportRepository,
  type CsvImportTransaction,
  type StudentCsvRow,
} from "../services/csv-import.js";

interface InstitutionScope {
  id: string;
  code: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      institutionScope?: InstitutionScope;
    }
  }
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const prototypeAccess = {
  authentication: "not_implemented",
  institutionCodeHeaderIsNotAuthentication: true,
} as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1, fields: 0 },
});

function scopeOf(request: Request): InstitutionScope {
  if (!request.institutionScope) throw new Error("Institution scope middleware was not applied.");
  return request.institutionScope;
}

function institutionScope(prisma: PrismaClient) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const code = request.get("x-institution-code")?.trim();
    if (!code || code.length > 64) {
      response.status(401).json({
        error: "institution_context_required",
        message: "Provide the demo institution code in X-Institution-Code; this header is not authentication.",
        prototype: prototypeAccess,
      });
      return;
    }

    try {
      const institution = await prisma.institution.findUnique({
        where: { code },
        select: { id: true, code: true, name: true },
      });
      if (!institution) {
        response.status(404).json({
          error: "institution_not_found",
          message: "The selected institution was not found.",
          prototype: prototypeAccess,
        });
        return;
      }
      request.institutionScope = institution;
      next();
    } catch {
      response.status(503).json({ error: "database_unavailable", message: "Institution data is temporarily unavailable." });
    }
  };
}

function createCsvImportRepository(prisma: PrismaClient): CsvImportRepository {
  return {
    withTransaction: <T>(institutionId: string, operation: (transaction: CsvImportTransaction) => Promise<T>) =>
      prisma.$transaction(async (transaction) => operation({
        findPotentialDuplicates: async (rows: StudentCsvRow[]) => {
          const references = [...new Set(rows.map((row) => row.reference))];
          const names = [...new Set(rows.map((row) => row.fullName))];
          return transaction.studentRecord.findMany({
            where: {
              institutionId,
              OR: [
                { reference: { in: references, mode: "insensitive" } },
                { fullName: { in: names, mode: "insensitive" } },
              ],
            },
            select: { reference: true, fullName: true, program: true },
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
  router.use(institutionScope(prisma));

  router.get("/records", async (request, response) => {
    const parsedQuery = paginationSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: "invalid_pagination", message: "Page must be positive and pageSize must be between 1 and 100." });
      return;
    }

    const institution = scopeOf(request);
    const { page, pageSize } = parsedQuery.data;
    try {
      const [records, totalRecords] = await prisma.$transaction([
        prisma.studentRecord.findMany({
          where: { institutionId: institution.id },
          orderBy: [{ createdAt: "desc" }, { reference: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, reference: true, fullName: true, program: true, status: true, synthetic: true, createdAt: true },
        }),
        prisma.studentRecord.count({ where: { institutionId: institution.id } }),
      ]);

      response.json({
        institution: { code: institution.code, name: institution.name },
        records,
        pagination: { page, pageSize, totalRecords, totalPages: Math.ceil(totalRecords / pageSize) },
        prototype: prototypeAccess,
      });
    } catch {
      response.status(503).json({ error: "database_unavailable", message: "Student records are temporarily unavailable." });
    }
  });

  router.post("/records/import", upload.single("file"), async (request, response) => {
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "csv_file_required", message: "Choose a CSV file to import.", prototype: prototypeAccess });
      return;
    }
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      const message = "Only .csv files are accepted.";
      response.status(415).json({ error: "csv_file_required", message, ...uploadFailureReport(message), prototype: prototypeAccess });
      return;
    }

    try {
      const report = await importStudentCsv(file.buffer, scopeOf(request).id, createCsvImportRepository(prisma));
      response.status(200).json({ report, counts: counts(report), prototype: prototypeAccess });
    } catch (error) {
      if (error instanceof CsvImportInputError) {
        response.status(error.statusCode).json({
          error: "invalid_csv",
          message: error.message,
          report: error.report,
          counts: counts(error.report),
          prototype: prototypeAccess,
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
          prototype: prototypeAccess,
        });
        return;
      }

      console.error("Student CSV import transaction failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      response.status(503).json({
        error: "import_unavailable",
        message: "The import could not be completed. Check the record list before retrying.",
        prototype: prototypeAccess,
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
    prototype: prototypeAccess,
  });
}
