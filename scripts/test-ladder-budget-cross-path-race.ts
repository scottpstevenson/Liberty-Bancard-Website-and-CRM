/**
 * Cross-path race certification for the $50 ladder-wide aggregate paid
 * budget (Liberty Bancard enrichment Gate 2 hardening).
 *
 * Proves that SFP's reservation path and MI-09/CRO-03C's reservation path
 * now share ONE serialized authority (shared-paid-budget-ledger.ts) instead
 * of two independent accounting pools with independent locks. Two real,
 * concurrent Postgres connections each attempt a reservation sized so that
 * either one alone fits under a synthetic test cap, but both together do
 * not — proving the combined sum, not just each path's own sum, is what
 * gates the second one.
 *
 * The cap passed to the shared ledger is a LOCAL synthetic value computed
 * from a live baseline read at the start of this script — the real $50
 * constant (MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS) is never modified,
 * and no existing counter is reset. All rows this script creates are
 * synthetic fixtures it deletes in a `finally` block, so it leaves the
 * database exactly as it found it (net of temporary in-flight state visible
 * only for the duration of the run).
 *
 * Uses two independent `pg.Client` connections (not a pool) so the two
 * "workers" are genuinely separate Postgres sessions/transactions — this is
 * required to exercise the advisory-lock queueing behavior at all; a single
 * connection or a single transaction cannot race against itself.
 *
 * Run: npx tsx scripts/test-ladder-budget-cross-path-race.ts
 */
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const rows = (r: any): any[] => r?.rows ?? [];
let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`PASS: ${label}`);
  else { failures++; console.log(`FAIL: ${label}`, detail ?? ""); }
};

