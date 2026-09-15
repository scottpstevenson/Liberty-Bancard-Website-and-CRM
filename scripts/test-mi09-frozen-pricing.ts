#!/usr/bin/env tsx
/**
 * scripts/test-mi09-frozen-pricing.ts
 *
 * Corrective item 4 — frozen pricing authority at run creation.
 *
 * Verifies:
 *  1. createPilotRun() fails closed when an allowed paid provider has no
 *     current pricing artifact.
 *  2. createPilotRun() freezes the *current* artifact for every allowed paid
 *     provider into mi09_pilot_runs.frozen_pricing_artifacts at creation time.
 *  3. A LATER pricing artifact submitted after the run was created does not
 *     change what the already-created run is bound to — the frozen JSON
 *     still points at the original artifact/amount, proving the run's
 *     pricing is pinned rather than re-read live from mi09_pricing_artifacts.
 *  4. Level 1 (no paid providers) runs freeze an empty object and are
 *     unaffected by any of this.
 *
 * Isolation: every fixture row is tagged with a unique run tag; only rows
 * this test creates are touched. No worker activation, no CRO-03C command
 * creation, no provider calls — this test only exercises createPilotRun(),
 * a database-only function.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { createPilotDefinition, createPilotRun } from "../server/services/mi09-pilot-authority";
import { invalidatePauseStateCache } from "../server/services/outbound-pause-authority";
import { pool } from "../server/db";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`); failed++; }
}
async function throws(label: string, fn: () => Promise<unknown>, expectedSubstring: string) {
  try {
    await fn();
    ok(label, false, "did not throw");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    ok(label, msg.includes(expectedSubstring), msg);
  }
}

async function setTestPauseState(paused: boolean): Promise<void> {
  await pool.query(`UPDATE outbound_pause_control SET state = $1`, [paused ? "paused" : "unpaused"]);
  invalidatePauseStateCache();
}

const runTag = `frzp-${Date.now()}`;

async function insertArtifact(provider: string, amountMicros: number, tag: string): Promise<string> {
  const r = rows(await db.execute(sql`
    INSERT INTO mi09_pricing_artifacts
      (provider_key, unit_type, amount_micros, currency, billing_semantics, captured_by, artifact_hash)
    VALUES (${provider}, 'per_call', ${amountMicros}, 'USD', 'per_unit', ${`test-${runTag}-${tag}`}, ${`hash-${runTag}-${tag}`})
    RETURNING id
  `));
  return String(r[0].id);
}

async function main() {
  console.log("\n=== Corrective item 4: frozen pricing authority at run creation ===\n");

  const preState = rows(await db.execute(sql`SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1`));
  const preWasPaused = preState[0]?.state !== "unpaused";
  const epochRow = rows(await db.execute(sql`SELECT epoch::text AS epoch FROM outbound_pause_control ORDER BY id LIMIT 1`))[0];
  const epoch = Number(epochRow?.epoch ?? 0);

  const createdDefIds: string[] = [];
  const createdRunIds: string[] = [];
  const createdArtifactIds: string[] = [];
  let quarantinedApolloIds: string[] = [];

  try {
    await setTestPauseState(true);

    // ── 1. No pricing artifact exists yet for an allowed provider → fail-closed.
    // This dev DB is shared and may already carry a real, recent "apollo"
    // artifact from actual operator activity (or another test), so this
    // temporarily quarantines any such row (pushes captured_at outside the
    // 7-day window) rather than assuming the table starts empty — restored
    // in the finally block regardless of outcome.
    const existingApollo = rows(await db.execute(sql`
      SELECT id FROM mi09_pricing_artifacts
      WHERE provider_key = 'apollo' AND captured_at > NOW() - INTERVAL '7 days'
    `));
    quarantinedApolloIds = existingApollo.map((r: any) => String(r.id));
    if (quarantinedApolloIds.length > 0) {
      await db.execute(sql`
        UPDATE mi09_pricing_artifacts SET captured_at = NOW() - INTERVAL '30 days'
        WHERE id = ANY(ARRAY[${sql.join(quarantinedApolloIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      `);
    }

    const { id: defIdApolloOnly } = await createPilotDefinition({
      level: 2,
      countyScope: [`${runTag}-apollo-county`],
      verticalScope: [`${runTag}-apollo-vertical`],
      sourceAdapterFilter: [`${runTag}-apollo-adapter`],
      maxCohortSize: 10,
      enrichmentRecipeVersion: 1,
      paidProvidersAllowed: { serper: false, zerobounce: false, outscraper: false, apollo: true, openai: false },
      stopConditionThresholds: { failureRatePercent: 50 },
      createdBy: `test-${runTag}`,
    } as any);
    createdDefIds.push(defIdApolloOnly);

    await throws(
      "no current pricing artifact for allowed provider (apollo) \u2192 PILOT_RUN_BLOCKED:pricing_artifact_missing (fail-closed)",
      () => createPilotRun({
        pilotDefinitionId: defIdApolloOnly,
        releaseSha: "a".repeat(40),
        cro03cSelectionPolicyVersion: 1,
        cro03cRoutingPolicyVersion: 1,
        cro03cRecipeVersion: 1,
        outboundPauseEpoch: epoch,
      }),
      "PILOT_RUN_BLOCKED:pricing_artifact_missing",
    );

    // ── Fixture: a paid Level-2 definition allowing serper + zerobounce ──────
    const { id: defId } = await createPilotDefinition({
      level: 2,
      countyScope: [`${runTag}-county`],
      verticalScope: [`${runTag}-vertical`],
      sourceAdapterFilter: [`${runTag}-adapter`],
      maxCohortSize: 10,
      enrichmentRecipeVersion: 1,
      paidProvidersAllowed: { serper: true, zerobounce: true, outscraper: false, apollo: false, openai: false },
      stopConditionThresholds: { failureRatePercent: 50 },
      createdBy: `test-${runTag}`,
    } as any);
    createdDefIds.push(defId);

    // ── 2. Insert artifacts for both, then create the run — freezes both ─────
    const serperArtifactId1 = await insertArtifact("serper", 1_000_000, "v1");
    const zbArtifactId1 = await insertArtifact("zerobounce", 500_000, "v1");
    createdArtifactIds.push(serperArtifactId1, zbArtifactId1);

    const { id: runId } = await createPilotRun({
      pilotDefinitionId: defId,
      releaseSha: "a".repeat(40),
      cro03cSelectionPolicyVersion: 1,
      cro03cRoutingPolicyVersion: 1,
      cro03cRecipeVersion: 1,
      outboundPauseEpoch: epoch,
    });
    createdRunIds.push(runId);

    const runRow = rows(await db.execute(sql`
      SELECT frozen_pricing_artifacts FROM mi09_pilot_runs WHERE id = ${runId}::uuid
    `))[0];
    const frozen = typeof runRow.frozen_pricing_artifacts === "string"
      ? JSON.parse(runRow.frozen_pricing_artifacts) : runRow.frozen_pricing_artifacts;

    ok(
      "run freezes serper's current artifact id + amount at creation time",
      frozen?.serper?.artifactId === serperArtifactId1 && frozen?.serper?.amountMicros === 1_000_000,
      JSON.stringify(frozen?.serper),
    );
    ok(
      "run freezes zerobounce's current artifact id + amount at creation time",
      frozen?.zerobounce?.artifactId === zbArtifactId1 && frozen?.zerobounce?.amountMicros === 500_000,
      JSON.stringify(frozen?.zerobounce),
    );
    ok(
      "outscraper/apollo/openai (not allowed) are absent from the frozen set",
      frozen?.outscraper === undefined && frozen?.apollo === undefined && frozen?.openai === undefined,
      JSON.stringify(frozen),
    );

    // ── 3. Submit a NEW, different-priced artifact for serper AFTER the run exists ──
    const serperArtifactId2 = await insertArtifact("serper", 9_999_000, "v2-later");
    createdArtifactIds.push(serperArtifactId2);

    const runRowAfter = rows(await db.execute(sql`
      SELECT frozen_pricing_artifacts FROM mi09_pilot_runs WHERE id = ${runId}::uuid
    `))[0];
    const frozenAfter = typeof runRowAfter.frozen_pricing_artifacts === "string"
      ? JSON.parse(runRowAfter.frozen_pricing_artifacts) : runRowAfter.frozen_pricing_artifacts;

    ok(
      "a pricing artifact submitted AFTER run creation does not change the already-frozen run (still the original artifact/amount)",
      frozenAfter?.serper?.artifactId === serperArtifactId1 && frozenAfter?.serper?.amountMicros === 1_000_000,
      JSON.stringify(frozenAfter?.serper),
    );

    // A second, NEW run created now (post-resubmission) correctly picks up the
    // newer artifact — proving the freeze is per-run at creation time, not a
    // global staleness bug.
    const { id: runId2 } = await createPilotRun({
      pilotDefinitionId: defId,
      releaseSha: "b".repeat(40),
      cro03cSelectionPolicyVersion: 1,
      cro03cRoutingPolicyVersion: 1,
      cro03cRecipeVersion: 1,
      outboundPauseEpoch: epoch,
    });
    createdRunIds.push(runId2);
    const run2Row = rows(await db.execute(sql`
      SELECT frozen_pricing_artifacts FROM mi09_pilot_runs WHERE id = ${runId2}::uuid
    `))[0];
    const frozen2 = typeof run2Row.frozen_pricing_artifacts === "string"
      ? JSON.parse(run2Row.frozen_pricing_artifacts) : run2Row.frozen_pricing_artifacts;
    ok(
      "a NEW run created after resubmission freezes the newer artifact (per-run-at-creation-time, not globally stale)",
      frozen2?.serper?.artifactId === serperArtifactId2 && frozen2?.serper?.amountMicros === 9_999_000,
      JSON.stringify(frozen2?.serper),
    );

    // ── 4. Level 1 (no paid providers) freezes an empty object ───────────────
    const { id: defId1 } = await createPilotDefinition({
      level: 1,
      countyScope: [`${runTag}-l1-county`],
      verticalScope: [`${runTag}-l1-vertical`],
      sourceAdapterFilter: [`${runTag}-l1-adapter`],
      maxCohortSize: 10,
      enrichmentRecipeVersion: 1,
      paidProvidersAllowed: { serper: false, zerobounce: false, outscraper: false, apollo: false, openai: false },
      stopConditionThresholds: { failureRatePercent: 50 },
      createdBy: `test-${runTag}`,
    } as any);
    createdDefIds.push(defId1);
    const { id: runId1 } = await createPilotRun({
      pilotDefinitionId: defId1,
      releaseSha: "c".repeat(40),
      cro03cSelectionPolicyVersion: 1,
      cro03cRoutingPolicyVersion: 1,
      cro03cRecipeVersion: 1,
      outboundPauseEpoch: epoch,
    });
    createdRunIds.push(runId1);
    const run1Row = rows(await db.execute(sql`
      SELECT frozen_pricing_artifacts FROM mi09_pilot_runs WHERE id = ${runId1}::uuid
    `))[0];
    const frozen1 = typeof run1Row.frozen_pricing_artifacts === "string"
      ? JSON.parse(run1Row.frozen_pricing_artifacts) : run1Row.frozen_pricing_artifacts;
    ok(
      "Level 1 (no paid providers) run freezes an empty object, unaffected by pricing state",
      frozen1 && Object.keys(frozen1).length === 0,
      JSON.stringify(frozen1),
    );

  } finally {
    for (const id of createdRunIds) {
      await db.execute(sql`DELETE FROM mi09_pilot_runs WHERE id = ${id}::uuid`);
    }
    for (const id of createdDefIds) {
      await db.execute(sql`DELETE FROM mi09_pilot_definitions WHERE id = ${id}::uuid`);
    }
    for (const id of createdArtifactIds) {
      await db.execute(sql`DELETE FROM mi09_pricing_artifacts WHERE id = ${id}::uuid`);
    }
    if (quarantinedApolloIds.length > 0) {
      await db.execute(sql`
        UPDATE mi09_pricing_artifacts SET captured_at = NOW()
        WHERE id = ANY(ARRAY[${sql.join(quarantinedApolloIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      `);
    }
    await setTestPauseState(preWasPaused);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
