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
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Student Record Cross-Verification and Review Portal" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Text size" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to the demo" })).toBeVisible();
  await expect(page.getByText("Do not enter real student data.")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/apaar-login-en-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/apaar-login-en-mobile.png", fullPage: true });
});

test("language switching preserves login input and the authenticated student session", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("student.aarav@demo.local");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "हिंदी" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByLabel("ईमेल")).toHaveValue("student.aarav@demo.local");
  await expect(page.getByLabel("पासवर्ड")).toHaveValue(password);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/apaar-login-hi-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/apaar-login-hi-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "साइन इन" }).click();
  await expect(page.getByRole("button", { name: "साइन आउट" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "अपने डेमो अभिलेख की समीक्षा करें" })).toBeVisible();

  await page.getByLabel("आपका दावा किया गया मान").fill("Synthetic claim stays while changing language");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Your claimed value")).toHaveValue("Synthetic claim stays while changing language");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/apaar-student-english-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "हिंदी" }).click();
  await page.screenshot({ path: "test-results/apaar-student-hindi-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "English" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/apaar-student-english-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "हिंदी" }).click();
  await expect(page.getByRole("heading", { name: "विसंगति दर्ज करें" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel("आपका दावा किया गया मान")).toHaveValue("Synthetic claim stays while changing language");
  await page.screenshot({ path: "test-results/apaar-student-hindi-mobile.png", fullPage: true });
});

test("language controls and portal links are keyboard reachable with a visible focus ring", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveAttribute("aria-label", "Decrease text size");
  await expect.poll(() => focused.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
  await focused.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-portal-text-size", "small");
});

test("student loading, empty, and error states provide localized feedback and recovery context", async ({ page }) => {
  let releaseRecords: () => void = () => undefined;
  const recordsGate = new Promise<void>((resolve) => { releaseRecords = resolve; });
  await page.route("**/api/student/records**", async (route) => {
    await recordsGate;
    await route.fulfill({ json: { records: [] } });
  });
  await loginPage(page, "student.aarav@demo.local");
  await expect(page.getByText("Loading synthetic demo records…")).toBeVisible();
  releaseRecords();
  await expect(page.getByText("No synthetic records are available to review.")).toBeVisible();

  await page.unroute("**/api/student/records**");
  await page.route("**/api/student/records**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ message: "Demo student records are temporarily unavailable." }),
  }));
  await page.reload();
  await expect(page.getByText("Synthetic demo records are unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "हिंदी" }).click();
  await expect(page.getByText("कृत्रिम डेमो अभिलेख उपलब्ध नहीं हैं।")).toBeVisible();
});

test("English and Hindi role pages render in desktop and mobile layouts", async ({ page }) => {
  let role = "INSTITUTION_ADMIN";
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: {
    id: "synthetic-ui-test", email: "ui.test@demo.local", role, institutionName: "Synthetic UI Test Institute", institutionCode: "DEMO-UI-001", studentReference: null,
  } } }));
  await page.route("**/api/institution/records**", (route) => route.fulfill({ json: {
    institution: { code: "DEMO-UI-001", name: "Synthetic UI Test Institute" }, records: [],
    pagination: { page: 1, pageSize: 10, totalRecords: 0, totalPages: 0 },
  } }));
  await page.route("**/api/institution/discrepancies**", (route) => route.fulfill({ json: { reports: [], options: { institutions: [], programs: [] } } }));
  await page.route("**/api/student/records**", (route) => route.fulfill({ json: { records: [
    { id: "synthetic-student-record", reference: "SYNTH-UI-001", fullName: "Synthetic Student", program: "Synthetic Program", status: "UNVERIFIED" },
  ] } }));
  await page.route("**/api/aicte/oversight**", (route) => route.fulfill({ json: {
    rows: [], totals: { totalRecords: 0, reported: 0, confirmed: 0, pending: 0, disputed: 0, recordStatusDisputed: 0, activeDiscrepancyRecords: 0, unverified: 0 },
    options: { institutions: [], programs: [], reviewStatuses: ["ALL"], academicYearAvailable: false }, metricDefinitions: {}, notice: "",
    qualityFindings: [{
      id: "SYNTH-QUALITY-FINDING",
      ruleId: "CONFLICTING_DETAILS_FOR_REFERENCE",
      category: "POSSIBLE_INCONSISTENCY",
      severity: "MEDIUM",
      decisionState: "ADVISORY",
      affected: { recordId: "synthetic-quality-record", reference: "SYNTH-QUALITY-001" },
      matched: { recordId: "synthetic-quality-record-2", reference: "synth-quality-001" },
      triggerValues: { reference: "SYNTH-QUALITY-001", fullName: "Synthetic Name", matchedFullName: "Different Synthetic Name", program: "Synthetic Program", matchedProgram: "Other Synthetic Program", conflictingFields: "fullName, program" },
    }],
    qualityRulePolicy: { approvedIntakeAvailable: false },
  } }));
  const rolePages = [
    { role: "INSTITUTION_ADMIN", en: "Institution records", hi: "संस्थान अभिलेख", key: "institution-admin" },
    { role: "INSTITUTION_OPERATOR", en: "Institution records", hi: "संस्थान अभिलेख", key: "institution-operator" },
    { role: "REVIEWER", en: "Discrepancy reports", hi: "विसंगति रिपोर्टें", key: "reviewer" },
    { role: "AICTE_ADMIN", en: "AICTE oversight", hi: "AICTE पर्यवेक्षण", key: "aicte" },
    { role: "STUDENT", en: "Review your demo record", hi: "अपने डेमो अभिलेख की समीक्षा करें", key: "student" },
  ];
  await page.goto("/");
  for (const [roleIndex, item] of rolePages.entries()) {
    role = item.role;
    if (roleIndex > 0) await page.reload();
    for (const locale of ["en", "hi"] as const) {
      if (locale === "hi") await page.getByRole("button", { name: "हिंदी" }).click();
      else if (roleIndex > 0) await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("heading", { name: item[locale], level: 1 })).toBeVisible();
      const primaryNav = page.getByRole("navigation", { name: locale === "en" ? "Primary navigation" : "मुख्य नेविगेशन" });
      if (item.role === "INSTITUTION_ADMIN" || item.role === "INSTITUTION_OPERATOR") {
        await expect(primaryNav.getByRole("button", { name: locale === "en" ? "Institution records" : "संस्थान अभिलेख" })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Workflow information" : "कार्य संबंधी जानकारी" })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Import a student CSV" : "विद्यार्थी CSV आयात करें" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: locale === "en" ? "Student reference" : "विद्यार्थी संदर्भ" })).toBeVisible();
        await expect(page.getByText(locale === "en" ? "Page 1 of 1" : "पृष्ठ 1 में से 1")).toBeVisible();
        await expect(primaryNav.getByRole("button", { name: locale === "en" ? "Discrepancy review" : "विसंगति समीक्षा" })).toHaveCount(item.role === "INSTITUTION_ADMIN" ? 1 : 0);
        if (item.role === "INSTITUTION_OPERATOR") {
          await expect(page.getByText(locale === "en" ? "Student disputes are handled by authorized reviewers" : "विद्यार्थी विवाद अधिकृत समीक्षक संभालते हैं")).toBeVisible();
        } else {
          await expect(page.getByText(locale === "en" ? "Student disputes require review" : "विद्यार्थी विवादों की समीक्षा आवश्यक है")).toBeVisible();
        }
      } else if (item.role === "REVIEWER") {
        await expect(primaryNav.getByRole("button", { name: locale === "en" ? "Discrepancy review" : "विसंगति समीक्षा" })).toBeVisible();
        await expect(page.getByLabel(locale === "en" ? "Filter status" : "स्थिति फ़िल्टर करें")).toBeVisible();
        await expect(page.getByText(locale === "en" ? "No reports match this filter." : "इस फ़िल्टर से कोई रिपोर्ट मेल नहीं खाती।")).toBeVisible();
      } else if (item.role === "STUDENT") {
        await expect(primaryNav.getByRole("button", { name: locale === "en" ? "Student confirmation" : "विद्यार्थी पुष्टि" })).toBeVisible();
        await expect(page.getByText(locale === "en" ? "Unverified · not official APAAR verification" : "असत्यापित · आधिकारिक APAAR सत्यापन नहीं")).toBeVisible();
        await expect(page.getByRole("button", { name: locale === "en" ? "These displayed details look correct" : "दिखाया गया विवरण सही है" })).toBeVisible();
        await expect(page.getByRole("button", { name: locale === "en" ? "Submit discrepancy" : "विसंगति भेजें" })).toBeVisible();
      } else {
        await expect(primaryNav.getByRole("button", { name: locale === "en" ? "AICTE oversight" : "AICTE पर्यवेक्षण" })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Institution-level counts" : "संस्थागत स्तर के आँकड़े" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: locale === "en" ? "Student-confirmed" : "विद्यार्थी द्वारा पुष्टि" })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Data-quality findings" : "डेटा गुणवत्ता निष्कर्ष" })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Details conflict for the same reference" : "एक ही संदर्भ के विवरण अलग हैं" })).toBeVisible();
        await expect(page.getByText(locale === "en" ? "Automated findings are advisory; they are not proof of fraud or reviewer decisions and do not change any record or discrepancy status." : "स्वचालित निष्कर्ष केवल सलाह हैं; वे धोखाधड़ी का प्रमाण या समीक्षक का निर्णय नहीं हैं और किसी अभिलेख या विसंगति की स्थिति नहीं बदलते।")).toBeVisible();
        await expect(page.getByText(locale === "en" ? "Approved-intake checking is unavailable because this prototype has no approved-intake source data." : "स्वीकृत प्रवेश क्षमता की जाँच उपलब्ध नहीं है, क्योंकि इस प्रोटोटाइप में स्वीकृत क्षमता का स्रोत डेटा नहीं है।")).toBeVisible();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: `test-results/apaar-${item.key}-${locale}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileLayout = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1 && element.parentElement && element.parentElement.getBoundingClientRect().right <= window.innerWidth + 1)
          .map((element) => ({ tag: element.tagName, className: element.className, right: Math.round(element.getBoundingClientRect().right), parent: element.parentElement?.className })),
      }));
      expect(mobileLayout.scrollWidth, JSON.stringify(mobileLayout)).toBeLessThanOrEqual(mobileLayout.width);
      await page.screenshot({ path: `test-results/apaar-${item.key}-${locale}-mobile.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (roleIndex < rolePages.length - 1) await page.getByRole("button", { name: "English" }).click();
  }
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

