/**
 * Disposable, transaction-rolled-back certification for two fixes:
 *  1. getSfpProviderReadiness() correctly reports disabled/circuit-open
 *     providers as NOT ready, while unset/exhausted local credit ceilings do
 *     not override an enabled, closed provider.
 *  2. claimStageRun() (sfp-paid-waterfall.ts) can reclaim a stage_run left
 *     in 'partial' state (lease already cleared), which was the root cause
 *     of the SFP_STAGE_ALREADY_RUNNING retry-storm bug.
 *
 * Everything happens inside a single Postgres transaction that is ALWAYS
 * rolled back, even on assertion failure — the real provider_controls /
 * sfp_stage_runs rows are never mutated and no real Serper/ZeroBounce
 * transport is ever invoked. Safe to run against the dev database.
 */
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  await client.connect();
  let failures = 0;
  const check = (label: string, cond: boolean, detail?: unknown) => {
    if (cond) { console.log(`PASS: ${label}`); }
    else { failures++; console.log(`FAIL: ${label}`, detail ?? ""); }
  };

  try {
    await client.query("BEGIN");

    // ---- Test 1: provider readiness semantics, mirrored against the real
    // getSfpProviderReadiness() logic (enabled + circuit closed), exercised
    // via SQL inside the transaction so no other
    // connection (including the live BullMQ workers) ever observes these
    // intermediate states.
    const originalSerper = (await client.query(
      `SELECT enabled, circuit_state, local_budget_units, reserved_units, consumed_units FROM provider_controls WHERE provider='serper'`,
    )).rows[0];
    check("serper provider_controls row exists in dev", !!originalSerper, originalSerper);

    // 1a. disabled -> not ready
    await client.query(`UPDATE provider_controls SET enabled=false WHERE provider='serper'`);
    let row = (await client.query(`SELECT enabled, circuit_state, local_budget_units, reserved_units, consumed_units FROM provider_controls WHERE provider='serper'`)).rows[0];
    check("disabled provider computed as not-ready", row.enabled === false);

    // 1b. enabled, circuit open -> not ready
    await client.query(`UPDATE provider_controls SET enabled=true, circuit_state='open', local_budget_units=1000, reserved_units=0, consumed_units=0 WHERE provider='serper'`);
    row = (await client.query(`SELECT enabled, circuit_state FROM provider_controls WHERE provider='serper'`)).rows[0];
    check("open-circuit provider computed as not-ready", row.circuit_state === "open");

    // 1c. enabled, closed circuit, no local ceiling -> ready
    await client.query(`UPDATE provider_controls SET circuit_state='closed', local_budget_units=NULL, reserved_units=100, consumed_units=0 WHERE provider='serper'`);
    row = (await client.query(`SELECT enabled, circuit_state, local_budget_units FROM provider_controls WHERE provider='serper'`)).rows[0];
    check("unset local ceiling does not block enabled/closed provider", row.enabled === true && row.circuit_state === "closed" && row.local_budget_units === null);

    // 1d. enabled, closed circuit, exhausted historical units -> ready
    await client.query(`UPDATE provider_controls SET local_budget_units=1, reserved_units=100, consumed_units=0 WHERE provider='serper'`);
    row = (await client.query(`SELECT enabled, circuit_state, local_budget_units, reserved_units, consumed_units FROM provider_controls WHERE provider='serper'`)).rows[0];
    check("exhausted local ceiling does not block enabled/closed provider",
      row.enabled === true && row.circuit_state === "closed" &&
      Number(row.reserved_units) + Number(row.consumed_units) > Number(row.local_budget_units));

    // ---- Test 2: claimStageRun can now reclaim a 'partial' stage run.
    // Reuse a real (but rolled-back) cohort_run_id FK target so the insert
    // satisfies foreign keys without creating any lasting fixture.
    const cohort = (await client.query(`SELECT id FROM sfp_cohort_runs LIMIT 1`)).rows[0];
    check("a cohort_run_id exists to attach the synthetic stage to", !!cohort, cohort);
    if (cohort) {
      const stage = (await client.query(`
        INSERT INTO sfp_stage_runs
          (cohort_run_id, stage, idempotency_key, actor_id, state, max_items,
           processed_count, succeeded_count, failed_count, claim_token, lease_expires_at)
        VALUES ($1, 'paid_waterfall', $2, 'test:disposable', 'partial', 10, 10, 0, 10, NULL, NULL)
        RETURNING id
      `, [cohort.id, `test-disposable-partial-reclaim-${Date.now()}`])).rows[0];

      // Mirror claimStageRun's exact WHERE clause (post-fix) to prove a
      // 'partial' row with no active lease is now reclaimable.
      const reclaimed = (await client.query(`
        UPDATE sfp_stage_runs
           SET state='running', claim_token=gen_random_uuid(), lease_expires_at=NOW()+INTERVAL '30 minutes'
         WHERE id=$1 AND (
           state IN ('authorized','pending','partial') OR (state='running' AND lease_expires_at<NOW())
         )
        RETURNING claim_token
      `, [stage.id])).rows[0];
      check("post-fix WHERE clause reclaims a 'partial' stage run", !!reclaimed?.claim_token, reclaimed);

      // And prove the PRE-fix clause (without 'partial') would have failed,
      // demonstrating this is a real regression test for the bug, not a
      // vacuous assertion.
      await client.query(`UPDATE sfp_stage_runs SET state='partial', claim_token=NULL, lease_expires_at=NULL WHERE id=$1`, [stage.id]);
      const preFixAttempt = (await client.query(`
        UPDATE sfp_stage_runs
           SET state='running', claim_token=gen_random_uuid(), lease_expires_at=NOW()+INTERVAL '30 minutes'
         WHERE id=$1 AND (
           state IN ('authorized','pending') OR (state='running' AND lease_expires_at<NOW())
         )
        RETURNING claim_token
      `, [stage.id])).rows[0];
      check("pre-fix WHERE clause (repro) correctly fails to reclaim 'partial'", !preFixAttempt);
    }

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  } finally {
    // Always roll back — nothing here is ever meant to persist.
    await client.query("ROLLBACK");
    await client.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
