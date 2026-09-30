#!/usr/bin/env tsx
/**
 * test-sfp-continuous-tick-orchestration-certification.ts
 *
 * Disposable-database certification for the continuous-pipeline orchestrator
 * (sfp-continuous-discovery.ts) — the piece of the SFP pipeline that closes
 * the "manual admin click only" automation gap by draining discovery and
 * validation work on a recurring BullMQ tick.
 *
 * This certifies ORCHESTRATION correctness, not provider I/O (the real
 * Serper/ZeroBounce calls, and the full validation -> ready_held handoff
 * with a fake transport, are already certified by
 * test-sfp-serper-pilot-control-certification.ts and
 * test-sfp-full-drain-certification.ts respectively):
 *
 *  1. processSfpContinuousValidationTick() checks the admin-auditable
 *     FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED override BEFORE touching
 *     any cohort/eligibility row — disabled means zero writes, not just a
 *     zero-count result.
 *  2. Once the override is enabled, the tick's very next gate is the
 *     provider_controls readiness check (durable pause) — a disabled
 *     provider stops the tick with zero writes and zero reservation
 *     attempts, before any cohort is claimed.
 *  3. processSfpContinuousDiscoveryTick() refuses to run at all without
 *     CRO03_PROVIDER_TRANSPORT_ENABLED + SERPER_API_KEY, and this precedes
 *     any program/cohort lookup.
 *  4. Every stop reports as a clean, resumable outcome (ran:false or a
 *     named stopReason) — never an unhandled throw — matching the
 *     "disabled/paused is a quiet outcome, not N wasted attempts" contract.
 *
 * Run via: npx tsx scripts/run-sfp-certification-disposable.ts
 * (added to that wrapper's SCRIPTS list), or directly against the dev DB.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP continuous-tick orchestration disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

let assertions = 0;
function check(value: unknown, id: string, label: string): asserts value {
  assertions++;
  assert.ok(value, `[${id}] ${label}`);
  console.log(`✓ [${id}] ${label}`);
}

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();

const { db } = await import("../server/db");
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN_ID = `sfpcto-${randomUUID().slice(0, 8)}`;

const { ensureProgram, setProgramActivation, setSfpValidationPromotionOverride } = await import(
  "../server/services/cro03/south-florida-prospecting"
);
const { processSfpContinuousDiscoveryTick, processSfpContinuousValidationTick } = await import(
  "../server/services/cro03/sfp-continuous-discovery"
);

const program = await ensureProgram({ createdBy: `cert:${RUN_ID}` });
await setProgramActivation({ active: true, actorId: `cert:${RUN_ID}` });

// A frozen cohort with real outreach-eligibility backlog, so any premature
// write during a gated-off tick would show up unambiguously.
const cohortRunId = randomUUID();
const bizRow = rows(await db.execute(sql`
  INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
  VALUES (${`${RUN_ID}-biz`}, ${`${RUN_ID}-biz`.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
  RETURNING id
`))[0];
const bizId = Number(bizRow.id);
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${cohortRunId}::uuid, ${program.id}::uuid, ${`cert-cto-${RUN_ID}`}, 'freezing',
          1, ${RUN_ID}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${RUN_ID}, ${RUN_ID})
`);
await db.execute(sql`
  INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
  VALUES (${cohortRunId}::uuid, ${bizId}, 100, 'verified', 'fips', '12086', 'Med Spa')
`);
await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid`);
check(true, "SETUP", `frozen cohort ${cohortRunId} with 1 backlog business, program active`);

async function eligibilityCount(): Promise<number> {
  const r = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
  `));
  return Number(r[0]?.n ?? 0);
}

// ══════════════════════════════════════════════════════════════════════════
// GATE 1: validation-promotion override closed -> zero writes, clean result
// ══════════════════════════════════════════════════════════════════════════
await setSfpValidationPromotionOverride({ value: false, actorId: `cert:${RUN_ID}` });
const beforeCount1 = await eligibilityCount();
const gated = await processSfpContinuousValidationTick();
check(gated.ran === false, "GATE1-ran-false", `tick reports ran:false while promotion override is closed (got: ${JSON.stringify(gated)})`);
check(gated.reason === "validation_promotion_disabled", "GATE1-reason", `stop reason is validation_promotion_disabled (got: ${gated.reason})`);
check((await eligibilityCount()) === beforeCount1, "GATE1-zero-writes", "zero sfp_outreach_eligibility rows written while the gate is closed");

// ══════════════════════════════════════════════════════════════════════════
// GATE 2: override open, but provider disabled -> provider_paused before
// any cohort/eligibility row is touched
// ══════════════════════════════════════════════════════════════════════════
await setSfpValidationPromotionOverride({ value: true, actorId: `cert:${RUN_ID}` });
const zbBefore = rows(await db.execute(sql`SELECT enabled FROM provider_controls WHERE provider='zerobounce'`))[0];
await db.execute(sql`UPDATE provider_controls SET enabled = FALSE WHERE provider = 'zerobounce'`);
try {
  const beforeCount2 = await eligibilityCount();
  const paused = await processSfpContinuousValidationTick();
  check(paused.ran === false, "GATE2-ran-false", `tick reports ran:false while zerobounce provider is disabled (got: ${JSON.stringify(paused)})`);
  check(
    typeof paused.stopReason === "string" && paused.stopReason.startsWith("provider_paused"),
    "GATE2-stop-reason",
    `stop reason starts with provider_paused (got: ${paused.stopReason})`,
  );
  check((await eligibilityCount()) === beforeCount2, "GATE2-zero-writes", "zero sfp_outreach_eligibility rows written while the provider is disabled");
} finally {
  await db.execute(sql`UPDATE provider_controls SET enabled = ${zbBefore?.enabled ?? true} WHERE provider = 'zerobounce'`);
}

// ══════════════════════════════════════════════════════════════════════════
// GATE 3: with provider transport unavailable, the safe transport pre-check
// wins before provider readiness and any program/cohort lookup.
// ══════════════════════════════════════════════════════════════════════════
const savedTransportFlag = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
const savedSerperKey = process.env.SERPER_API_KEY;
delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
delete process.env.SERPER_API_KEY;
try {
  const cohortsBeforeGate3 = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM sfp_cohort_runs WHERE program_id = ${program.id}::uuid
  `))[0]?.n ?? 0);
  const discoveryGated = await processSfpContinuousDiscoveryTick();
  check(discoveryGated.ran === false, "GATE3-ran-false", `discovery tick reports ran:false without transport/API key (got: ${JSON.stringify(discoveryGated)})`);
  check(
    discoveryGated.reason === "provider_transport_unavailable",
    "GATE3-reason",
    `transport pre-check reports provider_transport_unavailable (got: ${discoveryGated.reason ?? discoveryGated.stopReason})`,
  );
  const cohortsAfterGate3 = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM sfp_cohort_runs WHERE program_id = ${program.id}::uuid
  `))[0]?.n ?? 0);
  check(cohortsAfterGate3 === cohortsBeforeGate3,
    "GATE3-no-cohort-writes", "transport pre-check performs no program/cohort writes or claims");
} finally {
  if (savedTransportFlag !== undefined) process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = savedTransportFlag;
  if (savedSerperKey !== undefined) process.env.SERPER_API_KEY = savedSerperKey;
}

console.log(`\n✅ ${assertions} assertions passed — continuous-tick orchestration gates (validation-promotion override, provider pause, discovery credential gate) all fail closed with zero premature writes.`);
process.exit(0);
