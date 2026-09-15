#!/usr/bin/env tsx
/**
 * Corrective item 3 (rewritten): fail-closed paid completion evidence, full chain.
 *
 * Proves assertPilotEvidenceComplete() now blocks a Level 2/3 pilot run from
 * being marked 'completed' unless, for every paid provider the run's cohort
 * actually had operations against:
 *   1. every recorded stage operation reached a terminal state, AND
 *   2. every terminal operation has a matching cro03c_receipts row
 *      (a state flip with no settlement receipt is not proof the settlement
 *      path ran), AND
 *   3. every business_email_validation operation resolved to a terminal
 *      business_validation_intents row (a settled operation whose intent
 *      never resolved is spend with no durable validation outcome), AND
 *   4. the run produced a master_lead_staging_receipts outcome for every
 *      generation its paid operations touched (proof of what happened to the
 *      leads the paid spend enriched).
 *
 * Also proves the "impossible to complete" bug is fixed: a pilot definition
 * that allows a provider the frozen cohort never actually needed (no
 * recorded operations for it, while another allowed provider did run) is no
 * longer blocked on that provider's absence.
 *
 * Runs against the live dev DB with uniquely-prefixed fixture rows (no
 * disposable database required — this test never calls a live authority gate
 * or provider transport, only assertPilotEvidenceComplete()'s own queries).
 *
 * No worker activation, no pilot creation via the real activation flow, no
 * provider calls, no production master_leads, no outreach.
 *
 * Usage: npx tsx scripts/test-mi09-paid-completion-evidence.ts
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

process.env.NODE_ENV = "test";

let PASS = 0;
let FAIL = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  \u2713 ${label}`); PASS++; }
  else { console.error(`  \u2717 ${label}${detail ? `: ${detail}` : ""}`); FAIL++; }
}
async function throws(label: string, fn: () => Promise<unknown>, expectedSubstring: string) {
  try {
    await fn();
    ok(label, false, "did not throw");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    ok(label, msg.includes(expectedSubstring), `got "${msg}", expected substring "${expectedSubstring}"`);
  }
}

const { db } = await import("../server/db");
const { assertPilotEvidenceComplete } = await import("../server/services/mi09-pilot-authority");
const { createCro03SourceBatch, hashCro03Evidence } = await import("../server/services/cro03/source-staging");
const { createCro03aQualificationRun, processCro03aQualificationRunQueueSafe } =
  await import("../server/services/cro03a/qualification-service");
const rows = (result: any): any[] => result?.rows ?? result ?? [];
const runTag = crypto.randomUUID().slice(0, 8);
const tag = (s: string) => `MI09-PCE-TEST-${runTag}-${s}`;
// Several cro03c_* tables enforce a `^[0-9a-f]{64}$` check constraint on hash
// columns — use real sha256 hex digests for those, not plain tag strings.
const hash64 = (s: string) => crypto.createHash("sha256").update(tag(s)).digest("hex");
// release_sha has its own narrower `^[0-9a-f]{40}$` check (git-SHA shaped).
const hash40 = (s: string) => crypto.createHash("sha1").update(tag(s)).digest("hex");

async function main() {
  console.log("── Corrective item 3: fail-closed paid completion evidence ──");

  // ── Fixture chain: activation policy, deployment inventory, runtime
  // attestation, command, run, generation. assertPilotEvidenceComplete()
  // never calls a live authority gate — it only queries these rows directly —
  // so the fixtures only need to satisfy NOT NULL/FK constraints, not real
  // authorization semantics.
  const policyId = crypto.randomUUID();
  const inventoryId = crypto.randomUUID();
  const attestationId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  const now = new Date();
  const expiry = new Date(now.getTime() + 60 * 60_000);

  // Use the real CRO-03A source→qualification pipeline (same helpers the
  // master-lead e2e certification script uses) to produce a genuine handoff —
  // cro03a_qualification_decisions has 12+ NOT NULL evidence columns that only
  // the real qualification algorithm populates correctly; hand-rolling them
  // would test nothing but a guessed shape.
  const subjectKey = tag("subject");
  await createCro03SourceBatch({
    idempotencyKey: tag("source-batch"), actorType: "system", actorId: tag("actor"), purpose: "staging_review",
    subjects: [{
      subjectType: "prospect", subjectKey, sourceSystem: "prospects",
      sourceObservedAt: new Date().toISOString(), sourceEventKey: tag("event"),
      timestampProvenance: "source", provenance: { certification: true },
      payload: { businessName: tag("biz-name"), website: `https://${subjectKey}.example.test`,
        email: `${subjectKey}@example.test`, phone: "3055550188", address: "200 Test Way",
        city: "Miami", state: "FL", county: "Miami-Dade", industry: "Auto", entityStatus: "active" },
      candidateValues: { business_name: tag("biz-name"), website: `https://${subjectKey}.example.test`,
        email: `${subjectKey}@example.test`, phone: "3055550188", address: "200 Test Way",
        city: "Miami", state: "FL", category: "Auto", entity_status: "active" },
    }],
  });
  const occurrence = rows(await db.execute(sql`
    SELECT id FROM cro03_source_occurrences WHERE source_event_key = ${tag("event")}
  `))[0];
  const qualification = await createCro03aQualificationRun({
    idempotencyKey: tag("qualification"), occurrenceIds: [occurrence.id],
    actorId: tag("actor-admin"), actorRole: "admin",
  });
  await db.execute(sql`
    INSERT INTO users(id, email, role, auth_provider, created_at, updated_at)
    VALUES (${tag("actor-admin")}, ${`${tag("actor-admin")}@example.test`}, 'admin', 'test', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await processCro03aQualificationRunQueueSafe(qualification.id);
  const handoff = rows(await db.execute(sql`
    SELECT id FROM cro03a_handoffs WHERE run_id = ${qualification.id}::uuid
  `))[0];
  if (!handoff) throw new Error("fixture setup failed: source did not produce an eligible CRO-03A handoff");

  await db.execute(sql`
    INSERT INTO cro03c_activation_policies
      (id, idempotency_key, policy_key, version, policy, policy_hash, required_approvals, status, reason, created_by)
    VALUES (${policyId}::uuid, ${tag("act-policy-idem")}, ${tag("act-policy")}, 1, '{}'::jsonb, ${hash64("act-policy-hash")},
            '{}'::jsonb, 'approved', 'test', ${tag("actor")})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_deployment_inventories
      (id, issuer_id, deployment_identity, environment_identity, release_sha, queue_topology_hash,
       identity_kind, worker_identities, expected_count, issued_at, expires_at, payload, payload_hash, signature, created_by)
    VALUES (${inventoryId}::uuid, ${tag("issuer")}, 'test', 'test', ${hash40("sha")}, ${hash64("qtopo")},
            'worker', ${JSON.stringify([tag("worker")])}::jsonb, 1, NOW(), ${expiry}::timestamptz, '{}'::jsonb, ${hash64("payload-hash")}, ${tag("sig")}, ${tag("actor")})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations
      (id, idempotency_key, inventory_id, worker_identities, artifact_sha, migration_head, deployment_identity,
       environment_identity, web_boot_identity, worker_boot_identity, queue_topology_hash, worker_heartbeat_at,
       db_healthy, redis_healthy, expires_at, attestation_hash, created_by)
    VALUES (${attestationId}::uuid, ${tag("attest-idem")}, ${inventoryId}::uuid, '[]'::jsonb, ${hash40("sha")}, ${hash64("mighead")},
            'test', 'test', ${tag("webboot")}, ${tag("workerboot")}, ${hash64("qtopo")}, NOW(), TRUE, TRUE,
            ${expiry}::timestamptz, ${hash64("attest-hash")}, ${tag("actor")})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_commands
      (id, command_key, idempotency_key, command_type, actor_id, activation_policy_id, activation_revision,
       recipe_version, recipe_hash, stage_plan_hash, runtime_attestation_id, caps, stop_policy_hash,
       approval_evidence, state, expires_at, reason)
    VALUES (${commandId}::uuid, ${tag("cmd")}, ${tag("cmd-idem")}, 'initial_batch', ${tag("actor")}, ${policyId}::uuid, 1,
            1, ${hash64("recipe-hash")}, ${hash64("stageplan-hash")}, ${attestationId}::uuid, '{}'::jsonb, ${hash64("stop-hash")},
            '{}'::jsonb, 'completed', ${expiry}::timestamptz, 'test')
  `);
  await db.execute(sql`
    INSERT INTO cro03c_runs (id, command_id, run_key, mode, state)
    VALUES (${runId}::uuid, ${commandId}::uuid, ${tag("run")}, 'cro03c_live_v1', 'completed')
  `);
  await db.execute(sql`
    INSERT INTO cro03c_generations
      (id, command_id, run_id, handoff_id, recipe_version, recipe_hash, mode, activation_revision,
       frozen_handoff_hash, stage_plan_hash, cohort_hash, runtime_attestation_id, state)
    VALUES (${generationId}::uuid, ${commandId}::uuid, ${runId}::uuid, ${handoff.id}::uuid, 1, ${hash64("recipe-hash")},
            'cro03c_live_v1', 1, ${hash64("frozen-hash")}, ${hash64("stageplan-hash")}, ${hash64("cohort-hash")},
            ${attestationId}::uuid, 'completed')
  `);

  // ── MI-09 pilot definition (level 2, single paid provider "zerobounce" allowed) ──
  // Steps 1–8 below use a single-required-provider definition deliberately:
  // jsonb does not preserve object key insertion order, so with two-or-more
  // *simultaneously* unresolved required providers the specific provider
  // named in the thrown error is nondeterministic. Restricting to one
  // required provider here makes each assertion deterministic; the "no-gap
  // provider must not block completion" case is exercised separately below
  // (step 9) with a second, isolated pilot run.
  const defRow = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_definitions
      (level, county_scope, vertical_scope, source_adapter_filter, max_cohort_size,
       enrichment_recipe_version, paid_providers_allowed, stop_condition_thresholds,
       pilot_definition_hash, created_by)
    VALUES (2, '[]'::jsonb, '[]'::jsonb, '["google_places"]'::jsonb, 5, 1,
            ${JSON.stringify({ zerobounce: true, serper: false, apollo: false })}::jsonb, '{}'::jsonb,
            ${tag("pilot-def-hash")}, ${tag("actor")})
    RETURNING id
  `))[0];
  const pilotRun = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_runs
      (pilot_definition_id, release_sha, cro03c_selection_policy_version, cro03c_routing_policy_version,
       cro03c_recipe_version, state, cohort_frozen_hash, outbound_pause_epoch)
    VALUES (${defRow.id}::uuid, ${hash40("release-sha")}, 1, 1, 1, 'running', ${tag("cohort-frozen-hash")}, 1)
    RETURNING id
  `))[0];
  const pilotRunId = String(pilotRun.id);

  // ── Non-paid-evidence preconditions (cohort frozen + fully processed) ──
  const biz = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, record_class, created_at, updated_at)
    VALUES (${tag("biz")}, ${tag("biz").toLowerCase()}, 'test', NOW(), NOW())
    RETURNING id
  `))[0];
  await db.execute(sql`
    INSERT INTO mi09_pilot_cohort_members (pilot_run_id, canonical_business_id, source_adapter_key)
    VALUES (${pilotRunId}::uuid, ${biz.id}, 'google_places')
  `);
  await db.execute(sql`
    INSERT INTO mi09_pilot_checkpoints (pilot_run_id, phase, processed_count)
    VALUES (${pilotRunId}::uuid, 'enrichment', 1)
  `);

  // ── mi09_pilot_effect_links: link the run to the fixture command ──
  await db.execute(sql`
    INSERT INTO mi09_pilot_effect_links (pilot_run_id, entity_type, entity_id)
    VALUES (${pilotRunId}::uuid, 'cro03c_command', ${commandId}::uuid)
  `);

  // ── 1. No stage operations at all for the (sole) allowed provider → fail-closed. ──
  await throws(
    "no operations recorded for the allowed paid provider → PILOT_EVIDENCE_MISSING (fail-closed, not silently passing)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_MISSING:paid_provider_no_operations:zerobounce",
  );

  // ── 2. zerobounce operation exists but stuck 'reserved' (non-terminal) → fails ──
  await db.execute(sql`
    INSERT INTO cro03c_stage_operations
      (generation_id, stage_key, provider, operation_type, operation_key, command_id, caller,
       unit_type, currency, price_schedule_version, price_schedule_hash,
       max_reserved_units, max_reserved_amount_micros, state)
    VALUES (${generationId}::uuid, 'business_email_validation', 'zerobounce', 'business_email_validation',
            ${tag("op-zb-1")}, ${commandId}::uuid, 'test', 'request', 'USD', 1, ${tag("price-hash")},
            1, 1, 'reserved')
  `);
  await throws(
    "zerobounce operation still 'reserved' (never dispatched/settled) → PILOT_EVIDENCE_INCOMPLETE (non-terminal)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:paid_provider_non_terminal:zerobounce=1/1",
  );

  // ── 3. Operation reaches 'completed' with terminal_disposition set, but
  // STILL fails: it has no cro03c_receipts row yet, so the tightened check
  // must reject "state says terminal" without "settlement path actually
  // produced a receipt". This proves item 3's core fix. ──
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET state = 'completed', terminal_disposition = 'consumed', completed_at = NOW()
     WHERE operation_key = ${tag("op-zb-1")}
  `);
  await throws(
    "operation terminal but has NO cro03c_receipts row → PILOT_EVIDENCE_MISSING (proves state-only checks are no longer sufficient)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_MISSING:paid_provider_no_receipt:zerobounce",
  );

  // ── 4. A 'completed' state with terminal_disposition left NULL is still treated as non-terminal (silent-completion guard) ──
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET terminal_disposition = NULL
     WHERE operation_key = ${tag("op-zb-1")}
  `);
  await throws(
    "'completed' state but terminal_disposition left NULL → still counted non-terminal (guards against a silent-completion bug re-appearing)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:paid_provider_non_terminal:zerobounce=1/1",
  );
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET terminal_disposition = 'consumed'
     WHERE operation_key = ${tag("op-zb-1")}
  `);

  // ── 5. Add a real cro03c_receipts row → receipt gap closes, but the run
  // still has no resolved business_validation_intents row for the zerobounce
  // (business_email_validation) operation, and no master_lead_staging_receipts
  // outcome for the generation → still fails, now on the validation-resolution
  // check. ──
  const zbOpId = rows(await db.execute(sql`SELECT id FROM cro03c_stage_operations WHERE operation_key = ${tag("op-zb-1")}`))[0].id;
  await db.execute(sql`
    INSERT INTO cro03c_receipts (generation_id, pilot_run_id, stage_operation_id, receipt_key, receipt_type, normalized_outcome, evidence_hash, settled_units, settled_amount_micros)
    VALUES (${generationId}::uuid, ${pilotRunId}::uuid, ${zbOpId}::uuid, ${tag("receipt-zb")}, 'terminal', 'success', ${hash64("evidence-zb")}, 1, 1)
  `);
  await throws(
    "receipt now exists, but the zerobounce validation intent never resolved → PILOT_EVIDENCE_INCOMPLETE (unresolved validation)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:paid_provider_unresolved_validation:zerobounce",
  );

  // ── 7. Resolve the validation intent (via a dispatch checkpoint + a
  // terminal business_validation_intents row) → validation gap closes, but
  // there is still no master_lead_staging_receipts row for this generation →
  // still fails, now on the staging-outcome check. ──
  const attemptId = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO cro03c_dispatch_checkpoints (stage_operation_id, attempt_id, checkpoint, authority_hash)
    VALUES (${zbOpId}::uuid, ${attemptId}::uuid, 'pre_io', ${hash64("checkpoint-hash")})
  `);
  const winnerSelectionId = crypto.randomUUID();
  const candidateEvidenceId = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO cro03c_candidate_evidence
      (id, generation_id, stage_key, field, subject_type, disposition, confidence,
       envelope_ciphertext, envelope_nonce, envelope_tag, normalized_value_hash, masked_value, business_id)
    VALUES (${candidateEvidenceId}::uuid, ${generationId}::uuid, 'business_email_validation', 'email', 'business', 'staged', 90,
            ${tag("envelope-ct")}, ${tag("envelope-nonce")}, ${tag("envelope-tag")}, ${hash64("email-token")}, ${tag("masked-email")}, ${biz.id})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_email_winner_selections
      (id, business_id, generation_id, candidate_evidence_id, source, subject_type, confidence, normalized_value_hash, state)
    VALUES (${winnerSelectionId}::uuid, ${biz.id}, ${generationId}::uuid, ${candidateEvidenceId}::uuid, 'test', 'business', 90, ${hash64("email-token")}, 'selected')
  `);
  await db.execute(sql`
    INSERT INTO business_validation_intents
      (business_id, winner_selection_id, candidate_evidence_id, normalized_email_token_hash,
       state, disposition, claim_token, terminal_code, completed_at)
    VALUES (${biz.id}, ${winnerSelectionId}::uuid, ${candidateEvidenceId}::uuid, ${hash64("email-token")},
            'completed', 'valid', ${attemptId}::uuid, 'valid', NOW())
  `);
  await throws(
    "validation intent now resolved, but the generation still has no master_lead_staging_receipts row → PILOT_EVIDENCE_INCOMPLETE (no staging outcome)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:no_master_lead_staging_outcome",
  );

  // ── 8. Write the staging receipt for this generation → full chain now
  // complete (terminal state + receipt + resolved validation + staging
  // outcome) → evidence check passes. ──
  await db.execute(sql`
    INSERT INTO master_lead_staging_receipts (cro03_generation_id, pilot_run_id, canonical_business_id, master_lead_id, disposition)
    VALUES (${generationId}::uuid, ${pilotRunId}::uuid, ${biz.id}, NULL, 'suppressed')
  `);
  try {
    await assertPilotEvidenceComplete(pilotRunId);
    ok("full evidence chain complete (terminal + receipt + resolved validation + staging outcome) → evidence check passes", true);
  } catch (e: any) {
    ok("full evidence chain complete (terminal + receipt + resolved validation + staging outcome) → evidence check passes", false, String(e?.message ?? e));
  }

  // ── 9. No-gap fix, isolated: a SECOND pilot definition/run allows BOTH
  // zerobounce and apollo, but the frozen cohort only ever produced a
  // zerobounce operation (apollo had no gap to fill for this cohort). With
  // the same full evidence chain as run A wired up for zerobounce only, the
  // run must still pass — apollo's absence is a legitimate no-gap outcome,
  // not a missing-evidence failure. This is isolated in its own
  // command/run/generation so it can't be affected by ordering against run A. ──
  const commandId2 = crypto.randomUUID();
  const runId2 = crypto.randomUUID();
  const generationId2 = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO cro03c_commands
      (id, command_key, idempotency_key, command_type, actor_id, activation_policy_id, activation_revision,
       recipe_version, recipe_hash, stage_plan_hash, runtime_attestation_id, caps, stop_policy_hash,
       approval_evidence, state, expires_at, reason)
    VALUES (${commandId2}::uuid, ${tag("cmd2")}, ${tag("cmd2-idem")}, 'initial_batch', ${tag("actor")}, ${policyId}::uuid, 1,
            1, ${hash64("recipe-hash")}, ${hash64("stageplan-hash")}, ${attestationId}::uuid, '{}'::jsonb, ${hash64("stop-hash")},
            '{}'::jsonb, 'completed', ${expiry}::timestamptz, 'test')
  `);
  await db.execute(sql`
    INSERT INTO cro03c_runs (id, command_id, run_key, mode, state)
    VALUES (${runId2}::uuid, ${commandId2}::uuid, ${tag("run2")}, 'cro03c_live_v1', 'completed')
  `);
  // recipe_version=2 avoids the (handoff_id, recipe_version) unique constraint
  // colliding with run A's generation, which already used version 1 against
  // the same fixture handoff.
  await db.execute(sql`
    INSERT INTO cro03c_generations
      (id, command_id, run_id, handoff_id, recipe_version, recipe_hash, mode, activation_revision,
       frozen_handoff_hash, stage_plan_hash, cohort_hash, runtime_attestation_id, state)
    VALUES (${generationId2}::uuid, ${commandId2}::uuid, ${runId2}::uuid, ${handoff.id}::uuid, 2, ${hash64("recipe-hash2")},
            'cro03c_live_v1', 1, ${hash64("frozen-hash2")}, ${hash64("stageplan-hash2")}, ${hash64("cohort-hash2")},
            ${attestationId}::uuid, 'completed')
  `);
  const defRow2 = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_definitions
      (level, county_scope, vertical_scope, source_adapter_filter, max_cohort_size,
       enrichment_recipe_version, paid_providers_allowed, stop_condition_thresholds,
       pilot_definition_hash, created_by)
    VALUES (2, '[]'::jsonb, '[]'::jsonb, '["google_places"]'::jsonb, 5, 1,
            ${JSON.stringify({ zerobounce: true, serper: false, apollo: true })}::jsonb, '{}'::jsonb,
            ${tag("pilot-def-hash2")}, ${tag("actor")})
    RETURNING id
  `))[0];
  const pilotRun2 = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_runs
      (pilot_definition_id, release_sha, cro03c_selection_policy_version, cro03c_routing_policy_version,
       cro03c_recipe_version, state, cohort_frozen_hash, outbound_pause_epoch)
    VALUES (${defRow2.id}::uuid, ${hash40("release-sha2")}, 1, 1, 1, 'running', ${tag("cohort-frozen-hash2")}, 1)
    RETURNING id
  `))[0];
  const pilotRunId2 = String(pilotRun2.id);
  const biz2 = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, record_class, created_at, updated_at)
    VALUES (${tag("biz2")}, ${tag("biz2").toLowerCase()}, 'test', NOW(), NOW())
    RETURNING id
  `))[0];
  await db.execute(sql`
    INSERT INTO mi09_pilot_cohort_members (pilot_run_id, canonical_business_id, source_adapter_key)
    VALUES (${pilotRunId2}::uuid, ${biz2.id}, 'google_places')
  `);
  await db.execute(sql`
    INSERT INTO mi09_pilot_checkpoints (pilot_run_id, phase, processed_count)
    VALUES (${pilotRunId2}::uuid, 'enrichment', 1)
  `);
  await db.execute(sql`
    INSERT INTO mi09_pilot_effect_links (pilot_run_id, entity_type, entity_id)
    VALUES (${pilotRunId2}::uuid, 'cro03c_command', ${commandId2}::uuid)
  `);
  const zbOpId2 = rows(await db.execute(sql`
    INSERT INTO cro03c_stage_operations
      (generation_id, stage_key, provider, operation_type, operation_key, command_id, caller,
       unit_type, currency, price_schedule_version, price_schedule_hash,
       max_reserved_units, max_reserved_amount_micros, state, terminal_disposition, completed_at)
    VALUES (${generationId2}::uuid, 'business_email_validation', 'zerobounce', 'business_email_validation',
            ${tag("op-zb-2")}, ${commandId2}::uuid, 'test', 'request', 'USD', 1, ${tag("price-hash")},
            1, 1, 'completed', 'consumed', NOW())
    RETURNING id
  `))[0].id;
  await db.execute(sql`
    INSERT INTO cro03c_receipts (generation_id, pilot_run_id, stage_operation_id, receipt_key, receipt_type, normalized_outcome, evidence_hash, settled_units, settled_amount_micros)
    VALUES (${generationId2}::uuid, ${pilotRunId2}::uuid, ${zbOpId2}::uuid, ${tag("receipt-zb-2")}, 'terminal', 'success', ${hash64("evidence-zb-2")}, 1, 1)
  `);
  const attemptId2 = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO cro03c_dispatch_checkpoints (stage_operation_id, attempt_id, checkpoint, authority_hash)
    VALUES (${zbOpId2}::uuid, ${attemptId2}::uuid, 'pre_io', ${hash64("checkpoint-hash-2")})
  `);
  const winnerSelectionId2 = crypto.randomUUID();
  const candidateEvidenceId2 = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO cro03c_candidate_evidence
      (id, generation_id, stage_key, field, subject_type, disposition, confidence,
       envelope_ciphertext, envelope_nonce, envelope_tag, normalized_value_hash, masked_value, business_id)
    VALUES (${candidateEvidenceId2}::uuid, ${generationId2}::uuid, 'business_email_validation', 'email', 'business', 'staged', 90,
            ${tag("envelope-ct-2")}, ${tag("envelope-nonce-2")}, ${tag("envelope-tag-2")}, ${hash64("email-token-2")}, ${tag("masked-email-2")}, ${biz2.id})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_email_winner_selections
      (id, business_id, generation_id, candidate_evidence_id, source, subject_type, confidence, normalized_value_hash, state)
    VALUES (${winnerSelectionId2}::uuid, ${biz2.id}, ${generationId2}::uuid, ${candidateEvidenceId2}::uuid, 'test', 'business', 90, ${hash64("email-token-2")}, 'selected')
  `);
  await db.execute(sql`
    INSERT INTO business_validation_intents
      (business_id, winner_selection_id, candidate_evidence_id, normalized_email_token_hash,
       state, disposition, claim_token, terminal_code, completed_at)
    VALUES (${biz2.id}, ${winnerSelectionId2}::uuid, ${candidateEvidenceId2}::uuid, ${hash64("email-token-2")},
            'completed', 'valid', ${attemptId2}::uuid, 'valid', NOW())
  `);
  await db.execute(sql`
    INSERT INTO master_lead_staging_receipts (cro03_generation_id, pilot_run_id, canonical_business_id, master_lead_id, disposition)
    VALUES (${generationId2}::uuid, ${pilotRunId2}::uuid, ${biz2.id}, NULL, 'suppressed')
  `);
  try {
    await assertPilotEvidenceComplete(pilotRunId2);
    ok("apollo is definition-allowed with ZERO recorded operations while zerobounce (which DID run) has a full evidence chain → apollo's absence is a legitimate no-gap outcome, not a failure → evidence check passes", true);
  } catch (e: any) {
    ok("apollo is definition-allowed with ZERO recorded operations while zerobounce (which DID run) has a full evidence chain → apollo's absence is a legitimate no-gap outcome, not a failure → evidence check passes", false, String(e?.message ?? e));
  }

  // ── Cleanup ──
  // cro03c_activation_policies, cro03c_runtime_attestations,
  // cro03c_deployment_inventories, cro03a_handoffs/qualification tables,
  // and cro03c_receipts are append-only (CRO03[AB]_APPEND_ONLY triggers block
  // DELETE/UPDATE by design, same as the master-lead e2e certification script
  // notes) — cro03c_stage_operations rows referenced by a receipt inherit
  // that immutability transitively (FK RESTRICT). Every row here is scoped to
  // this run's fresh UUIDs, so leaving them in place is safe and matches the
  // established convention for these tables. mi09_pilot_* rows and the test
  // businesses are deletable and are cleaned up below.
  for (const [pRunId, defId, bizId] of [
    [pilotRunId, defRow.id, biz.id],
    [pilotRunId2, defRow2.id, biz2.id],
  ] as const) {
    await db.execute(sql`DELETE FROM master_lead_staging_receipts WHERE pilot_run_id = ${pRunId}::uuid`);
    await db.execute(sql`DELETE FROM mi09_pilot_effect_links WHERE pilot_run_id = ${pRunId}::uuid`);
    await db.execute(sql`DELETE FROM mi09_pilot_checkpoints WHERE pilot_run_id = ${pRunId}::uuid`);
    await db.execute(sql`DELETE FROM mi09_pilot_cohort_members WHERE pilot_run_id = ${pRunId}::uuid`);
    // cro03c_receipts is append-only (CRO03B_APPEND_ONLY) and FK-references
    // this pilot_run_id, so mi09_pilot_runs itself cannot be deleted once a
    // receipt has been written against it — same immutability-by-inheritance
    // as cro03c_generations/stage_operations noted above. Leave the run row
    // in place; it is scoped to this test's fresh UUID.
  }

  console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
