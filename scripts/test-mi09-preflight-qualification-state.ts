#!/usr/bin/env tsx
/**
 * Production correction regression test: MI-09's runPreflightChecklist()
 * qualification-run check previously queried `qr.status = 'completed'`, but
 * cro03a_qualification_runs (migration 0187 and shared/schema.ts) has never
 * had a `status` column — the lifecycle column is `state`. The corrected
 * query uses `qr.state`.
 *
 * Builds real fixture rows through the actual CRO-03A table chain (subjects
 * -> observations -> occurrences -> qualification_items -> decisions ->
 * handoffs -> runs), using the live-seeded active policy document from
 * migration 0187, and proves:
 *   1. runPreflightChecklist() returns a structured { passed, detail } result
 *      (never a thrown/raw database error) against a real fixture.
 *   2. a completed run with 10 real handoffs makes the check pass, and the
 *      passing run_id is genuinely this fixture run.
 *   3. a completed run with only 9 real handoffs is never reported as the
 *      passing run (the HAVING COUNT(h.id) >= 10 clause genuinely excludes
 *      it) — proven both through the shared runPreflightChecklist() entry
 *      point and through a standalone execution of the exact corrected
 *      predicate scoped to just this run (isolating it from any other real
 *      qualifying run already present in this shared dev database).
 *   4. a running (non-completed) run with 10 real handoffs is never reported
 *      as the passing run, proven the same two ways.
 *   5. scoping the corrected predicate to ONLY the 9-handoff or ONLY the
 *      running-with-10-handoffs fixture (i.e. simulating "no other
 *      qualifying run exists") reports `none_found`, not a false pass —
 *      this is the disposable/isolated proof that doesn't depend on this
 *      shared dev database's ambient state.
 *
 * cro03a_handoffs, cro03a_qualification_decisions, and cro03_source_occurrences
 * are append-only (DB triggers reject UPDATE/DELETE — see migration 0187's
 * cro03a_append_only_guard()), so once a decision+handoff chain exists here
 * it cannot be deleted; runs/items are then RESTRICT-locked in place by those
 * children. Per the same convention already used for other CRO03 append-only
 * chains in this codebase, this test's fixture rows are left in the database
 * (scoped by a unique run tag) rather than force-cleaned.
 *
 * No provider calls, no worker activation, no GHL, no recurrence, no
 * outreach.
 *
 * Usage: npx tsx scripts/test-mi09-preflight-qualification-state.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
import { runPreflightChecklist } from "../server/services/mi09-pilot-authority";

let PASS = 0;
let FAIL = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  \u2713 ${label}`);
    PASS++;
  } else {
    console.error(`  \u2717 ${label}${detail ? `: ${detail}` : ""}`);
    FAIL++;
  }
}
function rows<T>(result: { rows: T[] }): T[] {
  return (result as any).rows ?? [];
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const RUN_TAG = `mi09-preflight-state-${Date.now() % 10_000_000}`;

async function getActivePolicy(): Promise<{ id: string; hash: string; version: number }> {
  const [policy] = rows<any>(await db.execute(sql`
    SELECT id, policy_hash, version FROM cro03a_policy_documents
    WHERE policy_key = 'south_florida_candidate_qualification' AND version = 1
    LIMIT 1
  `));
  if (!policy) throw new Error("Seeded CRO-03A policy v1 (from migration 0187) not found — cannot build fixture chain.");
  return { id: String(policy.id), hash: String(policy.policy_hash), version: Number(policy.version) };
}

/** Builds one full subject->observation->occurrence->item->decision->handoff chain, returning the handoff id. */
async function createHandoffChain(runId: string, ordinal: number, policy: { id: string; hash: string; version: number }): Promise<string> {
  const subjectKey = `${RUN_TAG}-subject-${runId}-${ordinal}`;
  const [subject] = rows<any>(await db.execute(sql`
    INSERT INTO cro03_source_subjects (subject_type, subject_key, source_system)
    VALUES ('public_web', ${subjectKey}, ${RUN_TAG})
    RETURNING id
  `));

  const payloadHash = sha256(`${RUN_TAG}-obs-${runId}-${ordinal}`);
  const [obs] = rows<any>(await db.execute(sql`
    INSERT INTO cro03_source_observations
      (source_subject_id, observed_at, observed_by_actor_type, provenance, payload, payload_hash)
    VALUES (${subject.id}, NOW(), 'test', '{}'::jsonb, '{}'::jsonb, ${payloadHash})
    RETURNING id
  `));

  const occHash = sha256(`${RUN_TAG}-occ-${runId}-${ordinal}`);
  const eventKey = `${RUN_TAG}:${subjectKey}:${ordinal}`;
  const [occ] = rows<any>(await db.execute(sql`
    INSERT INTO cro03_source_occurrences
      (source_subject_id, source_observation_id, source_observed_at, timestamp_provenance, source_event_key, payload_hash)
    VALUES (${subject.id}, ${obs.id}, NOW(), 'ingestion_only', ${eventKey}, ${occHash})
    RETURNING id
  `));

  const [item] = rows<any>(await db.execute(sql`
    INSERT INTO cro03a_qualification_items (run_id, occurrence_id, ordinal, state)
    VALUES (${runId}, ${occ.id}, ${ordinal}, 'completed')
    RETURNING id
  `));

  const selectionHash = sha256(`${RUN_TAG}-sel-${runId}-${ordinal}`);
  const [decision] = rows<any>(await db.execute(sql`
    INSERT INTO cro03a_qualification_decisions
      (item_id, run_id, occurrence_id, disposition, score,
       geography_result, vertical_result, active_state_evidence,
       identity_relationship_evidence, fit_components, reason_codes,
       frozen_occurrence_ids, policy_id, policy_version, policy_hash, selection_hash)
    VALUES (${item.id}, ${runId}, ${occ.id}, 'selected', 80,
       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
       '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
       '[]'::jsonb, ${policy.id}, ${policy.version}, ${policy.hash}, ${selectionHash})
    RETURNING id
  `));

  const handoffSelectionHash = sha256(`${RUN_TAG}-handoff-${runId}-${ordinal}`);
  const [handoff] = rows<any>(await db.execute(sql`
    INSERT INTO cro03a_handoffs
      (run_id, decision_id, source_type, source_system, source_key,
       occurrence_ids, policy_id, policy_version, policy_hash, reason_codes, selection_hash)
    VALUES (${runId}, ${decision.id}, 'public_web', ${RUN_TAG}, ${subjectKey},
       ${JSON.stringify([occ.id])}::jsonb, ${policy.id}, ${policy.version}, ${policy.hash}, '[]'::jsonb, ${handoffSelectionHash})
    RETURNING id
  `));
  return String(handoff.id);
}

