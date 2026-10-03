/**
 * Provider-free tests of the real selector and capacity/claim helpers.
 * The SQL migration is exercised only on a session-local temporary table.
 * No contacts, businesses, provider operations or real receipts are changed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "../server/db";
import { claimValidationCandidate, selectWinnersPerBusiness } from "../server/services/cro03/sfp-validation";
import { lockSfpRecipientCapacity } from "../server/services/cro03/sfp-recipient-capacity";
import type { UnifiedSfpCandidateView } from "../server/services/cro03/sfp-paid-evidence-writer";

const dialect = new PgDialect();
const originalExecute = db.execute;
const originalTransaction = db.transaction;
const cohort = "00000000-0000-4000-8000-000000000001";
const otherCohort = "00000000-0000-4000-8000-000000000002";
const program = "00000000-0000-4000-8000-000000000010";
const hash = (letter: string) => letter.repeat(64);
let checks = 0;
function check(value: unknown, description: string) {
  assert.ok(value, description);
  checks++;
  console.log(`PASS ${description}`);
}
function compile(query: any) {
  const result = dialect.sqlToQuery(query);
  return { text: result.sql.replace(/\s+/g, " "), params: result.params };
}
function candidate(id: number, businessId: number, addressHash: string, confidence: number) {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    business_id: businessId, field: "email", source: "first_party_crawl",
    subject_type: "business", disposition: "staged", confidence,
    masked_value: "i**o@example.test", normalized_value_hash: addressHash,
    created_at: "2026-10-02T00:00:00.000Z",
  };
}

async function main() {
  let free = [candidate(101, 1, hash("a"), 99), candidate(102, 1, hash("b"), 98),
    candidate(103, 1, hash("c"), 97), candidate(104, 1, hash("d"), 96),
    candidate(105, 2, hash("e"), 95)];
  let commitments: any[] = [];
  let history: any[] = [];
  const selectorQueries: string[] = [];
  (db as any).execute = async (query: any) => {
    const { text } = compile(query);
    selectorQueries.push(text);
    if (text.includes("SELECT id, business_id, field, source")) return { rows: free };
    if (text.includes("FROM sfp_paid_candidate_evidence")) return { rows: [] };
    if (text.includes("FROM businesses b") || text.includes("FROM contacts c")) return { rows: [] };
    if (text.includes("FROM sfp_recipient_address_commitments k")) return { rows: commitments };
    if (text.includes("FROM sfp_outreach_eligibility e")) return { rows: history };
    if (text.includes("FROM sfp_stage_items i")) return { rows: [] };
    throw new Error(`Unexpected selector query: ${text.slice(0, 100)}`);
  };
  let selected = await selectWinnersPerBusiness([1, 2], cohort, 1, 30);
  check(selected.filter(([id]) => id === 1).length === 3, "three distinct addresses, not one business winner");
  check(selected.filter(([id]) => id === 2).length === 1, "other businesses remain actionable");
  const first = selected[0][1];

  free.push(candidate(106, 1, hash("a"), 60));
  selected = await selectWinnersPerBusiness([1], cohort, 1, 30);
  check(new Set(selected.filter(([id]) => id === 1).map(([, c]) => c.normalizedValueHash)).size === 3,
    "duplicate source observations do not consume another recipient slot");

  history = [{ business_id: 1, source_kind: "paid", normalized_value_hash: hash("a"),
    normalized_value_hash_version: 1, status: "invalid", updated_at: "2026-10-02T00:00:00Z" }];
  selected = await selectWinnersPerBusiness([1], cohort, 1, 30);
  check(!selected.some(([, c]) => c.normalizedValueHash === hash("a")),
    "an invalid receipt excludes its address across source kinds");
  check(selected.some(([, c]) => c.normalizedValueHash === hash("d")),
    "an invalid winner permits the next address for the same business");

  history = [{ business_id: 1, cohort_run_id: otherCohort, source_kind: "paid",
    paid_id: otherCohort, normalized_value_hash: hash("a"), normalized_value_hash_version: 1,
    status: "validated_outreach_eligible", receipt_projection_needs_repair: true }];
  selected = await selectWinnersPerBusiness([1], cohort, 1, 30);
  check(selected.some(([, c]) => c.normalizedValueHash === hash("a")),
    "a fresh receipt can schedule reconciliation through another retained source without another dispatch");

  history = [];
  commitments = [{ business_id: 1, recipient_identity_hash: hash("f"),
    normalized_value_hash: hash("a"), normalized_value_hash_version: 1 }];
  selected = await selectWinnersPerBusiness([1], cohort, 1, 30);
  check(selected.filter(([id]) => id === 1).length === 2 &&
    !selected.some(([, c]) => c.normalizedValueHash === hash("a")),
    "one committed primary leaves two alternative slots, not a business-wide exclusion");
  commitments.push({ business_id: 1, recipient_identity_hash: hash("b") },
    { business_id: 1, recipient_identity_hash: hash("c") });
  selected = await selectWinnersPerBusiness([1], cohort, 1, 30);
  check(!selected.some(([id]) => id === 1), "a full global commitment set stops additional validation selection");
  check(selectorQueries.some(q => q.includes("previous_run.program_id=selected_run.program_id")),
    "eligibility history spans cohorts in the same program");

  const capacityQueries: Array<ReturnType<typeof compile>> = [];
  let occupied = [hash("a"), hash("b")];
  let ownerConflict = false;
  const tx = { execute: async (query: any) => {
    const queryData = compile(query);
    capacityQueries.push(queryData);
    if (queryData.text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (queryData.text.includes("business_id<>")) return { rows: ownerConflict ? [{ business_id: 2 }] : [] };
    return { rows: occupied.map((value, index) => ({
      id: index + 1, business_id: 1, recipient_identity_hash: value,
    })) };
  } };
  let capacity = await lockSfpRecipientCapacity(tx, program, "objective-a", 1, hash("c"));
  check(capacity.slot === 3 && capacity.role === "alternate", "commitments across programs leave only slot three");
  const lockKeys = capacityQueries.filter(q => q.text.includes("pg_advisory_xact_lock")).map(q => q.params[0]);
  capacityQueries.length = 0;
  await lockSfpRecipientCapacity(tx, otherCohort, "objective-b", 1, hash("c"));
  check(JSON.stringify(lockKeys) === JSON.stringify(capacityQueries
    .filter(q => q.text.includes("pg_advisory_xact_lock")).map(q => q.params[0])),
  "business capacity and mailbox ownership locks are global, not program-scoped");
  occupied.push(hash("c"));
  await assert.rejects(() => lockSfpRecipientCapacity(tx, program, "objective-a", 1, hash("d")),
    /SFP_STAGING_BUSINESS_RECIPIENT_CAPACITY_REACHED/);
  checks++;
  capacity = await lockSfpRecipientCapacity(tx, program, "objective-a", 1, hash("a"));
  check(capacity.replay && capacity.slot === 1 && capacity.role === "primary",
    "replay preserves the primary and consumes no new slot");
  ownerConflict = true;
  await assert.rejects(() => lockSfpRecipientCapacity(tx, program, "objective-a", 1, hash("a")),
    /SFP_STAGING_RECIPIENT_BUSINESS_CONFLICT/);
  checks++;

  const activeKeys = new Set<string>();
  (db as any).transaction = async (action: any) => action({ execute: async (query: any) => {
    const q = compile(query);
    if (q.text.includes("SELECT program_id")) return { rows: [{ program_id: program }] };
    if (q.text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.text.includes("FROM sfp_stage_items i")) {
      check(q.text.includes("r.program_id="), "active validation claim lookup is program-scoped, not cohort-scoped");
      return { rows: q.params.some(p => activeKeys.has(String(p))) ? [{ claimed: true }] : [] };
    }
    if (q.text.includes("INSERT INTO sfp_stage_items")) {
      const metadata = q.params.find(p => typeof p === "string" && p.startsWith('{"sourceKind"'));
      assert.equal(typeof metadata, "string");
      activeKeys.add(JSON.parse(String(metadata)).candidateClaimKey);
      return { rows: [{ id: cohort }] };
    }
    throw new Error(`Unexpected claim query: ${q.text.slice(0, 100)}`);
  } });
  check(await claimValidationCandidate({ stageRunId: cohort, cohortRunId: cohort,
    businessId: 1, candidate: first, policyVersion: 1 }), "first logical address claim succeeds");
  const paid = { ...first, sourceKind: "paid", evidenceId: otherCohort } as UnifiedSfpCandidateView;
  check(!await claimValidationCandidate({ stageRunId: otherCohort, cohortRunId: otherCohort,
    businessId: 1, candidate: paid, policyVersion: 1 }),
  "a different cohort/source cannot concurrently claim the same address and policy");
  (db as any).execute = originalExecute;
  (db as any).transaction = originalTransaction;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE sfp_recipient_eligibility_cert (
      cohort_run_id uuid,business_id integer,policy_version integer,
      normalized_value_hash text,receipt text) ON COMMIT DROP`);
    await client.query(`CREATE UNIQUE INDEX sfp_recipient_eligibility_cert_old
      ON pg_temp.sfp_recipient_eligibility_cert(cohort_run_id,business_id,policy_version)`);
    await client.query(`INSERT INTO pg_temp.sfp_recipient_eligibility_cert
      VALUES ($1,1,1,$2,'retained-proof')`, [cohort, hash("a")]);
    const migration = (await readFile("migrations/0324_sfp_recipient_scoped_eligibility.sql", "utf8"))
      .replaceAll("sfp_outreach_eligibility", "pg_temp.sfp_recipient_eligibility_cert")
      .replace("DROP INDEX IF EXISTS sfp_outreach_run_business_policy_uidx",
        "DROP INDEX IF EXISTS pg_temp.sfp_recipient_eligibility_cert_old");
    await client.query(migration);
    await client.query(`INSERT INTO pg_temp.sfp_recipient_eligibility_cert
      VALUES ($1,1,1,$2,'alternate-one'),($1,1,1,$3,'alternate-two')`, [cohort, hash("b"), hash("c")]);
    check(Number((await client.query("SELECT count(*) FROM pg_temp.sfp_recipient_eligibility_cert")).rows[0].count) === 3,
      "actual PostgreSQL migration permits three separate recipient receipts");
    await client.query(`INSERT INTO pg_temp.sfp_recipient_eligibility_cert VALUES ($1,1,1,$2,'overwrite')
      ON CONFLICT(cohort_run_id,business_id,policy_version,normalized_value_hash) DO NOTHING`, [cohort, hash("a")]);
    check((await client.query("SELECT receipt FROM pg_temp.sfp_recipient_eligibility_cert WHERE normalized_value_hash=$1",
      [hash("a")])).rows[0].receipt === "retained-proof", "a duplicate address cannot overwrite the retained receipt");
    for (let attempt = 0; attempt < 2; attempt++) await client.query(`INSERT INTO pg_temp.sfp_recipient_eligibility_cert
      VALUES ($1,1,1,NULL,'unresolved') ON CONFLICT(cohort_run_id,business_id,policy_version)
      WHERE normalized_value_hash IS NULL DO NOTHING`, [cohort]);
    check(Number((await client.query("SELECT count(*) FROM pg_temp.sfp_recipient_eligibility_cert WHERE normalized_value_hash IS NULL"))
      .rows[0].count) === 1, "non-address placeholders still have one durable business/policy identity");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  console.log(`PASS ${checks} recipient-selection, claim, capacity and migration checks; no provider calls`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  (db as any).execute = originalExecute;
  (db as any).transaction = originalTransaction;
  await pool.end();
});