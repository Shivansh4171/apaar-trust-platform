# APAAR Trust Platform

SIH 2026 project for Problem Statement 26263: independent student–institution record cross-verification for AICTE-approved institutions. The current prototype includes an institution roster dashboard, bounded CSV ingestion, a synthetic student record review flow, discrepancy reporting, and an institution demo review view. Proper authentication, production authorization, private evidence uploads, and government integrations are not implemented.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Compose for PostgreSQL

## Start locally

```sh
npm install
cp .env.example .env
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

Open the frontend at <http://localhost:5173>. The API liveness endpoint is <http://localhost:4000/api/health>; database readiness is <http://localhost:4000/api/health/ready>. The frontend proxies `/api` requests to the API. The checked-in development database password is for local use only. Do not use it outside a disposable development environment.

The API and Prisma CLI explicitly load the repository-root `.env`, independent of their working directory. In local development, `.env` takes precedence over inherited environment values to prevent stale shell variables from selecting a different database. With `NODE_ENV=test` or `production`, explicit process environment values take precedence.

## Institution records and CSV format

The dashboard lists synthetic records from PostgreSQL. The API supports `GET /api/institution/records?page=1&pageSize=20` and `POST /api/institution/records/import` (multipart field `file`). CSV files must be UTF-8 and contain exactly these headers: `reference,fullName,program`. References must start with `SYNTH-`; names and program labels are length- and character-validated. Only fictional development data is allowed. Files are limited to 1 MB and 500 data rows.

Rows with invalid fields are rejected with their CSV row number and reasons. Possible duplicates are withheld and flagged for review when their reference matches or their name and program match an existing record or another upload row. They are never merged or described as fraud. Successful rows are added as synthetic, unverified records.

The current institution scope uses the `X-Institution-Code` header with the demo institution code. Backend queries are scoped to the selected institution, but the header is user-controlled and there is no authentication or role authorization yet. This is a prototype boundary only and is not production-secure; do not use real student data. Seeded people, institutions, and student references are fictional. Student confirmation and this prototype do not constitute official APAAR verification. No government service is connected.

## Student review and discrepancy reports

The student demo workspace lists synthetic records at `GET /api/student/records`. A selected record can be confirmed with `POST /api/student/records/:recordId/confirm` or disputed with `POST /api/student/records/:recordId/discrepancies` and JSON `{ "field": "FULL_NAME", "claimedValue": "Aarav Demo", "reason": "The synthetic example does not match my demo details." }`. Supported fields are `REFERENCE`, `FULL_NAME`, and `PROGRAM`; each claim and its reason are validated server-side. Selecting a record is only a demo target selector, never proof of student identity. Missing responses are not fraud evidence.

Discrepancies store the original institution value separately from the claimed value, start as `OPEN`, and include a `STUDENT_DEMO` submission event. Institutions can list scoped reports at `GET /api/institution/discrepancies` and update status/note with `PATCH /api/institution/discrepancies/:reportId`. Allowed transitions are to `UNDER_REVIEW` or `RESOLVED`; each update creates an `INSTITUTION_DEMO` audit event. Resolved reports are terminal in this milestone. Demo reviewer actions are not authenticated staff decisions. The schema migration `student_review` adds confirmation, discrepancy, and audit-event tables.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs CSV/student-review unit tests and Playwright browser checks; Playwright checks expect the local database to be migrated and seeded. Install a browser once with `npx playwright install chromium` if Chromium is missing. Run schema changes locally with `npm run db:migrate`; use `npm run db:deploy` to apply committed migrations in deployment environments.
