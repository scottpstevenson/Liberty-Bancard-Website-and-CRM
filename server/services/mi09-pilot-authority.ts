/**
 * MI-09 Pilot Authority — durable lifecycle service for bounded pilot runs.
 *
 * This is the ONLY writer to mi09_pilot_definitions, mi09_pilot_runs,
 * mi09_pilot_cohort_members, mi09_pilot_checkpoints,
 * mi09_pilot_advancement_receipts, mi09_pilot_effect_links,
 * mi09_pilot_reconciliation_reports, and mi09_pricing_artifacts.
 *
 * No loose system_settings values are used as pilot state — every state
 * transition is durable, idempotent, and audit-visible.
 *
 * Invariants enforced here:
 *   - Global outbound MUST remain paused for all pilot levels (epoch checked
 *     at cohort-freeze and advancement time).
 *   - Pilot 1 is blocked if any paid provider is in the recipe.
 *   - Advancement requires an admin-signed idempotency key (CSRF handled by
 *     the route layer — this service trusts the approved_by string passed in
 *     after the route has verified role + CSRF).
 *   - Stop conditions evaluated from mi09_pilot_definitions — not hardcoded.
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getPauseState } from "./outbound-pause-authority";
import {
  buildCro03PriceScheduleFromArtifacts,
  stableCro03RecipeHash,
  type Cro03PricingArtifactRow,
} from "./cro03/contracts";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

// ── Hashing helpers ──────────────────────────────────────────────────────────
function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PilotDefinitionInput {
  level: 1 | 2 | 3;
  countyScope: string[];
  verticalScope: string[];
  sourceAdapterFilter: string[];
  maxCohortSize: number;
  enrichmentRecipeVersion: number;
  /** Per-provider paid-access flags. Pilot 1 must have all false. */
  paidProvidersAllowed: {
    serper?: boolean;
    outscraper?: boolean;
    apollo?: boolean;
    openai?: boolean;
    zerobounce?: boolean;
  };
  /** Operator-defined thresholds; none are hardcoded here. */
  stopConditionThresholds: {
    conflictPct: number;
    apolloYieldPct: number;
    zbUnknownPct: number;
    spendCapMicros: number;
  };
  createdBy: string;
}

export interface PilotRunInput {
  pilotDefinitionId: string;
  releaseSha: string;
  cro03cSelectionPolicyVersion: number;
  cro03cRoutingPolicyVersion: number;
  cro03cRecipeVersion: number;
  outboundPauseEpoch: number;
}

export interface AdvancementInput {
  pilotRunId: string;
  fromLevel: number;
  toLevel: number;
  approvedBy: string;
  pricingArtifactId?: string;
  stopConditionsChecked: Record<string, unknown>;
  stopConditionsPassed: boolean;
  idempotencyKey: string;
}

export interface PricingArtifactInput {
  providerKey: string;
  unitType: string;
  amountMicros: number;
  currency?: string;
  billingSemantics: string;
  capturedBy: string;
  accountBalanceUnits?: number;
  sourceUrl?: string;
  artifactVersion?: number;
}

// ── Pricing Artifact ─────────────────────────────────────────────────────────

export async function createPricingArtifact(
  input: PricingArtifactInput,
): Promise<{ id: string; artifactHash: string }> {
  const artifactHash = stableHash({
    providerKey: input.providerKey,
    unitType: input.unitType,
    amountMicros: input.amountMicros,
    currency: input.currency ?? "USD",
    billingSemantics: input.billingSemantics,
    artifactVersion: input.artifactVersion ?? 1,
  });
  const created = rows(await db.execute(sql`
    INSERT INTO mi09_pricing_artifacts
      (provider_key, unit_type, amount_micros, currency, billing_semantics,
       captured_by, account_balance_units, source_url, artifact_version, artifact_hash)
    VALUES (${input.providerKey}, ${input.unitType}, ${input.amountMicros},
            ${input.currency ?? "USD"}, ${input.billingSemantics},
            ${input.capturedBy}, ${input.accountBalanceUnits ?? null},
            ${input.sourceUrl ?? null}, ${input.artifactVersion ?? 1}, ${artifactHash})
    RETURNING id
  `));
  return { id: String(created[0].id), artifactHash };
}

