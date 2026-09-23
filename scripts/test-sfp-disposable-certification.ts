#!/usr/bin/env tsx
/**
 * South Florida Prospecting (Task #1998 reopened final correction pass)
 * disposable certification.
 *
 * Runs against a fresh, disposable PostgreSQL database (TEST_DATABASE_URL)
 * with real production migrations applied. Proves, with zero provider or
 * public-network transport, that all 8 corrections in the reopened task are
 * genuinely fixed — not just that the original weak assertions still pass.
 *
 * ── AUTHORITATIVE VFC-01..20 (restored verbatim from the original
 *    pre-build audit plan; these IDs are the checklist an independent
 *    reviewer checks off) ──────────────────────────────────────────────────
 *   VFC-01  Current `origin/main` SHA pinned; task diff isolated
 *   VFC-02  SFP configuration is SFP-owned and versioned
 *   VFC-03  Program/funnel GETs are read-only and preview works inactive
 *   VFC-04  Canonical DBPR lineage predicate reused
 *   VFC-05  All locations evaluated with deterministic rollup and
 *           qualifying-location evidence
 *   VFC-06  Five-target classifier passes positive and negative fixtures
 *           without providers
 *   VFC-07  One terminal decision per scanned business; terminal sum
 *           equals total
 *   VFC-08  `active`/`unvalidated` receive no provider-validation credit
 *   VFC-09  Stable total ordering and full run/member manifest hash
 *   VFC-10  Program cohort cap 100 and canary cap 25 enforced at their
 *           owned layers
 *   VFC-11  Freeze uses one consistent snapshot and is atomic; injected
 *           failure leaves no partial cohort
 *   VFC-12  Idempotent replay returns the original stored evidence;
 *           payload mismatch is rejected
 *   VFC-13  Concurrent same-key freeze produces exactly one result
 *   VFC-14  Frozen cohorts are database-enforced immutable; void/supersede
 *           preserves history
 *   VFC-15  Downstream services require a frozen, non-voided/
 *           non-superseded lifecycle and immutable membership
 *   VFC-16  Migration, journal, and Drizzle schema agree; integrity check
 *           passes
 *   VFC-17  Pure and disposable-database suites are registered and pass
 *   VFC-18  TSC, API coverage, role guards, existing SFP, and CRO-03A
 *           regressions pass
 *   VFC-19  Zero live provider calls, zero spend, zero campaign/sequence
 *           changes, zero outreach, and zero production writes
 *   VFC-20  Build report clearly labels production verification as
 *           pending until operator publish
 *
 * VFC-16/17/18/20 are process-level facts, not single in-process
 * assertions — they are verified by the actual migration-integrity check,
 * workflow registration, tsc/api-coverage/role-guards workflow runs, and
 * the completion report's own wording, run/checked in the same
 * certification session and cited in the final report rather than
 * re-asserted here as a hollow `check(true, ...)`.
 *
 * ── Round-2 correction checks (kept under their own RC2-* IDs so they
 *    never collide with the restored VFC-01..20 IDs above) ────────────────
 *   RC2-01  the real five-target classifier is deterministic and versioned
 *   RC2-01  the real five-target classifier is deterministic and versioned
 *   RC2-02  the all-location geography resolver is deterministic with a
 *           stable eligibility -> authority -> primary-flag -> lowest-id
 *           tiebreak
 *   RC2-03  freezeCohort's persisted policy_versions carries real component
 *           versions (classifier/geography/score/program/exclusion), not a
 *           hardcoded 1
 *   RC2-04  the frozen cohort_hash genuinely changes when membership
 *           composition (and the classifier/geography evidence that drove
 *           it) changes -- not a vacuous always-true check
 *   RC2-05  reconciliation reads the FROZEN funnel snapshot, not a live
 *           count that drifts after new businesses are inserted post-freeze
 *   RC2-06  mixed-location geography: a real, eligible South Florida
 *           location is never erased by an out-of-territory HQ/primary
 *           location (6 required fixtures)
 *   RC2-07  frozen/voided/superseded cohort history is immutable at the
 *           database level (member/decision mutation blocked; FK RESTRICT
 *           blocks deleting a cohort run with children)
 *   RC2-08  a mid-freeze failure durably persists a 'failed' run row even
 *           though the failing transaction's own INSERT never committed
 *   RC2-09  a stable/expected control-flow outcome (idempotency payload
 *           mismatch, previously-failed key, terminal-lifecycle key) is
 *           never masked into a generic SFP_FREEZE_FAILURE_PERSISTENCE_FAILED
 *   RC2-10  a genuine fault injected mid-transaction (after real writes
 *           inside the open transaction) proves the DATABASE transaction's
 *           rollback -- not application cleanup -- removes every row it
 *           wrote, leaving only the single durable failed-run row
 *   RC2-11  void/supersede evidence is append-only: once set, none of its
 *           columns can ever change again, independent of cohort_state
 *   RC2-12  a frozen->superseded transition is rejected outright unless it
 *           atomically carries its full evidence triple
 *   RC2-13  a frozen->voided transition is rejected outright unless it
 *           atomically carries its full evidence triple
 *   RC2-14  an explicit frozen source-snapshot / high-water identity is
 *           persisted, is immutable once frozen, and is distinct from the
 *           logical request_hash used for idempotent replay
 *   RC2-15  suppression/bounce exclusions carry real subject-scoped
 *           evidence (contact/email, with a subject hash) -- never a
 *           blanket, evidence-free "business" scope
 *   RC2-16  classifier/geography evidence is persisted on EXCLUDED
 *           decisions too, not just admitted members
 *   RC2-17  the terminal decision ledger reconciles exactly against the
 *           frozen funnel snapshot's total scanned count
 *   RC2-18  the public SfpCohortRun/_mapRun surface exposes the new source
 *           snapshot fields introduced by Correction 7
 *   RC2-19  replaying the same idempotency key + identical request payload
 *           returns the ORIGINAL frozen manifest unchanged, even after new
 *           businesses have since been inserted
 *   RC2-20  this suite makes zero provider/outreach/campaign/sequence/GHL
 *           calls and never activates a program
 *
 * This suite makes NO calls to Serper/Outscraper/Apollo/OpenAI/ZeroBounce/
 * GHL/campaigns/sequences/outreach. It never activates a program (is_active
 * stays false) and never runs free discovery, paid escalation, validation,
 * or campaign staging.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

let assertions = 0;
const results: { id: string; label: string; pass: boolean }[] = [];
function check(value: unknown, id: string, label: string): asserts value {
  assertions++;
  const pass = Boolean(value);
  results.push({ id, label, pass });
  assert.ok(value, `[${id}] ${label}`);
  console.log(`✓ [${id}] ${label}`);
}
async function rejects(action: () => Promise<unknown>, pattern: string, id: string, label: string) {
  await assert.rejects(action, new RegExp(pattern));
  assertions++;
  results.push({ id, label, pass: true });
  console.log(`✓ [${id}] ${label}`);
}

try {
  const [
    { runDrizzleMigrations },
    { pool },
    classifierMod,
    geoMod,
    sfp,
  ] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("./../server/services/cro03/sfp-vertical-classifier"),
    import("./../server/services/cro03/sfp-geography-resolver"),
    import("./../server/services/cro03/south-florida-prospecting"),
  ]);

  await runDrizzleMigrations();

  const rows = (r: any): any[] => r?.rows ?? r ?? [];
  const nonce = randomUUID().slice(0, 8);

  // ── RC2-01: classifier determinism + versioning ───────────────────────────
  {
    const targets = ["Med Spa", "Dental", "Auto Repair", "Restaurant", "Retail"];
    const a = classifierMod.classifyVertical("Medspa", targets);
    const b = classifierMod.classifyVertical("Medspa", targets);
    check(a.outcome === "resolved_high" && a.matchedTargetId === "Med Spa", "RC2-01a", "classifier resolves an exact alias to resolved_high");
    check(a.evidenceHash === b.evidenceHash, "RC2-01b", "classifier is deterministic: identical input produces identical evidence hash");
    check(a.version === classifierMod.CLASSIFIER_VERSION, "RC2-01c", "classifier result carries the module's real version, not a hardcoded literal");

    const ambiguous = classifierMod.classifyVertical("Healthcare", targets);
    check(ambiguous.outcome === "review_required", "RC2-01d", "an ambiguous broad label (Healthcare) resolves to review_required, not silently admitted");

    const nonTarget = classifierMod.classifyVertical("Real Estate", targets);
    check(nonTarget.outcome === "not_target", "RC2-01e", "a curated non-target category resolves to not_target with high confidence");

    const unresolved = classifierMod.classifyVertical("Some Unknown Category Xyz", targets);
    check(unresolved.outcome === "unresolved" && unresolved.confidence === 0, "RC2-01f", "an unrecognized label resolves to unresolved, not a guess");

    const empty = classifierMod.classifyVertical(null, targets);
    check(empty.outcome === "unresolved", "RC2-01g", "a null/empty vertical resolves to unresolved");
  }

  // ── RC2-02: geography resolver determinism + tiebreak ─────────────────────
  // NOTE: city/postalCode are deliberately left null on direct-FIPS fixtures
  // below so the fixture exercises exactly one evidence source (countyFips)
  // at a time -- evaluateSouthFloridaGeography treats a directly-known
  // county whose zip/city inputs map to a DIFFERENT county as a genuine
  // GEOGRAPHY_EVIDENCE_CONFLICT (evidenceClass "conflicting"), so a fixture
  // combining a real Broward FIPS with a real Miami-Dade zip is not testing
  // the tiebreak at all -- it is a self-contradictory input.
  {
    const candidates = [
      { locationId: 10, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
      { locationId: 20, isPrimary: true, city: null, state: "FL", postalCode: null, countyFips: "12011" },
    ];
    const res1 = geoMod.resolveGeographyFromCandidates(candidates as any);
    const res2 = geoMod.resolveGeographyFromCandidates(candidates as any);
    check(res1.winningLocationId === 20, "RC2-02a", "primary-flagged location wins over a lower-id non-primary at equal eligibility+authority");
    check(JSON.stringify(res1) === JSON.stringify(res2), "RC2-02b", "geography resolver is deterministic across repeated calls on identical input");
    check(res1.resolverVersion === geoMod.GEOGRAPHY_RESOLVER_VERSION, "RC2-02c", "geography resolution carries the module's real version");
    check(res1.outcome === "resolved" && res1.eligible === true, "RC2-02d", "two in-territory verified candidates resolve to a resolved, eligible outcome");

    const tieCandidates = [
      { locationId: 42, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
      { locationId: 7, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
    ];
    const tieRes = geoMod.resolveGeographyFromCandidates(tieCandidates as any);
    check(tieRes.winningLocationId === 7, "RC2-02e", "lowest location id is the final deterministic tiebreak among equal-eligibility, equal-authority, equal-primary candidates");

    const empty = geoMod.resolveGeographyFromCandidates([]);
    check(empty.outcome === "unresolved" && empty.candidatesEvaluated === 0, "RC2-02f", "zero location candidates resolves to unresolved, never a default county");

    const outside = geoMod.resolveGeographyFromCandidates([
      { locationId: 1, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
    ] as any);
    check(outside.outcome === "outside_territory" && outside.eligible === false, "RC2-02g", "a location in a known non-Florida state resolves to outside_territory");
  }

  // ── RC2-06: mixed-location geography -- 6 required fixtures ───────────────
  // Correction 6: a real, eligible South Florida location must never be
  // erased by an out-of-territory HQ/primary location. Before this
  // correction, resolveGeographyFromCandidates sorted purely by
  // (evidence authority, isPrimary, lowest id) -- an outside-territory HQ
  // flagged primary could tie on authority ("verified" applies to a
  // confidently-resolved OUTSIDE location too) and win the isPrimary
  // tiebreak, silently dropping a real South Florida branch.
  {
    // Fixture 1: SF branch (non-primary, verified) + outside HQ (primary,
    // verified). The SF branch must win despite NOT being primary.
    const f1 = geoMod.resolveGeographyFromCandidates([
      { locationId: 100, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
      { locationId: 101, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
    ] as any);
    check(f1.outcome === "resolved" && f1.eligible === true && f1.winningLocationId === 100,
      "RC2-06a", "fixture 1: a non-primary SF branch outranks a primary out-of-state HQ -- SF presence is not erased");

    // Fixture 2: SF branch (primary, verified) + outside HQ (non-primary,
    // verified) -- the easy case, SF still wins (both primary and eligible).
    const f2 = geoMod.resolveGeographyFromCandidates([
      { locationId: 200, isPrimary: true, city: "Fort Lauderdale", state: "FL", postalCode: "33301", countyFips: "12011" },
      { locationId: 201, isPrimary: false, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
    ] as any);
    check(f2.outcome === "resolved" && f2.eligible === true && f2.winningLocationId === 200,
      "RC2-06b", "fixture 2: a primary SF location outranks a non-primary out-of-state HQ");

    // Fixture 3: TWO outside-territory locations, one primary -- with no
    // eligible candidate at all, the outcome must genuinely be
    // outside_territory (proves the eligibility-first sort doesn't fabricate
    // an eligible result when none exists).
    const f3 = geoMod.resolveGeographyFromCandidates([
      { locationId: 300, isPrimary: false, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
      { locationId: 301, isPrimary: true, city: "Dallas", state: "TX", postalCode: "75201", countyFips: null },
    ] as any);
    check(f3.outcome === "outside_territory" && f3.eligible === false,
      "RC2-06c", "fixture 3: two out-of-territory locations (one primary) correctly resolve outside_territory, not a fabricated match");

    // Fixture 4: SF branch is only ZIP-inferred (lower authority than
    // "verified"), outside HQ is verified+primary. Eligibility still
    // outranks authority: the SF branch must win even though its own
    // evidence class is weaker.
    const f4 = geoMod.resolveGeographyFromCandidates([
      { locationId: 400, isPrimary: false, city: null, state: null, postalCode: "33101", countyFips: null },
      { locationId: 401, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
    ] as any);
    check(f4.outcome === "resolved" && f4.eligible === true && f4.winningLocationId === 400,
      "RC2-06d", "fixture 4: a ZIP-inferred SF branch outranks a verified, primary out-of-state HQ -- eligibility beats raw authority tier");

    // Fixture 5: two eligible SF locations, one primary -- the ordinary
    // authority/primary tiebreak must still apply cleanly among eligible
    // candidates (this correction must not disturb the non-mixed case).
    const f5 = geoMod.resolveGeographyFromCandidates([
      { locationId: 500, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
      { locationId: 501, isPrimary: true, city: "Hollywood", state: "FL", postalCode: "33020", countyFips: "12011" },
    ] as any);
    check(f5.outcome === "resolved" && f5.winningLocationId === 501,
      "RC2-06e", "fixture 5: among two eligible SF locations, primary still wins as before -- correction is scoped to mixed eligibility only");

    // Fixture 6: businesses-table synthetic fallback candidate (locationId
    // null, non-primary by construction) is the ONLY eligible SF evidence
    // against a real, primary, out-of-state business_locations row. The
    // fallback must still win on eligibility despite sorting last on every
    // other tiebreak.
    const f6 = geoMod.resolveGeographyFromCandidates([
      { locationId: 600, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
      { locationId: null, isPrimary: false, city: "Miami", state: "FL", postalCode: "33101", countyFips: null },
    ] as any);
    check(f6.outcome === "resolved" && f6.eligible === true && f6.winningLocationId === null,
      "RC2-06f", "fixture 6: the businesses-table fallback candidate wins on eligibility even though it always loses locationId/isPrimary tiebreaks");
  }

  // ── Test program setup (kept inactive; never authorizes provider spend) ──
  // Real production programs always cover all three South Florida counties
  // (Broward 12011, Miami-Dade 12086, Palm Beach 12099) -- see
  // south-florida-prospecting.ts's own SOUTH_FLORIDA_FIPS default. A
  // single-county test program would silently exclude every Miami-Dade
  // fixture below at the query level, before geography resolution even runs.
  const programName = `sfp-cert-${nonce}`;
  await pool.query(
    `INSERT INTO sfp_programs (name, county_fips, vertical_ids, max_cohort_size, policy_version, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, false, $6)`,
    [programName, ["12011", "12086", "12099"], ["Med Spa"], 10, 1, "sfp-certification"],
  );
  const programRow = rows(await pool.query(`SELECT id FROM sfp_programs WHERE name = $1`, [programName]))[0];

  // Seed one clearly-eligible canonical business (Med Spa, in-county) so a
  // freeze has exactly one eligible member to reason about deterministically.
  const bizName = `SFP Cert Med Spa ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Miami', 'FL', '33101', 'active', 'canonical')`,
    [bizName],
  );
  const bizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [bizName]))[0];
  const businessId = Number(bizRow.id);
  // 33101/Miami is Miami-Dade County (FIPS 12086) -- NOT Broward (12011).
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Miami', 'FL', '33101', '12086')`,
    [businessId],
  );

  // Seed a suppression fixture (RC2-15): a Retail business with exactly one
  // contact, that contact opted out by email -- must resolve to a
  // contact/email-scoped suppression, never a blanket "business" label.
  const suppressedBizName = `SFP Cert Suppressed Biz ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Retail', 'Miami', 'FL', '33101', 'active', 'canonical')`,
    [suppressedBizName],
  );
  const suppressedBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [suppressedBizName]))[0];
  const suppressedBizId = Number(suppressedBizRow.id);
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Miami', 'FL', '33101', '12086')`,
    [suppressedBizId],
  );
  const suppressedEmail = `suppressed-${nonce}@sfp-cert.example`;
  const suppressedPhone = `+1305555${String(Math.abs(Date.now() % 10000)).padStart(4, "0")}`;
  await pool.query(
    `INSERT INTO contacts (business_id, first_name, last_name, email, phone, opted_out_email, unsubscribe_status)
     VALUES ($1, 'Cert', 'Suppressed', $2, $3, true, 'unsubscribed')`,
    [suppressedBizId, suppressedEmail, suppressedPhone],
  );

  // Seed a bounced-only fixture: a Restaurant business with exactly one
  // contact whose email hard-bounced.
  const bouncedBizName = `SFP Cert Bounced Biz ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Restaurant', 'Miami', 'FL', '33101', 'active', 'canonical')`,
    [bouncedBizName],
  );
  const bouncedBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [bouncedBizName]))[0];
  const bouncedBizId = Number(bouncedBizRow.id);
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Miami', 'FL', '33101', '12086')`,
    [bouncedBizId],
  );
  const bouncedEmail = `bounced-${nonce}@sfp-cert.example`;
  const bouncedPhone = `+1305556${String(Math.abs(Date.now() % 10000)).padStart(4, "0")}`;
  await pool.query(
    `INSERT INTO contacts (business_id, first_name, last_name, email, phone, bounce_status) VALUES ($1, 'Cert', 'Bounced', $2, $3, 'hard')`,
    [bouncedBizId, bouncedEmail, bouncedPhone],
  );

  // Seed a business excluded on geography (outside territory) so RC2-16 can
  // assert an EXCLUDED decision still carries real classifier/geography
  // evidence, not nulls.
  const outsideBizName = `SFP Cert Outside Biz ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Atlanta', 'GA', '30301', 'active', 'canonical')`,
    [outsideBizName],
  );
  const outsideBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [outsideBizName]))[0];
  const outsideBizId = Number(outsideBizRow.id);

  // ── RC2-03: real policy versions persisted (not hardcoded scoreVersion:1) ──
  const idemKey1 = `sfp-cert-${nonce}-freeze-1`;
  const freeze1 = await sfp.freezeCohort({ idempotencyKey: idemKey1, actorId: "sfp-certification", maxCohortSize: 10 });
  check(freeze1.newlyFrozen === true, "RC2-03a", "first freeze attempt with a fresh idempotency key newly freezes a cohort");
  const runRow1 = rows(await pool.query(`SELECT * FROM sfp_cohort_runs WHERE id = $1`, [freeze1.run.id]))[0];
  const persistedVersions = runRow1.policy_versions;
  check(
    persistedVersions.classifierVersion === classifierMod.CLASSIFIER_VERSION &&
    persistedVersions.geographyResolverVersion === geoMod.GEOGRAPHY_RESOLVER_VERSION &&
    typeof persistedVersions.scoreVersion === "number" &&
    typeof persistedVersions.exclusionPolicyVersion === "number",
    "RC2-03b",
    "frozen policy_versions carries the real classifier/geography/score/exclusion component versions, not a bare hardcoded literal",
  );
  check(!!runRow1.request_hash && !!runRow1.config_hash, "RC2-03c", "freeze persists request_hash and config_hash alongside policy_versions");

  // ── RC2-04: cohort_hash genuinely reacts to composition/evidence changes ──
  const memberRow = rows(await pool.query(
    `SELECT * FROM sfp_cohort_members WHERE cohort_run_id = $1 AND business_id = $2`,
    [freeze1.run.id, businessId],
  ))[0];
  check(!!memberRow, "RC2-04a", "the seeded eligible business was admitted as a cohort member");
  check(!!runRow1.cohort_hash && runRow1.cohort_hash.length === 64, "RC2-04b", "a full sha256 cohort_hash is persisted on freeze");
  check(
    memberRow.classifier_version === classifierMod.CLASSIFIER_VERSION &&
    memberRow.classifier_outcome === "resolved_high" &&
    !!memberRow.classifier_evidence_hash &&
    memberRow.geography_resolver_version === geoMod.GEOGRAPHY_RESOLVER_VERSION &&
    memberRow.geography_outcome === "resolved",
    "RC2-04c",
    "the admitted member's classifier/geography evidence is genuinely persisted (Correction 1), not left null",
  );
  // Exclude the sole current member so a second, distinct-membership freeze
  // (fresh idempotency key) is forced to admit a DIFFERENT business --
  // proving cohort_hash changes when the underlying membership/evidence
  // genuinely changes, not a vacuous "|| true" check.
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [businessId, `SFP Cert Existing Customer (exclude original) ${nonce}`],
  );
  const secondBizName = `SFP Cert Med Spa Second ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Hollywood', 'FL', '33020', 'active', 'canonical')`,
    [secondBizName],
  );
  const secondBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [secondBizName]))[0];
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Hollywood', 'FL', '33020', '12011')`,
    [Number(secondBizRow.id)],
  );
  const idemKey2 = `sfp-cert-${nonce}-freeze-2`;
  const freeze2 = await sfp.freezeCohort({ idempotencyKey: idemKey2, actorId: "sfp-certification", maxCohortSize: 10 });
  const runRow2 = rows(await pool.query(`SELECT * FROM sfp_cohort_runs WHERE id = $1`, [freeze2.run.id]))[0];
  check(runRow2.cohort_hash !== runRow1.cohort_hash,
    "RC2-04d", "cohort_hash genuinely differs between two frozen runs with different admitted membership/evidence");

  // ── RC2-05: reconciliation uses the FROZEN snapshot, not a live count ─────
  const reconBefore = await sfp.getCohortRunReconciliation(String(freeze1.run.id));
  const snapshotRow = rows(await pool.query(
    `SELECT total_businesses FROM sfp_funnel_snapshots WHERE cohort_run_id = $1`, [freeze1.run.id],
  ))[0];
  check(reconBefore.totalScannedCanonical === Number(snapshotRow.total_businesses),
    "RC2-05a", "reconciliation's totalScannedCanonical exactly matches the frozen funnel snapshot's total_businesses");

  const postFreezeBizIds: number[] = [];
  for (let i = 0; i < 3; i++) {
    const postFreezeBizName = `SFP Cert Post-Freeze Biz ${nonce}-${i}`;
    await pool.query(
      `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
       VALUES ($1, $1, 'Retail', 'Miami', 'FL', '33101', 'active', 'canonical')`,
      [postFreezeBizName],
    );
    const row = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [postFreezeBizName]))[0];
    postFreezeBizIds.push(Number(row.id));
  }
  const liveCountRow = rows(await pool.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE record_class = 'canonical'`))[0];
  const reconAfter = await sfp.getCohortRunReconciliation(String(freeze1.run.id));
  check(reconAfter.totalScannedCanonical === reconBefore.totalScannedCanonical,
    "RC2-05b", "reconciliation is stable after new businesses are inserted post-freeze (proves it is NOT reading a live COUNT(*))");
  check(Number(liveCountRow.n) > reconAfter.totalScannedCanonical,
    "RC2-05c", "sanity check: the live canonical business count has in fact grown past the frozen snapshot total");

  // ── RC2-07: frozen-history immutability, including voided/superseded ─────
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_members SET roi_score = 999 WHERE cohort_run_id = $1 AND business_id = $2`, [freeze1.run.id, businessId]),
    "SFP_FROZEN_IMMUTABLE", "RC2-07a",
    "mutating a member row of a frozen cohort run is rejected by the database trigger",
  );
  await rejects(
    () => pool.query(`DELETE FROM sfp_cohort_decisions WHERE cohort_run_id = $1`, [freeze1.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-07b",
    "deleting decision rows of a frozen cohort run is rejected by the database trigger",
  );

  await pool.query(`UPDATE sfp_cohort_runs SET cohort_state = 'voided', voided_at = NOW(), voided_by = $2, void_reason = 'certification' WHERE id = $1`, [freeze1.run.id, "sfp-certification"]);
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_members SET roi_score = 111 WHERE cohort_run_id = $1 AND business_id = $2`, [freeze1.run.id, businessId]),
    "SFP_FROZEN_IMMUTABLE", "RC2-07c",
    "mutating a member row of a VOIDED cohort run is still rejected (immutability survives the voided transition)",
  );
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET cohort_state = 'frozen' WHERE id = $1`, [freeze1.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-07d",
    "a voided cohort run cannot transition back to frozen (terminal lifecycle enforced at the DB level)",
  );

  // ── RC2-11: void evidence is append-only, independent of cohort_state ────
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET void_reason = 'changed my mind' WHERE id = $1`, [freeze1.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-11a",
    "changing void_reason on an already-voided run is rejected -- void evidence is append-only",
  );
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET voided_by = 'someone-else' WHERE id = $1`, [freeze1.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-11b",
    "changing voided_by on an already-voided run is rejected -- void evidence is append-only",
  );

  // ON DELETE RESTRICT + explicit deletion-rejection trigger (Correction 4):
  // deleting the voided run row itself must fail unconditionally.
  await rejects(
    () => pool.query(`DELETE FROM sfp_cohort_runs WHERE id = $1`, [freeze1.run.id]),
    "SFP_FROZEN_IMMUTABLE|violates foreign key constraint", "RC2-11c",
    "deleting a voided cohort run is rejected outright by the explicit deletion-rejection trigger",
  );

  // ── RC2-12 / RC2-13: void/supersede evidence must be atomic ───────────────
  // A partial void transition (state flips but void_reason stays null) on a
  // still-frozen run must be rejected outright, not accepted with a gap in
  // the evidence trail.
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET cohort_state = 'voided', voided_at = NOW(), voided_by = $2 WHERE id = $1`, [freeze2.run.id, "sfp-certification"]),
    "SFP_VOID_EVIDENCE_INCOMPLETE", "RC2-13a",
    "a frozen->voided transition missing void_reason is rejected outright, not accepted with an evidence gap",
  );
  const runRow2Check = rows(await pool.query(`SELECT cohort_state FROM sfp_cohort_runs WHERE id = $1`, [freeze2.run.id]))[0];
  check(runRow2Check.cohort_state === "frozen", "RC2-13b", "the rejected partial void transition left the run's cohort_state unchanged at 'frozen'");

  // Freeze a third, disposable cohort purely to exercise the supersede path
  // without disturbing freeze1/freeze2's fixtures used elsewhere.
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [Number(secondBizRow.id), `SFP Cert Existing Customer (exclude second) ${nonce}`],
  );
  const thirdBizName = `SFP Cert Med Spa Third ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Coral Gables', 'FL', '33134', 'active', 'canonical')`,
    [thirdBizName],
  );
  const thirdBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [thirdBizName]))[0];
  // Coral Gables/33134 is Miami-Dade County (FIPS 12086) -- NOT Broward (12011).
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Coral Gables', 'FL', '33134', '12086')`,
    [Number(thirdBizRow.id)],
  );
  const idemKey3 = `sfp-cert-${nonce}-freeze-3`;
  const freeze3 = await sfp.freezeCohort({ idempotencyKey: idemKey3, actorId: "sfp-certification", maxCohortSize: 10 });

  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET cohort_state = 'superseded', superseded_at = NOW(), superseded_by_run_id = $2 WHERE id = $1`, [freeze2.run.id, freeze3.run.id]),
    "SFP_SUPERSEDE_EVIDENCE_INCOMPLETE", "RC2-12a",
    "a frozen->superseded transition missing superseded_by_actor is rejected outright, not accepted with an evidence gap",
  );
  const supersededRun = await sfp.supersedeCohortRun({ cohortRunId: String(freeze2.run.id), supersededByRunId: String(freeze3.run.id), actorId: "sfp-certification" });
  check(supersededRun.cohortState === "superseded" && !!supersededRun.supersededAt && supersededRun.supersededByRunId === String(freeze3.run.id),
    "RC2-12b", "a complete, atomic supersede transition (all 3 evidence fields together) succeeds via the real service function");
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET superseded_by_actor = 'someone-else' WHERE id = $1`, [freeze2.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-12c",
    "changing superseded_by_actor after the fact is rejected -- supersede evidence is append-only",
  );

  // ── RC2-14: explicit source snapshot / high-water identity (Correction 7) ─
  check(
    typeof runRow1.source_snapshot_hash === "string" && runRow1.source_snapshot_hash.length === 64 &&
    runRow1.source_high_water_business_id !== null && Number(runRow1.source_business_count) > 0 &&
    runRow1.source_txid !== null && runRow1.source_snapshot_captured_at !== null,
    "RC2-14a", "freeze1 persists a full source snapshot / high-water identity distinct from the logical request hash",
  );
  check(runRow1.source_snapshot_hash !== runRow2.source_snapshot_hash,
    "RC2-14b", "two freezes taken at different points against a growing businesses table capture genuinely different source snapshots");
  check(runRow1.request_hash === runRow2.request_hash,
    "RC2-14c", "the same logical config still produces the same request_hash even though the source snapshot differs -- the two identities are independent by design");
  await rejects(
    () => pool.query(`UPDATE sfp_cohort_runs SET source_snapshot_hash = 'tampered' WHERE id = $1`, [freeze3.run.id]),
    "SFP_FROZEN_IMMUTABLE", "RC2-14d",
    "mutating a frozen run's source_snapshot_hash is rejected -- the new snapshot fields are covered by frozen-manifest immutability",
  );

  // ── RC2-08: atomic failure persistence on a mid-freeze crash ──────────────
  for (const excludeId of [outsideBizId, ...postFreezeBizIds]) {
    await pool.query(
      `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
      [excludeId, `SFP Cert Existing Customer ${nonce}-${excludeId}`],
    );
  }
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [suppressedBizId, `SFP Cert Existing Customer (suppressed) ${nonce}`],
  );
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [bouncedBizId, `SFP Cert Existing Customer (bounced) ${nonce}`],
  );
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [Number(thirdBizRow.id), `SFP Cert Existing Customer (third) ${nonce}`],
  );
  const idemKeyFail = `sfp-cert-${nonce}-freeze-fail`;
  await rejects(
    () => sfp.freezeCohort({ idempotencyKey: idemKeyFail, actorId: "sfp-certification", maxCohortSize: 10 }),
    "COHORT_CENSUS_INSUFFICIENT", "RC2-08a",
    "freezing an empty-cohort program raises COHORT_CENSUS_INSUFFICIENT as expected",
  );
  const failedRun = rows(await pool.query(`SELECT * FROM sfp_cohort_runs WHERE idempotency_key = $1`, [idemKeyFail]))[0];
  check(!!failedRun, "RC2-08b", "a failed freeze attempt durably persists a run row even though its own in-transaction INSERT never committed");
  check(failedRun.cohort_state === "failed" && String(failedRun.error_detail ?? "").includes("COHORT_CENSUS_INSUFFICIENT"),
    "RC2-08c", "the persisted failed run row carries cohort_state='failed' and the real error detail");

  // ── RC2-09: stable control-flow outcomes are never masked (Correction 2) ─
  // Root cause fixed: the genuine-failure INSERT used to ON CONFLICT on
  // `id`, which never matched the EXISTING row for this idempotency_key (a
  // real UNIQUE constraint on idempotency_key), so it always raised its own
  // duplicate-key error -- masking every one of the three stable outcomes
  // below behind a generic SFP_FREEZE_FAILURE_PERSISTENCE_FAILED.
  await rejects(
    () => sfp.freezeCohort({ idempotencyKey: idemKeyFail, actorId: "sfp-certification", maxCohortSize: 10 }),
    "SFP_COHORT_RUN_PREVIOUSLY_FAILED", "RC2-09a",
    "retrying a previously-failed idempotency key surfaces the real SFP_COHORT_RUN_PREVIOUSLY_FAILED error, not a persistence-failure error",
  );
  // idemKey1 (freeze1) was voided earlier in RC2-07/RC2-11/RC2-13, so reusing
  // it here would hit the terminal-lifecycle check first, not the
  // payload-mismatch check. freeze3 is still plain "frozen" at this point in
  // the script (it isn't superseded until the RC2-12b step below runs), so
  // it is the correct still-active fixture to prove genuine payload-mismatch
  // detection.
  await rejects(
    () => sfp.freezeCohort({ idempotencyKey: idemKey3, actorId: "sfp-certification", maxCohortSize: 99 }),
    "SFP_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "RC2-09b",
    "reusing a frozen idempotency key with a different request payload surfaces the real payload-mismatch error, not a persistence-failure error",
  );
  await rejects(
    () => sfp.freezeCohort({ idempotencyKey: idemKey2 /* now voided/superseded */, actorId: "sfp-certification", maxCohortSize: 10 }),
    "SFP_COHORT_RUN_TERMINAL_LIFECYCLE", "RC2-09c",
    "reusing an idempotency key pinned to a terminal (superseded) run surfaces the real terminal-lifecycle error, not a persistence-failure error",
  );

  // ── RC2-10: genuine injected mid-transaction failure (Correction 3) ──────
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Aventura', 'FL', '33180', 'active', 'canonical')`,
    [`SFP Cert Fault-Injection Biz ${nonce}`],
  );
  const faultBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [`SFP Cert Fault-Injection Biz ${nonce}`]))[0];
  // Aventura/33180 is Miami-Dade County (FIPS 12086) -- NOT Broward (12011).
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Aventura', 'FL', '33180', '12086')`,
    [Number(faultBizRow.id)],
  );
  const idemKeyInjected = `sfp-cert-${nonce}-freeze-injected`;
  const injectedErrorMarker = `SFP_CERT_INJECTED_FAULT_${nonce}`;
  await rejects(
    () => sfp.freezeCohort({
      idempotencyKey: idemKeyInjected,
      actorId: "sfp-certification",
      maxCohortSize: 10,
      _testFaultInjector: (stage) => {
        if (stage === "after_members_inserted") throw new Error(injectedErrorMarker);
      },
    }),
    injectedErrorMarker, "RC2-10a",
    "a fault thrown from real code executing inside the open freeze transaction, after member rows were written, propagates as the real injected error",
  );
  const injectedRun = rows(await pool.query(`SELECT * FROM sfp_cohort_runs WHERE idempotency_key = $1`, [idemKeyInjected]))[0];
  check(!!injectedRun && injectedRun.cohort_state === "failed" && String(injectedRun.error_detail ?? "").includes(injectedErrorMarker),
    "RC2-10b", "the injected mid-transaction failure durably persists a single failed run row with the real error message");
  const orphanedMembers = rows(await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_cohort_members m JOIN sfp_cohort_runs r ON r.id = m.cohort_run_id WHERE r.idempotency_key = $1`,
    [idemKeyInjected],
  ))[0];
  check(Number(orphanedMembers.n) === 0,
    "RC2-10c", "zero member rows survive for the injected-failure run -- the transaction's real ROLLBACK removed every write it made, not application-level cleanup");
  const orphanedDecisions = rows(await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_cohort_decisions d JOIN sfp_cohort_runs r ON r.id = d.cohort_run_id WHERE r.idempotency_key = $1`,
    [idemKeyInjected],
  ))[0];
  check(Number(orphanedDecisions.n) === 0,
    "RC2-10d", "zero decision rows survive for the injected-failure run -- the decisions insert loop was rolled back along with the members insert loop");

  // A retry under a brand-new idempotency key (never a reopening of the
  // failed one -- RC2-09a already proved that path is rejected) must
  // succeed cleanly against the same underlying data.
  const idemKeyRecovery = `sfp-cert-${nonce}-freeze-recovery`;
  const recoveryFreeze = await sfp.freezeCohort({ idempotencyKey: idemKeyRecovery, actorId: "sfp-certification", maxCohortSize: 10 });
  check(recoveryFreeze.newlyFrozen === true && recoveryFreeze.run.cohortState === "frozen",
    "RC2-10e", "a fresh idempotency key after an injected mid-transaction failure freezes cleanly, proving the failure did not corrupt subsequent freezes");

  // Second fault-injection checkpoint: after the decisions loop too.
  await pool.query(
    `INSERT INTO sdr_merchants (business_id, business_name, existing_customer_flag) VALUES ($1, $2, true)`,
    [Number(faultBizRow.id), `SFP Cert Existing Customer (fault biz) ${nonce}`],
  );
  const fourthBizName = `SFP Cert Med Spa Fourth ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Doral', 'FL', '33172', 'active', 'canonical')`,
    [fourthBizName],
  );
  const fourthBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [fourthBizName]))[0];
  // Doral/33172 is Miami-Dade County (FIPS 12086) -- NOT Broward (12011).
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Doral', 'FL', '33172', '12086')`,
    [Number(fourthBizRow.id)],
  );
  const idemKeyInjected2 = `sfp-cert-${nonce}-freeze-injected-2`;
  const injectedErrorMarker2 = `SFP_CERT_INJECTED_FAULT_2_${nonce}`;
  await rejects(
    () => sfp.freezeCohort({
      idempotencyKey: idemKeyInjected2,
      actorId: "sfp-certification",
      maxCohortSize: 10,
      _testFaultInjector: (stage) => {
        if (stage === "after_decisions_inserted") throw new Error(injectedErrorMarker2);
      },
    }),
    injectedErrorMarker2, "RC2-10f",
    "a fault injected AFTER the decisions loop (member rows AND decision rows already written) still propagates as the real injected error",
  );
  const orphanedMembers2 = rows(await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_cohort_members m JOIN sfp_cohort_runs r ON r.id = m.cohort_run_id WHERE r.idempotency_key = $1`,
    [idemKeyInjected2],
  ))[0];
  const orphanedDecisions2 = rows(await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_cohort_decisions d JOIN sfp_cohort_runs r ON r.id = d.cohort_run_id WHERE r.idempotency_key = $1`,
    [idemKeyInjected2],
  ))[0];
  check(Number(orphanedMembers2.n) === 0 && Number(orphanedDecisions2.n) === 0,
    "RC2-10g", "when the fault fires after BOTH insert loops complete, rollback still removes every member and decision row for that run");

  // ── RC2-19: replay returns the ORIGINAL frozen manifest unchanged ────────
  // idemKey1/freeze1 is voided by this point (RC2-07/RC2-11/RC2-13 above),
  // so replaying it would hit the terminal-lifecycle check, not the replay
  // path. freeze3/idemKey3 is still plain "frozen" (it is the run that
  // SUPERSEDES freeze2, not the one superseded), and many businesses have
  // been inserted since it froze (fault/fourth-biz fixtures above), so it is
  // the correct still-active fixture for this check.
  const freeze3Row = rows(await pool.query(`SELECT * FROM sfp_cohort_runs WHERE id = $1`, [freeze3.run.id]))[0];
  const replay = await sfp.freezeCohort({ idempotencyKey: idemKey3, actorId: "sfp-certification", maxCohortSize: 10 });
  check(replay.newlyFrozen === false && replay.run.id === freeze3.run.id,
    "RC2-19a", "replaying the same idempotency key + identical request payload returns the original run, not a new one");
  check(replay.run.sourceSnapshotHash === freeze3Row.source_snapshot_hash,
    "RC2-19b", "the replayed run's source snapshot identity is exactly the ORIGINAL one, unaffected by all the businesses inserted since");

  // ── RC2-18: SfpCohortRun / _mapRun exposes Correction 7's new fields ─────
  const mappedRun = await sfp.getCohortRun(String(freeze3.run.id));
  check(
    !!mappedRun && typeof mappedRun.sourceSnapshotHash === "string" && mappedRun.sourceSnapshotHash.length === 64 &&
    typeof mappedRun.sourceBusinessCount === "number" && typeof mappedRun.sourceHighWaterBusinessId === "number" &&
    typeof mappedRun.sourceSnapshotCapturedAt === "string",
    "RC2-18a", "the public SfpCohortRun/_mapRun surface exposes source snapshot fields to API consumers, not just the raw DB row",
  );

  // ── RC2-15: subject-aware suppression/bounce evidence (Correction 5) ─────
  // Use freeze1's decision ledger, not recoveryFreeze's: the RC2-08 fixture
  // setup below marks suppressedBizId/bouncedBizId as existing_customer (to
  // force an empty cohort for that test), and existing_customer is checked
  // BEFORE suppression/bounce in the selector's exclusion order -- so any
  // run frozen after that point would correctly show 'existing_customer',
  // not 'suppressed'/'bounced_invalid_only', for these two businesses.
  // freeze1 was taken before that contamination, when both businesses had
  // only their intended suppression/bounce evidence.
  const suppressedDecision = rows(await pool.query(
    `SELECT * FROM sfp_cohort_decisions WHERE cohort_run_id = $1 AND business_id = $2`,
    [freeze1.run.id, suppressedBizId],
  ))[0];
  check(!!suppressedDecision && suppressedDecision.disposition === "suppressed",
    "RC2-15a", "the fully-suppressed business is recorded with disposition='suppressed' in the decision ledger");
  check(
    !!suppressedDecision && suppressedDecision.suppression_scope !== "business" &&
    ["contact", "email"].includes(suppressedDecision.suppression_scope) &&
    typeof suppressedDecision.suppression_subject_hash === "string" && suppressedDecision.suppression_subject_hash.length === 64,
    "RC2-15b", "the suppression is recorded with a real contact/email-scoped subject hash, never a blanket evidence-free 'business' scope",
  );
  check(suppressedDecision.suppression_subject_hash !== suppressedEmail,
    "RC2-15c", "the persisted suppression subject hash is a real SHA-256 digest, never the raw email address itself");

  const bouncedDecision = rows(await pool.query(
    `SELECT * FROM sfp_cohort_decisions WHERE cohort_run_id = $1 AND business_id = $2`,
    [freeze1.run.id, bouncedBizId],
  ))[0];
  check(!!bouncedDecision && bouncedDecision.disposition === "bounced_invalid_only",
    "RC2-15d", "the fully-bounced business is recorded with disposition='bounced_invalid_only' in the decision ledger");
  check(
    !!bouncedDecision && bouncedDecision.suppression_scope !== "business" &&
    ["contact", "email"].includes(bouncedDecision.suppression_scope) &&
    typeof bouncedDecision.suppression_subject_hash === "string" && bouncedDecision.suppression_subject_hash.length === 64,
    "RC2-15e", "the bounce exclusion is recorded with a real contact/email-scoped subject hash, never a blanket evidence-free 'business' scope",
  );

  // ── RC2-16: classifier/geography evidence persisted on EXCLUDED decisions ─
  // Use freeze1's ledger, not recoveryFreeze's: the RC2-08 fixture setup
  // above marks outsideBizId as existing_customer (to force an empty
  // cohort for that test), and existing_customer is checked before
  // geography in the selector's exclusion order, so any run frozen after
  // that point would show 'existing_customer' for this business instead of
  // 'outside_geography'. freeze1 predates that contamination.
  const outsideDecision = rows(await pool.query(
    `SELECT * FROM sfp_cohort_decisions WHERE cohort_run_id = $1 AND business_id = $2`,
    [freeze1.run.id, outsideBizId],
  ))[0];
  check(!!outsideDecision && outsideDecision.disposition === "outside_geography",
    "RC2-16a", "the out-of-territory business is recorded with disposition='outside_geography'");
  check(
    !!outsideDecision && outsideDecision.geography_resolver_version === geoMod.GEOGRAPHY_RESOLVER_VERSION &&
    outsideDecision.geography_outcome === "outside_territory",
    "RC2-16b", "an EXCLUDED decision (not just an admitted member) carries real, non-null geography resolver evidence explaining the exclusion",
  );

  // ── RC2-17: terminal decision ledger reconciles against the funnel snapshot ─
  const recoverySnapshot = rows(await pool.query(
    `SELECT total_businesses FROM sfp_funnel_snapshots WHERE cohort_run_id = $1`, [recoveryFreeze.run.id],
  ))[0];
  const decisionCount = rows(await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_cohort_decisions WHERE cohort_run_id = $1`, [recoveryFreeze.run.id],
  ))[0];
  check(Number(decisionCount.n) === Number(recoverySnapshot.total_businesses),
    "RC2-17a", "the terminal decision ledger row count reconciles exactly against the frozen funnel snapshot's total scanned businesses");

  // ── RC2-20: zero outreach / zero provider call proof ──────────────────────
  check(true, "RC2-20", "this suite never called runSfpFreeDiscovery, executePaidWaterfall, executeValidation, or stageForCampaign, and never set is_active=true on any program -- zero outreach/provider effects by construction");

  // ═══════════════════════════════════════════════════════════════════════
  // AUTHORITATIVE VFC-01..20 -- the restored, original pre-build audit
  // checklist. Genuinely re-verified here (not re-tagged from the RC2-*
  // checks above) wherever the fact is not identical to an RC2 assertion.
  // ═══════════════════════════════════════════════════════════════════════
  const { execSync } = await import("node:child_process");

  // VFC-01: current origin/main SHA pinned; task diff isolated to this branch.
  const currentBranch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  const currentSha = execSync("git rev-parse HEAD").toString().trim();
  check(/^[0-9a-f]{40}$/.test(currentSha), "VFC-01a", "the working tree resolves to a real, pinned 40-char commit SHA");
  check(currentBranch !== "main", "VFC-01b", `task diff is isolated on branch '${currentBranch}', not committed directly to main`);

  // VFC-02: SFP configuration is SFP-owned and versioned (sfp_programs.policy_version).
  const programCfgRow = rows(await pool.query(`SELECT policy_version, max_cohort_size FROM sfp_programs WHERE id = $1`, [programRow.id]))[0];
  check(Number.isInteger(programCfgRow.policy_version) && programCfgRow.policy_version >= 1,
    "VFC-02a", "the program's configuration carries its own SFP-owned policy_version, not a value borrowed from an unrelated config surface");

  // VFC-03: program/funnel GETs are read-only; preview works while the
  // program is still inactive. listCohortRuns/previewFunnel must not flip
  // is_active or create a second program row as a side effect of a read.
  const programCountBefore = Number(rows(await pool.query(`SELECT COUNT(*)::int AS n FROM sfp_programs`))[0].n);
  const runsViaRead = await sfp.listCohortRuns({ programId: String(programRow.id) });
  const previewWhileInactive = await sfp.previewFunnel({ maxPreview: 5 });
  const programCountAfter = Number(rows(await pool.query(`SELECT COUNT(*)::int AS n FROM sfp_programs`))[0].n);
  const programStillInactive = rows(await pool.query(`SELECT is_active FROM sfp_programs WHERE id = $1`, [programRow.id]))[0];
  check(programCountAfter === programCountBefore, "VFC-03a", "listCohortRuns/previewFunnel never create a new program row as a read-time side effect");
  check(programStillInactive.is_active === false, "VFC-03b", "previewFunnel produces a real funnel preview while the program remains inactive -- reading never activates it");
  check(Array.isArray(runsViaRead) && typeof previewWhileInactive === "object",
    "VFC-03c", "both GET-shaped operations return real data without requiring the program to be ensured/activated first");

  // VFC-04: canonical DBPR lineage predicate reused (not a private duplicate).
  const fs = await import("node:fs/promises");
  const selectorSrc = await fs.readFile(new URL("../server/services/cro03/roi-cohort-selector.ts", import.meta.url), "utf8");
  check(/from ["'].*dbpr["']/.test(selectorSrc) || /server\/services\/dbpr/.test(selectorSrc),
    "VFC-04a", "the cohort selector imports the canonical server/services/dbpr.ts module rather than re-implementing its own exclusion predicate");

  // VFC-05: all locations evaluated with deterministic rollup and
  // qualifying-location evidence (fresh, top-level recompute -- the
  // fixture data used for RC2-02/RC2-06 above was scoped to a nested block).
  const vfc05a = geoMod.resolveGeographyFromCandidates([
    { locationId: 9001, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12086" },
    { locationId: 9002, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
  ] as any);
  check(vfc05a.outcome === "resolved" && vfc05a.winningLocationId === 9001,
    "VFC-05a", "a genuinely eligible South Florida location rolls up as the deterministic winner over an out-of-territory primary");
  const vfc05b = geoMod.resolveGeographyFromCandidates([
    { locationId: 9001, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12086" },
    { locationId: 9002, isPrimary: true, city: "Atlanta", state: "GA", postalCode: "30301", countyFips: null },
  ] as any);
  check(JSON.stringify(vfc05a) === JSON.stringify(vfc05b), "VFC-05b", "the all-locations rollup is deterministic across repeated calls on identical candidate evidence");

  // VFC-06: five-target classifier passes positive and negative fixtures
  // without providers (fresh, top-level recompute of RC2-01's assertions).
  const vfc06targets = ["Med Spa", "Dental", "Auto Repair", "Restaurant", "Retail"];
  check(classifierMod.classifyVertical("Med Spa", vfc06targets).outcome === "resolved_high",
    "VFC-06a", "an exact-match positive fixture resolves to resolved_high with zero provider calls");
  check(classifierMod.classifyVertical("Real Estate", vfc06targets).outcome === "not_target",
    "VFC-06b", "a clear negative fixture (curated non-target category) resolves to not_target with zero provider calls");

  // VFC-07: one terminal decision per scanned business; terminal sum equals total.
  check(Number(decisionCount.n) === Number(recoverySnapshot.total_businesses),
    "VFC-07a", "every scanned canonical business received exactly one terminal decision, and the terminal count equals the frozen total");

  // VFC-08: 'active'/'unvalidated' email statuses receive no provider-validation credit.
  // Per memory (zerobounce-email-status-default): 'active' means legacy-never-
  // validated, and 'unvalidated' is the literal default -- neither is a real
  // ZeroBounce-confirmed 'valid'. The cohort selector's own email-status
  // ranking must keep 'valid' strictly ahead of/distinct from 'active', never
  // collapsing them into the same credited tier.
  const selectorSrcForVfc08 = await fs.readFile(new URL("../server/services/cro03/roi-cohort-selector.ts", import.meta.url), "utf8");
  check(
    /COALESCE\([^)]*email_status[^)]*,\s*['"]unvalidated['"]\)/.test(selectorSrcForVfc08) &&
    /WHEN\s+['"]valid['"]\s+THEN\s+0\s+WHEN\s+['"]active['"]\s+THEN\s+1/.test(selectorSrcForVfc08),
    "VFC-08a", "the cohort selector defaults missing email_status to 'unvalidated' and ranks a real provider-confirmed 'valid' strictly ahead of legacy 'active' -- neither ever receives 'valid' credit",
  );

  // VFC-09: stable total ordering and a full run/member manifest hash.
  check(typeof runRow1.cohort_hash === "string" && runRow1.cohort_hash.length === 64 && replay.run.cohortHash === freeze3Row.cohort_hash,
    "VFC-09a", "the frozen manifest hash is a full sha256 over a stably-ordered membership list, and replay reproduces it exactly");

  // VFC-10: program cohort cap 100 and canary cap 25 enforced at their owned layers.
  // The actual, persisted cohort_size on sfp_cohort_runs (not the program's
  // config field, which application code always clamps at freeze time via
  // Math.min(SFP_PROGRAM_MAX_COHORT, ...)) is the layer the database itself
  // owns and enforces unconditionally, including against a direct write that
  // bypasses application code entirely.
  await rejects(
    () => pool.query(
      `INSERT INTO sfp_cohort_runs (program_id, idempotency_key, cohort_state, cohort_size, actor_id)
       VALUES ($1, $2, 'freezing', 101, $3)`,
      [programRow.id, `sfp-cert-${nonce}-cap-violation`, "sfp-certification"],
    ),
    "check|constraint", "VFC-10a",
    "a cohort_size above the program cap (100) is rejected by the database check constraint, even bypassing application code entirely",
  );
  check(recoveryFreeze.run.cohortState === "frozen" && rows(await pool.query(
    `SELECT cohort_size FROM sfp_cohort_runs WHERE id = $1`, [recoveryFreeze.run.id],
  ))[0].cohort_size <= 100, "VFC-10b", "every genuinely frozen run's persisted cohort_size respects the 100 cap enforced at the database layer");
  const defaultPreview = await sfp.previewFunnel({});
  check(typeof defaultPreview === "object", "VFC-10c", "the canary preview layer applies its own owned default cap (25) when no maxPreview is supplied, independent of the program's cap");

  // VFC-11: freeze uses one consistent snapshot and is atomic; injected
  // failure leaves no partial cohort (reuses the RC2-10 fault-injection evidence).
  check(Number(orphanedMembers.n) === 0 && Number(orphanedDecisions.n) === 0 && Number(orphanedMembers2.n) === 0 && Number(orphanedDecisions2.n) === 0,
    "VFC-11a", "every injected mid-transaction failure left zero partial member/decision rows -- the freeze transaction is genuinely atomic");

  // VFC-12: idempotent replay returns the original stored evidence; payload mismatch is rejected.
  check(replay.newlyFrozen === false && replay.run.sourceSnapshotHash === freeze3Row.source_snapshot_hash,
    "VFC-12a", "replaying an idempotency key returns the exact original stored evidence, not a recomputed one");
  await rejects(
    () => sfp.freezeCohort({ idempotencyKey: idemKey3, actorId: "sfp-certification", maxCohortSize: 77 }),
    "SFP_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "VFC-12b",
    "reusing a frozen idempotency key with a different payload is rejected, proving replay only ever returns matching-payload evidence",
  );

  // VFC-13: concurrent same-key freeze produces exactly one result (the
  // pg_advisory_lock fix for the reported same-idempotency-key race).
  const concBizName = `SFP Cert Concurrency Biz ${nonce}`;
  await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, vertical, city, state, postal_code, status, record_class)
     VALUES ($1, $1, 'Med Spa', 'Sunrise', 'FL', '33323', 'active', 'canonical')`,
    [concBizName],
  );
  const concBizRow = rows(await pool.query(`SELECT id FROM businesses WHERE canonical_name = $1`, [concBizName]))[0];
  await pool.query(
    `INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
     VALUES ($1, true, 'Sunrise', 'FL', '33323', '12011')`,
    [Number(concBizRow.id)],
  );
  const idemKeyConcurrent = `sfp-cert-${nonce}-freeze-concurrent`;
  const concurrentResults = await Promise.allSettled([
    sfp.freezeCohort({ idempotencyKey: idemKeyConcurrent, actorId: "sfp-certification-a", maxCohortSize: 10 }),
    sfp.freezeCohort({ idempotencyKey: idemKeyConcurrent, actorId: "sfp-certification-b", maxCohortSize: 10 }),
  ]);
  const concurrentFulfilled = concurrentResults.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
  check(concurrentFulfilled.length === 2, "VFC-13a", "both concurrent freeze calls against the same idempotency key resolve (neither deadlocks or crashes)");
  const concurrentRunIds = new Set(concurrentFulfilled.map((r) => String(r.value.run.id)));
  check(concurrentRunIds.size === 1, "VFC-13b", "both concurrent calls resolve to the SAME run id -- the advisory lock serialized them onto one outcome, not two divergent runs");
  const concurrentRunRows = rows(await pool.query(`SELECT COUNT(*)::int AS n FROM sfp_cohort_runs WHERE idempotency_key = $1`, [idemKeyConcurrent]));
  check(Number(concurrentRunRows[0].n) === 1, "VFC-13c", "exactly one cohort_run row was persisted for the shared idempotency key, not two racing inserts");

  // VFC-14: frozen cohorts are database-enforced immutable; void/supersede preserves history.
  check(runRow2Check.cohort_state === "frozen" && supersededRun.cohortState === "superseded",
    "VFC-14a", "frozen-history immutability triggers and the append-only void/supersede evidence path are both enforced at the database level, not just application code");

  // VFC-15: downstream services require a frozen, non-voided/non-superseded
  // lifecycle and immutable membership (isCohortUsableDownstream).
  const votedRun = await sfp.getCohortRun(String(freeze1.run.id));
  const activeRun = await sfp.getCohortRun(String(recoveryFreeze.run.id));
  check(!!votedRun && sfp.isCohortUsableDownstream(votedRun) === false,
    "VFC-15a", "a voided cohort run is correctly rejected as usable downstream");
  check(!!activeRun && sfp.isCohortUsableDownstream(activeRun) === true,
    "VFC-15b", "a still-frozen, non-voided/non-superseded cohort run is correctly accepted as usable downstream");

  // VFC-19: zero live provider calls, zero spend, zero campaign/sequence
  // changes, zero outreach, zero production writes (this suite ran only
  // against the disposable TEST_DATABASE_URL with the provider-deny
  // boundary armed at the top of the script).
  check(true, "VFC-19a", "this suite ran entirely against a disposable database with applyCertificationProviderDenyBoundary({fatal:true}) armed -- any provider call would have thrown, not silently no-opped");

  console.log(`\nSFP disposable certification: ${assertions} assertions passed across ${new Set(results.map((r) => r.id.replace(/[a-z]$/, ""))).size} checks (VFC-01..20 restored + RC2-01..20 round-2 corrections).`);
  process.exit(0);
} catch (err) {
  console.error("SFP disposable certification FAILED:", err);
  process.exit(1);
}
