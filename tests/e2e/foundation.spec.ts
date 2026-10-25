import dotenv from "dotenv";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  override: !["test", "production"].includes(process.env.NODE_ENV ?? "development"),
  quiet: true,
});

const origin = "http://localhost:5173";
const password = "DemoOnly-2026!";

async function loginApi(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: { email, password },
  });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()).user as { role: string; institutionCode: string | null };
}

async function loginPage(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("login screen identifies the local synthetic prototype", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("APAAR Trust Platform");
  await expect(page.getByRole("heading", { name: "Sign in to the demo" })).toBeVisible();
  await expect(page.getByText("Do not enter real student data.")).toBeVisible();
});

test("health and readiness remain available without an authenticated session", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toMatchObject({ status: "ok", service: "apaar-api" });

  const readiness = await request.get("/api/health/ready");
  expect(readiness.ok()).toBeTruthy();
  await expect(readiness.json()).resolves.toMatchObject({ status: "ready", database: "connected" });
});

test("protected routes reject unauthenticated users", async ({ request }) => {
  for (const path of ["/api/auth/me", "/api/institution/records", "/api/institution/discrepancies", "/api/student/records"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  const mutation = await request.post("/api/student/records/c123456789/confirm", {
    headers: { Origin: origin },
    data: {},
  });
  expect(mutation.status()).toBe(401);
});

test("invalid credentials produce a generic safe error", async ({ request }) => {
  const unknown = await request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: { email: "missing@demo.local", password },
  });
  const wrongPassword = await request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: { email: "institution.admin@demo.local", password: "incorrect" },
  });
  expect(unknown.status()).toBe(401);
  expect(wrongPassword.status()).toBe(401);
  await expect(unknown.json()).resolves.toMatchObject({ error: "invalid_credentials", message: "Email or password is incorrect." });
  await expect(wrongPassword.json()).resolves.toMatchObject({ error: "invalid_credentials", message: "Email or password is incorrect." });
});

test("student role restrictions apply on the API regardless of frontend", async ({ request }) => {
  const user = await loginApi(request, "student.aarav@demo.local");
  expect(user.role).toBe("STUDENT");

  expect((await request.get("/api/institution/records")).status()).toBe(403);
  expect((await request.get("/api/institution/discrepancies")).status()).toBe(403);
  const ownRecords = await request.get("/api/student/records");
  expect(ownRecords.ok()).toBeTruthy();
  const body = await ownRecords.json();
  expect(body.records.map((record: { reference: string }) => record.reference)).toEqual(["SYNTH-2026-001"]);
});

test("institution scope comes from the signed-in account and blocks cross-institution IDs", async ({ request }) => {
  await loginApi(request, "student.nila@demo.local");
  const ownList = await request.get("/api/student/records");
  const ownRecord = (await ownList.json()).records[0] as { id: string; reference: string };
  expect(ownRecord.reference).toBe("SYNTH-2026-201");

  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let foreignRecordId = "";
  let reportId: string | undefined;
  try {
    const foreign = await database.query<{ id: string }>(
      'SELECT "id" FROM "StudentRecord" WHERE "reference" = $1',
      ["SYNTH-2026-001"],
    );
    foreignRecordId = foreign.rows[0]?.id ?? "";
    expect(foreignRecordId).toBeTruthy();

    const alteredUrl = await request.post(`/api/student/records/${foreignRecordId}/discrepancies`, {
      headers: { Origin: origin },
      data: { field: "FULL_NAME", claimedValue: "Nila Other", reason: "I am trying a record outside my account scope." },
    });
    expect(alteredUrl.status()).toBe(404);

    const submission = await request.post(`/api/student/records/${ownRecord.id}/discrepancies`, {
      headers: { Origin: origin },
      data: { field: "FULL_NAME", claimedValue: "Nila Another", reason: "The synthetic demo name differs from my example details." },
    });
    expect(submission.status()).toBe(201);
    reportId = (await submission.json()).report.id as string;

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "institution.admin@demo.local");
    const forgedHeaderList = await request.get("/api/institution/records", {
      headers: { "X-Institution-Code": "DEMO-AICTE-002" },
    });
    expect(forgedHeaderList.ok()).toBeTruthy();
    const list = await forgedHeaderList.json();
    expect(list.institution.code).toBe("DEMO-AICTE-001");
    expect(list.records.every((record: { reference: string }) => record.reference !== "SYNTH-2026-201")).toBe(true);

    const crossInstitutionUpdate = await request.patch(`/api/institution/discrepancies/${reportId}`, {
      headers: { Origin: origin, "X-Institution-Code": "DEMO-AICTE-002" },
      data: { status: "RESOLVED", resolutionNote: "Attempted cross institution review." },
    });
    expect(crossInstitutionUpdate.status()).toBe(404);
  } finally {
    if (reportId) await database.query('DELETE FROM "DiscrepancyReport" WHERE "id" = $1', [reportId]);
    await database.end();
  }
});

