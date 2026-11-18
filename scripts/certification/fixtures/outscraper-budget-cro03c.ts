import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
const rows=(r:any):any[]=>r.rows;
/** Relational fixture only: not a published runtime, provider approval or live dispatch. */
export async function seedBudgetCro03cGeneration(setup:Pool){
 const fixtureIds:Record<string,string>={};
    const business = rows(await setup.query(
      `INSERT INTO businesses (canonical_name, normalized_name, record_class) VALUES ($1, $1, 'canonical') RETURNING id`,
      [`global-outs-budget-${randomUUID()}`],
    ))[0];

    const program = rows(await setup.query(
      `INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
       VALUES($1,ARRAY['12086'],ARRAY['Healthcare'],2,false,'system:budget-fixture') RETURNING id`,
      [`global-outs-budget:${randomUUID()}`],
    ))[0];
    if (!program) throw new Error("sfp_programs 'south-florida-v1' not found — cannot build SFP fixture");

    const cohort = rows(await setup.query(
      `INSERT INTO sfp_cohort_runs (program_id, idempotency_key, actor_id, cohort_state, frozen_at)
       VALUES ($1, $2, 'system:race-test', 'frozen', NOW()) RETURNING id`,
      [program.id, `global-outs-budget:${randomUUID()}`],
    ))[0];
    fixtureIds.cohortRunId = cohort.id;

    const sfpStageRun = rows(await setup.query(
      `INSERT INTO sfp_stage_runs
         (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, reserved_cost_micros, settled_cost_micros)
       VALUES ($1, 'paid_waterfall', $2, 'system:race-test', 'authorized', 1, 0, 0)
       RETURNING id`,
      [cohort.id, `global-outs-budget:${randomUUID()}`],
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
      [`global-outs-budget:${raceKey}`, "0".repeat(40), raceKey.replace(/-/g, "").padEnd(64, "0")],
    ))[0];
    fixtureIds.attestationId = attestation.id;

    const policyDoc = rows(await setup.query(
      `INSERT INTO cro03a_policy_documents (policy_key, version, policy, policy_hash, status, created_by)
       VALUES ($1, 1, '{}'::jsonb, $2, 'active', 'system:race-test')
       RETURNING id`,
      [`global-outs-budget:${raceKey}`, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.policyDocId = policyDoc.id;

    const policy = rows(await setup.query(
      `INSERT INTO cro03c_activation_policies
         (idempotency_key, policy_key, version, policy, policy_hash, required_approvals, status, reason, created_by)
       VALUES ($1, $1, 1, '{}'::jsonb, $2, '[]'::jsonb, 'approved', 'race-test', 'system:race-test')
       RETURNING id`,
      [`global-outs-budget:${raceKey}`, "0".repeat(64)],
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
      [`global-outs-budget:${raceKey}`, policy.id, "0".repeat(64), attestation.id],
    ))[0];
    fixtureIds.commandId = command.id;

    const run = rows(await setup.query(
      `INSERT INTO cro03c_runs (command_id, run_key, mode) VALUES ($1, $2, 'cro03c_live_v1') RETURNING id`,
      [command.id, `global-outs-budget:${raceKey}`],
    ))[0];
    fixtureIds.runId = run.id;

    const qualificationRun = rows(await setup.query(
      `INSERT INTO cro03a_qualification_runs
         (idempotency_key, actor_id, actor_role, policy_id, policy_hash, scope_hash, frozen_occurrence_ids)
       VALUES ($1, 'system:race-test', 'admin', $2, $3, $3, '[]'::jsonb)
       RETURNING id`,
      [`global-outs-budget:${raceKey}`, policyDoc.id, raceKey.replace(/-/g, "").padEnd(64, "1")],
    ))[0];
    fixtureIds.qualificationRunId = qualificationRun.id;

    const sourceSubject = rows(await setup.query(
      `INSERT INTO cro03_source_subjects (subject_type, subject_key, source_system)
       VALUES ('business', $1, 'race-test') RETURNING id`,
      [`global-outs-budget:${raceKey}`],
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
      [sourceSubject.id, sourceObservation.id, `global-outs-budget:${raceKey}`, raceKey.replace(/-/g, "").padEnd(64, "3")],
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
      [qualificationRun.id, decision.id, `global-outs-budget:${raceKey}`, policyDoc.id, raceKey.replace(/-/g, "").padEnd(64, "1")],
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
 return generation.id as string;
}
