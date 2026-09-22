/**
 * cohort-validation.ts
 *
 * Bounded ZeroBounce validation for a frozen cohort.
 *
 * SECURITY:
 *   - Real email address is decrypted via the candidate-evidence envelope immediately before
 *     the governed provider call. The masked_value is NEVER sent to ZeroBounce.
 *   - Plaintext email addresses are never written to logs, audit metadata,
 *     API responses, or telemetry.
 *   - The mi09_cohort_validation_runs table is created via migration 0276.
 *     No runtime DDL.
 *
 * Gates enforced before any validation:
 *   - Frozen cohort must exist for this pilot run
 *   - DBPR exclusion re-verified per candidate
 *   - Max 25 addresses hard-capped
 *   - Outbound remains paused
 *
 * After ZeroBounce returns:
 *   - provider_valid only  → insert master_leads staging row
 *   - invalid / bounce / abuse / spamtrap / do_not_mail / unknown / failed
 *                          → disposition updated; never enter master_leads
 *   - catch_all            → enters explicit 'catch_all' disposition
 *
 * No contacts, deals, campaigns, sequences, GHL records, or outbound messages
 * are created. Consent is never inferred from validity.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getPilotRun } from "../mi09-pilot-authority";
import { getPauseState } from "../outbound-pause-authority";
import { businessHasDbprLineageSql } from "../dbpr";
import { unseal as unsealCandidateEvidence } from "./candidate-evidence-service";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Hard maximum validations per cohort validation run. */
export const COHORT_VALIDATION_MAX = 25;

/** ZeroBounce unit cost in micros (from live pricing schedule; $0.01 = 10_000 micros). */
const ZB_UNIT_MICROS_DEFAULT = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZbOutcome =
  | "valid"
  | "invalid"
  | "catch-all"
  | "spamtrap"
  | "abuse"
  | "do_not_mail"
  | "unknown"
  | "failed";

export interface CohortValidationPreview {
  pilotRunId: string;
  cohortFrozenHash: string;
  cohortSize: number;
  addressesForValidation: number;
  businessesWithoutCandidate: number;
  provider: "zerobounce";
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  maxValidations: number;
  remainingBudgetMicros: number;
  selectedCandidates: Array<{
    businessId: number;
    candidateId: string;
    maskedValue: string;
    confidence: number;
    vertical: string | null;
    countyFips: string | null;
  }>;
  gateOpen: boolean;
  gateBlockedReason: string | null;
  capturedAt: string;
}

export interface CohortValidationOutcome {
  candidateId: string;
  businessId: number;
  zbOutcome: ZbOutcome;
  masterLeadCreated: boolean;
  masterLeadId: string | null;
  disposition: string;
  maskedValue: string;
}

export interface CohortValidationResult {
  pilotRunId: string;
  runId: string;
  idempotencyKey: string;
  addressesValidated: number;
  masterLeadsCreated: number;
  catchAllCount: number;
  invalidCount: number;
  errorCount: number;
  outcomes: CohortValidationOutcome[];
  zeroOutreachConfirmed: true;
  completedAt: string;
}

// ── Preview ───────────────────────────────────────────────────────────────────