async function createRun(policy: { id: string; hash: string; version: number }, state: string): Promise<string> {
  const idempotencyKey = `${RUN_TAG}-run-${state}-${randomUUID()}`;
  const [run] = rows<any>(await db.execute(sql`
    INSERT INTO cro03a_qualification_runs
      (idempotency_key, actor_id, actor_role, policy_id, policy_hash, scope_hash, frozen_occurrence_ids, state)
    VALUES (${idempotencyKey}, ${RUN_TAG}, 'system', ${policy.id}, ${policy.hash}, ${sha256(idempotencyKey)}, '[]'::jsonb, ${state})
    RETURNING id
  `));
  return String(run.id);
}

/**
 * Standalone execution of the EXACT corrected predicate from
 * runPreflightChecklist(), scoped to a specific set of run IDs. This isolates
 * the SQL logic from this shared dev database's ambient state (which may
 * already contain other real completed runs with >=10 handoffs), so
 * "none_found" can be proven deterministically without a full disposable
 * database process.
 */
async function scopedQualificationCheck(runIds: string[]): Promise<{ passed: boolean; detail?: string }> {
  const idList = sql.join(runIds.map((id) => sql`${id}::uuid`), sql`, `);
  const [qr] = rows<any>(await db.execute(sql`
    SELECT qr.id, COUNT(h.id)::int AS handoff_count
    FROM cro03a_qualification_runs qr
    LEFT JOIN cro03a_handoffs h ON h.run_id = qr.id
    WHERE qr.state = 'completed' AND qr.id IN (${idList})
    GROUP BY qr.id
    HAVING COUNT(h.id) >= 10
    LIMIT 1
  `));
  return { passed: !!qr, detail: qr ? `run_id=${qr.id} handoffs=${qr.handoff_count}` : "none_found" };
}

