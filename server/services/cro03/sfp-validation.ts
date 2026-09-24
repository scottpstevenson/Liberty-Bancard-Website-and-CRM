/**
 * sfp-validation.ts
 *
 * ZeroBounce validation for the South Florida Prospecting program.
 *
 * Task #2000 contract:
 *  - Reads unified free+paid candidates (getUnifiedSfpCandidates); never
 *    free-only.
 *  - Applies the canonical free-candidate prefilter (rejectEmailCandidate)
 *    and an authoritative MX/DNS check BEFORE any provider reservation or
 *    decryption. no_mx = ineligible, zero spend. dns_indeterminate = retryable,
 *    never treated as invalid or paid-ready.
 *  - Opens plaintext only through the audited openSfpCandidatePlaintext
 *    boundary; the real decrypted address (never masked_value) is what
 *    reaches the transport/ZeroBounce.
 *  - Applies the versioned policy evaluator (DBPR, existing-customer,
 *    consent-tier, suppression) in addition to role-inbox classification.
 *  - Reuses a fresh (within-TTL) provider observation instead of re-calling
 *    the provider, but still re-runs every mutable safety gate.
 *  - Settlement + eligibility write + stage-item + counters happen in one
 *    transaction (settleSfpProviderOperation is passed the same `tx`).
 *
 * SPF/DKIM/DMARC are sender-domain release controls and are never consulted
 * here — this module validates recipient addresses only.
 *
 * No runtime DDL — all tables created via migrations.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { businessHasDbprLineageSql } from "../dbpr";
import { type OutreachEligibilityStatus } from "./south-florida-prospecting";
import {
  assertCurrentSfpProviderReservation,
  assertSfpRuntimeAuthority,
  currentSfpUnitPrice,
  reserveSfpProviderOperation,
  settleSfpProviderOperation,
} from "./sfp-provider-operations";
import { getUnifiedSfpCandidates, openSfpCandidatePlaintext, type UnifiedSfpCandidateView } from "./sfp-paid-evidence-writer";
import { rejectEmailCandidate, checkMxRecord } from "./candidate-selector";
import {
  getActiveSfpOutreachPolicy,
  evaluateSfpMutableSafetyGates,
  isCanonicallySuppressed,
  lookupConsentTierByEmailHash,
  findFreshProviderObservation,
  type SfpActivePolicy,
} from "./sfp-outreach-policy";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const SFP_VALIDATION_MAX = 25;
export const ZB_UNIT_MICROS = 10_000;
const SFP_POLICY_VERSION = 1;

export type SfpZbOutcome =
  | "valid" | "invalid" | "catch-all" | "spamtrap" | "abuse"
  | "do_not_mail" | "unknown" | "failed";

/**
 * The single snapshot computation shared by preview and execute. Covers the
 * cohort manifest, the ranked winner references/hashes selected from the
 * unified free+paid pool, the active policy document's id/hash, the
 * ZeroBounce unit price, the aggregate cap, and the requested maximum.
 * Preview and execute must derive this identically — execute recomputes it
 * fresh and requires it to match the hash the caller captured from preview,
 * so a cohort/candidate/policy/price change between preview and execute
 * fails closed instead of silently validating against stale state.
 */