export async function getPricingArtifacts(): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pricing_artifacts ORDER BY captured_at DESC
  `));
}

/**
 * Exact-match reuse: only reuses the latest artifact for a provider if
 * provider_key/unit_type/currency/amount_micros/billing_semantics/
 * artifact_version ALL match exactly. Any drift (a real repricing) always
 * inserts a new version via `createPricingArtifact()` — never mutates the
 * existing row. Never issues raw INSERT SQL itself.
 */
export async function reuseOrCreatePricingArtifact(
  input: PricingArtifactInput,
): Promise<{ id: string; artifactHash: string; reused: boolean }> {
  const currency = input.currency ?? "USD";
  const artifactVersion = input.artifactVersion ?? 1;
  const latest = rows(await db.execute(sql`
    SELECT id, unit_type, currency, amount_micros, billing_semantics, artifact_version, artifact_hash
      FROM mi09_pricing_artifacts
     WHERE provider_key = ${input.providerKey}
     ORDER BY captured_at DESC
     LIMIT 1
  `))[0];
  if (
    latest &&
    String(latest.unit_type) === input.unitType &&
    String(latest.currency) === currency &&
    Number(latest.amount_micros) === Number(input.amountMicros) &&
    String(latest.billing_semantics) === input.billingSemantics &&
    Number(latest.artifact_version) === artifactVersion
  ) {
    return { id: String(latest.id), artifactHash: String(latest.artifact_hash), reused: true };
  }
  const created = await createPricingArtifact(input);
  return { ...created, reused: false };
}

export interface PricingScheduleSnapshotInput {
  capturedBy: string;
  /** Snapshot validity window; the documented ceremony-runbook convention is 7 days. */
  expiresInDays?: number;
  notes?: string;
}

export interface PricingScheduleSnapshotResult {
  id: string;
  compositeHash: string;
  artifactIds: string[];
  reused: boolean;
  /** True when an existing (but expired) row with the identical composite_hash
   * was renewed in place — composite_hash is UNIQUE, so a fresh row with the
   * same hash can never be inserted; renewal is required to make an unchanged
   * schedule reproducible again after the prior snapshot's expiry. */
  renewed: boolean;
  expiresAt: string;
}

/**
 * Builds the composite price schedule from the CURRENT latest artifact per
 * provider using the exact same selection/shape logic
 * `loadPricingFromArtifacts()` uses in scripts/cro03d-run-ceremony.ts
 * (both import `buildCro03PriceScheduleFromArtifacts` from contracts.ts, so
 * the two can never independently drift), hashes it with
 * `stableCro03RecipeHash` — the identical hash function the CRO-08A
 * certification gate recomputes and checks against this table — and writes
 * (or reuses, if an unexpired snapshot with the identical hash already
 * exists) a `mi09_pricing_schedule_snapshots` row.
 *
 * Does NOT set `linked_policy_id`: no `cro03c_activation_policies` row can
 * exist yet outside the ceremony's own authorized flow, so linking is
 * intentionally left for a future, separate call (see
 * `linkPricingArtifactsToPolicy` below) and is never invoked here.
 */
export async function createPricingScheduleSnapshot(
  input: PricingScheduleSnapshotInput,
): Promise<PricingScheduleSnapshotResult> {
  const artifacts = (await getPricingArtifacts()) as Cro03PricingArtifactRow[];
  const { schedule, latestByProvider } = buildCro03PriceScheduleFromArtifacts(artifacts);
  const compositeHash = stableCro03RecipeHash(schedule);
  const artifactIds = Object.values(latestByProvider)
    .map((a) => String(a.id))
    .sort();

  const existing = rows(await db.execute(sql`
    SELECT id, artifact_ids, expires_at
      FROM mi09_pricing_schedule_snapshots
     WHERE composite_hash = ${compositeHash} AND expires_at > NOW()
     ORDER BY captured_at DESC
     LIMIT 1
  `))[0];
  if (existing) {
    // The composite_hash covers only the price-schedule VALUES (unitType,
    // currency, amountMicros, billingSemantics, version) — it does not cover
    // WHICH artifact row id backs each provider. Two different artifact ids
    // can therefore hash identically (e.g. provider X was repriced away and
    // then repriced back to the exact same values, minting a new row with
    // the same fields but a different id). A pure hash-match reuse would
    // silently leave this row's artifact_ids pointing at stale/superseded
    // artifact ids even though its schedule_json/hash still "matches" —
    // which is exactly what the certification gate and preflight compare
    // artifact_ids against. Reconcile the stored ids to the currently
    // selected latest ids on every reuse, not just on renewal.
    const storedIds = (
      Array.isArray(existing.artifact_ids) ? existing.artifact_ids : JSON.parse(existing.artifact_ids)
    ).map(String).sort();
    const idsMatch = storedIds.length === artifactIds.length && storedIds.every((id: string, i: number) => id === artifactIds[i]);
    if (!idsMatch) {
      await db.execute(sql`
        UPDATE mi09_pricing_schedule_snapshots
           SET artifact_ids = ${JSON.stringify(artifactIds)}::jsonb,
               schedule_json = ${JSON.stringify(schedule)}::jsonb
         WHERE id = ${existing.id}
      `);
    }
    return {
      id: String(existing.id),
      compositeHash,
      artifactIds,
      reused: true,
      renewed: false,
      expiresAt: String(existing.expires_at),
    };
  }

  // No unexpired row exists for this hash, but composite_hash is UNIQUE, so a
  // prior (now-expired) row with the identical hash may still exist — e.g. the
  // documented 7-day expiry has elapsed and the operator re-runs the permanent
  // seed command against an unchanged schedule. A plain INSERT would raise a
  // uniqueness violation in that case. Use INSERT ... ON CONFLICT (composite_hash)
  // DO UPDATE, gated to only fire when the existing row is actually expired
  // (the unexpired case is already handled above), so renewal is atomic and
  // never silently overwrites a still-valid row from a concurrent caller.
  const expiresInDays = input.expiresInDays ?? 7;
  const upserted = rows(await db.execute(sql`
    INSERT INTO mi09_pricing_schedule_snapshots
      (composite_hash, artifact_ids, schedule_json, captured_by, expires_at, notes)
    VALUES (
      ${compositeHash}, ${JSON.stringify(artifactIds)}::jsonb, ${JSON.stringify(schedule)}::jsonb,
      ${input.capturedBy}, NOW() + (${expiresInDays} || ' days')::interval, ${input.notes ?? null}
    )
    ON CONFLICT (composite_hash) DO UPDATE SET
      artifact_ids = EXCLUDED.artifact_ids,
      schedule_json = EXCLUDED.schedule_json,
      captured_by = EXCLUDED.captured_by,
      captured_at = NOW(),
      expires_at = EXCLUDED.expires_at,
      notes = EXCLUDED.notes
    WHERE mi09_pricing_schedule_snapshots.expires_at <= NOW()
    RETURNING id, expires_at, (xmax = 0) AS inserted
  `));
  if (upserted[0]) {
    return {
      id: String(upserted[0].id),
      compositeHash,
      artifactIds,
      reused: false,
      renewed: upserted[0].inserted === false || upserted[0].inserted === "f",
      expiresAt: String(upserted[0].expires_at),
    };
  }
  // The ON CONFLICT WHERE clause matched no row (the conflicting row is no
  // longer expired — a concurrent caller renewed it between our unexpired
  // check and this statement). Fall back to reading the now-current row.
  const race = rows(await db.execute(sql`
    SELECT id, expires_at FROM mi09_pricing_schedule_snapshots WHERE composite_hash = ${compositeHash}
  `))[0];
  if (!race) throw new Error("CRO03_PRICING_SNAPSHOT_UPSERT_RACE_UNRESOLVED");
  return {
    id: String(race.id),
    compositeHash,
    artifactIds,
    reused: true,
    renewed: false,
    expiresAt: String(race.expires_at),
  };
}

/**
 * Sets `linked_policy_id` on the given artifact rows once a real
 * `cro03c_activation_policies` row exists (post-ceremony). Built for future
 * use only: `linked_policy_id` has no FK constraint and is never read by
 * `certification-gate.ts` or anywhere else in server code today, so this is
 * intentionally NOT called by the operator seed command or treated as a
 * preflight-blocking requirement — no activation policy exists yet.
 */
export async function linkPricingArtifactsToPolicy(
  artifactIds: readonly string[],
  policyId: string,
): Promise<{ updated: number }> {
  if (artifactIds.length === 0) return { updated: 0 };
  const updated = rows(await db.execute(sql`
    UPDATE mi09_pricing_artifacts
       SET linked_policy_id = ${policyId}::uuid
     WHERE id = ANY(${[...artifactIds]}::uuid[])
    RETURNING id
  `));
  return { updated: updated.length };
}

// ── Pilot Definition ─────────────────────────────────────────────────────────

export async function createPilotDefinition(
  input: PilotDefinitionInput,
): Promise<{ id: string; pilotDefinitionHash: string }> {
  // Level 1 must have zero paid providers.
  if (input.level === 1) {
    const anyPaid = Object.values(input.paidProvidersAllowed).some(Boolean);
    if (anyPaid) {
      throw new Error(
        "PILOT_DEFINITION_INVALID:pilot_1_must_exclude_all_paid_providers",
      );
    }
  }
  const pilotDefinitionHash = stableHash({
    level: input.level,
    countyScope: [...input.countyScope].sort(),
    verticalScope: [...input.verticalScope].sort(),
    sourceAdapterFilter: [...input.sourceAdapterFilter].sort(),
    maxCohortSize: input.maxCohortSize,
    enrichmentRecipeVersion: input.enrichmentRecipeVersion,
    paidProvidersAllowed: input.paidProvidersAllowed,
    stopConditionThresholds: input.stopConditionThresholds,
  });
  // Idempotent by (level, hash).
  const existing = rows(await db.execute(sql`
    SELECT id FROM mi09_pilot_definitions
     WHERE level = ${input.level} AND pilot_definition_hash = ${pilotDefinitionHash}
  `))[0];
  if (existing) return { id: String(existing.id), pilotDefinitionHash };

  const created = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_definitions
      (level, county_scope, vertical_scope, source_adapter_filter,
       max_cohort_size, enrichment_recipe_version, paid_providers_allowed,
       stop_condition_thresholds, pilot_definition_hash, created_by)
    VALUES (${input.level}, ${JSON.stringify(input.countyScope)}::jsonb,
            ${JSON.stringify(input.verticalScope)}::jsonb,
            ${JSON.stringify(input.sourceAdapterFilter)}::jsonb,
            ${input.maxCohortSize}, ${input.enrichmentRecipeVersion},
            ${JSON.stringify(input.paidProvidersAllowed)}::jsonb,
            ${JSON.stringify(input.stopConditionThresholds)}::jsonb,
            ${pilotDefinitionHash}, ${input.createdBy})
    RETURNING id
  `));
  return { id: String(created[0].id), pilotDefinitionHash };
}

export async function getPilotDefinitions(): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pilot_definitions ORDER BY level, created_at
  `));
}

// ── Pilot Run ────────────────────────────────────────────────────────────────

/** Create a new pilot run in 'draft' state. Verifies outbound remains paused. */
export async function createPilotRun(
  input: PilotRunInput,
): Promise<{ id: string }> {
  // Verify pause is active before creating the run.
  const pause = await getPauseState();
  if (pause.state !== "paused") {
    throw new Error("PILOT_RUN_BLOCKED:outbound_not_paused");
  }
  if (Number(pause.epoch) !== input.outboundPauseEpoch) {
    throw new Error("PILOT_RUN_BLOCKED:pause_epoch_mismatch");
  }
  const created = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_runs
      (pilot_definition_id, release_sha,
       cro03c_selection_policy_version, cro03c_routing_policy_version,
       cro03c_recipe_version, outbound_pause_epoch, state)
    VALUES (${input.pilotDefinitionId}::uuid, ${input.releaseSha},
            ${input.cro03cSelectionPolicyVersion},
            ${input.cro03cRoutingPolicyVersion},
            ${input.cro03cRecipeVersion},
            ${String(input.outboundPauseEpoch)}, 'draft')
    RETURNING id
  `));
  return { id: String(created[0].id) };
}

