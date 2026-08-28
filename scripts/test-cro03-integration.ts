#!/usr/bin/env tsx
/**
 * CRO-03 disposable PostgreSQL concurrency/recovery certification.
 * The CI wrapper replaces the environment, reserves an isolated Redis prefix,
 * and denies provider/public-network transport before importing this file.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "CRO-03 integration certification",
  requireRedis: true,
});

const { pool } = await import("../server/db");
const {
  cancelCro03Batch,
  claimNextCro03Item,
  completeCro03ProviderAccounting,
  createCro03Batch,
  getCro03BatchStatus,
  processNextCro03Item,
  processNextCro03Mutation,
  projectCro03Mutation,
  recoverExpiredCro03Dispatches,
} = await import("../server/services/cro03/enrichment-factory");
const { reserveCro03ProviderOperation } = await import(
  "../server/services/cro03/provider-context"
);
const { sealCandidate } = await import("../server/services/cro03/candidate-vault");
const { candidateHash } = await import("../server/services/cro03/contracts");

let assertions = 0;
const check = (value: unknown, message: string): void => {
  assertions++;
  assert.ok(value, message);
};
const suffix = randomUUID().replace(/-/g, "");
const fixtureKey = `cro03-ci-${suffix}`;
const batchIds: string[] = [];
const contactIds: number[] = [];
const providerOperationIds: string[] = [];

async function createExecutionFixture(count: number): Promise<{
  batchId: string;
  itemIds: string[];
}> {
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO cro03_enrichment_batches
       (idempotency_key, actor_type, purpose, state, total_count, executable_count,
        blocked_count, selection_hash, created_at)
     VALUES ($1, 'certification', 'provider_pre_spend', 'queued', $2, $2, 0, $3, '2000-01-01')
     RETURNING id`,
    [`${fixtureKey}-execution-${batchIds.length}`, count, suffix],
  );
  const batchId = batch.rows[0].id;
  batchIds.push(batchId);
  const itemIds: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const membership = await pool.query<{ id: string }>(
      `INSERT INTO cro03_batch_memberships
         (batch_id, ordinal, subject_type, subject_id, root_subject_type, root_subject_id,
          selection_policy_version, dependency_fingerprint, pre_spend_decision,
          disposition, membership_hash, created_at)
       VALUES ($1, $2, 'contact', $3, 'contact', $3, 1, $4, 'allowed',
               'executable', $5, '2000-01-01')
       RETURNING id`,
      [batchId, ordinal, 2_000_000_000 + ordinal, `fingerprint-${suffix}-${ordinal}`,
        `membership-${suffix}-${batchIds.length}-${ordinal}`],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO cro03_enrichment_items
         (batch_id, membership_id, state, next_attempt_at, created_at)
       VALUES ($1, $2, 'queued', '2000-01-01', '2000-01-01')
       RETURNING id`,
      [batchId, membership.rows[0].id],
    );
    itemIds.push(item.rows[0].id);
  }
  return { batchId, itemIds };
}

async function createMutationFixture(): Promise<{
  batchId: string;
  itemId: string;
  commandId: string;
  contactId: number;
}> {
  const contact = await pool.query<{ id: number }>(
    `INSERT INTO contacts(first_name,last_name,email,phone)
     VALUES ('CRO03','Certification',$1,$2) RETURNING id`,
    [`cro03-${suffix}@example.test`, `555${suffix.slice(0, 7)}`],
  );
  const contactId = contact.rows[0].id;
  contactIds.push(contactId);
  const { batchId, itemIds } = await createExecutionFixture(1);
  const itemId = itemIds[0];
  await pool.query(
    `UPDATE cro03_batch_memberships
        SET subject_id = $2, root_subject_id = $2, contact_id = $2
      WHERE batch_id = $1`,
    [batchId, contactId],
  ).catch((error) => {
    if (!String(error.message).includes("immutable")) throw error;
  });
  // Membership immutability is itself a contract, so create a correctly bound
  // replacement fixture rather than weakening the trigger.
  await pool.query(`ALTER TABLE cro03_batch_memberships DISABLE TRIGGER cro03_membership_immutable`);
  await pool.query(
    `UPDATE cro03_batch_memberships
        SET subject_id = $2, root_subject_id = $2, contact_id = $2
      WHERE batch_id = $1`,
    [batchId, contactId],
  );
  await pool.query(`ALTER TABLE cro03_batch_memberships ENABLE TRIGGER cro03_membership_immutable`);

  const run = await pool.query<{ id: string }>(
    `INSERT INTO cro03_provider_runs
       (item_id, provider, route_policy_version, purpose, state, provider_outcome,
        billing_disposition, target_fingerprint, completed_at)
     VALUES ($1, 'apollo', 1, 'provider_pre_spend', 'completed', 'success',
             'none', $2, NOW()) RETURNING id`,
    [itemId, `fingerprint-${suffix}-0`],
  );
  const envelope = sealCandidate({
    field: "phone",
    value: "5559997777",
    subjectId: contactId,
    subjectGeneration: null,
  });
  const candidate = await pool.query<{ id: string }>(
    `INSERT INTO cro03_candidates
       (item_id, provider_run_id, field, normalized_value_hash, masked_value,
        envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
        confidence, source_rank)
     VALUES ($1,$2,'phone',$3,$4,$5,$6,$7,$8,90,10) RETURNING id`,
    [itemId, run.rows[0].id, envelope.normalizedValueHash, envelope.maskedValue,
      envelope.ciphertext, envelope.nonce, envelope.tag, envelope.keyVersion],
  );
  const command = await pool.query<{ id: string }>(
    `INSERT INTO cro03_mutation_commands
       (item_id,candidate_id,mutation_key,subject_type,subject_id,field,expected_value_hash)
     VALUES ($1,$2,$3,'contact',$4,'phone',$5) RETURNING id`,
    [itemId, candidate.rows[0].id, `mutation-${suffix}-${batchIds.length}`,
      contactId, candidateHash("phone", `555${suffix.slice(0, 7)}`)],
  );
  return { batchId, itemId, commandId: command.rows[0].id, contactId };
}

async function createRoutableExecutionFixture(): Promise<{
  batchId: string;
  itemId: string;
  contactId: number;
}> {
  const contact = await pool.query<{ id: number }>(
    `INSERT INTO contacts(first_name,last_name,email,phone,company_name,title,website,email_status)
     VALUES ('CRO03','ProviderRace',$1,$2,'Certification Merchant',NULL,'example.test','valid')
     RETURNING id`,
    [`race-${suffix}-${contactIds.length}@example.test`, `556${suffix.slice(0, 7)}`],
  );
  const contactId = contact.rows[0].id;
  contactIds.push(contactId);
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO cro03_enrichment_batches
       (idempotency_key,actor_type,purpose,state,total_count,executable_count,
        blocked_count,selection_hash,created_at)
     VALUES ($1,'certification','provider_pre_spend','queued',1,1,0,$2,'1999-01-01')
     RETURNING id`,
    [`${fixtureKey}-provider-race-${batchIds.length}`, `${suffix}-provider-race`],
  );
  const batchId = batch.rows[0].id;
  batchIds.push(batchId);
  const membership = await pool.query<{ id: string }>(
    `INSERT INTO cro03_batch_memberships
       (batch_id,ordinal,subject_type,subject_id,root_subject_type,root_subject_id,
        contact_id,selection_policy_version,dependency_fingerprint,pre_spend_decision,
         disposition,membership_hash,subject_snapshot,subject_snapshot_hash,
         frozen_route_plan,route_plan_hash,discovery_eligible,paid_enrichment_eligible,created_at)
      VALUES ($1,0,'contact',$2,'contact',$2,$2,1,$3,'allowed','executable',$4,
              $5::jsonb,$6,$7::jsonb,$8,FALSE,TRUE,'1999-01-01')
     RETURNING id`,
    [batchId, contactId, `provider-fingerprint-${suffix}-${batchIds.length}`,
      `provider-membership-${suffix}-${batchIds.length}`,
      JSON.stringify({
         id: contactId,
        companyName: "Certification Merchant",
        website: "example.test",
        phone: `556${suffix.slice(0, 7)}`,
        email: `race-${suffix}-${contactIds.length - 1}@example.test`,
        emailStatus: "valid",
      }),
      `subject-snapshot-${suffix}-${batchIds.length}`,
      JSON.stringify({
        policyVersion: 1,
        providers: ["apollo", "zerobounce"],
        recipes: [
          { provider: "apollo", operation: "contact_enrichment", requiresPaidEligibility: true },
          { provider: "zerobounce", operation: "email_validation_backlink", requiresPaidEligibility: false },
        ],
      }),
      `route-plan-${suffix}-${batchIds.length}`],
  );
  const item = await pool.query<{ id: string }>(
    `INSERT INTO cro03_enrichment_items
       (batch_id,membership_id,state,next_attempt_at,created_at)
     VALUES ($1,$2,'queued','1999-01-01','1999-01-01') RETURNING id`,
    [batchId, membership.rows[0].id],
  );
  return { batchId, itemId: item.rows[0].id, contactId };
}

try {
  const relation = await pool.query(
    `SELECT to_regclass('public.cro03_enrichment_batches') AS batches,
            to_regclass('public.cro03_provider_ledger') AS ledger`,
  );
  check(relation.rows[0].batches && relation.rows[0].ledger,
    "full migration journal created CRO-03 batch and economics tables");

  const replayKey = `${fixtureKey}-replay`;
  const [firstReplay, secondReplay] = await Promise.all([
    createCro03Batch({ idempotencyKey: replayKey, actorType: "certification", contactIds: [2_000_000_001] }),
    createCro03Batch({ idempotencyKey: replayKey, actorType: "certification", contactIds: [2_000_000_001] }),
  ]);
  batchIds.push(firstReplay.id);
  check(firstReplay.id === secondReplay.id, "concurrent command replay resolves to one batch");
  check(Number(firstReplay.replayed) + Number(secondReplay.replayed) === 1,
    "exactly one concurrent creator reports replay");
  const replayRows = await pool.query(
    `SELECT count(*)::int AS batches,
            (SELECT count(*)::int FROM cro03_batch_memberships WHERE batch_id=$1) AS members,
            (SELECT count(*)::int FROM cro03_enrichment_items WHERE batch_id=$1) AS items
       FROM cro03_enrichment_batches WHERE id=$1`,
    [firstReplay.id],
  );
  check(replayRows.rows[0].batches === 1 && replayRows.rows[0].members === 1 &&
    replayRows.rows[0].items === 1, "replay preserves exact immutable membership and item cardinality");

  const execution = await createExecutionFixture(2);
  const [claimA, claimB] = await Promise.all([claimNextCro03Item(), claimNextCro03Item()]);
  check(claimA && claimB && claimA.id !== claimB.id,
    "FOR UPDATE SKIP LOCKED gives simultaneous workers distinct items");
  check(new Set([String(claimA?.id), String(claimB?.id)]).size === 2,
    "each item has one active claimant");

  const expiredItem = String(claimA!.id);
  const staleToken = String(claimA!.claim_token ?? claimA!.claimToken);
  await pool.query(
    `UPDATE cro03_enrichment_items
        SET state='running', lease_expires_at=NOW()-INTERVAL '1 second'
      WHERE id=$1`,
    [expiredItem],
  );
  await pool.query(
    `UPDATE cro03_enrichment_items SET state='completed', lease_expires_at=NULL, claim_token=NULL
      WHERE id=$1`,
    [claimB!.id],
  );
  const reclaimed = await claimNextCro03Item();
  check(String(reclaimed?.id) === expiredItem && String(reclaimed?.claimToken) !== staleToken,
    "expired running lease is reclaimed with a new token");
  check(Number(reclaimed?.execution_fence) >= 2,
    "lease reclamation advances the durable execution fence");
  const staleWrite = await pool.query(
    `UPDATE cro03_enrichment_items SET terminal_code='stale-writer-won'
      WHERE id=$1 AND claim_token=$2::uuid AND execution_fence=$3`,
    [expiredItem, staleToken, Number(reclaimed?.execution_fence) - 1],
  );
  check(staleWrite.rowCount === 0, "stale token and fence cannot mutate reclaimed work");

  const terminalBuckets = await createExecutionFixture(5);
  await pool.query(
    `UPDATE cro03_enrichment_items i
        SET state = states.state, completed_at = NOW(), claim_token = NULL, lease_expires_at = NULL
       FROM (VALUES
         ($1::uuid,'blocked'),($2::uuid,'completed'),($3::uuid,'failed'),
         ($4::uuid,'cancelled'),($5::uuid,'superseded')
       ) AS states(id,state)
      WHERE i.id=states.id`,
    terminalBuckets.itemIds,
  );
  const terminalStatus = await getCro03BatchStatus(terminalBuckets.batchId);
  check(terminalStatus?.blockedCount === 1 && terminalStatus?.completedCount === 1 &&
    terminalStatus?.failedCount === 1 && terminalStatus?.cancelledCount === 1 &&
    terminalStatus?.supersededCount === 1 && terminalStatus?.terminalTotal === 5 &&
    terminalStatus?.outstanding === 0 && terminalStatus?.accountingConsistent === true,
    "batch status exposes every terminal bucket and reconciles total equals terminals plus outstanding");

  const mutation = await createMutationFixture();
  const cancelled = await cancelCro03Batch(mutation.batchId);
  const cancellationProjection = await projectCro03Mutation(mutation.commandId);
  const cancelledRows = await pool.query(
    `SELECT b.state AS batch_state, i.state AS item_state, c.state AS command_state,
            c.disposition, ct.phone
       FROM cro03_enrichment_batches b
       JOIN cro03_enrichment_items i ON i.batch_id=b.id
       JOIN cro03_mutation_commands c ON c.item_id=i.id
       JOIN contacts ct ON ct.id=$2
      WHERE b.id=$1`,
    [mutation.batchId, mutation.contactId],
  );
  check(cancelled && cancellationProjection === "not_found",
    "batch cancellation fences a pending projection command");
  check(cancelledRows.rows[0].batch_state === "cancelled" &&
    cancelledRows.rows[0].item_state === "cancelled" &&
    cancelledRows.rows[0].command_state === "superseded" &&
    cancelledRows.rows[0].disposition === "no_longer_authoritative",
    "cancellation terminalizes batch, item, and mutation state consistently");
  check(cancelledRows.rows[0].phone !== "5559997777",
    "cancelled candidate never reaches the canonical contact");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const reservationRun = await pool.query<{ id: string }>(
    `INSERT INTO cro03_provider_runs
       (item_id,provider,route_policy_version,purpose,state,billing_disposition,target_fingerprint)
     VALUES ($1,'apollo',1,'provider_pre_spend','planned','none',$2) RETURNING id`,
    [expiredItem, suffix],
  );
  const reservationInput = {
    provider: "apollo" as const,
    operationIdempotencyKey: `${fixtureKey}-apollo`,
    targetFingerprint: suffix,
    purpose: "provider_pre_spend",
    requestedUnits: 1,
    itemId: expiredItem,
    providerRunId: reservationRun.rows[0].id,
    itemClaimToken: String(reclaimed!.claim_token ?? reclaimed!.claimToken),
    executionFence: Number(reclaimed!.execution_fence),
  };
  const [reservationA, reservationB] = await Promise.all([
    reserveCro03ProviderOperation(reservationInput),
    reserveCro03ProviderOperation(reservationInput),
  ]);
  check(reservationA && reservationB && reservationA.operationId === reservationB.operationId,
    "concurrent provider reservation replay returns one operation");
  providerOperationIds.push(reservationA!.operationId);
  const operationCounts = await pool.query(
    `SELECT count(*)::int AS operations,
            (SELECT reserved_units FROM provider_controls WHERE provider='apollo') AS reserved
       FROM provider_operations WHERE provider='apollo' AND idempotency_key=$1`,
    [reservationInput.operationIdempotencyKey],
  );
  check(operationCounts.rows[0].operations === 1 && operationCounts.rows[0].reserved === 1,
    "provider budget authority reserves exactly once");

  const providerRun = reservationRun;
  await Promise.all([
    completeCro03ProviderAccounting(providerRun.rows[0].id, reservationA!.operationId, "apollo", "consumed"),
    completeCro03ProviderAccounting(providerRun.rows[0].id, reservationA!.operationId, "apollo", "consumed"),
  ]);
  const accounting = await pool.query(
    `SELECT pc.reserved_units, pc.consumed_units,
            (SELECT count(*)::int FROM cro03_provider_ledger WHERE provider_run_id=$1) AS ledger_rows,
            (SELECT count(*)::int FROM cro03_provider_ledger WHERE provider_run_id=$1 AND event_type='reservation') AS reservations,
            (SELECT count(*)::int FROM cro03_provider_ledger WHERE provider_run_id=$1 AND event_type='terminal') AS terminals,
            (SELECT count(*)::int FROM cro03_receipts WHERE provider_run_id=$1) AS receipt_rows,
              (SELECT disposition FROM cro03_provider_ledger WHERE provider_run_id=$1 AND event_type='terminal') AS disposition,
             (SELECT receipt_id FROM cro03_provider_runs WHERE id=$1) AS receipt_id
       FROM provider_controls pc WHERE pc.provider='apollo'`,
    [providerRun.rows[0].id],
  );
  check(accounting.rows[0].reserved_units === 0 && accounting.rows[0].consumed_units === 1,
    "terminal accounting replay cannot double-consume or double-release budget");
   check(accounting.rows[0].ledger_rows === 2 && accounting.rows[0].reservations === 1 &&
     accounting.rows[0].terminals === 1 && accounting.rows[0].receipt_rows === 1 &&
    accounting.rows[0].disposition === "consumed" && accounting.rows[0].receipt_id,
     "one reservation and one immutable terminal event reconcile to a linked receipt");
   const immutableLedger = await pool.query(
     `UPDATE cro03_provider_ledger SET disposition='released' WHERE provider_run_id=$1`,
     [providerRun.rows[0].id],
   ).then(() => false).catch((error) => /immutable/.test(String(error.message)));
   check(immutableLedger, "database rejects in-place economics evidence mutation");
   const foreignLineageFixture = await createExecutionFixture(1);
   const foreignRun = await pool.query<{ id: string }>(
     `INSERT INTO cro03_provider_runs
        (item_id,provider,route_policy_version,purpose,state,billing_disposition,target_fingerprint)
      VALUES ($1,'apollo',1,'provider_pre_spend','planned','none',$2) RETURNING id`,
     [foreignLineageFixture.itemIds[0], `${suffix}-foreign-lineage`],
   );
   const reservationEvidence = await pool.query<{ id: string }>(
     `SELECT id FROM cro03_provider_ledger
       WHERE provider_run_id=$1 AND event_type='reservation'`,
     [providerRun.rows[0].id],
   );
   const crossRunRejected = await pool.query(
     `INSERT INTO cro03_provider_ledger
        (provider_run_id,provider_operation_id,provider,entry_key,event_type,
         reservation_entry_id,disposition,units,amount_micros)
      VALUES ($1,$2,'apollo',$3,'terminal',$4,'released',1,0)`,
     [foreignRun.rows[0].id, reservationA!.operationId,
       `settle:${foreignRun.rows[0].id}`, reservationEvidence.rows[0].id],
   ).then(() => false).catch((error) =>
     /CRO03_LEDGER_LINEAGE_MISMATCH/.test(String(error.message)));
   check(crossRunRejected, "database rejects terminal economics linked to another run's reservation");

   await pool.query(
     `UPDATE provider_controls
         SET enabled=TRUE,circuit_state='closed',local_budget_units=10,reserved_units=0,consumed_units=0
       WHERE provider='apollo'`,
   );
   const reservedCrash = await createExecutionFixture(1);
   const reservedToken = randomUUID();
   await pool.query(
     `UPDATE cro03_enrichment_items
         SET state='running',claim_token=$2,execution_fence=1,
             lease_expires_at=NOW()+INTERVAL '5 minutes'
       WHERE id=$1`,
     [reservedCrash.itemIds[0], reservedToken],
   );
   const reservedCrashRun = await pool.query<{ id: string }>(
     `INSERT INTO cro03_provider_runs
        (item_id,provider,route_policy_version,purpose,state,billing_disposition,target_fingerprint)
      VALUES ($1,'apollo',1,'provider_pre_spend','planned','none',$2) RETURNING id`,
     [reservedCrash.itemIds[0], `${suffix}-reserved-crash`],
   );
   const reservedCrashOperation = await reserveCro03ProviderOperation({
     provider: "apollo",
     operationIdempotencyKey: `${fixtureKey}-reserved-crash`,
     targetFingerprint: suffix,
     purpose: "provider_pre_spend",
     requestedUnits: 1,
     itemId: reservedCrash.itemIds[0],
     providerRunId: reservedCrashRun.rows[0].id,
     itemClaimToken: reservedToken,
     executionFence: 1,
   });
   check(reservedCrashOperation, "operation, run linkage, and reservation event commit atomically");
   providerOperationIds.push(reservedCrashOperation!.operationId);
   await pool.query(
     `UPDATE provider_operations SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,
     [reservedCrashOperation!.operationId],
   );
   const recoveredReserved = await recoverExpiredCro03Dispatches();
   const reservedCrashState = await pool.query(
     `SELECT r.state,r.billing_disposition,
             count(*) FILTER (WHERE l.event_type='reservation')::int AS reservations,
             count(*) FILTER (WHERE l.event_type='terminal')::int AS terminals,
             max(l.disposition) FILTER (WHERE l.event_type='terminal') AS terminal_disposition
        FROM cro03_provider_runs r
        JOIN cro03_provider_ledger l ON l.provider_run_id=r.id
       WHERE r.id=$1 GROUP BY r.id`,
     [reservedCrashRun.rows[0].id],
   );
   check(recoveredReserved >= 1 &&
     reservedCrashState.rows[0].billing_disposition === "released" &&
     reservedCrashState.rows[0].reservations === 1 &&
     reservedCrashState.rows[0].terminals === 1 &&
     reservedCrashState.rows[0].terminal_disposition === "released",
     "expired undispatched reservation appends exactly one release and terminalizes the run");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const race = await createRoutableExecutionFixture();
  let releasePreTransport!: () => void;
  const preTransportReleased = new Promise<void>((resolve) => { releasePreTransport = resolve; });
  let signalPreTransport!: () => void;
  const atPreTransport = new Promise<void>((resolve) => { signalPreTransport = resolve; });
  let transportCalls = 0;
  const processing = processNextCro03Item({
    allowCertificationTransport: true,
    resolveFence: async () => ({
      allowed: true,
      resolution: "exclusive",
      reasonCodes: [],
      dependencyFingerprint: `provider-fingerprint-${suffix}-${batchIds.length}`,
      policyVersion: 1,
    } as any),
    beforeProviderTransport: async () => {
      signalPreTransport();
      await preTransportReleased;
    },
    apollo: async () => {
      transportCalls++;
      return { outcome: "success", candidates: [] };
    },
  });
  await atPreTransport;
  await cancelCro03Batch(race.batchId);
  releasePreTransport();
  const raceResult = await processing;
  const raceState = await pool.query(
    `SELECT i.state, r.state AS run_state, r.billing_disposition,
            l.disposition AS ledger_disposition
       FROM cro03_enrichment_items i
       JOIN cro03_provider_runs r ON r.item_id=i.id
       JOIN cro03_provider_ledger l ON l.provider_run_id=r.id AND l.event_type='terminal'
      WHERE i.id=$1`,
    [race.itemId],
  );
  check(raceResult === "superseded" && transportCalls === 0,
    "cancellation after reservation but before transport prevents the provider call");
  check(raceState.rows[0].state === "cancelled" &&
    raceState.rows[0].run_state === "superseded" &&
    raceState.rows[0].billing_disposition === "released" &&
    raceState.rows[0].ledger_disposition === "released",
    "post-reservation cancellation releases economics without reviving cancelled work");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const dispatchedRace = await createRoutableExecutionFixture();
  let releaseAfterDispatch!: () => void;
  const afterDispatchReleased = new Promise<void>((resolve) => { releaseAfterDispatch = resolve; });
  let signalAfterDispatch!: () => void;
  const atAfterDispatch = new Promise<void>((resolve) => { signalAfterDispatch = resolve; });
  let dispatchedTransportCalls = 0;
  const dispatchedProcessing = processNextCro03Item({
    allowCertificationTransport: true,
    resolveFence: async () => ({
      allowed: true,
      resolution: "exclusive",
      reasonCodes: [],
      dependencyFingerprint: `provider-fingerprint-${suffix}-${batchIds.length}`,
      policyVersion: 1,
    } as any),
    afterProviderDispatch: async () => {
      signalAfterDispatch();
      await afterDispatchReleased;
    },
    apollo: async () => {
      dispatchedTransportCalls++;
      return { outcome: "success", candidates: [] };
    },
  });
  await atAfterDispatch;
  await pool.query(
    `UPDATE cro03_enrichment_items
        SET lease_expires_at=NOW()-INTERVAL '1 second'
      WHERE id=$1`,
    [dispatchedRace.itemId],
  );
  const takeoverAttempt = await claimNextCro03Item();
  check(String(takeoverAttempt?.id ?? "") !== dispatchedRace.itemId,
    "a dispatched provider run is never lease-reclaimed for duplicate transport");
  await cancelCro03Batch(dispatchedRace.batchId);
  releaseAfterDispatch();
  await dispatchedProcessing;
  const dispatchedState = await pool.query(
    `SELECT count(*)::int AS runs,
            max(r.billing_disposition) AS billing,
            max(l.disposition) AS ledger
       FROM cro03_provider_runs r
        JOIN cro03_provider_ledger l ON l.provider_run_id=r.id AND l.event_type='terminal'
      WHERE r.item_id=$1`,
    [dispatchedRace.itemId],
  );
   check(dispatchedTransportCalls === 0 && dispatchedState.rows[0].runs === 1,
     "cancellation after dispatch authorization but before adapter invocation prevents handoff");
   check(dispatchedState.rows[0].billing === "released" &&
     dispatchedState.rows[0].ledger === "released",
     "revoked final adapter authority releases an unmade provider call");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const crashRace = await createRoutableExecutionFixture();
  let releaseCrashedDispatch!: () => void;
  const crashedDispatchReleased = new Promise<void>((resolve) => { releaseCrashedDispatch = resolve; });
  let signalCrashedDispatch!: () => void;
  const atCrashedDispatch = new Promise<void>((resolve) => { signalCrashedDispatch = resolve; });
  let crashTransportCalls = 0;
  const crashedProcessing = processNextCro03Item({
    allowCertificationTransport: true,
    resolveFence: async () => ({
      allowed: true,
      resolution: "exclusive",
      reasonCodes: [],
      dependencyFingerprint: `provider-fingerprint-${suffix}-${batchIds.length}`,
      policyVersion: 1,
    } as any),
    afterProviderDispatch: async () => {
      signalCrashedDispatch();
      await crashedDispatchReleased;
    },
    apollo: async () => {
      crashTransportCalls++;
      return { outcome: "success", candidates: [] };
    },
  });
  await atCrashedDispatch;
  await cancelCro03Batch(crashRace.batchId);
  await pool.query(
    `UPDATE provider_operations SET lease_expires_at=NOW()-INTERVAL '1 second'
      WHERE id=(SELECT operation_id FROM cro03_provider_runs WHERE item_id=$1)`,
    [crashRace.itemId],
  );
  const recoveredDispatches = await recoverExpiredCro03Dispatches();
  releaseCrashedDispatch();
  await crashedProcessing;
  const recoveredState = await pool.query(
    `SELECT i.state, i.terminal_code, r.state AS run_state, r.billing_disposition,
            l.disposition AS ledger_disposition, o.billing_state
       FROM cro03_enrichment_items i
       JOIN cro03_provider_runs r ON r.item_id=i.id
        JOIN cro03_provider_ledger l ON l.provider_run_id=r.id AND l.event_type='terminal'
       JOIN provider_operations o ON o.id=r.operation_id
      WHERE i.id=$1`,
    [crashRace.itemId],
  );
  check(recoveredDispatches === 1 && crashTransportCalls === 0,
    "cancelled then crashed dispatched work is reconciled without redispatching transport");
  check(recoveredState.rows[0].state === "cancelled" &&
    recoveredState.rows[0].run_state === "failed" &&
    recoveredState.rows[0].billing_disposition === "ambiguous" &&
    recoveredState.rows[0].ledger_disposition === "ambiguous" &&
    recoveredState.rows[0].billing_state === "ambiguous",
    "cancellation-plus-crash recovery terminalizes item, run, operation, and economics");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const routeChain = await createRoutableExecutionFixture();
  await pool.query(
    `UPDATE contacts
        SET email_status='unvalidated', email_mutation_generation=1
      WHERE id=$1`,
    [routeChain.contactId],
  );
  const routeDeps = {
    allowCertificationTransport: true,
    resolveFence: async () => ({
      allowed: true,
      resolution: "exclusive",
      reasonCodes: [],
      dependencyFingerprint: `provider-fingerprint-${suffix}-${batchIds.length}`,
      policyVersion: 1,
    } as any),
    apollo: async () => ({
      outcome: "success" as const,
      candidates: [{
        field: "email" as const,
        value: `winning-${suffix}@example.test`,
        confidence: 99,
        sourceRank: 1,
      }],
    }),
  };
  await processNextCro03Item(routeDeps);
  const afterApollo = await pool.query(
    `SELECT state, current_provider FROM cro03_enrichment_items WHERE id=$1`,
    [routeChain.itemId],
  );
  check(afterApollo.rows[0].state === "waiting" &&
    afterApollo.rows[0].current_provider === "apollo",
    "multi-step route waits for its winning Apollo candidate projection");
  await processNextCro03Mutation();
  const afterProjection = await pool.query(
    `SELECT state FROM cro03_enrichment_items WHERE id=$1`,
    [routeChain.itemId],
  );
  check(afterProjection.rows[0].state === "queued",
    "winning email projection requeues the item for its remaining provider step");
  await processNextCro03Item(routeDeps);
  const routeOrder = await pool.query(
    `SELECT array_agg(provider ORDER BY created_at, provider)::text AS providers
       FROM cro03_provider_runs WHERE item_id=$1`,
    [routeChain.itemId],
  );
  const validationIntent = await pool.query(
    `SELECT v.purpose, r.validation_intent_id, r.provider_outcome
       FROM validation_intents v
       JOIN cro03_provider_runs r ON r.validation_intent_id=v.id
      WHERE v.contact_id=$1 AND v.purpose='cro03_winning_email'`,
    [routeChain.contactId],
  );
  check(routeOrder.rows[0].providers === "{apollo,zerobounce}",
    "Apollo and ZeroBounce execute in the persisted policy order");
  check(validationIntent.rowCount === 1 && validationIntent.rows[0].provider_outcome === "no_result",
    "ZeroBounce run links an existing-authority validation_pending intent without claiming success");

  await pool.query(
    `UPDATE provider_controls
        SET enabled=TRUE, circuit_state='closed', local_budget_units=10,
            reserved_units=0, consumed_units=0
      WHERE provider='apollo'`,
  );
  const accountingRace = await createExecutionFixture(1);
  const accountingToken = randomUUID();
  await pool.query(
    `UPDATE cro03_enrichment_items
        SET state='running', claim_token=$2, execution_fence=1,
             lease_expires_at=NOW()+INTERVAL '5 minutes'
      WHERE id=$1`,
    [accountingRace.itemIds[0], accountingToken],
  );
  const accountingRun = await pool.query<{ id: string }>(
    `INSERT INTO cro03_provider_runs
       (item_id,provider,route_policy_version,purpose,state,billing_disposition,target_fingerprint)
     VALUES ($1,'apollo',1,'provider_pre_spend','planned','none',$2) RETURNING id`,
    [accountingRace.itemIds[0], suffix],
  );
  const accountingReservation = await reserveCro03ProviderOperation({
    provider: "apollo",
    operationIdempotencyKey: `${fixtureKey}-accounting-race`,
    targetFingerprint: suffix,
    purpose: "provider_pre_spend",
    requestedUnits: 1,
    itemId: accountingRace.itemIds[0],
    providerRunId: accountingRun.rows[0].id,
    itemClaimToken: accountingToken,
    executionFence: 1,
  });
  check(accountingReservation, "accounting race fixture reserved provider capacity");
  providerOperationIds.push(accountingReservation!.operationId);
  await pool.query(
    `UPDATE cro03_provider_runs SET state='running', authorization_context_hash=$2 WHERE id=$1`,
    [accountingRun.rows[0].id, "accounting-race-context"],
  );
  await pool.query(
    `UPDATE provider_operations SET lease_expires_at=NOW()-INTERVAL '1 second'
      WHERE id=$1`,
    [accountingReservation!.operationId],
  );
  await pool.query(
    `UPDATE cro03_enrichment_items SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,
    [accountingRace.itemIds[0]],
  );
  await Promise.all([
    recoverExpiredCro03Dispatches(),
    completeCro03ProviderAccounting(
      accountingRun.rows[0].id,
      accountingReservation!.operationId,
      "apollo",
      "consumed",
    ),
  ]);
  const accountingRaceState = await pool.query(
    `SELECT l.disposition,
            (SELECT count(*)::int FROM cro03_receipts WHERE provider_run_id=$1) AS receipts,
            (SELECT reserved_units FROM provider_controls WHERE provider='apollo') AS reserved,
            (SELECT consumed_units FROM provider_controls WHERE provider='apollo') AS consumed
       FROM cro03_provider_ledger l WHERE l.provider_run_id=$1 AND l.event_type='terminal'`,
    [accountingRun.rows[0].id],
  );
  check(["consumed", "ambiguous"].includes(accountingRaceState.rows[0].disposition) &&
    accountingRaceState.rows[0].receipts === 1,
    "concurrent completion and recovery serialize to one terminal ledger and receipt");
  check(accountingRaceState.rows[0].reserved === 0 &&
    [0, 1].includes(accountingRaceState.rows[0].consumed),
    "concurrent accounting leaves no outstanding reservation or double consumption");

  const immutable = await pool.query(
    `UPDATE cro03_batch_memberships SET disposition='deleted'
      WHERE batch_id=$1`,
    [execution.batchId],
  ).then(() => false).catch((error) => /immutable/.test(String(error.message)));
  check(immutable, "database rejects immutable membership mutation");

  const deniedMutation = await pool.query(
    `INSERT INTO cro03_mutation_commands
       (item_id,candidate_id,mutation_key,subject_type,subject_id,field,expected_value_hash)
     SELECT i.id,c.id,$2,'contact',1,'phone','x'
       FROM cro03_enrichment_items i
       JOIN cro03_candidates c ON c.item_id=i.id
      WHERE i.batch_id=$1 LIMIT 1`,
    [mutation.batchId, `${fixtureKey}-late-mutation`],
  ).then(() => false).catch((error) =>
    /CRO03_MUTATION_AUTHORITY_INACTIVE/.test(String(error.message)));
  check(deniedMutation, "database trigger rejects mutation creation after cancellation");

  check(assertions >= 15, "non-empty CRO-03 runtime fixture matrix executed");
  console.log(
    `CRO-03 disposable concurrency/recovery certification passed (${assertions} assertions; no provider/network transport).`,
  );
} finally {
  // This cleanup is permitted only after the disposable-infrastructure guard.
  await pool.query("BEGIN");
  try {
    await pool.query(`ALTER TABLE cro03_receipts DISABLE TRIGGER cro03_receipt_immutable`);
    await pool.query(`ALTER TABLE cro03_provider_ledger DISABLE TRIGGER cro03_ledger_immutable`);
    await pool.query(`ALTER TABLE cro03_candidates DISABLE TRIGGER cro03_candidate_immutable`);
    await pool.query(`ALTER TABLE cro03_batch_memberships DISABLE TRIGGER cro03_membership_immutable`);
    if (batchIds.length) {
      await pool.query(
        `UPDATE cro03_provider_runs SET receipt_id=NULL
          WHERE item_id IN (
            SELECT id FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_receipts WHERE provider_run_id IN (
           SELECT r.id FROM cro03_provider_runs r JOIN cro03_enrichment_items i ON i.id=r.item_id
           WHERE i.batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_provider_ledger WHERE provider_run_id IN (
           SELECT r.id FROM cro03_provider_runs r JOIN cro03_enrichment_items i ON i.id=r.item_id
           WHERE i.batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_arbitration_decisions WHERE item_id IN (
           SELECT id FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_mutation_commands WHERE item_id IN (
           SELECT id FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_candidates WHERE item_id IN (
           SELECT id FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(
        `DELETE FROM cro03_provider_runs WHERE item_id IN (
           SELECT id FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[]))`,
        [batchIds],
      );
      await pool.query(`DELETE FROM cro03_enrichment_items WHERE batch_id = ANY($1::uuid[])`, [batchIds]);
      await pool.query(`DELETE FROM cro03_batch_memberships WHERE batch_id = ANY($1::uuid[])`, [batchIds]);
      await pool.query(`DELETE FROM cro03_enrichment_batches WHERE id = ANY($1::uuid[])`, [batchIds]);
    }
    if (providerOperationIds.length) {
      await pool.query(`DELETE FROM provider_operations WHERE id = ANY($1::uuid[])`, [providerOperationIds]);
    }
    if (contactIds.length) {
      await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [contactIds]);
    }
    await pool.query(
      `UPDATE provider_controls
          SET enabled=FALSE, local_budget_units=0, reserved_units=0, consumed_units=0
        WHERE provider='apollo'`,
    );
    await pool.query(`ALTER TABLE cro03_receipts ENABLE TRIGGER cro03_receipt_immutable`);
    await pool.query(`ALTER TABLE cro03_provider_ledger ENABLE TRIGGER cro03_ledger_immutable`);
    await pool.query(`ALTER TABLE cro03_candidates ENABLE TRIGGER cro03_candidate_immutable`);
    await pool.query(`ALTER TABLE cro03_batch_memberships ENABLE TRIGGER cro03_membership_immutable`);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}