/**
 * Public merchant application submission contract (R01) — ONE definition shared by the
 * public wizard (client) and the server finalization command, so the required field list,
 * the documented formats and the request builder cannot drift apart again.
 *
 * It enforces only the wizard's documented requirements; it does not invent KYC or
 * underwriting thresholds. Functions return field NAMES only, never values.
 */

export const SUBMISSION_PLAIN_REQUIRED = [
  "legalBusinessName", "businessType", "businessAddress", "businessCity", "businessState", "businessZip",
  "businessPhone", "businessEmail", "vertical",
  "ownerFirstName", "ownerLastName", "ownerEmail", "ownerPhone",
  "ownerAddress", "ownerCity", "ownerState", "ownerZip", "ownershipPercent",
  "bankName", "bankAccountType",
  "estimatedMonthlyVolume", "estimatedAvgTicket", "highestTicket", "preferredProgram",
] as const;

export const SUBMISSION_PROTECTED_REQUIRED = ["ein", "ownerDob", "ownerSsn", "bankRoutingNumber", "bankAccountNumber"] as const;

/** Card brands offered by the wizard (compared case-insensitively). */
export const SUBMISSION_CARD_TYPES = ["visa", "mastercard", "amex", "discover"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "$50,000" / "50000" / "1,234.50" → finite number, otherwise NaN. */
export function parseWizardAmount(v: unknown): number {
  if (typeof v === "number") return v;
  const cleaned = String(v ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

const present = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Names of missing or malformed required fields.
 * `storedProtected(name)` reports ciphertext already stored for a protected field (presence only).
 */
export function missingSubmissionFields(
  values: Record<string, any>,
  storedProtected: (name: string) => boolean = () => false,
): string[] {
  const missing: string[] = [];
  for (const f of SUBMISSION_PLAIN_REQUIRED) if (!present(values[f])) missing.push(f);
  for (const f of SUBMISSION_PROTECTED_REQUIRED) {
    if (!present(values[f]) && !storedProtected(f)) missing.push(f);
  }
  // Documented formats (R01-2): only for fields that are present, so a missing field is reported once.
  for (const f of ["businessEmail", "ownerEmail"] as const) {
    if (present(values[f]) && !EMAIL_RE.test(String(values[f]).trim())) missing.push(f);
  }
  for (const f of ["estimatedMonthlyVolume", "estimatedAvgTicket", "highestTicket"] as const) {
    if (present(values[f])) {
      const n = parseWizardAmount(values[f]);
      if (!Number.isFinite(n) || n <= 0) missing.push(f);
    }
  }
  if (present(values.ownershipPercent)) {
    const n = Number(values.ownershipPercent);
    if (!Number.isFinite(n) || n <= 0 || n > 100) missing.push("ownershipPercent");
  }
  if (present(values.ownerSsn) && String(values.ownerSsn).replace(/\D/g, "").length !== 9) missing.push("ownerSsn");
  if (present(values.ein) && String(values.ein).replace(/\D/g, "").length !== 9) missing.push("ein");
  if (present(values.bankRoutingNumber) && String(values.bankRoutingNumber).replace(/\D/g, "").length !== 9) missing.push("bankRoutingNumber");

  const cards = values.acceptedCardTypes;
  if (!Array.isArray(cards) || cards.length === 0) missing.push("acceptedCardTypes");
  else if (!cards.every((c) => typeof c === "string" && (SUBMISSION_CARD_TYPES as readonly string[]).includes(c.trim().toLowerCase()))) {
    missing.push("acceptedCardTypes");
  }
  if (typeof values.terminalNeeded !== "boolean") missing.push("terminalNeeded");
  if (typeof values.ecommerceNeeded !== "boolean") missing.push("ecommerceNeeded");
  if (values.terminalNeeded === true) {
    if (!present(values.terminalType)) missing.push("terminalType");
    const q = Number(values.terminalQuantity);
    if (!present(values.terminalQuantity) || !Number.isInteger(q) || q < 1) missing.push("terminalQuantity");
  }
  if (values.reviewConfirmed !== true) missing.push("reviewConfirmed");
  return Array.from(new Set(missing));
}

/** The wizard's field state (all inputs are strings/booleans as typed). */
export interface PublicWizardState {
  legalBusinessName: string; dba: string; businessType: string; ein: string; businessStartDate: string;
  businessAddress: string; businessCity: string; businessState: string; businessZip: string;
  businessPhone: string; businessEmail: string; website: string; vertical: string;
  ownerFirstName: string; ownerLastName: string; ownerEmail: string; ownerPhone: string;
  ownerDob: string; ownerSsn: string; ownerAddress: string; ownerCity: string; ownerState: string; ownerZip: string;
  ownershipPercent: string;
  bankName: string; bankRoutingNumber: string; bankAccountNumber: string; bankAccountType: string;
  estimatedMonthlyVolume: string; estimatedAvgTicket: string; highestTicket: string;
  currentProcessor: string; currentRate: string; acceptedCardTypes: string[];
  terminalNeeded: boolean | null; terminalType: string; terminalQuantity: string; ecommerceNeeded: boolean | null;
  preferredProgram: string;
  reviewConfirmed: boolean; pewcConsent: boolean; pewcDisclosureVersion: string;
}

/**
 * The finalize request body. This is the SAME function the wizard calls on submit; the
 * certification suite calls it too, so the shipped request is what the server tests.
 */
export function buildPublicApplicationPayload(
  s: PublicWizardState,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "submitted",
    currentStep: 6,
    totalSteps: 6,
    legalBusinessName: s.legalBusinessName,
    dba: s.dba,
    businessType: s.businessType,
    ein: s.ein.replace(/\D/g, "") || undefined,
    businessStartDate: s.businessStartDate,
    businessAddress: s.businessAddress,
    businessCity: s.businessCity,
    businessState: s.businessState,
    businessZip: s.businessZip,
    businessPhone: s.businessPhone,
    businessEmail: s.businessEmail,
    website: s.website,
    vertical: s.vertical,
    ownerFirstName: s.ownerFirstName,
    ownerLastName: s.ownerLastName,
    ownerEmail: s.ownerEmail,
    ownerPhone: s.ownerPhone,
    ownerDob: s.ownerDob,
    ownerSsn: s.ownerSsn.replace(/\D/g, ""),
    ownerAddress: s.ownerAddress,
    ownerCity: s.ownerCity,
    ownerState: s.ownerState,
    ownerZip: s.ownerZip,
    ownershipPercent: parseInt(s.ownershipPercent) || 0,
    bankName: s.bankName,
    bankRoutingNumber: s.bankRoutingNumber,
    bankAccountNumber: s.bankAccountNumber,
    bankAccountType: s.bankAccountType,
    estimatedMonthlyVolume: s.estimatedMonthlyVolume,
    estimatedAvgTicket: s.estimatedAvgTicket,
    highestTicket: s.highestTicket,
    currentProcessor: s.currentProcessor || null,
    currentRate: s.currentRate || null,
    acceptedCardTypes: s.acceptedCardTypes,
    terminalNeeded: s.terminalNeeded === true,
    terminalType: s.terminalNeeded ? s.terminalType : null,
    terminalQuantity: s.terminalNeeded ? parseInt(s.terminalQuantity) || 1 : 0,
    ecommerceNeeded: s.ecommerceNeeded === true,
    preferredProgram: s.preferredProgram,
    esignStatus: "pending",
    // The reviewer's actual confirmation — the server requires `true` (R01-1).
    reviewConfirmed: s.reviewConfirmed === true,
    pewcConsent: s.pewcConsent,
    ...(s.pewcConsent ? { pewcDisclosureVersion: s.pewcDisclosureVersion } : {}),
    ...extras,
  };
}

/**
 * The attribution fields the finalize route accepts. The browser's stored tracking record also holds a landing page and
 * click-id fields that the (strict) finalize schema does not accept; sending them made every real submission a 400.
 */
export const FINALIZE_ATTRIBUTION_KEYS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const;
export function finalizeAttributionExtras(stored: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FINALIZE_ATTRIBUTION_KEYS) {
    const v = stored[k];
    if (typeof v === "string" && v.trim() !== "") out[k] = v.slice(0, 200);
  }
  return out;
}
