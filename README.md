# APAAR Trust Platform

SIH 2026 project for Problem Statement 26263: independent student–institution record cross-verification for AICTE-approved institutions. The prototype includes role-based local accounts, an institution roster and bounded CSV ingestion, a student record review flow, an AICTE-role synthetic oversight dashboard, and auditable discrepancy review. All seeded people and records are synthetic. There are no APAAR, DigiLocker, or government integrations.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Engine with Docker Compose v2
- OpenSSL to generate URL-safe local secrets (or another secure random generator)

## Start locally

1. Install dependencies and copy the environment template:

   ```sh
   npm install
   cp .env.example .env
   ```

2. Edit `.env`: replace the database username placeholder in both `POSTGRES_USER` and `DATABASE_URL`; generate a URL-safe local password with `openssl rand -hex 24` and put that same value in `POSTGRES_PASSWORD` and the password portion of `DATABASE_URL`. Set `SESSION_SECRET` with `openssl rand -base64 48` for stable local sessions. Keep `.env` local; it is ignored by Git. Do not reuse these values elsewhere.

3. Start PostgreSQL. Compose publishes it only on `127.0.0.1:5433`:

   ```sh
   docker compose up -d db
   ```

4. For a **brand-new empty local database**, generate the Prisma client and apply the committed migrations with the safe bootstrap helper:

   ```sh
   npm run db:generate
   npm run db:bootstrap:fresh
   ```

   The helper requires an explicit empty-database confirmation flag, checks that the target has no public tables, applies the historical foundation migration before the dependent student-review migration, then records and deploys the remaining original migrations. It does not delete data. If it fails partway, discard only that disposable database and create a new empty one before retrying; never point it at an existing or valuable database.

   For a database that already has the committed migration history, use `npm run db:deploy` instead. Do not run `db:bootstrap:fresh` against it.

5. Seed fictional demo accounts and start both apps:

   ```sh
   npm run db:seed
   npm run dev
   ```

Open the frontend at <http://localhost:5173>. The API liveness endpoint is <http://localhost:4000/api/health>; database readiness is <http://localhost:4000/api/health/ready>. The frontend proxies `/api` requests to the API. The API and Prisma CLI load the repository-root `.env`. In local development, `.env` takes precedence over inherited values; with `NODE_ENV=test` or `production`, explicit process environment values take precedence.

### Local-only synthetic demo accounts

Run `npm run db:seed` to create or reset the fictional demo accounts. Every account uses the shared local-only password `DemoOnly-2026!`; never reuse it outside this disposable dataset.

| Role | Email | Access |
| --- | --- | --- |
| AICTE_ADMIN | `aicte.admin@demo.local` | Cross-institution synthetic oversight counts, synthetic rosters, and all discrepancy reports |
| INSTITUTION_ADMIN | `institution.admin@demo.local` | Manage and correct the first demo institution’s roster, read correction history, and review its reports |
| INSTITUTION_OPERATOR | `institution.operator@demo.local` | List and import records and read correction history for the first demo institution; cannot edit records |
| STUDENT | `student.aarav@demo.local` | Review only the linked `SYNTH-2026-001` record |
| REVIEWER | `reviewer@demo.local` | Review discrepancy reports across synthetic institutions; no institution roster access |
| INSTITUTION_ADMIN | `institution2.admin@demo.local` | Manage the second demo institution’s roster and reports |
| STUDENT | `student.nila@demo.local` | Review only the linked `SYNTH-2026-201` record |

The seed refuses to run with `NODE_ENV=production`. It creates only synthetic fixtures and stores Argon2id password hashes. The development server generates an ephemeral session secret if `SESSION_SECRET` is empty, so sessions expire when the API restarts. For stable local sessions, set `SESSION_SECRET` in the ignored `.env` to a random value, for example `openssl rand -base64 48`.

## Institution records and CSV format

After sign-in, institution admins and operators can list their own synthetic records at `GET /api/institution/records?page=1&pageSize=20` and import CSV through `POST /api/institution/records/import` (multipart field `file`). CSV files must be UTF-8 and contain exactly these headers: `reference,fullName,program`. References must start with `SYNTH-`; names and program labels are length- and character-validated. Files are limited to 1 MB and 500 data rows.

Rows with missing or malformed required fields are rejected with their CSV row number and reasons. Duplicate institution references are held for review, and details that conflict under the same institution-scoped reference are reported as a separate possible inconsistency. Matching names or programs without a shared reference do not identify the same student. Findings include the rule, severity, affected row/record, triggering values, explanation, and recommended next step. They are advisory: they do not create discrepancy cases, change record status, or establish fraud. Successful rows are added as synthetic, unverified records.

### Explainable data-quality checks

The CSV import report and AICTE synthetic oversight view use deterministic checks against available fields. `ERROR` is reserved for missing/malformed required fields or invalid CSV row structure and rejects the row. `HIGH` means an institution-scoped reference is repeated and the row is held for review. `MEDIUM` means values attached to the same institution-scoped reference differ; it is a possible inconsistency, not a reviewer decision. Comparing references across institutions is not used to identify a student, and names alone are never treated as an identity key. Repeated evaluation does not create discrepancy cases or mutate records.

The schema does not store approved institution/program intake limits, so the intake rule is explicitly unavailable and no enrolment-capacity finding is generated. The schema also has no global student identifier or independent raw-submission history; cross-submission conflicts are reported only when an institution-scoped reference reliably links the values. No APAAR, DigiLocker, or official AICTE integration is present.

