/**
 * Merchant Application Protected-Data Service
 * ============================================
 * Domain-scoped AES-256-GCM authenticated encryption for the strict
 * merchant-application PII/financial fields (EIN, SSN, DOB, bank routing /
 * account numbers, and recursively any `additionalOwners`).
 *
 * Design constraints (strict):
 *   - Uses MERCHANT_DATA_ENCRYPTION_KEY ONLY. It does NOT fall back to any
 *     other key (never CREDENTIAL_ENCRYPTION_KEY). Missing/invalid key blocks
 *     protected-data writes and reads.
 *   - Ciphertext is versioned (scheme prefix) so the algorithm can migrate.
 *   - Additional Authenticated Data (AAD) binds each ciphertext to the owning
 *     applicationId AND field path. Ciphertext copied to a different field or
 *     application fails authentication and will NOT decrypt.
 *   - "Strict no plaintext decrypt": a value with no recognised scheme prefix
 *     is treated as an error, NOT silently returned as plaintext.
 *   - Fingerprints are non-reversible keyed HMAC-SHA256 (keyed with the same
 *     merchant key) used only for equality / dedup lookups.
 *   - Masks are display-safe (never plaintext).
 *
 * Storage / envelope format:
 *   mpd_v1:<applicationId>:<fieldPath_b64url>:<iv_b64>:<tag_b64>:<ct_b64>
 *   The applicationId + fieldPath are embedded (and also fed as AAD) so the
 *   envelope self-describes its binding and tampering is detected.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";

const SCHEME_VERSION = 1;
const SCHEME_PREFIX = "mpd_v1:";
const ALGO = "aes-256-gcm";
const KEY_GATE_NAME = "MERCHANT_DATA_ENCRYPTION_KEY";
const FINGERPRINT_DOMAIN = "merchant-application:fingerprint:v1";

export const MERCHANT_PROTECTED_DATA_VERSION = SCHEME_VERSION;

// ── Key resolution (MERCHANT_DATA_ENCRYPTION_KEY only) ──────────────────────

function resolveKeyBuffer(): Buffer | null {
  const raw = process.env.MERCHANT_DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const fromB64 = Buffer.from(trimmed, "base64");
  if (fromB64.length === 32) return fromB64;
  console.error(
    `[MerchantProtectedData] ${KEY_GATE_NAME} is set but is not a valid 32-byte key ` +
    `(64-char hex or 44-char base64). Protected-data operations are BLOCKED until corrected.`,
  );
  return null;
}

function requireKey(): Buffer {
  const key = resolveKeyBuffer();
  if (!key) {
    throw new Error(
      `${KEY_GATE_NAME} is not set or invalid — merchant protected data cannot be processed. ` +
      `Add a 32-byte key (64 hex chars or 44 base64 chars) to Secrets and restart.`,
    );
  }
  return key;
}

/** True only when a valid MERCHANT_DATA_ENCRYPTION_KEY is present. */
export function isMerchantEncryptionAvailable(): boolean {
  return resolveKeyBuffer() !== null;
}

// ── AAD binding ─────────────────────────────────────────────────────────────

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function aadFor(applicationId: number, fieldPath: string): Buffer {
  // Domain-scoped, binds scheme + application + field so ciphertext is
  // non-transferable across fields or applications.
  return Buffer.from(`${SCHEME_PREFIX}${applicationId}:${fieldPath}`, "utf8");
}

// ── Core encrypt / decrypt (single string field) ────────────────────────────

/**
 * Encrypt a single plaintext field, bound to (applicationId, fieldPath) via AAD.
 * Returns a self-describing versioned envelope string.
 */
export function encryptField(applicationId: number, fieldPath: string, plaintext: string): string {
  const key = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aadFor(applicationId, fieldPath));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME_PREFIX.slice(0, -1), // "mpd_v1"
    String(applicationId),
    b64url(fieldPath),
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** True if a value is a recognised protected-data envelope. */
export function isEncryptedEnvelope(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(SCHEME_PREFIX);
}

/**
 * Decrypt a protected-data envelope. STRICT: throws if the value is not a
 * recognised envelope (no silent plaintext passthrough), if the key is
 * missing, or if the AAD binding (applicationId/fieldPath) does not match.
 */
