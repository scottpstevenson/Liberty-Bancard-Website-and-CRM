/**
 * Task #1999 (C3 / proof matrix "cross-source email-hash dedupe"): proves
 * getUnifiedSfpCandidates() collapses a value observed by both a free and a
 * paid source onto one canonical evidenceId while preserving both rows'
 * independent source/provenance, and never exposes the raw comparison hash.
 */
import { Pool } from "pg";
import assert from "node:assert";
import { writeSfpPaidCandidateEvidence, getUnifiedSfpCandidates } from "../server/services/cro03/sfp-paid-evidence-writer";
import { seal } from "../server/services/cro03/candidate-evidence-service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let assertionCount = 0;
function check(cond: boolean, msg: string) {
  assertionCount++;
  assert.ok(cond, msg);
  console.log(`✓ ${msg}`);
}

async function main() {
  const nonce = Date.now();
  const bizRes = await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, postal_code, city, state, record_class)
     VALUES ($1,$1,'dental','33101','Miami','FL','canonical') RETURNING id`,
    [`dedupe-test-biz-${nonce}`],
  );
  const businessId = Number(bizRes.rows[0].id);
  const sharedEmail = `owner-${nonce}@dedupe-test.example`;
  const { ciphertext, nonce: envNonce, tag, normalizedValueHash, maskedValue } = seal("email", sharedEmail);

  // Free-lane observation of the same value.
  const genRes = await pool.query(
    `INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
     VALUES ($1,'test-actor','email_discovery','dedupe-test-fixture','completed') RETURNING id`,
    [`dedupe-test-run-${nonce}`],
  );
  const generationId = String(genRes.rows[0].id);
  await pool.query(
    `INSERT INTO free_discovery_candidates
       (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
        disposition, confidence, envelope_ciphertext, envelope_nonce,
        envelope_tag, envelope_key_version, normalized_value_hash, masked_value)
     VALUES ($1,$2,'email','business','dedupe-test.example','first_party_crawl','role','staged',60,$3,$4,$5,1,$6,$7)`,
    [generationId, businessId, ciphertext, envNonce, tag, normalizedValueHash, maskedValue],
  );

  // Paid-lane observation of the SAME value from Outscraper.
  const paidWrite = await writeSfpPaidCandidateEvidence({
    businessId, provider: "outscraper", field: "email", value: sharedEmail, subjectType: "business", confidence: 90,
  });
  check(paidWrite.wasNew, "paid evidence write succeeds for the shared value");

  const unified = await getUnifiedSfpCandidates([businessId]);
  const emailRows = unified.filter((r) => r.businessId === businessId && r.field === "email");
  check(emailRows.length === 2, "both the free and paid observations of the shared value are present as distinct rows");
  const free = emailRows.find((r) => r.sourceKind === "free");
  const paid = emailRows.find((r) => r.sourceKind === "paid");
  check(Boolean(free && paid), "one row is free-sourced and one is paid-sourced");
  check(paid!.duplicateOfEvidenceId === null, "higher-confidence paid row (ranked first) is canonical, not marked a duplicate");
  check(free!.duplicateOfEvidenceId === paid!.evidenceId, "lower-ranked free row is marked as a duplicate of the paid canonical row");
  check(free!.evidenceId !== paid!.evidenceId, "each row keeps its own distinct evidenceId (no lineage merge)");
  check((unified[0] as any)._hashKey === undefined, "the internal comparison hash is never exposed on the returned view");

  // A distinct, non-shared value for the same business/field must remain independent.
  await writeSfpPaidCandidateEvidence({
    businessId, provider: "apollo", field: "email", value: `distinct-${nonce}@dedupe-test.example`, subjectType: "person", confidence: 80,
  });
  const unified2 = await getUnifiedSfpCandidates([businessId]);
  const distinctRow = unified2.find((r) => r.provider === "apollo");
  check(Boolean(distinctRow) && distinctRow!.duplicateOfEvidenceId === null, "a genuinely distinct value is never marked as a duplicate");

  await pool.query(`DELETE FROM sfp_paid_candidate_evidence WHERE business_id=$1`, [businessId]);
  await pool.query(`DELETE FROM free_discovery_candidates WHERE business_id=$1`, [businessId]);
  await pool.query(`DELETE FROM free_discovery_generations WHERE id=$1`, [generationId]);
  await pool.query(`DELETE FROM businesses WHERE id=$1`, [businessId]);
  await pool.end();
  console.log(`\nSFP unified-candidate dedupe: ${assertionCount} assertions passed.`);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
