import { parse as parseCsv } from "csv-parse/sync";
import {
  evaluateSubmissionMatches,
  invalidCsvRowStructureFinding,
  missingCsvColumnFinding,
  validateStudentValues,
  type QualityFinding,
} from "./data-quality.js";

export { studentRecordValuesSchema } from "./data-quality.js";

export const MAX_CSV_ROWS = 500;

export interface StudentCsvRow {
  reference: string;
  fullName: string;
  program: string;
  rowNumber: number;
}

export interface ExistingStudentRecord {
  id?: string;
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
  findings: QualityFinding[];
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
  return { totalRows, findings: [], acceptedRows: [], rejectedRows: [], flaggedForReviewRows: [] };
}

function inputError(message: string, reason: string, statusCode = 400, rowNumber = 1, totalRows = 0): CsvImportInputError {
  const report = emptyReport(totalRows);
  report.rejectedRows.push({ rowNumber, reference: null, reasons: [reason] });
  return new CsvImportInputError(message, statusCode, report);
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
    for (const required of requiredHeaders) {
      if (!header.includes(required)) report.findings.push(missingCsvColumnFinding(required));
    }
    if (report.findings.length === 0) {
      report.findings.push(invalidCsvRowStructureFinding(1, null, requiredHeaders.length, header.length));
    }
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
      report.findings.push(invalidCsvRowStructureFinding(
        info.lines,
        record[columnIndex.get("reference") ?? 0]?.trim() || null,
        header.length,
        record.length,
      ));
      continue;
    }

    const rawValues = {
      reference: record[columnIndex.get("reference") ?? 0],
      fullName: record[columnIndex.get("fullName") ?? 1],
      program: record[columnIndex.get("program") ?? 2],
    };
    const location = {
      institutionId,
      rowNumber: info.lines,
      reference: typeof rawValues.reference === "string" ? rawValues.reference.trim() : "",
    };
    const result = validateStudentValues(rawValues, location);

    if (!result.parsed) {
      report.rejectedRows.push({
        rowNumber: info.lines,
        reference: record[columnIndex.get("reference") ?? 0]?.trim() || null,
        reasons: result.validationMessages,
      });
      report.findings.push(...result.findings);
      continue;
    }

    validRows.push({ ...result.parsed, rowNumber: info.lines });
  }

  if (validRows.length === 0) return report;

  try {
    await repository.withTransaction(institutionId, async (transaction) => {
      const existingRecords = await transaction.findPotentialDuplicates(validRows);
      const incomingCandidates = validRows.map((row) => ({ institutionId, ...row }));
      const existingCandidates = existingRecords.map((record) => ({
        institutionId,
        recordId: record.id,
        reference: record.reference,
        fullName: record.fullName,
        program: record.program,
      }));
      const duplicateFindings = evaluateSubmissionMatches(incomingCandidates, existingCandidates);
      report.findings.push(...duplicateFindings);
      const findingsByRow = new Map<number, QualityFinding[]>();
      for (const finding of duplicateFindings) {
        if (finding.affected.rowNumber === undefined) continue;
        const rowFindings = findingsByRow.get(finding.affected.rowNumber) ?? [];
        rowFindings.push(finding);
        findingsByRow.set(finding.affected.rowNumber, rowFindings);
      }
      const acceptedRows: StudentCsvRow[] = [];

      for (const row of validRows) {
        const rowFindings = findingsByRow.get(row.rowNumber) ?? [];
        const reasons = rowFindings.map((finding) => finding.explanation);
        const possibleMatches = new Set(rowFindings.flatMap((finding) => finding.matched?.reference ? [finding.matched.reference] : []));

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
    failedReport.findings = [...report.findings];
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