export function decryptField(applicationId: number, fieldPath: string, stored: string): string {
  if (!isEncryptedEnvelope(stored)) {
    throw new Error(
      "[MerchantProtectedData] Refusing to decrypt: value is not a recognised protected-data envelope (strict no-plaintext).",
    );
  }
  const key = requireKey();
  // mpd_v1:<appId>:<fieldPath_b64url>:<iv>:<tag>:<ct>
  const parts = stored.split(":");
  if (parts.length !== 6) {
    throw new Error("[MerchantProtectedData] Malformed protected-data envelope (expected 6 parts).");
  }
  const [, appIdStr, fieldB64, ivB64, tagB64, ctB64] = parts;
  const embeddedAppId = Number(appIdStr);
  const embeddedField = Buffer.from(fieldB64, "base64url").toString("utf8");
  if (embeddedAppId !== applicationId || embeddedField !== fieldPath) {
    throw new Error(
      "[MerchantProtectedData] Envelope binding mismatch (applicationId/field) — refusing to decrypt.",
    );
  }
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAAD(aadFor(applicationId, fieldPath));
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString("utf8") + decipher.final("utf8");
  } catch (err: any) {
    throw new Error(
      `[MerchantProtectedData] Decryption failed (key mismatch, tampering, or AAD mismatch): ${err?.message ?? err}`,
    );
  }
}

// ── Fingerprints (keyed HMAC, non-reversible) ───────────────────────────────

/**
 * Deterministic, non-reversible fingerprint over a normalized value, keyed
 * with the merchant key and domain-separated. Suitable for equality/dedup
 * indexes; NOT reversible to plaintext.
 */
export function fingerprint(normalizedValue: string): string {
  const key = requireKey();
  return createHmac("sha256", key)
    .update(FINGERPRINT_DOMAIN)
    .update("\x00")
    .update(normalizedValue)
    .digest("hex");
}

/** Constant-time compare of two fingerprints. */
export function fingerprintsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Normalization & validation ──────────────────────────────────────────────

export class ProtectedDataValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`[MerchantProtectedData] ${field}: ${message}`);
    this.name = "ProtectedDataValidationError";
    this.field = field;
  }
}

const digitsOnly = (v: string): string => (v ?? "").replace(/\D+/g, "");

/** EIN: 9 digits (NN-NNNNNNN). Returns canonical 9-digit string. */
export function normalizeEin(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length !== 9) throw new ProtectedDataValidationError("ein", "must be 9 digits");
  return d;
}

/** SSN: 9 digits. Rejects obviously invalid patterns. */
export function normalizeSsn(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length !== 9) throw new ProtectedDataValidationError("ssn", "must be 9 digits");
  const area = d.slice(0, 3);
  const group = d.slice(3, 5);
  const serial = d.slice(5);
  if (area === "000" || area === "666" || Number(area) >= 900) {
    throw new ProtectedDataValidationError("ssn", "invalid area number");
  }
  if (group === "00" || serial === "0000") {
    throw new ProtectedDataValidationError("ssn", "invalid group/serial");
  }
  return d;
}

/** DOB: normalize to ISO YYYY-MM-DD; rejects impossible/future dates. */
export function normalizeDob(raw: string): string {
  const s = (raw ?? "").trim();
  let iso: string | null = null;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (isoMatch) {
    iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  } else if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if (!iso) throw new ProtectedDataValidationError("dob", "unrecognized date format (use YYYY-MM-DD)");
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) throw new ProtectedDataValidationError("dob", "invalid date");
  // Round-trip check to reject overflow like 2000-02-31.
  if (dt.toISOString().slice(0, 10) !== iso) {
    throw new ProtectedDataValidationError("dob", "invalid calendar date");
  }
  if (dt.getTime() > Date.now()) throw new ProtectedDataValidationError("dob", "cannot be in the future");
  return iso;
}

/** US bank routing number: 9 digits with ABA checksum. */
export function normalizeRouting(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length !== 9) throw new ProtectedDataValidationError("routing", "must be 9 digits");
  const digits = d.split("").map(Number);
  const checksum =
    3 * (digits[0] + digits[3] + digits[6]) +
    7 * (digits[1] + digits[4] + digits[7]) +
    1 * (digits[2] + digits[5] + digits[8]);
  if (checksum % 10 !== 0) throw new ProtectedDataValidationError("routing", "failed ABA checksum");
  return d;
}

/** Bank account number: 4–17 digits. */
export function normalizeAccount(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length < 4 || d.length > 17) {
    throw new ProtectedDataValidationError("account", "must be 4–17 digits");
  }
  return d;
}

// ── Masks (display-safe) ─────────────────────────────────────────────────────