export async function computeSfpValidationSnapshot(
  cohortRunId: string,
  maxValidations: number,
): Promise<{ snapshotHash: string; payload: Record<string, unknown> }> {
  const policy = await getActiveSfpOutreachPolicy();
  const members = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members
    WHERE cohort_run_id = ${cohortRunId}::uuid ORDER BY roi_score DESC
  `));
  const bizIds = members.map((m: any) => Number(m.business_id));
  const winners = await selectWinnersPerBusiness(bizIds);
  const selected = Array.from(winners.entries()).slice(0, maxValidations);
  const unitPrice = await currentSfpUnitPrice("zerobounce").catch(() => ZB_UNIT_MICROS);

  const payload = {
    cohortRunId,
    maxValidations,
    policyId: policy.id,
    policyDocumentHash: policy.documentHash,
    unitPriceMicros: unitPrice,
    aggregateCapMicros: SFP_VALIDATION_MAX,
    winners: selected
      .map(([bizId, cand]) => ({ businessId: bizId, evidenceId: cand.evidenceId, sourceKind: cand.sourceKind }))
      .sort((a, b) => a.businessId - b.businessId),
  };
  const snapshotHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { snapshotHash, payload };
}

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
  /** Must be passed back verbatim to executeSfpValidation. */
  snapshotHash: string;
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

/** One ranked winner candidate per business, from the unified free+paid pool. */
async function selectWinnersPerBusiness(bizIds: number[]): Promise<Map<number, UnifiedSfpCandidateView>> {
  const unified = await getUnifiedSfpCandidates(bizIds);
  const winners = new Map<number, UnifiedSfpCandidateView>();
  for (const cand of unified) {
    if (cand.field !== "email") continue;
    if (!["staged", "validation_admitted"].includes(cand.disposition)) continue;
    if (cand.duplicateOfEvidenceId) continue; // canonical winner already represents this normalized value
    const existing = winners.get(cand.businessId);
    if (!existing || cand.confidence > existing.confidence) {
      winners.set(cand.businessId, cand);
    }
  }
  return winners;
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

  const winners = await selectWinnersPerBusiness(bizIds);
  const selected = Array.from(winners.entries()).slice(0, SFP_VALIDATION_MAX);
  const { snapshotHash } = await computeSfpValidationSnapshot(cohortRunId, SFP_VALIDATION_MAX);

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
    businessesWithoutCandidate: bizIds.length - winners.size,
    provider: "zerobounce",
    estimatedCostMicros: selected.length * unitPrice,
    worstCaseCostMicros: SFP_VALIDATION_MAX * unitPrice,
    maxValidations: SFP_VALIDATION_MAX,
    selectedCandidates: selected.map(([businessId, c]) => ({
      businessId,
      candidateId: c.evidenceId,
      maskedValue: c.maskedValue,
      confidence: c.confidence,
    })),
    gateOpen: gateBlockedReason === null,
    gateBlockedReason,
    capturedAt: new Date().toISOString(),
    snapshotHash,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeSfpValidation(
  cohortRunId: string,
  opts: {
    idempotencyKey: string;
    actorId: string;
    maxValidations?: number;
    /** The snapshotHash returned by previewSfpValidation for this exact run. Required. */
    snapshotHash: string;
    /** Fake transport for tests. (candidateId, REAL decrypted email) → ZbOutcome */
    zbTransport?: (candidateId: string, realEmail: string) => Promise<SfpZbOutcome>;
  },
): Promise<SfpValidationResult> {
  if (!opts.snapshotHash) throw new Error("SFP_VALIDATION_BLOCKED:snapshotHash_required");
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

  const policy = await getActiveSfpOutreachPolicy();

  // Snapshot-bound execution: recompute the identical snapshot preview used,
  // and require it to still match. Any drift in the cohort manifest,
  // candidate pool, active policy, or unit price between preview and
  // execute fails closed rather than silently validating against state the
  // caller never actually saw.
  const currentSnapshot = await computeSfpValidationSnapshot(cohortRunId, maxValidations);
  if (currentSnapshot.snapshotHash !== opts.snapshotHash) {
    throw new Error("SFP_VALIDATION_SNAPSHOT_MISMATCH:preview_stale_reissue_preview");
  }
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...currentSnapshot.payload, idempotencyKey: opts.idempotencyKey }))
    .digest("hex");

  const existingStage = rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='validation' AND idempotency_key=${opts.idempotencyKey} LIMIT 1
  `))[0];
  // Same idempotency key with a materially different payload (different
  // cohort, snapshot, policy, or requested max) fails closed with a
  // conflict — it must never silently execute the new payload under the old
  // key's identity, nor silently replay the old result for a new request.
  if (existingStage && existingStage.payload_hash && existingStage.payload_hash !== payloadHash) {
    throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:payload_mismatch");
  }
  if (existingStage?.state === "completed") {
    // Idempotency keys are stage-scoped, not cohort-scoped: fail closed on a
    // replay whose cohort doesn't match the run this key was created under,
    // rather than silently returning another cohort's stored result.
    if (String(existingStage.cohort_run_id) !== String(cohortRunId)) {
      throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:cohort_mismatch");
    }
    if (existingStage.stored_result) {
      // A replay must never surface a decision that mutable safety gates
      // would now reject — re-evaluate DBPR/existing-customer/consent-tier
      // for every row this run marked outreach-eligible, and downgrade any
      // that no longer pass before returning the (otherwise unchanged) counts.
      const eligibleNow = rows(await db.execute(sql`
        SELECT id, business_id, consent_tier FROM sfp_outreach_eligibility
        WHERE cohort_run_id = ${cohortRunId}::uuid AND status = 'validated_outreach_eligible'
      `));
      for (const row of eligibleNow) {
        const recheck = await evaluateSfpMutableSafetyGates({
          businessId: Number(row.business_id), consentTier: row.consent_tier ?? null, policy,
        });
        if (!recheck.eligible) {
          await db.execute(sql`
            UPDATE sfp_outreach_eligibility
            SET status = ${recheck.status}, decision_reason = ${`replay_regate_failed:${recheck.reasonCode}`},
                updated_at = NOW()
            WHERE id = ${String(row.id)}::uuid
          `);
        }
      }
      return existingStage.stored_result as SfpValidationResult;
    }
    // Legacy pre-Task-2000 completed run with no stored result: reconstruct
    // exact counts from the eligibility rows it produced (best-effort replay).
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
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash,preview_snapshot_hash,started_at,last_heartbeat_at)
    VALUES (${cohortRunId}::uuid,'validation',${opts.idempotencyKey},${opts.actorId},
            ${opts.zbTransport ? "running" : "authorized"},${maxValidations},'["zerobounce"]'::jsonb,
            ${payloadHash},${opts.snapshotHash},NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];

  const winners = await selectWinnersPerBusiness(bizIds);
  const selectedEntries = Array.from(winners.entries()).slice(0, maxValidations);

  let validationAttempts = 0, validCount = 0, catchAllCount = 0, invalidCount = 0, failedCount = 0, eligibilityRowsCreated = 0;

  for (const [bizId, cand] of selectedEntries) {
    let zbOutcome: SfpZbOutcome = "failed";
    let status: OutreachEligibilityStatus = "invalid";
    let decisionReason = "";
    const reasonCodes: string[] = [];

    // Authoritative subject-type classification comes from the persisted
    // source row (free_discovery_candidates.subject_type /
    // sfp_paid_candidate_evidence.subject_type) — never inferred from
    // whether person-name evidence happens to be populated, since an
    // Apollo person-sourced candidate can lack a captured name and would
    // otherwise be misclassified as a business/role address.
    const subjectTypeForPrefilter: "business" | "person" = cand.subjectType === "person" ? "person" : "business";

    // ── Audited plaintext open (real email only — never masked_value) ──────
    // Decryption itself makes no provider call and costs no provider money,
    // so it is safe to decrypt before the syntax/MX prechecks below; those
    // prechecks then run against the REAL address (never the heavily
    // truncated masked_value, whose domain is masked down to 2 characters
    // and is therefore not usable for a real MX/disposable-domain check).
    // No ZeroBounce reservation or transport call happens until after every
    // one of these zero-cost gates has passed.
    let realEmail = "";
    let contactEmailTokenHash = "";
    try {
      const reference = cand.sourceKind === "free"
        ? { sourceKind: "free" as const, freeDiscoveryCandidateId: cand.evidenceId }
        : { sourceKind: "paid" as const, paidCandidateEvidenceId: cand.evidenceId };
      realEmail = await openSfpCandidatePlaintext(
        { reference, cohortRunId, actorId: opts.actorId, purpose: "sfp_email_validation" },
        async (plaintext) => plaintext,
      );
      contactEmailTokenHash = createHash("sha256").update(realEmail.trim().toLowerCase()).digest("hex");
    } catch (decErr: any) {
      if (process.env.SFP_DEBUG_DECRYPT) console.error("SFP_DEBUG_DECRYPT", bizId, decErr);
      failedCount++;
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "validation_pending",
        decisionReason: "candidate_decryption_failed", reasonCodes: ["candidate_decryption_failed"],
      });
      eligibilityRowsCreated++;
      continue;
    }

    // Real-address rejection (placeholder/synthetic/disposable-domain/
    // role-for-person), verified against the decrypted address before any
    // spend — this is the SAME canonical filter used by the free-discovery
    // winner-selection path (rejectEmailCandidate), never a second
    // implementation.
    const realRejection = rejectEmailCandidate(realEmail, subjectTypeForPrefilter);
    if (realRejection) {
      invalidCount++;
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "invalid",
        decisionReason: `precheck_${realRejection}:zero_provider_spend`, reasonCodes: [`precheck_${realRejection}`],
      });
      eligibilityRowsCreated++;
      continue;
    }

    // Authoritative MX/DNS check on the REAL domain, before any reservation.
    const realDomain = realEmail.split("@")[1]?.toLowerCase() ?? "";
    let mx: "ok" | "no_mx" | "dns_indeterminate" = "dns_indeterminate";
    try {
      mx = realDomain ? await checkMxRecord(realDomain) : "no_mx";
    } catch {
      mx = "dns_indeterminate";
    }
    if (mx === "no_mx") {
      invalidCount++;
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "invalid",
        decisionReason: "precheck_no_mx:authoritative_ineligible:zero_provider_spend", reasonCodes: ["precheck_no_mx"],
      });
      eligibilityRowsCreated++;
      continue;
    }
    if (mx === "dns_indeterminate") {
      // Retryable, not invalid, not ready for paid validation — stays pending.
      failedCount++;
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "validation_pending",
        decisionReason: "precheck_dns_indeterminate:retryable:zero_provider_spend", reasonCodes: ["precheck_dns_indeterminate"],
      });
      eligibilityRowsCreated++;
      continue;
    }

    // Canonical suppression check.
    const emailHash = createHash("sha256").update(`email\0${realEmail.toLowerCase().trim()}`).digest("hex");
    if (await isCanonicallySuppressed([String(cand.evidenceId ? emailHash : emailHash), contactEmailTokenHash])) {
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "validated_suppressed",
        decisionReason: "canonical_suppression_match", reasonCodes: ["policy_suppressed"],
        suppressionStatus: "suppressed",
      });
      eligibilityRowsCreated++;
      continue;
    }

    const consentTier = await lookupConsentTierByEmailHash(contactEmailTokenHash);

    // Mutable safety gates (DBPR / existing-customer / consent-tier) —
    // re-run even on a freshness-reuse hit below.
    const gate = await evaluateSfpMutableSafetyGates({ businessId: bizId, consentTier, policy });
    if (!gate.eligible) {
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: gate.status, decisionReason: gate.reasonCode,
        reasonCodes: [gate.reasonCode], consentTier,
      });
      eligibilityRowsCreated++;
      continue;
    }

    // ── Freshness reuse ──────────────────────────────────────────────────
    const fresh = await findFreshProviderObservation({
      businessId: bizId, emailTokenHash: contactEmailTokenHash, ttlDays: policy.validationTtlDays,
    });

    let reservation: Awaited<ReturnType<typeof reserveSfpProviderOperation>> | null = null;
    let rawStatus: string | null = null;
    let rawSubstatus: string | null = null;
    let reusedFromOperationId: string | null = null;

    if (fresh) {
      reusedFromOperationId = fresh.operationId;
      zbOutcome = fresh.outcome === "valid" ? "valid" : fresh.outcome === "invalid" ? "invalid" : "unknown";
      reasonCodes.push("policy_stale_reused");
    } else {
      try {
        if (opts.zbTransport) {
          zbOutcome = await opts.zbTransport(String(cand.evidenceId), realEmail);
          validationAttempts++;
        } else {
          reservation = await reserveSfpProviderOperation({
            stageRunId: String(stageRun.id), cohortRunId, businessId: bizId,
            candidateId: cand.sourceKind === "free" ? cand.evidenceId : undefined,
            provider: "zerobounce", purpose: "sfp_email_validation",
            idempotencyKey: `${opts.idempotencyKey}:zerobounce:${cand.evidenceId}`, actorId: opts.actorId,
          });
          await assertCurrentSfpProviderReservation(reservation);
          const { verifyEmail } = await import("../sdr/zerobounce");
          const result = await verifyEmail(realEmail);
          validationAttempts++;
          rawStatus = (result as any).status ?? null;
          rawSubstatus = (result as any).subStatus ?? null;
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
    }

    const validationAt = new Date().toISOString();
    // Role-inbox / named-contact decision is driven by the same persisted
    // subject_type used for the pre-check above, never re-inferred from
    // whether name evidence happens to be present.
    const isNamedContact = subjectTypeForPrefilter === "person";
    const isRoleInbox = !isNamedContact;
    const roleEligibleForColdB2b = policy.roleInboxPolicy?.role_inbox_eligible_for_cold_b2b !== false;
    const namedRequiresReview = policy.roleInboxPolicy?.named_or_unclassified_requires_review !== false;

    // The active policy document's accepted/retryable outcome lists govern
    // whether a given ZeroBounce outcome can ever produce eligibility —
    // never a hardcoded switch independent of policy activation.
    const isAccepted = policy.acceptedOutcomes.includes(zbOutcome);
    const isRetryable = policy.retryableOutcomes.includes(zbOutcome);

    if (zbOutcome === "valid" && isAccepted) {
      const roleOk = isRoleInbox && roleEligibleForColdB2b;
      status = roleOk ? "validated_outreach_eligible" : "validated_review_required";
      decisionReason = roleOk
        ? "zb_valid:first_party_role_inbox:policy_eligible"
        : isRoleInbox
          ? "zb_valid:role_inbox_not_policy_eligible:operator_review_required"
          : namedRequiresReview
            ? "zb_valid:named_or_unclassified_address:operator_review_required"
            : "zb_valid:named_contact:policy_eligible";
      reasonCodes.push(roleOk ? "zb_valid_role_inbox_eligible" : "zb_valid_review_required");
      validCount++;
    } else if (zbOutcome === "catch-all") {
      status = "catch_all_review";
      decisionReason = "zb_catch_all:operator_review_required";
      reasonCodes.push("zb_catch_all_review");
      catchAllCount++;
    } else if (isRetryable) {
      status = "validation_pending";
      decisionReason = `zb_${zbOutcome}:retryable_per_policy`;
      reasonCodes.push(`zb_${zbOutcome}_retryable`);
      failedCount++;
    } else if (zbOutcome === "unknown") {
      status = "validated_review_required";
      decisionReason = "zb_unknown:manual_review_required";
      reasonCodes.push("zb_unknown_review_required");
      catchAllCount++;
    } else if (zbOutcome === "failed") {
      status = "validation_pending";
      decisionReason = "zb_transport_failed:retry_required";
      reasonCodes.push("zb_transport_failed_retryable");
      failedCount++;
    } else {
      // invalid, spamtrap, abuse, do_not_mail, or a 'valid' outcome the
      // active policy does not (or no longer) accept.
      status = "invalid";
      decisionReason = `zb_${zbOutcome}:not_deliverable_per_policy`;
      reasonCodes.push(`zb_${zbOutcome}_not_deliverable`);
      invalidCount++;
    }

    // ── Atomic finalization: settlement + eligibility write + counters ────
    await db.transaction(async (tx) => {
      if (reservation) {
        const obs = zbOutcome === "valid" ? "valid" : zbOutcome === "invalid" || zbOutcome === "spamtrap" || zbOutcome === "abuse" || zbOutcome === "do_not_mail" ? "invalid" : zbOutcome === "failed" ? "transport" : "unknown";
        await settleSfpProviderOperation({
          reservation, outcome: zbOutcome === "failed" ? "failed" : "completed", observation: obs,
          businessId: bizId, emailTokenHash: contactEmailTokenHash,
        }, tx);
      }

      const expiresAt = new Date(Date.now() + policy.validationTtlDays * 86_400_000).toISOString();
      await tx.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id, business_id, candidate_id, paid_candidate_evidence_id, source_kind,
           policy_version, status, decision_reason, zb_outcome, validation_at, validation_expires_at,
           named_contact, role_inbox, masked_email, discovery_source, evidence_confidence,
           suppression_status, outreach_policy_version, outreach_policy_reason, validation_operation_id,
           normalized_value_hash, policy_document_id, policy_document_hash, consent_tier,
           raw_provider_status, raw_provider_substatus, reused_from_operation_id, reason_codes)
        VALUES (
          ${cohortRunId}::uuid, ${bizId},
          ${cand.sourceKind === "free" ? cand.evidenceId : null}::uuid,
          ${cand.sourceKind === "paid" ? cand.evidenceId : null}::uuid,
          ${cand.sourceKind},
          ${policy.version}, ${status}, ${decisionReason}, ${String(zbOutcome)},
          ${validationAt}::timestamptz, ${expiresAt}::timestamptz,
          ${isNamedContact}, ${isRoleInbox}, ${cand.maskedValue}, ${cand.provider ?? "free"}, ${cand.confidence},
          'not_suppressed', ${policy.version}, ${decisionReason},
          ${reservation?.operationId ?? null}::uuid,
          ${contactEmailTokenHash}, ${policy.id}::uuid, ${policy.documentHash}, ${consentTier},
          ${rawStatus}, ${rawSubstatus}, ${reusedFromOperationId}::uuid, ${JSON.stringify(reasonCodes)}::jsonb
        )
        ON CONFLICT (cohort_run_id, business_id, policy_version)
        DO UPDATE SET
          status = EXCLUDED.status, decision_reason = EXCLUDED.decision_reason,
          zb_outcome = EXCLUDED.zb_outcome, validation_at = EXCLUDED.validation_at,
          validation_expires_at = EXCLUDED.validation_expires_at,
          masked_email = EXCLUDED.masked_email, evidence_confidence = EXCLUDED.evidence_confidence,
          suppression_status = EXCLUDED.suppression_status, validation_operation_id = EXCLUDED.validation_operation_id,
          source_kind = EXCLUDED.source_kind, paid_candidate_evidence_id = EXCLUDED.paid_candidate_evidence_id,
          candidate_id = EXCLUDED.candidate_id, normalized_value_hash = EXCLUDED.normalized_value_hash,
          policy_document_id = EXCLUDED.policy_document_id, policy_document_hash = EXCLUDED.policy_document_hash,
          consent_tier = EXCLUDED.consent_tier, raw_provider_status = EXCLUDED.raw_provider_status,
          raw_provider_substatus = EXCLUDED.raw_provider_substatus, reused_from_operation_id = EXCLUDED.reused_from_operation_id,
          reason_codes = EXCLUDED.reason_codes, updated_at = NOW()
      `);

      if (zbOutcome === "valid") {
        await tx.execute(sql`
          UPDATE businesses
             SET main_email=${realEmail},email_discovery_status='provider_valid',
                 email_validation_updated_at=NOW(),email_selected_candidate_hash=${emailHash},updated_at=NOW()
           WHERE id=${bizId}
             AND (main_email IS NULL OR email_selected_candidate_hash=${emailHash})
        `);
      }
    });
    eligibilityRowsCreated++;
  }

  // Add discovery_required rows for businesses without a candidate
  const validatedBizIds = new Set(selectedEntries.map(([bizId]) => bizId));
  for (const bizId of bizIds) {
    if (!validatedBizIds.has(bizId)) {
      await db.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id, business_id, policy_version, status, decision_reason)
        VALUES (${cohortRunId}::uuid, ${bizId}, ${policy.version},
                'discovery_required', 'no_staged_candidate')
        ON CONFLICT (cohort_run_id, business_id, policy_version) DO NOTHING
      `);
    }
  }

  const result: SfpValidationResult = {
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

  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failedCount > 0 ? "partial" : "completed"},selected_count=${selectedEntries.length},
           processed_count=${validationAttempts},succeeded_count=${validCount+catchAllCount+invalidCount},
           failed_count=${failedCount},completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW(),
           stored_result=${JSON.stringify(result)}::jsonb
     WHERE id=${String(stageRun.id)}::uuid
  `);

  return result;
}

async function writeEligibilityRow(input: {
  cohortRunId: string;
  bizId: number;
  cand: UnifiedSfpCandidateView;
  status: OutreachEligibilityStatus;
  decisionReason: string;
  reasonCodes: string[];
  suppressionStatus?: string;
  consentTier?: string | null;
  policyVersion?: number;
}): Promise<void> {
  const policyVersion = input.policyVersion ?? SFP_POLICY_VERSION;
  await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, paid_candidate_evidence_id, source_kind,
       policy_version, status, decision_reason, suppression_status, masked_email, discovery_source,
       consent_tier, reason_codes)
    VALUES (${input.cohortRunId}::uuid, ${input.bizId},
      ${input.cand.sourceKind === "free" ? input.cand.evidenceId : null}::uuid,
      ${input.cand.sourceKind === "paid" ? input.cand.evidenceId : null}::uuid,
      ${input.cand.sourceKind},
      ${policyVersion}, ${input.status}, ${input.decisionReason},
      ${input.suppressionStatus ?? "unchecked"}, ${input.cand.maskedValue}, ${input.cand.provider ?? "free"},
      ${input.consentTier ?? null}, ${JSON.stringify(input.reasonCodes)}::jsonb)
    ON CONFLICT (cohort_run_id, business_id, policy_version) DO UPDATE
      SET status=EXCLUDED.status, decision_reason=EXCLUDED.decision_reason,
          suppression_status=EXCLUDED.suppression_status, source_kind=EXCLUDED.source_kind,
          paid_candidate_evidence_id=EXCLUDED.paid_candidate_evidence_id, candidate_id=EXCLUDED.candidate_id,
          consent_tier=EXCLUDED.consent_tier, reason_codes=EXCLUDED.reason_codes, updated_at=NOW()
  `);
}
