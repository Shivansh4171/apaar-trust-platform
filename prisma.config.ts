import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

dotenv.config({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
  override: !["test", "production"].includes(process.env.NODE_ENV ?? "development"),
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