function maskTail(normalized: string, visible: number): string {
  if (normalized.length <= visible) return "•".repeat(normalized.length);
  return "•".repeat(normalized.length - visible) + normalized.slice(-visible);
}

export function maskEin(normalizedEin: string): string {
  // XX-XXX####
  return `••-•••${normalizedEin.slice(-4)}`;
}
export function maskSsn(normalizedSsn: string): string {
  return `•••-••-${normalizedSsn.slice(-4)}`;
}
export function maskAccount(normalizedAccount: string): string {
  return maskTail(normalizedAccount, 4);
}
export function maskRouting(normalizedRouting: string): string {
  return maskTail(normalizedRouting, 4);
}

// ── Whole-application protected-data processing ─────────────────────────────

export interface ProtectedFieldResult {
  ein?: { ciphertext: string; fingerprint: string; mask: string };
  ssn?: { ciphertext: string; fingerprint: string; mask: string };
  dob?: { ciphertext: string };
  routing?: { ciphertext: string; mask: string };
  account?: { ciphertext: string; fingerprint: string; mask: string };
  additionalOwners?: { ciphertext: string; count: number };
  version: number;
  metadata: Record<string, unknown>;
}

/**
 * Recursively normalize the sensitive leaves of an additionalOwners structure
 * (ssn, dob) before the whole object is encrypted as one envelope. We encrypt
 * the FULL nested object (not per-leaf) so structure is preserved and no
 * plaintext leaks; normalization guarantees canonical, validated inputs.
 */
function normalizeAdditionalOwners(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeAdditionalOwners(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (typeof v === "string" && v.trim() !== "") {
        try {
          if (lower === "ssn") { out[k] = normalizeSsn(v); continue; }
          if (lower === "dob" || lower === "dateofbirth") { out[k] = normalizeDob(v); continue; }
          if (lower === "ein") { out[k] = normalizeEin(v); continue; }
        } catch {
          // Fall through: keep as-is if it does not match expected sensitive shape.
        }
        out[k] = v;
      } else {
        out[k] = normalizeAdditionalOwners(v);
      }
    }
    return out;
  }
  return value;
}

function countOwners(value: unknown): number {
  return Array.isArray(value) ? value.length : value ? 1 : 0;
}

export interface RawProtectedInput {
  ein?: string | null;
  ssn?: string | null;
  dob?: string | null;
  routing?: string | null;
  account?: string | null;
  additionalOwners?: unknown;
}

/**
 * Normalize, validate, encrypt, fingerprint, and mask all protected fields for
 * an application. Only fields present (non-empty) are processed. Encryption is
 * bound to the applicationId via AAD.
 */
export function processProtectedData(applicationId: number, input: RawProtectedInput): ProtectedFieldResult {
  requireKey(); // fail fast before doing any work
  const result: ProtectedFieldResult = {
    version: SCHEME_VERSION,
    metadata: { scheme: SCHEME_PREFIX.slice(0, -1), algo: ALGO, fields: [] as string[] },
  };
  const touched = result.metadata.fields as string[];

  if (input.ein != null && String(input.ein).trim() !== "") {
    const n = normalizeEin(String(input.ein));
    result.ein = {
      ciphertext: encryptField(applicationId, "ein", n),
      fingerprint: fingerprint(`ein:${n}`),
      mask: maskEin(n),
    };
    touched.push("ein");
  }

  if (input.ssn != null && String(input.ssn).trim() !== "") {
    const n = normalizeSsn(String(input.ssn));
    result.ssn = {
      ciphertext: encryptField(applicationId, "ownerSsn", n),
      fingerprint: fingerprint(`ssn:${n}`),
      mask: maskSsn(n),
    };
    touched.push("ownerSsn");
  }

  if (input.dob != null && String(input.dob).trim() !== "") {
    const n = normalizeDob(String(input.dob));
    result.dob = { ciphertext: encryptField(applicationId, "ownerDob", n) };
    touched.push("ownerDob");
  }

  if (input.routing != null && String(input.routing).trim() !== "") {
    const n = normalizeRouting(String(input.routing));
    result.routing = {
      ciphertext: encryptField(applicationId, "bankRoutingNumber", n),
      mask: maskRouting(n),
    };
    touched.push("bankRoutingNumber");
  }

  if (input.account != null && String(input.account).trim() !== "") {
    const n = normalizeAccount(String(input.account));
    result.account = {
      ciphertext: encryptField(applicationId, "bankAccountNumber", n),
      fingerprint: fingerprint(`account:${n}`),
      mask: maskAccount(n),
    };
    touched.push("bankAccountNumber");
  }

  if (input.additionalOwners != null && countOwners(input.additionalOwners) > 0) {
    const normalized = normalizeAdditionalOwners(input.additionalOwners);
    const serialized = JSON.stringify(normalized);
    result.additionalOwners = {
      ciphertext: encryptField(applicationId, "additionalOwners", serialized),
      count: countOwners(input.additionalOwners),
    };
    touched.push("additionalOwners");
  }

  return result;
}

