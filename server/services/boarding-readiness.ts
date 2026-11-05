/**
 * Boarding readiness (S5-15) — one read-only evaluation shared by the readiness route,
 * the submit-to-processor enqueue and the outbox dispatch.
 *
 * It reports only facts the system already records. It does NOT invent approval
 * criteria: required document / e-signature conditions for the selected program are
 * a business-policy decision that has not been provided, so they are listed as
 * explicit `policyGates` (native decision required) rather than silently treated as met.
 * Internal underwriting approval is never relabelled as processor approval.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { dealExclusionReason } from "./deal-production-scope";
import { resolveBoardingApplication } from "./boarding-case";
import { policyForProgram, readBoardingPolicyMatrix } from "./boarding-policy";

export type ReadinessBlocker = { code: string; detail?: string };

export interface BoardingReadiness {
  dealId: number;
  ready: boolean;
  blockers: ReadinessBlocker[];
  /** Facts that inform but never block. */
  facts: {
    internalDecision: "none_recorded" | "approve" | "review" | "hold" | "reject";
    internalDecisionId: number | null;
    applicationStatus: string | null;
    applicationUpdatedAt: string | null;
    applicationBinding: "direct" | "sales_source" | "none";
    applicationId: number | null;
  };
  /** R03: the exact tuple this verdict was computed from; compared at enqueue and at dispatch. */
  caseVersion: string;
  caseTuple: Record<string, unknown>;
  /** Business-policy gates: `native_policy_required` until the owner records the matrix. An unresolved gate blocks readiness. */
  policyGates: Array<{ code: string; state: "native_policy_required" | "resolved"; meaning: string }>;
}

const PLAIN_REQUIRED: Array<[string, string]> = [
  ["legal_business_name", "legalBusinessName"], ["business_address", "businessAddress"],
  ["business_city", "businessCity"], ["business_state", "businessState"], ["business_zip", "businessZip"],
  ["owner_first_name", "ownerFirstName"], ["owner_last_name", "ownerLastName"],
];
/** Protected columns: presence of ciphertext is checked without decrypting. */
const PROTECTED_REQUIRED: Array<[string, string]> = [
  ["ein", "ein"], ["owner_ssn", "ownerSsn"], ["owner_dob", "ownerDob"],
  ["bank_routing_number", "bankRoutingNumber"], ["bank_account_number", "bankAccountNumber"],
];

/** Positive list (R03): only these application states may proceed to boarding. */
export const BOARDING_ALLOWED_APPLICATION_STATUSES = new Set(["submitted", "under_review", "approved"]);

export const BOARDING_POLICY_GATES: Array<{ code: string; state: "native_policy_required"; meaning: string }> = [
  {
    code: "required_documents_by_program",
    state: "native_policy_required",
    meaning: "Which documents must be received before submitting to the processor has not been defined by the owner.",
  },
  {
    code: "e_signature_by_program",
    state: "native_policy_required",
    meaning: "Whether a signed agreement is required before submission, per program, has not been defined by the owner.",
  },
];

function versionOf(tuple: Record<string, unknown>): string {
  const canon = JSON.stringify(Object.keys(tuple).sort().map((k) => [k, tuple[k] ?? null]));
  return crypto.createHash("sha256").update(canon).digest("hex");
}

const EMPTY_FACTS = {
  internalDecision: "none_recorded" as const, internalDecisionId: null, applicationStatus: null, applicationUpdatedAt: null,
  applicationBinding: "none" as const, applicationId: null,
};

