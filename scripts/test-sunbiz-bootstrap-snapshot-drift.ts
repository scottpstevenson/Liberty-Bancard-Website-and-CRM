#!/usr/bin/env tsx
/**
 * Proves the preview-token candidate-snapshot binding added in response to
 * this round's review finding: the token must bind execution to the exact
 * candidate set the admin previewed, not just a count. A claim landing on
 * one of the previewed entities between preview and run (another admin's
 * batch, or this module's own stale-claim recovery) must make
 * runSunbizBootstrapBatch() REJECT the whole batch (SunbizBootstrapSnapshotDriftError)
 * before claiming or writing anything — never silently execute a different
 * set than what was reviewed.
 *
 * Run with: npx tsx scripts/test-sunbiz-bootstrap-snapshot-drift.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  previewSunbizBootstrap,
  runSunbizBootstrapBatch,
  SunbizBootstrapSnapshotDriftError,
} from "../server/services/sunbiz-bootstrap";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const RUN_ID = Date.now() % 10_000_000;
const FILING_PREFIX = `task1971-drift-${RUN_ID}-`;
const seededEntityIds: number[] = [];

async function seedEntity(idx: number) {
  const filingNumber = `${FILING_PREFIX}${idx}`;
  const rows = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, enrichment_status, website, source)
    VALUES (${filingNumber}, ${`Task1971 Drift Test Co ${RUN_ID}-${idx}`}, 'hot', 'enriched', ${`https://drift-test-${RUN_ID}-${idx}.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  const id = Number(rows[0].id);
  seededEntityIds.push(id);
  return { id, filingNumber };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE source_system = 'sunbiz' AND stable_key LIKE ${FILING_PREFIX + "%"}`);
  const claimedBusinessIds = (await db.execute(sql`
    SELECT business_id FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"} AND business_id IS NOT NULL
  `)).rows as any[];
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"}`);
  for (const row of claimedBusinessIds) {
    await db.execute(sql`DELETE FROM businesses WHERE id = ${Number(row.business_id)}`);
  }
  if (seededEntityIds.length > 0) {
    await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${seededEntityIds.join(",")}]::int[]`)})`);
  }
}

async function main() {
  console.log(`[test-sunbiz-bootstrap-snapshot-drift] run id ${RUN_ID}`);

  await seedEntity(1);
  await seedEntity(2);
  const filingNumberLike = `${FILING_PREFIX}%`;

  try {
    // 1. Preview, exactly like the /preview route does — this is the
    //    snapshot a previewToken would bind execution to.
    const preview = await previewSunbizBootstrap(50, { filingNumberLike });
    const previewedFilingNumbers = preview.candidates.map((c) => c.filingNumber);
    assert("preview sees both fixture candidates", previewedFilingNumbers.length === 2, `saw ${previewedFilingNumbers.length}`);

    // 2. Simulate drift: something else claims one of the previewed entities
    //    between preview and run (a competing admin batch or this module's
    //    own stale-claim recovery), exactly the scenario the fix addresses.
    //    A live 'claimed' row (not yet resolved) makes selectSunbizBootstrapCandidates
    //    exclude that entity on the next selection.
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
      VALUES (${previewedFilingNumbers[0]}, ${seededEntityIds[0]}, 'claimed')
    `);

    // 3. Running with the ORIGINAL (now-stale) snapshot must reject the
    //    whole batch outright — not run against the 1 remaining candidate,
    //    not skip just the claimed one and proceed with the rest.
    let driftError: unknown = null;
    try {
      await runSunbizBootstrapBatch(50, { filingNumberLike }, previewedFilingNumbers);
    } catch (err) {
      driftError = err;
    }
    assert("stale snapshot is rejected with SunbizBootstrapSnapshotDriftError", driftError instanceof SunbizBootstrapSnapshotDriftError, String(driftError));

    // 4. Prove it rejected BEFORE doing any claim/write work on the entity
    //    that was still eligible: the only claim row for our fixtures is the
    //    one WE inserted in step 2, still un-resolved (no business_id, no
    //    'created'/'matched_existing' status) — the drifted run must not
    //    have touched the second (still-eligible) entity at all.
    const claimRows = (await db.execute(sql`
      SELECT filing_number, status, business_id FROM sunbiz_bootstrap_claims
      WHERE filing_number LIKE ${filingNumberLike}
    `)).rows as any[];
    assert("only the pre-existing simulated claim exists — the still-eligible entity was never touched",
      claimRows.length === 1 && claimRows[0].filing_number === previewedFilingNumbers[0] && claimRows[0].status === "claimed" && claimRows[0].business_id === null,
      JSON.stringify(claimRows));
    const businessCount = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM canonical_source_links WHERE source_system = 'sunbiz' AND stable_key LIKE ${filingNumberLike}
    `)).rows[0] as any;
    assert("zero businesses were created by the rejected drifted run", Number(businessCount.n) === 0, String(businessCount.n));

    // 5. A caller that re-previews (fresh snapshot reflecting the claim) and
    //    runs against THAT snapshot must succeed normally — the fix rejects
    //    stale snapshots, not all execution.
    const freshPreview = await previewSunbizBootstrap(50, { filingNumberLike });
    const freshFilingNumbers = freshPreview.candidates.map((c) => c.filingNumber);
    assert("fresh re-preview after drift sees only the still-eligible entity", freshFilingNumbers.length === 1 && freshFilingNumbers[0] === previewedFilingNumbers[1], JSON.stringify(freshFilingNumbers));

    const freshOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike }, freshFilingNumbers);
    const created = freshOutcomes.filter((o) => o.outcome === "created");
    assert("running against a FRESH (matching) snapshot succeeds normally", created.length === 1, JSON.stringify(freshOutcomes));

    // 6. Sanity: no expectedFilingNumbers passed at all (legacy/back-compat
    //    call shape) must skip the drift check entirely rather than throw.
    await seedEntity(3);
    const noSnapshotOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}3` });
    assert("omitting expectedFilingNumbers skips the drift check (back-compat)", noSnapshotOutcomes.some((o) => o.outcome === "created"), JSON.stringify(noSnapshotOutcomes));
  } finally {
    await cleanup();
  }

  console.log(`\n[test-sunbiz-bootstrap-snapshot-drift] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