/**
 * Decrypt the nested additionalOwners envelope back to its object form.
 * STRICT: throws on any non-envelope or binding mismatch.
 */
export function decryptAdditionalOwners(applicationId: number, ciphertext: string): unknown {
  const json = decryptField(applicationId, "additionalOwners", ciphertext);
  return JSON.parse(json);
}

// ── Application-level helpers ─────────────────────────────────────────────

/**
 * Fields in a MerchantApplication row that are protected (encrypted or masked).
 * Kept as a type alias so callers can depend on it without importing the full schema.
 */
export interface ApplicationRecord {
  id: number;
  ein?: string | null;
  ownerDob?: string | null;
  ownerSsn?: string | null;
  bankRoutingNumber?: string | null;
  bankAccountNumber?: string | null;
  additionalOwners?: unknown;
  // Persisted fingerprint columns (from protected-data envelope metadata)
  einFingerprint?: string | null;
  ssnFingerprint?: string | null;
  bankAccountFingerprint?: string | null;
  // Persisted mask columns
  einMask?: string | null;
  ssnMask?: string | null;
  bankAccountMask?: string | null;
  bankRoutingMask?: string | null;
  [key: string]: unknown;
}

/**
 * Return display-safe masks from the persisted mask columns on the application
 * row. NEVER reads plaintext fields or computes masks on the fly.
 * Safe for GHL sync, UI, and audit contexts.
 */
export function getSafeApplicationMasks(application: ApplicationRecord): {
  einLast4?: string;
  einMasked?: string;
  ssnMasked?: string;
  bankAccountMasked?: string;
  bankRoutingMasked?: string;
} {
  const out: ReturnType<typeof getSafeApplicationMasks> = {};
  if (application.einMask) {
    out.einMasked = application.einMask;
    // Extract last 4 digits from the mask pattern ••-•••XXXX
    const last4Match = application.einMask.match(/\d{4}$/);
    if (last4Match) out.einLast4 = last4Match[0];
  }
  if (application.ssnMask) out.ssnMasked = application.ssnMask;
  if (application.bankAccountMask) out.bankAccountMasked = application.bankAccountMask;
  if (application.bankRoutingMask) out.bankRoutingMasked = application.bankRoutingMask;
  return out;
}

/**
 * Read the persisted fingerprint columns from an application row.
 * STRICT: reads ONLY persisted columns — never recomputes from ciphertext or
 * plaintext, never derives new fingerprints on-the-fly. If a column is NULL it
 * means the fingerprint was not yet computed and callers must treat it as absent.
 *
 * Routing fingerprint is intentionally excluded: routing number match is an
 * institution match, not a person/business identity match, and its semantics
 * differ from EIN/SSN/account dedup. Callers wanting routing comparison must
 * use explicit column access.
 */
export function computeApplicationFingerprints(application: {
  einFingerprint?: string | null;
  ssnFingerprint?: string | null;
  bankAccountFingerprint?: string | null;
}): {
  einFingerprint: string | null;
  ssnFingerprint: string | null;
  bankAccountFingerprint: string | null;
  routingFingerprint: string | null;
} {
  return {
    einFingerprint: application.einFingerprint ?? null,
    ssnFingerprint: application.ssnFingerprint ?? null,
    bankAccountFingerprint: application.bankAccountFingerprint ?? null,
    // Routing is returned for structural compatibility but set to null:
    // routing institution match is not a person/business relationship.
    routingFingerprint: null,
  };
}

/**
 * Purpose value that authorizes the `system` role to decrypt. The `system`
 * role is ONLY permitted when the purpose is EXACTLY this string — the
 * boarding processor submission path. Any other purpose (or no purpose) with
 * role `system` is denied.
 */
export const BOARDING_PROCESSOR_SUBMISSION_PURPOSE = "boarding_processor_submission";

