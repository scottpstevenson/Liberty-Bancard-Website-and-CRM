#!/usr/bin/env npx tsx
/**
 * scripts/test-paid-provider-controls-convergence.ts
 *
 * Corrective item 6 (Task #1971 continuation): production is missing the 5
 * disabled provider_controls rows migrations/0269_paid_provider_controls_all.sql
 * seeds (serper, outscraper, openai, apollo, zerobounce) because Replit
 * Publish never replays a migration's imperative INSERT (see
 * .agents/memory/production-schema-ownership.md). This asserts the new
 * "paid_provider_controls" convergence target in
 * server/services/production-seed-convergence.ts actually repairs that gap.
 *
 * The real 5 providers have live provider_observations (and other) FK
 * dependents in every environment that has ever run a discovery/enrichment
 * cycle, so this test cannot safely delete-and-restore those specific rows
 * in a shared dev DB. Instead:
 *   - Part A exercises the exported, parameterized convergeProviderControlRows()
 *     helper — the exact function the real target delegates to — against 5
 *     synthetic, FK-safe provider names, covering: full insert, idempotent
 *     re-run, operator-enabled-row preservation, and partial-gap repair.
 *   - Part B verifies the real registered "paid_provider_controls" target
 *     uses the exact 5 real provider names + capabilities from migration
 *     0269 (read-only: runs the real target and asserts it reports
 *     already_present for all 5 without mutating anything, since a healthy
 *     dev DB already has them from either the migration or a prior repair).
 *
 * No provider I/O, no worker activation.
 *
 * Usage: npx tsx scripts/test-paid-provider-controls-convergence.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

const runTag = `test-frzp-ppc-${Date.now()}`;
const SYNTHETIC_PROVIDERS = [1, 2, 3, 4, 5].map((n) => `${runTag}-p${n}`);
const SYNTHETIC_SEED_ROWS = SYNTHETIC_PROVIDERS.map((provider, i) => ({ provider, capability: `${runTag}-capability-${i}` }));

const REAL_PROVIDERS = ["serper", "outscraper", "openai", "apollo", "zerobounce"];
const REAL_EXPECTED_CAPABILITIES: Record<string, string> = {
  serper: "business_discovery",
  outscraper: "business_discovery",
  openai: "cro03_classification",
  apollo: "contact_enrichment",
  zerobounce: "email_validation",
};

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("\n=== Corrective item 6: production control-row convergence for paid providers ===\n");

  const { SEED_TARGETS, convergeProviderControlRows } = await import("../server/services/production-seed-convergence");

  try {
    // ── Part A: synthetic, FK-safe providers exercising the real logic ─────
    const result1 = await convergeProviderControlRows(`${runTag}-target`, SYNTHETIC_SEED_ROWS);
    ok("first run outcome is 'inserted'", result1.outcome === "inserted", result1.outcome);

    const after1 = rows(await db.execute(sql`
      SELECT provider, capability, enabled, circuit_state FROM provider_controls
      WHERE provider = ANY(ARRAY[${sql.join(SYNTHETIC_PROVIDERS.map((p) => sql`${p}`), sql`, `)}])
    `));
    ok("all 5 rows now exist", after1.length === 5, `found ${after1.length}`);
    ok("all 5 rows are disabled (enabled=false)", after1.every((r) => r.enabled === false));
    ok("all 5 rows have circuit_state='closed'", after1.every((r) => r.circuit_state === "closed"));
    ok(
      "every row's capability matches the seed mapping",
      after1.every((r) => r.capability === SYNTHETIC_SEED_ROWS.find((s) => s.provider === r.provider)?.capability),
    );

    // Re-run is a no-op.
    const result2 = await convergeProviderControlRows(`${runTag}-target`, SYNTHETIC_SEED_ROWS);
    ok("second run outcome is 'already_present'", result2.outcome === "already_present", result2.outcome);

    // Operator enables one provider — convergence must never revert it.
    await db.execute(sql`UPDATE provider_controls SET enabled = TRUE, version = version + 1 WHERE provider = ${SYNTHETIC_PROVIDERS[0]}`);
    const result3 = await convergeProviderControlRows(`${runTag}-target`, SYNTHETIC_SEED_ROWS);
    ok("run after an operator-enabled row is still 'already_present' (no re-insert attempted)", result3.outcome === "already_present", result3.outcome);
    const enabledRow = rows(await db.execute(sql`SELECT enabled FROM provider_controls WHERE provider = ${SYNTHETIC_PROVIDERS[0]}`))[0];
    ok("operator-enabled row is untouched by convergence (still enabled=true)", enabledRow?.enabled === true);

    // Partial gap: delete 2 of 5 (not the operator-enabled one), rest must survive untouched.
    await db.execute(sql`DELETE FROM provider_controls WHERE provider IN (${SYNTHETIC_PROVIDERS[3]}, ${SYNTHETIC_PROVIDERS[4]})`);
    const result4 = await convergeProviderControlRows(`${runTag}-target`, SYNTHETIC_SEED_ROWS);
    ok("partial-gap run outcome is 'inserted'", result4.outcome === "inserted", result4.outcome);
    ok(
      "partial-gap detail names exactly the 2 missing providers",
      (result4.detail ?? "").includes(SYNTHETIC_PROVIDERS[3]) && (result4.detail ?? "").includes(SYNTHETIC_PROVIDERS[4]),
      result4.detail,
    );
    const after4 = rows(await db.execute(sql`
      SELECT provider, enabled FROM provider_controls
      WHERE provider = ANY(ARRAY[${sql.join(SYNTHETIC_PROVIDERS.map((p) => sql`${p}`), sql`, `)}])
    `));
    ok("all 5 rows exist again after partial-gap repair", after4.length === 5, `found ${after4.length}`);
    const enabledAfter4 = after4.find((r) => r.provider === SYNTHETIC_PROVIDERS[0]);
    ok("operator-enabled row survived the partial-gap repair", enabledAfter4?.enabled === true);
    const reinsertedAfter4 = after4.find((r) => r.provider === SYNTHETIC_PROVIDERS[3]);
    ok("newly re-inserted row is disabled by default", reinsertedAfter4?.enabled === false);
  } finally {
    await db.execute(sql`DELETE FROM provider_controls WHERE provider = ANY(ARRAY[${sql.join(SYNTHETIC_PROVIDERS.map((p) => sql`${p}`), sql`, `)}])`);
  }

  // ── Part B: real registered target wiring, read-only against live rows ──
  const realTarget = SEED_TARGETS.find((t) => t.id === "paid_provider_controls");
  ok("paid_provider_controls target is registered in SEED_TARGETS", !!realTarget);
  if (realTarget) {
    const preExisting = rows(await db.execute(sql`
      SELECT provider, capability FROM provider_controls
      WHERE provider = ANY(ARRAY[${sql.join(REAL_PROVIDERS.map((p) => sql`${p}`), sql`, `)}])
    `));
    const preExistingSet = new Set(preExisting.map((r: any) => String(r.provider)));
    const allRealProvidersAlreadyPresent = REAL_PROVIDERS.every((p) => preExistingSet.has(p));
    ok(
      "this dev DB already has all 5 real paid-provider control rows (from the migration or a prior convergence run)",
      allRealProvidersAlreadyPresent,
      `present: ${[...preExistingSet].join(", ")}`,
    );
    if (allRealProvidersAlreadyPresent) {
      ok(
        "every real row's capability matches migration 0269's mapping",
        preExisting.every((r: any) => r.capability === REAL_EXPECTED_CAPABILITIES[r.provider]),
      );
      const realResult = await realTarget.write();
      ok("running the real target against live data is a safe no-op ('already_present')", realResult.outcome === "already_present", realResult.outcome);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
