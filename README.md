# APAAR Trust Platform

SIH 2026 project for Problem Statement 26263: independent student–institution record cross-verification for AICTE-approved institutions. The prototype includes role-based local accounts, an institution roster and bounded CSV ingestion, a student record review flow, and auditable discrepancy review. All seeded people and records are synthetic. There are no APAAR, DigiLocker, or government integrations.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Compose for PostgreSQL

## Start locally

```sh
npm install
cp .env.example .env
npm run db:generate
docker compose up -d db
npm run db:deploy
npm run db:seed
npm run dev
```

Open the frontend at <http://localhost:5173>. The API liveness endpoint is <http://localhost:4000/api/health>; database readiness is <http://localhost:4000/api/health/ready>. The frontend proxies `/api` requests to the API. The checked-in development database password is for local use only. Do not use it outside a disposable development environment.

Open the site at <http://localhost:5173> (the API validates mutating-request origins against `APP_ORIGIN`). The API and Prisma CLI explicitly load the repository-root `.env`, independent of their working directory. In local development, `.env` takes precedence over inherited environment values to prevent stale shell variables from selecting a different database. With `NODE_ENV=test` or `production`, explicit process environment values take precedence.

### Local-only synthetic demo accounts

Run `npm run db:seed` to create or reset the fictional demo accounts. Every account uses the shared local-only password `DemoOnly-2026!`; never reuse it outside this disposable dataset.

| Role | Email | Access |
| --- | --- | --- |
| AICTE_ADMIN | `aicte.admin@demo.local` | Read synthetic institution rosters and review all discrepancy reports |
| INSTITUTION_ADMIN | `institution.admin@demo.local` | Manage the first demo institution’s roster and review its reports |
| INSTITUTION_OPERATOR | `institution.operator@demo.local` | List and import records for the first demo institution |
| STUDENT | `student.aarav@demo.local` | Review only the linked `SYNTH-2026-001` record |
| REVIEWER | `reviewer@demo.local` | Review reports across synthetic institutions |
| INSTITUTION_ADMIN | `institution2.admin@demo.local` | Manage the second demo institution’s roster and reports |
| STUDENT | `student.nila@demo.local` | Review only the linked `SYNTH-2026-201` record |

The seed refuses to run with `NODE_ENV=production`. It creates only synthetic fixtures and stores Argon2id password hashes. The development server generates an ephemeral session secret if `SESSION_SECRET` is empty, so sessions expire when the API restarts. For stable local sessions, set `SESSION_SECRET` in the ignored `.env` to a random value, for example `openssl rand -base64 48`.

## Institution records and CSV format

After sign-in, institution admins and operators can list their own synthetic records at `GET /api/institution/records?page=1&pageSize=20` and import CSV through `POST /api/institution/records/import` (multipart field `file`). CSV files must be UTF-8 and contain exactly these headers: `reference,fullName,program`. References must start with `SYNTH-`; names and program labels are length- and character-validated. Files are limited to 1 MB and 500 data rows.

Rows with invalid fields are rejected with their CSV row number and reasons. Possible duplicates are withheld and flagged for review when their reference matches or their name and program match an existing record or another upload row. They are never merged or described as fraud. Successful rows are added as synthetic, unverified records.

Institution scope comes from the authenticated account’s database-linked institution. The `X-Institution-Code` header is ignored and never establishes identity or scope. Backend roles restrict listing, importing, and reviewing; institution queries constrain reads and writes to the signed-in institution. AICTE admins and reviewers have their documented cross-institution review/read roles. These are local demo accounts, not operational identities; do not use real student data. Student confirmation does not constitute official APAAR verification.

## Student review and discrepancy reports

The signed-in student can access only the synthetic record linked to their account at `GET /api/student/records`. It can be confirmed with `POST /api/student/records/:recordId/confirm` or disputed with `POST /api/student/records/:recordId/discrepancies` and JSON `{ "field": "FULL_NAME", "claimedValue": "Aarav Demo", "reason": "The synthetic example does not match my demo details." }`. Supported fields are `REFERENCE`, `FULL_NAME`, and `PROGRAM`; claims and reasons are validated server-side. A student ID or edited URL is never used as identity proof. Missing responses are not fraud evidence.

Discrepancies store the original institution value separately from the student claim and include a user-attributed event. Institution admins can list and update reports only in their institution; AICTE admins and reviewers can review across institutions. Review actions store the authenticated user and role. Resolved reports are terminal. No workflow marks a record officially APAAR-verified. Migrations `student_review` and `role_authentication` add review and auth/session tables.

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

`npm test` runs CSV, student-review, and auth-validation unit tests plus Playwright checks for sessions, roles, cross-institution attempts, and authorized workflows. Browser checks expect the local database to be migrated and seeded. Install Chromium with `npx playwright install chromium` if needed. Use `npm run db:migrate` to create new migrations and `npm run db:deploy` to apply committed migrations.

**Existing migration-order limitation:** `20261025193949_student_review` sorts before `20261026000100_foundation`, although it alters tables created by `foundation`. As a result, `prisma migrate dev` shadow replay fails on this historical order. This workspace already had both prior migrations recorded; Milestone 4 was applied with `npm run db:deploy`. A clean database bootstrap and future `migrate dev` need a coordinated migration-history repair; do not rename or rewrite already-applied migration directories without reconciling each database’s `_prisma_migrations` history.
