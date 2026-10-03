/**
 * Tests the forward source migration on a disposable DB reproducing the
 * observed production mismatch. No network providers or production connection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

async function main() {
  await assertDisposableTestInfrastructure({ operation: "crm-native-repair" });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  const canonicalRepair = fs.readFileSync("migrations/0329_crm_native_contract_repair.sql", "utf8");
  const consoleMode = process.argv.includes("--console");
  const repairFile = consoleMode
    ? "docs/certification/canonical-enrichment-native-console.sql"
    : "migrations/0329_crm_native_contract_repair.sql";
  const repair = fs.readFileSync(repairFile, "utf8");
  const verify = fs.readFileSync("docs/certification/canonical-enrichment-native-verify.sql", "utf8");
  const original = fs.readFileSync("migrations/0314_sfp_verified_recipient_link_commitments.sql", "utf8");
  const match = original.match(/CREATE OR REPLACE FUNCTION enforce_reviewed_contact_business_link\(\)[\s\S]*?END \$\$;/);
  assert(match, "0314 reviewed trigger source not found");
  const oldReview = match[0];
  const readerRole = `cert_native_reader_${randomUUID().replaceAll("-", "")}`;
  let checks = 0;
  const check = (value: unknown, message: string) => { assert(value, message); checks++; };
  const consoleForm = (source: string) => {
    const body = source.match(/DO \$crm_native_repair\$([\s\S]+)\$crm_native_repair\$;\s*$/)?.[1];
    assert(body, "Canonical repair block not found");
    return "DO E'" + body.replace(/\\/g, "\\\\").replace(/'/g, "''")
      .replace(/;/g, "\\073").replace(/\$/g, "\\044") + "';\n";
  };
  const guard = async () => (await client.query(verify)).rows[0];
  const allTrue = (row: Record<string, boolean>) => Object.values(row).every(v => v === true);
  const snapshot = async () => ({
    procedures: (await client.query(`SELECT oid,proname,md5(prosrc) body_md5,proowner,
      proacl::text,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('crm_identity_name','crm_identity_domain','crm_automatic_relationship_reasons',
        'enforce_reviewed_contact_business_link') ORDER BY proname`)).rows,
    triggers: (await client.query(`SELECT oid,tgname,tgfoid,tgtype,tgenabled,pg_get_triggerdef(oid) definition
      FROM pg_trigger WHERE tgrelid IN ('contact_business_link_decisions'::regclass,
        'contact_business_system_link_evidence'::regclass,'contact_business_sfp_link_evidence'::regclass)
      ORDER BY oid`)).rows,
    constraints: (await client.query(`SELECT oid,conname,convalidated,pg_get_constraintdef(oid) definition
      FROM pg_constraint WHERE conrelid IN ('contact_business_link_decisions'::regclass,
        'contact_business_system_link_evidence'::regclass,'sfp_outreach_eligibility'::regclass,
        'sfp_campaign_staging_intents'::regclass) ORDER BY oid`)).rows,
    entityNotNull: (await client.query(`SELECT attnotnull FROM pg_attribute
      WHERE attrelid='contact_business_system_link_evidence'::regclass AND attname='source_entity_id'`)).rows[0].attnotnull,
    counts: (await client.query(`SELECT (SELECT count(*) FROM contacts) contacts,
      (SELECT count(*) FROM businesses) businesses,
      (SELECT count(*) FROM contact_business_link_decisions) decisions,
      (SELECT count(*) FROM provider_operations) operations,
      (SELECT count(*) FROM sequence_enrollments) enrollments,
      (SELECT count(*) FROM communication_events) communications,
      (SELECT count(*) FROM drizzle.__drizzle_migrations) journal_rows`)).rows[0],
  });
  try {
    if (consoleMode) {
      const originalDo = canonicalRepair.slice(canonicalRepair.indexOf("DO $crm_native_repair$"));
      await assert.rejects(client.query(originalDo.split(";")[0]),
        /unterminated dollar-quoted string/); checks++;
      check((repair.match(/;/g) ?? []).length === 1, "Console transport has only the terminating semicolon");
      check(!repair.includes("$"), "Console transport has no dollar-quote delimiters");
      const start = repair.indexOf("DO E'");
      check(start >= 0, "Console transport uses a PostgreSQL escape-string literal");
      const literal = repair.slice(start + 3).trim().replace(/;$/, "");
      const decoded = (await client.query("SELECT " + literal + " AS body")).rows[0].body;
      assert.equal(decoded, canonicalRepair.match(/DO \$crm_native_repair\$([\s\S]+)\$crm_native_repair\$;\s*$/)?.[1]);
      checks++;
    }
    check(allTrue(await guard()), "Fresh normal migration chain must satisfy native guards");
    // Reproduce only the observed physical mismatch, not whole historical DDL.
    await client.query(oldReview);
    await client.query(`DROP FUNCTION crm_automatic_relationship_reasons(integer,integer,uuid,integer);
      DROP FUNCTION crm_identity_name(text); DROP FUNCTION crm_identity_domain(text);
      ALTER TABLE contact_business_system_link_evidence ALTER COLUMN source_entity_id SET NOT NULL;`);
    assert.deepEqual(await guard(), {
      installed: false, immutable_evidence_trigger: true, evidence_table: true, evidence_column: true,
      evidence_foreign_keys: true, sfp_contact_checks: true, relationship_evaluator: false,
    }); checks++;
    const before = await snapshot();
    check(before.procedures[0].body_md5 === "30910090e380e90ea27bff572d2c5847", "Exact production predecessor reproduced");

    // Inject failure after the native definitions execute. Single-statement
    // atomicity must roll back all definitions and nullability, without BEGIN.
    const canonicalFaulted = canonicalRepair.replace("$reviewed_0325$;\n", "$reviewed_0325$;\n  RAISE EXCEPTION 'CERT_INJECTED_FAILURE';\n");
    const faulted = consoleMode ? consoleForm(canonicalFaulted) : canonicalFaulted;
    check(faulted !== repair, "Fault injection is at the reviewed source boundary");
    await assert.rejects(client.query(faulted), /CERT_INJECTED_FAILURE/); checks++;
    assert.deepEqual(await snapshot(), before); checks++;

    // Incorrect predecessor and missing/disabled native guards fail closed.
    await client.query(oldReview.replace("BEGIN\n", "BEGIN\n  -- certification drift\n"));
    await assert.rejects(client.query(repair), /CRM_NATIVE_REPAIR_UNEXPECTED_REVIEW_BODY/); checks++;
    await client.query(oldReview);
    await client.query("ALTER TABLE contact_business_link_decisions DISABLE TRIGGER contact_business_link_review_contract");
    await assert.rejects(client.query(repair), /CRM_NATIVE_REPAIR_REVIEW_TRIGGER_SHAPE_MISMATCH/); checks++;
    await client.query("ALTER TABLE contact_business_link_decisions ENABLE TRIGGER contact_business_link_review_contract");
    assert.deepEqual(await snapshot(), before); checks++;

    // An unprivileged owner cannot be silently elevated by the repair.
    await client.query(`CREATE ROLE ${readerRole}`);
    await client.query(`SET ROLE ${readerRole}`);
    await assert.rejects(client.query(repair), /permission denied|CRM_NATIVE_REPAIR_.*PERMISSION_REQUIRED/); checks++;
    await client.query("RESET ROLE");
    assert.deepEqual(await snapshot(), before); checks++;

    await client.query(repair);
    const after = await snapshot();
    check(allTrue(await guard()), "All seven unchanged native guards pass after repair");
    assert.deepEqual(after.triggers, before.triggers); checks++;
    assert.deepEqual(after.constraints, before.constraints); checks++;
    assert.deepEqual(after.counts, before.counts); checks++;
    check(after.entityNotNull === false, "0325 optional source-entity semantics restored");
    const newReview = after.procedures.find(r => r.proname === "enforce_reviewed_contact_business_link");
    const previousReview = before.procedures.find(r => r.proname === "enforce_reviewed_contact_business_link");
    check(newReview.body_md5 === "46f89326f7c158ac739814ce343c2559", "Exact intended reviewed body installed");
    assert.deepEqual([newReview.oid, newReview.proowner, newReview.proacl, newReview.prosecdef, newReview.proconfig],
      [previousReview.oid, previousReview.proowner, previousReview.proacl, previousReview.prosecdef, previousReview.proconfig]); checks++;

    // Representative supported Google identity without cohort, website or deal.
    const contact = (await client.query(`INSERT INTO contacts(first_name,last_name,email,phone,company_name,record_class)
      VALUES('Native','Fixture','native-repair-fixture@example.invalid','','Native Fixture LLC','production') RETURNING id`)).rows[0];
    const business = (await client.query(`INSERT INTO businesses(canonical_name,normalized_name,record_class,google_place_id)
      VALUES('Native Fixture','nativefixture','canonical','native-repair-fixture') RETURNING id`)).rows[0];
    const sourceLink = (await client.query(`INSERT INTO canonical_source_links
      (business_id,source_system,source_type,stable_key) VALUES($1,'google_maps','place','native-repair-fixture') RETURNING id`,
      [business.id])).rows[0];
    await client.query(`INSERT INTO contact_source_events
      (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
      VALUES($1,'native-repair-fixture-event','import','google_maps_outscraper','native-repair-fixture','system','native-repair-cert',
        '{"place_id":"native-repair-fixture"}'::jsonb)`, [contact.id]);
    const reasons = (await client.query("SELECT crm_automatic_relationship_reasons($1,$2,$3,NULL) reasons",
      [contact.id, business.id, sourceLink.id])).rows[0].reasons;
    assert.deepEqual(reasons, []); checks++;
    await assert.rejects(client.query(`INSERT INTO contact_business_link_decisions
      (contact_id,business_id,decision,decision_key,actor_id)
      VALUES($1,$2,'verified','native-cert-missing-evidence','system')`, [contact.id,business.id]),
      /COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED/); checks++;
    const evidence = (await client.query(`INSERT INTO contact_business_system_link_evidence
      (decision_key,contact_id,business_id,source_link_id,source_entity_id,rule_version,facts_hash,facts)
      VALUES('native-cert-supported',$1,$2,$3,NULL,'crm_evidence_identity_v2',repeat('a',64),'{}') RETURNING id`,
      [contact.id,business.id,sourceLink.id])).rows[0];
    await client.query(`INSERT INTO contact_business_link_decisions
      (contact_id,business_id,decision,decision_key,actor_id,system_evidence_id)
      VALUES($1,$2,'verified','native-cert-supported','system',$3)`, [contact.id,business.id,evidence.id]);
    check((await client.query("SELECT count(*) FROM contact_business_link_decisions WHERE decision_key='native-cert-supported'")).rows[0].count === "1",
      "Supported identity writes pass the real repaired native trigger");
    await assert.rejects(client.query("UPDATE contact_business_system_link_evidence SET facts='{}' WHERE id=$1",
      [evidence.id]), /COMMERCIAL_SYSTEM_LINK_EVIDENCE_IMMUTABLE/); checks++;

    const beforeReplay = await snapshot();
    await client.query(repair);
    assert.deepEqual(await snapshot(), beforeReplay); checks++;
    check(allTrue(await guard()), "Replay leaves native guards passing");
    const receipt = {
      scope: "Disposable native repair certificate; no production execution",
      repairFile,
      repairSha256: createHash("sha256").update(repair).digest("hex"),
      canonicalSourceSha256: createHash("sha256").update(canonicalRepair).digest("hex"),
      consoleTransport: consoleMode,
      partialDollarQuotedStatementFailureReproduced: consoleMode,
      consoleBodyRoundTripExact: consoleMode,
      observedAt: new Date().toISOString(), checks,
      productionMismatchReproduced: true, atomicFailureRecovery: true, safeReplay: true,
      unknownBodyRejected: true, disabledTriggerRejected: true, insufficientPermissionRejected: true,
      triggerIdentityAndConstraintsPreserved: true, functionOwnerAclAndSecurityPreserved: true,
      repairDataProviderEnrollmentAndJournalCountsUnchanged: true,
      supportedIdentityEvaluatorExecuted: true, missingEvidenceWriteRejected: true,
      supportedNativeLinkWritePassed: true, immutableEvidenceWriteRejected: true,
      nativeGuard: await guard(), productionVerified: false,
    };
    const receiptFile = consoleMode
      ? "docs/certification/canonical-enrichment-native-console-test.json"
      : "docs/certification/canonical-enrichment-native-repair-test.json";
    fs.writeFileSync(receiptFile, JSON.stringify(receipt,null,2)+"\n");
    console.log(JSON.stringify(receipt,null,2));
  } finally {
    await client.query("RESET ROLE");
    await client.query(`DROP ROLE IF EXISTS ${readerRole}`);
    client.release();
    await pool.end();
  }
}
main().catch(error => {
  console.error("Native repair certification failed:", error.message);
  console.error(error.stack?.split("\n").filter((line: string) => line.trim().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});