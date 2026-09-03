/**
 * canary-serper-lookup.ts — Shadow canary for Serper structured lookup (#1768)
 *
 * NOT a CI script. Operator-only, requires explicit flags and authority.
 *
 * Modes:
 *   --plan             Freeze 500 cohort entities, print estimated credit use, zero API calls.
 *   --execute          Run only the frozen cohort in shadow mode (real Serper spend,
 *                      zero production-field mutations). Requires:
 *                        --cohort-id <uuid>
 *                        --confirm-paid-serper
 *
 * Kill switches (fail-closed, any false → abort):
 *   1. SERPER_API_KEY must be set
 *   2. SerperGateway must be enabled + circuit closed
 *   3. Gateway must have sufficient budget (local_budget - window_calls ≥ hard cap)
 *   4. Provider manifest must have "serper" with explicit_operator_enablement
 *   5. --confirm-paid-serper flag must be present (explicit paid-call confirmation)
 *   6. Shadow mode enforced: no writes to sdr_merchants or CRO-03 tables
 *   7. Hard request cap (CANARY_HARD_REQUEST_CAP = 1500, ~3 per entity × 500)
 *
 * Run:
 *   npx tsx scripts/canary-serper-lookup.ts --plan
 *   npx tsx scripts/canary-serper-lookup.ts --execute --cohort-id <uuid> --confirm-paid-serper
 */

import { randomUUID, createHash } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

const CANARY_COHORT_SIZE = 500;
const CANARY_HARD_REQUEST_CAP = 1500; // 3 requests per entity max
const STRATEGY_VERSION = 1;

// ── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const MODE_PLAN = args.includes("--plan");
const MODE_EXECUTE = args.includes("--execute");
const COHORT_ID_IDX = args.indexOf("--cohort-id");
const COHORT_ID = COHORT_ID_IDX >= 0 ? args[COHORT_ID_IDX + 1] : null;
const CONFIRM_PAID = args.includes("--confirm-paid-serper");

if (!MODE_PLAN && !MODE_EXECUTE) {
  console.error("Usage: npx tsx scripts/canary-serper-lookup.ts --plan");
  console.error("       npx tsx scripts/canary-serper-lookup.ts --execute --cohort-id <uuid> --confirm-paid-serper");
  process.exit(1);
}

if (MODE_EXECUTE && !COHORT_ID) {
  console.error("--execute requires --cohort-id <uuid>");
  process.exit(1);
}

if (MODE_EXECUTE && !CONFIRM_PAID) {
  console.error("--execute requires --confirm-paid-serper (explicit operator acknowledgement of real Serper credit spend)");
  process.exit(1);
}

// ── Database + gateway imports (fail-closed if unavailable) ──────────────────