Institution scope comes from the authenticated account’s database-linked institution. The `X-Institution-Code` header is ignored and never establishes identity or scope. Backend roles restrict listing, importing, and reviewing; institution queries constrain reads and writes to the signed-in institution. AICTE admins and reviewers have their documented cross-institution review/read roles. These are local demo accounts, not operational identities; do not use real student data. Student confirmation does not constitute official APAAR verification.

Institution administrators can correct one or more current record fields through `PATCH /api/institution/records/:recordId/corrections` with changed values and a required 10–1000 character reason. The API derives institution scope from the signed-in account and stores the previous and new values, actor email/role, reason, and timestamp in a separate correction event within the same transaction as the record update. Corrections do not alter record status or discrepancy cases. Institution operators can read their own institution’s history but cannot submit corrections. Reviewers and AICTE administrators can read synthetic correction history across institutions; correction history is read-only for them. History is available from the institution roster and reviewer case pages. The additive `student_record_correction` migration creates the history table; apply committed migrations with `npm run db:deploy`.

## Student review and discrepancy reports

The signed-in student can access only the synthetic record linked to their account at `GET /api/student/records`. It can be confirmed with `POST /api/student/records/:recordId/confirm` or disputed with `POST /api/student/records/:recordId/discrepancies` and JSON `{ "field": "FULL_NAME", "claimedValue": "Aarav Demo", "reason": "The synthetic example does not match my demo details." }`. Supported fields are `REFERENCE`, `FULL_NAME`, and `PROGRAM`; claims and reasons are validated server-side. A student ID or edited URL is never used as identity proof. Missing responses are not fraud evidence.

Discrepancies store the institution value seen at submission separately from the student claim and include a user-attributed event. Institution admins can list and update reports only in their institution; AICTE admins and reviewers can review across institutions. Review actions store the authenticated user and role. Resolved reports are terminal. Correcting a record does not rewrite an existing discrepancy snapshot, accept the student claim, resolve the case, or mark the record officially verified. Migrations `student_review` and `role_authentication` add review and auth/session tables; `student_record_correction` adds auditable correction events.

## AICTE synthetic oversight

Only `AICTE_ADMIN` can call `GET /api/aicte/oversight` or view the AICTE oversight dashboard. It groups data-backed synthetic counts by institution and supports institution, exact program, and discrepancy review-status filters. The reported count uses `RecordStatus.REPORTED`; confirmed counts records with at least one student confirmation event; pending and unverified use their corresponding `RecordStatus` values. Disputed is the distinct-record union of records whose `RecordStatus` is `DISPUTED` and records with an `OPEN`/`UNDER_REVIEW` discrepancy. The dashboard shows both source counts because they can overlap. Resolving a discrepancy closes only that report and records the review event; it does not change the underlying record status or accept the student's claimed value. Therefore the disputed total may remain nonzero because a record is still marked `DISPUTED`, even when all its discrepancy reports are resolved. A later data correction must use a separate, versioned, auditable workflow. Confirmation is not official verification, and a missing response is not fraud evidence.

The discrepancy queue supports institution, program, and `OPEN`/`UNDER_REVIEW`/`RESOLVED` filters for roles that may access that queue. Reviewers can inspect and resolve cases across institutions but cannot access institution rosters. Queue history shows the signed-in account, role, timestamp, status transition, and note. Reviewer assignment is not stored, so the queue explicitly shows that it is not tracked. Academic year is not stored on records and is therefore not filterable; no year is inferred. The dashboard is a prototype and does not represent an official AICTE integration.

## Authentication and security

The API uses Argon2id password hashes, PostgreSQL-backed server sessions, an `HttpOnly`, `SameSite=Strict` cookie (also `Secure` in production), session ID rotation at login, and logout invalidation. Express enforces roles and derives institution/student scope from the authenticated database user on every protected endpoint. Mutations require an exact `Origin` match to `APP_ORIGIN`; do not add permissive CORS. Login attempts are limited per IP for 15 minutes (100 attempts in development to support repeat local browser checks; 20 in production) using the default in-memory express-rate-limit store.

For production configuration, provide a managed random `SESSION_SECRET` of at least 32 characters, the exact HTTPS `APP_ORIGIN`, and `TRUST_PROXY_HOPS` matching the trusted TLS proxy chain. The in-memory login limiter is single-process only; production multi-instance deployments must configure a shared rate-limit store. This milestone does not include account provisioning, password reset/MFA, institutional identity proofing, or operational secrets management, so it remains a synthetic prototype and is not ready for real student records. Never run the demo seed in production or put secrets in Git/frontend code.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs CSV, data-quality, student-review, and auth-validation unit tests plus Playwright checks for sessions, roles, cross-institution attempts, and authorized workflows. Browser checks expect the local database to be migrated and seeded. Install Chromium with `npx playwright install chromium` if needed. Use `npm run db:migrate` to create new migrations and `npm run db:deploy` to apply committed migrations.

**Historical migration ordering:** `20261025193949_student_review` sorts before `20261026000100_foundation` even though it depends on the foundation tables. Existing migration files are preserved. For an empty database, use `npm run db:bootstrap:fresh`, which checks for public tables, executes the foundation SQL first, marks that existing migration as applied, and then deploys the other committed migrations in their original order. The helper does not rewrite migration files or delete database contents. `prisma migrate dev` shadow replay still follows timestamp order and remains unsuitable for this historical sequence; use `npm run db:deploy` for databases with the existing migration history and `npm run db:migrate` only after confirming the documented ordering limitation is addressed.
