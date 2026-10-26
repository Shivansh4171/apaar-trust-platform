import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateApprovedIntake,
  evaluateStoredRecordQuality,
  evaluateSubmissionMatches,
  qualityRulePolicy,
  validateStudentValues,
  type QualityCandidate,
} from "../../apps/api/src/services/data-quality.js";

const goodValues = { reference: "SYNTH-DQ-1", fullName: "Asha Example", program: "Civil Engineering" };

function record(overrides: Partial<QualityCandidate> = {}): QualityCandidate {
  return { institutionId: "institution-a", recordId: "record-1", ...goodValues, ...overrides };
}

test("required-field checks accept valid values without mutating the source", () => {
  const values = { ...goodValues };
  const before = structuredClone(values);
  const result = validateStudentValues(values, { institutionId: "institution-a", reference: values.reference, rowNumber: 2 });

  assert.deepEqual(result.findings, []);
  assert.equal(result.parsed?.fullName, values.fullName);
  assert.deepEqual(values, before);
});

test("required-field checks explain missing and malformed values with affected row and trigger values", () => {
  const result = validateStudentValues(
    { reference: "BAD REF", fullName: "", program: "Civil Engineering" },
    { institutionId: "institution-a", reference: "BAD REF", rowNumber: 7 },
  );

  assert.equal(result.parsed, null);
  assert.deepEqual(result.findings.map((finding) => finding.ruleId).sort(), ["REQUIRED_FIELD_MALFORMED", "REQUIRED_FIELD_MISSING"]);
  assert.ok(result.findings.every((finding) => finding.severity === "ERROR" && finding.decisionState === "ADVISORY"));
  assert.ok(result.findings.every((finding) => finding.affected.rowNumber === 7));
  assert.ok(result.findings.some((finding) => finding.triggerValues.field === "reference" && finding.triggerValues.submittedValue === "BAD REF"));
  assert.ok(result.findings.some((finding) => finding.triggerValues.field === "fullName" && finding.triggerValues.submittedValue === null));
});

test("duplicate institution references are flagged, but matching names with different references are not identities", () => {
  const incoming = [
    record({ recordId: undefined, rowNumber: 2, reference: "synth-DQ-1" }),
    record({ recordId: undefined, rowNumber: 3, reference: "SYNTH-DQ-2" }),
  ];
  const existing = [record({ recordId: "record-existing" })];
  const findings = evaluateSubmissionMatches(incoming, existing);

  assert.equal(findings.filter((finding) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE").length, 1);
  assert.equal(findings.some((finding) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE"), false);
  assert.equal(findings[0]?.affected.rowNumber, 2);
  assert.equal(findings[0]?.matched?.recordId, "record-existing");
});

test("same reference with different profile values is a possible inconsistency, not a decision", () => {
  const incoming = [record({ recordId: undefined, rowNumber: 4, fullName: "Asha Other", program: "Physics" })];
  const existing = [record({ recordId: "record-existing" })];
  const findings = evaluateSubmissionMatches(incoming, existing);
  const conflict = findings.find((finding) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE");

  assert.ok(findings.some((finding) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE"));
  assert.ok(conflict);
  assert.equal(conflict.category, "POSSIBLE_INCONSISTENCY");
  assert.equal(conflict.severity, "MEDIUM");
  assert.equal(conflict.decisionState, "ADVISORY");
  assert.equal(conflict.triggerValues.fullName, "Asha Other");
  assert.equal(conflict.triggerValues.matchedFullName, "Asha Example");
  assert.equal(conflict.triggerValues.conflictingFields, "fullName, program");
  assert.ok(conflict.recommendedNextStep.length > 0);
});

test("stored-record evaluation is deterministic, institution-scoped, and does not mutate records", () => {
  const rows = [
    record({ recordId: "stored-a", reference: "SYNTH-SAME", fullName: "Asha Example" }),
    record({ recordId: "stored-b", reference: "synth-same", fullName: "Asha Changed" }),
    record({ institutionId: "institution-b", recordId: "stored-c", reference: "SYNTH-SAME", fullName: "Asha Other" }),
  ];
  const before = structuredClone(rows);
  const first = evaluateStoredRecordQuality(rows);
  const second = evaluateStoredRecordQuality(rows);

  assert.deepEqual(first, second);
  assert.equal(first.filter((finding) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE").length, 2);
  assert.equal(first.filter((finding) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE").length, 2);
  assert.equal(rows.filter((row) => row.institutionId === "institution-b").length, 1);
  assert.deepEqual(rows, before);
});

test("approved-intake checks remain inactive without an approved source and flag only actual overages", () => {
  assert.equal(qualityRulePolicy.approvedIntakeAvailable, false);
  const enrolled = Array.from({ length: 21 }, (_, index) => record({ recordId: `intake-record-${index}`, reference: `SYNTH-INTAKE-${index}` }));
  assert.deepEqual(evaluateApprovedIntake(enrolled, undefined), []);
  assert.deepEqual(evaluateApprovedIntake(enrolled.slice(0, 20), { limit: 20, sourceReference: "approved-plan-1" }), []);
  assert.deepEqual(evaluateApprovedIntake(enrolled, { limit: 20, sourceReference: "" }), []);
  const findings = evaluateApprovedIntake(enrolled, { limit: 20, sourceReference: "approved-plan-1" });
  assert.equal(findings.length, 21);
  assert.equal(findings[0]?.ruleId, "APPROVED_INTAKE_EXCEEDED");
  assert.equal(findings[0]?.triggerValues.approvedIntake, 20);
  assert.equal(findings[0]?.triggerValues.reportedEnrollment, 21);
  assert.ok(findings.every((finding) => finding.affected.recordId?.startsWith("intake-record-")));
});