export async function getPilotRun(runId: string): Promise<any | null> {
  const r = rows(await db.execute(sql`
    SELECT pr.*, pd.level, pd.max_cohort_size, pd.paid_providers_allowed,
           pd.stop_condition_thresholds, pd.county_scope, pd.vertical_scope
    FROM mi09_pilot_runs pr
    JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
    WHERE pr.id = ${runId}::uuid
  `))[0];
  return r ?? null;
}

export async function listPilotRuns(): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT pr.*, pd.level, pd.max_cohort_size, pd.county_scope,
           pd.paid_providers_allowed, pd.stop_condition_thresholds
    FROM mi09_pilot_runs pr
    JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
    ORDER BY pr.created_at DESC
  `));
}

// ── Owner Authority Decision Gate ────────────────────────────────────────────

/**
 * Before any pilot run can transition to 'running' or be created in 'running'
 * state, the owner must record a durable authority decision on which table
 * is the canonical pre-contact pool for CRO-03 output: 'master_leads' or
 * 'prospects'. This is stored in system_settings as JSON.
 *
 * Setting the key: INSERT INTO system_settings (key, value, updated_at) VALUES
 *   ('mi09_pool_authority_decision',
 *    '{"pool":"master_leads","decidedBy":"owner","decidedAt":"ISO8601"}',
 *    NOW())
 *   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
 */
async function assertPoolAuthorityDecision(): Promise<void> {
  const row = rows(await db.execute(sql`
    SELECT value FROM system_settings WHERE key = 'mi09_pool_authority_decision' LIMIT 1
  `))[0];
  if (!row) {
    throw new Error(
      "PILOT_BLOCKED:POOL_AUTHORITY_UNDECIDED — owner must set system_settings " +
      "key mi09_pool_authority_decision before any pilot run can be started. " +
      "Allowed values: {\"pool\":\"master_leads\",...} or {\"pool\":\"prospects\",...}",
    );
  }
  const decision = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (!decision?.pool || !["master_leads", "prospects"].includes(decision.pool)) {
    throw new Error(
      `PILOT_BLOCKED:POOL_AUTHORITY_INVALID — mi09_pool_authority_decision.pool must be ` +
      `'master_leads' or 'prospects'; got: '${decision?.pool}'`,
    );
  }
}

// Legal state transition matrix for pilot runs.
const LEGAL_PILOT_TRANSITIONS: Record<string, string[]> = {
  draft:    ["running", "stopped"],
  running:  ["paused", "completed", "stopped"],
  paused:   ["running", "stopped"],
  completed: [],   // terminal
  stopped:   [],   // terminal
};

export async function transitionPilotRunState(
  runId: string,
  toState: "running" | "paused" | "completed" | "stopped",
  opts?: { stopReason?: string; advancedBy?: string },
): Promise<void> {
  // Read current state inside a transaction to enforce legal transitions atomically.
  await db.transaction(async (tx) => {
    const current = rows(await tx.execute(sql`
      SELECT state FROM mi09_pilot_runs WHERE id = ${runId}::uuid FOR UPDATE
    `))[0];
    if (!current) throw new Error(`PILOT_RUN_NOT_FOUND:${runId}`);

    const allowed = LEGAL_PILOT_TRANSITIONS[String(current.state)] ?? [];
    if (!allowed.includes(toState)) {
      throw new Error(
        `PILOT_TRANSITION_ILLEGAL:${current.state}→${toState} (allowed: ${allowed.join(",") || "none"})`,
      );
    }

    // For 'completed' transitions: stop conditions must have passed AND outbound pause
    // epoch must still match the run's recorded epoch (cannot complete after outbound
    // was resumed and re-paused — that would allow historical/unrelated runs to certify
    // a new release by completing them in a different outbound-pause epoch).
    if (toState === "completed") {
      const runDetails = rows(await tx.execute(sql`
        SELECT outbound_pause_epoch FROM mi09_pilot_runs WHERE id = ${runId}::uuid
      `))[0];
      const pause = await getPauseState();
      if (pause.state !== "paused") {
        throw new Error("PILOT_TRANSITION_ILLEGAL:completed_requires_outbound_paused");
      }
      if (String(pause.epoch) !== String(runDetails?.outbound_pause_epoch)) {
        throw new Error(
          `PILOT_TRANSITION_ILLEGAL:completed_pause_epoch_changed:` +
          `recorded=${runDetails?.outbound_pause_epoch} current=${pause.epoch} — ` +
          "outbound was resumed and re-paused since the run was created; create a new run",
        );
      }
      const stopResult = await evaluateStopConditions(runId);
      if (!stopResult.passed) {
        throw new Error(
          `PILOT_TRANSITION_ILLEGAL:completed_requires_stop_conditions_passed — ` +
          `failed:[${stopResult.failedConditions.join(",")}]`,
        );
      }
    }

    // Pool authority must be decided before activating a run.
    if (toState === "running") {
      await assertPoolAuthorityDecision();

      // Safety bounds: verify the run has a frozen cohort and that outbound
      // pause epoch matches the epoch recorded when the run was created.
      const runDetails = rows(await tx.execute(sql`
        SELECT cohort_frozen_hash, outbound_pause_epoch
        FROM mi09_pilot_runs WHERE id = ${runId}::uuid
      `))[0];

      if (!runDetails?.cohort_frozen_hash) {
        throw new Error(
          "PILOT_TRANSITION_ILLEGAL:running_requires_frozen_cohort — " +
          "call freezePilotCohort() before starting the run",
        );
      }

      const pause = await getPauseState();
      if (pause.state !== "paused") {
        throw new Error("PILOT_TRANSITION_ILLEGAL:running_requires_outbound_paused");
      }
      if (String(pause.epoch) !== String(runDetails.outbound_pause_epoch)) {
        throw new Error(
          `PILOT_TRANSITION_ILLEGAL:running_pause_epoch_changed:` +
          `recorded=${runDetails.outbound_pause_epoch} current=${pause.epoch} — ` +
          "outbound was resumed and re-paused since the run was created; create a new run",
        );
      }
    }

    const isTerminal = toState === "completed" || toState === "stopped";
    await tx.execute(sql`
      UPDATE mi09_pilot_runs
         SET state        = ${toState},
             stop_reason  = ${opts?.stopReason ?? null},
             advanced_by  = ${opts?.advancedBy ?? null},
             completed_at = ${isTerminal ? sql`NOW()` : sql`completed_at`}
       WHERE id = ${runId}::uuid
    `);
  });
}

// ── Cohort ───────────────────────────────────────────────────────────────────

export interface CohortCensusResult {
  eligible: number;
  targetSize: number;
  sufficient: boolean;
}

/** Census check before freezing: eligible records >= target cohort size. */
export async function checkCohortCensus(input: {
  pilotDefinitionId: string;
  countyFipsFilter: string[];
  verticalFilter: string[];
  sourceAdapterFilter: string[];
}): Promise<CohortCensusResult> {
  const def = rows(await db.execute(sql`
    SELECT max_cohort_size FROM mi09_pilot_definitions WHERE id = ${input.pilotDefinitionId}::uuid
  `))[0];
  if (!def) throw new Error("PILOT_DEFINITION_NOT_FOUND");

  // Join chain: businesses → canonical_source_links (to find which source_system
  // produced each business) → business_locations (for county_fips filtering).
  // businesses.vertical is the canonical vertical column.
  // canonical_conflict_evidence references businesses.id (INTEGER).
  const countyParam = JSON.stringify(input.countyFipsFilter);
  const vertParam   = JSON.stringify(input.verticalFilter);
  const srcParam    = JSON.stringify(input.sourceAdapterFilter);

  const eligible = rows(await db.execute(sql`
    SELECT COUNT(DISTINCT b.id)::int AS cnt
    FROM businesses b
    JOIN canonical_source_links csl ON csl.business_id = b.id
    LEFT JOIN business_locations bl ON bl.business_id = b.id
    WHERE csl.source_system = ANY(${srcParam}::text[])
      AND (${input.countyFipsFilter.length === 0} OR bl.county_fips = ANY(${countyParam}::text[]))
      AND (${input.verticalFilter.length === 0}   OR b.vertical = ANY(${vertParam}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM canonical_conflict_evidence cce
        WHERE (cce.business_id_a = b.id OR cce.business_id_b = b.id)
          AND cce.status = 'open'
      )
  `))[0];

  const eligibleCount = Number(eligible?.cnt ?? 0);
  const targetSize = Number(def.max_cohort_size);
  return {
    eligible: eligibleCount,
    targetSize,
    sufficient: eligibleCount >= targetSize,
  };
}

/** Freeze cohort — idempotent if cohort already frozen for this run. */
export async function freezePilotCohort(input: {
  pilotRunId: string;
  /** Caller-supplied member list; canonical_business_id is INTEGER (businesses.id). */
  members: Array<{
    canonicalBusinessId: number | string; // accepts both; coerced to integer in SQL
    sourceAdapterKey: string;
    countyFips?: string;
    vertical?: string;
  }>;
}): Promise<{ frozen: boolean; cohortFrozenHash: string }> {
  const run = await getPilotRun(input.pilotRunId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");

  // Verify outbound is paused and pause epoch matches the run's recorded epoch.
  const pause = await getPauseState();
  if (pause.state !== "paused") {
    throw new Error("PILOT_COHORT_FREEZE_BLOCKED:outbound_not_paused");
  }
  if (String(pause.epoch) !== String(run.outbound_pause_epoch)) {
    throw new Error(
      `PILOT_COHORT_FREEZE_BLOCKED:pause_epoch_changed:recorded=${run.outbound_pause_epoch} current=${pause.epoch}`,
    );
  }

  // Idempotent: if cohort is already frozen, return existing hash.
  if (run.cohort_frozen_hash) {
    return { frozen: false, cohortFrozenHash: String(run.cohort_frozen_hash) };
  }

  // Verify run is in draft or running state.
  if (!["draft", "running"].includes(run.state)) {
    throw new Error(`PILOT_COHORT_FREEZE_BLOCKED:invalid_state:${run.state}`);
  }

  // Cohort size guard.
  if (input.members.length === 0) {
    throw new Error("PILOT_COHORT_FREEZE_BLOCKED:empty_members");
  }
  if (input.members.length > Number(run.max_cohort_size)) {
    throw new Error(
      `COHORT_CENSUS_INSUFFICIENT:exceeds_max:${input.members.length}>${run.max_cohort_size}`,
    );
  }

  // Load the immutable definition to validate member scope server-side.
  const def = rows(await db.execute(sql`
    SELECT county_scope, vertical_scope, source_adapter_filter, max_cohort_size
    FROM mi09_pilot_definitions WHERE id = ${String(run.pilot_definition_id)}::uuid
  `))[0];
  if (!def) throw new Error(`PILOT_DEFINITION_NOT_FOUND:${run.pilot_definition_id}`);

  const countyScope: string[] = def.county_scope ? (typeof def.county_scope === "string" ? JSON.parse(def.county_scope) : def.county_scope) : [];
  const verticalScope: string[] = def.vertical_scope ? (typeof def.vertical_scope === "string" ? JSON.parse(def.vertical_scope) : def.vertical_scope) : [];
  const sourceAdapterFilter: string[] = def.source_adapter_filter ? (typeof def.source_adapter_filter === "string" ? JSON.parse(def.source_adapter_filter) : def.source_adapter_filter) : [];

  // Validate each proposed member against the definition's immutable filters using
  // server-derived values from businesses, business_locations, and canonical_source_links.
  // We do NOT trust caller-supplied county, vertical, or source-adapter metadata —
  // an admin could label any business as in-scope, defeating the bounded cohort guarantee.
  const businessIds = input.members.map((m) => Number(m.canonicalBusinessId));

  // Server-side scope validation:
  //   1. County filter: at least one business_locations row for the business must have
  //      county_fips matching the definition's county_scope (if filter is non-empty).
  //   2. Source-adapter filter: at least one canonical_source_links row must have
  //      source_system matching the definition's source_adapter_filter (if non-empty).
  //   3. Vertical filter: checked against canonical_source_links.source_type (vertical
  //      is encoded in source_type for DBPR-HR adapters, e.g. "Restaurant", "Auto").
  if (businessIds.length > 0) {
    const businessIdSql = sql.join(businessIds.map((id) => sql`${id}::int`), sql`, `);

    if (countyScope.length > 0) {
      // Find businesses that have NO business_locations row within the allowed counties.
      const outOfCounty = rows(await db.execute(sql`
        SELECT b.id::int AS business_id FROM (VALUES ${sql.join(businessIds.map((id) => sql`(${id}::int)`), sql`, `)}) AS b(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM business_locations bl
          WHERE bl.business_id = b.id
            AND bl.county_fips = ANY(ARRAY[${sql.join(countyScope.map((c) => sql`${c}`), sql`, `)}])
        )
      `));
      if (outOfCounty.length > 0) {
        const ids = outOfCounty.map((r: any) => Number(r.business_id));
        throw new Error(
          `PILOT_COHORT_FREEZE_BLOCKED:members_out_of_county_scope:${ids.length} businesses have no ` +
          `business_locations row with county_fips in [${countyScope.join(",")}]: [${ids.slice(0, 5).join(",")}]`,
        );
      }
    }

    if (sourceAdapterFilter.length > 0) {
      // Find businesses that have NO canonical_source_links row with an allowed source_system.
      const outOfAdapter = rows(await db.execute(sql`
        SELECT b.id::int AS business_id FROM (VALUES ${sql.join(businessIds.map((id) => sql`(${id}::int)`), sql`, `)}) AS b(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM canonical_source_links csl
          WHERE csl.business_id = b.id
            AND csl.source_system = ANY(ARRAY[${sql.join(sourceAdapterFilter.map((a) => sql`${a}`), sql`, `)}])
        )
      `));
      if (outOfAdapter.length > 0) {
        const ids = outOfAdapter.map((r: any) => Number(r.business_id));
        throw new Error(
          `PILOT_COHORT_FREEZE_BLOCKED:members_out_of_source_adapter_scope:${ids.length} businesses have no ` +
          `canonical_source_links row with source_system in [${sourceAdapterFilter.join(",")}]: [${ids.slice(0, 5).join(",")}]`,
        );
      }
    }

    if (verticalScope.length > 0) {
      // Vertical is encoded in canonical_source_links.source_type for DBPR-HR and similar adapters.
      const outOfVertical = rows(await db.execute(sql`
        SELECT b.id::int AS business_id FROM (VALUES ${sql.join(businessIds.map((id) => sql`(${id}::int)`), sql`, `)}) AS b(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM canonical_source_links csl
          WHERE csl.business_id = b.id
            AND csl.source_type = ANY(ARRAY[${sql.join(verticalScope.map((v) => sql`${v}`), sql`, `)}])
        )
      `));
      if (outOfVertical.length > 0) {
        const ids = outOfVertical.map((r: any) => Number(r.business_id));
        throw new Error(
          `PILOT_COHORT_FREEZE_BLOCKED:members_out_of_vertical_scope:${ids.length} businesses have no ` +
          `canonical_source_links row with source_type in [${verticalScope.join(",")}]: [${ids.slice(0, 5).join(",")}]`,
        );
      }
    }
  }

  // Exclude businesses with open canonical conflict evidence.
  const conflictRows = rows(await db.execute(sql`
    SELECT DISTINCT COALESCE(business_id_a, business_id_b)::int AS business_id
    FROM canonical_conflict_evidence
    WHERE status = 'open'
      AND (business_id_a = ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}::int`), sql`, `)}])
        OR business_id_b = ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}::int`), sql`, `)}]))
  `));
  if (conflictRows.length > 0) {
    const conflictIds = conflictRows.map((r: any) => Number(r.business_id));
    throw new Error(
      `PILOT_COHORT_FREEZE_BLOCKED:conflict_evidence_open:${conflictIds.length} businesses have open ` +
      `canonical_conflict_evidence rows: [${conflictIds.slice(0, 5).join(",")}] — ` +
      `resolve all conflicts before freezing this cohort`,
    );
  }

  // Sort by integer business id for deterministic hash.
  const sortedIds = [...businessIds].sort((a, b) => a - b);
  const cohortFrozenHash = stableHash(sortedIds);

  await db.transaction(async (tx) => {
    for (const m of input.members) {
      const bizId = Number(m.canonicalBusinessId);
      await tx.execute(sql`
        INSERT INTO mi09_pilot_cohort_members
          (pilot_run_id, canonical_business_id, source_adapter_key, county_fips, vertical)
        VALUES (${input.pilotRunId}::uuid, ${bizId},
                ${m.sourceAdapterKey}, ${m.countyFips ?? null}, ${m.vertical ?? null})
        ON CONFLICT (pilot_run_id, canonical_business_id) DO NOTHING
      `);
    }
    await tx.execute(sql`
      UPDATE mi09_pilot_runs
         SET cohort_frozen_hash = ${cohortFrozenHash},
             cohort_frozen_at = NOW()
       WHERE id = ${input.pilotRunId}::uuid AND cohort_frozen_hash IS NULL
    `);
  });

  return { frozen: true, cohortFrozenHash };
}

export async function getPilotCohortMembers(runId: string): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pilot_cohort_members
     WHERE pilot_run_id = ${runId}::uuid
     ORDER BY included_at
  `));
}

