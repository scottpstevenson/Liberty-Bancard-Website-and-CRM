import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
const TOKEN_LENGTH = 32;

const EXEMPT_PATH_PREFIXES = [
  "/api/public/",
  "/api/webhooks/",
  "/api/nps/",
  "/api/review-requests/",
];

const EXEMPT_PATHS_EXACT = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/totp/verify-login",
  "/api/auth/logout",
  "/api/partner/login",
  "/api/partner/logout",
  "/api/partner/reset-password-request",
  "/api/partner/reset-password",
  "/api/partner-apply",
  "/api/partner-org/login",
  "/api/partner-org/logout",
  "/api/partners/login",
  "/api/partners/forgot-password",
  "/api/partners/reset-password",
  "/api/partners/set-password",
  "/api/auth/portal-invite/activate",
  "/api/affiliate/login",
  "/api/affiliate/signup",
  "/api/affiliate/logout",
  "/api/affiliate/track-click",
  "/api/contacts/public",
  "/api/statements/upload",
  "/api/equipment-order",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isExempt(req: Request): boolean {
  const path = req.path;

  if (SAFE_METHODS.has(req.method)) return true;

  if (EXEMPT_PATHS_EXACT.has(path)) return true;

  for (const prefix of EXEMPT_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }

  return false;
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString("hex");
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  let cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (!cookieToken) {
    cookieToken = generateToken();
    res.cookie(CSRF_COOKIE_NAME, cookieToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }

  if (isExempt(req)) return next();

  if (!req.isAuthenticated || !req.isAuthenticated()) return next();

  const headerToken = req.header(CSRF_HEADER_NAME);

  if (!headerToken || !cookieToken) {
    return res.status(403).json({
      message: "CSRF token missing",
      code: "csrf_missing",
    });
  }

  try {
    const expected = Buffer.from(cookieToken, "utf8");
    const received = Buffer.from(headerToken, "utf8");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(403).json({
        message: "CSRF token mismatch",
        code: "csrf_mismatch",
      });
    }
  } catch {
    return res.status(403).json({
      message: "CSRF token invalid",
      code: "csrf_invalid",
    });
  }

  next();
}

export function csrfTokenEndpoint(req: Request, res: Response) {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token) {
    token = generateToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }
  res.json({ token });
}
