# Repository Guidelines

## Project Purpose

Build the SIH 2026 solution for Problem Statement 26263: an APAAR ID-based student data management and verification platform for AICTE-approved institutions. Its core value is independent student–institution cross-verification, explainable discrepancy detection, and auditable correction workflows.

## Project Structure & Technology

Use React, Vite, TypeScript, Tailwind CSS; Node.js, Express, TypeScript; PostgreSQL with Prisma; Zod; Playwright; and Docker Compose. Keep frontend, backend, Prisma schema/migrations/seed, and browser tests in `apps/web`, `apps/api`, `prisma`, and `tests/e2e`. Document actual setup commands in `README.md`.

## Required Product Workflow

Institutions upload CSV/XLSX records or enter them manually; the backend validates fields, detects duplicates, and checks configured intake limits. Students independently access matched records to confirm or dispute details and submit supporting documents privately. OCR may extract fields, but never proves authenticity. Compare institution assertions, student assertions, and available evidence; create discrepancy cases with explanations and evidence references. Authorized reviewers investigate, request corrections, and record decisions. Corrections create new versions while preserving original submissions and audit history. AICTE dashboards show verified, unverified, pending, disputed, and reported records separately.

## Security & Data Integrity

Authentication and backend authorization are required for every protected route. Use the existing PostgreSQL-backed session design, Argon2id password hashes, `HttpOnly`/`SameSite=Strict` cookies, exact `APP_ORIGIN` checks on mutations, and login throttling. Derive institution and student scope from the authenticated database user; never trust student IDs, URL/body/header institution codes, or UI hiding as authorization. Keep institution users isolated from other institutions and students limited to their linked record. Apply Zod validation and bounded inputs to credentials and mutations.

Use only synthetic development data. Demo credentials and seed accounts must be clearly local-only; never seed them in production. Never commit secrets, expose password hashes/session IDs, or place private signing keys in frontend code. Missing student registration or response alone is not fraud; student confirmation is not official APAAR verification. Do not add APAAR, DigiLocker, or government integrations in this milestone. Preserve historical submissions, discrepancy values, provenance, and audit events; never silently overwrite them. Authentication remains a prototype without account provisioning, password reset/MFA, or verified institutional identity, so never describe it as ready for real student data.

## Development & Testing

Implement incrementally and check each milestone; do not generate the application in one untested pass. Consult official documentation when uncertain. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` when configured. Test new behavior and bug fixes with synthetic data. Report actual results, limitations, and incomplete integrations; claim no unrun checks.

## Local Development

Follow setup, demo account, migration, and check commands in `README.md` and keep them aligned with root `package.json` scripts. Use Docker Compose for local PostgreSQL and seed only synthetic data. Apply committed migrations with `npm run db:deploy`; create new migrations with `npm run db:migrate` only after checking the documented legacy migration-order issue. Production requires a managed `SESSION_SECRET`, exact HTTPS `APP_ORIGIN`, and correctly configured trusted TLS proxy hops. The default login rate limiter is in-memory and must use a shared store in multi-instance deployments. Never run `db:seed` in production.

## Style & Contributions

Follow TypeScript/framework conventions and configured formatting; use descriptive names. Exclude machine-specific paths and generated output. Use short, imperative commit subjects. Pull requests explain purpose and user impact, list checks run, link issues when available, and include screenshots for visual changes.
