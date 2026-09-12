#!/usr/bin/env tsx
/**
 * task #1940 — DB-backed certification for the MI-09 pricing artifact/
 * snapshot seed. Verifies:
 *   1. Applying the seed once creates exactly 9 artifacts (one per
 *      CRO03C_PROVIDER_KEYS provider) + 1 schedule snapshot, all with the
 *      exact fields from MI09_PRICING_SEED_TABLE.
 *   2. Applying it again reuses all 9 artifacts and the snapshot — no
 *      duplicate rows are ever created (replay idempotency).
 *   3. The snapshot's composite_hash is independently reproducible via
 *      buildCro03PriceScheduleFromArtifacts + stableCro03RecipeHash (the
 *      exact helper the ceremony script and certification gate use).
 *   4. Zero provider transport occurs anywhere in this suite.
 *
 * Runs against a disposable test database only (assertDisposableTestInfrastructure).
 */
import assert from "node:assert/strict";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

process.env.NODE_ENV = "test";

let networkCallsObserved = 0;
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = (...args: any[]) => {
  networkCallsObserved += 1;
  return originalFetch(...(args as [any]));
};

await assertDisposableTestInfrastructure({ operation: "MI-09 pricing seed certification" });

const { db } = await import("../server/db");
const { sql } = await import("drizzle-orm");
const {
  reuseOrCreatePricingArtifact,
  createPricingScheduleSnapshot,
  getPricingArtifacts,
} = await import("../server/services/mi09-pilot-authority");
const {
  MI09_PRICING_SEED_TABLE,
  MI09_PRICING_CAPTURED_BY,
  MI09_PRICING_ARTIFACT_VERSION,
  MI09_PRICING_CURRENCY,
} = await import("../server/services/cro03/mi09-pricing-seed-data");
const {
  buildCro03PriceScheduleFromArtifacts,
  stableCro03RecipeHash,
  CRO03C_PROVIDER_KEYS,
} = await import("../server/services/cro03/contracts");

async function applyOnce() {
  const artifactIds: Record<string, string> = {};
  const reused: Record<string, boolean> = {};
  for (const row of MI09_PRICING_SEED_TABLE) {
    const result = await reuseOrCreatePricingArtifact({
      providerKey: row.providerKey,
      unitType: row.unitType,
      amountMicros: row.amountMicros,
      currency: MI09_PRICING_CURRENCY,
      billingSemantics: row.billingSemantics,
      capturedBy: MI09_PRICING_CAPTURED_BY,
      sourceUrl: row.sourceUrl ?? undefined,
      artifactVersion: MI09_PRICING_ARTIFACT_VERSION,
    });
    artifactIds[row.providerKey] = result.id;
    reused[row.providerKey] = result.reused;
  }
  const snapshot = await createPricingScheduleSnapshot({ capturedBy: MI09_PRICING_CAPTURED_BY });
  return { artifactIds, reused, snapshot };
}

