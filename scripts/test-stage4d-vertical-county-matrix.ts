#!/usr/bin/env tsx
/**
 * Stage 4D: five verticals x three counties, over 500 fixture rows, through the REAL classifier, geography resolver,
 * package plan and five-vertical selector. Pure: no database, no provider, no message. Counts per cell deliberately
 * differ; nothing here forces equality between different units (a business is not a contact is not a recipient).
 *
 * Not covered here (certified elsewhere or still open, see docs/certification/stage4-d/integrated-journey-matrix.md):
 * DBPR lineage / QA / archive / directory-domain / affiliation exclusions need the database predicates.
 */
import assert from "node:assert/strict";
import { resolveGeographyFromCandidates } from "../server/services/cro03/sfp-geography-resolver";
import { classifyVertical, SFP_TARGET_VERTICALS_V2, TAXONOMY_VERSION_V2, _TAXONOMY_FOR_TEST as T } from "../server/services/cro03/sfp-vertical-classifier";
import { SFP_PACKAGE_KEYS_V2 } from "../server/services/cro03/sfp-campaign-packages";
import { selectWithFiveVerticalMinimum } from "../server/services/cro03/sfp-five-vertical-fairness";

let checks = 0;
const check = (v: unknown, m: string) => { assert(v, m); checks++; console.log(`ok  ${m}`); };
const targets = [...SFP_TARGET_VERTICALS_V2];
const COUNTIES = [{ name: "Miami-Dade", fips: "12086" }, { name: "Broward", fips: "12011" }, { name: "Palm Beach", fips: "12099" }];
const slug = (v: string) => v.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");

// 1. Package plan: exactly one current v2 package per vertical.
const expectedKeys = targets.map((v) => `sfp.${slug(v)}.v2`).sort();
check(JSON.stringify([...SFP_PACKAGE_KEYS_V2].sort()) === JSON.stringify(expectedKeys), "the v2 package plan is exactly one package per target vertical");

// 2. Matrix fixtures: every cell has a different row count and cycles through that vertical's real alias labels.
type Row = { id: string; vertical: string; countyFips: string; label: string };
const rows: Row[] = [];
targets.forEach((v, vi) => {
  const aliases = T.EXACT_ALIASES_V2[v];
  COUNTIES.forEach((c, ci) => {
    const n = 30 + ((vi * 3 + ci * 5) % 11);
    for (let i = 0; i < n; i++) rows.push({ id: `${slug(v)}-${c.fips}-${i}`, vertical: v, countyFips: c.fips, label: aliases[i % aliases.length] });
  });
});
check(rows.length > 500, `the matrix has ${rows.length} rows (> 500)`);
const cellCounts = new Set(targets.flatMap((v) => COUNTIES.map((c) => rows.filter((r) => r.vertical === v && r.countyFips === c.fips).length)));
check(cellCounts.size > 3, `cells hold different counts (${[...cellCounts].sort((a, b) => a - b).join(", ")}); no forced equality`);

let misclassified = 0, geoWrong = 0;
for (const r of rows) {
  const cls = classifyVertical(r.label, targets, TAXONOMY_VERSION_V2);
  if (cls.matchedTargetId !== r.vertical || cls.outcome !== "resolved_high") misclassified++;
  const geo = resolveGeographyFromCandidates([{ locationId: 1, isPrimary: true, city: null, state: "FL", postalCode: null, countyFips: r.countyFips }]);
  if (!geo.eligible || geo.countyFips !== r.countyFips) geoWrong++;
}
check(misclassified === 0, "every row's real alias label classifies to its own vertical at resolved_high");
check(geoWrong === 0, "every row in the three counties resolves eligible with its own county");

// 3. Per vertical x county: the selector reserves a slice for each vertical even when one vertical dominates the ranking.
const ranked = [...rows].sort((a, b) => (a.vertical === targets[0] ? -1 : 0) - (b.vertical === targets[0] ? -1 : 0) || a.id.localeCompare(b.id));
const picked = selectWithFiveVerticalMinimum(ranked.map((r) => ({ ...r })), 50, targets);
const perVertical = Object.fromEntries(targets.map((v) => [v, picked.filter((p) => p.vertical === v).length]));
check(picked.length === 50 && targets.every((v) => perVertical[v] >= 10), `a 50-row cohort from a skewed ranking keeps every vertical at its minimum (${JSON.stringify(perVertical)})`);
const skewed = ranked.slice(0, 50);
check(targets.some((v) => skewed.filter((r) => r.vertical === v).length < 10), "negative control: plain top-50 of the same ranking starves a vertical");

// 4. Ineligible reasons are explicit and distinct.
const geo = (c: Partial<{ state: string; countyFips: string | null; city: string | null; postalCode: string | null }>) =>
  resolveGeographyFromCandidates([{ locationId: 1, isPrimary: true, city: null, state: "FL", postalCode: null, countyFips: null, ...c }]);
const monroe = geo({ countyFips: "12087" }), georgia = geo({ state: "GA", countyFips: "13121" }), orlando = geo({ city: "Orlando", postalCode: "32801" }), none = resolveGeographyFromCandidates([]);
check(monroe.outcome === "outside_territory" && !monroe.eligible, "a Florida county outside the three counties is outside_territory, not eligible");
check(georgia.outcome === "outside_territory" && !georgia.eligible, "a non-Florida county is outside_territory");
check(orlando.outcome === "unresolved" && !orlando.eligible, "an unlisted city with no county is unresolved, not guessed");
check(none.outcome === "unresolved" && none.reasons.includes("NO_LOCATION_CANDIDATES") && !none.eligible, "a business with no location is unresolved with a named reason");
check(new Set([monroe.outcome, orlando.outcome]).size === 2, "outside-territory and unresolved remain distinct reasons");
const mixed = resolveGeographyFromCandidates([
  { locationId: 1, isPrimary: true, city: null, state: "GA", postalCode: null, countyFips: "13121" },
  { locationId: 2, isPrimary: false, city: null, state: "FL", postalCode: null, countyFips: "12011" },
]);
check(mixed.eligible && mixed.countyFips === "12011", "a real in-county branch is not erased by an out-of-territory primary location");

// 5. Labels that must NOT become a target.
check(["restaurant", "retail"].every((l) => classifyVertical(l, targets, TAXONOMY_VERSION_V2).matchedTargetId === null), "restaurant and retail labels never resolve to one of the five verticals");
const ambiguous = Object.keys(T.AMBIGUOUS_LABELS_V2);
check(ambiguous.length > 0 && ambiguous.every((l) => classifyVertical(l, targets, TAXONOMY_VERSION_V2).outcome !== "resolved_high"), `ambiguous labels (${ambiguous.join(", ")}) never resolve at high confidence`);
check(classifyVertical("", targets, TAXONOMY_VERSION_V2).outcome === "unresolved" && classifyVertical(null, targets, TAXONOMY_VERSION_V2).outcome === "unresolved", "an empty vertical is unresolved with a named reason");
console.log(`\nStage 4D vertical x county matrix: ${checks} checks passed`);
