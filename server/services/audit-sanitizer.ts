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
 * Merchant-application protected fields are also covered: tax identifiers
 * (EIN/tax id), SSNs, dates of birth, and bank/ACH details (routing, account,
 * bank name/type) are redacted by key. Encrypted/tokenized representations of
 * those values (ciphertext, fingerprint, hash) are treated as equally
 * sensitive and never emitted raw. Owner/beneficial-owner/principal and
 * bank-info subtrees are redacted wholesale and recursively so no descendant
 * value can leak through a child key that has not been individually
 * enumerated.
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
  // --- Merchant application protected fields ---
  // Government/tax identifiers
  "ein",
  "taxid",
  "federaltaxid",
  "ssn",
  "socialsecuritynumber",
  "ssnentered",
  // Dates of birth
  "dob",
  "dateofbirth",
  "ownerdob",
  "birthdate",
  // Bank / ACH details
  "routingnumber",
  "routing",
  "accountnumber",
  "account",
  "bankaccountnumber",
  "bankroutingnumber",
  "bankname",
  "bankaccounttype",
  "bankaccount",
  "aba",
  "iban",
  "swift",
  // Owner sensitive fields
  "ownerssn",
  "ownertaxid",
  // Encrypted / tokenized representations of sensitive values must never
  // be emitted raw either — they are as sensitive as (or a handle to) the plaintext.
  "ciphertext",
  "cipher",
  "encrypted",
  "encrypteddata",
  // Specific protected-data fingerprint columns — redacted as sensitive handles.
  "einfingerprint",
  "ssnfingerprint",
  "bankaccountfingerprint",
  // Generic fingerprint/hash keys (not *Mask keys — masks are safe operational metadata).
  "fingerprint",
  "hash",
]);

/**
 * Keys whose entire nested subtree contains merchant PII (owner identity,
 * banking, tax) and must be redacted wholesale rather than traversed. This
 * guarantees that arbitrarily-shaped nested owner/bank payloads cannot leak a
 * sensitive value through a not-yet-enumerated child key.
 */
const SENSITIVE_SUBTREE_KEYS = new Set([
  "owner",
  "owners",
  "beneficialowner",
  "beneficialowners",
  "principal",
  "principals",
  // additionalOwners and snake_case variant are explicitly protected merchant-app
  // fields containing nested SSNs, DOBs, and identity data. Treat the entire
  // subtree as sensitive wholesale — any descendant key may contain PII.
  "additionalowners",
  "additional_owners",
  "bankinfo",
  "bankinformation",
  "bankaccount",
  "bankdetails",
  "achinfo",
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
const MAX_CHANNEL_AUDIT_TEXT_LEN = 500;
const MAX_CHANNEL_AUDIT_SNAPSHOT_CHARS = 10_000;

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

/**
 * Sanitize free-form channel-audit text. Channel audit rows are operational
 * metadata, not communication content, so values are scrubbed, whitespace is
 * normalized, and length is bounded before persistence or presentation.
 */
export function sanitizeChannelAuditText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  const scrubbed = scrubErrorString(value).replace(/\s+/g, " ").trim();
  return scrubbed.length > MAX_CHANNEL_AUDIT_TEXT_LEN
    ? `${scrubbed.slice(0, MAX_CHANNEL_AUDIT_TEXT_LEN)}…`
    : scrubbed;
}

/**
 * Sanitize a channel checklist snapshot at its dedicated audit boundary. The
 * snapshot is not communication_events business content; it must remain
 * bounded and safe for both admin reads and CSV/PDF exports.
 */
export function sanitizeChannelAuditSnapshot(snapshot: unknown): unknown {
  const sanitized = sanitizeAuditPayload(snapshot);
  try {
    return JSON.stringify(sanitized).length > MAX_CHANNEL_AUDIT_SNAPSHOT_CHARS
      ? { truncated: true, reason: "snapshot_too_large" }
      : sanitized;
  } catch {
    return { truncated: true, reason: "snapshot_not_serializable" };
  }
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

function isSensitiveSubtreeKey(key: string): boolean {
  return SENSITIVE_SUBTREE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

/**
 * Fully redact a value (any shape) to a safe, structure-agnostic representation
 * so no raw sensitive value survives, even inside deeply nested owner/bank
 * subtrees. Scalars become a token; objects/arrays are traversed with EVERY
 * child key forced through sensitive-key redaction.
 */
function redactSensitiveSubtree(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[depth-capped]";
  if (typeof value === "string") return redactToken(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return "[redacted]";
  }
  if (value instanceof Date) return "[redacted]";
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveSubtree(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = v == null ? v : redactSensitiveSubtree(v, depth + 1);
    }
    return out;
  }
  return "[redacted]";
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
      } else if (isSensitiveSubtreeKey(key)) {
        // Wholesale-redact owner/bank/principal subtrees: every descendant is
        // treated as sensitive regardless of child key name.
        out[key] = value == null ? value : redactSensitiveSubtree(value, depth + 1);
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

/**
 * DLQ rows are an operator index, not an error dump.  Unlike the general audit
 * sanitizer this is deliberately an allowlist: new fields in a job payload
 * cannot become visible merely because nobody has added them to a denylist.
 */
const DLQ_SAFE_FIELDS = new Set([
  "eventversion", "jobid", "queuename", "jobname", "failurecode",
  "attempts", "maxattempts", "occurredat", "source", "retryable",
]);
const DLQ_SAFE_STRING = /^[a-zA-Z0-9_.:-]{1,128}$/;

export type DeadLetterEventSnapshot = {
  eventVersion: 1;
  jobId: number | null;
  queueName: string | null;
  jobName: string | null;
  failureCode: string;
  attempts: number | null;
  maxAttempts: number | null;
  occurredAt: string | null;
  source: string | null;
  retryable: boolean | null;
};

/** Return only stable, non-identifying DLQ diagnostics. Never include errors. */
export function sanitizeDeadLetterEvent(value: unknown): DeadLetterEventSnapshot {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const get = (key: string) => input[key];
  const safeText = (key: string): string | null => {
    if (!DLQ_SAFE_FIELDS.has(key.toLowerCase()) || typeof get(key) !== "string") return null;
    const text = get(key) as string;
    return DLQ_SAFE_STRING.test(text) && !/https?:|@|\/|stack|error|payload|body/i.test(text) ? text : null;
  };
  const safeInt = (key: string): number | null => {
    const value = get(key);
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  return {
    eventVersion: 1,
    jobId: safeInt("jobId"),
    queueName: safeText("queueName"),
    jobName: safeText("jobName"),
    failureCode: safeText("failureCode") ?? "unknown",
    attempts: safeInt("attempts"),
    maxAttempts: safeInt("maxAttempts"),
    occurredAt: safeText("occurredAt"),
    source: safeText("source"),
    retryable: typeof get("retryable") === "boolean" ? get("retryable") as boolean : null,
  };
}
