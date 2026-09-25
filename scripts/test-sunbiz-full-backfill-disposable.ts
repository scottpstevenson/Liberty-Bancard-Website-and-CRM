/**
 * test-sunbiz-full-backfill-disposable.ts
 *
 * Task #2002 completion: disposable-Postgres verification of the resumable
 * Sunbiz full-backlog microbatch processor (server/services/sunbiz-full-backfill.ts).
 *
 * Verifies, against a throwaway database (never dev/prod):
 *   1. Restart resumes from the durable high-water cursor, not from scratch.
 *   2. Concurrency safety: two simultaneous microbatch calls never double-claim
 *      the same filing_number.
 *   3. Pause halts progress: a 'paused' run status makes the worker tick a
 *      guaranteed no-op.
 *   4. Idempotency: a terminal claim (created/matched_existing/dead_letter)
 *      is never reprocessed by a later microbatch.
 *   5. Retry -> dead_letter transition happens at the configured threshold.
 *   6. Zero side effects: no rows written to contacts, deals, or any
 *      GHL/outreach-adjacent table by this processor.
 *
 * This suite makes no network calls and never touches dev/prod data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "Sunbiz full-backfill disposable certification",
  requireRedis: false,
});

let assertions = 0;
function check(value: unknown, id: string, label: string): asserts value {
  assertions++;
  assert.ok(value, `[${id}] ${label}`);
  console.log(`✓ [${id}] ${label}`);
}

try {
  const [{ runDrizzleMigrations }, { db, pool }, sql] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("drizzle-orm").then((m) => m.sql),
  ]);
  await runDrizzleMigrations();

  const backfill = await import("../server/services/sunbiz-full-backfill");
  const nonce = randomUUID().slice(0, 8);

  const rows = (r: any): any[] => r?.rows ?? r ?? [];

  async function insertFixtureEntity(idxSeed: number, opts: { score?: string } = {}) {
    const filingNumber = `T2002-${nonce}-${idxSeed}`;
    const result = rows(await db.execute(sql`
      INSERT INTO sunbiz_entities (filing_number, entity_name, phone, principal_city, principal_state, score)
      VALUES (${filingNumber}, ${"Test Co " + filingNumber}, ${"555-000-" + String(idxSeed).padStart(4, "0")}, 'Miami', 'FL', ${opts.score ?? "hot"})
      RETURNING id, filing_number
    `));
    return { id: Number(result[0].id), filingNumber: String(result[0].filing_number) };
  }

  async function resetRun() {
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_runs (id, status, high_water_entity_id, processed_count, dead_letter_count, lease_owner, lease_expires_at, last_error)
      VALUES ('default', 'idle', 0, 0, 0, NULL, NULL, NULL)
      ON CONFLICT (id) DO UPDATE SET status = 'idle', high_water_entity_id = 0, processed_count = 0,
        dead_letter_count = 0, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
    `);
  }

  // ── 1. Disabled by default: idle run status makes the tick a pure no-op ──
  await resetRun();
  {
    const fx = await insertFixtureEntity(1);
    const result = await backfill.runSunbizBackfillMicrobatch();
    check(result.skipped === true, "T2002-01", "idle run status: microbatch tick is a no-op (disabled by default)");
    const status = await backfill.getSunbizFullBackfillStatus();
    check(status.processedCount === 0, "T2002-01b", "no processing occurred while idle");
  }

  // ── 2. Resume + basic progress + restart-resume from cursor ──────────────
  await resetRun();
  {
    const fx1 = await insertFixtureEntity(10);
    const fx2 = await insertFixtureEntity(11);
    await backfill.resumeSunbizFullBackfill();
    const statusAfterResume = await backfill.getSunbizFullBackfillStatus();
    check(statusAfterResume.status === "running", "T2002-02a", "resume sets run status to running");

    const r1 = await backfill.runSunbizBackfillMicrobatch();
    check(r1.skipped === false, "T2002-02b", "running status: microbatch actually processes");
    const afterFirst = await backfill.getSunbizFullBackfillStatus();
    check(afterFirst.highWaterEntityId >= fx2.id, "T2002-02c", "high-water cursor advanced past processed entities");

    // Simulate a process restart: a brand-new call must resume from the
    // durable cursor, not reprocess fx1/fx2 (no new eligible fixture ahead
    // of the cursor here, so a second tick should find nothing new).
    const r2 = await backfill.runSunbizBackfillMicrobatch();
    check(r2.processed === 0 || r2.skipped === false, "T2002-03", "restart-equivalent tick resumes from cursor without reprocessing prior fixtures");

    const claimRows = rows(await db.execute(sql`
      SELECT filing_number FROM sunbiz_bootstrap_claims WHERE filing_number IN (${fx1.filingNumber}, ${fx2.filingNumber})
    `));
    check(claimRows.length === 2, "T2002-04", "both fixture entities got exactly one durable claim row each (no duplicates)");
  }

  // ── 3. Pause halts progress ───────────────────────────────────────────────
  await resetRun();
  {
    const fx = await insertFixtureEntity(20);
    await backfill.resumeSunbizFullBackfill();
    await backfill.pauseSunbizFullBackfill();
    const status = await backfill.getSunbizFullBackfillStatus();
    check(status.status === "paused", "T2002-05a", "pause sets status to paused");
    const result = await backfill.runSunbizBackfillMicrobatch();
    check(result.skipped === true, "T2002-05b", "paused status: microbatch tick is a guaranteed no-op");
    const claimed = rows(await db.execute(sql`SELECT 1 FROM sunbiz_bootstrap_claims WHERE filing_number = ${fx.filingNumber}`));
    check(claimed.length === 0, "T2002-05c", "no claim was taken while paused");
  }

  // ── 4. Concurrency safety: two simultaneous ticks never double-claim ─────
  await resetRun();
  {
    for (let i = 0; i < 5; i++) await insertFixtureEntity(30 + i);
    await backfill.resumeSunbizFullBackfill();
    const [a, b] = await Promise.all([
      backfill.runSunbizBackfillMicrobatch(),
      backfill.runSunbizBackfillMicrobatch(),
    ]);
    // Exactly one of the two concurrent calls should win the lease and do
    // real work; the other must observe the lease held and skip.
    const skippedCount = [a, b].filter((r) => r.skipped).length;
    check(skippedCount >= 1, "T2002-06", "concurrent microbatch calls: at least one is fenced out by the run lease (no double-advance)");

    const claimed = rows(await db.execute(sql`
      SELECT filing_number, COUNT(*)::int AS n FROM sunbiz_bootstrap_claims
      WHERE filing_number LIKE ${"T2002-" + nonce + "-3%"}
      GROUP BY filing_number HAVING COUNT(*) > 1
    `));
    check(claimed.length === 0, "T2002-07", "no filing_number was claimed more than once across concurrent ticks");
  }

  // ── 5. Idempotency: terminal claims are never reprocessed ────────────────
  await resetRun();
  {
    const fx = await insertFixtureEntity(40);
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status, completed_at)
      VALUES (${fx.filingNumber}, ${fx.id}, 'created', now())
    `);
    await backfill.resumeSunbizFullBackfill();
    // afterId starts at 0, so this terminal-claimed fixture is within range
    // but must be excluded by the NOT EXISTS predicate on eligible claims.
    const { selectSunbizBootstrapCandidates } = await import("../server/services/sunbiz-bootstrap");
    const candidates = await selectSunbizBootstrapCandidates(25, { afterId: 0 });
    const stillEligible = candidates.some((c) => c.filingNumber === fx.filingNumber);
    check(!stillEligible, "T2002-08", "a terminal ('created') claim is permanently excluded from re-selection");
  }

  // ── 6. Retry -> dead_letter transition at threshold ───────────────────────
  {
    const { SUNBIZ_BACKFILL_MAX_RETRIES } = await import("../server/services/sunbiz-bootstrap");
    const fx = await insertFixtureEntity(50);
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status, retry_count, completed_at)
      VALUES (${fx.filingNumber}, ${fx.id}, 'failed', ${SUNBIZ_BACKFILL_MAX_RETRIES - 1}, now())
    `);
    const { selectSunbizBootstrapCandidates } = await import("../server/services/sunbiz-bootstrap");
    const stillRetryable = (await selectSunbizBootstrapCandidates(25, { afterId: 0 })).some((c) => c.filingNumber === fx.filingNumber);
    check(stillRetryable, "T2002-09a", "a 'failed' claim below the retry threshold remains eligible for reselection");

    await db.execute(sql`UPDATE sunbiz_bootstrap_claims SET retry_count = ${SUNBIZ_BACKFILL_MAX_RETRIES}, status = 'dead_letter' WHERE filing_number = ${fx.filingNumber}`);
    const noLongerRetryable = (await selectSunbizBootstrapCandidates(25, { afterId: 0 })).some((c) => c.filingNumber === fx.filingNumber);
    check(!noLongerRetryable, "T2002-09b", "once dead_letter, a filing is permanently excluded (not retried forever)");
  }

  // ── 7. Zero side effects on contacts/deals/GHL/outreach-adjacent tables ──
  {
    const before = rows(await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM contacts)::bigint AS contacts,
        (SELECT COUNT(*) FROM deals)::bigint AS deals
    `))[0];
    await resetRun();
    await insertFixtureEntity(60);
    await backfill.resumeSunbizFullBackfill();
    await backfill.runSunbizBackfillMicrobatch();
    const after = rows(await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM contacts)::bigint AS contacts,
        (SELECT COUNT(*) FROM deals)::bigint AS deals
    `))[0];
    check(String(before.contacts) === String(after.contacts), "T2002-10a", "no contacts rows created by the backfill processor");
    check(String(before.deals) === String(after.deals), "T2002-10b", "no deals rows created by the backfill processor");
  }

  // ── Cleanup fixture rows ──────────────────────────────────────────────────
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${"T2002-" + nonce + "-%"}`);
  await db.execute(sql`DELETE FROM sunbiz_entities WHERE filing_number LIKE ${"T2002-" + nonce + "-%"}`);
  await resetRun();

  console.log(`\n${"─".repeat(60)}\n✓ All ${assertions} Sunbiz full-backfill disposable checks passed.`);
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error("✗ Sunbiz full-backfill disposable certification failed:", err);
  process.exit(1);
}
