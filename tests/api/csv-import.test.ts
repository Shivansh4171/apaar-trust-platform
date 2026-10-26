import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CsvImportDatabaseError,
  CsvImportInputError,
  importStudentCsv,
  type CsvImportRepository,
  type ExistingStudentRecord,
  type StudentCsvRow,
} from "../../apps/api/src/services/csv-import.js";

function repository(existingRecords: ExistingStudentRecord[] = [], insertError?: Error) {
  const inserted: StudentCsvRow[] = [];
  const value: CsvImportRepository = {
    withTransaction: async (_institutionId, operation) => operation({
      findPotentialDuplicates: async (rows) => existingRecords.filter((existing) => rows.some((row) =>
        existing.reference.normalize("NFKC").trim().toLowerCase() === row.reference.normalize("NFKC").trim().toLowerCase(),
      )),
      insert: async (rows) => {
        if (insertError) throw insertError;
        inserted.push(...rows);
      },
    }),
  };
  return { value, inserted };
}

function csv(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

test("valid CSV rows are inserted and included in the accepted report", async () => {
  const fake = repository();
  const report = await importStudentCsv(
    csv("reference,fullName,program\nSYNTH-NEW-1,Anaya Example,Computer Engineering\n"),
    "institution-a",
    fake.value,
  );

  assert.deepEqual(report.acceptedRows, [{ rowNumber: 2, reference: "SYNTH-NEW-1" }]);
  assert.deepEqual(report.rejectedRows, []);
  assert.deepEqual(report.flaggedForReviewRows, []);
  assert.deepEqual(report.findings, []);
  assert.equal(fake.inserted.length, 1);
});

test("missing required columns return a row-one header report", async () => {
  const fake = repository();

  await assert.rejects(
    importStudentCsv(csv("reference,program\nSYNTH-MISSING,Electrical Engineering\n"), "institution-a", fake.value),
    (error: unknown) => {
      assert.ok(error instanceof CsvImportInputError);
      assert.equal(error.report.rejectedRows[0]?.rowNumber, 1);
      assert.match(error.report.rejectedRows[0]?.reasons.join(" ") ?? "", /fullName/);
      assert.ok(error.report.findings.some((finding) => finding.ruleId === "REQUIRED_FIELD_MISSING" && finding.triggerValues.field === "fullName"));
      return true;
    },
  );
  assert.equal(fake.inserted.length, 0);
});

test("malformed fields are rejected with row numbers and readable reasons", async () => {
  const fake = repository();
  const report = await importStudentCsv(
    csv("reference,fullName,program\nBAD REF,Student 7,\n"),
    "institution-a",
    fake.value,
  );

  assert.equal(report.rejectedRows.length, 1);
  assert.equal(report.rejectedRows[0]?.rowNumber, 2);
  assert.equal(report.rejectedRows[0]?.reference, "BAD REF");
  assert.match(report.rejectedRows[0]?.reasons.join(" ") ?? "", /Reference|Full name|Program/);
  assert.ok(report.findings.some((finding) => finding.ruleId === "REQUIRED_FIELD_MALFORMED" && finding.triggerValues.field === "reference"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "REQUIRED_FIELD_MISSING" && finding.triggerValues.field === "program"));
  assert.equal(fake.inserted.length, 0);
});

test("duplicate references are flagged while matching names with different references remain separate", async () => {
  const fake = repository([
    { reference: "SYNTH-OLD-1", fullName: "Sam Existing", program: "Chemistry" },
  ]);
  const report = await importStudentCsv(
    csv([
      "reference,fullName,program",
      "SYNTH-NEW-1,Aria Review,Computer Science",
      "SYNTH-NEW-2,Aria Review,Computer Science",
      "SYNTH-OLD-1,Another Student,Mathematics",
      "SYNTH-OTHER-1,Sam Existing,Chemistry",
    ].join("\n")),
    "institution-a",
    fake.value,
  );

  assert.deepEqual(report.acceptedRows, [
    { rowNumber: 2, reference: "SYNTH-NEW-1" },
    { rowNumber: 3, reference: "SYNTH-NEW-2" },
    { rowNumber: 5, reference: "SYNTH-OTHER-1" },
  ]);
  assert.equal(report.flaggedForReviewRows.length, 1);
  assert.deepEqual(report.flaggedForReviewRows[0]?.possibleMatches, ["SYNTH-OLD-1"]);
  assert.ok(report.findings.some((finding) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE" && finding.affected.rowNumber === 4));
  assert.ok(report.findings.some((finding) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE" && finding.affected.rowNumber === 4));
  assert.equal(fake.inserted.length, 3);
});

test("same reference with changed imported details produces a separate inconsistency finding", async () => {
  const fake = repository([{ reference: "SYNTH-OLD-1", fullName: "Sam Existing", program: "Chemistry" }]);
  const report = await importStudentCsv(
    csv("reference,fullName,program\nSYNTH-OLD-1,Sam Updated,Physics\n"),
    "institution-a",
    fake.value,
  );

  assert.equal(report.acceptedRows.length, 0);
  assert.equal(report.flaggedForReviewRows.length, 1);
  assert.ok(report.findings.some((finding) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE"));
  const conflict = report.findings.find((finding) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE");
  assert.equal(conflict?.category, "POSSIBLE_INCONSISTENCY");
  assert.equal(conflict?.triggerValues.fullName, "Sam Updated");
  assert.equal(conflict?.triggerValues.matchedFullName, "Sam Existing");
  assert.equal(fake.inserted.length, 0);
});

test("same name and program on different references are not treated as duplicate identities", async () => {
  const fake = repository([{ reference: "SYNTH-OLD-1", fullName: "Sam Existing", program: "Chemistry" }]);
  const report = await importStudentCsv(
    csv("reference,fullName,program\nSYNTH-NEW-2,Sam Existing,Chemistry\n"),
    "institution-a",
    fake.value,
  );

  assert.equal(report.acceptedRows.length, 1);
  assert.deepEqual(report.findings, []);
});

test("database write errors are propagated so the API can report a failed import", async () => {
  const fake = repository([], new Error("Database unavailable"));

  await assert.rejects(
    importStudentCsv(csv("reference,fullName,program\nSYNTH-ERR-1,Retry Example,Physics\n"), "institution-a", fake.value),
    (error: unknown) => {
      assert.ok(error instanceof CsvImportDatabaseError);
      assert.match(error.report.rejectedRows[0]?.reasons.join(" ") ?? "", /outcome could not be confirmed/);
      assert.equal(error.report.rejectedRows[0]?.rowNumber, 2);
      return true;
    },
  );
  assert.equal(fake.inserted.length, 0);
});

test("uploads over the row limit are rejected before any database transaction", async () => {
  const fake = repository();
  const lines = ["reference,fullName,program"];
  for (let index = 0; index <= 500; index += 1) {
    lines.push(`SYNTH-LIMIT-${index},Sample Student,Sample Program`);
  }

  await assert.rejects(
    importStudentCsv(csv(lines.join("\n")), "institution-a", fake.value),
    (error: unknown) => error instanceof CsvImportInputError && error.statusCode === 413,
  );
  assert.equal(fake.inserted.length, 0);
});
