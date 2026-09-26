/**
 * Disposable, DB-less certification for the SFP South Florida target-vertical
 * taxonomy v2 classifier (sfp-vertical-classifier.ts). Pure-function tests
 * only — no network, no database. Run with: npx tsx scripts/test-sfp-vertical-classifier-v2.ts
 */
import { classifyVertical, SFP_TARGET_VERTICALS_V2, TAXONOMY_VERSION_V2 } from "../server/services/cro03/sfp-vertical-classifier";

const targetIds = [...SFP_TARGET_VERTICALS_V2];
let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. resolved_high — exact alias match
{
  const r = classifyVertical("auto repair", targetIds, 2);
  check("high: exact alias 'auto repair' -> Automotive, resolved_high",
    r.outcome === "resolved_high" && r.matchedTargetId === "Automotive",
    JSON.stringify(r));
}

// 2. resolved_medium — curated strong synonym
{
  const r = classifyVertical("orthodontist", targetIds, 2);
  check("medium: strong synonym 'orthodontist' -> Healthcare, resolved_medium",
    r.outcome === "resolved_medium" && r.matchedTargetId === "Healthcare",
    JSON.stringify(r));
}

// 3. bare/unresolved target label — no match anywhere in taxonomy
{
  const r = classifyVertical("xyz-unknown-vertical-label", targetIds, 2);
  check("bare/unresolved: unknown label -> unresolved",
    r.outcome === "unresolved",
    JSON.stringify(r));
}

// 4. stale/wrong taxonomy version — a v2-only label evaluated against v1
// tables must NOT resolve via v2's aliases (proves versions are isolated).
{
  const v1Targets = ["Med Spa", "Dental", "Auto Repair", "Restaurant", "Retail"];
  const r = classifyVertical("hvac", v1Targets, 1);
  check("stale version: v2-only label 'hvac' against v1 taxonomy -> unresolved (not silently matched)",
    r.outcome === "unresolved" && r.taxonomyVersion === 1,
    JSON.stringify(r));
}

// 5. conflicting/ambiguous label — plausibly overlaps a target, must go to review
{
  const r = classifyVertical("wellness", targetIds, 2);
  check("conflicting: ambiguous 'wellness' -> review_required (never silently admitted)",
    r.outcome === "review_required",
    JSON.stringify(r));
}

// 6. excluded DBPR/restaurant category — curated non-target, high-confidence exclusion
{
  const r = classifyVertical("restaurant", targetIds, 2);
  check("excluded: 'restaurant' -> not_target",
    r.outcome === "not_target",
    JSON.stringify(r));
}
{
  const r = classifyVertical("food truck", targetIds, 2);
  check("excluded: 'food truck' -> not_target",
    r.outcome === "not_target",
    JSON.stringify(r));
}
{
  const r = classifyVertical("hotel", targetIds, 2);
  check("excluded: DBPR-adjacent 'hotel' -> not_target",
    r.outcome === "not_target",
    JSON.stringify(r));
}

// 7. v1 taxonomy left byte-for-byte unchanged (default param, no explicit version)
{
  const v1Targets = ["Med Spa", "Dental", "Auto Repair", "Restaurant", "Retail"];
  const r = classifyVertical("med spa", v1Targets);
  check("v1 unchanged: default call still resolves legacy 'med spa' -> Med Spa, resolved_high, taxonomyVersion=1",
    r.outcome === "resolved_high" && r.matchedTargetId === "Med Spa" && r.taxonomyVersion === 1,
    JSON.stringify(r));
}

// 8. empty/null input
{
  const r = classifyVertical(null, targetIds, 2);
  check("empty input -> unresolved", r.outcome === "unresolved", JSON.stringify(r));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
