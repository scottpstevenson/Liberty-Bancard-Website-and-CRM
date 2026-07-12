import crypto from "crypto";
import { normalizePhoneForImport } from "../routes/helpers";

/**
 * Canonical email normalizer: trim + lowercase + blank → null.
 * Matches contacts.ts normalisation exactly (no format-validation here).
 * Validation (e.g. presence of "@") belongs at the classification layer.
 */
export function normalizeProspectEmail(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Format validation gate — separate from normalization.
 * Used only at the classification layer to distinguish email_candidate
 * rows from invalid rows.  Normalization must run first.
 */
export function isValidEmailFormat(email: string): boolean {
  return email.includes("@");
}

export function normalizeProspectPhone(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const normalized = normalizePhoneForImport(raw.trim());
  if (!normalized || normalized.length < 10) return null;
  return normalized;
}

export function computeRowFingerprint(normalized: {
  email: string | null;
  phone: string | null;
  companyName: string | null;
}): string {
  const canonical = [
    normalized.email ?? "",
    normalized.phone ?? "",
    (normalized.companyName ?? "").trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function computeFileHash(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
