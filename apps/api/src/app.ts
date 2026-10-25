import express, { type ErrorRequestHandler } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { apiEnvironment } from "./config.js";
import { createInstitutionRouter, csvUploadErrorHandler } from "./routes/institution.js";
import { createStudentRouter } from "./routes/student.js";

const adapter = new PrismaPg({ connectionString: apiEnvironment.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "apaar-api",
      environment: apiEnvironment.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/ready", async (_request, response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      response.json({ status: "ready", database: "connected" });
    } catch {
      response.status(503).json({ status: "not_ready", database: "unavailable" });
    }
  });

  app.use("/api/institution", createInstitutionRouter(prisma));
  app.use("/api/student", createStudentRouter(prisma));
  app.use(csvUploadErrorHandler);
  app.use(((error, _request, response, _next) => {
    console.error("Unhandled API request error.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    response.status(500).json({ error: "internal_error", message: "The request could not be completed." });
  }) satisfies ErrorRequestHandler);

  return app;
}
