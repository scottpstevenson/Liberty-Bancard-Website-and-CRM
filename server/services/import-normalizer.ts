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

export type CsvSourceFormat = "custom" | "google_maps_outscraper" | "apollo_lead_list";

function normalizeCsvHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

/**
 * Classify provider exports only when their headers contain a distinctive
 * multi-field signature. Common contact headers are deliberately insufficient:
 * a normal CSV with Name, Phone, and Email must remain custom.
 */
export function classifyCsvSourceFormat(headers: string[]): CsvSourceFormat {
  const normalized = new Set(headers.map(normalizeCsvHeader));

  const outscraperMarkers = [
    "telephone",
    "category",
    "rating",
    "review_count",
    "reviews",
    "keyword",
  ];
  const hasOutscraperName = normalized.has("name");
  const outscraperMarkerCount = outscraperMarkers.filter((header) => normalized.has(header)).length;
  if (hasOutscraperName && outscraperMarkerCount >= 2) {
    return "google_maps_outscraper";
  }

  const apolloMarkers = [
    "first_name",
    "last_name",
    "person_linkedin_url",
    "mobile_phone",
    "corporate_phone",
    "company_name",
    "#_employees",
    "annual_revenue",
    "email_status",
    "primary_domain",
  ];
  const apolloHighSignal = new Set([
    "person_linkedin_url",
    "mobile_phone",
    "corporate_phone",
    "company_name",
    "#_employees",
    "annual_revenue",
    "email_status",
    "primary_domain",
  ]);
  const apolloMarkerCount = apolloMarkers.filter((header) => normalized.has(header)).length;
  const hasApolloHighSignal = [...apolloHighSignal].some((header) => normalized.has(header));
  if (apolloMarkerCount >= 3 && hasApolloHighSignal) {
    return "apollo_lead_list";
  }

  return "custom";
}
