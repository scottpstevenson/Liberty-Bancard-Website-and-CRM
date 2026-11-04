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
import { sql } from "drizzle-orm";
import { db } from "../db";

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
  };
  /** Business-policy gates with no recorded policy: shown explicitly, owner decision required. */
  policyGates: Array<{ code: string; state: "native_policy_required"; meaning: string }>;
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

const NEGATIVE_APPLICATION_STATUSES = new Set(["declined", "withdrawn"]);

export const BOARDING_POLICY_GATES: BoardingReadiness["policyGates"] = [
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

export async function evaluateBoardingReadiness(
  dealId: number,
  opts: { includeFieldCompleteness?: boolean } = {},
): Promise<BoardingReadiness> {
  const includeFields = opts.includeFieldCompleteness !== false;
  const blockers: ReadinessBlocker[] = [];

  const dealRes = await db.execute(sql`SELECT id, pipeline FROM deals WHERE id = ${dealId} LIMIT 1`);
  const deal = ((dealRes as any).rows ?? dealRes)[0] as { id: number; pipeline: string | null } | undefined;
  if (!deal) {
    return {
      dealId, ready: false, blockers: [{ code: "deal_not_found" }],
      facts: { internalDecision: "none_recorded", internalDecisionId: null, applicationStatus: null, applicationUpdatedAt: null },
      policyGates: BOARDING_POLICY_GATES,
    };
  }
  if (deal.pipeline !== "onboarding") {
    blockers.push({ code: "deal_not_in_onboarding_pipeline", detail: `pipeline=${deal.pipeline ?? "none"}` });
  }

  const appRes = await db.execute(sql`
    SELECT *, updated_at::text AS updated_at_text FROM merchant_applications
    WHERE deal_id = ${dealId} ORDER BY id LIMIT 1`);
  const app = ((appRes as any).rows ?? appRes)[0] as Record<string, any> | undefined;
  if (!app) {
    blockers.push({ code: "no_linked_application" });
  } else {
    if (NEGATIVE_APPLICATION_STATUSES.has(String(app.status ?? "").toLowerCase())) {
      blockers.push({ code: "application_not_active", detail: `status=${app.status}` });
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
    WHERE deal_id = ${dealId} ORDER BY id DESC LIMIT 1`);
  const dec = ((decRes as any).rows ?? decRes)[0] as { id: number; decision: string; override_action: string | null } | undefined;
  let internalDecision: BoardingReadiness["facts"]["internalDecision"] = "none_recorded";
  if (dec) {
    const effective = (dec.override_action ?? dec.decision) as string;
    internalDecision = (["approve", "review", "hold", "reject"].includes(effective) ? effective : "review") as any;
    if (internalDecision === "reject" || internalDecision === "hold") {
      blockers.push({ code: "internal_underwriting_not_cleared", detail: `latest decision=${internalDecision}` });
    }
  }

  return {
    dealId,
    ready: blockers.length === 0,
    blockers,
    facts: {
      internalDecision,
      internalDecisionId: dec?.id ?? null,
      applicationStatus: app?.status ?? null,
      applicationUpdatedAt: app?.updated_at_text ?? null,
    },
    policyGates: BOARDING_POLICY_GATES,
  };
}
