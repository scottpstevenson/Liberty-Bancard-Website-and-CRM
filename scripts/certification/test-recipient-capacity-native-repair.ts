import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "recipient capacity native repair certification" });
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
const repairPath = "docs/certification/canonical-enrichment-recipient-capacity-native-repair-v1.sql";
const guard = `SELECT EXISTS (
  SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid=to_regclass('public.sfp_recipient_address_commitments')
    AND t.tgname='sfp_global_recipient_capacity_contract' AND t.tgenabled IN ('O','A')
    AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgtype=7
    AND p.pronamespace='public'::regnamespace
    AND p.proname='crm_enforce_global_recipient_capacity'
    AND md5(p.prosrc)='f539e6284a16e3686ab61df964c16779'
) installed`;
const protectedTables = [
  "contacts", "businesses", "contact_business_link_decisions", "provider_operations",
  "provider_observations", "sequence_enrollments", "communication_events",
  "sfp_recipient_address_commitments", "sfp_global_recipient_slots", "sfp_campaign_staging_intents",
];
async function snapshot() {
  const values: Record<string, unknown> = {};
  for (const table of protectedTables) {
    values[table] = (await client.query(`SELECT count(*) n,
      md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash
      FROM public.${table} t`)).rows[0];
  }
  values.subjectFk = (await client.query(`SELECT pg_get_constraintdef(oid) definition,convalidated
    FROM pg_constraint WHERE conrelid='public.sfp_recipient_address_commitments'::regclass
      AND conname='sfp_recipient_global_slot_subject_fk'`)).rows;
  return values;
}
try {
  const baseline = await snapshot();
  // Reproduce the exact production absence, never weaken a guard expectation.
  await client.query(`DROP TRIGGER IF EXISTS sfp_global_recipient_capacity_contract
    ON public.sfp_recipient_address_commitments;
    DROP FUNCTION public.crm_enforce_global_recipient_capacity();`);
  assert.equal((await client.query(guard)).rows[0].installed, false);
  await client.query(fs.readFileSync(repairPath, "utf8"));
  assert.equal((await client.query(guard)).rows[0].installed, true);
  assert.deepEqual(await snapshot(), baseline);
  await client.query(fs.readFileSync(repairPath, "utf8"));
  assert.equal((await client.query(guard)).rows[0].installed, true);
  assert.deepEqual(await snapshot(), baseline);
  const receipt = {
    observedAt: new Date().toISOString(), checks: 5,
    scope: "Disposable native delivery/reapply and whole-row preservation only; not recipient selection or concurrency",
    reproducedMissingProductionFunctionAndTrigger: true,
    installedExactRequiredFingerprintAndTriggerShape: true, reapplySafe: true,
    originalRowsAndSubjectForeignKeyUnchanged: true,
    repairPath, productionExecution: false, taskComplete: false,
  };
  fs.writeFileSync("docs/certification/canonical-enrichment-recipient-capacity-native-repair-test.json",
    JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
} finally { await client.end(); }