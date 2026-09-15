#!/usr/bin/env tsx
/**
 * Corrective item 3: fail-closed paid completion evidence.
 *
 * Proves assertPilotEvidenceComplete() now blocks a Level 2/3 pilot run from
 * being marked 'completed' unless every paid provider the run's definition
 * allows has reached a terminal disposition on every recorded stage
 * operation — closing the gap where a run could complete with paid spend
 * still 'reserved'/'dispatched' and no durable proof of outcome.
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

  // ── MI-09 pilot definition (level 2, paid providers zerobounce+serper allowed) ──
  const defRow = rows(await db.execute(sql`
    INSERT INTO mi09_pilot_definitions
      (level, county_scope, vertical_scope, source_adapter_filter, max_cohort_size,
       enrichment_recipe_version, paid_providers_allowed, stop_condition_thresholds,
       pilot_definition_hash, created_by)
    VALUES (2, '[]'::jsonb, '[]'::jsonb, '["google_places"]'::jsonb, 5, 1,
            ${JSON.stringify({ zerobounce: true, serper: true, apollo: false })}::jsonb, '{}'::jsonb,
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

  // ── 1. No stage operations at all for any allowed provider → fail-closed.
  // jsonb does not preserve object key insertion order, so which of the two
  // allowed providers (zerobounce/serper) is reported first is not
  // deterministic — assert on either, not a specific one.
  await (async () => {
    try {
      await assertPilotEvidenceComplete(pilotRunId);
      ok("no operations recorded for either allowed paid provider → PILOT_EVIDENCE_MISSING (fail-closed, not silently passing)", false, "did not throw");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const matches = msg === "PILOT_EVIDENCE_MISSING:paid_provider_no_operations:zerobounce" ||
        msg === "PILOT_EVIDENCE_MISSING:paid_provider_no_operations:serper";
      ok("no operations recorded for either allowed paid provider → PILOT_EVIDENCE_MISSING (fail-closed, not silently passing)", matches, msg);
    }
  })();

  // ── 2. zerobounce has an operation, but serper (also allowed) has none → still fails on serper ──
  await db.execute(sql`
    INSERT INTO cro03c_stage_operations
      (generation_id, stage_key, provider, operation_type, operation_key, command_id, caller,
       unit_type, currency, price_schedule_version, price_schedule_hash,
       max_reserved_units, max_reserved_amount_micros, state, terminal_disposition, completed_at)
    VALUES (${generationId}::uuid, 'business_email_validation', 'zerobounce', 'business_email_validation',
            ${tag("op-zb-1")}, ${commandId}::uuid, 'test', 'request', 'USD', 1, ${tag("price-hash")},
            1, 1, 'completed', 'consumed', NOW())
  `);
  await throws(
    "zerobounce terminal but serper (also allowed) has zero operations → still fails on serper",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_MISSING:paid_provider_no_operations:serper",
  );

  // ── 3. serper operation exists but stuck 'reserved' (non-terminal) → fails ──
  await db.execute(sql`
    INSERT INTO cro03c_stage_operations
      (generation_id, stage_key, provider, operation_type, operation_key, command_id, caller,
       unit_type, currency, price_schedule_version, price_schedule_hash,
       max_reserved_units, max_reserved_amount_micros, state)
    VALUES (${generationId}::uuid, 'business_email_search', 'serper', 'business_email_search',
            ${tag("op-serper-1")}, ${commandId}::uuid, 'test', 'request', 'USD', 1, ${tag("price-hash")},
            1, 1, 'reserved')
  `);
  await throws(
    "serper operation still 'reserved' (never dispatched/settled) → PILOT_EVIDENCE_INCOMPLETE (non-terminal)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:paid_provider_non_terminal:serper=1/1",
  );

  // ── 4. serper operation reaches 'completed' with terminal_disposition set → fixture is now fully terminal ──
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET state = 'completed', terminal_disposition = 'consumed', completed_at = NOW()
     WHERE operation_key = ${tag("op-serper-1")}
  `);
  await db.execute(sql`
    UPDATE mi09_pilot_enrichment_outcomes SET id = id WHERE FALSE
  `); // no-op guard: level-2 branch does not require level-1 enrichment-outcome rows
  try {
    await assertPilotEvidenceComplete(pilotRunId);
    ok("all allowed-provider operations terminal (zerobounce + serper both 'completed'/'consumed') → evidence check passes", true);
  } catch (e: any) {
    ok("all allowed-provider operations terminal (zerobounce + serper both 'completed'/'consumed') → evidence check passes", false, String(e?.message ?? e));
  }

  // ── 5. A 'completed' state with terminal_disposition left NULL is still treated as non-terminal (silent-completion guard) ──
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET terminal_disposition = NULL
     WHERE operation_key = ${tag("op-serper-1")}
  `);
  await throws(
    "'completed' state but terminal_disposition left NULL → still counted non-terminal (guards against a silent-completion bug re-appearing)",
    () => assertPilotEvidenceComplete(pilotRunId),
    "PILOT_EVIDENCE_INCOMPLETE:paid_provider_non_terminal:serper=1/1",
  );

  // ── Cleanup ──
  // cro03c_activation_policies, cro03c_runtime_attestations,
  // cro03c_deployment_inventories, and cro03a_handoffs/qualification tables
  // are append-only (CRO03[AB]_APPEND_ONLY triggers block DELETE/UPDATE by
  // design, same as the master-lead e2e certification script notes) — every
  // row here is scoped to this run's fresh UUIDs, so leaving them in place is
  // safe and matches the established convention for these tables.
  await db.execute(sql`DELETE FROM cro03c_stage_operations WHERE command_id = ${commandId}::uuid`);
  await db.execute(sql`DELETE FROM mi09_pilot_effect_links WHERE pilot_run_id = ${pilotRunId}::uuid`);
  await db.execute(sql`DELETE FROM mi09_pilot_checkpoints WHERE pilot_run_id = ${pilotRunId}::uuid`);
  await db.execute(sql`DELETE FROM mi09_pilot_cohort_members WHERE pilot_run_id = ${pilotRunId}::uuid`);
  await db.execute(sql`DELETE FROM mi09_pilot_runs WHERE id = ${pilotRunId}::uuid`);
  await db.execute(sql`DELETE FROM mi09_pilot_definitions WHERE id = ${defRow.id}::uuid`);
  await db.execute(sql`DELETE FROM canonical_source_links WHERE business_id = ${biz.id}`);
  await db.execute(sql`DELETE FROM businesses WHERE id = ${biz.id}`);
  await db.execute(sql`DELETE FROM cro03c_generations WHERE id = ${generationId}::uuid`);
  await db.execute(sql`DELETE FROM cro03c_runs WHERE id = ${runId}::uuid`);
  await db.execute(sql`DELETE FROM cro03c_commands WHERE id = ${commandId}::uuid`);

  console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
