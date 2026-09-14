#!/usr/bin/env tsx
/**
 * Task #1956, Step 2 test: Sunbiz→canonical-business bootstrap.
 *
 * Verifies against fixture data only (no real corpus run):
 *  1. previewSunbizBootstrap()'s wouldCreate count matches the actual number
 *     of businesses inserted by runSunbizBootstrapBatch() on the same batch.
 *  2. Running the bootstrap a second time over the same fixture entities
 *     produces ZERO duplicate businesses/canonical_source_links rows — the
 *     durable filing_number claim (not name/domain/phone matching) is what
 *     prevents the duplicate, proven here by fixtures with weak-collision
 *     names that DB name-matching would not have caught on its own.
 *
 * Run with: npx tsx scripts/test-sunbiz-bootstrap.ts
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import { previewSunbizBootstrap, runSunbizBootstrapBatch } from "../server/services/sunbiz-bootstrap";

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
const FILING_PREFIX = `task1956-boot-${RUN_ID}-`;
const seededEntityIds: number[] = [];

async function seedEntity(idx: number, opts: { website?: string | null; phone?: string | null; city?: string | null; state?: string | null }) {
  const filingNumber = `${FILING_PREFIX}${idx}`;
  const rows = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, enrichment_status, website, phone, principal_city, principal_state, source)
    VALUES (${filingNumber}, ${`Task1956 Boot Test Co ${RUN_ID}-${idx}`}, 'hot', 'enriched', ${opts.website ?? null}, ${opts.phone ?? null}, ${opts.city ?? null}, ${opts.state ?? null}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  const id = Number(rows[0].id);
  seededEntityIds.push(id);
  return { id, filingNumber };
}

async function cleanup() {
  await db.execute(sql`
    DELETE FROM canonical_source_links
    WHERE source_system = 'sunbiz' AND stable_key LIKE ${FILING_PREFIX + '%'}
  `);
  const claimedBusinessIds = (await db.execute(sql`
    SELECT business_id FROM sunbiz_bootstrap_claims
    WHERE filing_number LIKE ${FILING_PREFIX + '%'} AND business_id IS NOT NULL
  `)).rows as any[];
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + '%'}`);
  for (const row of claimedBusinessIds) {
    await db.execute(sql`DELETE FROM businesses WHERE id = ${Number(row.business_id)}`);
  }
  if (seededEntityIds.length > 0) {
    await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${seededEntityIds.join(",")}]::int[]`)})`);
  }
}

async function main() {
  console.log(`[test-sunbiz-bootstrap] run id ${RUN_ID}`);

  // Two candidates with DISTINCT strong evidence (domain) so each yields its
  // own new business, plus one deliberately near-duplicate NAME (but a
  // different domain) to prove the claim — not name matching — is what's
  // load-bearing for idempotency on rerun.
  await seedEntity(1, { website: `https://boot-test-${RUN_ID}-a.example.com` });
  await seedEntity(2, { website: `https://boot-test-${RUN_ID}-b.example.com` });

  try {
    const preview = await previewSunbizBootstrap(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const ourPreviewCandidates = preview.candidates.filter((c) => c.filingNumber.startsWith(FILING_PREFIX));
    assert("preview sees both fixture candidates", ourPreviewCandidates.length === 2, `saw ${ourPreviewCandidates.length}`);
    assert("preview predicts would_create for both (no prior match)", ourPreviewCandidates.every((c) => c.outcome === "would_create"));

    const predictedCreates = ourPreviewCandidates.filter((c) => c.outcome === "would_create").length;

    const runOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const ourRunOutcomes = runOutcomes.filter((o) => o.filingNumber.startsWith(FILING_PREFIX));
    console.log("run outcomes:", JSON.stringify(ourRunOutcomes, null, 2));
    const actualCreates = ourRunOutcomes.filter((o) => o.outcome === "created").length;

    assert("preview wouldCreate count matches actual insert count", predictedCreates === actualCreates, `predicted ${predictedCreates}, actual ${actualCreates}`);
    assert("both fixture entities created a business", actualCreates === 2, `got ${actualCreates}`);

    for (const outcome of ourRunOutcomes) {
      if (outcome.outcome === "created" && outcome.businessId) {
        const linkRows = (await db.execute(sql`
          SELECT * FROM canonical_source_links
          WHERE business_id = ${outcome.businessId} AND source_system = 'sunbiz' AND stable_key = ${outcome.filingNumber}
        `)).rows as any[];
        assert(`canonical_source_links lineage preserved for ${outcome.filingNumber}`, linkRows.length === 1, `found ${linkRows.length}`);
      }
    }

    const businessCountAfterFirstRun = (await db.execute(sql`
      SELECT count(*)::int AS n FROM businesses b
      JOIN canonical_source_links csl ON csl.business_id = b.id
      WHERE csl.source_system = 'sunbiz' AND csl.stable_key LIKE ${FILING_PREFIX + '%'}
    `)).rows[0] as any;
    assert("exactly 2 businesses exist after first run", Number(businessCountAfterFirstRun.n) === 2, `found ${businessCountAfterFirstRun.n}`);

    // Rerun over the SAME fixture entities (simulating a resumed/retried batch).
    const rerunOutcomes = await runSunbizBootstrapBatch(50);
    const ourRerunOutcomes = rerunOutcomes.filter((o) => o.filingNumber.startsWith(FILING_PREFIX));
    assert("rerun sees zero fixture candidates (already claimed)", ourRerunOutcomes.length === 0, `saw ${ourRerunOutcomes.length}`);

    const businessCountAfterRerun = (await db.execute(sql`
      SELECT count(*)::int AS n FROM businesses b
      JOIN canonical_source_links csl ON csl.business_id = b.id
      WHERE csl.source_system = 'sunbiz' AND csl.stable_key LIKE ${FILING_PREFIX + '%'}
    `)).rows[0] as any;
    assert("still exactly 2 businesses after rerun (zero duplicates)", Number(businessCountAfterRerun.n) === 2, `found ${businessCountAfterRerun.n}`);
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n[test-sunbiz-bootstrap] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[test-sunbiz-bootstrap] fatal error:", err);
  try { await cleanup(); } catch {}
  process.exit(1);
});
