/**
 * Disposable integration test for CRO-08A: Continuous Candidate Factory.
 * Exercises the required invariants from the task's five mandatory
 * corrections. Run with: npx tsx scripts/test-cro08a-continuous-factory.ts
 *
 * This uses real DB rows (test-prefixed) against the configured database and
 * cleans them up at the end. It performs zero provider network I/O and zero
 * campaign/CR-04/CR-06/messaging effects.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  createCro08aScheduleDefinition, activateCro08aScheduleDefinition,
  CRO08A_OWNED_LOGICAL_KEYS, CRO08A_EXCLUDED_SCHEDULE_KEYS, Cro08aCertificationDeniedError,
} from "../server/services/cro08a/schedule-authority";
import {
  ensureCro08aScheduleOccurrence, commitCro08aEnumerationCheckpoint,
  bindCro08aOccurrenceCommand, tryCompleteCro08aReconciliation, cancelCro08aScheduleOccurrence,
} from "../server/services/cro08a/occurrence-service";
import { rolloverProviderBudgetPeriod, getProviderBudgetPeriodHistory } from "../server/services/cro08a/provider-budget-rollover";
import {
  withCro08aContinuousOccurrenceEffectFence, denyCro08aForbiddenEffect,
} from "../server/services/cro03/cro08a-effect-fence";
import {
  createCro03cCommand, CRO03C_CONTINUOUS_MODE, CRO03C_CANARY_MODE, CRO03C_MODE, CRO03C_PROVIDER_CONTRACTS, CRO03C_MIGRATION_HEAD,
  reserveCro03cProviderOperation, resolveCro03cGenerationMode,
} from "../server/services/cro03/live-execution";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";
import { issueCro08aCertificationReceipt } from "../server/services/cro08a/certification-gate";
import { getPauseState, invalidatePauseStateCache } from "../server/services/outbound-pause-authority";
import { createCro03SourceBatch, hashCro03Evidence } from "../server/services/cro03/source-staging";
import { createCro03aQualificationRun, processCro03aQualificationRunQueueSafe } from "../server/services/cro03a/qualification-service";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const RUN = `cro08a-test-${Date.now()}`;
const hex64 = (seed: string) => crypto.createHash("sha256").update(seed).digest("hex");
const hex40 = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");
process.env.RELEASE_SHA ??= hex40(`cro08a-release:${RUN}`);
let failures = 0;

function ok(name: string, fn: () => Promise<void>) {
  return fn().then(() => console.log(`  PASS  ${name}`)).catch((err) => {
    failures++;
    console.error(`  FAIL  ${name}: ${err?.message ?? err}${err?.cause?.message ? ` | cause: ${err.cause.message}` : ""}`);
  });
}

async function main() {
  console.log(`CRO-08A continuous factory test run: ${RUN}`);

  // Clean up any residue left behind by a prior interrupted run of this
  // script (e.g. a crash before its own cleanup section ran). This test's
  // fixtures are deterministic (fixed definitionHash/window), so stale rows
  // from a previous aborted run would otherwise make idempotency assertions
  // observe "already exists" instead of "freshly created".
  await db.execute(sql`DELETE FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id IN (SELECT id FROM cro08a_schedule_occurrences WHERE schedule_definition_id IN (SELECT id FROM cro08a_schedule_definitions WHERE downstream_owner='cro08a-test'))`);
  await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE schedule_definition_id IN (SELECT id FROM cro08a_schedule_definitions WHERE downstream_owner='cro08a-test')`);
  await db.execute(sql`DELETE FROM cro08a_schedule_definitions WHERE downstream_owner='cro08a-test'`);
  // cro03c_commands/cro03c_runs are NOT append-only themselves, but any run
  // that has an append-only cro03c_forbidden_effects row FK-referencing it
  // (cro03c_forbidden_effects_run_id_fkey) cannot be deleted transitively —
  // and cro03c_forbidden_effects, cro03c_runtime_attestations,
  // cro03c_deployment_inventories, and cro03c_activation_policies are all
  // append-only by design (cro03b_append_only_guard trigger forbids UPDATE
  // and DELETE). So none of these are deleted here; stub rows from earlier
  // runs are left in place permanently as harmless, clearly test-tagged
  // (created_by/idempotency_key/actor_id contain the RUN id) residue,
  // matching how the immutable provider_budget_period_ledger is treated
  // below.
  await db.execute(sql`DELETE FROM provider_controls WHERE provider LIKE 'cro08a-test-provider-%'`).catch(() => {});

  // --- Correction 3: schedule scope ---------------------------------------
  await ok("owned logical keys never intersect the excluded-schedule census", async () => {
    for (const key of CRO08A_OWNED_LOGICAL_KEYS) {
      assert.ok(!CRO08A_EXCLUDED_SCHEDULE_KEYS.includes(key as any), `${key} must not be excluded`);
    }
  });

  await ok("schedule definition outside discovery/enrichment/freshness/backfill is rejected", async () => {
    await assert.rejects(
      createCro08aScheduleDefinition({
        logicalKey: "ghl_sync" as any, purpose: "x", sourceRecipePolicyVersions: {}, cadenceCron: "*/5 * * * *",
        windowSeconds: 300, batchSize: 10, concurrencyLimit: 1, cursorSemantics: {}, budgets: {},
        timeoutMs: 60000, leaseMs: 60000, heartbeatMs: 15000, retryPolicy: {}, deadLetterPolicy: {},
        downstreamOwner: "test", createdBy: RUN,
      }),
      /CRO08A_SCHEDULE_LOGICAL_KEY_OUT_OF_SCOPE/,
    );
  });

  await ok("a malformed budgets shape is rejected at definition-creation time, not deferred to command creation", async () => {
    const base = {
      logicalKey: "candidate_enrichment" as const, purpose: "bad budgets", sourceRecipePolicyVersions: {},
      cadenceCron: "*/10 * * * *", windowSeconds: 600, batchSize: 25, concurrencyLimit: 2,
      cursorSemantics: {}, timeoutMs: 120000, leaseMs: 120000, heartbeatMs: 30000,
      retryPolicy: {}, deadLetterPolicy: {}, downstreamOwner: "cro08a-test", createdBy: RUN,
    };
    await assert.rejects(createCro08aScheduleDefinition({ ...base, budgets: { zerobounce: { maxUnitsPerOccurrence: -1 } } }), /CRO08A_SCHEDULE_BUDGETS_INVALID/);
    await assert.rejects(createCro08aScheduleDefinition({ ...base, budgets: { zerobounce: { maxUnitsPerOccurrence: 1.5 } } }), /CRO08A_SCHEDULE_BUDGETS_INVALID/);
    await assert.rejects(createCro08aScheduleDefinition({ ...base, budgets: { zerobounce: {} } }), /CRO08A_SCHEDULE_BUDGETS_INVALID/);
    await assert.rejects(createCro08aScheduleDefinition({ ...base, budgets: { zerobounce: "unlimited" as any } }), /CRO08A_SCHEDULE_BUDGETS_INVALID/);
    await assert.rejects(createCro08aScheduleDefinition({ ...base, budgets: [1, 2] as any }), /CRO08A_SCHEDULE_BUDGETS_INVALID/);
    // An empty budgets object is still a valid (if inert) definition — it
    // simply cannot back any continuous_occurrence command yet.
    const empty = await createCro08aScheduleDefinition({ ...base, budgets: {} });
    assert.ok(empty.id);
  });

  let definitionId = "";
  let definitionHash = "";
  await ok("in-scope schedule definition is created and DB CHECK also accepts it", async () => {
    const def = await createCro08aScheduleDefinition({
      logicalKey: "candidate_enrichment", purpose: "test enrichment schedule", sourceRecipePolicyVersions: { recipe: 1 },
      cadenceCron: "*/10 * * * *", windowSeconds: 600, batchSize: 25, concurrencyLimit: 2,
      cursorSemantics: { sourceSystem: "sunbiz" }, budgets: { zerobounce: { maxUnitsPerOccurrence: 100 } },
      timeoutMs: 120000, leaseMs: 120000, heartbeatMs: 30000, retryPolicy: { maxAttempts: 3 },
      deadLetterPolicy: { maxAttempts: 5 }, downstreamOwner: "cro08a-test", createdBy: RUN,
    });
    definitionId = def.id;
    definitionHash = def.definitionHash;
    assert.ok(definitionId);
  });

  // --- Correction 4: certification gate -----------------------------------
  await ok("schedule activation is denied without a matching CRO-03D certification receipt", async () => {
    await assert.rejects(
      activateCro08aScheduleDefinition({ definitionId, activatedBy: RUN, reason: "test" }),
      Cro08aCertificationDeniedError,
    );
    const row = rows(await db.execute(sql`SELECT active FROM cro08a_schedule_definitions WHERE id=${definitionId}::uuid`))[0];
    assert.equal(row.active, false, "definition must remain inactive after a denied activation attempt");
  });

  // --- Correction 2: durable occurrence + dual checkpoints ----------------
  let occurrenceId = "";
  const windowStart = new Date("2026-08-30T00:00:00Z");
  const windowEnd = new Date("2026-08-30T00:10:00Z");
  await ok("occurrence creation is idempotent per (definition, window)", async () => {
    const first = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: definitionId, definitionHash, windowStart, windowEnd,
      frozenCursorSnapshot: { sunbiz: { cursor: "abc123" } }, reason: "test window",
    });
    occurrenceId = first.id;
    assert.equal(first.created, true);
    const second = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: definitionId, definitionHash, windowStart, windowEnd,
      frozenCursorSnapshot: { sunbiz: { cursor: "SHOULD_NOT_OVERWRITE" } }, reason: "test window replay",
    });
    assert.equal(second.created, false);
    assert.equal(second.id, occurrenceId);
    const snap = rows(await db.execute(sql`SELECT frozen_cursor_snapshot FROM cro08a_schedule_occurrences WHERE id=${occurrenceId}::uuid`))[0];
    assert.equal(snap.frozen_cursor_snapshot.sunbiz.cursor, "abc123", "frozen snapshot must not change on replay even if a later cursor advanced");
  });

  // --- reviewer finding: occurrence claim must be atomic under concurrency,
  // not a read-then-insert race that raw-fails on the losing side.
  await ok("concurrent occurrence claims for the same due window collapse to exactly one row, never a raw unique-constraint error", async () => {
    const concurrentWindowStart = new Date("2026-08-30T05:00:00Z");
    const concurrentWindowEnd = new Date("2026-08-30T05:10:00Z");
    const attempts = await Promise.all(Array.from({ length: 5 }, () => ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: definitionId, definitionHash, windowStart: concurrentWindowStart, windowEnd: concurrentWindowEnd,
      frozenCursorSnapshot: { sunbiz: { cursor: "concurrent-race" } }, reason: "concurrency test",
    })));
    const ids = new Set(attempts.map((a) => a.id));
    assert.equal(ids.size, 1, "every concurrent claim for the same window must resolve to the same single occurrence row");
    assert.equal(attempts.filter((a) => a.created).length, 1, "exactly one of the concurrent attempts must report having created the row");
    const count = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cro08a_schedule_occurrences
       WHERE schedule_definition_id=${definitionId}::uuid AND window_start=${concurrentWindowStart.toISOString()}::timestamptz
    `))[0];
    assert.equal(count.n, 1, "the DB must contain exactly one row for the contested window, not a partial/duplicate insert");
  });

  // --- reviewer finding: an occurrence must be bound to the definition's
  // REAL current hash, not any caller-supplied string.
  await ok("ensureCro08aScheduleOccurrence rejects a definitionHash that does not match the schedule definition's real stored hash", async () => {
    await assert.rejects(
      ensureCro08aScheduleOccurrence({
        scheduleDefinitionId: definitionId, definitionHash: "not-the-real-hash",
        windowStart: new Date("2026-08-30T06:00:00Z"), windowEnd: new Date("2026-08-30T06:10:00Z"),
        frozenCursorSnapshot: {},
      }),
      /CRO08A_DEFINITION_HASH_MISMATCH/,
    );
  });

  // Real cro03a_handoffs rows are required (not random UUIDs) for any
  // selectedHandoffIds that will later back a cro03c_generations insert --
  // cro03c_generations.handoff_id has a hard FK to cro03a_handoffs(id).
  // This drives one subject through the full CRO-03A source->qualification
  // pipeline per handoff (same pattern as fullPathHandoffId below) and
  // returns its real handoff id.
  async function createRealCro03aHandoff(suffix: string): Promise<string> {
    const subjectKey = `cro08a-recon-${suffix}-${RUN}`;
    await createCro03SourceBatch({
      idempotencyKey: `cro08a-recon-source:${suffix}:${RUN}`, actorType: "system", actorId: "cro08a-test",
      purpose: "staging_review",
      subjects: [{
        subjectType: "prospect", subjectKey, sourceSystem: "prospects",
        sourceObservedAt: new Date().toISOString(), sourceEventKey: `cro08a-recon-event:${suffix}:${RUN}`,
        timestampProvenance: "source", provenance: { test: true },
        payload: { businessName: `CRO08A Recon ${suffix} ${RUN}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
          city: "Miami", state: "FL", county: "Miami-Dade", industry: "Auto", entityStatus: "active" },
        candidateValues: { business_name: `CRO08A Recon ${suffix} ${RUN}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
          city: "Miami", state: "FL", category: "Auto", entity_status: "active" },
      }],
    });
    const occurrence = rows(await db.execute(sql`
      SELECT id FROM cro03_source_occurrences WHERE source_event_key=${`cro08a-recon-event:${suffix}:${RUN}`}
    `))[0];
    const qualification = await createCro03aQualificationRun({
      idempotencyKey: `cro08a-recon-qualification:${suffix}:${RUN}`, occurrenceIds: [occurrence.id],
      actorId: RUN, actorRole: "admin",
    });
    await processCro03aQualificationRunQueueSafe(qualification.id);
    const result = rows(await db.execute(sql`SELECT id FROM cro03a_handoffs WHERE run_id=${qualification.id}::uuid`))[0];
    assert.ok(result, `fixture must produce an eligible CRO-03A handoff for reconciliation-test subject ${suffix}`);
    return String(result.id);
  }

  const claimToken = crypto.randomUUID();
  const selectedHandoffIds = [
    await createRealCro03aHandoff("h1"),
    await createRealCro03aHandoff("h2"),
    await createRealCro03aHandoff("h3"),
  ];
  await ok("enumeration checkpoint commits once and rejects a conflicting replay", async () => {
    await commitCro08aEnumerationCheckpoint({ occurrenceId, claimToken: "n/a", selectedCount: 3, selectionReceiptHash: "should-fail", selectedHandoffIds }).catch(() => {});
    // claim first (occurrence-service requires the claim token to match on commit)
    await db.execute(sql`UPDATE cro08a_schedule_occurrences SET claim_token=${claimToken}::uuid WHERE id=${occurrenceId}::uuid`);
    await commitCro08aEnumerationCheckpoint({ occurrenceId, claimToken, selectedCount: 3, selectionReceiptHash: "receipt-1", selectedHandoffIds });
    // idempotent replay with same hash is a no-op
    await commitCro08aEnumerationCheckpoint({ occurrenceId, claimToken, selectedCount: 3, selectionReceiptHash: "receipt-1", selectedHandoffIds });
    // conflicting replay is rejected
    await assert.rejects(
      commitCro08aEnumerationCheckpoint({ occurrenceId, claimToken, selectedCount: 3, selectionReceiptHash: "receipt-2", selectedHandoffIds }),
      /CRO08A_ENUMERATION_ALREADY_COMMITTED_CONFLICT/,
    );
    const row = rows(await db.execute(sql`SELECT enumeration_checkpoint, reconciliation_checkpoint FROM cro08a_schedule_occurrences WHERE id=${occurrenceId}::uuid`))[0];
    assert.equal(row.enumeration_checkpoint, "committed");
    assert.equal(row.reconciliation_checkpoint, "pending", "reconciliation must remain pending independent of enumeration");
    const persisted = rows(await db.execute(sql`SELECT handoff_id FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id=${occurrenceId}::uuid`));
    assert.equal(persisted.length, 3, "the exact selected-handoff population must be durably persisted, not just a count");
  });

  await ok("commitCro08aEnumerationCheckpoint rejects a selectedHandoffIds list that doesn't match selectedCount", async () => {
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: definitionId, definitionHash,
      windowStart: new Date("2026-08-30T01:00:00Z"), windowEnd: new Date("2026-08-30T01:10:00Z"),
      frozenCursorSnapshot: {},
    });
    const token = crypto.randomUUID();
    await db.execute(sql`UPDATE cro08a_schedule_occurrences SET claim_token=${token}::uuid WHERE id=${occ.id}::uuid`);
    await assert.rejects(
      commitCro08aEnumerationCheckpoint({
        occurrenceId: occ.id, claimToken: token, selectedCount: 3, selectionReceiptHash: "mismatch-receipt",
        selectedHandoffIds: [crypto.randomUUID(), crypto.randomUUID()],
      }),
      /CRO08A_SELECTED_HANDOFFS_COUNT_MISMATCH/,
    );
    await assert.rejects(
      commitCro08aEnumerationCheckpoint({
        occurrenceId: occ.id, claimToken: token, selectedCount: 2, selectionReceiptHash: "mismatch-receipt-2",
        selectedHandoffIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
      }),
      /CRO08A_SELECTED_HANDOFFS_COUNT_MISMATCH/,
    );
    await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE id=${occ.id}::uuid`);
  });

  // Hoisted to outer scope so the reconciliation-completeness test below can
  // stub cro03c_generations rows against the same command/attestation.
  const commandA = crypto.randomUUID();
  const attestationId = crypto.randomUUID();
  await ok("exactly one continuous_occurrence command binds to an occurrence under concurrent claim attempts", async () => {
    const commandB = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_activation_policies (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
      VALUES (gen_random_uuid(),${`fk-stub:${RUN}`},${`fk-stub-policy:${RUN}`},1,'{}'::jsonb,${"4".repeat(64)},'{}'::jsonb,'{}'::jsonb,'draft',1,'fk stub only',${RUN}) ON CONFLICT DO NOTHING`);
    // Minimal FK-satisfying stub rows (commands need a runtime_attestation_id
    // and activation_policy_id FK; this test only exercises the occurrence
    // binding race, not full CRO-03C command authority, so stub rows are
    // acceptable here and are cleaned up with everything else).
    const inventoryId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_deployment_inventories (id,issuer_id,deployment_identity,environment_identity,release_sha,queue_topology_hash,identity_kind,worker_identities,expected_count,issued_at,expires_at,payload,payload_hash,signature,created_by)
      VALUES (${inventoryId}::uuid,'test','test','test',${hex40(`sha:${RUN}`)},${hex64(`qth:${RUN}`)},'worker','["stub-worker"]'::jsonb,1,NOW(),NOW()+interval '1 hour','{}'::jsonb,${hex64(`payload:${RUN}`)},'stub-sig',${RUN})`);
    await db.execute(sql`INSERT INTO cro03c_runtime_attestations (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,expires_at,attestation_hash,created_by)
      VALUES (${attestationId}::uuid,${`fk-stub-att:${RUN}`},${inventoryId}::uuid,'[]'::jsonb,${hex40(`sha:${RUN}`)},'stub-head','test','test','w','w',${hex64(`qth:${RUN}`)},NOW(),TRUE,TRUE,NOW()+interval '1 hour',${hex64(`att:${RUN}`)},${RUN})`);
    async function stubCommand(id: string) {
      await db.execute(sql`INSERT INTO cro03c_commands (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,expires_at,reason,pre_pause_epoch)
        SELECT ${id}::uuid,${`fk-stub-key:${id}`},${`fk-stub-idem:${id}`},'continuous_occurrence',${RUN},ap.id,1,1,${hex64(`recipe:${id}`)},${hex64(`stageplan:${id}`)},${attestationId}::uuid,'{}'::jsonb,${hex64(`stoppolicy:${id}`)},'{}'::jsonb,NOW()+interval '1 hour','stub',0
          FROM cro03c_activation_policies ap WHERE ap.idempotency_key=${`fk-stub:${RUN}`}`);
    }
    await stubCommand(commandA);
    await stubCommand(commandB);
    await bindCro08aOccurrenceCommand({ occurrenceId, cro03cCommandId: commandA });
    await assert.rejects(
      bindCro08aOccurrenceCommand({ occurrenceId, cro03cCommandId: commandB }),
      /CRO08A_OCCURRENCE_ALREADY_BOUND_TO_DIFFERENT_COMMAND/,
    );
    const row = rows(await db.execute(sql`SELECT cro03c_command_id FROM cro08a_schedule_occurrences WHERE id=${occurrenceId}::uuid`))[0];
    assert.equal(row.cro03c_command_id, commandA);
    // DB-level guarantee: the unique index also forbids two occurrences
    // pointing at the same command.
    const otherOccurrence = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: definitionId, definitionHash,
      windowStart: new Date("2026-08-30T00:10:00Z"), windowEnd: new Date("2026-08-30T00:20:00Z"),
      frozenCursorSnapshot: {},
    });
    await assert.rejects(
      db.execute(sql`UPDATE cro08a_schedule_occurrences SET cro03c_command_id=${commandA}::uuid WHERE id=${otherOccurrence.id}::uuid`),
      (err: any) => /duplicate key|unique/i.test(String(err?.cause?.message ?? err?.message ?? "")),
    );
  });

  // --- reviewer finding #2: reconciliation completeness must be checked
  // against the occurrence's OWN durable selected-handoff population, not
  // merely against whatever stage_operations rows happen to exist. This
  // occurrence's enumeration step above durably selected 3 handoffs
  // (selectedHandoffIds); commandA is bound but, at this point, has zero
  // cro03c_generations rows for any of them.
  await ok("reconciliation checkpoint stays pending with non-terminal work and completes once all terminal", async () => {
    const noGenerations = await tryCompleteCro08aReconciliation(occurrenceId);
    assert.equal(noGenerations.completed, false, "3 handoffs were durably selected but none have a generation yet for the bound command -- must not reconcile as complete");
    assert.equal(noGenerations.pendingCount, 3);

    // Simulate CRO-03C generating 2 of the 3 selected handoffs, one terminal
    // (completed) and one still in-flight (running). Uses direct stub inserts
    // (same pattern as the earlier concurrency test) since driving a real
    // generation to a terminal state requires the full CRO-03A eligibility
    // path this environment cannot clear (see the full-path test's comment).
    const [h1, h2] = selectedHandoffIds;
    // cro03c_generations.run_id has a hard FK to cro03c_runs(id); command_id
    // is UNIQUE on cro03c_runs but NOT unique on cro03c_generations, so one
    // stub run row can back all three stub generations for commandA.
    const reconRunId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO cro03c_runs (id,command_id,run_key,mode,state)
      VALUES (${reconRunId}::uuid,${commandA}::uuid,${`recon-run:${RUN}`},${CRO03C_CONTINUOUS_MODE},'completed')
    `);
    async function stubGeneration(handoffId: string, state: string) {
      await db.execute(sql`
        INSERT INTO cro03c_generations
          (handoff_id,recipe_version,recipe_hash,mode,activation_revision,command_id,run_id,
           frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id,state)
        VALUES (${handoffId}::uuid,999,${hex64(`recipe:${handoffId}`)},${CRO03C_CONTINUOUS_MODE},1,${commandA}::uuid,
                ${reconRunId}::uuid,${hex64(`frozen:${handoffId}`)},${hex64(`stageplan:${handoffId}`)},${hex64(`cohort:${handoffId}`)},
                ${attestationId}::uuid,${state})
      `);
    }
    await stubGeneration(h1, "completed");
    await stubGeneration(h2, "running");
    const partial = await tryCompleteCro08aReconciliation(occurrenceId);
    assert.equal(partial.completed, false, "one selected handoff still has no generation and another is non-terminal -- must stay pending");
    assert.equal(partial.pendingCount, 2, "the missing-generation handoff and the running generation both count as pending");
    assert.equal(partial.terminalCount, 1);

    // Finish the remaining two: the still-missing handoff gets its generation,
    // and the running one is marked completed.
    const [, , h3] = selectedHandoffIds;
    await stubGeneration(h3, "completed");
    await db.execute(sql`UPDATE cro03c_generations SET state='completed' WHERE handoff_id=${h2}::uuid AND command_id=${commandA}::uuid`);
    const finished = await tryCompleteCro08aReconciliation(occurrenceId);
    assert.equal(finished.completed, true, "every selected handoff now has a terminal generation -- reconciliation must complete");
    assert.equal(finished.pendingCount, 0);
    assert.equal(finished.terminalCount, 3);
    const row = rows(await db.execute(sql`SELECT reconciliation_checkpoint FROM cro08a_schedule_occurrences WHERE id=${occurrenceId}::uuid`))[0];
    assert.equal(row.reconciliation_checkpoint, "complete");
  });

  await ok("cancellation preserves already-reconciled state instead of overwriting it", async () => {
    await cancelCro08aScheduleOccurrence(occurrenceId);
    const row = rows(await db.execute(sql`SELECT state FROM cro08a_schedule_occurrences WHERE id=${occurrenceId}::uuid`))[0];
    assert.equal(row.state, "reconciled", "a reconciled occurrence must not be overwritten to cancelled");
  });

  // --- reviewer finding: run-mode and generation-mode selection previously
  // diverged (generation insert was hardcoded to CRO03C_MODE regardless of
  // commandType). Both insert sites now call this one pure function, so
  // asserting its mapping directly is an exact proxy for what every
  // committed cro03c_runs/cro03c_generations row's mode column will contain
  // -- without needing to clear the permanent CRO-03A effect_authorized=
  // FALSE wall (see the full-path test above) that otherwise makes a fully
  // committed continuous_occurrence generation row unreachable in this
  // environment.
  await ok("resolveCro03cGenerationMode maps each command type to its own distinct mode, never falling back to the plain-live mode", async () => {
    assert.equal(resolveCro03cGenerationMode("continuous_occurrence"), CRO03C_CONTINUOUS_MODE);
    assert.equal(resolveCro03cGenerationMode("micro_canary"), CRO03C_CANARY_MODE);
    assert.equal(resolveCro03cGenerationMode("initial_batch"), CRO03C_MODE);
    assert.notEqual(resolveCro03cGenerationMode("continuous_occurrence"), CRO03C_MODE);
  });

  // --- reviewer finding: the pure-function unit test above proves the
  // MAPPING is correct, but does not prove the DB CHECK constraint actually
  // accepts every mode the mapper can produce. Migration 0216 widened
  // cro03c_generation_mode_chk for cro03c_live_v1/cro03c_continuous_occurrence_v1
  // but missed the pre-existing cro03c_micro_canary_v1 literal -- a real
  // regression that a pure-function test alone could not catch. 0217 fixes
  // the constraint; this test proves it end-to-end with a real INSERT
  // against the live constraint (not just calling the mapper function).
  await ok("cro03c_generations CHECK constraint accepts a real micro_canary-mode insert post-migration", async () => {
    const canaryRunId = crypto.randomUUID();
    const canaryCommandId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_activation_policies (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
      VALUES (gen_random_uuid(),${`fk-stub-canary:${RUN}`},${`fk-stub-canary-policy:${RUN}`},1,'{}'::jsonb,${"5".repeat(64)},'{}'::jsonb,'{}'::jsonb,'draft',1,'fk stub only',${RUN}) ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO cro03c_commands (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,expires_at,reason,pre_pause_epoch)
      SELECT ${canaryCommandId}::uuid,${`fk-stub-canary-key:${RUN}`},${`fk-stub-canary-idem:${RUN}`},'micro_canary',${RUN},ap.id,1,1,${hex64(`canary-recipe:${RUN}`)},${hex64(`canary-stageplan:${RUN}`)},${attestationId}::uuid,'{}'::jsonb,${hex64(`canary-stoppolicy:${RUN}`)},'{}'::jsonb,NOW()+interval '1 hour','stub',0
        FROM cro03c_activation_policies ap WHERE ap.idempotency_key=${`fk-stub-canary:${RUN}`}`);
    await db.execute(sql`INSERT INTO cro03c_runs (id,command_id,run_key,mode,state)
      VALUES (${canaryRunId}::uuid,${canaryCommandId}::uuid,${`canary-run:${RUN}`},${resolveCro03cGenerationMode("micro_canary")},'completed')`);
    const [canaryHandoffId] = selectedHandoffIds;
    await db.execute(sql`
      INSERT INTO cro03c_generations
        (handoff_id,recipe_version,recipe_hash,mode,activation_revision,command_id,run_id,
         frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id,state)
      VALUES (${canaryHandoffId}::uuid,1000,${hex64(`canary-gen-recipe:${RUN}`)},${resolveCro03cGenerationMode("micro_canary")},1,${canaryCommandId}::uuid,
              ${canaryRunId}::uuid,${hex64(`canary-frozen:${RUN}`)},${hex64(`canary-stageplan:${RUN}`)},${hex64(`canary-cohort:${RUN}`)},
              ${attestationId}::uuid,'completed')
    `);
    const gen = rows(await db.execute(sql`SELECT mode FROM cro03c_generations WHERE command_id=${canaryCommandId}::uuid`))[0];
    assert.equal(gen.mode, CRO03C_CANARY_MODE, "the real DB row must carry the canary mode, proving the CHECK constraint accepts it");
  });

  // --- Correction 1: continuous_occurrence never touches initial_rollouts --
  await ok("continuous_occurrence command creation never reads or writes cro03c_initial_rollouts", async () => {
    const before = rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM cro03c_initial_rollouts`))[0];
    await createCro03cCommand({
      actorId: RUN, idempotencyKey: `cro08a-cont-${RUN}`, commandType: "continuous_occurrence",
      expectedActivationRevision: 999999, runtimeAttestationId: crypto.randomUUID(),
      handoffIds: [crypto.randomUUID()], provider: "zerobounce", maxUnits: 10, maxAmountMicros: 1000,
      reason: "cro08a test", expiresAt: new Date(Date.now() + 3600_000),
      scheduleOccurrenceId: occurrenceId, scheduleDefinitionHash: "test-hash",
    }).catch((err) => {
      // Expected to fail well before touching initial_rollouts (activation
      // revision/policy will not match in this disposable harness) — the
      // assertion below is what actually matters for this test.
      assert.ok(!/initial_rollout/i.test(String(err?.message)), `unexpected initial_rollout coupling: ${err?.message}`);
    });
    const after = rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM cro03c_initial_rollouts`))[0];
    assert.equal(after.n, before.n, "cro03c_initial_rollouts must be untouched by any continuous_occurrence path");
  });

  await ok("createCro03cCommand rejects a continuous_occurrence request missing the schedule occurrence binding", async () => {
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-missing-occ-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: 1, runtimeAttestationId: crypto.randomUUID(), handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 10, maxAmountMicros: 1000, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
      } as any),
      /CRO08A_SCHEDULE_OCCURRENCE_REQUIRED/,
    );
  });

  // --- Correction 1: dedicated forbidden-effect fence ---------------------
  await ok("dedicated continuous_occurrence forbidden-effect fence denies without touching the initial_batch fence", async () => {
    const attestationId = crypto.randomUUID();
    const inventoryId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_deployment_inventories (id,issuer_id,deployment_identity,environment_identity,release_sha,queue_topology_hash,identity_kind,worker_identities,expected_count,issued_at,expires_at,payload,payload_hash,signature,created_by)
      VALUES (${inventoryId}::uuid,'test','test','test',${hex40(`sha2:${RUN}`)},${hex64(`qth2:${RUN}`)},'worker','["stub-worker"]'::jsonb,1,NOW(),NOW()+interval '1 hour','{}'::jsonb,${hex64(`payload2:${RUN}`)},'stub-sig2',${RUN})`);
    await db.execute(sql`INSERT INTO cro03c_runtime_attestations (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,expires_at,attestation_hash,created_by)
      VALUES (${attestationId}::uuid,${`fk-stub-att2:${RUN}`},${inventoryId}::uuid,'[]'::jsonb,${hex40(`sha2:${RUN}`)},'stub-head','test','test','w','w',${hex64(`qth2:${RUN}`)},NOW(),TRUE,TRUE,NOW()+interval '1 hour',${hex64(`att2:${RUN}`)},${RUN})`);
    const commandId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_commands (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,expires_at,reason,pre_pause_epoch)
      SELECT ${commandId}::uuid,${`fence-key:${RUN}`},${`fence-idem:${RUN}`},'continuous_occurrence',${RUN},ap.id,1,1,${hex64(`fence-recipe:${RUN}`)},${hex64(`fence-stageplan:${RUN}`)},${attestationId}::uuid,'{}'::jsonb,${hex64(`fence-stoppolicy:${RUN}`)},'{}'::jsonb,NOW()+interval '1 hour','stub',0
        FROM cro03c_activation_policies ap WHERE ap.idempotency_key=${`fk-stub:${RUN}`}`);
    await db.execute(sql`INSERT INTO cro03c_runs(id,command_id,run_key,mode) VALUES (${runId}::uuid,${commandId}::uuid,${`fence-run:${RUN}`},${CRO03C_CONTINUOUS_MODE})`);
    await withCro08aContinuousOccurrenceEffectFence(
      { commandId, runId, correlationId: RUN, scheduleOccurrenceId: occurrenceId, commandType: "continuous_occurrence" },
      async () => {
        await assert.rejects(denyCro08aForbiddenEffect("ghl_mutation" as any), /CRO08A_FORBIDDEN_EFFECT_DENIED:ghl_mutation/);
      },
    );
    const forbidden = rows(await db.execute(sql`SELECT effect_kind, disposition FROM cro03c_forbidden_effects WHERE command_id=${commandId}::uuid`))[0];
    assert.equal(forbidden.effect_kind, "ghl_mutation");
    assert.equal(forbidden.disposition, "failed_run");
    const run = rows(await db.execute(sql`SELECT state FROM cro03c_runs WHERE id=${runId}::uuid`))[0];
    assert.equal(run.state, "failed");
  });

  // --- Correction 5: provider budget archive-then-reset rollover ----------
  const testProvider = `cro08a-test-provider-${RUN}`;
  await ok("provider budget rollover archives elapsed spend and never double-executes or loses history", async () => {
    const past = new Date(Date.now() - 3600_000);
    await db.execute(sql`INSERT INTO provider_controls (provider,capability,enabled,local_budget_units,reserved_units,consumed_units,window_started_at,window_ends_at,version)
      VALUES (${testProvider},'test',true,1000,0,42,${past.toISOString()}::timestamptz,${past.toISOString()}::timestamptz,0)`);
    const first = await rolloverProviderBudgetPeriod({ provider: testProvider, periodKey: "daily", actor: RUN });
    assert.equal(first.rolledOver, true);
    const second = await rolloverProviderBudgetPeriod({ provider: testProvider, periodKey: "daily", actor: RUN });
    assert.equal(second.rolledOver, false, "a same-window rollover must not re-execute once the window has already advanced");
    const control = rows(await db.execute(sql`SELECT consumed_units, reserved_units, version FROM provider_controls WHERE provider=${testProvider}`))[0];
    assert.equal(Number(control.consumed_units), 0, "consumed_units must reset to 0 after archive-then-reset");
    assert.equal(Number(control.version), 1, "version must advance exactly once");
    const history = await getProviderBudgetPeriodHistory(testProvider);
    assert.equal(history.length, 1);
    assert.equal(Number(history[0].consumed_units), 42, "archived history must preserve the exact pre-rollover spend");
    await assert.rejects(
      db.execute(sql`UPDATE provider_budget_period_ledger SET consumed_units=0 WHERE provider=${testProvider}`),
      (err: any) => /immutable/.test(String(err?.cause?.message ?? err?.message ?? "")),
      "the ledger must be immutable even to a direct UPDATE",
    );
    await assert.rejects(
      db.execute(sql`DELETE FROM provider_budget_period_ledger WHERE provider=${testProvider}`),
      (err: any) => /immutable/.test(String(err?.cause?.message ?? err?.message ?? "")),
      "the ledger must be immutable even to a direct DELETE",
    );
  });

  // --- Correction 1: full path — atomic occurrence bind + server-derived --
  // caps inside createCro03cCommand itself (not a separate optional call),
  // and caller-supplied caps are never trusted for continuous_occurrence.
  let fullPathDefinitionId = "";
  let fullPathDefinitionHash = "";
  let fullPathOccurrenceId = "";
  const fullPathHandoffId = await (async () => {
    const subjectKey = `cro08a-fullpath-${RUN}`;
    await createCro03SourceBatch({
      idempotencyKey: `cro08a-fullpath-source:${RUN}`, actorType: "system", actorId: "cro08a-test",
      purpose: "staging_review",
      subjects: [{
        subjectType: "prospect", subjectKey, sourceSystem: "prospects",
        sourceObservedAt: new Date().toISOString(), sourceEventKey: `cro08a-fullpath-event:${RUN}`,
        timestampProvenance: "source", provenance: { test: true },
        payload: { businessName: `CRO08A ${RUN}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
          city: "Miami", state: "FL", county: "Miami-Dade", industry: "Auto", entityStatus: "active" },
        candidateValues: { business_name: `CRO08A ${RUN}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
          city: "Miami", state: "FL", category: "Auto", entity_status: "active" },
      }],
    });
    const occurrence = rows(await db.execute(sql`
      SELECT id, source_observation_id FROM cro03_source_occurrences WHERE source_event_key=${`cro08a-fullpath-event:${RUN}`}
    `))[0];
    (globalThis as any).__cro08aFullPathSourceObservationId = String(occurrence.source_observation_id);
    const qualification = await createCro03aQualificationRun({
      idempotencyKey: `cro08a-fullpath-qualification:${RUN}`, occurrenceIds: [occurrence.id],
      actorId: RUN, actorRole: "admin",
    });
    await processCro03aQualificationRunQueueSafe(qualification.id);
    const result = rows(await db.execute(sql`SELECT id FROM cro03a_handoffs WHERE run_id=${qualification.id}::uuid`))[0];
    assert.ok(result, "fixture must produce an eligible CRO-03A handoff for the full-path test");
    // `cro03a_handoffs.effect_authorized` can never be TRUE for any row at
    // this baseline (permanent CHECK constraint, see the full-path
    // createCro03cCommand test below for the full explanation) — this
    // handoff is used only to prove the CRO-08A occurrence-validation gates
    // execute correctly up to that pre-existing, out-of-scope wall.
    return String(result.id);
  })();

  const fullPathPricing = Object.fromEntries(Object.entries(CRO03C_PROVIDER_CONTRACTS).map(([provider, contract]) => [
    provider,
    { version: 1, unitType: contract.unitType, currency: contract.currency, billingSemantics: contract.billingSemantics,
      amountMicros: contract.billingSemantics === "not_billable" ? 0 : 1 },
  ]));
  const fullPathApprovals = Object.fromEntries(["operator", "data", "finance", "legal"].map((dimension) => [
    dimension,
    { approvalId: `cro08a-fullpath-approval-${dimension}-${RUN}`, version: 1, approvedBy: RUN,
      approvedAt: new Date().toISOString(), scopeHash: hex64(`scope:${dimension}:${RUN}`) },
  ]));

  // A unique, monotonically-large revision/version guarantees this policy
  // row is the one createCro03cCommand's `ORDER BY expected_revision DESC
  // LIMIT 1` picks, even with other approved 'cro03c_live_activation' rows
  // left over (append-only) from earlier runs of this same script.
  const fullPathRevision = Math.floor(Date.now() / 1000);
  await ok("full path setup: approved policy, runtime attestation, pause state, certification", async () => {
    await db.execute(sql`
      INSERT INTO outbound_pause_control(state,reason,epoch,actor)
      SELECT 'paused','cro08a test',1,'cro08a-test'
       WHERE NOT EXISTS (SELECT 1 FROM outbound_pause_control)
    `);
    invalidatePauseStateCache();
    const pause = await getPauseState();
    assert.equal(pause.state, "paused", "test requires the global outbound pause to be engaged");

    await db.execute(sql`
      INSERT INTO cro03c_activation_policies
        (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
      VALUES (gen_random_uuid(),${`cro08a-fullpath-policy:${RUN}`},'cro03c_live_activation',${fullPathRevision},'{}'::jsonb,${hex64(`policy:${RUN}`)},
              ${JSON.stringify(fullPathPricing)}::jsonb,${JSON.stringify(fullPathApprovals)}::jsonb,'approved',${fullPathRevision},'cro08a full-path test',${RUN})
    `);

    const inventoryId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO cro03c_deployment_inventories (id,issuer_id,deployment_identity,environment_identity,release_sha,queue_topology_hash,identity_kind,worker_identities,expected_count,issued_at,expires_at,payload,payload_hash,signature,created_by)
      VALUES (${inventoryId}::uuid,'test','test-deploy','test-env',${process.env.RELEASE_SHA},${hex64(`qth-fp:${RUN}`)},'worker','["stub-worker"]'::jsonb,1,NOW(),NOW()+interval '1 hour','{}'::jsonb,${hex64(`payload-fp:${RUN}`)},'stub-sig',${RUN})`);
    await db.execute(sql`INSERT INTO cro03c_runtime_attestations (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,expires_at,attestation_hash,created_by)
      VALUES (${attestationId}::uuid,${`cro08a-fullpath-att:${RUN}`},${inventoryId}::uuid,'[]'::jsonb,${process.env.RELEASE_SHA},${CRO03C_MIGRATION_HEAD},'test-deploy','test-env','w','w',${hex64(`qth-fp:${RUN}`)},NOW(),TRUE,TRUE,NOW()+interval '1 hour',${hex64(`att-fp:${RUN}`)},${RUN})`);
    (globalThis as any).__cro08aFullPathAttestationId = attestationId;

    const receipt = await issueCro08aCertificationReceipt({
      releaseSha: process.env.RELEASE_SHA!, migrationHead: CRO03C_MIGRATION_HEAD, providerSet: Object.keys(CRO03C_PROVIDER_CONTRACTS),
      priceScheduleHash: hex64(`price:${RUN}`), approvalReceiptIds: [], runtimeAttestationId: attestationId,
      outboundPauseEpoch: pause.epoch, issuedBy: RUN, expiresAt: new Date(Date.now() + 3600_000),
    });
    assert.ok(receipt.id);

    const def = await createCro08aScheduleDefinition({
      logicalKey: "candidate_enrichment", purpose: "cro08a full-path test enrichment schedule",
      sourceRecipePolicyVersions: { recipe: 1 }, cadenceCron: "*/10 * * * *", windowSeconds: 600,
      batchSize: 25, concurrencyLimit: 2, cursorSemantics: { sourceSystem: "sunbiz" },
      budgets: { zerobounce: { maxUnitsPerOccurrence: 5 } },
      timeoutMs: 120000, leaseMs: 120000, heartbeatMs: 30000, retryPolicy: { maxAttempts: 3 },
      deadLetterPolicy: { maxAttempts: 5 }, downstreamOwner: "cro08a-test", createdBy: RUN,
    });
    fullPathDefinitionId = def.id;
    fullPathDefinitionHash = def.definitionHash;
    const activation = await activateCro08aScheduleDefinition({ definitionId: fullPathDefinitionId, activatedBy: RUN, reason: "cro08a full-path test" });
    assert.equal(activation.activated, true);
    assert.equal(activation.certificationReceiptId, receipt.id);
  });

  await ok("createCro03cCommand's occurrence validation and server-derived caps clear every gate for a fully valid request", async () => {
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: fullPathDefinitionId, definitionHash: fullPathDefinitionHash,
      windowStart: new Date("2026-08-30T02:00:00Z"), windowEnd: new Date("2026-08-30T02:10:00Z"),
      frozenCursorSnapshot: { sunbiz: { cursor: "fullpath" } },
    });
    fullPathOccurrenceId = occ.id;
    const claimToken = crypto.randomUUID();
    await db.execute(sql`UPDATE cro08a_schedule_occurrences SET claim_token=${claimToken}::uuid WHERE id=${fullPathOccurrenceId}::uuid`);
    await commitCro08aEnumerationCheckpoint({
      occurrenceId: fullPathOccurrenceId, claimToken, selectedCount: 1, selectionReceiptHash: "fullpath-receipt",
      selectedHandoffIds: [fullPathHandoffId],
    });

    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    // IMPORTANT: `cro03a_handoffs` carries a permanent DB CHECK constraint
    // (`cro03a_handoff_effect_denied_chk CHECK (effect_authorized = FALSE)`,
    // migrations/0187_cro03a_candidate_qualification.sql) that makes
    // `effect_authorized = TRUE` categorically impossible for ANY row, ever
    // — verified: no code path anywhere sets it TRUE, an UPDATE attempt is
    // separately blocked by the `cro03a_handoffs_immutable` append-only
    // trigger, and even a raw INSERT with TRUE would violate the CHECK.
    // Consequently `assertEligibleHandoff` (which requires
    // `effect_authorized=TRUE`) can never succeed for ANY commandType at
    // this baseline — not just continuous_occurrence — which is why
    // scripts/test-cro03c-integration.ts's own fixtures bypass
    // createCro03cCommand entirely and hand-insert cro03c_commands/
    // generations directly rather than going through this handoff gate.
    // This is a pre-existing CRO-03A/CRO-03C boundary limitation (consistent
    // with "production schedules and paid provider calls remain paused");
    // fixing it would mean altering CRO-03A's schema/admission flow, which
    // section 6 places out of this task's scope.
    //
    // So this test proves the part that IS this task's scope and IS
    // provable through the real function: every one of the new
    // continuous_occurrence gates (occurrence found, hash match, enumeration
    // committed, not already bound, definition active+certified, provider
    // budget defined, server-derived cap arithmetic) passes without
    // throwing for a fully valid setup, and execution reaches exactly the
    // pre-existing handoff-eligibility wall — never one of the CRO08A_*
    // validation errors covered by the negative tests below.
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-fullpath-command:${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [fullPathHandoffId],
        provider: "zerobounce",
        // Deliberately bogus caller-supplied caps: even though this request
        // cannot fully commit (see above), it must fail at the handoff wall,
        // never at a caller-cap validation step, proving caps are derived
        // server-side before caller-supplied values could ever matter.
        maxUnits: 999999, maxAmountMicros: 999999999,
        reason: "cro08a full-path test command", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: fullPathOccurrenceId, scheduleDefinitionHash: fullPathDefinitionHash,
      }),
      /CRO03C_HANDOFF_NOT_ELIGIBLE/,
    );
    // The failed attempt rolled back its transaction entirely (including the
    // occurrence bind and command/run inserts it reached internally), so the
    // occurrence remains unbound and re-usable — assert that directly rather
    // than assuming it.
    const occRow = rows(await db.execute(sql`SELECT cro03c_command_id, enumeration_checkpoint FROM cro08a_schedule_occurrences WHERE id=${fullPathOccurrenceId}::uuid`))[0];
    assert.equal(occRow.cro03c_command_id, null, "a transaction that fails at the handoff wall must not leave a partial bind behind");
    assert.equal(occRow.enumeration_checkpoint, "committed");
  });

  // --- reviewer finding #2: durable occurrence->handoff population binding
  await ok("createCro03cCommand rejects a handoff outside the occurrence's durably-recorded selected population", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const outsideHandoffId = crypto.randomUUID();
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-fullpath-command-outside:${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [outsideHandoffId],
        provider: "zerobounce", maxUnits: 999999, maxAmountMicros: 999999999,
        reason: "cro08a membership negative test", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: fullPathOccurrenceId, scheduleDefinitionHash: fullPathDefinitionHash,
      }),
      /CRO08A_HANDOFF_NOT_IN_OCCURRENCE_POPULATION/,
    );
    const occRow = rows(await db.execute(sql`SELECT cro03c_command_id FROM cro08a_schedule_occurrences WHERE id=${fullPathOccurrenceId}::uuid`))[0];
    assert.equal(occRow.cro03c_command_id, null, "a rejected membership check must not leave a partial bind behind");
  });

  // --- reviewer finding #1: aggregate occurrence/command budget enforcement
  await ok("reserveCro03cProviderOperation enforces the command's aggregate budget cap across multiple reservations", async () => {
    const aggAttestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const aggPolicy = rows(await db.execute(sql`SELECT id FROM cro03c_activation_policies WHERE idempotency_key=${`cro08a-fullpath-policy:${RUN}`}`))[0];
    const aggCommandId = crypto.randomUUID();
    const aggRunId = crypto.randomUUID();
    // Server-derived cap of 3 units total for this command (mirrors what
    // createCro03cCommand would have derived from occurrence.selected_count
    // and the definition's provider budget) -- deliberately small so two
    // individually-legal reservations of 2 units each must collide in
    // aggregate.
    const aggCaps = { provider: "zerobounce", maxUnits: 3, maxAmountMicros: 3 };
    await db.execute(sql`INSERT INTO cro03c_commands (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,expires_at,reason,pre_pause_epoch,state)
      VALUES (${aggCommandId}::uuid,${`agg-key:${RUN}`},${`agg-idem:${RUN}`},'continuous_occurrence',${RUN},${aggPolicy.id}::uuid,${fullPathRevision},1,${hex64(`agg-recipe:${RUN}`)},${hex64(`agg-stageplan:${RUN}`)},${aggAttestationId}::uuid,${JSON.stringify(aggCaps)}::jsonb,${hex64(`agg-stoppolicy:${RUN}`)},'{}'::jsonb,NOW()+interval '1 hour','agg budget test',0,'running')`);
    await db.execute(sql`INSERT INTO cro03c_runs(id,command_id,run_key,mode,state) VALUES (${aggRunId}::uuid,${aggCommandId}::uuid,${`agg-run:${RUN}`},${CRO03C_CONTINUOUS_MODE},'running')`);

    const sourceObservationId = (globalThis as any).__cro08aFullPathSourceObservationId as string;
    // The cro03c_stage_input_integrity_guard trigger requires the generation's
    // stage_plan_hash to exactly equal its owning command's stage_plan_hash,
    // and source_payload_hash to exactly equal the canonical observation's
    // payload_hash -- so both must be threaded through from real rows/values
    // rather than fabricated per-generation.
    const aggStagePlanHash = hex64(`agg-stageplan:${RUN}`);
    const canonicalPayloadHash = String(rows(await db.execute(sql`
      SELECT payload_hash FROM cro03_source_observations WHERE id=${sourceObservationId}::uuid
    `))[0].payload_hash);
    let stubGenerationRecipeVersion = 0;
    async function stubGeneration(stageKey: string) {
      const generationId = crypto.randomUUID();
      stubGenerationRecipeVersion += 1;
      // cro03c_generations has a UNIQUE (handoff_id, recipe_version) index --
      // each stub generation sharing fullPathHandoffId needs its own version.
      await db.execute(sql`INSERT INTO cro03c_generations (id,handoff_id,recipe_version,recipe_hash,mode,activation_revision,command_id,run_id,frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id,state)
        VALUES (${generationId}::uuid,${fullPathHandoffId}::uuid,${stubGenerationRecipeVersion},${hex64(`gen-recipe:${generationId}`)},${CRO03C_CONTINUOUS_MODE},${fullPathRevision},${aggCommandId}::uuid,${aggRunId}::uuid,${hex64(`gen-handoff:${generationId}`)},${aggStagePlanHash},${hex64(`gen-cohort:${generationId}`)},${aggAttestationId}::uuid,'running')`);
      const stageInputRefId = crypto.randomUUID();
      await db.execute(sql`INSERT INTO cro03c_stage_input_references (id,generation_id,stage_key,source_observation_id,source_payload_hash,evidence_hash,provider,price_schedule_version,price_schedule_hash,reserved_units,units_hash,cap_hash)
        VALUES (${stageInputRefId}::uuid,${generationId}::uuid,${stageKey},${sourceObservationId}::uuid,${canonicalPayloadHash},${hex64(`ev:${generationId}`)},'zerobounce',1,${stableCro03RecipeHash(fullPathPricing.zerobounce)},1,${hex64(`units:${generationId}`)},${hex64(`cap:${generationId}`)})`);
      await db.execute(sql`INSERT INTO cro03c_stage_dispositions (id,generation_id,stage_key,disposition,input_hash,evidence_hash,recipe_hash,policy_hash,reason_code,stage_input_reference_id)
        VALUES (gen_random_uuid(),${generationId}::uuid,${stageKey},'eligible',${hex64(`in:${generationId}`)},${hex64(`ev:${generationId}`)},${hex64(`rc:${generationId}`)},${hex64(`pc:${generationId}`)},'agg_test_eligible',${stageInputRefId}::uuid)`);
      return generationId;
    }
    const genA = await stubGeneration("zerobounce_validation_a");
    const genB = await stubGeneration("zerobounce_validation_b");

    const reserveA = await reserveCro03cProviderOperation({
      generationId: genA, stageKey: "zerobounce_validation_a", provider: "zerobounce", operationType: "validate",
      operationKey: `agg-op-a:${RUN}`, caller: "server/services/cro03/test-cro08a-continuous-factory",
      requestedUnits: 2, maxAmountMicros: 2, priceScheduleVersion: 1, priceScheduleHash: stableCro03RecipeHash(fullPathPricing.zerobounce),
      activationRevision: fullPathRevision,
    });
    assert.equal(reserveA.replayed, false);
    // A second reservation of 2 more units would bring the aggregate to 4,
    // exceeding the command's 3-unit cap -- must be denied even though 2
    // units alone is well under the per-operation ceiling.
    await assert.rejects(
      reserveCro03cProviderOperation({
        generationId: genB, stageKey: "zerobounce_validation_b", provider: "zerobounce", operationType: "validate",
        operationKey: `agg-op-b:${RUN}`, caller: "server/services/cro03/test-cro08a-continuous-factory",
        requestedUnits: 2, maxAmountMicros: 2, priceScheduleVersion: 1, priceScheduleHash: stableCro03RecipeHash(fullPathPricing.zerobounce),
        activationRevision: fullPathRevision,
      }),
      /CRO08A_OCCURRENCE_AGGREGATE_BUDGET_EXCEEDED/,
    );
    // A reservation of exactly the remaining 1 unit must succeed.
    const reserveC = await reserveCro03cProviderOperation({
      generationId: genB, stageKey: "zerobounce_validation_b", provider: "zerobounce", operationType: "validate",
      operationKey: `agg-op-c:${RUN}`, caller: "server/services/cro03/test-cro08a-continuous-factory",
      requestedUnits: 1, maxAmountMicros: 1, priceScheduleVersion: 1, priceScheduleHash: stableCro03RecipeHash(fullPathPricing.zerobounce),
      activationRevision: fullPathRevision,
    });
    assert.equal(reserveC.replayed, false);
    const total = rows(await db.execute(sql`
      SELECT COALESCE(SUM(max_reserved_units),0)::int AS units FROM cro03c_stage_operations o
       JOIN cro03c_generations g ON g.id=o.generation_id WHERE g.command_id=${aggCommandId}::uuid
    `))[0];
    assert.equal(total.units, 3, "aggregate reserved units across the command must exactly equal the cap after the mix of accepted/rejected reservations");
  });

  await ok("createCro03cCommand rejects a continuous_occurrence request against a nonexistent occurrence", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-neg-notfound-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 1, maxAmountMicros: 1, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: crypto.randomUUID(), scheduleDefinitionHash: fullPathDefinitionHash,
      }),
      /CRO08A_SCHEDULE_OCCURRENCE_NOT_FOUND/,
    );
  });

  await ok("createCro03cCommand rejects a definition-hash mismatch against a real occurrence", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: fullPathDefinitionId, definitionHash: fullPathDefinitionHash,
      windowStart: new Date("2026-08-30T03:00:00Z"), windowEnd: new Date("2026-08-30T03:10:00Z"),
      frozenCursorSnapshot: {},
    });
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-neg-hashmismatch-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 1, maxAmountMicros: 1, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: occ.id, scheduleDefinitionHash: "wrong-hash",
      }),
      /CRO08A_SCHEDULE_DEFINITION_HASH_MISMATCH/,
    );
  });

  await ok("createCro03cCommand rejects an occurrence whose enumeration is not yet committed", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: fullPathDefinitionId, definitionHash: fullPathDefinitionHash,
      windowStart: new Date("2026-08-30T04:00:00Z"), windowEnd: new Date("2026-08-30T04:10:00Z"),
      frozenCursorSnapshot: {},
    });
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-neg-notcommitted-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 1, maxAmountMicros: 1, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: occ.id, scheduleDefinitionHash: fullPathDefinitionHash,
      }),
      /CRO08A_OCCURRENCE_ENUMERATION_NOT_COMMITTED/,
    );
  });

  await ok("createCro03cCommand rejects an occurrence bound to an inactive schedule definition", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const inactiveDef = await createCro08aScheduleDefinition({
      logicalKey: "candidate_freshness_refresh", purpose: "cro08a inactive-definition negative test",
      sourceRecipePolicyVersions: { recipe: 1 }, cadenceCron: "*/15 * * * *", windowSeconds: 900,
      batchSize: 10, concurrencyLimit: 1, cursorSemantics: {}, budgets: { zerobounce: { maxUnitsPerOccurrence: 5 } },
      timeoutMs: 60000, leaseMs: 60000, heartbeatMs: 15000, retryPolicy: {}, deadLetterPolicy: {},
      downstreamOwner: "cro08a-test", createdBy: RUN,
    });
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: inactiveDef.id, definitionHash: inactiveDef.definitionHash,
      windowStart: new Date("2026-08-30T05:00:00Z"), windowEnd: new Date("2026-08-30T05:10:00Z"),
      frozenCursorSnapshot: {},
    });
    const claimToken = crypto.randomUUID();
    await db.execute(sql`UPDATE cro08a_schedule_occurrences SET claim_token=${claimToken}::uuid WHERE id=${occ.id}::uuid`);
    await commitCro08aEnumerationCheckpoint({ occurrenceId: occ.id, claimToken, selectedCount: 1, selectionReceiptHash: "inactive-def-receipt", selectedHandoffIds: [crypto.randomUUID()] });
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-neg-inactive-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 1, maxAmountMicros: 1, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: occ.id, scheduleDefinitionHash: inactiveDef.definitionHash,
      }),
      /CRO08A_SCHEDULE_DEFINITION_NOT_ACTIVE/,
    );
    await db.execute(sql`DELETE FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id=${occ.id}::uuid`);
    await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE id=${occ.id}::uuid`);
    await db.execute(sql`DELETE FROM cro08a_schedule_definitions WHERE id=${inactiveDef.id}::uuid`);
  });

  await ok("createCro03cCommand rejects an occurrence whose active definition has no budget defined for the requested provider", async () => {
    const attestationId = (globalThis as any).__cro08aFullPathAttestationId as string;
    const noBudgetDef = await createCro08aScheduleDefinition({
      logicalKey: "candidate_backfill", purpose: "cro08a missing-provider-budget negative test",
      sourceRecipePolicyVersions: { recipe: 1 }, cadenceCron: "0 3 * * *", windowSeconds: 900,
      batchSize: 10, concurrencyLimit: 1, cursorSemantics: {}, budgets: { serper: { maxUnitsPerOccurrence: 5 } },
      timeoutMs: 60000, leaseMs: 60000, heartbeatMs: 15000, retryPolicy: {}, deadLetterPolicy: {},
      downstreamOwner: "cro08a-test", createdBy: RUN,
    });
    const activation = await activateCro08aScheduleDefinition({ definitionId: noBudgetDef.id, activatedBy: RUN, reason: "cro08a test" });
    assert.ok(activation.activated);
    const occ = await ensureCro08aScheduleOccurrence({
      scheduleDefinitionId: noBudgetDef.id, definitionHash: noBudgetDef.definitionHash,
      windowStart: new Date("2026-08-30T06:00:00Z"), windowEnd: new Date("2026-08-30T06:10:00Z"),
      frozenCursorSnapshot: {},
    });
    const claimToken = crypto.randomUUID();
    await db.execute(sql`UPDATE cro08a_schedule_occurrences SET claim_token=${claimToken}::uuid WHERE id=${occ.id}::uuid`);
    await commitCro08aEnumerationCheckpoint({ occurrenceId: occ.id, claimToken, selectedCount: 1, selectionReceiptHash: "no-budget-receipt", selectedHandoffIds: [crypto.randomUUID()] });
    await assert.rejects(
      createCro03cCommand({
        actorId: RUN, idempotencyKey: `cro08a-neg-nobudget-${RUN}`, commandType: "continuous_occurrence",
        expectedActivationRevision: fullPathRevision, runtimeAttestationId: attestationId, handoffIds: [crypto.randomUUID()],
        provider: "zerobounce", maxUnits: 1, maxAmountMicros: 1, reason: "x", expiresAt: new Date(Date.now() + 3600_000),
        scheduleOccurrenceId: occ.id, scheduleDefinitionHash: noBudgetDef.definitionHash,
      }),
      /CRO08A_PROVIDER_BUDGET_UNDEFINED/,
    );
    await db.execute(sql`DELETE FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id=${occ.id}::uuid`);
    await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE id=${occ.id}::uuid`);
    await db.execute(sql`UPDATE cro08a_schedule_definitions SET active=false WHERE id=${noBudgetDef.id}::uuid`);
    await db.execute(sql`DELETE FROM cro08a_schedule_definitions WHERE id=${noBudgetDef.id}::uuid`);
  });

  // --- cleanup -------------------------------------------------------------
  // cro03c_forbidden_effects is append-only (cro03b_append_only_guard), and
  // it FK-references cro03c_runs (which in turn FK-references
  // cro03c_commands) — so neither runs nor commands can be deleted
  // transitively once a forbidden-effect row exists for them. All three
  // (commands/runs/forbidden_effects) are left in place as test-tagged
  // (actor_id=RUN) residue rather than attempting a delete that would fail.
  // cro03c_runtime_attestations, cro03c_deployment_inventories, and
  // cro03c_activation_policies are append-only by design; left in place as
  // test-tagged (created_by/idempotency_key contain RUN) residue.
  // provider_budget_period_ledger is immutable-by-trigger (delete denied by
  // design); it is intentionally left in place as durable historical
  // evidence, matching Correction 5's archive-then-reset requirement.
  await db.execute(sql`DELETE FROM provider_controls WHERE provider=${testProvider}`).catch((e: any) => {
    console.log(`  (leaving provider_controls row for ${testProvider} in place: ${e?.cause?.message ?? e?.message})`);
  });
  await db.execute(sql`DELETE FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id IN (SELECT id FROM cro08a_schedule_occurrences WHERE schedule_definition_id=${definitionId}::uuid)`);
  await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE schedule_definition_id=${definitionId}::uuid`);
  await db.execute(sql`DELETE FROM cro08a_schedule_definitions WHERE id=${definitionId}::uuid`);
  if (fullPathOccurrenceId) {
    await db.execute(sql`DELETE FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id IN (SELECT id FROM cro08a_schedule_occurrences WHERE schedule_definition_id=${fullPathDefinitionId}::uuid)`);
    await db.execute(sql`DELETE FROM cro08a_schedule_occurrences WHERE schedule_definition_id=${fullPathDefinitionId}::uuid`);
  }
  if (fullPathDefinitionId) {
    await db.execute(sql`UPDATE cro08a_schedule_definitions SET active=false WHERE id=${fullPathDefinitionId}::uuid`);
    await db.execute(sql`DELETE FROM cro08a_schedule_definitions WHERE id=${fullPathDefinitionId}::uuid`);
  }
  // The approved activation policy, runtime attestation/deployment
  // inventory, and the certification receipt created for the full-path test
  // are all append-only; left in place as test-tagged (RUN-suffixed)
  // residue, matching the pattern used throughout this file. No
  // cro03c_commands/generations row exists to clean up here: the full-path
  // test's createCro03cCommand call always fails at the pre-existing
  // handoff-eligibility wall (see that test's comment) and its transaction
  // is fully rolled back.

  console.log(failures === 0 ? "\nALL CRO-08A TESTS PASSED" : `\n${failures} CRO-08A TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
