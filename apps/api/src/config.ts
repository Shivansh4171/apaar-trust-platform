import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const useLocalEnvironmentFile = !["test", "production"].includes(process.env.NODE_ENV ?? "development");

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  override: useLocalEnvironmentFile,
});

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://")),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidFields = [...new Set(parsedEnvironment.error.issues.map((issue) => issue.path.join(".")))];
  throw new Error(`Invalid API configuration (${invalidFields.join(", ") || "environment"}). Check .env or process environment.`);
}

export const apiEnvironment = parsedEnvironment.data;
