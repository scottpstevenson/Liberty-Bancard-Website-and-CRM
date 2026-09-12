/**
 * CRO-03A Policy Comparison Service — Deterministic Integration Test
 *
 * Seeds a small set of cro03_source_subjects / cro03_source_observations /
 * cro03_source_occurrences with known verticals, inserts a minimal draft policy
 * document that differs from the active policy by targeting one additional vertical,
 * then calls the comparison service and asserts it correctly identifies flips —
 * including that the specific seeded flip occurrence changed disposition.
 *
 * Robustness guarantees:
 * - Candidate vertical selection uses resolveCanonicalVertical so that a raw vertical
 *   string like "Bar" (which maps to "Restaurant" and may already be targeted by v3)
 *   is never mistakenly chosen as a flip candidate.
 * - The specific seeded flip occurrence is verified via trackedOccurrenceIds, not a
 *   bounded sample that may omit it.
 * - Draft version uses MAX(version)+1 against the live DB to guarantee no collision
 *   with any existing row for this policy key.
 * - If no untargeted canonical vertical can be found among all known coarse verticals,
 *   the test fails explicitly rather than silently succeeding.
 *
 * Registration: scripts/ci-suite-manifest.ts
 * Capability: deterministic-integration
 *
 * Run: npx tsx scripts/test-cro03a-policy-comparison.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { hashCro03Evidence, createCro03SourceBatch } from "../server/services/cro03/source-staging";
import { compareCro03aPolicies } from "../server/services/cro03a/policy-comparison-service";
import { resolveCanonicalVertical } from "../server/services/sdr/canonical-vertical-resolver";
import { CANONICAL_COARSE_VERTICALS } from "../server/services/sdr/vertical-constants";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

const run = crypto.randomUUID();
const runTag = run.slice(0, 8);

// ── Require active policy to exist ─────────────────────────────────────────

const activeRow = rows(await db.execute(sql`
  SELECT p.id, p.version, p.policy_key, p.policy_hash, p.policy
    FROM cro03a_policy_control c
    JOIN cro03a_policy_documents p ON p.id = c.active_policy_id
   WHERE c.id = 1
`))[0];
assert(activeRow, "Active policy required for comparison test (cro03a_policy_control must resolve)");

const activePolicyId   = String(activeRow.id);
const activePolicyKey  = String(activeRow.policy_key);
const activePolicyDoc: Record<string, any> = typeof activeRow.policy === "string"
  ? JSON.parse(activeRow.policy) : activeRow.policy;
const activeTargetVerticals: string[] = activePolicyDoc.targetVerticals ?? [];
assert(activeTargetVerticals.length > 0, "Active policy must declare targetVerticals");

// ── Choose a flip vertical NOT targeted by the active policy ───────────────
// Use resolveCanonicalVertical to map each coarse vertical through the same
// resolver the evaluator uses. Only pick a vertical whose resolved canonical
// coarse name is absent from activeTargetVerticals.
// CANONICAL_COARSE_VERTICALS is the complete list; filter it rather than
// maintaining a hard-coded subset (which silently breaks as the list grows).

const untargetedCanonical = [...CANONICAL_COARSE_VERTICALS].find((coarseVertical: string) => {
  if (activeTargetVerticals.includes(coarseVertical)) return false;
  // Verify that using this coarse vertical as the payload vertical resolves
  // back to itself (identity check) — some coarse names may not be direct
  // payload values, but they are canonical and the resolver should return them.
  const resolved = resolveCanonicalVertical({
    merchantVertical: coarseVertical,
    merchantVerticalSource: "import_classification",
  });
  return resolved.vertical === coarseVertical && !activeTargetVerticals.includes(resolved.vertical ?? "");
});

if (!untargetedCanonical) {
  const msg =
    `[test] FAIL: every known canonical coarse vertical is already targeted by the active policy ` +
    `(active=[${activeTargetVerticals.join(",")}], ` +
    `canonical=[${CANONICAL_COARSE_VERTICALS.join(",")}]). ` +
    `The test cannot construct a meaningful flip scenario. ` +
    `Either the policy covers all verticals, or CANONICAL_COARSE_VERTICALS needs updating.`;
  console.error(msg);
  process.exit(1);
}

const flipVertical = untargetedCanonical;
console.log(`[test] Active policy: key=${activePolicyKey} version=${activeRow.version} targetVerticals=[${activeTargetVerticals.join(",")}]`);
console.log(`[test] Flip vertical chosen (canonical, not targeted): ${flipVertical}`);

// ── Build a minimal draft policy: active policy + one extra vertical ────────

const draftPolicyContent = {
  ...activePolicyDoc,
  targetVerticals: [...activeTargetVerticals, flipVertical],
};
const draftPolicyHash = hashCro03Evidence(draftPolicyContent);

// Allocate a collision-safe version by querying the current maximum version for
// this policy key and using MAX(version)+1. No ON CONFLICT or hash-prefix mod is
// used because those can silently reuse an existing row with different content.
const maxVersionRow = rows(await db.execute(sql`
  SELECT COALESCE(MAX(version), 0) AS max_version
    FROM cro03a_policy_documents
   WHERE policy_key = ${activePolicyKey}
`))[0];
const draftVersion = Number(maxVersionRow.max_version) + 1;

console.log(`[test] Draft: version=${draftVersion} targetVerticals=[${draftPolicyContent.targetVerticals.join(",")}]`);

await db.execute(sql`
  INSERT INTO cro03a_policy_documents
    (policy_key, version, policy, policy_hash, status, created_by)
  VALUES (
    ${activePolicyKey}, ${draftVersion},
    ${JSON.stringify(draftPolicyContent)}::jsonb, ${draftPolicyHash},
    'draft', ${"cro03a-comparison-test:" + runTag}
  )
`);

const draftRow = rows(await db.execute(sql`
  SELECT id, policy_hash, status FROM cro03a_policy_documents
   WHERE policy_key = ${activePolicyKey} AND version = ${draftVersion}
   LIMIT 1
`))[0];
assert(draftRow, "Draft policy row must exist after insert");
assert.equal(String(draftRow.policy_hash), draftPolicyHash, "Draft policy hash must match");
assert.equal(String(draftRow.status), "draft", "Draft policy must have status='draft'");
const draftPolicyId = String(draftRow.id);
console.log(`[test] Draft id=${draftPolicyId}`);

// ── Seed source occurrences with known verticals ────────────────────────────
// stable: a vertical already in the active policy (first in list) → should NOT flip
// flip:   flipVertical → SHOULD flip disposition between active and candidate

const stableSubjectKey = `cro03a-cmp-stable-${runTag}`;
const flipSubjectKey   = `cro03a-cmp-flip-${runTag}`;

const basePayload = {
  city: "Miami", state: "FL", postalCode: "33101", countyFips: "12086",
  entityStatus: "active", phone: `786555${runTag.slice(0, 4)}`, address: "100 Brickell Ave",
};

const batchResult = await createCro03SourceBatch({
  idempotencyKey: `cro03a-cmp-test:${runTag}`,
  actorType: "system",
  actorId: "cro03a-comparison-test",
  purpose: "staging_review",
  subjects: [
    {
      subjectType: "provider_csv_row",
      subjectKey: stableSubjectKey,
      sourceSystem: "apollo",
      provenance: { test: true, run: runTag, variant: "stable" },
      payload: { ...basePayload, vertical: activeTargetVerticals[0], businessName: `Test Stable ${runTag}` },
    },
    {
      subjectType: "provider_csv_row",
      subjectKey: flipSubjectKey,
      sourceSystem: "apollo",
      provenance: { test: true, run: runTag, variant: "flip" },
      payload: { ...basePayload, vertical: flipVertical, businessName: `Test Flip ${runTag}` },
    },
  ],
});
assert(batchResult.occurrenceIds.length >= 2,
  `createCro03SourceBatch must return >= 2 occurrenceIds; got ${batchResult.occurrenceIds.length}`);
console.log(`[test] ${batchResult.occurrenceIds.length} occurrences staged`);

// Find the specific flip occurrence ID for targeted assertion
const flipOccRow = rows(await db.execute(sql`
  SELECT o.id::text AS occurrence_id
    FROM cro03_source_occurrences o
    JOIN cro03_source_subjects s ON s.id = o.source_subject_id
   WHERE s.subject_key = ${flipSubjectKey}
     AND s.source_system = 'apollo'
   ORDER BY o.source_observed_at DESC
   LIMIT 1
`))[0];
assert(flipOccRow, `Flip occurrence must exist for subject_key=${flipSubjectKey}`);
const flipOccurrenceId = String(flipOccRow.occurrence_id);
console.log(`[test] Flip occurrence id=${flipOccurrenceId}`);

// ── Run the comparison service ──────────────────────────────────────────────
// Pass the flip occurrence ID as a tracked occurrence so its result is always
// returned in trackedResults, regardless of maxSample.

console.log("[test] Running compareCro03aPolicies...");
const result = await compareCro03aPolicies(
  draftPolicyId,
  db,
  20,
  [flipOccurrenceId],
);

console.log(`[test] Result: total=${result.totalOccurrences} flips=${result.flipCount}`);
console.log(`[test] Active v${result.policies.active.version} vs candidate v${result.policies.candidate.version}`);

// ── Assertions ─────────────────────────────────────────────────────────────

assert(result.totalOccurrences >= 2,
  `Population must include >= 2 occurrences; got ${result.totalOccurrences}`);

// The flip occurrence must be in trackedResults (always returned regardless of sample)
const trackedFlip = result.trackedResults.get(flipOccurrenceId);
assert(trackedFlip,
  `Flip occurrence (id=${flipOccurrenceId}) must appear in trackedResults — ` +
  `not found, either the occurrence was not included in the population or trackedOccurrenceIds was not forwarded`);

// The tracked flip occurrence must actually have changed disposition
assert(
  trackedFlip.flipped,
  `Seeded flip occurrence must have different dispositions between active and candidate policies; ` +
  `active=${trackedFlip.activePolicyDisposition} candidate=${trackedFlip.candidatePolicyDisposition} — ` +
  `the chosen vertical '${flipVertical}' did not produce a disposition change; ` +
  `check the evaluator's scoring logic and minimum score threshold`,
);
console.log(`[test] Seeded flip: active=${trackedFlip.activePolicyDisposition} → candidate=${trackedFlip.candidatePolicyDisposition}`);

// Total flip count must be > 0
assert(result.flipCount > 0,
  `Expected >= 1 flip (${flipVertical} now in candidate policy); got flipCount=${result.flipCount}`);

// selectionHash and evaluatedAsOf must be present
assert(result.selectionHash.length > 0, "selectionHash must be non-empty");
assert(result.evaluatedAsOf.length > 0, "evaluatedAsOf must be non-empty");

// Policy references must be correct
assert.equal(result.policies.active.id,    activePolicyId, "active policy ID must match control pointer");
assert.equal(result.policies.candidate.id, draftPolicyId,  "candidate policy ID must match inserted draft");
assert.equal(result.policies.candidate.version, draftVersion, "candidate version must match inserted draft");

// flipsBySourceAndDisposition must have at least one entry
assert(result.flipsBySourceAndDisposition.length > 0, "flipsBySourceAndDisposition must have at least one group");

// The comparison service must NEVER call activateCro03aPolicy()
const controlAfter = rows(await db.execute(sql`
  SELECT active_policy_id FROM cro03a_policy_control WHERE id = 1
`))[0];
assert.equal(String(controlAfter.active_policy_id), activePolicyId,
  "activateCro03aPolicy() must NOT have been called — control pointer must remain unchanged");

console.log(`\n[test] PASS: flipCount=${result.flipCount} across ${result.totalOccurrences} occurrences`);
console.log(`[test] PASS: seeded flip occurrence confirmed via trackedResults: ${trackedFlip.activePolicyDisposition} → ${trackedFlip.candidatePolicyDisposition}`);
console.log("[test] PASS: control pointer unchanged — activateCro03aPolicy() not called");
console.log("\n✅ CRO-03A Policy Comparison Test COMPLETE\n");
process.exit(0);
