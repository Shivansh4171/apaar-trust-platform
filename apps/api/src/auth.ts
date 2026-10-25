import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import type { NextFunction, Request, Response } from "express";
import { PrismaClient, UserRole } from "./generated/prisma/client.js";
import { apiEnvironment } from "./config.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  studentRecordId: string | null;
  studentReference: string | null;
}

const pgSession = connectPgSimple(session);
const sessionPool = new Pool({ connectionString: apiEnvironment.DATABASE_URL, max: 5 });
const sessionStore = new pgSession({
  pool: sessionPool,
  tableName: "AuthSession",
  createTableIfMissing: false,
  pruneSessionInterval: 15 * 60,
});

export const sessionMiddleware = session({
  name: "apaar.sid",
  secret: apiEnvironment.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  unset: "destroy",
  cookie: {
    httpOnly: true,
    secure: apiEnvironment.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  },
});

export function requireSameOrigin(request: Request, response: Response, next: NextFunction) {
  if (request.get("origin") !== apiEnvironment.APP_ORIGIN) {
    response.status(403).json({ error: "invalid_origin", message: "The request origin is not allowed." });
    return;
  }
  next();
}

export function requireAuthentication(prisma: PrismaClient) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const userId = request.session.userId;
    if (!userId) {
      response.status(401).json({ error: "authentication_required", message: "Sign in to continue." });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          active: true,
          institutionId: true,
          studentRecordId: true,
          institution: { select: { name: true, code: true } },
          studentRecord: { select: { reference: true } },
        },
      });
      if (!user?.active) {
        request.session.destroy(() => undefined);
        response.status(401).json({ error: "authentication_required", message: "Sign in to continue." });
        return;
      }

      request.authUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId,
        institutionName: user.institution?.name ?? null,
        institutionCode: user.institution?.code ?? null,
        studentRecordId: user.studentRecordId,
        studentReference: user.studentRecord?.reference ?? null,
      };
      next();
    } catch {
      response.status(503).json({ error: "authentication_unavailable", message: "Authentication is temporarily unavailable." });
    }
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authUser) {
      response.status(401).json({ error: "authentication_required", message: "Sign in to continue." });
      return;
    }
    if (!roles.includes(request.authUser.role)) {
      response.status(403).json({ error: "forbidden", message: "Your account cannot perform this action." });
      return;
    }
    next();
  };
}

export function authenticatedUser(request: Request): AuthenticatedUser {
  if (!request.authUser) throw new Error("Authentication middleware was not applied.");
  return request.authUser;
}
