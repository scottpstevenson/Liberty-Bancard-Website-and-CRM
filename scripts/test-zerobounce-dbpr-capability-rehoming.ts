#!/usr/bin/env tsx
/**
 * Task #1956, Step 6 test: DBPR exclusion on the real ZeroBounce spend path,
 * plus confirmation that validation-intent processing is governed by the
 * "email-validation" capability group (not "enrichment").
 *
 * Covers:
 *  1. buildZbEligibilityWhere (legacy campaign-engine path) excludes a
 *     contact whose linked business has DBPR-family canonical_source_links
 *     lineage, and still includes a non-DBPR contact.
 *  2. processValidationIntent (CRO03C-adjacent path) blocks a DBPR-linked
 *     contact's intent with terminal_code='dbpr_lineage_excluded' — before
 *     ever reaching the provider-control reservation.
 *  3. getJobCapabilityGroup("zerobounce-batch-validate", "validation-intent")
 *     resolves to "email-validation", confirming the re-home away from the
 *     "enrichment" group (background-profile.ts WORKER_CAPABILITY_GROUPS is
 *     the authoritative mapping this is driven by, so no separate query
 *     override is needed — the queue itself moved).
 *
 * NO real ZeroBounce/network call is made. DBPR blocking happens before the
 * provider_controls reservation step, so no budget/circuit state is touched.
 */
import { pool, db } from "../server/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildZbEligibilityWhere } from "../server/services/zerobounce-eligibility";
import { processValidationIntent } from "../server/services/provider-readiness-control";
import { getJobCapabilityGroup } from "../server/services/background-profile";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const RUN = Date.now() % 10_000_000;
const cleanupContactIds: number[] = [];
const cleanupBusinessIds: number[] = [];

async function makeBusiness(dbpr: boolean): Promise<number> {
  const biz = await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, record_class)
     VALUES ($1, $2, 'canonical') RETURNING id`,
    [`T1956S6 Biz ${dbpr ? "DBPR" : "Clean"} ${RUN}`, `t1956s6-${dbpr ? "dbpr" : "clean"}-${RUN}`],
  );
  const businessId = biz.rows[0].id;
  cleanupBusinessIds.push(businessId);
  await pool.query(
    `INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key)
     VALUES ($1, $2, 'registry', $3)`,
    [businessId, dbpr ? "dbpr_hr" : "sunbiz", `t1956s6-${RUN}-${dbpr ? "dbpr" : "clean"}`],
  );
  return businessId;
}

async function makeContact(businessId: number | null, emailStatus: string): Promise<number> {
  const email = `t1956s6-${RUN}-${randomUUID().slice(0, 8)}@example-test.com`;
  const phone = `+1555${String(Date.now() + Math.floor(Math.random() * 1000000)).slice(-7)}`;
  const r = await pool.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, email_status, lead_score, business_id, email_mutation_generation)
     VALUES ('T1956S6', 'Test', $1, $2, $3, 50, $4, 1) RETURNING id`,
    [email, phone, emailStatus, businessId],
  );
  const id = r.rows[0].id;
  cleanupContactIds.push(id);
  return id;
}

async function makeValidationIntent(contactId: number, email: string, generation: number): Promise<string> {
  const { createHash } = await import("crypto");
  const tokenHash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const r = await db.execute(sql`
    INSERT INTO validation_intents (contact_id, normalized_email_token_hash, subject_generation, purpose, state, enqueue_state)
    VALUES (${contactId}, ${tokenHash}, ${generation}, 'contact_data_hygiene', 'pending', 'enqueued')
    RETURNING id
  `);
  return (r as any).rows[0].id;
}

async function cleanup() {
  if (cleanupContactIds.length) {
    await pool.query(`DELETE FROM validation_intents WHERE contact_id = ANY($1::int[])`, [cleanupContactIds]);
    await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [cleanupContactIds]);
  }
  if (cleanupBusinessIds.length) {
    await pool.query(`DELETE FROM canonical_source_links WHERE business_id = ANY($1::int[])`, [cleanupBusinessIds]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1::int[])`, [cleanupBusinessIds]);
  }
}

async function main() {
  try {
    console.log("── Setup ──");
    const dbprBusinessId = await makeBusiness(true);
    const cleanBusinessId = await makeBusiness(false);
    const dbprContactId = await makeContact(dbprBusinessId, "unvalidated");
    const cleanContactId = await makeContact(cleanBusinessId, "unvalidated");
    const noBusinessContactId = await makeContact(null, "unvalidated");

    console.log("── Test 1: legacy campaign-engine eligibility WHERE excludes DBPR lineage ──");
    const where = buildZbEligibilityWhere({ issue: "unvalidated_email", minLeadScore: 0 });
    const rows = await pool.query(
      `SELECT c.id FROM contacts c WHERE ${where} AND c.id = ANY($1::int[])`,
      [[dbprContactId, cleanContactId, noBusinessContactId]],
    );
    const eligible = new Set(rows.rows.map((r: any) => r.id));
    assert("DBPR-linked contact excluded from eligibility", !eligible.has(dbprContactId));
    assert("Clean-lineage contact still eligible", eligible.has(cleanContactId));
    assert("No-business contact still eligible (never excluded by absence)", eligible.has(noBusinessContactId));

    console.log("── Test 2: processValidationIntent blocks DBPR-linked contact pre-reservation ──");
    const dbprContactRow = (await pool.query(`SELECT email, email_mutation_generation FROM contacts WHERE id = $1`, [dbprContactId])).rows[0];
    const intentId = await makeValidationIntent(dbprContactId, dbprContactRow.email, dbprContactRow.email_mutation_generation);
    const outcome = await processValidationIntent(intentId);
    assert("DBPR-linked intent outcome is 'failed'", outcome === "failed", `got ${outcome}`);
    const intentRow = (await db.execute(sql`SELECT state, terminal_code FROM validation_intents WHERE id = ${intentId}::uuid`) as any).rows[0];
    assert("terminal_code is dbpr_lineage_excluded", intentRow?.terminal_code === "dbpr_lineage_excluded", JSON.stringify(intentRow));
    assert("state is blocked (not deferred/pending)", intentRow?.state === "blocked", JSON.stringify(intentRow));

    console.log("── Test 3: validation-intent job is governed by email-validation, not enrichment ──");
    const group = getJobCapabilityGroup("zerobounce-batch-validate", "validation-intent");
    assert("zerobounce-batch-validate queue resolves to email-validation group", group === "email-validation", `got ${group}`);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
