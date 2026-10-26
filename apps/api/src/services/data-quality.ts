import { z } from "zod";

export const studentRecordValuesSchema = z.object({
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

export type StudentRecordValues = z.infer<typeof studentRecordValuesSchema>;
export type QualitySeverity = "ERROR" | "HIGH" | "MEDIUM";
export type QualityCategory = "DATA_QUALITY_ERROR" | "POSSIBLE_DUPLICATE" | "POSSIBLE_INCONSISTENCY";
export type QualityRuleId =
  | "REQUIRED_FIELD_MISSING"
  | "REQUIRED_FIELD_MALFORMED"
  | "CSV_ROW_STRUCTURE_INVALID"
  | "DUPLICATE_INSTITUTION_REFERENCE"
  | "CONFLICTING_DETAILS_FOR_REFERENCE"
  | "APPROVED_INTAKE_EXCEEDED";

export type QualityCandidate = {
  institutionId: string;
  reference: string;
  fullName: string;
  program: string;
  recordId?: string;
  rowNumber?: number;
};

export type QualityFinding = {
  id: string;
  ruleId: QualityRuleId;
  title: string;
  category: QualityCategory;
  severity: QualitySeverity;
  decisionState: "ADVISORY";
  affected: { recordId?: string; rowNumber?: number; reference?: string; institutionId?: string; program?: string };
  matched?: { recordId?: string; rowNumber?: number; reference: string };
  triggerValues: Record<string, string | number | null>;
  explanation: string;
  recommendedNextStep: string;
};

type FindingLocation = Pick<QualityCandidate, "institutionId" | "reference" | "recordId" | "rowNumber">
  & Partial<Pick<QualityCandidate, "program">>;

const ruleDefinitions: Record<QualityRuleId, { title: string; category: QualityCategory; severity: QualitySeverity; next: string }> = {
  REQUIRED_FIELD_MISSING: {
    title: "Required student field is missing",
    category: "DATA_QUALITY_ERROR",
    severity: "ERROR",
    next: "Supply the required value from the institution's source record, then validate the row again.",
  },
  REQUIRED_FIELD_MALFORMED: {
    title: "Required student field is malformed",
    category: "DATA_QUALITY_ERROR",
    severity: "ERROR",
    next: "Correct the field format using the institution's source record, then validate the row again.",
  },
  CSV_ROW_STRUCTURE_INVALID: {
    title: "CSV row has an invalid structure",
    category: "DATA_QUALITY_ERROR",
    severity: "ERROR",
    next: "Align this row with the required CSV columns and validate the file again.",
  },
  DUPLICATE_INSTITUTION_REFERENCE: {
    title: "Institution reference appears more than once",
    category: "POSSIBLE_DUPLICATE",
    severity: "HIGH",
    next: "Check the institution's source register and confirm which row, if any, should be submitted. No record was merged.",
  },
  CONFLICTING_DETAILS_FOR_REFERENCE: {
    title: "Details conflict for the same institution reference",
    category: "POSSIBLE_INCONSISTENCY",
    severity: "MEDIUM",
    next: "Compare the two values with the institution's source documents and resolve through the authorized correction workflow if needed.",
  },
  APPROVED_INTAKE_EXCEEDED: {
    title: "Reported enrolment exceeds approved intake",
    category: "POSSIBLE_INCONSISTENCY",
    severity: "MEDIUM",
    next: "Confirm the approved intake source and enrolment count with the institution before taking action.",
  },
};

export const qualityRulePolicy = {
  severityCriteria: {
    ERROR: "A required value or row structure is invalid; an import row is rejected.",
    HIGH: "An institution-scoped reference is repeated; incoming rows are held for review until the source register is checked.",
    MEDIUM: "Values linked by the same institution-scoped reference differ, or a provided intake limit is exceeded; this is an advisory review signal.",
  },
  approvedIntakeAvailable: false,
  approvedIntakeUnavailableReason: "The current schema has no approved-intake source, so the application does not run this check.",
} as const;

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function locationKey(location: FindingLocation): string {
  if (location.recordId) return `record:${location.recordId}`;
  if (location.rowNumber !== undefined) return `row:${location.rowNumber}`;
  return `reference:${location.institutionId}:${normalize(location.reference)}`;
}

function locationDto(location: FindingLocation) {
  return {
    ...(location.recordId ? { recordId: location.recordId } : {}),
    ...(location.rowNumber !== undefined ? { rowNumber: location.rowNumber } : {}),
    ...(location.reference ? { reference: location.reference } : {}),
    ...(location.institutionId ? { institutionId: location.institutionId } : {}),
    ...(location.program ? { program: location.program } : {}),
  };
}

function finding(
  ruleId: QualityRuleId,
  affected: FindingLocation,
  triggerValues: Record<string, string | number | null>,
  explanation: string,
  matched?: FindingLocation,
): QualityFinding {
  const definition = ruleDefinitions[ruleId];
  return {
    id: [ruleId, locationKey(affected), matched ? locationKey(matched) : ""].join(":"),
    ruleId,
    title: definition.title,
    category: definition.category,
    severity: definition.severity,
    decisionState: "ADVISORY",
    affected: locationDto(affected),
    ...(matched ? { matched: { ...locationDto(matched), reference: matched.reference } } : {}),
    triggerValues,
    explanation,
    recommendedNextStep: definition.next,
  };
}

function rawValue(value: unknown): string | null {
  if (typeof value !== "string") return value == null ? null : String(value);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateStudentValues(
  values: unknown,
  location: FindingLocation,
): { parsed: StudentRecordValues | null; findings: QualityFinding[]; validationMessages: string[] } {
  const result = studentRecordValuesSchema.safeParse(values);
  if (result.success) return { parsed: result.data, findings: [], validationMessages: [] };

  const input = values && typeof values === "object" ? values as Record<string, unknown> : {};
  const issuesByField = new Map<string, string[]>();
  for (const issue of result.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "row";
    const messages = issuesByField.get(field) ?? [];
    messages.push(issue.message);
    issuesByField.set(field, messages);
  }

  const findings = [...issuesByField].map(([field, messages]) => {
    const value = rawValue(input[field]);
    const ruleId: QualityRuleId = value === null ? "REQUIRED_FIELD_MISSING" : "REQUIRED_FIELD_MALFORMED";
    const explanation = value === null
      ? `Required field ${field} has no value.`
      : `Required field ${field} has a value that does not meet the accepted format: ${messages.join(" ")}`;
    return finding(ruleId, location, { field, submittedValue: value }, explanation);
  });

  return { parsed: null, findings, validationMessages: result.error.issues.map((issue) => issue.message) };
}

export function missingCsvColumnFinding(field: string, rowNumber = 1): QualityFinding {
  return finding(
    "REQUIRED_FIELD_MISSING",
    { institutionId: "", reference: "", rowNumber },
    { field, submittedValue: null },
    `Required CSV column ${field} is missing from the header row.`,
  );
}

export function invalidCsvRowStructureFinding(
  rowNumber: number,
  reference: string | null,
  expectedFields: number,
  foundFields: number,
): QualityFinding {
  return finding(
    "CSV_ROW_STRUCTURE_INVALID",
    { institutionId: "", reference: reference ?? "", rowNumber },
    { expectedFields, foundFields, reference },
    `CSV row ${rowNumber} contains ${foundFields} fields; ${expectedFields} are required.`,
  );
}

function pairFindings(
  candidates: QualityCandidate[],
  shouldReport: (candidate: QualityCandidate) => boolean,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const first = candidates[left];
      const second = candidates[right];
      if (first.institutionId !== second.institutionId || normalize(first.reference) !== normalize(second.reference)) continue;

      const fullNameDiffers = normalize(first.fullName) !== normalize(second.fullName);
      const programDiffers = normalize(first.program) !== normalize(second.program);
      for (const [subject, matched] of [[first, second], [second, first]] as const) {
        if (!shouldReport(subject)) continue;
        findings.push(finding(
          "DUPLICATE_INSTITUTION_REFERENCE",
          subject,
          { reference: subject.reference, matchedReference: matched.reference },
          `Possible duplicate institution reference ${subject.reference}; check the institution source register before submission.`,
          matched,
        ));
        if (fullNameDiffers || programDiffers) {
          findings.push(finding(
            "CONFLICTING_DETAILS_FOR_REFERENCE",
            subject,
            {
              reference: subject.reference,
              fullName: subject.fullName,
              matchedFullName: matched.fullName,
              program: subject.program,
              matchedProgram: matched.program,
              conflictingFields: [ ...(fullNameDiffers ? ["fullName"] : []), ...(programDiffers ? ["program"] : []) ].join(", "),
            },
            `Values linked by institution reference ${subject.reference} differ. This is a possible inconsistency, not a reviewer decision.`,
            matched,
          ));
        }
      }
    }
  }
  return findings;
}

function sortFindings(findings: QualityFinding[]): QualityFinding[] {
  return findings.sort((a, b) =>
    (a.affected.reference ?? "").localeCompare(b.affected.reference ?? "")
      || (a.affected.rowNumber ?? 0) - (b.affected.rowNumber ?? 0)
      || a.ruleId.localeCompare(b.ruleId)
      || a.id.localeCompare(b.id),
  );
}

export function evaluateSubmissionMatches(
  incoming: QualityCandidate[],
  existing: QualityCandidate[],
): QualityFinding[] {
  const incomingKeys = new Set(incoming.map(locationKey));
  return sortFindings(pairFindings([...incoming, ...existing], (candidate) => incomingKeys.has(locationKey(candidate))));
}

export function evaluateStoredRecordQuality(records: QualityCandidate[]): QualityFinding[] {
  const fieldFindings = records.flatMap((record) => validateStudentValues(record, record).findings);
  const pairResults = pairFindings(records, () => true);
  return sortFindings([...fieldFindings, ...pairResults]);
}

export function evaluateApprovedIntake(
  records: QualityCandidate[],
  approvedIntake?: { limit: number; sourceReference: string } | null,
): QualityFinding[] {
  if (!approvedIntake || !approvedIntake.sourceReference.trim() || !Number.isInteger(approvedIntake.limit) || approvedIntake.limit < 0) return [];
  if (records.length <= approvedIntake.limit) return [];
  return records.map((record) => finding(
    "APPROVED_INTAKE_EXCEEDED",
    record,
    { reportedEnrollment: records.length, approvedIntake: approvedIntake.limit, sourceReference: approvedIntake.sourceReference },
    `Reported enrolment ${records.length} exceeds approved intake ${approvedIntake.limit} for ${record.program}.`,
  ));
}
