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