async function main() {
  console.log(`\n\u2500\u2500 Production correction: MI-09 preflight qr.state (not qr.status) \u2500\u2500\n`);
  const policy = await getActivePolicy();

  const run10Completed = await createRun(policy, "completed");
  for (let i = 0; i < 10; i++) await createHandoffChain(run10Completed, i, policy);

  const run9Completed = await createRun(policy, "completed");
  for (let i = 0; i < 9; i++) await createHandoffChain(run9Completed, i, policy);

  const run10Running = await createRun(policy, "running");
  for (let i = 0; i < 10; i++) await createHandoffChain(run10Running, i, policy);

  // ── Integrated: the real runPreflightChecklist() entry point ─────────────
  const result = await runPreflightChecklist();
  ok(
    "structured result returned (not a thrown DB error) for a healthy fixture",
    typeof result.checks?.qualificationRunWithHandoffs?.passed === "boolean",
    JSON.stringify(result.checks?.qualificationRunWithHandoffs),
  );
  ok(
    "completed run with 10 handoffs -> passes, and is genuinely this fixture run",
    result.checks.qualificationRunWithHandoffs.passed === true &&
      (result.checks.qualificationRunWithHandoffs.detail ?? "").includes(`run_id=${run10Completed}`),
    JSON.stringify(result.checks.qualificationRunWithHandoffs),
  );
  ok(
    "9-handoff completed run is never the run_id preflight reports as passing",
    !(result.checks.qualificationRunWithHandoffs.detail ?? "").includes(`run_id=${run9Completed}`),
    JSON.stringify(result.checks.qualificationRunWithHandoffs),
  );
  ok(
    "running run with 10 handoffs is never the run_id preflight reports as passing",
    !(result.checks.qualificationRunWithHandoffs.detail ?? "").includes(`run_id=${run10Running}`),
    JSON.stringify(result.checks.qualificationRunWithHandoffs),
  );

  // ── Isolated: exact corrected predicate scoped to ONE run at a time,
  // ── proving none_found deterministically regardless of ambient DB state.
  const scoped10Completed = await scopedQualificationCheck([run10Completed]);
  ok(
    "isolated: completed run with 10 handoffs passes on its own",
    scoped10Completed.passed === true,
    JSON.stringify(scoped10Completed),
  );
  const scoped9Completed = await scopedQualificationCheck([run9Completed]);
  ok(
    "isolated: completed run with 9 handoffs fails with none_found",
    scoped9Completed.passed === false && scoped9Completed.detail === "none_found",
    JSON.stringify(scoped9Completed),
  );
  const scoped10Running = await scopedQualificationCheck([run10Running]);
  ok(
    "isolated: running run with 10 handoffs fails with none_found",
    scoped10Running.passed === false && scoped10Running.detail === "none_found",
    JSON.stringify(scoped10Running),
  );

  console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
  console.log(
    `\nNote: fixture rows under source_system/actor_id='${RUN_TAG}' are left in place ` +
      `(cro03a_handoffs/cro03a_qualification_decisions/cro03_source_occurrences are append-only ` +
      `and RESTRICT-lock their parent runs/items in place once created — see script header).`,
  );
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