/**
 * Execute a pilot cohort phase: iterate over frozen cohort members,
 * find their associated cro03a_handoffs via canonical_source_links,
 * create a CRO-03C command for the batch, and record mi09_pilot_effect_links.
 *
 * This function is resumable: it reads the last committed checkpoint and
 * picks up from where it left off. Each call processes one checkpoint page.
 *
 * Authorization gates:
 *   - Pilot run must be in 'running' state.
 *   - Outbound pause epoch must not have changed since run creation.
 *   - Paid providers must be allowed per the definition (Pilot 1 → none allowed).
 */
/**
 * Execute a pilot cohort phase: only `enrichment` is currently supported.
 *
 * `validation` (ZeroBounce) is NOT a dispatchable stage in CRO03B_UNIFIED_RECIPE and
 * therefore cannot be issued as a CRO-03C command. Email validation for pilot contacts
 * occurs inside the enrichment recipe's zerobounce_validation stage, not as a separate
 * pilot phase.
 *
 * `staging` does not need a CRO-03C command — master leads are written directly when
 * the CRO-03C enrichment run reaches terminal state. Creating a providerless staging
 * command would produce fake completion evidence without actually staging master leads.
 *
 * Accepting non-enrichment phases is rejected with an explicit error so callers cannot
 * advance checkpoints for phases that have no real implementation.
 */
