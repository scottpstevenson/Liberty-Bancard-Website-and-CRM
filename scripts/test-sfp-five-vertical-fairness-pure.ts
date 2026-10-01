#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { selectWithFiveVerticalMinimum } from "../server/services/cro03/sfp-five-vertical-fairness";

const verticals = [
  "Automotive",
  "Healthcare",
  "Beauty/Spa",
  "Construction/Trades/Home Services",
  "Fitness/Recreation",
];
const ranked = [
  ...Array.from({ length: 12 }, (_, index) => ({ id: `auto-${index}`, vertical: verticals[0] })),
  ...verticals.slice(1).flatMap((vertical, verticalIndex) =>
    Array.from({ length: 4 }, (_, index) => ({ id: `${verticalIndex}-${index}`, vertical })),
  ),
];

const selected = selectWithFiveVerticalMinimum(ranked, 10, verticals);
assert.equal(selected.length, 10);
for (const vertical of verticals) {
  assert.ok(selected.filter((candidate) => candidate.vertical === vertical).length >= 2, `${vertical} gets its minimum cohort coverage`);
}
assert.deepEqual(
  selected.map((candidate) => candidate.id),
  ranked.filter((candidate) => selected.includes(candidate)).map((candidate) => candidate.id),
  "the coverage floor preserves the caller's starvation/ROI rank order",
);

const noFitnessInventory = ranked.filter((candidate) => candidate.vertical !== "Fitness/Recreation");
const partial = selectWithFiveVerticalMinimum(noFitnessInventory, 10, verticals);
assert.equal(partial.length, 10, "missing vertical inventory does not strand cohort capacity");
assert.ok(partial.every((candidate) => candidate.vertical !== "Fitness/Recreation"));

console.log("SFP five-vertical fairness pure certification passed");