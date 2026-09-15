#!/usr/bin/env tsx
/**
 * Task #1962 — regression coverage for the Wave 6 activation-checklist gate.
 *
 * Sequences.tsx must route activation of any sequence carrying Wave 6
 * metadata (sequenceFamily or eligibleConsentTiers) through the guided
 * acknowledgement dialog rather than firing the toggle mutation directly,
 * because such sequences begin enrolling contacts immediately. This is a
 * pure-function regression test of the gating predicate
 * (client/src/lib/sequence-activation.ts) — see that file's Sequences.tsx
 * call site for the actual dialog wiring.
 *
 * Run: npx tsx scripts/test-sequence-activation-gate.ts
 */

import { isGovernedSequence } from "../client/src/lib/sequence-activation";

let failures = 0;
function assert(cond: boolean, message: string) {
  if (cond) {
    console.log(`  \u2713 ${message}`);
  } else {
    console.error(`  \u2717 ${message}`);
    failures++;
  }
}

console.log("Wave 6 governed-sequence gate:");
assert(isGovernedSequence({ sequenceFamily: "cold_outreach_v2" }) === true, "sequenceFamily set -> governed");
assert(isGovernedSequence({ eligibleConsentTiers: ["pewc_full_automation"] }) === true, "eligibleConsentTiers non-empty -> governed");
assert(isGovernedSequence({ sequenceFamily: null, eligibleConsentTiers: [] }) === false, "no Wave 6 metadata -> not governed");
assert(isGovernedSequence({ sequenceFamily: "", eligibleConsentTiers: [] }) === false, "empty-string family -> not governed");
assert(isGovernedSequence(undefined) === false, "undefined sequence -> not governed (fail safe, not throw)");
assert(isGovernedSequence(null) === false, "null sequence -> not governed (fail safe, not throw)");
assert(isGovernedSequence({}) === false, "empty object -> not governed");

console.log(failures === 0 ? "\n\u2713 All activation-gate assertions passed" : `\n\u2717 ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