async function main() {
  // ── First apply: 9 artifacts created, 1 snapshot created ────────────────
  const first = await applyOnce();
  for (const key of CRO03C_PROVIDER_KEYS) {
    assert.equal(first.reused[key], false, `expected ${key} artifact to be newly created on first apply`);
  }
  assert.equal(first.snapshot.reused, false, "expected snapshot to be newly created on first apply");
  assert.equal(first.snapshot.artifactIds.length, 9, "snapshot must reference exactly 9 artifacts");

  const countAfterFirst = (await getPricingArtifacts()).length;
  assert.equal(countAfterFirst, 9, `expected exactly 9 artifacts after first apply, got ${countAfterFirst}`);
  const snapshotCountAfterFirst = (
    (await db.execute(sql`SELECT COUNT(*)::int AS n FROM mi09_pricing_schedule_snapshots`)) as any
  ).rows[0].n;
  assert.equal(snapshotCountAfterFirst, 1, "expected exactly 1 snapshot after first apply");

  // ── Field-level exact match against the seed table ──────────────────────
  const artifacts = await getPricingArtifacts();
  for (const row of MI09_PRICING_SEED_TABLE) {
    const artifact = artifacts.find((a: any) => a.provider_key === row.providerKey);
    assert.ok(artifact, `artifact missing for ${row.providerKey}`);
    assert.equal(artifact.unit_type, row.unitType, `unitType mismatch for ${row.providerKey}`);
    assert.equal(Number(artifact.amount_micros), row.amountMicros, `amountMicros mismatch for ${row.providerKey}`);
    assert.equal(artifact.billing_semantics, row.billingSemantics, `billingSemantics mismatch for ${row.providerKey}`);
    assert.equal(artifact.currency, MI09_PRICING_CURRENCY, `currency mismatch for ${row.providerKey}`);
  }
  // Explicit apollo unit-type correction check (task's headline fix).
  const apolloArtifact = artifacts.find((a: any) => a.provider_key === "apollo");
  assert.equal(apolloArtifact.unit_type, "credit", "apollo artifact must use unitType=credit, not result");

  // ── Composite hash reproducibility ───────────────────────────────────────
  const { schedule } = buildCro03PriceScheduleFromArtifacts(artifacts as any);
  const recomputedHash = stableCro03RecipeHash(schedule);
  assert.equal(recomputedHash, first.snapshot.compositeHash, "recomputed hash must match the stored snapshot hash");

  const matchingSnapshotRow = (
    (await db.execute(sql`
      SELECT id, artifact_ids FROM mi09_pricing_schedule_snapshots
      WHERE composite_hash = ${recomputedHash} AND expires_at > NOW()
    `)) as any
  ).rows[0];
  assert.ok(matchingSnapshotRow, "an unexpired snapshot row must exist with the recomputed hash");
  const storedIds = (
    Array.isArray(matchingSnapshotRow.artifact_ids)
      ? matchingSnapshotRow.artifact_ids
      : JSON.parse(matchingSnapshotRow.artifact_ids)
  ).map(String).sort();
  const expectedIds = Object.values(first.artifactIds).map(String).sort();
  assert.deepEqual(storedIds, expectedIds, "snapshot artifact_ids must be exactly the 9 selected artifact IDs");

  // ── Second apply: full replay, no duplicates ─────────────────────────────
  const second = await applyOnce();
  for (const key of CRO03C_PROVIDER_KEYS) {
    assert.equal(second.reused[key], true, `expected ${key} artifact to be reused on replay`);
    assert.equal(second.artifactIds[key], first.artifactIds[key], `expected same artifact id for ${key} on replay`);
  }
  assert.equal(second.snapshot.reused, true, "expected snapshot to be reused on replay");
  assert.equal(second.snapshot.id, first.snapshot.id, "expected same snapshot id on replay");
  assert.equal(second.snapshot.compositeHash, first.snapshot.compositeHash, "expected same composite hash on replay");

  const countAfterSecond = (await getPricingArtifacts()).length;
  assert.equal(countAfterSecond, 9, `expected still exactly 9 artifacts after replay, got ${countAfterSecond}`);
  const snapshotCountAfterSecond = (
    (await db.execute(sql`SELECT COUNT(*)::int AS n FROM mi09_pricing_schedule_snapshots`)) as any
  ).rows[0].n;
  assert.equal(snapshotCountAfterSecond, 1, "expected still exactly 1 snapshot row after replay");

  // ── Expired-snapshot renewal: composite_hash is UNIQUE, so re-applying an
  // unchanged schedule after the prior snapshot's expiry must renew the
  // existing row in place, never fail on a uniqueness violation and never
  // leave two rows with the same hash. Must run BEFORE the repricing test
  // below, since repricing changes the latest apollo artifact and therefore
  // changes the composite schedule/hash out from under this exact-hash check. ──
  await db.execute(sql`
    UPDATE mi09_pricing_schedule_snapshots
       SET expires_at = NOW() - INTERVAL '1 hour'
     WHERE id = ${first.snapshot.id}
  `);
  const renewalApply = await createPricingScheduleSnapshot({ capturedBy: MI09_PRICING_CAPTURED_BY });
  assert.equal(renewalApply.reused, false, "an expired snapshot must not be reported as reused");
  assert.equal(renewalApply.renewed, true, "an expired snapshot with an identical hash must be renewed in place");
  assert.equal(renewalApply.id, first.snapshot.id, "renewal must reuse the same row id, not insert a second row");
  assert.equal(renewalApply.compositeHash, first.snapshot.compositeHash, "renewal must preserve the same composite hash");
  const snapshotRowCountAfterRenewal = (
    (await db.execute(sql`SELECT COUNT(*)::int AS n FROM mi09_pricing_schedule_snapshots WHERE composite_hash = ${first.snapshot.compositeHash}`)) as any
  ).rows[0].n;
  assert.equal(snapshotRowCountAfterRenewal, 1, "renewal must never leave two rows with the identical composite_hash");
  const renewedRow = (
    (await db.execute(sql`SELECT expires_at FROM mi09_pricing_schedule_snapshots WHERE id = ${first.snapshot.id}`)) as any
  ).rows[0];
  assert.ok(new Date(renewedRow.expires_at).getTime() > Date.now(), "renewed row's expires_at must be back in the future");

  // A further apply right after renewal (still unexpired) must report a plain reuse, not another renewal.
  const postRenewalApply = await createPricingScheduleSnapshot({ capturedBy: MI09_PRICING_CAPTURED_BY });
  assert.equal(postRenewalApply.reused, true, "a subsequent apply against an unexpired renewed row must be a plain reuse");
  assert.equal(postRenewalApply.renewed, false, "a plain reuse must not also report as a renewal");
  assert.equal(postRenewalApply.id, first.snapshot.id, "plain reuse after renewal must still be the same row id");

  // ── A real repricing (drift) inserts a NEW artifact version, never mutates ──
  const reprice = await reuseOrCreatePricingArtifact({
    providerKey: "apollo",
    unitType: "credit",
    amountMicros: 99999,
    currency: MI09_PRICING_CURRENCY,
    billingSemantics: "per_unit_no_result_free",
    capturedBy: MI09_PRICING_CAPTURED_BY,
    artifactVersion: MI09_PRICING_ARTIFACT_VERSION,
  });
  assert.equal(reprice.reused, false, "a genuinely different amountMicros must never be silently reused");
  assert.notEqual(reprice.id, first.artifactIds["apollo"], "repricing must insert a new row, not mutate the old one");
  const oldApolloStillExists = (
    (await db.execute(sql`SELECT amount_micros FROM mi09_pricing_artifacts WHERE id = ${first.artifactIds["apollo"]}`)) as any
  ).rows[0];
  assert.equal(Number(oldApolloStillExists.amount_micros), 25000, "the original apollo artifact row must be untouched");

  // ── Reprice-then-restore: the schedule hash covers VALUES only, not WHICH
  // artifact row backs each provider. Restoring apollo to the exact canonical
  // values (after the temporary reprice above) mints a THIRD apollo artifact
  // row whose fields match the original canonical row exactly, so the
  // recomputed composite hash equals the ORIGINAL (still-unexpired) snapshot's
  // hash — but the snapshot's stored artifact_ids must be reconciled to this
  // new row's id, not left pointing at the first (now-superseded) apollo id. ──
  const restore = await reuseOrCreatePricingArtifact({
    providerKey: "apollo",
    unitType: "credit",
    amountMicros: 25000,
    currency: MI09_PRICING_CURRENCY,
    billingSemantics: "per_unit_no_result_free",
    capturedBy: MI09_PRICING_CAPTURED_BY,
    artifactVersion: MI09_PRICING_ARTIFACT_VERSION,
  });
  assert.equal(restore.reused, false, "restoring canonical values after a reprice must mint a new row, not reuse the stale one");
  assert.notEqual(restore.id, first.artifactIds["apollo"], "restored row must be a new id, distinct from the original pre-reprice artifact");
  assert.notEqual(restore.id, reprice.id, "restored row must be a new id, distinct from the temporary repriced artifact");

  const restoredSnapshot = await createPricingScheduleSnapshot({ capturedBy: MI09_PRICING_CAPTURED_BY });
  assert.equal(restoredSnapshot.compositeHash, first.snapshot.compositeHash, "restoring canonical values must reproduce the original composite hash");
  assert.equal(restoredSnapshot.reused, true, "the still-unexpired original snapshot row must be reused by hash, not duplicated");
  assert.equal(restoredSnapshot.id, first.snapshot.id, "reuse must be the same snapshot row, not a new one");
  assert.ok(
    restoredSnapshot.artifactIds.includes(restore.id) && !restoredSnapshot.artifactIds.includes(first.artifactIds["apollo"]),
    "returned artifactIds must reference the freshly-restored apollo artifact id, not the stale original one",
  );

  const persistedSnapshotRow = (
    (await db.execute(sql`SELECT artifact_ids FROM mi09_pricing_schedule_snapshots WHERE id = ${first.snapshot.id}`)) as any
  ).rows[0];
  const persistedIds = (
    Array.isArray(persistedSnapshotRow.artifact_ids) ? persistedSnapshotRow.artifact_ids : JSON.parse(persistedSnapshotRow.artifact_ids)
  ).map(String);
  assert.ok(
    persistedIds.includes(restore.id),
    "the snapshot row's PERSISTED artifact_ids column must be reconciled to the freshly-restored artifact id (not just the in-memory return value)",
  );
  assert.ok(
    !persistedIds.includes(first.artifactIds["apollo"]),
    "the snapshot row's PERSISTED artifact_ids column must no longer reference the stale, superseded apollo artifact id",
  );

  assert.equal(networkCallsObserved, 0, `expected zero provider transport, observed ${networkCallsObserved} fetch call(s)`);

  console.log("MI-09 pricing seed integration certification: PASS");
  console.log(`  9 artifacts created + reused correctly across replay`);
  console.log(`  1 snapshot created + reused correctly, composite_hash=${first.snapshot.compositeHash}`);
  console.log(`  repricing correctly inserted a new artifact version (id=${reprice.id}) instead of mutating`);
  console.log(`  expired snapshot correctly renewed in place (no uniqueness violation, no duplicate row)`);
  console.log(`  reprice-then-restore correctly reconciled persisted snapshot artifact_ids to the current latest artifacts`);
  console.log(`  zero provider transport observed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MI-09 pricing seed integration certification: FAIL");
    console.error(err);
    process.exit(1);
  });
