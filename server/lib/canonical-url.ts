/**
 * Canonical URL resolution for Liberty Bancard.
 *
 * Priority order (highest to lowest):
 *   1. APP_URL env var — explicit owner override; always wins.
 *   2. REPLIT_DOMAINS env var — Replit injects the actual deployment host(s)
 *      in both dev and autoscale production environments. We take the first entry.
 *   3. libertybancard.com — safe static fallback when the app is deployed to
 *      the verified custom domain. Never used when running on Replit infra.
 *
 * Host-header injection is NEVER used to derive the canonical URL.
 */

let _resolved: string | null = null;
let _source: string | null = null;

export interface CanonicalUrlInfo {
  url: string;
  source: "APP_URL" | "REPLIT_DOMAINS" | "static_fallback";
  raw: string;
  warning?: string;
}

function resolve(): CanonicalUrlInfo {
  if (process.env.APP_URL) {
    const url = process.env.APP_URL.replace(/\/$/, "");
    return { url, source: "APP_URL", raw: process.env.APP_URL };
  }

  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) {
      const url = `https://${first}`;
      return { url, source: "REPLIT_DOMAINS", raw: process.env.REPLIT_DOMAINS };
    }
  }

  return {
    url: "https://libertybancard.com",
    source: "static_fallback",
    raw: "libertybancard.com",
    warning:
      "Neither APP_URL nor REPLIT_DOMAINS is set. " +
      "Email verification/reset links will point to libertybancard.com. " +
      "Set APP_URL=<your deployment URL> in Replit Secrets to fix.",
  };
}

export function getCanonicalUrl(): string {
  if (_resolved) return _resolved;
  const info = resolve();
  _resolved = info.url;
  _source = info.source;
  if (info.warning) console.warn("[CanonicalURL] ⚠️ ", info.warning);
  console.log(`[CanonicalURL] Resolved: ${info.url} (source: ${info.source})`);
  return _resolved;
}

export function getCanonicalUrlInfo(): CanonicalUrlInfo {
  return resolve();
}

/**
 * Build the CORS allowed-origins list.
 * ALLOWED_ORIGINS env var (comma-separated) always wins if present.
 * Otherwise, the canonical URL is the sole allowed origin.
 * localhost:* is added automatically in non-production environments.
 */
export function getCorsOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.push(o));
  } else {
    origins.push(getCanonicalUrl());
  }

  if (!process.env.NODE_ENV || process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:5000", "http://localhost:3000");
  }

  return origins;
}

/** Reset cached value (for tests only). */
export function _resetCanonicalUrlCache(): void {
  _resolved = null;
  _source = null;
}
