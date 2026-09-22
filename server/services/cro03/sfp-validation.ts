/**
 * sfp-validation.ts
 *
 * ZeroBounce validation specifically for the South Florida Prospecting program.
 * Uses the canonical decryption boundary; never sends masked_value to ZeroBounce.
 * Writes outcomes to sfp_outreach_eligibility with versioned policy decisions.
 *
 * No runtime DDL — all tables created via migrations.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { businessHasDbprLineageSql } from "../dbpr";
import { openCandidate } from "./candidate-vault";
import { type OutreachEligibilityStatus } from "./south-florida-prospecting";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const SFP_VALIDATION_MAX = 25;
export const ZB_UNIT_MICROS = 10_000;
const SFP_POLICY_VERSION = 1;

export type SfpZbOutcome =
  | "valid" | "invalid" | "catch-all" | "spamtrap" | "abuse"
  | "do_not_mail" | "unknown" | "failed";

export interface SfpValidationPreview {
  cohortRunId: string;
  cohortFrozenHash: string;
  cohortSize: number;
  addressesForValidation: number;
  businessesWithoutCandidate: number;
  provider: "zerobounce";
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  maxValidations: number;
  selectedCandidates: Array<{
    businessId: number;
    candidateId: string;
    maskedValue: string;
    confidence: number;
  }>;
  gateOpen: boolean;
  gateBlockedReason: string | null;
  capturedAt: string;
}

export interface SfpValidationResult {
  cohortRunId: string;
  idempotencyKey: string;
  addressesValidated: number;
  validCount: number;
  catchAllCount: number;
  invalidCount: number;
  failedCount: number;
  eligibilityRowsCreated: number;
  /** Always true — no outreach is sent */
  zeroOutreachConfirmed: true;
  completedAt: string;
}

// ── Preview (read-only) ───────────────────────────────────────────────────────