/**
 * Decrypt all protected fields for an application row. STRICT:
 *  - Only admin or manager roles are permitted; role `system` is permitted
 *    ONLY when purpose === BOARDING_PROCESSOR_SUBMISSION_PURPOSE exactly.
 *  - Fails closed: any plaintext (non-envelope) or partial-encrypted row throws.
 *  - additionalOwners MUST be a string mpd_v1 envelope when present; a legacy
 *    JSON object/array is rejected (no plaintext passthrough).
 *  - Never logs decrypted values or ciphertext.
 *  - The `purpose` string gates the `system` role but is not logged with values.
 *
 * @param application - The full application row (from DB).
 * @param context     - { role: caller's role, purpose?: audit reason string }
 */
export function decryptProtectedFields(
  application: ApplicationRecord,
  context: { role?: string | null; purpose?: string },
): {
  ein?: string;
  ownerDob?: string;
  ownerSsn?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  additionalOwners?: unknown;
} {
  const { role, purpose } = context;
  const isPrivilegedUser = role === "admin" || role === "manager";
  // `system` is permitted ONLY for the exact boarding-processor-submission
  // purpose. Any other purpose (or missing purpose) with role `system` is denied.
  const isAuthorizedSystem = role === "system" && purpose === BOARDING_PROCESSOR_SUBMISSION_PURPOSE;
  if (!isPrivilegedUser && !isAuthorizedSystem) {
    throw new Error(
      `[MerchantProtectedData] decryptProtectedFields: access denied — role '${role ?? "(none)"}' is not permitted for this purpose.`,
    );
  }

  const appId = application.id;
  const result: ReturnType<typeof decryptProtectedFields> = {};

  // Helper: decrypt a field, strictly rejecting plaintext values.
  function decryptIfPresent(fieldPath: string, stored: string | null | undefined): string | undefined {
    if (stored == null || String(stored).trim() === "") return undefined;
    // Strict: throws if not a valid envelope (no silent plaintext passthrough).
    return decryptField(appId, fieldPath, String(stored));
  }

  result.ein = decryptIfPresent("ein", application.ein as string | null | undefined);
  result.ownerDob = decryptIfPresent("ownerDob", application.ownerDob as string | null | undefined);
  result.ownerSsn = decryptIfPresent("ownerSsn", application.ownerSsn as string | null | undefined);
  result.bankRoutingNumber = decryptIfPresent("bankRoutingNumber", application.bankRoutingNumber as string | null | undefined);
  result.bankAccountNumber = decryptIfPresent("bankAccountNumber", application.bankAccountNumber as string | null | undefined);

  if (application.additionalOwners != null) {
    const raw = application.additionalOwners;
    if (typeof raw === "string" && isEncryptedEnvelope(raw)) {
      result.additionalOwners = decryptAdditionalOwners(appId, raw);
    } else if (typeof raw === "string") {
      // Plaintext string — strict rejection.
      throw new Error(
        "[MerchantProtectedData] decryptProtectedFields: additionalOwners is plaintext — refusing to pass through (strict no-plaintext).",
      );
    } else {
      // Legacy JSONB object/array from the DB. This is NOT an mpd_v1 envelope
      // and must NOT be passed through — a non-null additionalOwners must be a
      // string mpd_v1 envelope. Reject fail-closed (strict no-plaintext).
      throw new Error(
        "[MerchantProtectedData] decryptProtectedFields: additionalOwners is a legacy JSON object/array — refusing to pass through (must be a string mpd_v1 envelope).",
      );
    }
  }

  // Remove undefined keys so callers can use `in` checks.
  for (const k of Object.keys(result) as Array<keyof typeof result>) {
    if (result[k] === undefined) delete result[k];
  }

  return result;
}

/** Status for readiness dashboards. Never returns the key value. */
export function getMerchantEncryptionStatus(): { available: boolean; gate: string; detail: string } {
  const key = resolveKeyBuffer();
  if (!key) {
    const isSet = !!process.env.MERCHANT_DATA_ENCRYPTION_KEY;
    return {
      available: false,
      gate: KEY_GATE_NAME,
      detail: isSet
        ? `${KEY_GATE_NAME} is set but is not a valid 32-byte key (64 hex chars or 44 base64 chars).`
        : `${KEY_GATE_NAME} is not set. Merchant protected data cannot be encrypted, decrypted, or fingerprinted.`,
    };
  }
  return { available: true, gate: KEY_GATE_NAME, detail: "Merchant encryption key is present and valid (32 bytes)." };
}
