#!/usr/bin/env npx tsx
/**
 * test-seed-convergence-verifier-integrity.ts (Task #1750 code-review follow-up)
 *
 * A health check that only confirms "a row exists" is not a health check —
 * it can stay green after the canonical row is deleted or silently replaced
 * with non-canonical content. This test proves verifyProductionSeedConvergence
 * actually goes "unexpected" (the CRITICAL_CHECKS trigger condition in
 * health-monitor.ts, and the same status surfaced by admin.ts's
 * /api/admin/live-health, since both call this one function) when each
 * tightened canonical target is deleted or substituted, not just when it is
 * entirely absent.
 *
 * Every mutation this script makes is captured beforehand and restored in a
 * finally block, so it is safe to run against a real dev database that
 * already converged its canonical seed rows.
 *
 * Exits 0 on pass, 1 on any assertion failure.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { verifyProductionSeedConvergence } from "../server/services/production-seed-convergence";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

function findTarget(report: Awaited<ReturnType<typeof verifyProductionSeedConvergence>>, id: string) {
  return report.results.find((r) => r.id === id);
}

async function main(): Promise<number> {
  const failures: string[] = [];

  // Baseline: with an unmutated dev DB (already converged at startup), every
  // tightened target should read already_present. If this fails, the DB
  // itself isn't in the expected converged state and the rest of this test
  // (which relies on being able to detect a *regression* from that baseline)
  // cannot mean anything.
  const baseline = await verifyProductionSeedConvergence();
  for (const id of ["cro02_purpose_policies", "cro03a_policy_bootstrap", "cro03_staging_recipes", "cr04_qualification_policies", "commercial_graph_revisions_backfill"]) {
    const r = findTarget(baseline, id);
    if (!r || r.outcome !== "already_present") {
      failures.push(`baseline: expected ${id} already_present, got ${r?.outcome ?? "MISSING"} (${r?.detail ?? "n/a"}) — dev DB is not in the expected converged state, cannot run regression checks`);
    }
  }
  if (failures.length > 0) {
    console.error("[test-seed-convergence-verifier-integrity] FAIL at baseline:");
    for (const f of failures) console.error(`  ${f}`);
    return 1;
  }

  // 1. CRO-02: delete one canonical shadow-mode purpose-policy row entirely.
  // commercial_purpose_policies carries its own BEFORE UPDATE/DELETE
  // immutability trigger (cro02_purpose_policy_immutable) that normally
  // makes this deletion impossible from application code — this test
  // briefly disables it (table-owner privilege, not superuser) purely to
  // prove the READ-SIDE verifier query independently detects the row's
  // absence, restoring both the trigger and the row in the finally block.
  const deletedCro02 = rows(await db.execute(sql`
    SELECT * FROM commercial_purpose_policies WHERE mode = 'shadow' LIMIT 1
  `))[0];
  if (!deletedCro02) failures.push("CRO-02: no canonical shadow row found in dev DB to test deletion detection with");
  else {
    await db.execute(sql`ALTER TABLE commercial_purpose_policies DISABLE TRIGGER cro02_purpose_policy_immutable`);
    try {
      await db.execute(sql`DELETE FROM commercial_purpose_policies WHERE purpose = ${deletedCro02.purpose} AND policy_version = ${deletedCro02.policy_version} AND mode = 'shadow'`);
      const report = await verifyProductionSeedConvergence();
      const r = findTarget(report, "cro02_purpose_policies");
      if (r?.outcome !== "unexpected") failures.push(`CRO-02 deletion: expected unexpected, got ${r?.outcome} (${r?.detail})`);
    } finally {
      await db.execute(sql`
        INSERT INTO commercial_purpose_policies (${sql.raw(Object.keys(deletedCro02).map((c) => `"${c}"`).join(", "))})
        VALUES (${sql.join(Object.values(deletedCro02).map((v) => sql`${v}`), sql`, `)})
      `);
      await db.execute(sql`ALTER TABLE commercial_purpose_policies ENABLE TRIGGER cro02_purpose_policy_immutable`);
    }
  }

  // 2. CRO-03A: point the active control at a non-canonical policy_key/version
  // (substitution, not deletion) — the exact "row still present but wrong
  // content" case a bare truthy-pointer check would miss.
  const before2 = rows(await db.execute(sql`SELECT active_policy_id FROM cro03a_policy_control WHERE id = 1`))[0];
  const bogusDocId = rows(await db.execute(sql`
    INSERT INTO cro03a_policy_documents (policy_key, version, policy, policy_hash, status)
    SELECT 'not_the_canonical_policy', 999, policy, policy_hash, 'draft' FROM cro03a_policy_documents LIMIT 1
    RETURNING id
  `))[0]?.id;
  try {
    if (bogusDocId) {
      await db.execute(sql`UPDATE cro03a_policy_control SET active_policy_id = ${bogusDocId} WHERE id = 1`);
      const report = await verifyProductionSeedConvergence();
      const r = findTarget(report, "cro03a_policy_bootstrap");
      if (r?.outcome !== "unexpected") failures.push(`CRO-03A substitution: expected unexpected, got ${r?.outcome} (${r?.detail})`);
    } else {
      failures.push("CRO-03A: could not create a substitute policy document fixture to test with");
    }
  } finally {
    if (before2?.active_policy_id != null) {
      await db.execute(sql`UPDATE cro03a_policy_control SET active_policy_id = ${before2.active_policy_id} WHERE id = 1`);
    }
    if (bogusDocId) {
      await db.execute(sql`ALTER TABLE cro03a_policy_documents DISABLE TRIGGER cro03a_policy_documents_immutable`);
      await db.execute(sql`DELETE FROM cro03a_policy_documents WHERE id = ${bogusDocId}`);
      await db.execute(sql`ALTER TABLE cro03a_policy_documents ENABLE TRIGGER cro03a_policy_documents_immutable`);
    }
  }

  // 3. CRO-03 staging recipe: corrupt the content hash on the canonical row
  // in place (still present, still same key, wrong content). This table is
  // also guarded by its own BEFORE UPDATE/DELETE immutability trigger
  // (cro03_staging_recipe_immutable) — briefly disabled the same way as #1.
  const before3 = rows(await db.execute(sql`SELECT recipe_hash FROM cro03_staging_recipes WHERE recipe_key = 'south_florida_staging' AND version = 1`))[0];
  if (!before3) failures.push("CRO-03 recipe: canonical row not present in dev DB, cannot test tamper detection");
  else {
    await db.execute(sql`ALTER TABLE cro03_staging_recipes DISABLE TRIGGER cro03_staging_recipe_immutable`);
    try {
      // recipe_hash has a `^[0-9a-f]{64}$` check constraint, so the tampered
      // value must still be well-formed hex — just a different 64-char value
      // than the canonical hash, which is what a real content substitution
      // would look like.
      const tamperedHash = "0".repeat(64);
      await db.execute(sql`UPDATE cro03_staging_recipes SET recipe_hash = ${tamperedHash} WHERE recipe_key = 'south_florida_staging' AND version = 1`);
      const report = await verifyProductionSeedConvergence();
      const r = findTarget(report, "cro03_staging_recipes");
      if (r?.outcome !== "unexpected") failures.push(`CRO-03 recipe tamper: expected unexpected, got ${r?.outcome} (${r?.detail})`);
    } finally {
      await db.execute(sql`UPDATE cro03_staging_recipes SET recipe_hash = ${before3.recipe_hash} WHERE recipe_key = 'south_florida_staging' AND version = 1`);
      await db.execute(sql`ALTER TABLE cro03_staging_recipes ENABLE TRIGGER cro03_staging_recipe_immutable`);
    }
  }

  // 4. CR-04: mutate the policy document jsonb content (same version/status,
  // different payload) — a status-only check would miss this.
  const before4 = rows(await db.execute(sql`SELECT document FROM cr04_qualification_policies WHERE version = 1`))[0];
  try {
    if (before4) {
      await db.execute(sql`UPDATE cr04_qualification_policies SET document = '{"tampered": true}'::jsonb WHERE version = 1`);
      const report = await verifyProductionSeedConvergence();
      const r = findTarget(report, "cr04_qualification_policies");
      if (r?.outcome !== "unexpected") failures.push(`CR-04 document tamper: expected unexpected, got ${r?.outcome} (${r?.detail})`);
    } else {
      failures.push("CR-04: canonical v1 policy not present in dev DB, cannot test tamper detection");
    }
  } finally {
    if (before4) await db.execute(sql`UPDATE cr04_qualification_policies SET document = ${JSON.stringify(before4.document)}::jsonb WHERE version = 1`);
  }

  // 5. commercial_membership_revisions: delete one existing revision row and
  // confirm the previously-blind health check now reports it missing (this
  // is the gap the code review specifically flagged — the old verifier only
  // ever queried commercial_subject_revisions).
  const deletedMembership = rows(await db.execute(sql`
    DELETE FROM commercial_membership_revisions
    WHERE ctid = (SELECT ctid FROM commercial_membership_revisions LIMIT 1)
    RETURNING *
  `))[0];
  try {
    if (deletedMembership) {
      const report = await verifyProductionSeedConvergence();
      const r = findTarget(report, "commercial_graph_revisions_backfill");
      if (r?.outcome !== "unexpected" || !/membership/.test(r?.detail ?? "")) {
        failures.push(`membership revision deletion: expected unexpected mentioning a missing membership revision, got ${r?.outcome} (${r?.detail})`);
      }
    } else {
      failures.push("commercial_membership_revisions: no existing row to delete for this test");
    }
  } finally {
    if (deletedMembership) {
      await db.execute(sql`
        INSERT INTO commercial_membership_revisions (${sql.raw(Object.keys(deletedMembership).map((c) => `"${c}"`).join(", "))})
        VALUES (${sql.join(Object.values(deletedMembership).map((v) => sql`${v}`), sql`, `)})
      `);
    }
  }

  // Final: confirm everything is restored to already_present (proves the
  // restore steps above actually put things back, not just that detection
  // worked mid-test).
  const after = await verifyProductionSeedConvergence();
  for (const id of ["cro02_purpose_policies", "cro03a_policy_bootstrap", "cro03_staging_recipes", "cr04_qualification_policies", "commercial_graph_revisions_backfill"]) {
    const r = findTarget(after, id);
    if (!r || r.outcome !== "already_present") {
      failures.push(`restore: expected ${id} back to already_present, got ${r?.outcome} (${r?.detail})`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[test-seed-convergence-verifier-integrity] FAIL — ${failures.length} assertion(s):`);
    for (const f of failures) console.error(`  FAIL ${f}`);
    return 1;
  }
  console.log("[test-seed-convergence-verifier-integrity] PASS — verifier correctly detects deletion/substitution of every tightened canonical target, and restore leaves state clean.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[test-seed-convergence-verifier-integrity] FATAL:", err);
    process.exit(1);
  });
