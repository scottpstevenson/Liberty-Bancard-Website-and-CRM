#!/usr/bin/env tsx
import {retainedCro03ProviderOperation} from "./fixtures/retained-cro03-provider-operation";
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
const {hashCro03Evidence}=await import("../server/services/cro03/source-staging");
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

async function createExecutionFixture(
  count: number,
  options: { contactIds?: readonly number[] } = {},
): Promise<{
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
    const contactId = options.contactIds?.[ordinal] ?? null;
    const subjectId = contactId ?? 2_000_000_000 + ordinal;
    const membership = await pool.query<{ id: string }>(
      `INSERT INTO cro03_batch_memberships
         (batch_id, ordinal, subject_type, subject_id, root_subject_type, root_subject_id, contact_id,
          selection_policy_version, dependency_fingerprint, pre_spend_decision,
          disposition, membership_hash, created_at)
       VALUES ($1, $2, 'contact', $3, 'contact', $3, $4, 1, $5, 'allowed',
               'executable', $6, '2000-01-01')
       RETURNING id`,
      [batchId, ordinal, subjectId, contactId, `fingerprint-${suffix}-${ordinal}`,
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
  const { batchId, itemIds } = await createExecutionFixture(1, { contactIds: [contactId] });
  const itemId = itemIds[0];

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
      JSON.stringify({id:contactId,companyName:"Certification Merchant",website:"example.test",phone:`556${suffix.slice(0,7)}`,email:`race-${suffix}-${contactIds.length-1}@example.test`,emailStatus:"valid"}),
      hashCro03Evidence({id:contactId,companyName:"Certification Merchant",website:"example.test",phone:`556${suffix.slice(0,7)}`,email:`race-${suffix}-${contactIds.length-1}@example.test`,emailStatus:"valid"}),
      JSON.stringify({policyVersion:1,providers:["apollo","zerobounce"],recipes:[{provider:"apollo",operation:"contact_enrichment",requiresPaidEligibility:true},{provider:"zerobounce",operation:"email_validation_backlink",requiresPaidEligibility:false}]}),
      hashCro03Evidence({policyVersion:1,providers:["apollo","zerobounce"],recipes:[{provider:"apollo",operation:"contact_enrichment",requiresPaidEligibility:true},{provider:"zerobounce",operation:"email_validation_backlink",requiresPaidEligibility:false}]})],
  );
  const item = await pool.query<{ id: string }>(
    `INSERT INTO cro03_enrichment_items
       (batch_id,membership_id,state,next_attempt_at,created_at,subject_snapshot_hash,route_plan_hash)
     SELECT $1,$2,'queued','1999-01-01','1999-01-01',subject_snapshot_hash,route_plan_hash FROM cro03_batch_memberships WHERE id=$2 RETURNING id`,
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
  let retiredCallerDenied=false;
  try { await reserveCro03ProviderOperation(reservationInput); } catch(error) { retiredCallerDenied=/Unapproved provider caller/.test(String(error)); }
  check(retiredCallerDenied,"retired enrichment-factory caller cannot issue provider authority");
  check(Number((await pool.query('SELECT count(*)::int n FROM provider_operations WHERE idempotency_key=$1',[reservationInput.operationIdempotencyKey])).rows[0].n)===0,"retired caller denial makes no reservation write");
  // Remaining assertions exercise current accounting and recovery against retained
  // pre-retirement data; the fixture does not certify a new reservation grant.
  const reservationA=await retainedCro03ProviderOperation(pool,reservationInput);
  providerOperationIds.push(reservationA!.operationId);
  const operationCounts = await pool.query(
    `SELECT count(*)::int AS operations,
            (SELECT reserved_units FROM provider_controls WHERE provider='apollo') AS reserved
       FROM provider_operations WHERE provider='apollo' AND idempotency_key=$1`,
    [reservationInput.operationIdempotencyKey],
  );
  check(operationCounts.rows[0].operations === 1 && operationCounts.rows[0].reserved === 1,
    "retained accounting fixture begins with exactly one reserved operation");

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
         (item_id,provider,route_policy_version,purpose,state,billing_disposition,
          target_fingerprint,operation_id)
       VALUES ($1,'apollo',1,'provider_pre_spend','planned','none',$2,$3) RETURNING id`,
      [foreignLineageFixture.itemIds[0], `${suffix}-foreign-lineage`, reservationA!.operationId],
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
   const reservedCrashOperation = await retainedCro03ProviderOperation(pool,{
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
     `UPDATE cro03_provider_runs SET operation_id=$2 WHERE id=$1`,
     [foreignRun.rows[0].id, reservationA!.operationId],
   );
   const mismatchedRunOperation = await pool.query(
     `INSERT INTO cro03_provider_ledger
        (provider_run_id,provider_operation_id,provider,entry_key,event_type,disposition,units)
      VALUES ($1,$2,'apollo',$3,'reservation','outstanding',1)`,
     [foreignRun.rows[0].id, reservedCrashOperation!.operationId,
       `invalid-run-operation:${foreignRun.rows[0].id}`],
   ).then(() => false).catch((error) =>
     /CRO03_LEDGER_RUN_OPERATION_PROVIDER_MISMATCH/.test(String(error.message)));
   check(mismatchedRunOperation,
     "database rejects ledger reservation whose operation differs from its run");
   const mismatchedRunProvider = await pool.query(
     `INSERT INTO cro03_provider_ledger
        (provider_run_id,provider_operation_id,provider,entry_key,event_type,disposition,units)
      VALUES ($1,$2,'outscraper',$3,'reservation','outstanding',1)`,
     [foreignRun.rows[0].id, reservationA!.operationId,
       `invalid-run-provider:${foreignRun.rows[0].id}`],
   ).then(() => false).catch((error) =>
     /CRO03_LEDGER_RUN_OPERATION_PROVIDER_MISMATCH/.test(String(error.message)));
   check(mismatchedRunProvider,
     "database rejects ledger reservation whose provider differs from its run and operation");
   const mismatchedReceiptOperation = await pool.query(
     `INSERT INTO cro03_receipts
        (provider_run_id,provider_operation_id,provider,receipt_key,billing_disposition,units,amount_micros)
      VALUES ($1,$2,'apollo',$3,'released',1,0)`,
     [foreignRun.rows[0].id, reservedCrashOperation!.operationId,
       `invalid-receipt-operation:${foreignRun.rows[0].id}`],
   ).then(() => false).catch((error) =>
     /CRO03_RECEIPT_RUN_OPERATION_PROVIDER_MISMATCH/.test(String(error.message)));
   check(mismatchedReceiptOperation,
     "database rejects receipt whose operation differs from its run");
   const mismatchedReceiptProvider = await pool.query(
     `INSERT INTO cro03_receipts
        (provider_run_id,provider_operation_id,provider,receipt_key,billing_disposition,units,amount_micros)
      VALUES ($1,$2,'outscraper',$3,'released',1,0)`,
     [foreignRun.rows[0].id, reservationA!.operationId,
       `invalid-receipt-provider:${foreignRun.rows[0].id}`],
   ).then(() => false).catch((error) =>
     /CRO03_RECEIPT_RUN_OPERATION_PROVIDER_MISMATCH/.test(String(error.message)));
   check(mismatchedReceiptProvider,
     "database rejects receipt whose provider differs from its run and operation");
   const mismatchedReceipt = await pool.query(
     `INSERT INTO cro03_receipts
        (provider_run_id,provider_operation_id,provider,receipt_key,billing_disposition,units,amount_micros)
      VALUES ($1,$2,'apollo',$3,'consumed',2,0)`,
     [providerRun.rows[0].id, reservationA!.operationId,
       `invalid-receipt:${providerRun.rows[0].id}`],
   ).then(() => false).catch((error) =>
     /CRO03_RECEIPT_LEDGER_LINEAGE_MISMATCH/.test(String(error.message)));
   check(mismatchedReceipt,
     "database rejects receipt units and amount without matching terminal ledger evidence");

  // The enrichment-factory caller is no longer approved for new provider
  // dispatch. Exercise current cancellation/recovery on retained reservation
  // data without reopening that caller or waiting for unreachable hooks.
  async function retainedRun(dispatched:boolean) {
    const fixture=await createRoutableExecutionFixture();
    await pool.query(`UPDATE cro03_enrichment_items SET state='running',claim_token=$2,
      execution_fence=1,lease_expires_at=NOW()+interval '5 minutes' WHERE id=$1`,[fixture.itemId,randomUUID()]);
    const run=(await pool.query(`INSERT INTO cro03_provider_runs
      (item_id,provider,route_policy_version,purpose,state,billing_disposition,target_fingerprint)
      VALUES($1,'apollo',1,'provider_pre_spend','planned','none',$2) RETURNING id`,[fixture.itemId,suffix])).rows[0];
    const operation=await retainedCro03ProviderOperation(pool,{provider:'apollo',operationIdempotencyKey:`${fixtureKey}-retained-${run.id}`,
      targetFingerprint:suffix,purpose:'provider_pre_spend',providerRunId:run.id});
    providerOperationIds.push(operation.operationId);
    if(dispatched) {
      const attempt=(await pool.query(`INSERT INTO provider_attempts(operation_id,attempt_number,outcome,dispatch_marked_at) VALUES($1,1,'pending',NOW()) RETURNING id`,[operation.operationId])).rows[0];
      await pool.query(`UPDATE cro03_provider_runs SET state='running',provider_attempt_id=$2 WHERE id=$1`,[run.id,attempt.id]);
    }
    return {...fixture,runId:run.id,operationId:operation.operationId};
  }
  const reservedCancellation=await retainedRun(false);
  check(await cancelCro03Batch(reservedCancellation.batchId),"operator cancellation accepts retained reserved work");
  const reservedCancelled=(await pool.query(`SELECT r.state,r.billing_disposition,o.billing_state
    FROM cro03_provider_runs r JOIN provider_operations o ON o.id=r.operation_id WHERE r.id=$1`,[reservedCancellation.runId])).rows[0];
  check(reservedCancelled.state==='cancelled' && reservedCancelled.billing_disposition==='released' && reservedCancelled.billing_state==='released',
    "retained undispatched reservation is cancelled and released without provider authority");

  const dispatchedCancellation=await retainedRun(true);
  await pool.query(`UPDATE cro03_enrichment_items SET lease_expires_at=NOW()-interval '1 second' WHERE id=$1`,[dispatchedCancellation.itemId]);
  const takeoverAttempt=await claimNextCro03Item();
  check(String(takeoverAttempt?.id??'')!==dispatchedCancellation.itemId,"retained running provider work is not lease-reclaimed for duplicate dispatch");
  await cancelCro03Batch(dispatchedCancellation.batchId);
  await pool.query(`UPDATE provider_operations SET lease_expires_at=NOW()-interval '1 second' WHERE id=$1`,[dispatchedCancellation.operationId]);
  check(await recoverExpiredCro03Dispatches()===1,"cancelled retained running work is recovered exactly once");
  const recoveredState=(await pool.query(`SELECT i.state,r.state run_state,r.billing_disposition,o.billing_state
    FROM cro03_enrichment_items i JOIN cro03_provider_runs r ON r.item_id=i.id
    JOIN provider_operations o ON o.id=r.operation_id WHERE i.id=$1`,[dispatchedCancellation.itemId])).rows[0];
  check(recoveredState.state==='cancelled' && recoveredState.run_state==='failed' && recoveredState.billing_disposition==='ambiguous' && recoveredState.billing_state==='ambiguous',
    "retained dispatched cancellation/crash remains ambiguous rather than claiming a clean release");
  check(await recoverExpiredCro03Dispatches()===0,"a second retained-dispatch recovery does not double-settle economics");

  const retiredRoute=await createRoutableExecutionFixture();
  await pool.query(`UPDATE cro03_enrichment_items SET created_at='1900-01-01',next_attempt_at='1900-01-01' WHERE id=$1`,[retiredRoute.itemId]);
  let forbiddenLegacyTransport=0,unreachableDispatchHooks=0;
  let retiredRouteDenied=false;
  try { await processNextCro03Item({allowCertificationTransport:true,
    resolveFence:async()=>({allowed:true,resolution:'exclusive',reasonCodes:[],dependencyFingerprint:`provider-fingerprint-${suffix}-${batchIds.length}`,policyVersion:1} as any),
    beforeProviderTransport:async()=>{unreachableDispatchHooks++;},
    afterProviderDispatch:async()=>{unreachableDispatchHooks++;},
    apollo:async()=>{forbiddenLegacyTransport++;return {outcome:'success',candidates:[]};}});
  } catch(error) { if(!/Unapproved provider caller/.test(String(error))) throw error; retiredRouteDenied=true; }
  const retiredRuns=await pool.query(`SELECT count(*)::int n FROM cro03_provider_runs WHERE item_id=$1 AND operation_id IS NOT NULL`,[retiredRoute.itemId]);
  check(retiredRouteDenied && forbiddenLegacyTransport===0 && unreachableDispatchHooks===0 && retiredRuns.rows[0].n===0,
    "retired legacy route invokes neither transport hooks nor adapters and obtains no provider operation");

  await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='closed',local_budget_units=10,reserved_units=0,consumed_units=0 WHERE provider='apollo'`);
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
  const accountingReservation = await retainedCro03ProviderOperation(pool,{
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
  // Immutable evidence and inert fixtures are retained until the launcher drops
  // this verified disposable database. Never disable native integrity triggers.
  await pool.end();
}