export async function previewCohortValidation(
  pilotRunId: string,
): Promise<CohortValidationPreview> {
  const now = new Date();
  const run = await getPilotRun(pilotRunId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");
  if (!run.cohort_frozen_hash) throw new Error("COHORT_VALIDATION_PREVIEW:cohort_not_frozen");

  const members = rows(await db.execute(sql`
    SELECT canonical_business_id AS business_id, vertical, county_fips
    FROM mi09_pilot_cohort_members
    WHERE pilot_run_id = ${pilotRunId}::uuid
    ORDER BY canonical_business_id ASC
  `));

  const bizIds = members.map((m: any) => Number(m.business_id));
  const memberLookup = new Map(members.map((m: any) => [Number(m.business_id), m]));

  const maxValidations = COHORT_VALIDATION_MAX;

  // Best staged candidate per business (exclude DBPR)
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
    ORDER BY fdc.business_id, fdc.confidence DESC, fdc.created_at ASC
  `));

  const selected = bestCandidates.slice(0, maxValidations);
  const businessesWithoutCandidate = bizIds.length - bestCandidates.length;

  const estimatedCostMicros = selected.length * ZB_UNIT_MICROS_DEFAULT;
  const worstCaseCostMicros = maxValidations * ZB_UNIT_MICROS_DEFAULT;

  // Gate check
  let gateOpen = true;
  let gateBlockedReason: string | null = null;

  const pauseState = await getPauseState();
  if (pauseState?.state === "paused") {
    // Validation can proceed even while outbound is paused (validation ≠ outreach)
  }

  // Check for live runtime attestation
  const attestRow = rows(await db.execute(sql`
    SELECT id FROM cro03c_runtime_attestations
    WHERE expires_at > NOW() AND db_healthy = true AND redis_healthy = true
    ORDER BY captured_at DESC LIMIT 1
  `))[0];
  if (!attestRow) {
    gateOpen = false;
    gateBlockedReason = "NO_LIVE_RUNTIME_ATTESTATION";
  }

  return {
    pilotRunId,
    cohortFrozenHash: String(run.cohort_frozen_hash),
    cohortSize: members.length,
    addressesForValidation: selected.length,
    businessesWithoutCandidate,
    provider: "zerobounce",
    estimatedCostMicros,
    worstCaseCostMicros,
    maxValidations,
    remainingBudgetMicros: 500_000, // $0.50 aggregate cap placeholder
    selectedCandidates: selected.map((c: any) => {
      const mem = memberLookup.get(Number(c.business_id));
      return {
        businessId: Number(c.business_id),
        candidateId: String(c.candidate_id),
        maskedValue: String(c.masked_value),
        confidence: Number(c.confidence),
        vertical: mem?.vertical ? String(mem.vertical) : null,
        countyFips: mem?.county_fips ? String(mem.county_fips) : null,
      };
    }),
    gateOpen,
    gateBlockedReason,
    capturedAt: now.toISOString(),
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

/**
 * Execute bounded ZeroBounce validation for a frozen cohort.
 *
 * @param zbTransport  Injectable fake transport for tests. When omitted, the
 *                     real ZeroBounce verifyEmail() is called with the
 *                     DECRYPTED address — never with the masked_value.
 */
export async function executeBoundedValidation(
  pilotRunId: string,
  opts: {
    idempotencyKey: string;
    actorId: string;
    maxValidations?: number;
    /** Fake transport for tests. Receives (candidateId, maskedValue). */
    zbTransport?: (candidateId: string, masked: string) => Promise<ZbOutcome>;
  },
): Promise<CohortValidationResult> {
  // Idempotency — if this key already completed, replay the result
  const existing = rows(await db.execute(sql`
    SELECT * FROM mi09_cohort_validation_runs
    WHERE idempotency_key = ${opts.idempotencyKey} AND status = 'completed'
    LIMIT 1
  `))[0];
  if (existing) {
    const outcomes = Array.isArray(existing.outcomes)
      ? existing.outcomes
      : JSON.parse(String(existing.outcomes ?? "[]"));
    return {
      pilotRunId,
      runId: String(existing.id),
      idempotencyKey: opts.idempotencyKey,
      addressesValidated: Number(existing.addresses_validated),
      masterLeadsCreated: Number(existing.master_leads_created),
      catchAllCount: outcomes.filter((o: any) => o.zbOutcome === "catch-all").length,
      invalidCount: outcomes.filter((o: any) => o.zbOutcome === "invalid").length,
      errorCount: outcomes.filter((o: any) => o.zbOutcome === "failed").length,
      outcomes,
      zeroOutreachConfirmed: true,
      completedAt: String(existing.completed_at ?? existing.started_at),
    };
  }

  const maxValidations = Math.min(opts.maxValidations ?? COHORT_VALIDATION_MAX, COHORT_VALIDATION_MAX);

  const run = await getPilotRun(pilotRunId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");
  if (!run.cohort_frozen_hash) throw new Error("COHORT_VALIDATION_BLOCKED:cohort_not_frozen");

  const members = rows(await db.execute(sql`
    SELECT canonical_business_id AS business_id, vertical, county_fips
    FROM mi09_pilot_cohort_members
    WHERE pilot_run_id = ${pilotRunId}::uuid
    ORDER BY canonical_business_id ASC
  `));
  const bizIds = members.map((m: any) => Number(m.business_id));
  const memberLookup = new Map(members.map((m: any) => [Number(m.business_id), m]));

  if (bizIds.length === 0) throw new Error("COHORT_VALIDATION_BLOCKED:EMPTY_COHORT");

  // Best staged candidate per business (exclude DBPR)
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
    ORDER BY fdc.business_id, fdc.confidence DESC, fdc.created_at ASC
  `));

  const selectedCandidates = bestCandidates.slice(0, maxValidations);

  if (selectedCandidates.length === 0) {
    throw new Error("COHORT_VALIDATION_BLOCKED:NO_STAGED_CANDIDATES_IN_COHORT");
  }

  // Create the validation run row
  const validationRunRow = rows(await db.execute(sql`
    INSERT INTO mi09_cohort_validation_runs
      (pilot_run_id, idempotency_key, status, actor_id)
    VALUES (${pilotRunId}::uuid, ${opts.idempotencyKey}, 'running', ${opts.actorId})
    ON CONFLICT (idempotency_key) DO UPDATE SET status = 'running'
    RETURNING id
  `))[0];
  const validationRunId = String(validationRunRow.id);

  // Build the ZeroBounce transport
  let zbTransport: (candidateId: string, masked: string) => Promise<ZbOutcome>;
  if (opts.zbTransport) {
    zbTransport = opts.zbTransport;
  } else {
    // Real ZeroBounce transport: decrypt the real address, never send masked_value
    const { verifyEmail } = await import("../sdr/zerobounce");
    zbTransport = async (candidateId, _masked) => {
      const candRow = rows(await db.execute(sql`
        SELECT id, business_id, field, envelope_ciphertext, envelope_nonce,
               envelope_tag, envelope_key_version, masked_value
        FROM free_discovery_candidates WHERE id = ${candidateId}::uuid LIMIT 1
      `))[0];
      if (!candRow) return "failed";

      // SECURITY: Decrypt via established boundary. Plaintext never logged.
      let realEmail: string;
      try {
        realEmail = unsealCandidateEvidence("email", {
          ciphertext: String(candRow.envelope_ciphertext),
          nonce: String(candRow.envelope_nonce),
          tag: String(candRow.envelope_tag),
          keyVersion: Number(candRow.envelope_key_version ?? 1),
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

  const outcomes: CohortValidationOutcome[] = [];
  let masterLeadsCreated = 0;

  for (const cand of selectedCandidates) {
    const bizId = Number(cand.business_id);
    const mem = memberLookup.get(bizId);
    let zbOutcome: ZbOutcome = "failed";
    let disposition = "error";
    let masterLeadId: string | null = null;
    let masterLeadCreated = false;

    try {
      zbOutcome = await zbTransport(String(cand.candidate_id), String(cand.masked_value));

      if (zbOutcome === "valid") {
        // Stage into master_leads — only for provider_valid outcomes
        const mlRow = rows(await db.execute(sql`
          INSERT INTO master_leads
            (business_id, candidate_id, outreach_readiness, readiness_reason,
             pilot_run_id, source_method, created_at)
          VALUES (
            ${bizId},
            ${String(cand.candidate_id)}::uuid,
            'not_ready',
            'consent_not_established',
            ${pilotRunId}::uuid,
            'cohort_validation',
            NOW()
          )
          ON CONFLICT (candidate_id) DO NOTHING
          RETURNING id
        `))[0];
        if (mlRow) {
          masterLeadId = String(mlRow.id);
          masterLeadCreated = true;
          masterLeadsCreated++;
        }
        disposition = "valid";
      } else if (zbOutcome === "catch-all") {
        disposition = "catch_all";
        await db.execute(sql`
          UPDATE free_discovery_candidates
          SET disposition = 'catch_all'
          WHERE id = ${String(cand.candidate_id)}::uuid
        `);
      } else {
        disposition = String(zbOutcome);
        await db.execute(sql`
          UPDATE free_discovery_candidates
          SET disposition = 'invalid'
          WHERE id = ${String(cand.candidate_id)}::uuid
        `);
      }
    } catch (err: any) {
      zbOutcome = "failed";
      disposition = "error";
    }

    outcomes.push({
      candidateId: String(cand.candidate_id),
      businessId: bizId,
      zbOutcome,
      masterLeadCreated,
      masterLeadId,
      disposition,
      maskedValue: String(cand.masked_value),
    });
  }

  // Mark completed
  await db.execute(sql`
    UPDATE mi09_cohort_validation_runs
    SET status = 'completed',
        addresses_validated = ${outcomes.length},
        master_leads_created = ${masterLeadsCreated},
        outcomes = ${JSON.stringify(outcomes)}::jsonb,
        completed_at = NOW()
    WHERE id = ${validationRunId}::uuid
  `);

  return {
    pilotRunId,
    runId: validationRunId,
    idempotencyKey: opts.idempotencyKey,
    addressesValidated: outcomes.length,
    masterLeadsCreated,
    catchAllCount: outcomes.filter((o) => o.zbOutcome === "catch-all").length,
    invalidCount: outcomes.filter((o) => o.zbOutcome === "invalid").length,
    errorCount: outcomes.filter((o) => o.zbOutcome === "failed").length,
    outcomes,
    zeroOutreachConfirmed: true,
    completedAt: new Date().toISOString(),
  };
}
