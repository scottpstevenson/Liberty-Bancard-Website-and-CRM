/**
 * audit-sanitizer.ts — Canonical audit/log payload sanitizer (C-13, #1626).
 *
 * Implementation baseline SHA: 7bcd11543843cd12b2e49db90fc010319ed49458
 *
 * sanitizeAuditPayload() strips known-sensitive keys (recipient addresses,
 * subjects, message bodies/previews, raw provider response bodies) from any
 * object before it is written to the audit-log tables or emitted in
 * operational console output.
 *
 * EXPLICIT EXEMPTION: `communication_events` records deliberately store
 * message content (subject/body/preview) as business data. That table's write
 * path (server/services/communication-events.ts) MUST NOT route through this
 * sanitizer, and this sanitizer must never be added there.
 *
 * Redaction strategy:
 *  - Sensitive string values are replaced with a safe token: first 3 chars +
 *    "***" (or "***" when shorter), preserving enough signal for debugging
 *    without exposing the PII itself.
 *  - Nested objects and arrays are traversed recursively (depth-capped).
 *  - Non-sensitive keys pass through untouched.
 */

const SENSITIVE_KEYS = new Set([
  "to",
  "from",
  "cc",
  "bcc",
  "subject",
  "body",
  "html",
  "text",
  "email",
  "phone",
  "mobile",
  "directphone",
  "message",
  "preview",
  "errtext",
  "rawbody",
  "responsebody",
  "providerresponse",
  "password",
  "token",
  "apikey",
  "authorization",
]);

/**
 * Error-message keys: raw provider response bodies are commonly propagated as
 * `err.message` and persisted under these keys. They are scrubbed rather than
 * token-redacted so operators keep diagnostic signal, but no provider body or
 * embedded PII can survive.
 */
const ERROR_KEYS = new Set(["error", "errormessage", "errmessage", "err", "errormsg"]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

const MAX_DEPTH = 8;
const MAX_ERROR_LEN = 160;

/**
 * Scrub an error-message string so raw provider-style content cannot survive:
 *  - Anything that looks like a structured provider body (JSON/HTML) is fully
 *    redacted to a token.
 *  - Otherwise embedded email addresses and phone numbers are removed and the
 *    string is truncated.
 */
export function scrubErrorString(value: string): string {
  if (!value) return value;
  if (/[{}<>]/.test(value)) return redactToken(value); // provider JSON/HTML body
  const scrubbed = value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
  return scrubbed.length > MAX_ERROR_LEN ? `${scrubbed.slice(0, MAX_ERROR_LEN)}…` : scrubbed;
}

/**
 * Normalize an audit entityKey: raw email addresses or phone numbers must
 * never be persisted as an entity key — redact them to a safe token. Names,
 * numeric IDs, and slug-style keys pass through.
 */
export function sanitizeEntityKey(key: string | null | undefined): string | null {
  if (key == null) return key ?? null;
  EMAIL_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  if (EMAIL_RE.test(key) || PHONE_RE.test(key)) return redactToken(key);
  return key;
}

/** Redact a string to a safe token: first 3 chars + "***". */
export function redactToken(value: string): string {
  if (!value) return "***";
  return value.length <= 3 ? "***" : `${value.slice(0, 3)}***`;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

/**
 * Strip/redact known-sensitive keys from an arbitrary payload before it is
 * persisted to audit tables or printed to operational logs.
 */
export function sanitizeAuditPayload(payload: unknown, depth = 0): unknown {
  if (payload == null) return payload;
  if (depth > MAX_DEPTH) return "[depth-capped]";

  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean" || typeof payload === "bigint") {
    return payload;
  }
  if (payload instanceof Date) return payload;

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeAuditPayload(item, depth + 1));
  }

  if (typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (ERROR_KEYS.has(normalizedKey)) {
        out[key] = typeof value === "string" ? scrubErrorString(value) : value == null ? value : "[redacted]";
      } else if (isSensitiveKey(key)) {
        if (typeof value === "string") {
          out[key] = redactToken(value);
        } else if (value == null) {
          out[key] = value;
        } else {
          out[key] = "[redacted]";
        }
      } else {
        out[key] = sanitizeAuditPayload(value, depth + 1);
      }
    }
    return out;
  }

  return payload;
}