export async function evaluateBoardingReadiness(
  dealId: number,
  opts: { includeFieldCompleteness?: boolean } = {},
): Promise<BoardingReadiness> {
  const includeFields = opts.includeFieldCompleteness !== false;
  const blockers: ReadinessBlocker[] = [];

  const dealRes = await db.execute(sql`
    SELECT id, pipeline, stage, contact_id, archived_at, record_class FROM deals WHERE id = ${dealId} LIMIT 1`);
  const deal = ((dealRes as any).rows ?? dealRes)[0] as
    { id: number; pipeline: string | null; stage: string | null; contact_id: number | null; archived_at: unknown; record_class: string | null } | undefined;
  if (!deal) {
    const tuple = { dealId, missing: true };
    return { dealId, ready: false, blockers: [{ code: "deal_not_found" }], facts: EMPTY_FACTS,
      caseVersion: versionOf(tuple), caseTuple: tuple, policyGates: BOARDING_POLICY_GATES };
  }
  if (deal.pipeline !== "onboarding") {
    blockers.push({ code: "deal_not_in_onboarding_pipeline", detail: `pipeline=${deal.pipeline ?? "none"}` });
  }
  const excluded = dealExclusionReason(deal);
  if (excluded) blockers.push({ code: "deal_not_operational", detail: excluded });

  // Only the DIRECT binding can board; an exact sales-deal source is reported so the audited bridge can move it.
  const resolved = await resolveBoardingApplication(db as any, dealId);
  let app: Record<string, any> | undefined;
  if (resolved.kind === "direct") {
    const appRes = await db.execute(sql`
      SELECT *, updated_at::text AS updated_at_text FROM merchant_applications WHERE id = ${resolved.applicationId} LIMIT 1`);
    app = ((appRes as any).rows ?? appRes)[0];
  }
  if (!app) {
    blockers.push(resolved.kind === "sales_source"
      ? { code: "application_on_sales_deal", detail: "bridge the application to this onboarding deal" }
      : { code: "no_linked_application" });
  } else {
    const status = String(app.status ?? "").toLowerCase();
    if (!BOARDING_ALLOWED_APPLICATION_STATUSES.has(status)) {
      blockers.push({ code: "application_not_active", detail: `status=${app.status}` });
    }
    if (deal.contact_id != null && app.contact_id != null && app.contact_id !== deal.contact_id) {
      blockers.push({ code: "application_contact_mismatch" });
    }
    if (includeFields) {
      const missing: string[] = [];
      for (const [col, name] of [...PLAIN_REQUIRED, ...PROTECTED_REQUIRED]) {
        const v = app[col];
        if (v == null || (typeof v === "string" && v.trim() === "")) missing.push(name);
      }
      if (missing.length > 0) blockers.push({ code: "application_incomplete", detail: missing.join(",") });
    }
  }

  const decRes = await db.execute(sql`
    SELECT id, decision, override_action FROM underwriting_decisions
    WHERE deal_id = ${dealId} ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`);
  const dec = ((decRes as any).rows ?? decRes)[0] as { id: number; decision: string; override_action: string | null } | undefined;
  let internalDecision: BoardingReadiness["facts"]["internalDecision"] = "none_recorded";
  if (dec) {
    const effective = (dec.override_action ?? dec.decision) as string;
    internalDecision = (["approve", "review", "hold", "reject"].includes(effective) ? effective : "review") as any;
    if (internalDecision === "reject" || internalDecision === "hold") {
      blockers.push({ code: "internal_underwriting_not_cleared", detail: `latest decision=${internalDecision}` });
    }
  }

  // Policy gates: unresolved gates BLOCK. They resolve only from the owner-recorded matrix for this program.
  const matrix = await readBoardingPolicyMatrix();
  const programPolicy = app ? policyForProgram(matrix, app.preferred_program) : null;
  const gates: BoardingReadiness["policyGates"] = BOARDING_POLICY_GATES.map((g) => ({ ...g }));
  if (programPolicy && app) {
    for (const g of gates) g.state = "resolved" as any;
    for (const docType of programPolicy.requiredDocuments) {
      const c = await db.execute(sql`
        SELECT 1 FROM underwriting_conditions
        WHERE deal_id = ${dealId} AND condition_type = ${docType} AND status IN ('approved','waived') AND reversed_at IS NULL AND superseded_at IS NULL LIMIT 1`);
      if ((((c as any).rows ?? c) as any[]).length === 0) blockers.push({ code: "required_document_missing", detail: docType });
    }
    if (programPolicy.esignRequired && String(app.esign_status ?? "").toLowerCase() !== "signed") {
      blockers.push({ code: "e_signature_required", detail: `esign=${app.esign_status ?? "none"}` });
    }
  } else {
    for (const g of gates) blockers.push({ code: `policy_unresolved:${g.code}`, detail: "native_policy_required" });
  }

  const caseTuple: Record<string, unknown> = {
    dealId, contactId: deal.contact_id, applicationId: app?.id ?? null, applicationStatus: app?.status ?? null,
    applicationStateVersion: app?.state_version ?? null, applicationUpdatedAt: app?.updated_at_text ?? null,
    binding: resolved.kind, decisionId: dec?.id ?? null, decisionEffective: dec ? (dec.override_action ?? dec.decision) : null,
    policyVersion: programPolicy ? matrix!.version : "unrecorded",
  };

  return {
    dealId,
    ready: blockers.length === 0,
    blockers,
    facts: {
      internalDecision,
      internalDecisionId: dec?.id ?? null,
      applicationStatus: app?.status ?? null,
      applicationUpdatedAt: app?.updated_at_text ?? null,
      applicationBinding: resolved.kind,
      applicationId: app?.id ?? null,
    },
    caseVersion: versionOf(caseTuple),
    caseTuple,
    policyGates: gates,
  };
}
