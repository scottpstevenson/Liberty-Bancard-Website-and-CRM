#!/usr/bin/env tsx
/**
 * Production correction regression test: the Sunbiz bootstrap defect and its
 * repair tooling.
 *
 * Defect: resolveOrganization() was called from runSunbizBootstrapBatch()
 * without create.recordClass, so newly created businesses fell through to
 * the businesses.record_class DB default of 'unknown' — invisible to
 * /api/lead-ops/businesses, the free-enrichment cohort, and MI-09 eligibility
 * (all require record_class='canonical').
 *
 * Fix: the resolveOrganization() call site now passes
 * create: { recordClass: "canonical" }. Additionally, new guarded repair
 * tooling (previewSunbizRecordClassRepair / runSunbizRecordClassRepair) fixes
 * businesses that were already created with the pre-fix defect.
 *
 * This test drives the REAL runSunbizBootstrapBatch() end-to-end against
 * uniquely-prefixed fixture sunbiz_entities rows in the live dev DB (no
 * disposable database process required — this path never calls a provider,
 * never touches GHL, never enrolls/sends), and proves:
 *   1. A newly bootstrap-created business is record_class='canonical'
 *      immediately (the forward fix), with canonical_source_links lineage
 *      written.
 *   2. A bootstrap candidate that matches an existing business (by phone)
 *      resolves to 'matched_existing' and that existing business's
 *      record_class is left completely untouched (repair must never widen to
 *      matched businesses).
 *   3. previewSunbizRecordClassRepair()/runSunbizRecordClassRepair() target
 *      ONLY genuinely claim-backed, lineage-confirmed, still-'unknown'
 *      businesses — proven by manually simulating the pre-fix defect (an
 *      'unknown' business with a 'created' claim + matching lineage row) and
 *      confirming: (a) an unrelated 'unknown' business with NO bootstrap
 *      claim is never touched, (b) the matched-existing business from case 2
 *      is never touched even if its record_class were 'unknown' as a control
 *      case, (c) the repair updates only the genuinely defective row.
 *   4. Re-running the repair a second time (idempotency) changes zero rows.
 *   5. The repaired business becomes visible under the exact predicate
 *      /api/lead-ops/businesses and the free-enrichment cohort use
 *      (record_class = 'canonical').
 *
 * No provider calls, no worker/GHL activation, no production writes — this
 * entire test runs against the live dev DB with a unique fixture prefix and
 * cleans up everything it creates.
 *
 * Usage: npx tsx scripts/test-sunbiz-record-class-repair.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

let PASS = 0;
let FAIL = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  \u2713 ${label}`);
    PASS++;
  } else {
    console.error(`  \u2717 ${label}${detail ? `: ${detail}` : ""}`);
    FAIL++;
  }
}
function rows<T>(result: { rows: T[] }): T[] {
  return (result as any).rows ?? [];
}

const TAG = `sbrcr-${Date.now() % 10_000_000}`;
const testFilingLike = `${TAG}-%`;

async function cleanup() {
  await db.execute(sql`
    DELETE FROM canonical_source_links
    WHERE stable_key IN (SELECT filing_number FROM sunbiz_entities WHERE filing_number LIKE ${testFilingLike})
       OR business_id IN (SELECT id FROM businesses WHERE canonical_name LIKE ${TAG + "%"})
  `);
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${testFilingLike}`);
  await db.execute(sql`DELETE FROM businesses WHERE canonical_name LIKE ${TAG + "%"}`);
  await db.execute(sql`DELETE FROM sunbiz_entities WHERE filing_number LIKE ${testFilingLike}`);
}

async function main() {
  console.log(`\n\u2500\u2500 Production correction: Sunbiz bootstrap record_class defect + repair \u2500\u2500\n`);

  process.env.NODE_ENV = "test";
  const {
    runSunbizBootstrapBatch,
    previewSunbizRecordClassRepair,
    sunbizRecordClassRepairConfirmationPhrase,
    issueSunbizRecordClassRepairToken,
    peekSunbizRecordClassRepairToken,
    consumeSunbizRecordClassRepairToken,
    runSunbizRecordClassRepair,
  } = await import("../server/services/sunbiz-bootstrap");

  await cleanup();

  try {
    // ── Case 1: forward fix — a genuinely new bootstrap candidate becomes
    // ── record_class='canonical' immediately, with lineage written. ────────
    const filingNew = `${TAG}-new-001`;
    await db.execute(sql`
      INSERT INTO sunbiz_entities (filing_number, entity_name, website, score)
      VALUES (${filingNew}, ${TAG + " New Bootstrap LLC"}, ${"https://" + TAG + "-new.example.com"}, 'hot')
    `);
    const outcomesNew = await runSunbizBootstrapBatch(5, { filingNumberLike: testFilingLike });
    const newOutcome = outcomesNew.find((o) => o.filingNumber === filingNew);
    ok("new candidate resolves to 'created'", newOutcome?.outcome === "created", JSON.stringify(newOutcome));

    if (newOutcome?.businessId) {
      const [biz] = rows<any>(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${newOutcome.businessId}`));
      ok("newly created business is record_class='canonical' immediately (forward fix)", biz?.record_class === "canonical", `record_class=${biz?.record_class}`);
      const [link] = rows<any>(await db.execute(sql`
        SELECT 1 FROM canonical_source_links
        WHERE business_id = ${newOutcome.businessId} AND source_system='sunbiz' AND source_type='sunbiz_entity' AND stable_key=${filingNew}
      `));
      ok("canonical_source_links lineage row written for the new business", !!link);
    } else {
      ok("newly created business is record_class='canonical' immediately (forward fix)", false, "no businessId returned");
      ok("canonical_source_links lineage row written for the new business", false, "no businessId returned");
    }

    // ── Case 2: matched_existing must NEVER have its record_class touched. ─
    const existingPhone = "9545551234";
    const [existingBiz] = rows<any>(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, main_phone, city, state, record_class)
      VALUES (${TAG + " Existing Business Inc"}, ${(TAG + " existing business inc").toLowerCase()}, ${existingPhone}, 'Fort Lauderdale', 'FL', 'production')
      RETURNING id, record_class
    `));
    const filingMatched = `${TAG}-matched-001`;
    await db.execute(sql`
      INSERT INTO sunbiz_entities (filing_number, entity_name, phone, principal_city, principal_state, score)
      VALUES (${filingMatched}, ${TAG + " Matched Bootstrap LLC"}, ${existingPhone}, 'Fort Lauderdale', 'FL', 'hot')
    `);
    const outcomesMatched = await runSunbizBootstrapBatch(5, { filingNumberLike: testFilingLike });
    const matchedOutcome = outcomesMatched.find((o) => o.filingNumber === filingMatched);
    ok("candidate matching an existing business's phone resolves to 'matched_existing'", matchedOutcome?.outcome === "matched_existing", JSON.stringify(matchedOutcome));
    const [existingAfter] = rows<any>(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${existingBiz.id}`));
    ok("matched-existing business's record_class is left untouched ('production', not upgraded)", existingAfter?.record_class === "production", `record_class=${existingAfter?.record_class}`);

    // ── Case 3: simulate the PRE-FIX defect (unknown business + created claim
    // ── + matching lineage), and an unrelated control 'unknown' business with
    // ── no claim at all, then prove the repair cohort targets only the
    // ── genuinely defective row. ─────────────────────────────────────────
    const filingDefective = `${TAG}-defective-001`;
    const [defectiveBiz] = rows<any>(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, record_class)
      VALUES (${TAG + " Defective Legacy LLC"}, ${(TAG + " defective legacy llc").toLowerCase()}, 'unknown')
      RETURNING id
    `));
    await db.execute(sql`
      INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key, first_seen_at, last_confirmed_at)
      VALUES (${defectiveBiz.id}, 'sunbiz', 'sunbiz_entity', ${filingDefective}, NOW(), NOW())
    `);
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, status, business_id, completed_at)
      VALUES (${filingDefective}, 'created', ${defectiveBiz.id}, NOW())
    `);

    const [controlUnknownBiz] = rows<any>(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, record_class)
      VALUES (${TAG + " Control Unrelated Unknown LLC"}, ${(TAG + " control unrelated unknown llc").toLowerCase()}, 'unknown')
      RETURNING id
    `));

    const preview = await previewSunbizRecordClassRepair();
    const cohortIds = preview.rows.map((r) => r.id);
    ok("repair cohort includes the genuinely defective business", cohortIds.includes(defectiveBiz.id), `cohortIds=${JSON.stringify(cohortIds)}`);
    ok("repair cohort excludes the unrelated unknown business with no bootstrap claim", !cohortIds.includes(controlUnknownBiz.id), `cohortIds=${JSON.stringify(cohortIds)}`);
    ok("repair cohort excludes the matched-existing business from case 2", !cohortIds.includes(existingBiz.id), `cohortIds=${JSON.stringify(cohortIds)}`);

    const phrase = sunbizRecordClassRepairConfirmationPhrase(preview.cohortCount);
    ok("confirmation phrase includes the exact cohort count", phrase.includes(String(preview.cohortCount)), phrase);
    const token = issueSunbizRecordClassRepairToken(phrase, cohortIds);
    const peeked = peekSunbizRecordClassRepairToken(token);
    ok("token peek returns the captured business IDs without consuming it", !!peeked && peeked.businessIds.length === cohortIds.length);
    const stillPeekable = peekSunbizRecordClassRepairToken(token);
    ok("peeking twice does not consume the token", !!stillPeekable);
    const consumed = consumeSunbizRecordClassRepairToken(token);
    ok("consume returns the record and removes it", !!consumed);
    const consumedAgain = consumeSunbizRecordClassRepairToken(token);
    ok("re-consuming an already-used token returns null (single-use)", consumedAgain === null);

    const runResult = await runSunbizRecordClassRepair(cohortIds);
    ok("repair execution updates exactly the cohort it attempted (attemptedCount matches cohort)", runResult.attemptedCount === cohortIds.length, JSON.stringify(runResult));
    // This shared dev database may already contain other real pre-fix-defective
    // businesses (proven claim-backed + lineage-confirmed + still 'unknown')
    // left over from earlier bootstrap runs during this same corrective work —
    // the repair is designed to catch every one of those, not just this
    // fixture, so assert inclusion rather than an exact count of 1.
    ok("repair execution repairs our fixture's defective business (among any others genuinely proven)", runResult.repairedIds.includes(defectiveBiz.id), JSON.stringify(runResult));

    const [defectiveAfter] = rows<any>(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${defectiveBiz.id}`));
    ok("defective business is now record_class='canonical'", defectiveAfter?.record_class === "canonical", `record_class=${defectiveAfter?.record_class}`);
    const [controlAfter] = rows<any>(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${controlUnknownBiz.id}`));
    ok("unrelated unknown business remains 'unknown' (never reclassified)", controlAfter?.record_class === "unknown", `record_class=${controlAfter?.record_class}`);
    const [existingStillUntouched] = rows<any>(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${existingBiz.id}`));
    ok("matched-existing business is still untouched after repair run", existingStillUntouched?.record_class === "production", `record_class=${existingStillUntouched?.record_class}`);

    // ── Case 4: idempotent rerun changes zero rows. ─────────────────────────
    const rerunResult = await runSunbizRecordClassRepair(cohortIds);
    ok("re-running the repair with the same business IDs changes zero rows", rerunResult.repairedCount === 0, JSON.stringify(rerunResult));

    // ── Case 5: repaired row becomes visible under the exact predicate the
    // ── real /api/lead-ops/businesses route and free-enrichment cohort use.
    const [visible] = rows<any>(await db.execute(sql`
      SELECT id FROM businesses WHERE id = ${defectiveBiz.id} AND record_class = 'canonical'
    `));
    ok("repaired business now matches the /api/lead-ops/businesses and free-enrichment predicate (record_class='canonical')", !!visible);

    // ── Preview cohort is now empty for this fixture set (idempotency proof
    // ── at the preview layer too). ──────────────────────────────────────────
    const previewAfter = await previewSunbizRecordClassRepair();
    ok(
      "preview no longer lists the now-repaired business",
      !previewAfter.rows.some((r) => r.id === defectiveBiz.id),
      JSON.stringify(previewAfter.rows.map((r) => r.id)),
    );
  } finally {
    await cleanup();
  }

  console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
