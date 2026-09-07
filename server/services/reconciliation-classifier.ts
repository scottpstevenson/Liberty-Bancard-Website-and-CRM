/**
 * Reconciliation Classifier — pure function, no DB calls, no provider calls, no side effects.
 *
 * Classifies each contact for actionable remediation based on 12 dimensions:
 *   R1  name_quality_state        — can the name be normalized?
 *   R2  email_quality_state       — email format quality
 *   R3  phone_quality_state       — phone format quality
 *   R4  company_quality_state     — company name quality
 *   R5  vertical_state            — vertical resolved or missing
 *   R6  duplicate_risk_state      — shared-phone duplicate risk
 *   R7  business_gap_state        — businessId linkage gap
 *   R8  org_aggregation_state     — org-aggregation eligibility
 *   R9  normalization_opportunity — any normalizable field
 *   R10 cluster_candidacy_state   — duplicate cluster candidate
 *   R11 overall_action_state      — computed primary action code
 *   R12 primary_lane              — output lane (one of 11 values)
 *
 * Lane precedence (P1 wins):
 *   P1  NON_PRODUCTION
 *   P2  BLOCKED
 *   P3  INSUFFICIENT_DATA
 *   P4  PENDING_DUPLICATE_RESOLUTION
 *   P5  PENDING_ORG_AGGREGATION
 *   P6  PENDING_NAME_NORMALIZATION
 *   P7  PENDING_EMAIL_NORMALIZATION
 *   P8  PENDING_PHONE_NORMALIZATION
 *   P9  PENDING_VERTICAL_ASSIGNMENT
 *   P10 CLEAN_NO_ACTION
 *   P11 UNCLASSIFIED
 */

import { createHash } from "crypto";

// ──────────────────────────────────────────────────────────────────────────────
// Input row shape
// ──────────────────────────────────────────────────────────────────────────────
export interface ReconciliationContactRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  vertical: string | null;
  verticalSource: string | null;
  manualVerticalOverride: boolean | null;
  doNotContact: boolean | null;
  suppressionReason: string | null;
  emailStatus: string | null;
  bounceStatus: string | null;
  complaintStatus: string | null;
  consentTier: string | null;
  recordClass: string | null;
  ghlContactId: string | null;
  leadSource: string | null;
  businessId: number | null;
  hasDeal: boolean;
  // signals from census
  censusLane: string | null;          // primary_lane from census member
  normalizedPhone: string | null;     // phone?.trim() || null
  // shared-phone context from census run
  isSharedPhone: boolean;
  sharedPhoneCompanyCount: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Output shape
// ──────────────────────────────────────────────────────────────────────────────
export interface ReconciliationResult {
  contactId: number;
  runId: string;
  censusMemberId: number | null;
  censusLane: string | null;

  // R1–R11 dimensions
  nameQualityState: string;
  emailQualityState: string;
  phoneQualityState: string;
  companyQualityState: string;
  verticalState: string;
  duplicateRiskState: string;
  businessGapState: string;
  orgAggregationState: string;
  normalizationOpportunity: string;
  clusterCandidacyState: string;
  overallActionState: string;

  primaryLane: string;
  gapCodes: string[];

  // Non-PII flags
  hasBusinessId: boolean;
  hasCompanyName: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasVertical: boolean;
  hasFirstName: boolean;
  hasLastName: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

const TITLE_PREFIXES = /^(dr|mr|mrs|ms|prof|rev|eng|esq)\.?\s+/i;
const ALL_CAPS = /^[A-Z\s\-'.,]+$/;
const ALL_LOWER = /^[a-z\s\-'.,]+$/;
const PLACEHOLDER_PHONE = /1234$|0000$|5555$/;
const TOLL_FREE = /^1?(800|888|877|866|855|844|833)/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SUSPICIOUS_EMAIL = /noemail|placeholder|test@|@example|@test\.|noreply/i;

function hasNameQualityIssue(name: string | null): boolean {
  if (!nonEmpty(name)) return false;
  const n = name!.trim();
  return TITLE_PREFIXES.test(n) || ALL_CAPS.test(n) || ALL_LOWER.test(n);
}

// ──────────────────────────────────────────────────────────────────────────────
// R1 — Name Quality State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR1(row: ReconciliationContactRow): string {
  const hasFirst = nonEmpty(row.firstName);
  const hasLast = nonEmpty(row.lastName);

  if (!hasFirst && !hasLast) return "missing_name";

  if (hasNameQualityIssue(row.firstName) || hasNameQualityIssue(row.lastName)) {
    return "needs_normalization";
  }

  // First name only with a title prefix
  if (hasFirst && TITLE_PREFIXES.test(row.firstName!.trim())) return "needs_normalization";

  return "clean";
}

// ──────────────────────────────────────────────────────────────────────────────
// R2 — Email Quality State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR2(row: ReconciliationContactRow): string {
  if (!nonEmpty(row.email)) return "missing";

  const email = row.email!.trim().toLowerCase();

  if (!EMAIL_FORMAT.test(email)) return "invalid_format";
  if (SUSPICIOUS_EMAIL.test(email)) return "suspicious";

  return "clean";
}

// ──────────────────────────────────────────────────────────────────────────────
// R3 — Phone Quality State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR3(row: ReconciliationContactRow): string {
  if (!nonEmpty(row.phone)) return "missing";

