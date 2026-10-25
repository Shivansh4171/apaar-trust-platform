import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
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
  SESSION_SECRET: z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional()),
  APP_ORIGIN: z.string().url().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidFields = [...new Set(parsedEnvironment.error.issues.map((issue) => issue.path.join(".")))];
  throw new Error(`Invalid API configuration (${invalidFields.join(", ") || "environment"}). Check .env or process environment.`);
}

if (parsedEnvironment.data.NODE_ENV === "production") {
  const missing = [
    !parsedEnvironment.data.SESSION_SECRET && "SESSION_SECRET",
    !parsedEnvironment.data.APP_ORIGIN && "APP_ORIGIN",
    parsedEnvironment.data.TRUST_PROXY_HOPS < 1 && "TRUST_PROXY_HOPS",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Invalid API configuration (${missing.join(", ")}). Set production session and trusted proxy configuration.`);
}

export const apiEnvironment = {
  ...parsedEnvironment.data,
  SESSION_SECRET: parsedEnvironment.data.SESSION_SECRET ?? randomBytes(48).toString("base64url"),
  APP_ORIGIN: parsedEnvironment.data.APP_ORIGIN ?? "http://localhost:5173",
};
