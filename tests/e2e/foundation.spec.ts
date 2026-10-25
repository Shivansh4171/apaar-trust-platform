import dotenv from "dotenv";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  override: !["test", "production"].includes(process.env.NODE_ENV ?? "development"),
  quiet: true,
});

test("institution dashboard loads and explains prototype limitations", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("APAAR Trust Platform");
  await expect(page.getByRole("heading", { name: "Student records" })).toBeVisible();
  await expect(page.getByText("Synthetic development data")).toBeVisible();
  await expect(page.getByText("Prototype access only.")).toBeVisible();
  await expect(page.getByText("No government integrations are connected.")).toBeVisible();
  await expect(page.getByText("Aarav Sample")).toBeVisible();
});

test("API health endpoint reports service status through the web proxy", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "apaar-api",
  });
});

test("API readiness confirms PostgreSQL connectivity", async ({ request }) => {
  const response = await request.get("/api/health/ready");

  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toMatchObject({
    status: "ready",
    database: "connected",
  });
});

test("institution record listing requires a scoped institution context", async ({ request }) => {
  const unauthorized = await request.get("/api/institution/records");
  expect(unauthorized.status()).toBe(401);

  const response = await request.get("/api/institution/records?page=1&pageSize=2", {
    headers: { "X-Institution-Code": "DEMO-AICTE-001" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.institution.code).toBe("DEMO-AICTE-001");
  expect(body.records.length).toBeLessThanOrEqual(2);
  expect(body.pagination.page).toBe(1);
  expect(body.prototype.institutionCodeHeaderIsNotAuthentication).toBe(true);
});

test("CSV import results display row-level header validation feedback", async ({ page }) => {
  await page.goto("/");
  await page.locator("#csv-file").setInputFiles({
    name: "missing-full-name.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("reference,program\nSYNTH-E2E-1,Computer Engineering\n"),
  });
  await page.getByRole("button", { name: "Upload and review" }).click();

  const report = page.getByRole("region", { name: "CSV import report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Missing required column: fullName.");
  await expect(report).toContainText("Row 1");
});

test("valid synthetic CSV import persists and appears in the institution list", async ({ request }) => {
  const reference = `SYNTH-E2E-${crypto.randomUUID().slice(0, 12)}`;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  let institutionId: string | undefined;
  await database.connect();

  try {
    const institutionResult = await database.query<{ id: string }>(
      'SELECT "id" FROM "Institution" WHERE "code" = $1',
      ["DEMO-AICTE-001"],
    );
    institutionId = institutionResult.rows[0]?.id;
    expect(institutionId).toBeTruthy();

    const response = await request.post("/api/institution/records/import", {
      headers: { "X-Institution-Code": "DEMO-AICTE-001" },
      multipart: {
        file: {
          name: "synthetic-student.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(`reference,fullName,program\n${reference},Avery Synthetic,Computer Engineering\n`),
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.counts.accepted).toBe(1);
    expect(body.report.acceptedRows).toContainEqual({ rowNumber: 2, reference });

    const listing = await request.get("/api/institution/records?page=1&pageSize=100", {
      headers: { "X-Institution-Code": "DEMO-AICTE-001" },
    });
    const listedRecords = await listing.json();
    expect(listedRecords.records.some((record: { reference: string }) => record.reference === reference)).toBe(true);
  } finally {
    if (institutionId) {
      await database.query('DELETE FROM "StudentRecord" WHERE "institutionId" = $1 AND "reference" = $2', [institutionId, reference]);
    }
    await database.end();
  }
});

test("CSV rows matching existing records are held for review and not imported", async ({ request }) => {
  const response = await request.post("/api/institution/records/import", {
    headers: { "X-Institution-Code": "DEMO-AICTE-001" },
    multipart: {
      file: {
        name: "possible-duplicate.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("reference,fullName,program\nSYNTH-2026-001,Aarav Sample,Computer Engineering\n"),
      },
    },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.counts.accepted).toBe(0);
  expect(body.counts.flaggedForReview).toBe(1);
  expect(body.report.flaggedForReviewRows[0].reasons.join(" ")).toContain("flagged for review and not imported");
});

test("student demo can confirm and report a discrepancy, then institution demo reviews it", async ({ page, request }) => {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let confirmationId: string | undefined;
  let discrepancyId: string | undefined;
  let recordId: string | undefined;
  const uniqueReason = `The name in this synthetic example differs from my demo details (${Date.now()}).`;

  try {
    const listResponse = await request.get("/api/student/records?page=1&pageSize=50");
    const list = await listResponse.json();
    const record = list.records.find((item: { reference: string }) => item.reference === "SYNTH-2026-001");
    expect(record).toBeTruthy();
    recordId = record.id as string;

    await page.goto("/");
    await page.getByRole("button", { name: "Student review demo" }).click();
    await page.getByLabel("Select a synthetic demo record").selectOption(recordId);
    const confirmationResponse = page.waitForResponse((response) => response.url().includes("/confirm") && response.request().method() === "POST");
    await page.getByRole("button", { name: "These displayed details look correct" }).click();
    const confirmation = await (await confirmationResponse).json();
    confirmationId = confirmation.confirmation.id as string;
    await expect(page.getByRole("status")).toContainText("does not verify identity");

    await page.getByLabel("Affected field").selectOption("FULL_NAME");
    await page.getByLabel("Your claimed value").fill("Aarav Student");
    await page.getByLabel("Reason for the discrepancy").fill(uniqueReason);
    const discrepancyResponse = page.waitForResponse((response) => response.url().includes("/discrepancies") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Submit discrepancy" }).click();
    const discrepancyResult = await (await discrepancyResponse).json();
    discrepancyId = discrepancyResult.report.id as string;
    expect(discrepancyResult.report.status).toBe("OPEN");
    expect(discrepancyResult.report.institutionValue).toBe("Aarav Sample");
    expect(discrepancyResult.report.claimedValue).toBe("Aarav Student");

    const sourceRecord = await database.query<{ fullName: string }>(
      'SELECT "fullName" FROM "StudentRecord" WHERE "id" = $1',
      [recordId],
    );
    expect(sourceRecord.rows[0]?.fullName).toBe("Aarav Sample");

    await page.getByRole("button", { name: "Discrepancy review" }).click();
    await page.getByLabel("Filter status").selectOption("ALL");
    const discrepancyCard = page.getByRole("article", { name: /SYNTH-2026-001/ }).filter({ hasText: uniqueReason });
    await expect(discrepancyCard).toBeVisible();
    await expect(discrepancyCard).toContainText("Aarav Sample");
    await expect(discrepancyCard).toContainText("Aarav Student");

    await discrepancyCard.getByLabel("Demo reviewer note (5–1000 characters)").fill("Started a synthetic demo review.");
    await discrepancyCard.getByRole("button", { name: "Mark under review" }).click();
    await expect(discrepancyCard).toContainText("under review");

    await discrepancyCard.getByLabel("Demo reviewer note (5–1000 characters)").fill("Resolved for the synthetic milestone test.");
    await discrepancyCard.getByRole("button", { name: "Resolve report" }).click();
    await expect(discrepancyCard).toContainText("resolved");

    const resolvedResponse = await request.get("/api/institution/discrepancies?status=RESOLVED", {
      headers: { "X-Institution-Code": "DEMO-AICTE-001" },
    });
    const resolved = await resolvedResponse.json();
    const reviewed = resolved.reports.find((item: { id: string }) => item.id === discrepancyId);
    expect(reviewed.status).toBe("RESOLVED");
    expect(reviewed.institutionValue).toBe("Aarav Sample");
    expect(reviewed.studentRecord.fullName).toBe("Aarav Sample");
    expect(reviewed.history).toHaveLength(3);
    expect(reviewed.history[2].note).toBe("Resolved for the synthetic milestone test.");
  } finally {
    if (discrepancyId) await database.query('DELETE FROM "DiscrepancyReport" WHERE "id" = $1', [discrepancyId]);
    if (confirmationId) await database.query('DELETE FROM "StudentConfirmation" WHERE "id" = $1', [confirmationId]);
    await database.end();
  }
});

test("student discrepancy input validation rejects short reasons and identity claims", async ({ request }) => {
  const listResponse = await request.get("/api/student/records?page=1&pageSize=50");
  const list = await listResponse.json();
  const record = list.records.find((item: { reference: string }) => item.reference === "SYNTH-2026-001");
  expect(record).toBeTruthy();

  const invalidReason = await request.post(`/api/student/records/${record.id}/discrepancies`, {
    data: { field: "FULL_NAME", claimedValue: "Aarav Other", reason: "wrong" },
  });
  expect(invalidReason.status()).toBe(400);
  await expect(invalidReason.json()).resolves.toMatchObject({ error: "invalid_input" });

  const identityClaim = await request.post(`/api/student/records/${record.id}/confirm`, {
    data: { studentId: "SYNTH-2026-001" },
  });
  expect(identityClaim.status()).toBe(400);
});