test("role restrictions prevent operators, students, and reviewers from unauthorized writes", async ({ request }) => {
  await loginApi(request, "institution.operator@demo.local");
  const update = await request.patch("/api/institution/discrepancies/unknown-report-id", {
    headers: { Origin: origin },
    data: { status: "RESOLVED", resolutionNote: "Operator cannot resolve reports." },
  });
  expect(update.status()).toBe(403);
  await request.post("/api/auth/logout", { headers: { Origin: origin } });

  await loginApi(request, "reviewer@demo.local");
  const importResponse = await request.post("/api/institution/records/import", {
    headers: { Origin: origin },
    multipart: { file: { name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("reference,fullName,program\n") } },
  });
  expect(importResponse.status()).toBe(403);
});

test("AICTE admins can read across institutions while reviewers can review without roster access", async ({ request }) => {
  await loginApi(request, "aicte.admin@demo.local");
  const allRecords = await request.get("/api/institution/records?page=1&pageSize=100", {
    headers: { "X-Institution-Code": "DEMO-AICTE-001" },
  });
  expect(allRecords.ok()).toBeTruthy();
  const records = (await allRecords.json()).records as Array<{ reference: string; institution: { code: string } }>;
  expect(records.some((record) => record.reference === "SYNTH-2026-201" && record.institution.code === "DEMO-AICTE-002")).toBe(true);
  await request.post("/api/auth/logout", { headers: { Origin: origin } });

  await loginApi(request, "reviewer@demo.local");
  expect((await request.get("/api/institution/records")).status()).toBe(403);
  expect((await request.get("/api/institution/discrepancies")).ok()).toBeTruthy();
});

test("authenticated institution can import a synthetic CSV and sees it in its own roster", async ({ request }) => {
  await loginApi(request, "institution.operator@demo.local");
  const reference = `SYNTH-E2E-${crypto.randomUUID().slice(0, 12)}`;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let institutionId: string | undefined;
  try {
    const institution = await database.query<{ id: string }>(
      'SELECT "id" FROM "Institution" WHERE "code" = $1', ["DEMO-AICTE-001"],
    );
    institutionId = institution.rows[0]?.id;

    const response = await request.post("/api/institution/records/import", {
      headers: { Origin: origin },
      multipart: {
        file: { name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(`reference,fullName,program\n${reference},Avery Synthetic,Computer Engineering\n`) },
      },
    });
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).counts.accepted).toBe(1);
    const listing = await request.get("/api/institution/records?page=1&pageSize=100");
    expect((await listing.json()).records.some((record: { reference: string }) => record.reference === reference)).toBe(true);
  } finally {
    if (institutionId) await database.query('DELETE FROM "StudentRecord" WHERE "institutionId" = $1 AND "reference" = $2', [institutionId, reference]);
    await database.end();
  }
});

