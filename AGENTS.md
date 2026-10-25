# Repository Guidelines

## Project Purpose

Build the SIH 2026 solution for Problem Statement 26263: an APAAR ID-based student data management and verification platform for AICTE-approved institutions. Its core value is independent student–institution cross-verification, explainable discrepancy detection, and auditable correction workflows.

## Project Structure & Technology

Use React, Vite, TypeScript, Tailwind CSS; Node.js, Express, TypeScript; PostgreSQL with Prisma; Zod; Playwright; and Docker Compose. Keep frontend, backend, Prisma schema/migrations/seed, and browser tests in `apps/web`, `apps/api`, `prisma`, and `tests/e2e`. Document actual setup commands in `README.md`.

## Required Product Workflow

Institutions upload CSV/XLSX records or enter them manually; the backend validates fields, detects duplicates, and checks configured intake limits. Students independently access matched records to confirm or dispute details and submit supporting documents privately. OCR may extract fields, but never proves authenticity. Compare institution assertions, student assertions, and available evidence; create discrepancy cases with explanations and evidence references. Authorized reviewers investigate, request corrections, and record decisions. Corrections create new versions while preserving original submissions and audit history. AICTE dashboards show verified, unverified, pending, disputed, and reported records separately.

## Security & Data Integrity

Enforce backend role-based access control and institution-level isolation at API and database boundaries. If authentication is not implemented, label demo institution selectors as unauthenticated and never claim production security. Keep documents private and use only synthetic development data. Never commit secrets or place private signing keys in frontend code. Missing student registration alone is not fraud; student confirmation is not official APAAR verification. Label simulated government integrations clearly. Preserve historical submissions, provenance, and audit events; never silently overwrite them.

## Development & Testing

Implement incrementally and check each milestone; do not generate the application in one untested pass. Consult official documentation when uncertain. Run configured type checks, lint, tests, and builds for changed areas. Test new behavior and bug fixes with synthetic data. Report actual results, limitations, and incomplete integrations; claim no unrun checks.

## Local Development

Follow setup and check commands in `README.md` and keep them aligned with root `package.json` scripts. Use Docker Compose for local PostgreSQL and seed only synthetic data.

## Style & Contributions

Follow TypeScript/framework conventions and configured formatting; use descriptive names. Exclude machine-specific paths and generated output. Use short, imperative commit subjects. Pull requests explain purpose and user impact, list checks run, link issues when available, and include screenshots for visual changes.
