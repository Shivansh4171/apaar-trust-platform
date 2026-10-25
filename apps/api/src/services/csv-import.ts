import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

export const MAX_CSV_ROWS = 500;

export interface StudentCsvRow {
  reference: string;
  fullName: string;
  program: string;
  rowNumber: number;
}

export interface ExistingStudentRecord {
  reference: string;
  fullName: string;
  program: string;
}

export interface CsvImportTransaction {
  findPotentialDuplicates(rows: StudentCsvRow[]): Promise<ExistingStudentRecord[]>;
  insert(rows: StudentCsvRow[]): Promise<void>;
}

export interface CsvImportRepository {
  withTransaction<T>(institutionId: string, operation: (transaction: CsvImportTransaction) => Promise<T>): Promise<T>;
}

export interface CsvImportReport {
  totalRows: number;
  acceptedRows: Array<{ rowNumber: number; reference: string }>;
  rejectedRows: Array<{ rowNumber: number; reference: string | null; reasons: string[] }>;
  flaggedForReviewRows: Array<{
    rowNumber: number;
    reference: string;
    reasons: string[];
    possibleMatches: string[];
  }>;
}

interface ParsedCsvRecord {
  record: string[];
  info: { lines: number };
}

const csvStudentSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(2, "Reference must contain at least 2 characters.")
    .max(40, "Reference must contain at most 40 characters.")
    .regex(/^SYNTH-[A-Za-z0-9][A-Za-z0-9_-]*$/i, "Synthetic references must start with SYNTH- and contain only letters, numbers, hyphens, or underscores."),
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must contain at least 2 characters.")
    .max(120, "Full name must contain at most 120 characters.")
    .regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, "Full name contains unsupported characters."),
  program: z
    .string()
    .trim()
    .min(2, "Program must contain at least 2 characters.")
    .max(120, "Program must contain at most 120 characters.")
    .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .&'+()/,-]*$/u, "Program contains unsupported characters."),
});

export class CsvImportInputError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly report: CsvImportReport,
  ) {
    super(message);
    this.name = "CsvImportInputError";
  }
}

export class CsvImportDatabaseError extends Error {
  constructor(readonly report: CsvImportReport, cause: unknown) {
    super("The CSV import transaction failed.", { cause });
    this.name = "CsvImportDatabaseError";
  }
}

function emptyReport(totalRows = 0): CsvImportReport {
  return { totalRows, acceptedRows: [], rejectedRows: [], flaggedForReviewRows: [] };
}

