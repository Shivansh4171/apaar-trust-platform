import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyStudentConfirmationSchema,
  reviewerUpdateSchema,
  studentDiscrepancyInputSchema,
  validateClaimedValue,
  valueForField,
} from "../../apps/api/src/services/student-review.js";

test("empty confirmation payload is accepted without a student identity claim", () => {
  assert.equal(emptyStudentConfirmationSchema.safeParse({}).success, true);
  assert.equal(emptyStudentConfirmationSchema.safeParse({ studentId: "SYNTH-0001" }).success, false);
});

test("valid discrepancy details satisfy server-side length and field rules", () => {
  const result = studentDiscrepancyInputSchema.safeParse({
    field: "FULL_NAME",
    claimedValue: "Aarav Demo",
    reason: "The synthetic demo name differs from my example details.",
  });
  assert.equal(result.success, true);
  assert.equal(validateClaimedValue("FULL_NAME", "Aarav Demo").success, true);
});

test("short reasons, extra identity fields, and invalid claim formats are rejected", () => {
  assert.equal(studentDiscrepancyInputSchema.safeParse({
    field: "PROGRAM",
    claimedValue: "Physics",
    reason: "Wrong",
  }).success, false);
  assert.equal(studentDiscrepancyInputSchema.safeParse({
    field: "PROGRAM",
    claimedValue: "Physics",
    reason: "This synthetic program claim is incorrect.",
    studentId: "SYNTH-001",
  }).success, false);
  assert.equal(validateClaimedValue("REFERENCE", "REAL-APAAR-123").success, false);
  assert.equal(validateClaimedValue("FULL_NAME", "Student 7").success, false);
});

test("institution-reported field snapshots are selected without changing the source record", () => {
  const record = { reference: "SYNTH-123", fullName: "Aarav Sample", program: "Computer Engineering" };
  assert.equal(valueForField(record, "FULL_NAME"), "Aarav Sample");
  assert.equal(valueForField(record, "REFERENCE"), "SYNTH-123");
  assert.equal(record.fullName, "Aarav Sample");
});

test("review updates require a bounded note and only allow review or resolution statuses", () => {
  assert.equal(reviewerUpdateSchema.safeParse({ status: "UNDER_REVIEW", resolutionNote: "Started the demo review." }).success, true);
  assert.equal(reviewerUpdateSchema.safeParse({ status: "OPEN", resolutionNote: "Reopened this report." }).success, false);
  assert.equal(reviewerUpdateSchema.safeParse({ status: "RESOLVED", resolutionNote: "No" }).success, false);
});