test("all five primary roles can sign in and sign out with their seeded synthetic accounts", async ({ request }) => {
  const accounts = [
    { email: "aicte.admin@demo.local", role: "AICTE_ADMIN" },
    { email: "institution.admin@demo.local", role: "INSTITUTION_ADMIN" },
    { email: "institution.operator@demo.local", role: "INSTITUTION_OPERATOR" },
    { email: "student.aarav@demo.local", role: "STUDENT" },
    { email: "reviewer@demo.local", role: "REVIEWER" },
  ];

  for (const account of accounts) {
    const user = await loginApi(request, account.email);
    expect(user.role).toBe(account.role);
    await expect((await request.get("/api/auth/me")).json()).resolves.toMatchObject({ user: { role: account.role } });
    const logout = await request.post("/api/auth/logout", { headers: { Origin: origin } });
    expect(logout.status()).toBe(204);
    expect((await request.get("/api/auth/me")).status()).toBe(401);
  }
});

test("student role restrictions apply on the API regardless of frontend", async ({ request }) => {
  const user = await loginApi(request, "student.aarav@demo.local");
  expect(user.role).toBe("STUDENT");

  expect((await request.get("/api/institution/records")).status()).toBe(403);
  expect((await request.get("/api/institution/discrepancies")).status()).toBe(403);
  expect((await request.get("/api/aicte/oversight")).status()).toBe(403);
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

    const forgedStudentQuery = await request.get(`/api/student/records?studentRecordId=${foreignRecordId}`);
    expect((await forgedStudentQuery.json()).records.map((record: { id: string }) => record.id)).toEqual([ownRecord.id]);
    expect((await request.get(`/api/student/records/${foreignRecordId}`)).status()).toBe(404);

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
    const forgedInstitutionQuery = await request.get("/api/institution/records?page=1&pageSize=100&institutionId=DEMO-AICTE-002");
    const forgedInstitutionResult = await forgedInstitutionQuery.json();
    expect(forgedInstitutionResult.institution.code).toBe("DEMO-AICTE-001");
    expect(forgedInstitutionResult.records.every((record: { reference: string }) => record.reference !== "SYNTH-2026-201")).toBe(true);

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
  expect((await request.get("/api/aicte/oversight")).status()).toBe(403);
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

test("AICTE oversight counts and filters are data-backed, and the reviewer queue shows attributed case details", async ({ page, request }) => {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const tag = crypto.randomUUID().slice(0, 10);
  const program = `Oversight QA ${tag}`;
  const reference = `SYNTH-QA-${tag}`;
  const recordIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const confirmationId = crypto.randomUUID();
  const reportId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  let institutionId = "";

  try {
    const institution = await database.query<{ id: string }>(
      'SELECT "id" FROM "Institution" WHERE "code" = $1', ["DEMO-AICTE-001"],
    );
    institutionId = institution.rows[0]?.id ?? "";
    expect(institutionId).toBeTruthy();
    const studentUser = await database.query<{ id: string }>(
      'SELECT "id" FROM "User" WHERE "email" = $1', ["student.aarav@demo.local"],
    );

    const statuses = ["UNVERIFIED", "PENDING", "REPORTED", "DISPUTED"];
    const names = ["Asha Oversight", "Bharat Oversight", "Charu Oversight", "Dev Oversight"];
    for (let index = 0; index < statuses.length; index += 1) {
      await database.query(
        'INSERT INTO "StudentRecord" ("id", "institutionId", "reference", "fullName", "program", "status", "synthetic", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6::"RecordStatus", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [recordIds[index], institutionId, `${reference}-${index}`, names[index], program, statuses[index]],
      );
    }
    await database.query(
      'INSERT INTO "StudentConfirmation" ("id", "studentRecordId", "actorUserId", "synthetic", "createdAt") VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)',
      [confirmationId, recordIds[0], studentUser.rows[0]?.id],
    );
    await database.query(
      'INSERT INTO "DiscrepancyReport" ("id", "studentRecordId", "field", "institutionValue", "claimedValue", "reason", "status", "synthetic", "createdAt", "updatedAt") VALUES ($1, $2, \'FULL_NAME\', \'Dev Oversight\', \'Synthetic Claim\', \'Synthetic oversight test case reason.\', \'OPEN\', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [reportId, recordIds[3]],
    );
    await database.query(
      'INSERT INTO "DiscrepancyReportEvent" ("id", "discrepancyReportId", "actor", "action", "toStatus", "note", "actorUserId", "createdAt") VALUES ($1, $2, \'STUDENT\', \'SUBMITTED\', \'OPEN\', \'Synthetic oversight test submission.\', $3, CURRENT_TIMESTAMP)',
      [crypto.randomUUID(), reportId, studentUser.rows[0]?.id],
    );

    await loginApi(request, "institution.admin@demo.local");
    expect((await request.get("/api/aicte/oversight")).status()).toBe(403);
    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "aicte.admin@demo.local");

    const query = new URLSearchParams({ institutionId, program });
    const allMetricsResponse = await request.get(`/api/aicte/oversight?${query}`);
    expect(allMetricsResponse.ok()).toBeTruthy();
    const allMetrics = await allMetricsResponse.json();
    expect(allMetrics.totals).toMatchObject({ totalRecords: 4, reported: 1, confirmed: 1, pending: 1, disputed: 1, recordStatusDisputed: 1, activeDiscrepancyRecords: 1, unverified: 1 });
    expect(allMetrics.options.academicYearAvailable).toBe(false);
    expect(allMetrics.qualityFindings).toEqual([]);
    expect(allMetrics.qualityRulePolicy.approvedIntakeAvailable).toBe(false);

    query.set("reviewStatus", "OPEN");
    const openMetricsResponse = await request.get(`/api/aicte/oversight?${query}`);
    expect(openMetricsResponse.ok()).toBeTruthy();
    expect((await openMetricsResponse.json()).totals).toMatchObject({ totalRecords: 1, reported: 0, confirmed: 0, pending: 0, disputed: 1, recordStatusDisputed: 1, activeDiscrepancyRecords: 1, unverified: 0 });
    expect((await request.get(`/api/aicte/oversight?${query}&academicYear=2026`)).status()).toBe(400);

    const filteredQueue = await request.get(`/api/institution/discrepancies?status=OPEN&institutionId=${institutionId}&program=${encodeURIComponent(program)}`);
    const queueResult = await filteredQueue.json();
    expect(queueResult.reports).toHaveLength(1);
    expect(queueResult.reports[0].id).toBe(reportId);
    expect(queueResult.reports[0].studentRecord.program).toBe(program);
    expect(queueResult.reports[0].history[0].actorUser.email).toBe("student.aarav@demo.local");

    await loginPage(page, "aicte.admin@demo.local");
    await page.getByRole("button", { name: "AICTE oversight" }).click();
    await page.getByRole("combobox", { name: "Institution" }).selectOption(institutionId);
    await expect(page.getByRole("option", { name: program })).toBeAttached();
    await page.getByRole("combobox", { name: "Program" }).selectOption(program);
    await expect(page.getByRole("article", { name: "Total records count" })).toContainText("4");
    await expect(page.getByRole("article", { name: "reported count" })).toContainText("1");
    await page.getByLabel("Discrepancy review status").selectOption("OPEN");
    await expect(page.getByRole("article", { name: "Total records count" })).toContainText("1");

    await page.getByRole("button", { name: "Sign out" }).click();
    await loginPage(page, "reviewer@demo.local");
    await page.getByRole("combobox", { name: "Filter institution" }).selectOption(institutionId);
    await expect(page.getByRole("option", { name: program })).toBeAttached();
    await page.getByRole("combobox", { name: "Filter program" }).selectOption(program);
    const caseCard = page.getByRole("article", { name: `${reference}-3` });
    await expect(caseCard).toBeVisible();
    await expect(caseCard).toContainText("Dev Oversight");
    await expect(caseCard).toContainText("Synthetic Claim");
    await expect(caseCard).toContainText("Synthetic oversight test case reason.");
    await expect(caseCard).toContainText("Assigned reviewer: not tracked");
    await page.screenshot({ path: "test-results/apaar-review-case-en-desktop.png", fullPage: true });

    await caseCard.getByLabel("Review note and reason (5–1000 characters)").fill("Started the synthetic review; the record value remains unchanged.");
    const underReviewResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${reportId}`) && response.request().method() === "PATCH");
    await caseCard.getByRole("button", { name: "Mark under review" }).click();
    expect((await underReviewResponse).ok()).toBeTruthy();
    await page.getByLabel("Filter status").selectOption("UNDER_REVIEW");
    await expect(caseCard).toBeVisible();
    await expect(caseCard).toContainText("Under review");
    query.set("reviewStatus", "UNDER_REVIEW");
    const underReviewMetrics = await request.get(`/api/aicte/oversight?${query}`);
    expect((await underReviewMetrics.json()).totals).toMatchObject({ totalRecords: 1, disputed: 1, recordStatusDisputed: 1, activeDiscrepancyRecords: 1 });
    const underReviewQueue = await request.get(`/api/institution/discrepancies?status=UNDER_REVIEW&institutionId=${institutionId}&program=${encodeURIComponent(program)}`);
    const underReviewReport = (await underReviewQueue.json()).reports.find((entry: { id: string }) => entry.id === reportId);
    expect(underReviewReport.history).toHaveLength(2);

    const resolutionNote = "The case was reviewed; the institution value remains unchanged.";
    await caseCard.getByLabel("Review note and reason (5–1000 characters)").fill(resolutionNote);
    const resolveResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${reportId}`) && response.request().method() === "PATCH");
    await caseCard.getByRole("button", { name: "Resolve report" }).click();
    expect((await resolveResponse).ok()).toBeTruthy();
    await page.getByLabel("Filter status").selectOption("RESOLVED");
    await expect(caseCard).toBeVisible();
    await caseCard.getByText("Audit history (3 events)").click();
    await expect(caseCard).toContainText("Started the synthetic review; the record value remains unchanged.");
    await expect(caseCard).toContainText(resolutionNote);

    const resolvedQueue = await request.get(`/api/institution/discrepancies?status=RESOLVED&institutionId=${institutionId}&program=${encodeURIComponent(program)}`);
    const resolvedReport = (await resolvedQueue.json()).reports.find((entry: { id: string }) => entry.id === reportId);
    expect(resolvedReport.status).toBe("RESOLVED");
    expect(resolvedReport.institutionValue).toBe("Dev Oversight");
    expect(resolvedReport.history).toHaveLength(3);
    expect(resolvedReport.history[1]).toMatchObject({ actor: "REVIEWER", fromStatus: "OPEN", toStatus: "UNDER_REVIEW", note: "Started the synthetic review; the record value remains unchanged." });
    expect(resolvedReport.history[2]).toMatchObject({ actor: "REVIEWER", fromStatus: "UNDER_REVIEW", toStatus: "RESOLVED", note: resolutionNote });

    const sourceRecord = await database.query<{ fullName: string; status: string }>(
      'SELECT "fullName", "status" FROM "StudentRecord" WHERE "id" = $1', [recordIds[3]],
    );
    expect(sourceRecord.rows[0]).toEqual({ fullName: "Dev Oversight", status: "DISPUTED" });

    query.set("reviewStatus", "RESOLVED");
    const metricsAfterResolution = await request.get(`/api/aicte/oversight?${query}`);
    expect((await metricsAfterResolution.json()).totals).toMatchObject({ totalRecords: 1, disputed: 1, recordStatusDisputed: 1, activeDiscrepancyRecords: 0 });

    await page.getByRole("button", { name: "Sign out" }).click();
    await loginPage(page, "aicte.admin@demo.local");
    await page.getByRole("button", { name: "AICTE oversight" }).click();
    await page.getByRole("combobox", { name: "Institution" }).selectOption(institutionId);
    await page.getByRole("combobox", { name: "Program" }).selectOption(program);
    await page.getByLabel("Discrepancy review status").selectOption("RESOLVED");
    await expect(page.getByRole("article", { name: "Total records count" })).toContainText("1");
    await expect(page.getByRole("article", { name: "Disputed count" })).toContainText("Record status DISPUTED: 1");
    await expect(page.getByRole("article", { name: "Disputed count" })).toContainText("Open/under-review cases: 0");
  } finally {
    await database.query('DELETE FROM "DiscrepancyReport" WHERE "id" = $1', [reportId]);
    await database.query('DELETE FROM "StudentConfirmation" WHERE "id" = $1', [confirmationId]);
    await database.query('DELETE FROM "StudentRecord" WHERE "id" = ANY($1::text[])', [recordIds]);
    await database.end();
  }
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

test("CSV import reports missing headers, invalid fields, accepted rows, and possible duplicates accurately", async ({ request, page }) => {
  await loginApi(request, "institution.operator@demo.local");
  const tag = crypto.randomUUID().slice(0, 12);
  const acceptedReference = `SYNTH-E2E-${tag}-OK`;
  const duplicateOne = `SYNTH-E2E-${tag}-DUP1`;
  const duplicateTwo = `SYNTH-E2E-${tag}-DUP2`;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let institutionId: string | undefined;

  try {
    const institution = await database.query<{ id: string }>(
      'SELECT "id" FROM "Institution" WHERE "code" = $1', ["DEMO-AICTE-001"],
    );
    institutionId = institution.rows[0]?.id;

    const missingHeader = await request.post("/api/institution/records/import", {
      headers: { Origin: origin },
      multipart: { file: { name: "missing-header.csv", mimeType: "text/csv", buffer: Buffer.from("reference,program\nSYNTH-MISSING,Mathematics\n") } },
    });
    expect(missingHeader.status()).toBe(400);
    const missingHeaderResult = await missingHeader.json();
    expect(missingHeaderResult.counts).toMatchObject({ accepted: 0, rejected: 1, flaggedForReview: 0 });
    expect(missingHeaderResult.report.rejectedRows[0].reasons).toContain("Missing required column: fullName.");

    await loginPage(page, "institution.operator@demo.local");
    await page.locator("#csv-file").setInputFiles({
      name: "missing-header.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("reference,program\nSYNTH-MISSING,Mathematics\n"),
    });
    await page.getByRole("button", { name: "Upload and review" }).click();
    await expect(page.getByRole("heading", { name: "Import report" })).toBeVisible();
    await expect(page.getByText("Missing required column: fullName.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "हिंदी" }).click();
    await expect(page.getByText("आवश्यक कॉलम नहीं है: fullName.", { exact: true })).toBeVisible();
    await page.locator("#csv-file").setInputFiles({
      name: "conflicting-reference.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("reference,fullName,program\nSYNTH-2026-001,Changed Synthetic Name,Physics\n"),
    });
    await page.getByRole("button", { name: "अपलोड करें और समीक्षा करें" }).click();
    await expect(page.getByRole("heading", { name: "डेटा गुणवत्ता निष्कर्ष" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "संस्थान संदर्भ दोहराया गया है" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "एक ही संदर्भ के विवरण अलग हैं" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Institution reference is repeated" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Details conflict for the same reference" })).toBeVisible();

    const csv = [
      "reference,fullName,program",
      `${acceptedReference},Accepted Synthetic,Computer Engineering`,
      "BAD REF,Malformed Student,",
      `SYNTH-E2E-${tag}-EMPTY,,Computer Engineering`,
      "SYNTH-2026-001,Existing Reference,Physics",
      `${duplicateOne},Repeat Synthetic,Mathematics`,
      `${duplicateTwo},Repeat Synthetic,Mathematics`,
    ].join("\n");
    const response = await request.post("/api/institution/records/import", {
      headers: { Origin: origin },
      multipart: { file: { name: "validation-matrix.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.report.totalRows).toBe(6);
    expect(result.counts).toEqual({ accepted: 3, rejected: 2, flaggedForReview: 1 });
    expect(result.report.acceptedRows).toEqual([
      { rowNumber: 2, reference: acceptedReference },
      { rowNumber: 6, reference: duplicateOne },
      { rowNumber: 7, reference: duplicateTwo },
    ]);
    expect(result.report.rejectedRows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([3, 4]);
    expect(result.report.rejectedRows[0].reasons).toContain("Synthetic references must start with SYNTH- and contain only letters, numbers, hyphens, or underscores.");
    expect(result.report.rejectedRows[1].reasons).toContain("Full name must contain at least 2 characters.");
    expect(result.report.flaggedForReviewRows.map((row: { reference: string }) => row.reference)).toEqual(["SYNTH-2026-001"]);
    expect(result.report.flaggedForReviewRows.every((row: { reasons: string[] }) => row.reasons.some((reason) => reason.includes("Possible duplicate")))).toBe(true);
    expect(result.report.findings.some((finding: { ruleId: string; affected: { rowNumber?: number } }) => finding.ruleId === "DUPLICATE_INSTITUTION_REFERENCE" && finding.affected.rowNumber === 5)).toBe(true);
    expect(result.report.findings.some((finding: { ruleId: string; affected: { rowNumber?: number } }) => finding.ruleId === "CONFLICTING_DETAILS_FOR_REFERENCE" && finding.affected.rowNumber === 5)).toBe(true);

    const sameInstitutionListing = await request.get("/api/institution/records?page=1&pageSize=100");
    expect((await sameInstitutionListing.json()).records.some((record: { reference: string }) => record.reference === acceptedReference)).toBe(true);

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "institution2.admin@demo.local");
    const otherInstitutionListing = await request.get("/api/institution/records?page=1&pageSize=100");
    expect((await otherInstitutionListing.json()).records.some((record: { reference: string }) => record.reference === acceptedReference)).toBe(false);
  } finally {
    if (institutionId) await database.query('DELETE FROM "StudentRecord" WHERE "institutionId" = $1 AND "reference" = ANY($2::text[])', [institutionId, [acceptedReference, duplicateOne, duplicateTwo]]);
    await database.end();
  }
});

test("institution record corrections are scoped, reasoned, and atomically audited", async ({ page, request }) => {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const recordId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const otherRecordId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const reportId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const reference = `SYNTH-CORR-${suffix}`;
  const otherReference = `SYNTH-CORR-OTHER-${suffix}`;
  try {
    const institutions = await database.query<{ id: string; code: string }>(
      'SELECT "id", "code" FROM "Institution" WHERE "code" IN ($1, $2)', ["DEMO-AICTE-001", "DEMO-AICTE-002"],
    );
    const firstInstitutionId = institutions.rows.find((institution) => institution.code === "DEMO-AICTE-001")?.id;
    const secondInstitutionId = institutions.rows.find((institution) => institution.code === "DEMO-AICTE-002")?.id;
    expect(firstInstitutionId).toBeTruthy();
    expect(secondInstitutionId).toBeTruthy();

    await database.query(
      'INSERT INTO "StudentRecord" ("id", "institutionId", "reference", "fullName", "program", "status", "synthetic", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, \'DISPUTED\', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), ($6, $7, $8, \'Other Synthetic Student\', \'Other Synthetic Program\', \'UNVERIFIED\', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [recordId, firstInstitutionId, reference, "Original Synthetic Name", "Original Synthetic Program", otherRecordId, secondInstitutionId, otherReference],
    );
    await database.query(
      'INSERT INTO "DiscrepancyReport" ("id", "studentRecordId", "field", "institutionValue", "claimedValue", "reason", "status", "synthetic", "createdAt", "updatedAt") VALUES ($1, $2, \'FULL_NAME\', \'Original Synthetic Name\', \'Student Claim\', \'Synthetic claim remains separate after a correction.\', \'OPEN\', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [reportId, recordId],
    );

    await loginApi(request, "institution.admin@demo.local");
    const missingReason = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Corrected Synthetic Name" },
    });
    expect(missingReason.status()).toBe(400);
    const invalidValue = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "1 Invalid Name", reason: "This reason explains the invalid name." },
    });
    expect(invalidValue.status()).toBe(400);
    const noChange = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Original Synthetic Name", reason: "The submitted name is already current." },
    });
    expect(noChange.status()).toBe(400);

    const created = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin },
      data: { fullName: "Corrected Synthetic Name", program: "Corrected Synthetic Program", reason: "Corrected against the institution's synthetic source entry." },
    });
    expect(created.status()).toBe(200);
    const firstCorrection = (await created.json()).correction;
    expect(firstCorrection).toMatchObject({
      studentRecordId: recordId,
      previousValues: { fullName: "Original Synthetic Name", program: "Original Synthetic Program" },
      newValues: { fullName: "Corrected Synthetic Name", program: "Corrected Synthetic Program" },
      reason: "Corrected against the institution's synthetic source entry.",
      actorEmail: "institution.admin@demo.local",
      actorRole: "INSTITUTION_ADMIN",
    });
    expect(typeof firstCorrection.createdAt).toBe("string");

    const second = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin },
      data: { fullName: "Final Synthetic Name", reason: "Second correction preserves the first event as submitted." },
    });
    expect(second.status()).toBe(200);

    const duplicateReference = await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin },
      data: { reference: "SYNTH-2026-001", reason: "This reference already exists at the same institution." },
    });
    expect(duplicateReference.status()).toBe(409);

    const finalRecord = await database.query<{ reference: string; fullName: string; program: string; status: string }>(
      'SELECT "reference", "fullName", "program", "status" FROM "StudentRecord" WHERE "id" = $1', [recordId],
    );
    expect(finalRecord.rows[0]).toEqual({ reference, fullName: "Final Synthetic Name", program: "Corrected Synthetic Program", status: "DISPUTED" });
    const unchangedDiscrepancy = await database.query<{ institutionValue: string; claimedValue: string; status: string }>(
      'SELECT "institutionValue", "claimedValue", "status" FROM "DiscrepancyReport" WHERE "id" = $1', [reportId],
    );
    expect(unchangedDiscrepancy.rows[0]).toEqual({ institutionValue: "Original Synthetic Name", claimedValue: "Student Claim", status: "OPEN" });

    const history = await request.get(`/api/institution/records/${recordId}/corrections`);
    expect(history.ok()).toBeTruthy();
    const corrections = (await history.json()).corrections;
    expect(corrections).toHaveLength(2);
    expect(corrections[0]).toMatchObject(firstCorrection);
    expect(corrections[1]).toMatchObject({ previousValues: { fullName: "Corrected Synthetic Name" }, newValues: { fullName: "Final Synthetic Name" } });

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "institution2.admin@demo.local");
    expect((await request.get(`/api/institution/records/${recordId}/corrections`)).status()).toBe(404);
    expect((await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Foreign Update", reason: "Attempted to correct another institution's synthetic record." },
    })).status()).toBe(404);

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "institution.operator@demo.local");
    expect((await request.get(`/api/institution/records/${recordId}/corrections`)).ok()).toBeTruthy();
    expect((await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Operator Update", reason: "Operator editing is not authorized." },
    })).status()).toBe(403);

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "reviewer@demo.local");
    expect((await request.get(`/api/institution/records/${recordId}/corrections`)).ok()).toBeTruthy();
    expect((await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Reviewer Update", reason: "Reviewer correction must be read-only." },
    })).status()).toBe(403);

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "aicte.admin@demo.local");
    expect((await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "AICTE Update", reason: "AICTE read access must not edit records." },
    })).status()).toBe(403);

    await request.post("/api/auth/logout", { headers: { Origin: origin } });
    await loginApi(request, "student.aarav@demo.local");
    expect((await request.patch(`/api/institution/records/${recordId}/corrections`, {
      headers: { Origin: origin }, data: { fullName: "Student Update", reason: "Student correction is not permitted." },
    })).status()).toBe(403);
    expect((await request.get(`/api/institution/records/${recordId}/corrections`)).status()).toBe(403);

    await loginPage(page, "institution.admin@demo.local");
    const row = page.getByRole("row").filter({ hasText: reference });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Correct record" }).click();
    await page.getByLabel("Student name").fill("UI Corrected Synthetic Name");
    await page.getByLabel("Correction reason (required)").fill("The institution source sheet confirms the updated synthetic name.");
    await page.getByRole("button", { name: "हिंदी" }).click();
    await expect(page.getByLabel("विद्यार्थी का नाम")).toHaveValue("UI Corrected Synthetic Name");
    await expect(page.getByLabel("सुधार का कारण (अनिवार्य)")).toHaveValue("The institution source sheet confirms the updated synthetic name.");
    await page.getByRole("button", { name: "सुधार सहेजें" }).click();
    await expect(page.getByRole("status")).toContainText("अभिलेख स्थिति और विसंगति मामलों में बदलाव नहीं हुआ।");
    await expect(row).toContainText("UI Corrected Synthetic Name");
    await row.getByRole("button", { name: "सुधार इतिहास" }).click();
    const recordHistory = page.getByRole("region", { name: `${reference} का सुधार इतिहास` });
    await expect(recordHistory).toContainText("The institution source sheet confirms the updated synthetic name.");
    await expect(recordHistory).toContainText("institution.admin@demo.local");
    await expect(recordHistory).toContainText("विद्यार्थी का नाम");
    await expect(recordHistory).toContainText("Final Synthetic Name");
    await expect(recordHistory).toContainText("UI Corrected Synthetic Name");
    await expect(recordHistory.locator(".record-history-date")).toHaveCount(3);
    await page.screenshot({ path: "test-results/apaar-correction-history-hi-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/apaar-correction-history-hi-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await loginPage(page, "reviewer@demo.local");
    const reviewCase = page.getByRole("article", { name: `Discrepancy report ${reference}` });
    await expect(reviewCase).toBeVisible();
    await reviewCase.getByRole("button", { name: "Correction history" }).click();
    const reviewerHistory = reviewCase.getByRole("region", { name: `Correction history for ${reference}` });
    await expect(reviewerHistory).toContainText("institution.admin@demo.local");
    await expect(reviewCase.getByRole("button", { name: "Correct record" })).toHaveCount(0);
  } finally {
    try {
      await database.query("BEGIN");
      try {
        const fixtureRecords = await database.query<{
          id: string;
          institutionId: string;
          institutionCode: string;
          reference: string;
          synthetic: boolean;
        }>(
          'SELECT r."id", r."institutionId", i."code" AS "institutionCode", r."reference", r."synthetic" FROM "StudentRecord" r JOIN "Institution" i ON i."id" = r."institutionId" WHERE r."id" = ANY($1::text[]) ORDER BY r."id"',
          [[recordId, otherRecordId]],
        );
        if (fixtureRecords.rowCount !== 0 && fixtureRecords.rowCount !== 2) {
          throw new Error(`Correction E2E cleanup expected zero or two fixture records; found ${fixtureRecords.rowCount}.`);
        }
        if (fixtureRecords.rowCount === 2) {
          const byId = new Map(fixtureRecords.rows.map((record) => [record.id, record]));
          const primary = byId.get(recordId);
          const secondary = byId.get(otherRecordId);
          if (
            !primary || primary.reference !== reference || primary.institutionCode !== "DEMO-AICTE-001" || !primary.synthetic
            || !secondary || secondary.reference !== otherReference || secondary.institutionCode !== "DEMO-AICTE-002" || !secondary.synthetic
          ) {
            throw new Error("Correction E2E cleanup refused to delete fixture records with unexpected IDs, references, or institution ownership.");
          }
        }

        const fixtureIds = [recordId, otherRecordId];
        const linkedStudentUsers = await database.query<{ id: string }>(
          'SELECT "id" FROM "User" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        if (linkedStudentUsers.rowCount !== 0) {
          throw new Error("Correction E2E cleanup found a linked student account and will not remove it implicitly.");
        }

        const reports = await database.query<{ id: string }>(
          'SELECT "id" FROM "DiscrepancyReport" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        const reportIds = reports.rows.map((report) => report.id);
        const discrepancyEvents = await database.query<{ id: string }>(
          'SELECT "id" FROM "DiscrepancyReportEvent" WHERE "discrepancyReportId" = ANY($1::text[])', [reportIds],
        );
        const removedEvents = await database.query(
          'DELETE FROM "DiscrepancyReportEvent" WHERE "discrepancyReportId" = ANY($1::text[])', [reportIds],
        );
        if (removedEvents.rowCount !== discrepancyEvents.rowCount) {
          throw new Error(`Correction E2E cleanup expected to remove ${discrepancyEvents.rowCount} discrepancy events; removed ${removedEvents.rowCount}.`);
        }
        const removedReports = await database.query(
          'DELETE FROM "DiscrepancyReport" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        if (removedReports.rowCount !== reports.rowCount) {
          throw new Error(`Correction E2E cleanup expected to remove ${reports.rowCount} discrepancy reports; removed ${removedReports.rowCount}.`);
        }

        const corrections = await database.query<{ id: string }>(
          'SELECT "id" FROM "StudentRecordCorrection" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        const removedCorrections = await database.query(
          'DELETE FROM "StudentRecordCorrection" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        if (removedCorrections.rowCount !== corrections.rowCount) {
          throw new Error(`Correction E2E cleanup expected to remove ${corrections.rowCount} correction events; removed ${removedCorrections.rowCount}.`);
        }

        const confirmations = await database.query<{ id: string }>(
          'SELECT "id" FROM "StudentConfirmation" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        const removedConfirmations = await database.query(
          'DELETE FROM "StudentConfirmation" WHERE "studentRecordId" = ANY($1::text[])', [fixtureIds],
        );
        if (removedConfirmations.rowCount !== confirmations.rowCount) {
          throw new Error(`Correction E2E cleanup expected to remove ${confirmations.rowCount} confirmations; removed ${removedConfirmations.rowCount}.`);
        }

        const removedRecords = await database.query(
          'DELETE FROM "StudentRecord" WHERE "id" = ANY($1::text[]) AND (("id" = $2 AND "reference" = $3) OR ("id" = $4 AND "reference" = $5)) AND "synthetic" = true',
          [fixtureIds, recordId, reference, otherRecordId, otherReference],
        );
        if (removedRecords.rowCount !== fixtureRecords.rowCount) {
          throw new Error(`Correction E2E cleanup expected to remove ${fixtureRecords.rowCount} fixture records; removed ${removedRecords.rowCount}.`);
        }

        const remainingRows = await database.query<{ count: number }>(
          `SELECT
            (SELECT count(*)::int FROM "StudentRecord" WHERE "id" = ANY($1::text[])) +
            (SELECT count(*)::int FROM "StudentRecordCorrection" WHERE "studentRecordId" = ANY($1::text[])) +
            (SELECT count(*)::int FROM "StudentConfirmation" WHERE "studentRecordId" = ANY($1::text[])) +
            (SELECT count(*)::int FROM "DiscrepancyReport" WHERE "studentRecordId" = ANY($1::text[])) +
            (SELECT count(*)::int FROM "DiscrepancyReportEvent" WHERE "discrepancyReportId" = ANY($2::text[])) AS count`,
          [fixtureIds, reportIds],
        );
        if (remainingRows.rows[0]?.count !== 0) {
          throw new Error(`Correction E2E cleanup left ${remainingRows.rows[0]?.count ?? "unknown"} fixture rows.`);
        }
        await database.query("COMMIT");
      } catch (cleanupError) {
        await database.query("ROLLBACK");
        throw cleanupError;
      }
    } finally {
      await database.end();
    }
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

    await page.getByLabel("Your claimed value").fill("Aarav Student");
    await page.getByLabel("Reason for the discrepancy").fill(uniqueReason);
    await page.getByRole("button", { name: "हिंदी" }).click();
    await page.getByRole("button", { name: "विसंगति भेजें" }).click();
    await expect(page.getByRole("alert")).toContainText("इसी दावे और कारण वाली एक खुली या समीक्षाधीन विसंगति पहले से दर्ज है।");
    await expect(page.getByLabel("आपका दावा किया गया मान")).toHaveValue("Aarav Student");
    await page.getByRole("button", { name: "English" }).click();

    await page.getByRole("button", { name: "Sign out" }).click();
    await loginPage(page, "institution.admin@demo.local");
    await page.getByRole("button", { name: "Discrepancy review" }).click();
    await page.getByLabel("Filter status").selectOption("ALL");
    const card = page.getByRole("article", { name: /SYNTH-2026-001/ }).filter({ hasText: uniqueReason });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Aarav Sample");
    await expect(card).toContainText("Aarav Student");

    await card.getByLabel("Review note and reason (5–1000 characters)").fill("Started an authenticated synthetic review.");
    const underReviewResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${discrepancyId}`) && response.request().method() === "PATCH");
    await card.getByRole("button", { name: "Mark under review" }).click();
    expect((await underReviewResponse).ok()).toBeTruthy();
    await expect(card).toContainText("under review");
    await card.getByLabel("Review note and reason (5–1000 characters)").fill("Resolved by the local milestone test.");
    const resolvedUiResponse = page.waitForResponse((response) => response.url().includes(`/discrepancies/${discrepancyId}`) && response.request().method() === "PATCH");
    await card.getByRole("button", { name: "Resolve report" }).click();
    expect((await resolvedUiResponse).ok()).toBeTruthy();
    await expect(card).toContainText("Resolved");

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

test("student cannot create duplicate active discrepancy reports for the same claim and reason", async ({ request }) => {
  await loginApi(request, "student.aarav@demo.local");
  const record = (await (await request.get("/api/student/records")).json()).records[0] as { id: string };
  const reason = `Repeated synthetic submission ${crypto.randomUUID()}.`;
  let reportId = "";
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();

  try {
    const payload = { field: "FULL_NAME", claimedValue: "Aarav Duplicate", reason };
    const invalid = await request.post(`/api/student/records/${record.id}/discrepancies`, {
      headers: { Origin: origin }, data: { field: "FULL_NAME", claimedValue: "", reason: "" },
    });
    expect(invalid.status()).toBe(400);

    const first = await request.post(`/api/student/records/${record.id}/discrepancies`, {
      headers: { Origin: origin }, data: payload,
    });
    expect(first.status()).toBe(201);
    reportId = (await first.json()).report.id as string;

    const duplicate = await request.post(`/api/student/records/${record.id}/discrepancies`, {
      headers: { Origin: origin }, data: payload,
    });
    expect(duplicate.status()).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: "duplicate_discrepancy" });
  } finally {
    if (reportId) await database.query('DELETE FROM "DiscrepancyReport" WHERE "id" = $1', [reportId]);
    await database.end();
  }
});