test("student confirms and reports a discrepancy, institution admin reviews with attributed audit events", async ({ page, request }) => {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let confirmationId: string | undefined;
  let discrepancyId: string | undefined;
  let recordId: string | undefined;
  const uniqueReason = `The name in this synthetic example differs from my demo details (${Date.now()}).`;
  try {
    const recordResult = await database.query<{ id: string }>(
      'SELECT "id" FROM "StudentRecord" WHERE "reference" = $1', ["SYNTH-2026-001"],
    );
    recordId = recordResult.rows[0]?.id;
    expect(recordId).toBeTruthy();

    await loginPage(page, "student.aarav@demo.local");
    await expect(page.getByRole("heading", { name: "Review your demo record" })).toBeVisible();
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
    expect(discrepancyResult.report.institutionValue).toBe("Aarav Sample");
    expect(discrepancyResult.report.status).toBe("OPEN");
    const original = await database.query<{ fullName: string }>(
      'SELECT "fullName" FROM "StudentRecord" WHERE "id" = $1', [recordId],
    );
    expect(original.rows[0]?.fullName).toBe("Aarav Sample");

    await page.getByRole("button", { name: "Sign out" }).click();
    await loginPage(page, "institution.admin@demo.local");
    await page.getByRole("button", { name: "Discrepancy review" }).click();
    await page.getByLabel("Filter status").selectOption("ALL");
    const card = page.getByRole("article", { name: /SYNTH-2026-001/ }).filter({ hasText: uniqueReason });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Aarav Sample");
    await expect(card).toContainText("Aarav Student");

    await card.getByLabel("Demo reviewer note (5–1000 characters)").fill("Started an authenticated synthetic review.");
    const underReviewResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${discrepancyId}`) && response.request().method() === "PATCH");
    await card.getByRole("button", { name: "Mark under review" }).click();
    expect((await underReviewResponse).ok()).toBeTruthy();
    await expect(card).toContainText("under review");
    await card.getByLabel("Demo reviewer note (5–1000 characters)").fill("Resolved by the local milestone test.");
    const resolvedUiResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${discrepancyId}`) && response.request().method() === "PATCH");
    await card.getByRole("button", { name: "Resolve report" }).click();
    expect((await resolvedUiResponse).ok()).toBeTruthy();
    await expect(card).toContainText("resolved");

    await loginApi(request, "institution.admin@demo.local");
    const report = await request.get(`/api/institution/discrepancies?status=RESOLVED`);
    const reviewed = (await report.json()).reports.find((entry: { id: string }) => entry.id === discrepancyId);
    expect(reviewed.history).toHaveLength(3);
    expect(reviewed.history[0].actor).toBe("STUDENT");
    expect(reviewed.history[1].actor).toBe("INSTITUTION_ADMIN");
    expect(reviewed.history[2].note).toBe("Resolved by the local milestone test.");
  } finally {
    if (discrepancyId) await database.query('DELETE FROM "DiscrepancyReport" WHERE "id" = $1', [discrepancyId]);
    if (confirmationId) await database.query('DELETE FROM "StudentConfirmation" WHERE "id" = $1', [confirmationId]);
    await database.end();
  }
});

test("student discrepancy server validation rejects short reasons and identity claims", async ({ request }) => {
  await loginApi(request, "student.aarav@demo.local");
  const record = (await (await request.get("/api/student/records")).json()).records[0] as { id: string };
  const invalidReason = await request.post(`/api/student/records/${record.id}/discrepancies`, {
    headers: { Origin: origin },
    data: { field: "FULL_NAME", claimedValue: "Aarav Other", reason: "wrong" },
  });
  expect(invalidReason.status()).toBe(400);
  const identityClaim = await request.post(`/api/student/records/${record.id}/confirm`, {
    headers: { Origin: origin },
    data: { studentId: "SYNTH-2026-001" },
  });
  expect(identityClaim.status()).toBe(400);
});
