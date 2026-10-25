import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client.js";
import { authenticatedUser, requireAuthentication } from "../auth.js";
import { loginSchema } from "../services/auth.js";

const dummyPasswordHash = await argon2.hash(randomBytes(32).toString("base64url"), { type: argon2.argon2id });

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

export function createAuthRouter(prisma: PrismaClient): Router {
  const router = Router();
  const loginThrottle = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === "production" ? 20 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "login_throttled", message: "Too many sign-in attempts. Wait before trying again." },
  });

  router.post("/login", loginThrottle, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_credentials", message: "Enter a valid email and password." });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, passwordHash: true, active: true },
      });
      const validPassword = await argon2.verify(user?.passwordHash ?? dummyPasswordHash, parsed.data.password).catch(() => false);
      if (!user || !user.active || !validPassword) {
        response.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect." });
        return;
      }

      await regenerateSession(request);
      request.session.userId = user.id;
      await saveSession(request);
      response.json({ user: authenticatedUserSummary(await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          institutionId: true,
          studentRecordId: true,
          institution: { select: { name: true, code: true } },
          studentRecord: { select: { reference: true } },
        },
      })) });
    } catch {
      response.status(503).json({ error: "login_unavailable", message: "Sign-in is temporarily unavailable." });
    }
  });

  router.get("/me", requireAuthentication(prisma), (request, response) => {
    response.json({ user: authenticatedUser(request) });
  });

  router.post("/logout", (request, response) => {
    request.session.destroy((error) => {
      response.clearCookie("apaar.sid", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
      if (error) {
        response.status(503).json({ error: "logout_unavailable", message: "Sign-out could not be completed." });
        return;
      }
      response.status(204).end();
    });
  });

  return router;
}

function authenticatedUserSummary(user: {
  id: string;
  email: string;
  role: string;
  institutionId: string | null;
  studentRecordId: string | null;
  institution: { name: string; code: string } | null;
  studentRecord: { reference: string } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institutionId,
    institutionName: user.institution?.name ?? null,
    institutionCode: user.institution?.code ?? null,
    studentRecordId: user.studentRecordId,
    studentReference: user.studentRecord?.reference ?? null,
  };
}
