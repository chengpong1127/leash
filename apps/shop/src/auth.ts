/** The shop's own, ordinary email + password login. Nothing here knows about Leash. */
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { type User, db } from "./db";
import { verifyPassword } from "./password";

// Cookies on localhost are shared across ports, so each app uses its own cookie name.
const COOKIE = "shop_session";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Attach `req.user` when the session cookie is valid. */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const sessionId = readCookie(req, COOKIE);
  if (sessionId) {
    req.user = db
      .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?")
      .get(sessionId, Date.now()) as User | undefined;
  }
  next();
}

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();
  res.redirect(303, `/login?next=${encodeURIComponent(req.method === "GET" ? req.originalUrl : "/")}`);
}

export function login(res: Response, email: string, password: string): boolean {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as User | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) return false;
  const sessionId = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, user.id, Date.now() + WEEK_MS);
  res.cookie(COOKIE, sessionId, { httpOnly: true, sameSite: "lax", maxAge: WEEK_MS, path: "/" });
  return true;
}

export function logout(req: Request, res: Response) {
  const sessionId = readCookie(req, COOKIE);
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  res.clearCookie(COOKIE, { path: "/" });
}

/** Only follow `next` to a local path. */
export const safeNext = (value: unknown) => (typeof value === "string" && /^\/(?!\/)/.test(value) ? value : "/");