function inputError(message: string, reason: string, statusCode = 400, rowNumber = 1, totalRows = 0): CsvImportInputError {
  const report = emptyReport(totalRows);
  report.rejectedRows.push({ rowNumber, reference: null, reasons: [reason] });
  return new CsvImportInputError(message, statusCode, report);
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function duplicateReason(existing: ExistingStudentRecord, incoming: StudentCsvRow): string | null {
  if (normalize(existing.reference) === normalize(incoming.reference)) {
    return `Possible duplicate of existing reference ${existing.reference}; flagged for review and not imported.`;
  }
  if (normalize(existing.fullName) === normalize(incoming.fullName) && normalize(existing.program) === normalize(incoming.program)) {
    return `Possible duplicate of ${existing.fullName} in ${existing.program}; flagged for review and not imported.`;
  }
  return null;
}

export async function importStudentCsv(
  buffer: Buffer,
  institutionId: string,
  repository: CsvImportRepository,
): Promise<CsvImportReport> {
  let records: ParsedCsvRecord[];
  try {
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    records = parseCsv(csv, {
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false,
    }) as unknown as ParsedCsvRecord[];
  } catch (error) {
    const line = error instanceof Error && "lines" in error && typeof error.lines === "number" ? error.lines : 1;
    throw inputError("The CSV file could not be parsed.", "Check UTF-8 encoding, quoting, and CSV delimiters.", 400, line);
  }

  if (records.length === 0) {
    throw inputError("The CSV file is empty.", "A header row is required.");
  }

  const header = records[0].record.map((value) => value.trim());
  const requiredHeaders = ["reference", "fullName", "program"];
  const headerIssues: string[] = [];
  const headerCounts = new Map<string, number>();
  for (const column of header) headerCounts.set(column, (headerCounts.get(column) ?? 0) + 1);

  for (const required of requiredHeaders) {
    if (!header.includes(required)) headerIssues.push(`Missing required column: ${required}.`);
  }
  for (const [column, count] of headerCounts) {
    if (count > 1) headerIssues.push(`Column ${column || "(blank)"} appears more than once.`);
    if (column && !requiredHeaders.includes(column)) headerIssues.push(`Unexpected column: ${column}.`);
  }
  if (header.some((column) => !column)) headerIssues.push("Column names must not be blank.");

  if (headerIssues.length > 0) {
    const report = emptyReport(records.length - 1);
    report.rejectedRows.push({ rowNumber: 1, reference: null, reasons: headerIssues });
    throw new CsvImportInputError("The CSV headers are invalid.", 400, report);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_CSV_ROWS) {
    throw inputError(
      `The CSV exceeds the ${MAX_CSV_ROWS}-row limit; no rows were imported.`,
      `Maximum ${MAX_CSV_ROWS} data rows per file.`,
      413,
      dataRecords[MAX_CSV_ROWS].info.lines,
      dataRecords.length,
    );
  }

  const columnIndex = new Map(header.map((column, index) => [column, index]));
  const report = emptyReport(dataRecords.length);
  const validRows: StudentCsvRow[] = [];

  for (const { record, info } of dataRecords) {
    if (record.length !== header.length) {
      report.rejectedRows.push({
        rowNumber: info.lines,
        reference: record[columnIndex.get("reference") ?? 0]?.trim() || null,
        reasons: [`Expected ${header.length} fields but found ${record.length}.`],
      });
      continue;
    }

    const result = csvStudentSchema.safeParse({
      reference: record[columnIndex.get("reference") ?? 0],
      fullName: record[columnIndex.get("fullName") ?? 1],
      program: record[columnIndex.get("program") ?? 2],
    });

    if (!result.success) {
      report.rejectedRows.push({
        rowNumber: info.lines,
        reference: record[columnIndex.get("reference") ?? 0]?.trim() || null,
        reasons: result.error.issues.map((issue) => issue.message),
      });
      continue;
    }

    validRows.push({ ...result.data, rowNumber: info.lines });
  }

  if (validRows.length === 0) return report;

  const internalReasons = new Map<number, Set<string>>();
  for (let left = 0; left < validRows.length; left += 1) {
    for (let right = left + 1; right < validRows.length; right += 1) {
      const first = validRows[left];
      const second = validRows[right];
      const sameReference = normalize(first.reference) === normalize(second.reference);
      const sameStudentAndProgram = normalize(first.fullName) === normalize(second.fullName)
        && normalize(first.program) === normalize(second.program);
      if (!sameReference && !sameStudentAndProgram) continue;

      const reason = `Possible duplicate within this upload (rows ${first.rowNumber} and ${second.rowNumber}); both rows are flagged for review and not imported.`;
      for (const row of [first, second]) {
        const reasons = internalReasons.get(row.rowNumber) ?? new Set<string>();
        reasons.add(reason);
        internalReasons.set(row.rowNumber, reasons);
      }
    }
  }

  try {
    await repository.withTransaction(institutionId, async (transaction) => {
      const existingRecords = await transaction.findPotentialDuplicates(validRows);
      const acceptedRows: StudentCsvRow[] = [];

      for (const row of validRows) {
        const reasons = [...(internalReasons.get(row.rowNumber) ?? [])];
        const possibleMatches = new Set<string>();
        for (const existing of existingRecords) {
          const reason = duplicateReason(existing, row);
          if (reason) {
            reasons.push(reason);
            possibleMatches.add(existing.reference);
          }
        }

        if (reasons.length > 0) {
          report.flaggedForReviewRows.push({
            rowNumber: row.rowNumber,
            reference: row.reference,
            reasons: [...new Set(reasons)],
            possibleMatches: [...possibleMatches],
          });
        } else {
          acceptedRows.push(row);
        }
      }

      if (acceptedRows.length > 0) await transaction.insert(acceptedRows);
      report.acceptedRows = acceptedRows.map(({ rowNumber, reference }) => ({ rowNumber, reference }));
    });
  } catch (cause) {
    const failedReport = emptyReport(dataRecords.length);
    failedReport.rejectedRows = [...report.rejectedRows];
    failedReport.rejectedRows.push(...validRows.map((row) => ({
      rowNumber: row.rowNumber,
      reference: row.reference,
      reasons: ["Database transaction failed; the import outcome could not be confirmed. Check the record list before retrying."],
    })));
    throw new CsvImportDatabaseError(failedReport, cause);
  }

  return report;
}
