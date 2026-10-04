import assert from "node:assert/strict";
import fs from "node:fs";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
import {canonicalAddressPreparationOwnerSql} from "../generate-canonical-address-preparation-repair";
await assertDisposableTestInfrastructure({operation:"owner-console address/preparation prerequisite delivery"});
applyCertificationProviderDenyBoundary({fatal:true});
const {pool,db}=await import("../../server/db");
const {assertCanonicalAddressReceiptContract,CANONICAL_ADDRESS_RECEIPT_CLAUSE,ORIGINAL_ADDRESS_RECEIPT_CLAUSE}
  =await import("../../server/services/canonical-address-receipt-contract");
const {assertCanonicalPreparationDatabaseGuard}
  =await import("../../server/services/canonical-recipient-preparation");
const {readCanonicalEnrichmentStatus}=await import("../../server/services/canonical-enrichment-status");
const ownerSql=canonicalAddressPreparationOwnerSql();
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;};
const constraintSnapshot=async()=>(await pool.query(`SELECT conname,pg_get_constraintdef(oid) definition
  FROM pg_constraint WHERE conrelid='cr04_enrollment_intents'::regclass
    AND conname NOT LIKE 'canonical_preparation_%'
    AND conname NOT IN ('cr04_enrollment_intents_program_id_fkey','cr04_enrollment_intents_business_id_fkey')
  ORDER BY conname`)).rows;
const effects=async()=>(await pool.query(`SELECT
  (SELECT count(*) FROM contacts) contacts,(SELECT count(*) FROM businesses) businesses,
  (SELECT count(*) FROM provider_operations) providers,(SELECT count(*) FROM provider_observations) observations,
  (SELECT count(*) FROM sequence_enrollments) enrollments,(SELECT count(*) FROM communication_events) messages,
  (SELECT count(*) FROM sfp_cohort_runs) cohorts`)).rows[0];