export async function previewSfpValidation(cohortRunId: string): Promise<SfpValidationPreview> {
  const runRow = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (!runRow.cohort_hash) throw new Error("SFP_VALIDATION_PREVIEW:cohort_not_frozen");

  const members = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members
    WHERE cohort_run_id = ${cohortRunId}::uuid ORDER BY roi_score DESC
  `));
  const bizIds = members.map((m: any) => Number(m.business_id));

  const bestCandidates = bizIds.length === 0 ? [] : rows(await db.execute(sql`
    SELECT DISTINCT ON (fdc.business_id)
      fdc.id AS candidate_id,
      fdc.business_id,
      fdc.masked_value,
      fdc.confidence
    FROM free_discovery_candidates fdc
    WHERE fdc.business_id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND fdc.disposition = 'staged'
      AND NOT ${businessHasDbprLineageSql(sql`fdc.business_id`)}
    ORDER BY fdc.business_id, fdc.confidence DESC
  `));

  const selected = bestCandidates.slice(0, SFP_VALIDATION_MAX);

  // Gate check — require live attestation
  const attestRow = rows(await db.execute(sql`
    SELECT id FROM cro03c_runtime_attestations
    WHERE expires_at > NOW() AND db_healthy = true AND redis_healthy = true
    ORDER BY captured_at DESC LIMIT 1
  `))[0];

  return {
    cohortRunId,
    cohortFrozenHash: String(runRow.cohort_hash),
    cohortSize: bizIds.length,
    addressesForValidation: selected.length,
    businessesWithoutCandidate: bizIds.length - bestCandidates.length,
    provider: "zerobounce",
    estimatedCostMicros: selected.length * ZB_UNIT_MICROS,
    worstCaseCostMicros: SFP_VALIDATION_MAX * ZB_UNIT_MICROS,
    maxValidations: SFP_VALIDATION_MAX,
    selectedCandidates: selected.map((c: any) => ({
      businessId: Number(c.business_id),
      candidateId: String(c.candidate_id),
      maskedValue: String(c.masked_value),
      confidence: Number(c.confidence),
    })),
    gateOpen: !!attestRow,
    gateBlockedReason: attestRow ? null : "NO_LIVE_RUNTIME_ATTESTATION",
    capturedAt: new Date().toISOString(),
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeSfpValidation(
  cohortRunId: string,
  opts: {
    idempotencyKey: string;
    actorId: string;
    maxValidations?: number;
    /** Fake transport for tests. (candidateId, maskedValue) → ZbOutcome */
    zbTransport?: (candidateId: string, masked: string) => Promise<SfpZbOutcome>;
  },
): Promise<SfpValidationResult> {
  const maxValidations = Math.min(opts.maxValidations ?? SFP_VALIDATION_MAX, SFP_VALIDATION_MAX);

  const runRow = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (!runRow.cohort_hash) throw new Error("SFP_VALIDATION_BLOCKED:cohort_not_frozen");

  // Idempotency: if key already recorded, replay
  const existingRows = rows(await db.execute(sql`
    SELECT * FROM sfp_outreach_eligibility
    WHERE cohort_run_id = ${cohortRunId}::uuid AND policy_version = ${SFP_POLICY_VERSION}
    LIMIT 1
  `));
  if (existingRows.length > 0 && String(runRow.status) === "staged") {
    // Count existing
    const counts = rows(await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt FROM sfp_outreach_eligibility
      WHERE cohort_run_id = ${cohortRunId}::uuid GROUP BY status
    `));
    const byStatus: Record<string, number> = {};
    for (const r of counts) byStatus[String(r.status)] = Number(r.cnt);
    return {
      cohortRunId,
      idempotencyKey: opts.idempotencyKey,
      addressesValidated: existingRows.length,
      validCount: byStatus["validated_outreach_eligible"] ?? 0,
      catchAllCount: byStatus["catch_all_review"] ?? 0,
      invalidCount: byStatus["invalid"] ?? 0,
      failedCount: 0,
      eligibilityRowsCreated: 0,
      zeroOutreachConfirmed: true,
      completedAt: new Date().toISOString(),
    };
  }

  const members = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members
    WHERE cohort_run_id = ${cohortRunId}::uuid ORDER BY roi_score DESC
  `));
  const bizIds = members.map((m: any) => Number(m.business_id));
  if (bizIds.length === 0) throw new Error("SFP_VALIDATION_BLOCKED:EMPTY_COHORT");

  // Best staged candidate per business
  const bestCandidates = rows(await db.execute(sql`
    SELECT DISTINCT ON (fdc.business_id)
      fdc.id AS candidate_id,
      fdc.business_id,
      fdc.masked_value,
      fdc.confidence,
      fdc.envelope_ciphertext,
      fdc.envelope_nonce,
      fdc.envelope_tag,
      fdc.envelope_key_version
    FROM free_discovery_candidates fdc
    WHERE fdc.business_id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND fdc.disposition = 'staged'
      AND NOT ${businessHasDbprLineageSql(sql`fdc.business_id`)}
    ORDER BY fdc.business_id, fdc.confidence DESC
  `));

  const selectedCandidates = bestCandidates.slice(0, maxValidations);

  // Build ZeroBounce transport
  let zbTransport: (candidateId: string, masked: string) => Promise<SfpZbOutcome>;
  if (opts.zbTransport) {
    zbTransport = opts.zbTransport;
  } else {
    const { verifyEmail } = await import("../sdr/zerobounce");
    zbTransport = async (candidateId, _masked) => {
      // SECURITY: always decrypt the real address — never use masked_value
      const candRow = rows(await db.execute(sql`
        SELECT id, business_id, envelope_ciphertext, envelope_nonce,
               envelope_tag, envelope_key_version, masked_value
        FROM free_discovery_candidates WHERE id = ${candidateId}::uuid LIMIT 1
      `))[0];
      if (!candRow) return "failed";

      let realEmail: string;
      try {
        realEmail = openCandidate({
          field: "email",
          subjectId: Number(candRow.business_id),
          subjectGeneration: null,
          envelope: {
            ciphertext: String(candRow.envelope_ciphertext),
            nonce: String(candRow.envelope_nonce),
            tag: String(candRow.envelope_tag),
            keyVersion: Number(candRow.envelope_key_version ?? 1),
            normalizedValueHash: "",
            maskedValue: String(candRow.masked_value ?? ""),
          },
        });
      } catch {
        return "failed";
      }

      const result = await verifyEmail(realEmail);
      if (result.skipped) return "failed";
      switch (result.status) {
        case "valid":   return "valid";
        case "invalid": return "invalid";
        case "unsafe":  return "do_not_mail";
        case "unknown": return "unknown";
        default:        return "unknown";
      }
    };
  }

  let validCount = 0, catchAllCount = 0, invalidCount = 0, failedCount = 0, eligibilityRowsCreated = 0;

  for (const cand of selectedCandidates) {
    const bizId = Number(cand.business_id);
    let zbOutcome: SfpZbOutcome = "failed";
    let status: OutreachEligibilityStatus = "invalid";
    let decisionReason = "";

    try {
      zbOutcome = await zbTransport(String(cand.candidate_id), String(cand.masked_value));
    } catch {
      zbOutcome = "failed";
    }

    const validationAt = new Date().toISOString();

    switch (zbOutcome) {
      case "valid":
        status = "validated_outreach_eligible";
        decisionReason = "zb_valid:cold_b2b_policy_v1_eligible";
        validCount++;
        break;
      case "catch-all":
        status = "catch_all_review";
        decisionReason = "zb_catch_all:operator_review_required";
        catchAllCount++;
        break;
      case "invalid":
      case "spamtrap":
      case "abuse":
      case "do_not_mail":
        status = "invalid";
        decisionReason = `zb_${zbOutcome}:not_deliverable`;
        invalidCount++;
        break;
      case "unknown":
        status = "validated_review_required";
        decisionReason = "zb_unknown:manual_review_required";
        catchAllCount++;
        break;
      case "failed":
        status = "validation_pending";
        decisionReason = "zb_transport_failed:retry_required";
        failedCount++;
        break;
    }

    // Determine named vs role inbox from candidate metadata
    const isNamedContact = false; // requires Apollo reveal — not run at this stage
    const isRoleInbox = String(cand.masked_value ?? "").match(/^info@|^hello@|^contact@|^admin@|^support@/) !== null;

    await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, candidate_id, policy_version,
         status, decision_reason, zb_outcome, validation_at,
         named_contact, role_inbox, masked_email, discovery_source)
      VALUES (
        ${cohortRunId}::uuid,
        ${bizId},
        ${String(cand.candidate_id)}::uuid,
        ${SFP_POLICY_VERSION},
        ${status},
        ${decisionReason},
        ${String(zbOutcome)},
        ${validationAt}::timestamptz,
        ${isNamedContact},
        ${isRoleInbox},
        ${String(cand.masked_value)},
        'free_discovery'
      )
      ON CONFLICT (cohort_run_id, business_id, policy_version)
      DO UPDATE SET
        status = EXCLUDED.status,
        decision_reason = EXCLUDED.decision_reason,
        zb_outcome = EXCLUDED.zb_outcome,
        validation_at = EXCLUDED.validation_at,
        masked_email = EXCLUDED.masked_email,
        updated_at = NOW()
    `);
    eligibilityRowsCreated++;
  }

  // Add discovery_required rows for businesses without a candidate
  const validatedBizIds = new Set(selectedCandidates.map((c: any) => Number(c.business_id)));
  for (const bizId of bizIds) {
    if (!validatedBizIds.has(bizId)) {
      await db.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id, business_id, policy_version, status, decision_reason)
        VALUES (${cohortRunId}::uuid, ${bizId}, ${SFP_POLICY_VERSION},
                'discovery_required', 'no_staged_candidate')
        ON CONFLICT (cohort_run_id, business_id, policy_version) DO NOTHING
      `);
    }
  }

  // Update run status
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status = 'staged', completed_at = NOW()
    WHERE id = ${cohortRunId}::uuid
  `);

  return {
    cohortRunId,
    idempotencyKey: opts.idempotencyKey,
    addressesValidated: selectedCandidates.length,
    validCount,
    catchAllCount,
    invalidCount,
    failedCount,
    eligibilityRowsCreated,
    zeroOutreachConfirmed: true,
    completedAt: new Date().toISOString(),
  };
}
