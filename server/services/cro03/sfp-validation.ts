/**
 * sfp-validation.ts
 *
 * ZeroBounce validation specifically for the South Florida Prospecting program.
 * Uses the canonical decryption boundary; never sends masked_value to ZeroBounce.
 * Writes outcomes to sfp_outreach_eligibility with versioned policy decisions.
 *
 * No runtime DDL — all tables created via migrations.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { businessHasDbprLineageSql } from "../dbpr";
import { unseal as unsealCandidateEvidence } from "./candidate-evidence-service";
import { type OutreachEligibilityStatus } from "./south-florida-prospecting";
import {
  assertCurrentSfpProviderReservation,
  assertSfpRuntimeAuthority,
  currentSfpUnitPrice,
  reserveSfpProviderOperation,
  settleSfpProviderOperation,
} from "./sfp-provider-operations";

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
  if (runRow.cohort_state !== "frozen" || runRow.voided_at || runRow.superseded_at) {
    throw new Error(`SFP_VALIDATION_PREVIEW:cohort_not_usable:state=${runRow.cohort_state}`);
  }

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
      AND fdc.disposition IN ('staged','validation_admitted')
      AND NOT ${businessHasDbprLineageSql(sql`fdc.business_id`)}
    ORDER BY fdc.business_id, fdc.confidence DESC
  `));

  const selected = bestCandidates.slice(0, SFP_VALIDATION_MAX);

  let gateBlockedReason: string | null = null;
  try {
    if (process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED !== "true") {
      throw new Error("FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED");
    }
    await assertSfpRuntimeAuthority(cohortRunId);
    const { assertPaidBudgetAuthorized } = await import("../mi09-pilot-authority");
    await assertPaidBudgetAuthorized();
    await currentSfpUnitPrice("zerobounce");
    const control = rows(await db.execute(sql`
      SELECT enabled,circuit_state,local_budget_units,reserved_units,consumed_units
        FROM provider_controls WHERE provider='zerobounce'
    `))[0];
    if (!control?.enabled || control.circuit_state !== "closed") throw new Error("ZEROBOUNCE_PROVIDER_DISABLED");
    if (control.local_budget_units == null || Number(control.reserved_units)+Number(control.consumed_units)+selected.length > Number(control.local_budget_units)) {
      throw new Error("ZEROBOUNCE_LOCAL_BUDGET_EXHAUSTED");
    }
  } catch (error: any) {
    gateBlockedReason = String(error?.message ?? error);
  }
  const unitPrice = await currentSfpUnitPrice("zerobounce").catch(() => ZB_UNIT_MICROS);

  return {
    cohortRunId,
    cohortFrozenHash: String(runRow.cohort_hash),
    cohortSize: bizIds.length,
    addressesForValidation: selected.length,
    businessesWithoutCandidate: bizIds.length - bestCandidates.length,
    provider: "zerobounce",
    estimatedCostMicros: selected.length * unitPrice,
    worstCaseCostMicros: SFP_VALIDATION_MAX * unitPrice,
    maxValidations: SFP_VALIDATION_MAX,
    selectedCandidates: selected.map((c: any) => ({
      businessId: Number(c.business_id),
      candidateId: String(c.candidate_id),
      maskedValue: String(c.masked_value),
      confidence: Number(c.confidence),
    })),
    gateOpen: gateBlockedReason === null,
    gateBlockedReason,
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
    SELECT r.*,p.is_active FROM sfp_cohort_runs r JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (runRow.cohort_state !== "frozen" || runRow.voided_at || runRow.superseded_at) {
    throw new Error(`SFP_VALIDATION_BLOCKED:cohort_not_usable:state=${runRow.cohort_state}`);
  }

  if (!runRow.is_active) throw new Error("SFP_VALIDATION_BLOCKED:program_inactive");
  if (!opts.zbTransport && process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED !== "true") {
    throw new Error("SFP_VALIDATION_BLOCKED:FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED");
  }

  const existingStage = rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='validation' AND idempotency_key=${opts.idempotencyKey} LIMIT 1
  `))[0];
  if (existingStage?.state === "completed") {
    // Count existing
    const counts = rows(await db.execute(sql`
      SELECT status,zb_outcome,COUNT(*)::int AS cnt FROM sfp_outreach_eligibility
      WHERE cohort_run_id = ${cohortRunId}::uuid GROUP BY status,zb_outcome
    `));
    const byStatus: Record<string, number> = {};
    let providerValidCount = 0;
    for (const r of counts) {
      byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + Number(r.cnt);
      if (r.zb_outcome === "valid") providerValidCount += Number(r.cnt);
    }
    return {
      cohortRunId,
      idempotencyKey: opts.idempotencyKey,
      addressesValidated: Number(existingStage.processed_count),
      validCount: providerValidCount,
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

  const stageRun = existingStage ?? rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,started_at,last_heartbeat_at)
    VALUES (${cohortRunId}::uuid,'validation',${opts.idempotencyKey},${opts.actorId},
            ${opts.zbTransport ? "running" : "authorized"},${maxValidations},'["zerobounce"]'::jsonb,NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];

  // Best eligible candidate per business. A prior failed attempt stays staged;
  // an operator-admitted candidate is also eligible. Suppressed rows never enter.
  const bestCandidates = rows(await db.execute(sql`
    SELECT DISTINCT ON (fdc.business_id)
      fdc.id AS candidate_id,
      fdc.business_id,
      fdc.masked_value,
      fdc.confidence,
      fdc.envelope_ciphertext,
      fdc.envelope_nonce,
      fdc.envelope_tag,
      fdc.envelope_key_version,
      fdc.normalized_value_hash,
      fdc.attribution_scope,
      fdc.source
    FROM free_discovery_candidates fdc
    WHERE fdc.business_id = ANY(ARRAY[${sql.join(bizIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND fdc.disposition IN ('staged','validation_admitted')
      AND NOT ${businessHasDbprLineageSql(sql`fdc.business_id`)}
    ORDER BY fdc.business_id, fdc.confidence DESC
  `));

  const selectedCandidates = bestCandidates.slice(0, maxValidations);

  let validationAttempts = 0, validCount = 0, catchAllCount = 0, invalidCount = 0, failedCount = 0, eligibilityRowsCreated = 0;

  for (const cand of selectedCandidates) {
    const bizId = Number(cand.business_id);
    let zbOutcome: SfpZbOutcome = "failed";
    let status: OutreachEligibilityStatus = "invalid";
    let decisionReason = "";
    let realEmail = "";
    let contactEmailTokenHash = "";

    try {
      realEmail = unsealCandidateEvidence("email", {
        ciphertext: String(cand.envelope_ciphertext), nonce: String(cand.envelope_nonce),
        tag: String(cand.envelope_tag), keyVersion: Number(cand.envelope_key_version ?? 1),
      });
      contactEmailTokenHash = createHash("sha256").update(realEmail.trim().toLowerCase()).digest("hex");
    } catch {
      failedCount++;
      await db.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id,business_id,candidate_id,policy_version,status,decision_reason,
           suppression_status,masked_email,discovery_source)
        VALUES (${cohortRunId}::uuid,${bizId},${String(cand.candidate_id)}::uuid,${SFP_POLICY_VERSION},
                'validation_pending','candidate_decryption_failed','unchecked',${String(cand.masked_value)},${String(cand.source)})
        ON CONFLICT(cohort_run_id,business_id,policy_version) DO UPDATE
          SET status='validation_pending',decision_reason='candidate_decryption_failed',updated_at=NOW()
      `);
      eligibilityRowsCreated++;
      continue;
    }

    // Fail closed on the canonical contact suppression/bounce surface before
    // decrypting or reserving spend. Do not rely on an optional provider-
    // specific table that may not exist in production.
    const suppressionRow = rows(await db.execute(sql`
      SELECT EXISTS(
        SELECT 1
        FROM contacts c
        WHERE c.email_token_hash IN (${String(cand.normalized_value_hash)}, ${contactEmailTokenHash})
          AND (
            COALESCE(c.opted_out_email, FALSE) = TRUE
            OR c.opt_out_status = 'opted_out'
            OR c.unsubscribe_status = 'unsubscribed'
            OR c.complaint_status = 'reported'
            OR COALESCE(c.do_not_auto_contact, FALSE) = TRUE
            OR c.suppression_reason IS NOT NULL
            OR c.bounce_status = 'hard'
            OR c.email_status IN ('bounced', 'invalid')
          )
      ) AS suppressed
    `))[0];
    if (suppressionRow?.suppressed === true) {
      await db.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id,business_id,candidate_id,policy_version,status,decision_reason,suppression_status,masked_email,discovery_source)
        VALUES (${cohortRunId}::uuid,${bizId},${String(cand.candidate_id)}::uuid,${SFP_POLICY_VERSION},
                'validated_suppressed','canonical_suppression_match','suppressed',${String(cand.masked_value)},${String(cand.source)})
        ON CONFLICT(cohort_run_id,business_id,policy_version) DO UPDATE
          SET status='validated_suppressed',decision_reason=EXCLUDED.decision_reason,suppression_status='suppressed',updated_at=NOW()
      `);
      eligibilityRowsCreated++;
      continue;
    }

    let reservation: Awaited<ReturnType<typeof reserveSfpProviderOperation>> | null = null;
    try {
      if (opts.zbTransport) {
        zbOutcome = await opts.zbTransport(String(cand.candidate_id), String(cand.masked_value));
        validationAttempts++;
      } else {
        reservation = await reserveSfpProviderOperation({
          stageRunId:String(stageRun.id),cohortRunId,businessId:bizId,candidateId:String(cand.candidate_id),
          provider:"zerobounce",purpose:"sfp_email_validation",
          idempotencyKey:`${opts.idempotencyKey}:zerobounce:${String(cand.candidate_id)}`,actorId:opts.actorId,
        });
        await assertCurrentSfpProviderReservation(reservation);
        const { verifyEmail } = await import("../sdr/zerobounce");
        const result = await verifyEmail(realEmail);
        validationAttempts++;
        if (result.skipped || result.outcome !== "completed") zbOutcome = "failed";
        else if (result.status === "valid") zbOutcome = "valid";
        else if (result.status === "invalid") zbOutcome = "invalid";
        else if (result.status === "unsafe") zbOutcome = "do_not_mail";
        else if (result.status === "unverified") zbOutcome = result.subStatus === "catch-all" ? "catch-all" : "unknown";
        else zbOutcome = "unknown";
      }
    } catch {
      zbOutcome = "failed";
    }

    const validationAt = new Date().toISOString();

    // Candidate metadata controls outreach eligibility independently of
    // deliverability. Named addresses remain review-required; a verified
    // first-party role inbox can enter the bounded cold-B2B staging cohort.
    const isNamedContact = String(cand.attribution_scope) === "named";
    const isRoleInbox = String(cand.attribution_scope) === "role";

    switch (zbOutcome) {
      case "valid":
        status = isRoleInbox ? "validated_outreach_eligible" : "validated_review_required";
        decisionReason = isRoleInbox
          ? "zb_valid:first_party_role_inbox:cold_b2b_policy_v1_eligible"
          : "zb_valid:named_or_unclassified_address:operator_review_required";
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

    if (reservation) {
      const obs = zbOutcome === "valid" ? "valid" : zbOutcome === "invalid" || zbOutcome === "spamtrap" || zbOutcome === "abuse" || zbOutcome === "do_not_mail" ? "invalid" : zbOutcome === "failed" ? "transport" : "unknown";
      await settleSfpProviderOperation({
        reservation,outcome:zbOutcome === "failed" ? "failed" : "completed",observation:obs,
        businessId:bizId,emailTokenHash:String(cand.normalized_value_hash),
      });
    }

    await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, candidate_id, policy_version,
         status, decision_reason, zb_outcome, validation_at,
         named_contact, role_inbox, masked_email, discovery_source,evidence_confidence,
         suppression_status,outreach_policy_version,outreach_policy_reason,validation_operation_id)
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
        ${String(cand.source)},${Number(cand.confidence)},'not_suppressed',${SFP_POLICY_VERSION},${decisionReason},
        ${reservation?.operationId ?? null}::uuid
      )
      ON CONFLICT (cohort_run_id, business_id, policy_version)
      DO UPDATE SET
        status = EXCLUDED.status,
        decision_reason = EXCLUDED.decision_reason,
        zb_outcome = EXCLUDED.zb_outcome,
        validation_at = EXCLUDED.validation_at,
        masked_email = EXCLUDED.masked_email,
        evidence_confidence=EXCLUDED.evidence_confidence,
        suppression_status=EXCLUDED.suppression_status,
        validation_operation_id=EXCLUDED.validation_operation_id,
        updated_at = NOW()
    `);
    if (zbOutcome === "valid") {
      // Projection is allowed only after a completed provider-valid result.
      // The plaintext remains in the canonical operational field; telemetry,
      // audit records, and API responses continue to use the hash/mask only.
      const emailHash = createHash("sha256").update(`email\0${realEmail.toLowerCase().trim()}`).digest("hex");
      if (emailHash !== String(cand.normalized_value_hash)) {
        throw new Error("SFP_VALIDATION_HASH_MISMATCH");
      }
      await db.execute(sql`
        UPDATE businesses
           SET main_email=${realEmail},email_discovery_status='provider_valid',
               email_validation_updated_at=NOW(),email_selected_candidate_hash=${emailHash},updated_at=NOW()
         WHERE id=${bizId}
           AND (main_email IS NULL OR email_selected_candidate_hash=${emailHash})
      `);
    }
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

  // NOTE: the cohort run's own lifecycle field (cohort_state) is never
  // mutated by a downstream stage. A frozen cohort's lifecycle stays
  // 'frozen' for its entire life (until an explicit void/supersede);
  // stage-progress belongs only to sfp_stage_runs.state, updated below.
  // A prior revision wrote status='staged' onto sfp_cohort_runs here,
  // corrupting the run's own status field with a downstream stage's
  // progress value — removed.
  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failedCount > 0 ? "partial" : "completed"},selected_count=${selectedCandidates.length},
           processed_count=${validationAttempts},succeeded_count=${validCount+catchAllCount+invalidCount},
           failed_count=${failedCount},completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${String(stageRun.id)}::uuid
  `);

  return {
    cohortRunId,
    idempotencyKey: opts.idempotencyKey,
    addressesValidated: validationAttempts,
    validCount,
    catchAllCount,
    invalidCount,
    failedCount,
    eligibilityRowsCreated,
    zeroOutreachConfirmed: true,
    completedAt: new Date().toISOString(),
  };
}
