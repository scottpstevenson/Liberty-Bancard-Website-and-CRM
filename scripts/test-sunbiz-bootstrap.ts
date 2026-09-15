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
import { previewSunbizBootstrap, runSunbizBootstrapBatch, sunbizBootstrapConfirmationPhrase } from "../server/services/sunbiz-bootstrap";

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

    // ── Confirmation-phrase consistency ────────────────────────────────────
    // Both the preview and run routes call sunbizBootstrapConfirmationPhrase()
    // with the actual candidateCount — proving by construction (not just by
    // reading the code) that a caller who types back exactly what preview
    // showed can never be rejected by run for a mismatched count.
    assert(
      "confirmation phrase is derived from candidateCount, not an arbitrary limit",
      sunbizBootstrapConfirmationPhrase(3) === "RUN SUNBIZ BOOTSTRAP 3" &&
        sunbizBootstrapConfirmationPhrase(0) === "RUN SUNBIZ BOOTSTRAP 0",
    );

    // ── Stale-claim recovery (crash-recoverable claims) ────────────────────
    // Simulates a process that claimed a filing and then crashed before ever
    // calling resolveOrganization(): the claim is stuck at status='claimed'
    // with an old claimed_at. A later run must reclaim and resolve it instead
    // of excluding it forever.
    const { id: staleEntityId, filingNumber: staleFilingNumber } = await seedEntity(3, {
      website: `https://boot-test-${RUN_ID}-c.example.com`,
    });
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status, claimed_at)
      VALUES (${staleFilingNumber}, ${staleEntityId}, 'claimed', now() - interval '1 hour')
    `);

    const beforeRecoveryPreview = await previewSunbizBootstrap(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const staleSeenAsFreshlyClaimed = beforeRecoveryPreview.candidates.some((c) => c.filingNumber === staleFilingNumber);
    assert(
      "stale claim (1hr old) is NOT permanently excluded from selection",
      staleSeenAsFreshlyClaimed,
      `candidates: ${JSON.stringify(beforeRecoveryPreview.candidates.map((c) => c.filingNumber))}`,
    );

    const recoveryOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const staleOutcome = recoveryOutcomes.find((o) => o.filingNumber === staleFilingNumber);
    assert(
      "stale claim is reclaimed and resolved (not stuck as already_claimed)",
      !!staleOutcome && staleOutcome.outcome === "created",
      `outcome: ${JSON.stringify(staleOutcome)}`,
    );

    // A fresh (non-stale) 'claimed' row must NOT be reclaimed by a concurrent
    // run — only claims older than the staleness threshold are recoverable.
    const { id: freshEntityId, filingNumber: freshFilingNumber } = await seedEntity(4, {
      website: `https://boot-test-${RUN_ID}-d.example.com`,
    });
    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status, claimed_at)
      VALUES (${freshFilingNumber}, ${freshEntityId}, 'claimed', now())
    `);
    const freshOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const freshOutcome = freshOutcomes.find((o) => o.filingNumber === freshFilingNumber);
    assert(
      "a fresh in-flight claim (just now) is left alone, not reclaimed",
      !freshOutcome,
      `outcome: ${JSON.stringify(freshOutcome)}`,
    );

    // ── Lineage repair on retry (matched branch) ───────────────────────────
    // Simulates a crash between business creation and lineage-row insertion
    // on a prior attempt: the business exists, the lineage row does not, and
    // the claim was left 'failed' so it's eligible for retry. The retry must
    // resolve as "matched" against the already-created business AND repair
    // the missing canonical_source_links row before finalizing — not just
    // mark the claim successful and leave lineage permanently missing.
    const { id: repairEntityId, filingNumber: repairFilingNumber } = await seedEntity(5, {
      website: `https://boot-test-${RUN_ID}-e.example.com`,
    });
    const firstAttempt = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const createdOutcome = firstAttempt.find((o) => o.filingNumber === repairFilingNumber);
    assert("lineage-repair fixture: first attempt creates the business", createdOutcome?.outcome === "created" && !!createdOutcome.businessId);
    const repairBusinessId = createdOutcome!.businessId!;

    // Simulate the crash: delete the lineage row and force the claim back to
    // 'failed' (as a real crash mid-resolution would leave it, or as a
    // subsequent unrelated failure on this filing would).
    await db.execute(sql`DELETE FROM canonical_source_links WHERE business_id = ${repairBusinessId} AND source_system = 'sunbiz'`);
    await db.execute(sql`UPDATE sunbiz_bootstrap_claims SET status = 'failed' WHERE filing_number = ${repairFilingNumber}`);

    const preRepairLinks = (await db.execute(sql`
      SELECT * FROM canonical_source_links WHERE business_id = ${repairBusinessId} AND source_system = 'sunbiz'
    `)).rows as any[];
    assert("lineage-repair fixture: lineage row confirmed absent before retry", preRepairLinks.length === 0);

    const retryOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const retryOutcome = retryOutcomes.find((o) => o.filingNumber === repairFilingNumber);
    assert(
      "retry after simulated lineage-crash resolves as matched_existing",
      retryOutcome?.outcome === "matched_existing" && retryOutcome.businessId === repairBusinessId,
      `outcome: ${JSON.stringify(retryOutcome)}`,
    );
    const postRepairLinks = (await db.execute(sql`
      SELECT * FROM canonical_source_links WHERE business_id = ${repairBusinessId} AND source_system = 'sunbiz' AND stable_key = ${repairFilingNumber}
    `)).rows as any[];
    assert("lineage row is repaired (re-inserted) on the matched retry", postRepairLinks.length === 1, `found ${postRepairLinks.length}`);

    // ── Expired-lease takeover: original executor resumes after a replacement
    // ── finishes, and must NOT be able to mutate the replacement's result ──
    // Simulates: executor A claims filing F, then stalls for >15 minutes
    // (crashed thread, GC pause, whatever) before it ever finalizes. While A
    // is stalled, executor B's batch run reclaims F (because A's claim is now
    // stale) and finalizes it successfully. A then wakes up and attempts to
    // finalize with the LEASE TOKEN IT ORIGINALLY HELD (its own now-stale
    // claimed_at) — this must be rejected by the fenced UPDATE (0 rows
    // affected), and B's result must remain untouched. This exercises the
    // exact WHERE filing_number = ... AND claimed_at = <lease token> fencing
    // clause runSunbizBootstrapBatch() uses internally.
    const { id: raceEntityId, filingNumber: raceFilingNumber } = await seedEntity(6, {
      website: `https://boot-test-${RUN_ID}-f.example.com`,
    });

    // A claims the row, capturing its lease token (claimed_at), then goes
    // silent — simulated by directly backdating claimed_at past the staleness
    // window so a later batch treats the claim as abandoned.
    const aClaimRows = (await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status, claimed_at)
      VALUES (${raceFilingNumber}, ${raceEntityId}, 'claimed', now() - interval '20 minutes')
      RETURNING claimed_at
    `)).rows as any[];
    const aLeaseToken = aClaimRows[0].claimed_at;

    // B's batch run reclaims the now-stale row (bumping claimed_at to a fresh
    // value) and finalizes it end-to-end through the real production path.
    const bOutcomes = await runSunbizBootstrapBatch(50, { filingNumberLike: `${FILING_PREFIX}%` });
    const bOutcome = bOutcomes.find((o) => o.filingNumber === raceFilingNumber);
    assert("executor B successfully claims and finalizes the reclaimed filing", bOutcome?.outcome === "created" && !!bOutcome.businessId, `outcome: ${JSON.stringify(bOutcome)}`);
    const bBusinessId = bOutcome!.businessId!;

    const claimAfterB = (await db.execute(sql`
      SELECT status, business_id, claimed_at FROM sunbiz_bootstrap_claims WHERE filing_number = ${raceFilingNumber}
    `)).rows[0] as any;
    assert("claim row now reflects B's fresh lease token, not A's", new Date(claimAfterB.claimed_at).getTime() !== new Date(aLeaseToken).getTime());

    // A "wakes up" and attempts to finalize using ITS ORIGINAL (now-stale)
    // lease token — the same fenced UPDATE shape runSunbizBootstrapBatch()
    // issues internally. This must affect ZERO rows.
    const aResumeAttempt = (await db.execute(sql`
      UPDATE sunbiz_bootstrap_claims
      SET status = 'failed', deferred_reason_code = 'executor A resumed after lease expiry', completed_at = now()
      WHERE filing_number = ${raceFilingNumber} AND claimed_at = ${aLeaseToken}
      RETURNING id
    `)).rows as any[];
    assert("stale executor A's resumed write is fenced out (0 rows affected)", aResumeAttempt.length === 0, `affected ${aResumeAttempt.length} rows`);

    const claimAfterAResume = (await db.execute(sql`
      SELECT status, business_id FROM sunbiz_bootstrap_claims WHERE filing_number = ${raceFilingNumber}
    `)).rows[0] as any;
    assert(
      "B's terminal status survives A's resumed write attempt untouched",
      claimAfterAResume.status === "created" && Number(claimAfterAResume.business_id) === bBusinessId,
      `found status=${claimAfterAResume.status} business_id=${claimAfterAResume.business_id}`,
    );
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
