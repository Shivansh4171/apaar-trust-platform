import assert from "node:assert/strict";
import { test } from "node:test";
import { correctionSnapshot, studentRecordCorrectionInputSchema } from "../../apps/api/src/services/student-correction.js";

test("record corrections require a reason and at least one allowed record field", () => {
  assert.equal(studentRecordCorrectionInputSchema.safeParse({ fullName: "Corrected Synthetic Name" }).success, false);
  assert.equal(studentRecordCorrectionInputSchema.safeParse({ reason: "The synthetic source sheet was checked." }).success, false);
  assert.equal(studentRecordCorrectionInputSchema.safeParse({
    status: "VERIFIED",
    fullName: "Corrected Synthetic Name",
    reason: "The synthetic source sheet was checked.",
  }).success, false);
  assert.equal(studentRecordCorrectionInputSchema.safeParse({
    fullName: "1 Invalid Name",
    reason: "The synthetic source sheet was checked.",
  }).success, false);
});

test("valid correction input is normalized and snapshots only changed fields", () => {
  const parsed = studentRecordCorrectionInputSchema.safeParse({
    fullName: "  Corrected Synthetic Name  ",
    program: "Original Synthetic Program",
    reason: "  Checked against the synthetic institution source sheet.  ",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data, {
    fullName: "Corrected Synthetic Name",
    program: "Original Synthetic Program",
    reason: "Checked against the synthetic institution source sheet.",
  });
  assert.deepEqual(correctionSnapshot({
    reference: "SYNTH-123",
    fullName: "Original Synthetic Name",
    program: "Original Synthetic Program",
  }, parsed.data), {
    previousValues: { fullName: "Original Synthetic Name" },
    newValues: { fullName: "Corrected Synthetic Name" },
    update: { fullName: "Corrected Synthetic Name" },
  });
});

test("a submitted value identical to the current value creates no change snapshot", () => {
  const parsed = studentRecordCorrectionInputSchema.safeParse({
    fullName: "Original Synthetic Name",
    reason: "Reviewed the current synthetic source sheet.",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(correctionSnapshot({
    reference: "SYNTH-123",
    fullName: "Original Synthetic Name",
    program: "Original Synthetic Program",
  }, parsed.data), { previousValues: {}, newValues: {}, update: {} });
});
