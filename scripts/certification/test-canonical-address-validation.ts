import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "canonical address ownership certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const { db, pool } = await import("../../server/db");
const {
  claimCanonicalAddressValidation, bindCanonicalAddressOperation,
  markCanonicalAddressDispatch, releaseCanonicalAddressValidation,
} = await import("../../server/services/canonical-address-validation");
const { findFreshProviderObservation } = await import("../../server/services/cro03/sfp-outreach-policy");
const { assertSystemLinkDatabaseGuard, assertSfpLinkDatabaseGuard } =
  await import("../../server/services/commercial-link-authority");
let checks = 0;
const check = (value: unknown, message: string) => { assert(value, message); checks++; };
const key = randomUUID();
const hash = createHash("sha256").update(`${key}@example.invalid`).digest("hex");
const operationId = randomUUID();
const observationId = randomUUID();
const claim = (addressHash = hash) => db.transaction(tx => claimCanonicalAddressValidation(addressHash, tx));
try {
  await assertSystemLinkDatabaseGuard(db); checks++;
  await assertSfpLinkDatabaseGuard(db); checks++;
  // Affiliation/native protections are checked with the entire approved body,
  // including after the coordinated receipt-scope migration.
  const raced = await Promise.all(Array.from({ length: 12 }, () => claim()));
  const winners = raced.filter(value => value !== null);
  check(winners.length === 1, "Exactly one globally normalized address owner under concurrency");
  const owner = winners[0]!;
  check(await claim() === null, "A second business/import cannot purchase concurrently");
  await assert.rejects(bindCanonicalAddressOperation({ ...owner, claimToken: randomUUID() }, operationId),
    /CLAIM_LOST/); checks++;
  await pool.query(`INSERT INTO provider_operations
    (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES($1,'zerobounce','email_validation','certification',$2,'system','business:101','pending')`,
    [operationId, key]);
  await bindCanonicalAddressOperation(owner, operationId); checks++;
  await db.transaction(tx => markCanonicalAddressDispatch(owner, operationId, tx)); checks++;
  await pool.query(`UPDATE canonical_address_validation_claims SET lease_expires_at=NOW()-INTERVAL '1 day'
    WHERE email_token_hash=$1`, [hash]);
  check(await claim() === null, "Expiry cannot turn dispatched/unknown work into another paid request");
  check(await releaseCanonicalAddressValidation(owner) === false, "Unknown transport outcome remains fenced");
  await pool.query(`UPDATE provider_operations SET state='completed' WHERE id=$1`, [operationId]);
  await pool.query(`INSERT INTO provider_observations
    (id,provider,operation_id,subject_type,subject_id,email_token_hash,outcome,retryable,observed_at,expires_at)
    VALUES($1,'zerobounce',$2,'business',101,$3,'valid',FALSE,
      NOW()-INTERVAL '1 hour',NOW()+INTERVAL '29 days')`, [observationId, operationId, hash]);
  const original = (await pool.query(`SELECT subject_type,subject_id,operation_id,
    observed_at::text,expires_at::text FROM provider_observations WHERE id=$1`, [observationId])).rows[0];
  check(await releaseCanonicalAddressValidation(owner), "A durable completed receipt safely releases the owner");
  const a = await findFreshProviderObservation({ businessId: 101, emailTokenHash: hash, ttlDays: 30 });
  const b = await findFreshProviderObservation({ businessId: 202, emailTokenHash: hash, ttlDays: 30 });
  check(a?.operationId === operationId && b?.operationId === operationId,
    "Independently admitted businesses reference ONE original receipt");
  check(a?.observedAt === original.observed_at && b?.expiresAt === original.expires_at,
    "Reused validation time and expiry remain lossless original facts");
  const after = (await pool.query(`SELECT subject_type,subject_id,operation_id,
    observed_at::text,expires_at::text FROM provider_observations WHERE id=$1`, [observationId])).rows[0];
  assert.deepEqual(after, original); checks++;
  check(await findFreshProviderObservation({ businessId: 202, emailTokenHash: hash, ttlDays: 0 }) === null,
    "A receipt outside the caller freshness policy is not reused");
  const rejectedHash = createHash("sha256").update(randomUUID()).digest("hex");
  const rejectedOperation = randomUUID();
  await pool.query(`INSERT INTO provider_operations
    (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES($1,'zerobounce','email_validation','certification',$2,'system','business:101','completed')`,
    [rejectedOperation, randomUUID()]);
  await pool.query(`INSERT INTO provider_observations
    (provider,operation_id,subject_type,subject_id,email_token_hash,outcome,retryable,observed_at,expires_at)
    VALUES('zerobounce',$1,'business',101,$2,'invalid',FALSE,
      NOW()-INTERVAL '1 hour',NOW()+INTERVAL '29 days')`, [rejectedOperation, rejectedHash]);
  check((await findFreshProviderObservation({ businessId: 202, emailTokenHash: rejectedHash, ttlDays: 30 }))?.outcome === "invalid",
    "Fresh rejected addresses also reuse real hygiene facts without another purchase");
  const other = createHash("sha256").update(randomUUID()).digest("hex");
  const independent = await db.transaction(tx => claimCanonicalAddressValidation(other, tx));
  check(independent !== null, "An unresolved address does not block independent address work");
  check(await releaseCanonicalAddressValidation(independent!), "Definitively pre-I/O claims are recoverable");
  const next = await claim();
  check(next !== null, "Durably completed work permits subsequent eligible processing");
  check(await releaseCanonicalAddressValidation(owner) === false, "Displaced tokens cannot release newer owners");
  check(await releaseCanonicalAddressValidation(next!), "The new owner can release its own pre-I/O work");
  const retryHash = createHash("sha256").update(randomUUID()).digest("hex");
  const retryOwner = (await claim(retryHash))!;
  const retryOp = randomUUID();
  await pool.query(`INSERT INTO provider_operations
    (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES($1,'zerobounce','email_validation','certification',$2,'system','business:101','pending')`,
    [retryOp, randomUUID()]);
  await bindCanonicalAddressOperation(retryOwner, retryOp);
  await db.transaction(tx => markCanonicalAddressDispatch(retryOwner, retryOp, tx));
  const dispatchAt = (await pool.query(`INSERT INTO provider_attempts
    (operation_id,attempt_number,outcome,dispatch_marked_at)
    VALUES($1,1,'completed',clock_timestamp()) RETURNING dispatch_marked_at::text`, [retryOp])).rows[0].dispatch_marked_at;
  const dispatchReceipt = { schema: "sfp-dispatch-receipt-v1", operationId: retryOp,
    outcome: "failed", dispatchMarkedAt: dispatchAt, providerUsage: { status: "known", quantity: "1", unit: "request" } };
  const retryReceiptFingerprint = createHash("sha256").update(JSON.stringify(dispatchReceipt)).digest("hex");
  await pool.query(`UPDATE provider_operations SET state='failed',sfp_dispatch_receipt=$2::jsonb,
    sfp_dispatch_receipt_fingerprint=$3,
    settled_units=1,provider_usage_quantity=1,provider_usage_unit='request',provider_usage_status='known'
    WHERE id=$1`, [retryOp, JSON.stringify(dispatchReceipt), retryReceiptFingerprint]);
  await pool.query(`INSERT INTO provider_observations
    (provider,operation_id,subject_type,subject_id,email_token_hash,outcome,retryable)
    VALUES('zerobounce',$1,'business',101,$2,'transport',TRUE)`, [retryOp,retryHash]);
  check(await releaseCanonicalAddressValidation(retryOwner), "Durably settled HTTP failure permits bounded retry");
  const retryNext = await claim(retryHash);
  check(retryNext !== null, "A definitive failed response does not strand the selected address");
  const billed = (await pool.query(`SELECT settled_units,provider_usage_quantity::text,
    provider_usage_status FROM provider_operations WHERE id=$1`, [retryOp])).rows[0];
  check(billed.settled_units === 1 && Number(billed.provider_usage_quantity) === 1
    && billed.provider_usage_status === "known", "Retry leaves original paid usage intact");
  check(await releaseCanonicalAddressValidation(retryNext!), "Retry token releases only its own pre-I/O work");
  const legacyHash=createHash("sha256").update(randomUUID()).digest("hex");
  const legacyOperation=randomUUID();
  await pool.query(`INSERT INTO provider_operations
    (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES($1,'zerobounce','email_validation','certification',$2,'system',$3,'failed')`,
    [legacyOperation,randomUUID(),legacyHash]);
  await pool.query(`INSERT INTO provider_attempts(operation_id,attempt_number,outcome,dispatch_marked_at)
    VALUES($1,1,'ambiguous',clock_timestamp())`,[legacyOperation]);
  check(await claim(legacyHash)===null,"A pre-cutover ambiguous operation without a shared claim cannot be repurchased");
  await pool.query(`UPDATE provider_operations SET state='completed' WHERE id=$1`,[legacyOperation]);
  check(await claim(legacyHash)===null,"Legacy coarse completed state is not settlement evidence");
  await pool.query(`INSERT INTO provider_observations
    (provider,operation_id,subject_type,subject_id,email_token_hash,outcome,retryable,observed_at,expires_at)
    VALUES('zerobounce',$1,'contact',999,$2,'valid',FALSE,NOW()-INTERVAL '40 days',NOW()-INTERVAL '10 days')`,
    [legacyOperation,legacyHash]);
  const afterLegacySettled=await claim(legacyHash);
  check(afterLegacySettled!==null,"Original settled legacy receipt permits stale-address refresh without rewriting it");
  await releaseCanonicalAddressValidation(afterLegacySettled!);
  const {validateEmailRaw}=await import("../../server/services/sdr/zerobounce");
  await assert.rejects(validateEmailRaw("physical-fence@example.invalid","disposable-no-provider"),
    /CANONICAL_ADDRESS_DISPATCH_CONTEXT_REQUIRED/);checks++;
  await assert.rejects(claimCanonicalAddressValidation(hash, db), /TRANSACTION_REQUIRED/); checks++;
  check(getBlockedCertificationNetworkAttemptCount() === 0, "No attempted external network access");
  console.log(`PASS: ${checks} canonical address ownership/receipt/native checks; zero provider requests`);
} finally {
  await pool.end();
}