async function main() {
  console.log(`\n═══ Serper Canary Lookup — ${MODE_PLAN ? "PLAN MODE" : "EXECUTE MODE"} ═══\n`);

  // ── Preflight: Authority gates ─────────────────────────────────────────────

  if (!process.env.SERPER_API_KEY) {
    console.error("FAIL: SERPER_API_KEY not set — abort");
    process.exit(1);
  }

  // Lazy import to avoid startup failures in environments without DB
  const { pool, db } = await import("../server/db");
  const { serperGateway } = await import("../server/services/serper-gateway");
  const { serperAuthorityPermits } = await import("../server/services/sdr/serper-enrichment");

  const authority = await serperAuthorityPermits(serperGateway);
  if (!authority.permitted) {
    console.error(`FAIL: Serper authority gate blocks I/O: ${authority.reason}`);
    console.error("      Enable Serper and ensure circuit is closed before running canary.");
    process.exit(1);
  }

  const control = await serperGateway.getControl();
  if (!control) {
    console.error("FAIL: serper_control row missing — run migrations");
    process.exit(1);
  }

  const remainingBudget = control.local_budget - control.window_calls;
  if (remainingBudget < CANARY_HARD_REQUEST_CAP) {
    console.error(`FAIL: Insufficient Serper budget. Need ${CANARY_HARD_REQUEST_CAP}, have ${remainingBudget}`);
    console.error(`      Window: ${control.window_calls}/${control.local_budget} calls used`);
    process.exit(1);
  }

  console.log(`✓ Authority: permitted`);
  console.log(`✓ Budget: ${remainingBudget} remaining (need ≥ ${CANARY_HARD_REQUEST_CAP})`);
  console.log(`✓ Circuit: ${control.state}`);

  // ── PLAN mode ──────────────────────────────────────────────────────────────

  if (MODE_PLAN) {
    console.log(`\n── Plan: Freezing cohort of ${CANARY_COHORT_SIZE} entities ──\n`);

    // Stratified cohort: with/without DBA, with/without ZIP, generic names, FL metros
    const { sql } = await import("drizzle-orm");
    const candidates = await db.execute(sql`
      SELECT
        m.id,
        m.business_name,
        m.city,
        m.state,
        m.zip,
        m.main_phone IS NOT NULL AS has_phone,
        m.website IS NOT NULL AS has_website,
        m.main_email IS NOT NULL AS has_email
      FROM sdr_merchants m
      WHERE m.do_not_contact_flag IS NOT TRUE
        AND (m.website IS NULL OR m.main_phone IS NULL)
        AND m.state = 'FL'
      ORDER BY m.id
      LIMIT ${CANARY_COHORT_SIZE * 4}
    `);

    const all = (candidates.rows ?? []) as any[];
    if (all.length === 0) {
      console.error("FAIL: No eligible sdr_merchants found — cannot build cohort");
      process.exit(1);
    }

    // Stratified sampling
    const withZip = all.filter((r) => r.zip);
    const withoutZip = all.filter((r) => !r.zip);
    const genericNames = all.filter((r) => /\b(group|services|solutions|partners)\b/i.test(r.business_name));
    const miamiMetro = all.filter((r) => /(miami|coral gables|hialeah)/i.test(r.city ?? ""));
    const tampaMetro = all.filter((r) => /(tampa|clearwater|st pete|saint pete)/i.test(r.city ?? ""));

    // Build a stratified sample by interleaving groups
    const seen = new Set<number>();
    const cohort: any[] = [];
    const addFrom = (arr: any[], target: number) => {
      for (const r of arr) {
        if (cohort.length >= target) break;
        if (!seen.has(r.id)) { seen.add(r.id); cohort.push(r); }
      }
    };

    addFrom(miamiMetro, Math.floor(CANARY_COHORT_SIZE * 0.30));
    addFrom(tampaMetro, Math.floor(CANARY_COHORT_SIZE * 0.20));
    addFrom(withZip, Math.floor(CANARY_COHORT_SIZE * 0.25));
    addFrom(genericNames, Math.floor(CANARY_COHORT_SIZE * 0.15));
    addFrom(withoutZip, Math.floor(CANARY_COHORT_SIZE * 0.10));
    addFrom(all, CANARY_COHORT_SIZE); // fill remaining

    const cohortId = randomUUID();
    const cohortHash = createHash("sha256")
      .update(JSON.stringify(cohort.map((r) => r.id).sort()))
      .digest("hex");

    // Persist cohort definition (no provider calls)
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [
        `serper_canary_cohort:${cohortId}`,
        JSON.stringify({
          cohortId,
          cohortHash,
          size: cohort.length,
          strategyVersion: STRATEGY_VERSION,
          hardRequestCap: CANARY_HARD_REQUEST_CAP,
          createdAt: new Date().toISOString(),
          merchantIds: cohort.map((r) => r.id),
          stats: {
            withZip: cohort.filter((r) => r.zip).length,
            withoutZip: cohort.filter((r) => !r.zip).length,
            genericNames: cohort.filter((r) => /\b(group|services|solutions|partners)\b/i.test(r.business_name)).length,
            miamiMetro: cohort.filter((r) => /(miami|coral gables|hialeah)/i.test(r.city ?? "")).length,
            tampaMetro: cohort.filter((r) => /(tampa|clearwater|st pete)/i.test(r.city ?? "")).length,
          },
        }),
      ],
    );

    const estimatedRequests = cohort.length * 2.5; // ~2.5 avg requests per entity
    const estimatedCost = estimatedRequests * 1; // 1 credit per request

    console.log(`Cohort ID:  ${cohortId}`);
    console.log(`Cohort size: ${cohort.length}`);
    console.log(`Cohort hash: ${cohortHash}`);
    console.log(`\nStratification:`);
    console.log(`  Miami metro:   ${cohort.filter((r) => /(miami|coral gables|hialeah)/i.test(r.city ?? "")).length}`);
    console.log(`  Tampa metro:   ${cohort.filter((r) => /(tampa|clearwater|st pete)/i.test(r.city ?? "")).length}`);
    console.log(`  With ZIP:      ${cohort.filter((r) => r.zip).length}`);
    console.log(`  Without ZIP:   ${cohort.filter((r) => !r.zip).length}`);
    console.log(`  Generic names: ${cohort.filter((r) => /\b(group|services|solutions|partners)\b/i.test(r.business_name)).length}`);
    console.log(`\nEstimated requests:  ~${Math.round(estimatedRequests)}`);
    console.log(`Hard request cap:    ${CANARY_HARD_REQUEST_CAP}`);
    console.log(`Estimated credits:   ~${Math.round(estimatedCost)}`);
    console.log(`\nTo execute (makes real Serper calls, NO production field mutations):`);
    console.log(`  npx tsx scripts/canary-serper-lookup.ts --execute --cohort-id ${cohortId} --confirm-paid-serper`);
    console.log(`\nStatus: CODE_COMPLETE | CANARY_NOT_RUN\n`);

    await pool.end();
    return;
  }

  // ── EXECUTE mode ──────────────────────────────────────────────────────────

  console.log(`\n── Execute: Cohort ${COHORT_ID} (SHADOW MODE — no production writes) ──\n`);
  console.log(`SHADOW MODE: Real Serper credits will be consumed.`);
  console.log(`             Zero writes to sdr_merchants or CRO-03 tables.\n`);

  // Load cohort
  const cohortRow = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1`,
    [`serper_canary_cohort:${COHORT_ID}`],
  );
  if (!cohortRow.rows[0]) {
    console.error(`FAIL: Cohort ${COHORT_ID} not found. Run --plan first.`);
    process.exit(1);
  }

  const cohortDef = cohortRow.rows[0].value as any;
  if (cohortDef.cohortId !== COHORT_ID) {
    console.error("FAIL: Cohort ID mismatch — integrity check failed");
    process.exit(1);
  }

  const merchantIds: number[] = cohortDef.merchantIds;
  console.log(`Cohort: ${merchantIds.length} merchants`);
  console.log(`Hash: ${cohortDef.cohortHash}`);
  console.log(`Hard cap: ${CANARY_HARD_REQUEST_CAP} requests\n`);

  const { lookupBusinessIdentity } = await import("../server/services/serper-business-identity");
  const { sql } = await import("drizzle-orm");

  // Metrics
  const metrics = {
    total: merchantIds.length,
    processed: 0,
    blocked: 0,
    providerFailure: 0,
    noResult: 0,
    identityRejected: 0,
    ambiguous: 0,
    acceptedMatch: 0,
    yieldWebsite: 0,
    yieldPhone: 0,
    yieldAddress: 0,
    totalRequests: 0,
    latencyByStrategy: {} as Record<string, number[]>,
    errors: 0,
    hardCapHit: false,
  };

  for (const merchantId of merchantIds) {
    // Hard request cap enforcement — check BEFORE each lookup, accounting for the
    // maximum number of requests a single lookup may issue (MAX_REQUESTS_PER_LOOKUP).
    // Checking only totalRequests >= cap after the fact could let a single 4-call
    // lookup push us 3 calls over the cap.
    const { MAX_REQUESTS_PER_LOOKUP: MAX_PER } = await import("../server/services/serper-business-identity");
    if (metrics.totalRequests + MAX_PER > CANARY_HARD_REQUEST_CAP) {
      console.warn(`Hard request cap (${CANARY_HARD_REQUEST_CAP}) would be exceeded — stopping before next entity`);
      metrics.hardCapHit = true;
      break;
    }

    // Re-verify authority before each merchant (kill switch changes stop execution)
    const perCallAuthority = await serperAuthorityPermits(serperGateway);
    if (!perCallAuthority.permitted) {
      console.error(`Authority gate changed during execution: ${perCallAuthority.reason} — stopping`);
      break;
    }

    // Re-verify budget
    const freshControl = await serperGateway.getControl();
    if (!freshControl || freshControl.state === "open") {
      console.error("Circuit opened during execution — stopping");
      break;
    }
    const freshRemaining = freshControl.local_budget - freshControl.window_calls;
    if (freshRemaining < 3) {
      console.error("Budget near exhaustion — stopping");
      break;
    }

    // Load merchant (read-only)
    const merchantResult = await db.execute(sql`
      SELECT id, business_name, city, state, zip, main_phone, website, main_email
      FROM sdr_merchants WHERE id = ${merchantId}
    `);
    const merchant = (merchantResult.rows ?? [])[0] as any;
    if (!merchant) { metrics.errors++; continue; }

    const t0 = Date.now();
    let outcome;
    try {
      outcome = await lookupBusinessIdentity(
        {
          businessName: merchant.business_name,
          zip: merchant.zip,
          city: merchant.city,
          state: merchant.state ?? "FL",
        },
        {
          caller: "scripts/canary-serper-lookup.ts",
          gateway: serperGateway,
        },
      );
    } catch (err: any) {
      console.error(`Error on merchant ${merchantId}: ${err?.message}`);
      metrics.errors++;
      continue;
    }

    const elapsed = Date.now() - t0;
    metrics.totalRequests += outcome.requestsUsed;
    metrics.processed++;

    switch (outcome.kind) {
      case "blocked":         metrics.blocked++;          break;
      case "provider_failure": metrics.providerFailure++;  break;
      case "no_result":       metrics.noResult++;          break;
      case "identity_rejected": metrics.identityRejected++; break;
      case "ambiguous":       metrics.ambiguous++;          break;
      case "accepted_match":
        metrics.acceptedMatch++;
        if (outcome.accepted?.website) metrics.yieldWebsite++;
        if (outcome.accepted?.phone) metrics.yieldPhone++;
        if (outcome.accepted?.address) metrics.yieldAddress++;
        break;
    }

    // Track latency by strategy
    for (const strategy of outcome.strategiesAttempted) {
      if (!metrics.latencyByStrategy[strategy]) metrics.latencyByStrategy[strategy] = [];
      metrics.latencyByStrategy[strategy].push(elapsed);
    }

    // Progress indicator
    if (metrics.processed % 50 === 0) {
      console.log(`  [${metrics.processed}/${merchantIds.length}] requests=${metrics.totalRequests}/${CANARY_HARD_REQUEST_CAP}`);
    }

    // Rate limiting: 300ms between calls
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  const transportSuccessful = metrics.processed - metrics.blocked - metrics.providerFailure;
  const unusableRate = transportSuccessful > 0
    ? (metrics.noResult + metrics.identityRejected + metrics.ambiguous) / transportSuccessful
    : 1;

  // Non-ambiguous promotion rate: fraction of transport-successful subjects where
  // an unambiguous accepted_match was returned. This is NOT ground-truth precision
  // (no labeled cohort is available); it measures the system's ability to make a
  // confident, non-ambiguous determination. A low score means many merchants will
  // land in review_required / ambiguous rather than having fields promoted.
  //
  // NOTE: To measure true precision (correct-business promotion rate), an operator
  // must manually label a random sample of CANARY_PASS subjects and verify the
  // accepted website/phone match the correct business. This is an out-of-scope
  // operator step not automated here.
  const nonAmbiguousRate = transportSuccessful > 0
    ? metrics.acceptedMatch / transportSuccessful
    : 0;

  // Required: unusable < 40%, non-ambiguous promotion ≥ 50% of transport-successful
  const PASS_UNUSABLE_THRESHOLD = 0.40;
  const PASS_NON_AMBIGUOUS_THRESHOLD = 0.50;
  const unusablePass = unusableRate < PASS_UNUSABLE_THRESHOLD;
  const precisionPass = nonAmbiguousRate >= PASS_NON_AMBIGUOUS_THRESHOLD;
  const overallPass = unusablePass && precisionPass && metrics.errors === 0 && !metrics.hardCapHit;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SERPER CANARY REPORT`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Cohort:              ${COHORT_ID}`);
  console.log(`Processed:           ${metrics.processed}/${metrics.total}`);
  console.log(`Total requests:      ${metrics.totalRequests}/${CANARY_HARD_REQUEST_CAP} (hard cap)`);
  console.log(`Errors:              ${metrics.errors}`);
  console.log(`Hard cap hit:        ${metrics.hardCapHit}`);
  console.log(``);
  console.log(`── Outcome breakdown ──`);
  console.log(`  blocked:           ${metrics.blocked}`);
  console.log(`  provider_failure:  ${metrics.providerFailure}  ← NEVER combined with others`);
  console.log(`  no_result:         ${metrics.noResult}`);
  console.log(`  identity_rejected: ${metrics.identityRejected}`);
  console.log(`  ambiguous:         ${metrics.ambiguous}`);
  console.log(`  accepted_match:    ${metrics.acceptedMatch}`);
  console.log(``);
  console.log(`── Yield (accepted_match subjects only) ──`);
  console.log(`  website:           ${metrics.yieldWebsite}/${metrics.acceptedMatch}`);
  console.log(`  phone:             ${metrics.yieldPhone}/${metrics.acceptedMatch}`);
  console.log(`  address:           ${metrics.yieldAddress}/${metrics.acceptedMatch}`);
  console.log(``);
  console.log(`── Quality gates ──`);
  console.log(`  unusable rate:         ${(unusableRate * 100).toFixed(1)}% (target < 40%) — ${unusablePass ? "PASS" : "FAIL"}`);
  console.log(`  non-ambiguous rate:    ${(nonAmbiguousRate * 100).toFixed(1)}% (target ≥ 50%) — ${precisionPass ? "PASS" : "FAIL"}`);
  console.log(`  NOTE: True precision (correct-business promotion rate) requires manual`);
  console.log(`        sampling by an operator. This gate only measures non-ambiguity.`);
  console.log(``);
  console.log(`── Latency by strategy ──`);
  for (const [strategy, latencies] of Object.entries(metrics.latencyByStrategy)) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`  ${strategy}: avg ${Math.round(avg)}ms (n=${latencies.length})`);
  }
  console.log(``);
  console.log(`── Status ──`);
  console.log(`  CODE_COMPLETE: YES`);
  console.log(`  CANARY STATUS: ${overallPass ? "CANARY_PASS" : "CANARY_FAIL"}`);
  if (!overallPass) {
    if (!unusablePass) console.log(`    ✗ Unusable rate too high: ${(unusableRate * 100).toFixed(1)}% ≥ 40%`);
    if (!precisionPass) console.log(`    ✗ Non-ambiguous rate too low: ${(nonAmbiguousRate * 100).toFixed(1)}% < 50%`);
    if (metrics.errors > 0) console.log(`    ✗ ${metrics.errors} errors during execution`);
    if (metrics.hardCapHit) console.log(`    ✗ Hard request cap hit (cohort incomplete)`);
  }
  console.log(`${"═".repeat(60)}\n`);

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal canary error:", err);
  process.exit(1);
});