  const digits = row.phone!.replace(/\D/g, "");

  if (digits.length === 0) return "missing";
  if (PLACEHOLDER_PHONE.test(digits)) return "placeholder";

  // US/CA numbers: 10 digits (or 11 with leading 1)
  const usLen = digits.length === 10 || (digits.length === 11 && digits[0] === "1");

  // Check if already formatted: (NXX) NXX-XXXX or NXX-NXX-XXXX or similar
  const phone = row.phone!.trim();
  const looksFormatted = /^\+?1?\s*[\(\-]?\d{3}[\)\-\s]\s*\d{3}[\-\s]\d{4}$/.test(phone);

  if (usLen && !looksFormatted) return "needs_formatting";
  if (!usLen && digits.length < 7) return "too_short";

  return "clean";
}

// ──────────────────────────────────────────────────────────────────────────────
// R4 — Company Name Quality State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR4(row: ReconciliationContactRow): string {
  if (!nonEmpty(row.companyName)) return "missing";

  const name = row.companyName!.trim();

  if (ALL_CAPS.test(name) && name.length > 4) return "needs_normalization";
  if (ALL_LOWER.test(name) && name.length > 4) return "needs_normalization";

  return "clean";
}

// ──────────────────────────────────────────────────────────────────────────────
// R5 — Vertical State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR5(row: ReconciliationContactRow): string {
  if (row.manualVerticalOverride === true) return "manual_override";
  if (nonEmpty(row.vertical)) return "resolved";
  return "missing";
}

// ──────────────────────────────────────────────────────────────────────────────
// R6 — Duplicate Risk State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR6(row: ReconciliationContactRow): string {
  if (row.isSharedPhone && row.sharedPhoneCompanyCount > 1 && row.sharedPhoneCompanyCount <= 20) {
    return "shared_phone_multi_company";
  }
  if (row.isSharedPhone && row.sharedPhoneCompanyCount > 20) {
    return "mass_shared_phone";
  }
  return "none";
}

// ──────────────────────────────────────────────────────────────────────────────
// R7 — Business Gap State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR7(row: ReconciliationContactRow, censusLane: string | null): string {
  if (row.businessId != null) return "linked";

  if (nonEmpty(row.companyName)) {
    // If census classified as INTERNAL_MATCH_AVAILABLE, candidate exists
    if (censusLane === "INTERNAL_MATCH_AVAILABLE") return "candidate_match";
    return "pipeline_eligible";
  }

  return "no_company";
}

// ──────────────────────────────────────────────────────────────────────────────
// R8 — Org Aggregation State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR8(r7: string, row: ReconciliationContactRow): string {
  if (r7 === "pipeline_eligible" && nonEmpty(row.companyName) && row.businessId == null) {
    return "aggregatable";
  }
  if (r7 === "candidate_match") return "internal_match_possible";
  return "not_eligible";
}

// ──────────────────────────────────────────────────────────────────────────────
// R9 — Normalization Opportunity
// ──────────────────────────────────────────────────────────────────────────────
function classifyR9(r1: string, r2: string, r3: string, r4: string, r5: string): string {
  if (
    r1 === "needs_normalization" ||
    r2 === "suspicious" || r2 === "invalid_format" ||
    r3 === "needs_formatting" ||
    r4 === "needs_normalization" ||
    r5 === "missing"
  ) {
    return "has_opportunity";
  }
  return "none";
}