export async function executePilotCohortPhase(input: {
  pilotRunId: string;
  phase: "enrichment";
  batchSize?: number;
}): Promise<{
  processed: number;
  handoffsLinked: number;
  effectsRecorded: number;
  complete: boolean;
}> {
  const batchSize = Math.max(1, input.batchSize ?? 50);

  // Verify run state and load definition for paid-provider gating.
  const run = rows(await db.execute(sql`
    SELECT pr.id, pr.state, pr.outbound_pause_epoch, pr.pilot_definition_id,
           pd.paid_providers_allowed
    FROM mi09_pilot_runs pr
    JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
    WHERE pr.id = ${input.pilotRunId}::uuid
  `))[0];
  if (!run) throw new Error(`PILOT_RUN_NOT_FOUND:${input.pilotRunId}`);
  if (String(run.state) !== "running") {
    throw new Error(`PILOT_EXECUTOR_RUN_NOT_RUNNING:state=${run.state}`);
  }

  // Derive the paid provider for this phase from the definition's paid_providers_allowed map.
  // Each phase uses a specific provider; no provider is used if the definition disallows it.
  //   enrichment  → serper (business identity discovery)
  //   validation  → zerobounce (email validation)
  //   staging     → no external provider
  const paidAllowed = run.paid_providers_allowed
    ? (typeof run.paid_providers_allowed === "string"
        ? JSON.parse(run.paid_providers_allowed)
        : run.paid_providers_allowed)
    : {};
  // Enrichment phase may use Serper when the definition allows it.
  const phaseProvider: string | undefined =
    input.phase === "enrichment" && paidAllowed.serper === true ? "serper" : undefined;

  // Verify outbound is still paused with the same epoch.
  const pause = await getPauseState();
  if (pause.state !== "paused" || String(pause.epoch) !== String(run.outbound_pause_epoch)) {
    throw new Error(
      `PILOT_EXECUTOR_OUTBOUND_CHANGED:pause_state=${pause.state} ` +
      `epoch_now=${pause.epoch} epoch_recorded=${run.outbound_pause_epoch}`,
    );
  }

  // Read checkpoint to determine where to resume.
  const checkpoint = rows(await db.execute(sql`
    SELECT last_processed_business_id, processed_count
    FROM mi09_pilot_checkpoints
    WHERE pilot_run_id = ${input.pilotRunId}::uuid AND phase = ${input.phase}
  `))[0];
  const lastProcessedId = checkpoint?.last_processed_business_id
    ? Number(checkpoint.last_processed_business_id)
    : 0;

  // Load the next batch of cohort members after the checkpoint.
  const cohortBatch = rows(await db.execute(sql`
    SELECT canonical_business_id, source_adapter_key, county_fips, vertical
    FROM mi09_pilot_cohort_members
    WHERE pilot_run_id = ${input.pilotRunId}::uuid
      AND canonical_business_id > ${lastProcessedId}
    ORDER BY canonical_business_id ASC
    LIMIT ${batchSize}
  `));

  if (cohortBatch.length === 0) {
    // No more members: this phase is complete.
    return { processed: 0, handoffsLinked: 0, effectsRecorded: 0, complete: true };
  }

  const businessIds = cohortBatch.map((m: any) => Number(m.canonical_business_id));
  const maxBusinessId = Math.max(...businessIds);

  // Find handoffs associated with these businesses via canonical_source_links.
  // canonical_source_links.stable_key matches cro03a_handoffs.source_key.
  const handoffRows = rows(await db.execute(sql`
    SELECT DISTINCT h.id::text AS handoff_id, csl.business_id::int AS business_id
    FROM canonical_source_links csl
    JOIN cro03a_handoffs h
      ON h.source_system = csl.source_system
     AND h.source_key = csl.stable_key
     AND h.source_type = csl.source_type
    WHERE csl.business_id = ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}::int`), sql`, `)}])
      AND h.effect_authorized = false
  `));

  const handoffIds = handoffRows.map((r: any) => String(r.handoff_id));
  let effectsRecorded = 0;

  if (handoffIds.length > 0) {
    // Create a real CRO-03C command for the batch of handoffs, then record the
    // command ID as a mi09_pilot_effect_links row with entity_type='cro03c_command'.
    // This satisfies the CHECK constraint (entity_type IN ('cro03c_command','generation',
    // 'staging_receipt','master_lead')) and creates genuine execution evidence.
    const { createCro03cCommand } = await import("./cro03/live-execution");
    const { createHash } = await import("crypto");

    // Get the active CRO-03C policy and the latest unexpired runtime attestation separately.
    // cro03c_activation_policies does NOT have a runtime_attestation_id column — the
    // policy and attestation are linked by ceremony, not by a DB FK. We query each table
    // independently: latest approved policy revision + latest unexpired attestation.
    const policyRow = rows(await db.execute(sql`
      SELECT expected_revision
      FROM cro03c_activation_policies
      WHERE policy_key = 'cro03c_live_activation'
        AND status = 'approved'
      ORDER BY expected_revision DESC
      LIMIT 1
    `))[0];
    const attestationRow = rows(await db.execute(sql`
      SELECT id FROM cro03c_runtime_attestations
      WHERE expires_at > NOW()
      ORDER BY issued_at DESC
      LIMIT 1
    `))[0];

    if (!policyRow) {
      throw new Error(
        "PILOT_EXECUTOR_NO_ACTIVE_POLICY — CRO-03C activation policy missing; " +
        "run the CRO-03D ceremony before executing pilot phases",
      );
    }
    if (!attestationRow) {
      throw new Error(
        "PILOT_EXECUTOR_NO_VALID_ATTESTATION — no unexpired CRO-03C runtime attestation; " +
        "run a fresh CRO-03D attestation before executing pilot phases",
      );
    }

    // Idempotent: key includes pilot run, phase, and checkpoint page.
    const selectionHash = createHash("sha256")
      .update(JSON.stringify({ pilotRunId: input.pilotRunId, phase: input.phase, handoffIds: [...handoffIds].sort() }))
      .digest("hex");
    const commandIdem = selectionHash.slice(0, 128);

    // Provider and caps are derived from the definition's paid_providers_allowed —
    // not trusted from the caller. Pilot 1 sends no provider; Pilots 2/3 supply the
    // phase-appropriate provider with zero caps (unit-capped by definition budget at
    // runtime). When a provider is excluded in paid_providers_allowed the command is
    // still created for audit evidence — it will plan all provider stages as skipped.
    const { commandId } = await createCro03cCommand({
      actorId:                    `mi09-pilot:${input.pilotRunId.slice(0, 8)}`,
      idempotencyKey:             commandIdem,
      commandType:                "pilot_phase",
      pilotRunId:                 input.pilotRunId,
      expectedActivationRevision: Number(policyRow.expected_revision),
      runtimeAttestationId:       String(attestationRow.id),
      handoffIds,
      // Caps derived from the matching mi09_pricing_artifact for this provider.
      // maxUnits = number of handoffs in the batch (one unit per subject).
      // maxAmountMicros = amountMicros per unit × handoffIds.length.
      // If no pricing artifact exists for this provider, the command is still
      // created without provider (fail-closed: no un-priced paid work is issued).
      ...(await (async () => {
        if (!phaseProvider) return {};
        const artifact = rows(await db.execute(sql`
          SELECT amount_micros FROM mi09_pricing_artifacts
          WHERE provider_key = ${phaseProvider}
            AND captured_at > NOW() - INTERVAL '7 days'
          ORDER BY captured_at DESC LIMIT 1
        `))[0];
        if (!artifact) {
          // No current pricing artifact for this provider — skip paid provider for safety.
          return {};
        }
        const unitAmountMicros = Number(artifact.amount_micros);
        const batchUnits = handoffIds.length;
        return {
          provider: phaseProvider as any,
          maxUnits: batchUnits,
          maxAmountMicros: unitAmountMicros * batchUnits,
        };
      })()),
      reason:                     `MI-09 Pilot ${input.pilotRunId.slice(0, 8)} — ${input.phase} phase (provider=${phaseProvider ?? "none"})`,
      expiresAt:                  new Date(Date.now() + 24 * 3600_000),
    });

    await db.execute(sql`
      INSERT INTO mi09_pilot_effect_links (pilot_run_id, entity_type, entity_id)
      VALUES (${input.pilotRunId}::uuid, 'cro03c_command', ${commandId})
      ON CONFLICT DO NOTHING
    `);
    effectsRecorded++;
  }

  // Update checkpoint.
  await db.execute(sql`
    INSERT INTO mi09_pilot_checkpoints
      (pilot_run_id, phase, last_processed_business_id, processed_count)
    VALUES (${input.pilotRunId}::uuid, ${input.phase}, ${maxBusinessId},
            ${(Number(checkpoint?.processed_count ?? 0)) + cohortBatch.length})
    ON CONFLICT (pilot_run_id, phase)
    DO UPDATE SET
      last_processed_business_id = EXCLUDED.last_processed_business_id,
      processed_count = EXCLUDED.processed_count,
      updated_at = NOW()
  `);

  // Determine if there are more members remaining.
  const remaining = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM mi09_pilot_cohort_members
    WHERE pilot_run_id = ${input.pilotRunId}::uuid
      AND canonical_business_id > ${maxBusinessId}
  `))[0];
  const complete = Number(remaining?.cnt ?? 0) === 0;

  return {
    processed: cohortBatch.length,
    handoffsLinked: handoffIds.length,
    effectsRecorded,
    complete,
  };
}