try {
  const before=await effects();
  const originalConstraints=await constraintSnapshot();
  const reviewedDefinition=(await pool.query(`SELECT pg_get_functiondef(
    'public.enforce_reviewed_contact_business_link()'::regprocedure) definition`)).rows[0].definition as string;
  // Build the observed absent-contract baseline ONLY inside private disposable
  // infrastructure. The repair itself never drops schema, guards or data.
  await pool.query(`DROP TRIGGER canonical_preparation_capacity ON cr04_enrollment_intents;
    DROP FUNCTION crm_enforce_canonical_preparation_capacity();
    ALTER TABLE cr04_enrollment_intents DROP COLUMN program_id,DROP COLUMN business_id,
      DROP COLUMN normalized_email_hash,DROP COLUMN preparation_state,DROP COLUMN preparation_snapshot;
    DROP TABLE canonical_address_validation_claims;
    DROP INDEX canonical_address_receipt_lookup_idx;`);
  await pool.query(reviewedDefinition.replace(CANONICAL_ADDRESS_RECEIPT_CLAUSE,ORIGINAL_ADDRESS_RECEIPT_CLAUSE));
  await assert.rejects(assertCanonicalPreparationDatabaseGuard(db),/CONTRACT_REQUIRED/);checks++;
  await assert.rejects(assertCanonicalAddressReceiptContract(db),/CONTRACT_REQUIRED/);checks++;
  const missingStatus=await readCanonicalEnrichmentStatus();
  check(missingStatus.nativeContracts.state==="blocked" && !missingStatus.preparations.currentAvailable,
    "Settings & Health still reports missing native contracts without a status endpoint 500");
  check(!missingStatus.automaticProgress.validation.available
    && missingStatus.automaticProgress.validation.pending===null
    && missingStatus.automaticProgress.validation.processing===null,
    "Unavailable queue counts stay explicitly unknown, never fabricated zeroes");
  check(!/\bDROP\s+(?:TABLE|COLUMN|TRIGGER|CONSTRAINT)\b/i.test(ownerSql),"Owner delivery never removes existing guards or data");
  await pool.query(ownerSql);
  await assertCanonicalPreparationDatabaseGuard(db);checks++;
  await assertCanonicalAddressReceiptContract(db);checks++;
  check((await pool.query(`SELECT md5(replace(prosrc,$1,$2)) hash FROM pg_proc
    WHERE oid='public.enforce_reviewed_contact_business_link()'::regprocedure`,
    [CANONICAL_ADDRESS_RECEIPT_CLAUSE,ORIGINAL_ADDRESS_RECEIPT_CLAUSE])).rows[0].hash==="46f89326f7c158ac739814ce343c2559",
    "Address change inverts byte-for-byte to the entire approved original routine");
  check((await pool.query(`SELECT md5(prosrc) hash FROM pg_proc
    WHERE oid='public.crm_enforce_canonical_preparation_capacity()'::regprocedure`)).rows[0].hash
    ==="6e8864b97bd634386a156bca78c2dc5b","Preparation routine is the exact canonical definition, not a live-hash override");
  check((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public'
    AND table_name='cr04_enrollment_intents'
    AND column_name IN ('program_id','business_id','normalized_email_hash','preparation_state','preparation_snapshot')`)).rows[0].n===5,
    "All five programme-preparation fields install through owner SQL");
  assert.deepEqual(await constraintSnapshot(),originalConstraints);checks++;
  await pool.query(ownerSql);
  await assertCanonicalPreparationDatabaseGuard(db);await assertCanonicalAddressReceiptContract(db);checks++;
  assert.deepEqual(await constraintSnapshot(),originalConstraints);checks++;
  await assert.rejects(pool.query(`INSERT INTO canonical_address_validation_claims(email_token_hash)
    VALUES('not-a-normalized-address-hash')`));checks++;
  await assert.rejects(pool.query(`INSERT INTO canonical_address_validation_claims(email_token_hash,claim_token)
    VALUES(repeat('a',64),gen_random_uuid())`));checks++;
  await assert.rejects(pool.query(`INSERT INTO canonical_address_validation_claims(email_token_hash,dispatched_at)
    VALUES(repeat('b',64),NOW())`));checks++;
  const repairedDefinition=(await pool.query(`SELECT pg_get_functiondef(
    'public.crm_enforce_canonical_preparation_capacity()'::regprocedure) definition`)).rows[0].definition;
  await pool.query(`CREATE OR REPLACE FUNCTION crm_enforce_canonical_preparation_capacity()
    RETURNS trigger LANGUAGE plpgsql AS $fixture$ BEGIN RETURN NEW; END $fixture$`);
  await assert.rejects(pool.query(ownerSql),/OWNER_REPAIR_FUNCTION_DRIFT/);checks++;
  await pool.query("ROLLBACK");
  check((await pool.query(`SELECT md5(prosrc) hash FROM pg_proc
    WHERE oid='public.crm_enforce_canonical_preparation_capacity()'::regprocedure`)).rows[0].hash
    !=="6e8864b97bd634386a156bca78c2dc5b","Drift aborts delivery instead of overwriting an unrecognized guard");
  await pool.query(repairedDefinition);
  await assertCanonicalPreparationDatabaseGuard(db);checks++;
  assert.deepEqual(await effects(),before);checks++;
  check(getBlockedCertificationNetworkAttemptCount()===0,"Owner schema delivery has zero provider/network effects");
  fs.writeFileSync("docs/certification/canonical-enrichment-address-preparation-native-repair-v1.json",
    JSON.stringify({observedAt:new Date().toISOString(),checks,
      scope:"Disposable complete owner SQL; installation, reapply, original constraint preservation and drift denial",
      productionExecution:false,ownerConsoleExecution:false,taskComplete:false,
      effectsBefore:before,effectsAfter:await effects(),networkAttempts:0},null,2)+"\n");
  console.log(`PASS: ${checks} owner address/preparation contract delivery checks`);
} finally {await pool.end();}