// ──────────────────────────────────────────────────────────────────────────────
// R10 — Cluster Candidacy State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR10(r6: string): string {
  return r6 === "shared_phone_multi_company" ? "candidate" : "clean";
}

// ──────────────────────────────────────────────────────────────────────────────
// R11 — Overall Action State
// ──────────────────────────────────────────────────────────────────────────────
function classifyR11(
  r1: string, r2: string, r3: string, r4: string, r5: string,
  r6: string, r7: string, r8: string,
  row: ReconciliationContactRow,
  d1: string,
): string {
  if (["test", "demo", "synthetic"].includes(d1)) return "non_production";

  const blocked = row.doNotContact === true ||
    nonEmpty(row.suppressionReason) ||
    ["bounced", "blocked", "opted_out"].includes(row.emailStatus ?? "");
  if (blocked) return "blocked";

  const hasChannel = nonEmpty(row.email) || nonEmpty(row.phone);
  const hasName = nonEmpty(row.firstName) || nonEmpty(row.companyName);
  if (!hasChannel && !hasName) return "insufficient_data";

  if (r6 === "shared_phone_multi_company") return "duplicate_resolution";
  if (r8 === "aggregatable" || r8 === "internal_match_possible") return "org_aggregation";
  if (r1 === "needs_normalization") return "name_normalization";
  if (r2 === "suspicious" || r2 === "invalid_format") return "email_normalization";
  if (r3 === "needs_formatting") return "phone_normalization";
  if (r5 === "missing" && hasChannel && hasName) return "vertical_assignment";

  return "no_action";
}