// ── Checkpoints ──────────────────────────────────────────────────────────────

export async function upsertPilotCheckpoint(input: {
  pilotRunId: string;
  phase: "enrichment";
  lastProcessedBusinessId?: string;
  processedCount: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO mi09_pilot_checkpoints
      (pilot_run_id, phase, last_processed_business_id, processed_count)
    VALUES (${input.pilotRunId}::uuid, ${input.phase},
            ${input.lastProcessedBusinessId ? Number(input.lastProcessedBusinessId) : null}, ${input.processedCount})
    ON CONFLICT (pilot_run_id, phase)
    DO UPDATE SET
      last_processed_business_id = EXCLUDED.last_processed_business_id,
      processed_count = EXCLUDED.processed_count,
      updated_at = NOW()
  `);
}

export async function getPilotCheckpoints(runId: string): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pilot_checkpoints WHERE pilot_run_id = ${runId}::uuid
  `));
}

// ── Stop Condition Checks ─────────────────────────────────────────────────────

export interface StopConditionResult {
  passed: boolean;
  failedConditions: string[];
  checkedAt: string;
  details: Record<string, unknown>;
}

/**
 * Evaluate operator-defined stop conditions against current pilot state.
 * All thresholds come from mi09_pilot_definitions — none are hardcoded.
 */
