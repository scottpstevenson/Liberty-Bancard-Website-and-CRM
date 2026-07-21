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
 *
 * Priority / inclusion rules:
 *   1. ALLOWED_ORIGINS env var (comma-separated) — explicit override; always wins.
 *      In production, non-HTTPS entries are rejected with a warning.
 *   2. Canonical URL (APP_URL or first REPLIT_DOMAINS entry) — always included.
 *   3. ALL REPLIT_DOMAINS entries — Replit can inject multiple domains
 *      (e.g. autoscale host + custom domain); all should be trusted.
 *   4. localhost variants — added automatically in non-production only.
 *
 * To allow dev.libertybancard.com or similar staging surfaces in production,
 * set: ALLOWED_ORIGINS=https://libertybancard.com,https://dev.libertybancard.com
 */
export function getCorsOrigins(): string[] {
  const isProd = process.env.NODE_ENV === "production";
  const origins = new Set<string>();

  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => {
        if (isProd && !o.startsWith("https://")) {
          console.warn(`[CORS] ⚠ Rejected non-HTTPS origin in ALLOWED_ORIGINS (production): ${o}`);
          return;
        }
        origins.add(o);
      });
  }

  // Always include the canonical URL (won't duplicate if already in ALLOWED_ORIGINS).
  origins.add(getCanonicalUrl());

  // Include ALL REPLIT_DOMAINS entries. Replit may inject multiple hostnames
  // (autoscale deployment host, custom domain, preview host). Only the first is
  // used for the canonical URL — but all should be trusted for CORS.
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .forEach((d) => origins.add(`https://${d}`));
  }

  if (!isProd) {
    origins.add("http://localhost:5000");
    origins.add("http://localhost:3000");
  }

  const list = Array.from(origins);
  if (isProd) {
    console.log(`[CORS] Allowed origins (${list.length}): ${list.join(", ")}`);
  }
  return list;
}

/** Reset cached value (for tests only). */
export function _resetCanonicalUrlCache(): void {
  _resolved = null;
  _source = null;
}