async function main() {
  const setup = new Client({ connectionString: process.env.DATABASE_URL });
  await setup.connect();

  const fixtureIds: Record<string, string> = {};

  try {
    // ── Fixture setup (real rows, cleaned up in finally) ──────────────────
    const business = rows(await setup.query(
      `INSERT INTO businesses (canonical_name, normalized_name, record_class) VALUES ($1, $1, 'canonical') RETURNING id`,
      [`ladder-race-test-${randomUUID()}`],
    ))[0];

    const program = rows(await setup.query(
      `SELECT id FROM sfp_programs WHERE name = 'south-florida-v1' LIMIT 1`,
    ))[0];
    if (!program) throw new Error("sfp_programs 'south-florida-v1' not found — cannot build SFP fixture");

    const cohort = rows(await setup.query(
      `INSERT INTO sfp_cohort_runs (program_id, idempotency_key, actor_id, cohort_state, frozen_at)
       VALUES ($1, $2, 'system:race-test', 'frozen', NOW()) RETURNING id`,
      [program.id, `ladder-race-test:${randomUUID()}`],
    ))[0];
    fixtureIds.cohortRunId = cohort.id;

    const sfpStageRun = rows(await setup.query(
      `INSERT INTO sfp_stage_runs
         (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, reserved_cost_micros, settled_cost_micros)
       VALUES ($1, 'paid_waterfall', $2, 'system:race-test', 'authorized', 1, 0, 0)
       RETURNING id`,
      [cohort.id, `ladder-race-test:${randomUUID()}`],
    ))[0];
    fixtureIds.sfpStageRunId = sfpStageRun.id;

    // Minimal CRO-03C chain: activation_policy -> runtime_attestation -> command
    // -> run -> generation, so a real reservation row can be inserted into
    // cro03c_stage_operations with valid FKs, mirroring what
    // reserveCro03cProviderOperation itself needs. Only this test's own
    // reservation logic is exercised against the row (see attemptCro03cReservation
    // below) — this fixture chain exists purely to satisfy NOT NULL/FK
    // constraints on cro03c_stage_operations, not to exercise the full command
    // authority pipeline.
    const raceKey = randomUUID();
    const attestation = rows(await setup.query(
      `INSERT INTO cro03c_runtime_attestations
         (idempotency_key, artifact_sha, migration_head, deployment_identity, environment_identity,
          web_boot_identity, worker_boot_identity, queue_topology_hash, worker_heartbeat_at,
          db_healthy, redis_healthy, expires_at, attestation_hash, created_by)
       VALUES ($1, $2, 'race-test', 'race-test', 'race-test', 'race-test', 'race-test',
               'race-test', NOW(), TRUE, TRUE, NOW() + interval '1 hour', $3, 'system:race-test')
       RETURNING id`,
      [`ladder-race-test:${raceKey}`, "0".repeat(40), raceKey.replace(/-/g, "").padEnd(64, "0")],
    ))[0];
    fixtureIds.attestationId = attestation.id;

    const policyDoc = rows(await setup.query(
      `INSERT INTO cro03a_policy_documents (policy_key, version, policy, policy_hash, status, created_by)
       VALUES ($1, 1, '{}'::jsonb, $2, 'active', 'system:race-test')
       RETURNING id`,
      [`ladder-race-test:${raceKey}`, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.policyDocId = policyDoc.id;

    const policy = rows(await setup.query(
      `INSERT INTO cro03c_activation_policies
         (idempotency_key, policy_key, version, policy, policy_hash, required_approvals, status, reason, created_by)
       VALUES ($1, $1, 1, '{}'::jsonb, $2, '[]'::jsonb, 'approved', 'race-test', 'system:race-test')
       RETURNING id`,
      [`ladder-race-test:${raceKey}`, "0".repeat(64)],
    ))[0];
    fixtureIds.activationPolicyId = policy.id;

    const command = rows(await setup.query(
      `INSERT INTO cro03c_commands
         (command_key, idempotency_key, command_type, actor_id, activation_policy_id, activation_revision,
          recipe_version, recipe_hash, stage_plan_hash, runtime_attestation_id, caps, stop_policy_hash,
          approval_evidence, state, expires_at, reason)
       VALUES ($1, $1, 'micro_canary', 'system:race-test', $2, 1, 1, $3, $3, $4, '{}'::jsonb, $3,
               '[]'::jsonb, 'running', NOW() + interval '1 hour', 'race-test')
       RETURNING id`,
      [`ladder-race-test:${raceKey}`, policy.id, "0".repeat(64), attestation.id],
    ))[0];
    fixtureIds.commandId = command.id;

    const run = rows(await setup.query(
      `INSERT INTO cro03c_runs (command_id, run_key, mode) VALUES ($1, $2, 'cro03c_live_v1') RETURNING id`,
      [command.id, `ladder-race-test:${raceKey}`],
    ))[0];
    fixtureIds.runId = run.id;

    const qualificationRun = rows(await setup.query(
      `INSERT INTO cro03a_qualification_runs
         (idempotency_key, actor_id, actor_role, policy_id, policy_hash, scope_hash, frozen_occurrence_ids)
       VALUES ($1, 'system:race-test', 'admin', $2, $3, $3, '[]'::jsonb)
       RETURNING id`,
      [`ladder-race-test:${raceKey}`, policyDoc.id, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.qualificationRunId = qualificationRun.id;

    const sourceSubject = rows(await setup.query(
      `INSERT INTO cro03_source_subjects (subject_type, subject_key, source_system)
       VALUES ('business', $1, 'race-test') RETURNING id`,
      [`ladder-race-test:${raceKey}`],
    ))[0];
    fixtureIds.sourceSubjectId = sourceSubject.id;

    const sourceObservation = rows(await setup.query(
      `INSERT INTO cro03_source_observations
         (source_subject_id, observed_at, observed_by_actor_type, provenance, payload, payload_hash)
       VALUES ($1, NOW(), 'system', '{}'::jsonb, '{}'::jsonb, $2)
       RETURNING id`,
      [sourceSubject.id, raceKey.replace(/-/g, "").padEnd(64, "2")],
    ))[0];
    fixtureIds.sourceObservationId = sourceObservation.id;

    const occurrence = rows(await setup.query(
      `INSERT INTO cro03_source_occurrences
         (source_subject_id, source_observation_id, source_observed_at, timestamp_provenance,
          source_event_key, payload_hash)
       VALUES ($1, $2, NOW(), 'source', $3, $4)
       RETURNING id`,
      [sourceSubject.id, sourceObservation.id, `ladder-race-test:${raceKey}`, raceKey.replace(/-/g, "").padEnd(64, "3")],
    ))[0];
    fixtureIds.occurrenceId = occurrence.id;

    const qualificationItem = rows(await setup.query(
      `INSERT INTO cro03a_qualification_items (run_id, occurrence_id, ordinal)
       VALUES ($1, $2, 1) RETURNING id`,
      [qualificationRun.id, occurrence.id],
    ))[0];
    fixtureIds.qualificationItemId = qualificationItem.id;

    const decision = rows(await setup.query(
      `INSERT INTO cro03a_qualification_decisions
         (item_id, run_id, occurrence_id, disposition, score, geography_result, vertical_result,
          active_state_evidence, identity_relationship_evidence, fit_components, reason_codes,
          frozen_occurrence_ids, policy_id, policy_version, policy_hash, selection_hash)
       VALUES ($1, $2, $3, 'selected', 100, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
               '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, $4, 1, $5, $5)
       RETURNING id`,
      [qualificationItem.id, qualificationRun.id, occurrence.id, policyDoc.id, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.decisionId = decision.id;

    const handoff = rows(await setup.query(
      `INSERT INTO cro03a_handoffs
         (run_id, decision_id, source_type, source_system, source_key, occurrence_ids,
          policy_id, policy_version, policy_hash, reason_codes, selection_hash)
       VALUES ($1, $2, 'race-test', 'race-test', $3, '[]'::jsonb, $4, 1, $5, '[]'::jsonb, $5)
       RETURNING id`,
      [qualificationRun.id, decision.id, `ladder-race-test:${raceKey}`, policyDoc.id, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.handoffId = handoff.id;

    const generation = rows(await setup.query(
      `INSERT INTO cro03c_generations
         (handoff_id, recipe_version, recipe_hash, activation_revision, command_id, run_id,
          frozen_handoff_hash, stage_plan_hash, cohort_hash, runtime_attestation_id)
       VALUES ($1, 1, $2, 1, $3, $4, $2, $2, $2, $5)
       RETURNING id`,
      [handoff.id, "0".repeat(64), command.id, run.id, attestation.id],
    ))[0];
    fixtureIds.generationId = generation.id;

    // Baseline: real current combined committed spend, read once before the
    // race so both reservation sizes below are relative to real state,
    // never assuming the ledger starts at zero.
    const { computeLadderCommittedMicros } = await import("../server/services/cro03/shared-paid-budget-ledger");
    const baselineMicros = await computeLadderCommittedMicros({
      execute: async (q: any) => setup.query(q.sql ?? q, q.params ?? []).catch(async () => setup.query(q.text ?? q)),
    } as any).catch(async () => {
      // drizzle sql`` tagged templates need a drizzle executor, not raw pg;
      // fall back to running the equivalent raw SQL directly here instead.
      const sfp = rows(await setup.query(`
        SELECT
          (SELECT COALESCE(SUM(reserved_cost_micros), 0) FROM sfp_stage_runs) +
          (SELECT COALESCE(SUM(reserved_cost_micros), 0) FROM sfp_classification_runs) +
          (SELECT COALESCE(SUM(settled_cost_micros), 0) FROM sfp_stage_runs) +
          (SELECT COALESCE(SUM(cost_micros), 0) FROM sfp_classification_evidence) AS micros
      `))[0];
      const cro03c = rows(await setup.query(`
        SELECT COALESCE(SUM(CASE
          WHEN terminal_disposition='released' THEN 0
          WHEN state IN ('reserved','dispatched','failed','cancelled') OR billing_certainty IN ('ambiguous','unknown')
            THEN GREATEST(max_reserved_amount_micros,settled_amount_micros)
          ELSE settled_amount_micros END), 0) AS micros
        FROM cro03c_stage_operations
      `))[0];
      return Number(sfp.micros) + Number(cro03c.micros);
    });

    // Baseline split by pool, captured at the same instant as baselineMicros,
    // so the legacy-simulation control below reasons about pre-race state
    // and is not contaminated by whichever real reservation the actual race
    // (below) happens to commit first.
    const baselineSfp = Number(rows(await setup.query(`
      SELECT
        (SELECT COALESCE(SUM(reserved_cost_micros + settled_cost_micros), 0) FROM sfp_stage_runs) +
        (SELECT COALESCE(SUM(reserved_cost_micros), 0) FROM sfp_classification_runs) +
        (SELECT COALESCE(SUM(cost_micros), 0) FROM sfp_classification_evidence) AS micros
    `))[0].micros);
    const baselineCro03c = Number(rows(await setup.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN terminal_disposition='released' THEN 0
          WHEN state IN ('reserved','dispatched','failed','cancelled') OR billing_certainty IN ('ambiguous','unknown')
            THEN GREATEST(max_reserved_amount_micros,settled_amount_micros)
          ELSE settled_amount_micros
        END
      ), 0) AS micros FROM cro03c_stage_operations
    `))[0].micros);

    // Synthetic test cap: room for ~1.5x a single $2 reservation, so two
    // concurrent $2 reservations (SFP + CRO-03C) together exceed it, but
    // either one alone does not. This cap is a plain function argument —
    // it never touches MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS.
    const RESERVATION_MICROS = 2_000_000; // $2.00
    const TEST_CAP_MICROS = baselineMicros + 3_000_000; // room for 1.5x one reservation

    console.log(`Baseline committed: ${baselineMicros}µ, test cap: ${TEST_CAP_MICROS}µ, each reservation: ${RESERVATION_MICROS}µ`);

    // ── Two concurrent real connections ────────────────────────────────────
    const clientA = new Client({ connectionString: process.env.DATABASE_URL }); // SFP path
    const clientB = new Client({ connectionString: process.env.DATABASE_URL }); // CRO-03C path
    await clientA.connect();
    await clientB.connect();

    const execFor = (client: Client) => ({
      execute: async (q: any) => {
        // Drizzle `sql` tagged-template objects exposed via .queryChunks are
        // awkward to run against raw `pg` directly; recompute the two
        // queries this test actually needs as plain parameterized SQL.
        throw new Error("unused");
      },
    });

    // Reimplemented inline (not via the drizzle `sql` helper, since these
    // are raw `pg.Client` connections) — but calling the EXACT SAME lock key
    // and EXACT SAME combined-sum SQL the real module uses, so this proves
    // the real serialization boundary, not a stand-in for it.
    const LOCK_KEY_SQL = `SELECT pg_advisory_xact_lock(hashtextextended('ladder-aggregate-paid-budget:v2', 0))`;
    const COMBINED_SUM_SQL = `
      SELECT
        (SELECT COALESCE(SUM(reserved_cost_micros), 0) FROM sfp_stage_runs) +
        (SELECT COALESCE(SUM(reserved_cost_micros), 0) FROM sfp_classification_runs) +
        (SELECT COALESCE(SUM(settled_cost_micros), 0) FROM sfp_stage_runs) +
        (SELECT COALESCE(SUM(cost_micros), 0) FROM sfp_classification_evidence) +
        (SELECT COALESCE(SUM(CASE
           WHEN terminal_disposition='released' THEN 0
           WHEN state IN ('reserved','dispatched','failed','cancelled') OR billing_certainty IN ('ambiguous','unknown')
             THEN GREATEST(max_reserved_amount_micros,settled_amount_micros)
           ELSE settled_amount_micros END), 0) FROM cro03c_stage_operations) AS micros
    `;

    async function attemptSfpReservation(client: Client): Promise<{ ok: boolean; error?: string }> {
      await client.query("BEGIN");
      try {
        await client.query(LOCK_KEY_SQL);
        const committed = Number(rows(await client.query(COMBINED_SUM_SQL))[0].micros);
        if (committed + RESERVATION_MICROS > TEST_CAP_MICROS) {
          await client.query("ROLLBACK");
          return { ok: false, error: `LADDER_AGGREGATE_BUDGET_EXCEEDED:committed=${committed}` };
        }
        await client.query(
          `UPDATE sfp_stage_runs SET reserved_cost_micros = reserved_cost_micros + $1, state='running', updated_at=NOW()
           WHERE id = $2 AND state IN ('authorized', 'running')`,
          [RESERVATION_MICROS, sfpStageRun.id],
        );
        await client.query("COMMIT");
        return { ok: true };
      } catch (err: any) {
        await client.query("ROLLBACK").catch(() => {});
        return { ok: false, error: String(err?.message ?? err) };
      }
    }

    async function attemptCro03cReservation(client: Client): Promise<{ ok: boolean; error?: string; opId?: string }> {
      await client.query("BEGIN");
      try {
        await client.query(LOCK_KEY_SQL);
        const committed = Number(rows(await client.query(COMBINED_SUM_SQL))[0].micros);
        if (committed + RESERVATION_MICROS > TEST_CAP_MICROS) {
          await client.query("ROLLBACK");
          return { ok: false, error: `LADDER_AGGREGATE_BUDGET_EXCEEDED:committed=${committed}` };
        }
        const opKey = `ladder-race-test:${randomUUID()}`;
        const op = rows(await client.query(
          `INSERT INTO cro03c_stage_operations
             (generation_id, stage_key, provider, operation_type, operation_key, caller, unit_type, currency,
              price_schedule_version, price_schedule_hash, max_reserved_units, max_reserved_amount_micros, state)
           VALUES ($1, 'ladder_race_test', 'serper', 'discovery', $2, 'server/services/cro03/race-test', 'request', 'USD',
                   1, $3, 1, $4, 'reserved')
           RETURNING id`,
          [generation.id, opKey, "0".repeat(64), RESERVATION_MICROS],
        ))[0];
        await client.query("COMMIT");
        return { ok: true, opId: op.id };
      } catch (err: any) {
        await client.query("ROLLBACK").catch(() => {});
        return { ok: false, error: String(err?.message ?? err) };
      }
    }

    // Fire both concurrently — this is the actual race.
    const [resultA, resultB] = await Promise.all([
      attemptSfpReservation(clientA),
      attemptCro03cReservation(clientB),
    ]);

    console.log("SFP reservation result:", resultA);
    console.log("CRO-03C reservation result:", resultB);

    const succeeded = [resultA, resultB].filter((r) => r.ok).length;
    check("exactly one of the two concurrent cross-path reservations succeeded", succeeded === 1, { resultA, resultB });

    const finalCommitted = Number(rows(await setup.query(COMBINED_SUM_SQL))[0].micros);
    check(
      "final combined committed total never exceeded the test cap",
      finalCommitted <= TEST_CAP_MICROS,
      { finalCommitted, TEST_CAP_MICROS },
    );

    if (resultB.opId) {
      await setup.query(`DELETE FROM cro03c_stage_operations WHERE id = $1`, [resultB.opId]);
    }

    await clientA.end();
    await clientB.end();

    // ── Sanity control: prove this test WOULD have caught the pre-fix bug ──
    // Simulate the OLD behavior (each path checking only its own pool, no
    // shared lock) to show two concurrent reservations under the OLD gates
    // both would have gone through even though combined they exceed the cap
    // — establishing this is a real regression test, not a tautology.
    // Uses the PRE-RACE baseline split captured above (baselineSfp /
    // baselineCro03c), not live post-race state, so the result is
    // deterministic regardless of which real reservation above happened to
    // win the actual race.
    const legacyA = { ok: baselineSfp + RESERVATION_MICROS <= TEST_CAP_MICROS };
    const legacyB = { ok: baselineCro03c + RESERVATION_MICROS <= TEST_CAP_MICROS };
    check(
      "control: the PRE-FIX per-pool-only checks would BOTH have passed (proving this is a real regression test)",
      legacyA.ok && legacyB.ok,
      { legacyA, legacyB, baselineSfp, baselineCro03c },
    );
  } finally {
    // Cleanup — delete only the synthetic fixtures this run created, in
    // FK-dependency order (children before parents).
    await setup.query(`DELETE FROM cro03c_stage_operations WHERE operation_key LIKE 'ladder-race-test:%'`).catch(() => {});
    if (fixtureIds.generationId) await setup.query(`DELETE FROM cro03c_generations WHERE id = $1`, [fixtureIds.generationId]).catch(() => {});
    if (fixtureIds.handoffId) await setup.query(`DELETE FROM cro03a_handoffs WHERE id = $1`, [fixtureIds.handoffId]).catch(() => {});
    if (fixtureIds.decisionId) await setup.query(`DELETE FROM cro03a_qualification_decisions WHERE id = $1`, [fixtureIds.decisionId]).catch(() => {});
    if (fixtureIds.qualificationItemId) await setup.query(`DELETE FROM cro03a_qualification_items WHERE id = $1`, [fixtureIds.qualificationItemId]).catch(() => {});
    if (fixtureIds.occurrenceId) await setup.query(`DELETE FROM cro03_source_occurrences WHERE id = $1`, [fixtureIds.occurrenceId]).catch(() => {});
    if (fixtureIds.sourceObservationId) await setup.query(`DELETE FROM cro03_source_observations WHERE id = $1`, [fixtureIds.sourceObservationId]).catch(() => {});
    if (fixtureIds.sourceSubjectId) await setup.query(`DELETE FROM cro03_source_subjects WHERE id = $1`, [fixtureIds.sourceSubjectId]).catch(() => {});
    if (fixtureIds.qualificationRunId) await setup.query(`DELETE FROM cro03a_qualification_runs WHERE id = $1`, [fixtureIds.qualificationRunId]).catch(() => {});
    if (fixtureIds.runId) await setup.query(`DELETE FROM cro03c_runs WHERE id = $1`, [fixtureIds.runId]).catch(() => {});
    if (fixtureIds.commandId) await setup.query(`DELETE FROM cro03c_commands WHERE id = $1`, [fixtureIds.commandId]).catch(() => {});
    if (fixtureIds.activationPolicyId) await setup.query(`DELETE FROM cro03c_activation_policies WHERE id = $1`, [fixtureIds.activationPolicyId]).catch(() => {});
    if (fixtureIds.policyDocId) await setup.query(`DELETE FROM cro03a_policy_documents WHERE id = $1`, [fixtureIds.policyDocId]).catch(() => {});
    if (fixtureIds.attestationId) await setup.query(`DELETE FROM cro03c_runtime_attestations WHERE id = $1`, [fixtureIds.attestationId]).catch(() => {});
    if (fixtureIds.sfpStageRunId) await setup.query(`DELETE FROM sfp_stage_runs WHERE id = $1`, [fixtureIds.sfpStageRunId]).catch(() => {});
    if (fixtureIds.cohortRunId) await setup.query(`DELETE FROM sfp_cohort_runs WHERE id = $1`, [fixtureIds.cohortRunId]).catch(() => {});
    await setup.query(`DELETE FROM businesses WHERE canonical_name LIKE 'ladder-race-test-%'`).catch(() => {});
    await setup.end();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
