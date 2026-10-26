import dotenv from "dotenv";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  override: !["test", "production"].includes(process.env.NODE_ENV ?? "development"),
});

const confirmationFlag = "--confirm-empty-database";
if (!process.argv.includes(confirmationFlag)) {
  throw new Error(`Refusing to continue without ${confirmationFlag}. This command is for a new, empty database only.`);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to the new, empty database to bootstrap.");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const current = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  if (tables.rowCount !== 0) {
    const names = tables.rows.map(({ table_name }) => table_name).join(", ");
    throw new Error(`Refusing to bootstrap non-empty database ${current.rows[0]?.database_name ?? "(unknown)"}; found public tables: ${names}`);
  }

  console.info(`Bootstrapping empty database ${current.rows[0]?.database_name ?? "(unknown)"}.`);
} finally {
  await client.end();
}

const prisma = "node_modules/.bin/prisma";
const runPrisma = (args: string[]) => {
  const result = spawnSync(prisma, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma ${args[0]} failed${result.status === null ? "" : ` with exit code ${result.status}`}. The target is disposable; recreate it empty before retrying.`);
  }
};

// The historical student_review migration depends on tables from a later-named
// foundation migration. Apply and record foundation first without changing either file.
runPrisma(["db", "execute", "--file", "prisma/migrations/20261026000100_foundation/migration.sql"]);
runPrisma(["migrate", "resolve", "--applied", "20261026000100_foundation"]);
runPrisma(["migrate", "deploy"]);
