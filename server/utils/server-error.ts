import type { Response } from "express";

/**
 * Returns "Internal server error" in production, or the given message in
 * development/test.  Use this when you need to preserve a specific response
 * shape (e.g. `{ ok: false, error: safeMessage(...) }`) rather than calling
 * serverError() which always uses `{ message: ... }`.
 *
 * The caller is responsible for logging the original value before calling this.
 */
export function safeMessage(msg: string | undefined | null, fallback = "Internal server error"): string {
  if (process.env.NODE_ENV === "production") return fallback;
  return msg || fallback;
}

/**
 * Sends a sanitized 500 response.
 *
 * - Always logs the full error server-side.
 * - In production, returns the generic message "Internal server error" so raw
 *   Postgres error details (table names, constraint names, query fragments,
 *   stack traces) are never exposed to the browser.
 * - In development / test, returns the full err.message for easier debugging.
 *
 * @param res     Express Response object
 * @param err     The caught error (any)
 * @param context Optional label prepended to the server-side log line, e.g. "GET /api/contacts"
 */
export function serverError(res: Response, err: unknown, context?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const label = context ? `[${context}] ` : "";
  console.error(`${label}Internal server error:`, err);

  const isProduction = process.env.NODE_ENV === "production";
  res.status(500).json({
    message: isProduction ? "Internal server error" : message,
  });
}
