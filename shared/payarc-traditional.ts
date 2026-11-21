import patchContract from "./payarc-traditional-patch-contract.json";
import contract from "./payarc-traditional-contract.json";
export const PAYARC_TRADITIONAL_CONTRACT = "traditional-apply-v1" as const;
export const PAYARC_TRADITIONAL_PATHS = {
  create: "/agent-hub/apply/add-lead",
  signature: "/agent-hub/apply/submit-for-signature",
  status: "/agent-hub/apply/lead-status",
  update: (id: string) => `/agent-hub/apply/lead/${encodeURIComponent(id)}/`,
} as const;
export const payarcRequestSchema = contract.request as any;
export type PayarcPhase =
  | "lead_created"
  | "awaiting_signature"
  | "signed"
  | "under_review"
  | "underwriting_approved"
  | "documents_needed"
  | "declined"
  | "boarded"
  | "processing_ready"
  | "on_hold"
  | "closed"
  | "reconciliation_required";
export interface PayarcObservation {
  merchantCode: string;
  applicationStatus: number;
  leadCode?: string;
  leadStatus?: string;
  leadModule?: string;
  accountCode?: string;
  accountStatus?: string;
  phase: PayarcPhase;
  mid?: string;
}
export function payarcIdentifier(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v)
    ? v
    : undefined;
}
/** Payarc documents MM/DD/YYYY (not the protected store's ISO date) for owner birth dates. */
export function payarcBirthDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !m ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return undefined;
  return `${m[2]}/${m[3]}/${m[1]}`;
}
/** Names/codes only. Unknown input fields are rejected, never forwarded. */
export function validatePayarcPayload(
  value: unknown,
  schema: any = payarcRequestSchema,
  path = "",
): string[] {
  const errors: string[] = [];
  const fail = (code: string) => errors.push(`${path || "payload"}:${code}`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("object_required");
      return errors;
    }
    const v = value as Record<string, unknown>;
    for (const k of schema.required ?? [])
      if (v[k] === undefined || v[k] === null || v[k] === "")
        errors.push(`${path ? path + "." : ""}${k}:required`);
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (!k || !schema.properties?.[k]) errors.push(`${p}:unknown_field`);
      else errors.push(...validatePayarcPayload(x, schema.properties[k], p));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      fail("array_required");
      return errors;
    }
    if (value.length > 50) fail("too_many_items");
    if (path === "Owners" && value.length === 0) fail("owner_required");
    value
      .slice(0, 50)
      .forEach((v, i) =>
        errors.push(...validatePayarcPayload(v, schema.items, `${path}.${i}`)),
      );
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length > 10000)
      fail("invalid_string");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value))
    )
      fail("invalid_number");
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    fail("invalid_boolean");
  if (
    schema.format === "date" &&
    typeof value === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    fail("invalid_date");
  if (
    /BirthDate$/.test(path) &&
    typeof value === "string" &&
    !/^\d{2}[-/]\d{2}[-/]\d{2}(?:\d{2})?$/.test(value)
  )
    fail("invalid_birth_date_format");
  if (schema.enum && !schema.enum.includes(value)) fail("invalid_option");
  if (
    /OwnershipPct$/.test(path) &&
    typeof value === "number" &&
    (value < 0 || value > 100)
  )
    fail("invalid_percentage");
  return errors;
}
/** An echoed MerchantCode is mandatory: POST status has no application identity in its URL. */
export function decodePayarcObservation(
  raw: unknown,
  expected: string,
): PayarcObservation {
  const v = raw as any;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    !payarcIdentifier(v.MerchantCode) ||
    v.MerchantCode !== expected
  )
    throw Error("PAYARC_STATUS_IDENTITY_MISMATCH");
  if (![0, 1, 2, 4, 8, 16, 32, 64].includes(v.Status))
    throw Error("PAYARC_APPLICATION_STATUS_UNKNOWN");
  const leadStatus =
    typeof v.LeadStatus === "string" ? v.LeadStatus.toLowerCase() : undefined;
  const leadModule =
    typeof v.LeadModule === "string" ? v.LeadModule.toLowerCase() : undefined;
  const accountStatus =
    typeof v.AccountStatus === "string"
      ? v.AccountStatus.toLowerCase()
      : undefined;
  // Observed on the named production test while unsigned. This is a provider
  // application state, not evidence of underwriting submission or approval.
  if (
    leadStatus === "submitted_to_boarding" &&
    (leadModule !== "application" || ![0, 1, 2, 16].includes(v.Status))
  )
    throw Error("PAYARC_LEAD_STATUS_CONTEXT_UNKNOWN");
  const known = new Set([
    "new",
    "needs_approval",
    "approved",
    "in_progress",
    "submitted_to_underwriting",
    "submitted_to_boarding",
    "declined",
    "dead",
    "application_submitted",
    "pending_docs",
    "buried",
    "boarded",
    "qa_complete",
    "submitted_to_qa",
    "active",
    "submitted_to_postboarding",
    "on_hold",
  ]);
  if (leadStatus && !known.has(leadStatus))
    throw Error("PAYARC_LEAD_STATUS_UNKNOWN");
  if (
    leadModule &&
    ![
      "application",
      "boarding",
      "deployment",
      "fiserv_underwriting",
      "postboarding",
      "qa",
      "riskreview",
      "underwriting",
    ].includes(leadModule)
  )
    throw Error("PAYARC_LEAD_MODULE_UNKNOWN");
  if (accountStatus && !["open", "inactive", "closed"].includes(accountStatus))
    throw Error("PAYARC_ACCOUNT_STATUS_UNKNOWN");
  const mid =
    typeof v.AccountMID === "string" && /^\d{6,32}$/.test(v.AccountMID)
      ? v.AccountMID
      : undefined;
  const accountCode = payarcIdentifier(v.AccountCode);
  let phase: PayarcPhase =
    v.Status === 0
      ? "lead_created"
      : [1, 2, 16].includes(v.Status)
        ? "awaiting_signature"
        : [4, 8].includes(v.Status)
          ? "signed"
          : "under_review";
  if (leadStatus === "pending_docs") phase = "documents_needed";
  else if (["declined", "dead", "buried"].includes(leadStatus ?? ""))
    phase = "declined";
  else if (leadStatus === "on_hold" || accountStatus === "inactive")
    phase = "on_hold";
  else if (
    leadStatus === "approved" &&
    ["underwriting", "fiserv_underwriting"].includes(leadModule ?? "")
  )
    phase = "underwriting_approved";
  else if (
    leadStatus === "boarded" &&
    [4, 8, 32, 64].includes(v.Status) &&
    accountCode &&
    mid
  )
    phase = "boarded";
  else if (
    leadStatus === "active" &&
    [4, 8, 32, 64].includes(v.Status) &&
    accountCode &&
    mid &&
    accountStatus === "open"
  )
    phase = "processing_ready";
  else if (
    [
      "submitted_to_underwriting",
      "application_submitted",
      "submitted_to_qa",
      "qa_complete",
      "submitted_to_postboarding",
      "in_progress",
      "needs_approval",
    ].includes(leadStatus ?? "")
  )
    phase = "under_review";
  if (accountStatus === "closed") phase = "closed";
  return {
    merchantCode: expected,
    applicationStatus: v.Status,
    leadCode: payarcIdentifier(v.LeadCode),
    leadStatus,
    leadModule,
    accountCode,
    accountStatus,
    phase,
    ...(["boarded", "processing_ready"].includes(phase) && mid ? { mid } : {}),
  };
}
export function payarcBoardingStatus(
  o: PayarcObservation,
): "submitted" | "under_review" | "approved" | "declined" | "more_info_needed" {
  if (o.phase === "declined") return "declined";
  if (o.phase === "documents_needed") return "more_info_needed";
  if (["boarded", "processing_ready"].includes(o.phase)) return "approved";
  return ["lead_created", "awaiting_signature"].includes(o.phase)
    ? "submitted"
    : "under_review";
}

/** Corrections explicitly reset phase before another signature. Ordinary polls cannot rewind progress. */
export function payarcObservationCanAdvance(
  current: PayarcPhase,
  next: PayarcPhase,
  context?: { nextStatus?: number; moduleChanged?: boolean },
): boolean {
  if (current === next) return true;
  if (
    current === "signed" &&
    next === "awaiting_signature" &&
    context?.nextStatus === 16
  )
    return true;
  if (
    current === "underwriting_approved" &&
    next === "under_review" &&
    context?.moduleChanged
  )
    return true;
  if (current === "closed" || current === "declined") return false;
  const rank: Partial<Record<PayarcPhase, number>> = {
    lead_created: 0,
    awaiting_signature: 1,
    signed: 2,
    under_review: 3,
    underwriting_approved: 4,
    boarded: 5,
    processing_ready: 6,
  };
  if (
    [
      "closed",
      "declined",
      "documents_needed",
      "on_hold",
      "reconciliation_required",
    ].includes(next)
  )
    return true;
  if (rank[current] !== undefined && rank[next] !== undefined)
    return rank[next]! >= rank[current]!;
  return true;
}

export const payarcPatchSchema = patchContract.request as any;