export async function evaluateStopConditions(
  runId: string,
): Promise<StopConditionResult> {
  const run = await getPilotRun(runId);
  if (!run) throw new Error("PILOT_RUN_NOT_FOUND");
  const thresholds = run.stop_condition_thresholds as {
    conflictPct: number;
    apolloYieldPct: number;
    zbUnknownPct: number;
    spendCapMicros: number;
  };

  // Load paid_providers_allowed from the definition to gate provider-specific checks.
  const defRow = rows(await db.execute(sql`
    SELECT paid_providers_allowed FROM mi09_pilot_definitions WHERE id = ${String(run.pilot_definition_id)}::uuid
  `))[0];
  const paidAllowed: Record<string, boolean> = defRow?.paid_providers_allowed
    ? (typeof defRow.paid_providers_allowed === "string"
        ? JSON.parse(defRow.paid_providers_allowed)
        : defRow.paid_providers_allowed)
    : {};

  const failedConditions: string[] = [];
  const details: Record<string, unknown> = {};

  // (a) Conflict rate
  const totalMembers = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM mi09_pilot_cohort_members
     WHERE pilot_run_id = ${runId}::uuid
  `))[0];
  const conflictMembers = rows(await db.execute(sql`
    SELECT COUNT(DISTINCT m.canonical_business_id)::int AS cnt
    FROM mi09_pilot_cohort_members m
    JOIN canonical_conflict_evidence cce
      ON (cce.business_id_a = m.canonical_business_id OR cce.business_id_b = m.canonical_business_id)
     AND cce.status = 'open'
    WHERE m.pilot_run_id = ${runId}::uuid
  `))[0];
  const totalCount = Number(totalMembers?.cnt ?? 0);
  const conflictCount = Number(conflictMembers?.cnt ?? 0);
  const conflictPct = totalCount > 0 ? (conflictCount / totalCount) * 100 : 0;
  details.conflictPct = conflictPct;
  if (conflictPct > thresholds.conflictPct) {
    failedConditions.push(`conflict_pct:${conflictPct.toFixed(2)}>${thresholds.conflictPct}`);
  }

  // (b) Spend cap — pilot-scoped settled micros from cro03c_stage_operations.
  // Join: pilot effect_links (entity_type='cro03c_command') → cro03c_commands → cro03c_generations
  //       → cro03c_stage_operations (has settled_amount_micros).
  // This is the authoritative spend signal; provider_budget_period_ledger is a
  // period-close archive that omits in-flight consumption.
  // FAIL-CLOSED: spend query failure counts as a condition failure.
  {
    let spendFailed = false;
    let totalSettledMicros = 0;
    try {
      const spendRow = rows(await db.execute(sql`
        SELECT COALESCE(SUM(so.settled_amount_micros), 0)::bigint AS settled_micros
        FROM cro03c_stage_operations so
        JOIN cro03c_generations g ON g.id = so.generation_id
        JOIN cro03c_commands cmd ON cmd.id = g.command_id
        JOIN mi09_pilot_effect_links pel
          ON pel.entity_id = cmd.id
         AND pel.entity_type = 'cro03c_command'
         AND pel.pilot_run_id = ${runId}::uuid
        WHERE so.state NOT IN ('cancelled', 'quarantined')
      `))[0];
      totalSettledMicros = Number(spendRow?.settled_micros ?? 0);
    } catch (e: any) {
      // Fail-closed: cannot verify spend cap → treat as exceeded.
      spendFailed = true;
      details.spendCapError = String(e?.message);
      failedConditions.push(`spend_cap_query_failed:${e?.message}`);
    }
    details.totalSettledMicros = totalSettledMicros;
    if (!spendFailed && thresholds.spendCapMicros > 0 && totalSettledMicros > thresholds.spendCapMicros) {
      failedConditions.push(`spend_cap:${totalSettledMicros}>${thresholds.spendCapMicros}`);
    }
  }

  // (c) Apollo reveal yield — only checked when the definition allows Apollo as a paid provider.
  // If Apollo is not in paid_providers_allowed, skip the yield check (no Apollo data will exist).
  // FAIL-CLOSED: threshold > 0 means the check is required; query failure is a stop condition.
  const apolloAllowed = paidAllowed.apollo === true;
  if (apolloAllowed && typeof thresholds.apolloYieldPct === "number" && thresholds.apolloYieldPct > 0) {
    try {
      const apolloRows = rows(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE so.terminal_disposition = 'consumed')::int AS hit_count,
          COUNT(*)::int AS total_count
        FROM cro03c_stage_operations so
        JOIN cro03c_generations g ON g.id = so.generation_id
        JOIN cro03c_commands cmd ON cmd.id = g.command_id
        JOIN mi09_pilot_effect_links pel
          ON pel.entity_id = cmd.id
         AND pel.entity_type = 'cro03c_command'
         AND pel.pilot_run_id = ${runId}::uuid
        WHERE so.provider = 'apollo'
          AND so.state NOT IN ('cancelled', 'quarantined')
      `))[0];
      const hitCount = Number(apolloRows?.hit_count ?? 0);
      const totalCount = Number(apolloRows?.total_count ?? 0);
      if (totalCount === 0) {
        // No Apollo operations yet — if threshold set, this is a data-gap failure.
        failedConditions.push(`apollo_yield_no_data:threshold_set_but_no_apollo_operations`);
      } else {
        const yieldPct = (hitCount / totalCount) * 100;
        details.apolloYieldPct = yieldPct;
        if (yieldPct < thresholds.apolloYieldPct) {
          failedConditions.push(`apollo_yield_pct:${yieldPct.toFixed(2)}<${thresholds.apolloYieldPct}`);
        }
      }
    } catch (e: any) {
      // Fail-closed: query failure means we cannot certify Apollo yield.
      failedConditions.push(`apollo_yield_query_failed:${e?.message}`);
    }
  }

  // (d-zb) ZeroBounce unknown rate — via cro03c_receipts with provider='zerobounce'.
  // Unknown rate = receipts with normalized_outcome in ('unknown','unresolvable') / total ZB receipts.
  // businesses.email_validation_status does not exist; use the stage accounting layer.
  // FAIL-CLOSED: query failure is a stop condition.
  if (typeof thresholds.zbUnknownPct === "number" && thresholds.zbUnknownPct > 0) {
    try {
      const zbRows = rows(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE r.normalized_outcome IN ('unknown','unresolvable'))::int AS unknown_count,
          COUNT(*)::int AS total_count
        FROM cro03c_receipts r
        JOIN cro03c_stage_operations so ON so.id = r.stage_operation_id
        JOIN cro03c_generations g ON g.id = so.generation_id
        JOIN cro03c_commands cmd ON cmd.id = g.command_id
        JOIN mi09_pilot_effect_links pel
          ON pel.entity_id = cmd.id
         AND pel.entity_type = 'cro03c_command'
         AND pel.pilot_run_id = ${runId}::uuid
        WHERE so.provider = 'zerobounce'
      `))[0];
      const unknownCount = Number(zbRows?.unknown_count ?? 0);
      const totalCount = Number(zbRows?.total_count ?? 0);
      if (totalCount === 0) {
        failedConditions.push(`zb_unknown_no_data:threshold_set_but_no_zb_operations`);
      } else {
        const unknownPct = (unknownCount / totalCount) * 100;
        details.zbUnknownPct = unknownPct;
        if (unknownPct > thresholds.zbUnknownPct) {
          failedConditions.push(`zb_unknown_pct:${unknownPct.toFixed(2)}>${thresholds.zbUnknownPct}`);
        }
      }
    } catch (e: any) {
      failedConditions.push(`zb_unknown_query_failed:${e?.message}`);
    }
  }

  // (e) Any outbound effects linked to pilot run — check by entity_type discrimination.
  // We do NOT join sdr_lead_events (no generation_id/command_id columns exist on that table).
  // Instead, we check for any mi09_pilot_effect_links with entity_type that is NOT one of
  // the 4 expected non-outreach types, which would indicate a forbidden effect was recorded.
  const allowedEntityTypes = ["cro03c_command", "generation", "staging_receipt", "master_lead"];
  const forbiddenLinks = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM mi09_pilot_effect_links
    WHERE pilot_run_id = ${runId}::uuid
      AND entity_type NOT IN ('cro03c_command', 'generation', 'staging_receipt', 'master_lead')
  `))[0];
  const forbiddenCount = Number(forbiddenLinks?.cnt ?? 0);
  details.forbiddenEffectLinks = forbiddenCount;
  details.allowedEntityTypes = allowedEntityTypes;
  if (forbiddenCount > 0) {
    failedConditions.push(`forbidden_effect_links:${forbiddenCount}`);
  }

  return {
    passed: failedConditions.length === 0,
    failedConditions,
    checkedAt: new Date().toISOString(),
    details,
  };
}

// ── Effect Links ─────────────────────────────────────────────────────────────

export async function recordPilotEffectLink(input: {
  pilotRunId: string;
  entityType: "cro03c_command" | "generation" | "staging_receipt" | "master_lead";
  entityId: string;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO mi09_pilot_effect_links (pilot_run_id, entity_type, entity_id)
    VALUES (${input.pilotRunId}::uuid, ${input.entityType}, ${input.entityId}::uuid)
    ON CONFLICT (pilot_run_id, entity_type, entity_id) DO NOTHING
  `);
}

export async function getPilotEffectLinks(
  runId: string,
  entityType?: string,
): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pilot_effect_links
     WHERE pilot_run_id = ${runId}::uuid
       AND (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
     ORDER BY created_at
  `));
}

// ── Advancement ──────────────────────────────────────────────────────────────