// ──────────────────────────────────────────────────────────────────────────────
// Lane Assignment (P1–P11)
// ──────────────────────────────────────────────────────────────────────────────
function assignLane(r11: string, gapCodes: string[]): string {
  switch (r11) {
    case "non_production":    return "NON_PRODUCTION";
    case "blocked":           return "BLOCKED";
    case "insufficient_data": return "INSUFFICIENT_DATA";
    case "duplicate_resolution": return "PENDING_DUPLICATE_RESOLUTION";
    case "org_aggregation":   return "PENDING_ORG_AGGREGATION";
    case "name_normalization": return "PENDING_NAME_NORMALIZATION";
    case "email_normalization": return "PENDING_EMAIL_NORMALIZATION";
    case "phone_normalization": return "PENDING_PHONE_NORMALIZATION";
    case "vertical_assignment": return "PENDING_VERTICAL_ASSIGNMENT";
    case "no_action":         return "CLEAN_NO_ACTION";
    default:                  return "UNCLASSIFIED";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main exported classifier — pure, no side effects
// ──────────────────────────────────────────────────────────────────────────────
export function classifyReconciliation(
  row: ReconciliationContactRow,
  runId: string,
  censusMemberId: number | null = null,
): ReconciliationResult {
  const d1 = row.recordClass ?? "unknown";

  const r1 = classifyR1(row);
  const r2 = classifyR2(row);
  const r3 = classifyR3(row);
  const r4 = classifyR4(row);
  const r5 = classifyR5(row);
  const r6 = classifyR6(row);
  const r7 = classifyR7(row, row.censusLane);
  const r8 = classifyR8(r7, row);
  const r9 = classifyR9(r1, r2, r3, r4, r5);
  const r10 = classifyR10(r6);
  const r11 = classifyR11(r1, r2, r3, r4, r5, r6, r7, r8, row, d1);

  const gapCodes: string[] = [];
  if (r1 !== "clean" && r1 !== "missing_name") gapCodes.push(`name:${r1}`);
  if (r2 !== "clean" && r2 !== "missing") gapCodes.push(`email:${r2}`);
  if (r3 !== "clean" && r3 !== "missing") gapCodes.push(`phone:${r3}`);
  if (r4 !== "clean" && r4 !== "missing") gapCodes.push(`company:${r4}`);
  if (r5 === "missing") gapCodes.push("vertical:missing");
  if (r6 !== "none") gapCodes.push(`duplicate_risk:${r6}`);
  if (r7 !== "linked" && r7 !== "no_company") gapCodes.push(`business_gap:${r7}`);

  const lane = assignLane(r11, gapCodes);

  return {
    contactId: row.id,
    runId,
    censusMemberId,
    censusLane: row.censusLane,

    nameQualityState: r1,
    emailQualityState: r2,
    phoneQualityState: r3,
    companyQualityState: r4,
    verticalState: r5,
    duplicateRiskState: r6,
    businessGapState: r7,
    orgAggregationState: r8,
    normalizationOpportunity: r9,
    clusterCandidacyState: r10,
    overallActionState: r11,

    primaryLane: lane,
    gapCodes,

    hasBusinessId: row.businessId != null,
    hasCompanyName: nonEmpty(row.companyName),
    hasEmail: nonEmpty(row.email),
    hasPhone: nonEmpty(row.phone),
    hasVertical: nonEmpty(row.vertical),
    hasFirstName: nonEmpty(row.firstName),
    hasLastName: nonEmpty(row.lastName),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Normalization proposal generators — pure, return proposed values
// ──────────────────────────────────────────────────────────────────────────────

export interface NormalizationProposal {
  proposalType: "name_normalization" | "email_normalization" | "phone_normalization" | "vertical_assignment" | "company_normalization";
  fieldName: string;
  currentValue: string | null;
  proposedValue: string;
  confidence: number;
}

/** Strip title prefix and fix casing */
function toTitleCase(s: string): string {
  return s
    .replace(TITLE_PREFIXES, "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Format a raw digit string to (NXX) NXX-XXXX */
function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  // Strip leading 1 for US/CA
  const core = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  if (core.length === 10) {
    return `(${core.slice(0,3)}) ${core.slice(3,6)}-${core.slice(6)}`;
  }
  return d; // can't format confidently
}

export function generateProposals(
  row: ReconciliationContactRow,
  result: ReconciliationResult,
  contactUpdatedAt: Date,
): NormalizationProposal[] {
  const proposals: NormalizationProposal[] = [];

  // Name normalization
  if (result.nameQualityState === "needs_normalization") {
    if (nonEmpty(row.firstName) && hasNameQualityIssue(row.firstName)) {
      const proposed = toTitleCase(row.firstName!);
      if (proposed !== row.firstName?.trim()) {
        proposals.push({
          proposalType: "name_normalization",
          fieldName: "first_name",
          currentValue: row.firstName,
          proposedValue: proposed,
          confidence: 80,
        });
      }
    }
    if (nonEmpty(row.lastName) && hasNameQualityIssue(row.lastName)) {
      const proposed = toTitleCase(row.lastName!);
      if (proposed !== row.lastName?.trim()) {
        proposals.push({
          proposalType: "name_normalization",
          fieldName: "last_name",
          currentValue: row.lastName,
          proposedValue: proposed,
          confidence: 80,
        });
      }
    }
  }

  // Company normalization
  if (result.companyQualityState === "needs_normalization" && nonEmpty(row.companyName)) {
    const proposed = toTitleCase(row.companyName!);
    if (proposed !== row.companyName?.trim()) {
      proposals.push({
        proposalType: "company_normalization",
        fieldName: "company_name",
        currentValue: row.companyName,
        proposedValue: proposed,
        confidence: 70,
      });
    }
  }

  // Phone normalization
  if (result.phoneQualityState === "needs_formatting" && nonEmpty(row.phone)) {
    const formatted = formatPhone(row.phone!);
    if (formatted !== row.phone?.trim()) {
      proposals.push({
        proposalType: "phone_normalization",
        fieldName: "phone",
        currentValue: row.phone,
        proposedValue: formatted,
        confidence: 90,
      });
    }
  }

  // NOTE: Vertical assignment proposals are NOT generated here.
  // The canonical resolver requires merchant/contact vertical evidence fields that
  // are not stored in the reconciliation member snapshot. Generating proposals with
  // all-null inputs guarantees no candidate passes the resolver threshold.
  // Vertical assignment is handled separately through the SDR enrichment pipeline.

  return proposals;
}

// All valid primary lanes
export const ALL_RECONCILIATION_LANES = [
  "NON_PRODUCTION",
  "BLOCKED",
  "INSUFFICIENT_DATA",
  "PENDING_DUPLICATE_RESOLUTION",
  "PENDING_ORG_AGGREGATION",
  "PENDING_NAME_NORMALIZATION",
  "PENDING_EMAIL_NORMALIZATION",
  "PENDING_PHONE_NORMALIZATION",
  "PENDING_VERTICAL_ASSIGNMENT",
  "CLEAN_NO_ACTION",
  "UNCLASSIFIED",
] as const;

export type ReconciliationLane = typeof ALL_RECONCILIATION_LANES[number];