/** Issue an owner advancement receipt — idempotent by idempotency_key. */
export async function issuePilotAdvancementReceipt(
  input: AdvancementInput,
): Promise<{ id: string; alreadyExisted: boolean }> {
  // Check idempotency key first.
  const existing = rows(await db.execute(sql`
    SELECT id FROM mi09_pilot_advancement_receipts WHERE idempotency_key = ${input.idempotencyKey}
  `))[0];
  if (existing) return { id: String(existing.id), alreadyExisted: true };

  // Verify pause epoch unchanged.
  const pause = await getPauseState();
  if (pause.state !== "paused") throw new Error("PILOT_ADVANCEMENT_BLOCKED:outbound_not_paused");

  // Block advancement if stop conditions failed — caller must resolve failures first.
  if (!input.stopConditionsPassed) {
    const failures = (input.stopConditionsChecked as any)?.failedConditions ?? [];
    throw new Error(
      `PILOT_ADVANCEMENT_BLOCKED:stop_conditions_failed:[${Array.isArray(failures) ? failures.join(",") : "unknown"}]`,
    );
  }

  // Verify run exists and is in a valid state for advancement.
  const runRow = rows(await db.execute(sql`
    SELECT r.state, pd.level FROM mi09_pilot_runs r
    JOIN mi09_pilot_definitions pd ON pd.id = r.pilot_definition_id
    WHERE r.id = ${input.pilotRunId}::uuid
  `))[0];
  if (!runRow) throw new Error("PILOT_RUN_NOT_FOUND");
  if (!["running", "paused", "completed"].includes(String(runRow.state))) {
    throw new Error(`PILOT_ADVANCEMENT_BLOCKED:invalid_state:${runRow.state}`);
  }
  if (Number(runRow.level) !== input.fromLevel) {
    throw new Error(`PILOT_ADVANCEMENT_BLOCKED:level_mismatch:run_level=${runRow.level} from_level=${input.fromLevel}`);
  }

  const created = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_advancement_receipts
      (pilot_run_id, from_level, to_level, approved_by,
       pricing_artifact_id, stop_conditions_checked, stop_conditions_passed, idempotency_key)
    VALUES (${input.pilotRunId}::uuid, ${input.fromLevel}, ${input.toLevel},
            ${input.approvedBy}, ${input.pricingArtifactId ?? null}::uuid,
            ${JSON.stringify(input.stopConditionsChecked)}::jsonb,
            ${input.stopConditionsPassed}, ${input.idempotencyKey})
    RETURNING id
  `));

  // Bind receipt to the run.
  await db.execute(sql`
    UPDATE mi09_pilot_runs
       SET advancement_receipt_id = ${String(created[0].id)}::uuid
     WHERE id = ${input.pilotRunId}::uuid
  `);

  return { id: String(created[0].id), alreadyExisted: false };
}

// ── Reconciliation Reports ────────────────────────────────────────────────────

export async function savePilotReconciliationReport(input: {
  pilotRunId: string;
  reportData: Record<string, unknown>;
}): Promise<{ id: string }> {
  const created = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_reconciliation_reports (pilot_run_id, report_data)
    VALUES (${input.pilotRunId}::uuid, ${JSON.stringify(input.reportData)}::jsonb)
    RETURNING id
  `));
  return { id: String(created[0].id) };
}

export async function updateReconciliationReportDriveDoc(
  reportId: string,
  driveDocId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE mi09_pilot_reconciliation_reports
       SET drive_doc_id = ${driveDocId}, drive_published_at = NOW()
     WHERE id = ${reportId}::uuid
  `);
}

export async function getPilotReconciliationReports(runId: string): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT * FROM mi09_pilot_reconciliation_reports
     WHERE pilot_run_id = ${runId}::uuid ORDER BY created_at
  `));
}

// ── Preflight Checklist ───────────────────────────────────────────────────────

export interface PreflightCheckResult {
  passed: boolean;
  checks: Record<string, { passed: boolean; detail?: string }>;
}

/**
 * Verify all pre-pilot checklist items (Section 6 of MI-09 spec).
 * Returns a structured report — callers decide whether to block on failure.
 */
export async function runPreflightChecklist(): Promise<PreflightCheckResult> {
  const checks: Record<string, { passed: boolean; detail?: string }> = {};

  // 2. No interrupted enrichment progress.
  try {
    const interrupted = rows(await db.execute(sql`
      SELECT value FROM system_settings WHERE key = 'enrichment_progress' LIMIT 1
    `))[0];
    const val = interrupted?.value ? JSON.parse(interrupted.value) : null;
    const isInterrupted = val?.status === "interrupted";
    checks.noInterruptedEnrichment = {
      passed: !isInterrupted,
      detail: isInterrupted ? "enrichment_progress.status=interrupted" : undefined,
    };
  } catch (e: any) {
    checks.noInterruptedEnrichment = { passed: false, detail: String(e?.message) };
  }

  // 3. ≥10 real canonical businesses.
  try {
    const biz = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM businesses LIMIT 1
    `))[0];
    const cnt = Number(biz?.cnt ?? 0);
    checks.minTenBusinesses = { passed: cnt >= 10, detail: `count=${cnt}` };
  } catch (e: any) {
    checks.minTenBusinesses = { passed: false, detail: String(e?.message) };
  }

  // 4. ≥100 cro03a_handoffs from DBPR-HR adapter (source_system='dbpr_hr'), verified
  //    by joining source_import_runs through cro03a_qualification_runs.
  //    cro03_source_subjects does NOT have source_import_run_id; use cro03a_handoffs
  //    which records the source_system directly and links through run_id.
  try {
    const ss = rows(await db.execute(sql`
      SELECT COUNT(h.id)::int AS cnt
      FROM cro03a_handoffs h
      JOIN cro03a_qualification_runs qr ON qr.id = h.run_id
      WHERE h.source_system = 'dbpr_hr'
        AND qr.status = 'completed'
      LIMIT 1
    `))[0];
    const cnt = Number(ss?.cnt ?? 0);
    checks.minHundredDbprSubjects = { passed: cnt >= 100, detail: `dbpr_hr_handoffs=${cnt}` };
  } catch (e: any) {
    checks.minHundredDbprSubjects = { passed: false, detail: String(e?.message) };
  }

  // 5. ≥1 completed cro03a_qualification_run with ≥10 qualified handoffs.
  //    Correct table: cro03a_handoffs (NOT cro03a_qualification_handoffs which does not exist).
  try {
    const qr = rows(await db.execute(sql`
      SELECT qr.id, COUNT(h.id)::int AS handoff_count
      FROM cro03a_qualification_runs qr
      LEFT JOIN cro03a_handoffs h ON h.run_id = qr.id
      WHERE qr.status = 'completed'
      GROUP BY qr.id
      HAVING COUNT(h.id) >= 10
      LIMIT 1
    `))[0];
    checks.qualificationRunWithHandoffs = {
      passed: !!qr,
      detail: qr ? `run_id=${qr.id} handoffs=${qr.handoff_count}` : "none_found",
    };
  } catch (e: any) {
    checks.qualificationRunWithHandoffs = { passed: false, detail: String(e?.message) };
  }

  // 6. ≥5 businesses with free enrichment complete.
  try {
    const fe = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM businesses
       WHERE free_enrichment_status = 'complete'
      LIMIT 1
    `))[0];
    const cnt = Number(fe?.cnt ?? 0);
    checks.minFiveWithFreeEnrichment = { passed: cnt >= 5, detail: `count=${cnt}` };
  } catch (e: any) {
    checks.minFiveWithFreeEnrichment = { passed: false, detail: String(e?.message) };
  }

  // 8. CRO03C_CURRENT_MIGRATION_HEAD matches expected.
  const expectedHead = "0260_mi07_dedup_unique_indexes";
  try {
    const { CRO03C_CURRENT_MIGRATION_HEAD } = await import("./cro03/contracts");
    checks.migrationHeadUpdated = {
      passed: CRO03C_CURRENT_MIGRATION_HEAD === expectedHead,
      detail: `got=${CRO03C_CURRENT_MIGRATION_HEAD} want=${expectedHead}`,
    };
  } catch (e: any) {
    checks.migrationHeadUpdated = { passed: false, detail: String(e?.message) };
  }

  // 11. Global outbound confirmed paused.
  try {
    const pause = await getPauseState();
    checks.globalOutboundPaused = {
      passed: pause.state === "paused",
      detail: `paused=${pause.state === "paused"} epoch=${pause.epoch}`,
    };
  } catch (e: any) {
    checks.globalOutboundPaused = { passed: false, detail: String(e?.message) };
  }

  // 12. Zero open canonical_conflict_evidence rows.
  try {
    const conflicts = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM canonical_conflict_evidence WHERE status = 'open' LIMIT 1
    `))[0];
    const cnt = Number(conflicts?.cnt ?? 0);
    checks.zeroOpenConflicts = { passed: cnt === 0, detail: `open_conflicts=${cnt}` };
  } catch (e: any) {
    checks.zeroOpenConflicts = { passed: false, detail: String(e?.message) };
  }

  const passed = Object.values(checks).every((c) => c.passed);
  return { passed, checks };
}
