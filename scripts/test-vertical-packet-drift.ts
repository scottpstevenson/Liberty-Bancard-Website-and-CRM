#!/usr/bin/env npx tsx
/**
 * Drift guard for collateral packet vertical resolution (Task #814).
 *
 * shared/collateral-packet-verticals.ts hardcodes aliases mapping THREE independent
 * vertical vocabularies to the canonical collateral-packet keys:
 *   1. VERTICALS (shared/schema.ts) — the merchant/contact/deal dropdown field.
 *   2. CANONICAL_DISCOVERY_VERTICALS (server/services/sdr/lead-finder.ts) — the
 *      fine-grained set produced by normalizeDiscoveryVertical().
 *   3. The coarse classifyVertical() bucket names (also in lead-finder.ts), which
 *      still show up on older discovery/lead records.
 *
 * There is no compile-time link between these vocabularies and the alias map, so a
 * future rename/addition in any of them could silently stop resolving to the right
 * packet (falling through to the General/Local Business fallback without anyone
 * noticing). This script iterates every label from all three vocabularies (read live
 * from source, not re-typed here) and asserts resolvePacketVertical() returns a
 * non-fallback packet for each one that is expected to have a dedicated packet.
 *
 * Zero live HTTP calls, zero DB access — pure in-memory/static-source assertions.
 * Exit 0 = pass, Exit 1 = fail (drift detected).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  PACKET_VERTICAL_DEFINITIONS,
  resolvePacketVertical,
} from "../shared/collateral-packet-verticals";
import { CANONICAL_DISCOVERY_VERTICALS } from "../server/services/sdr/lead-finder";
import { VERTICALS } from "../shared/schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}${detail ? " \u2014 " + detail : ""}`);
    failed++;
  }
}

/**
 * Labels that are intentionally expected to NOT resolve to a dedicated packet
 * (they should fall through to the general/local-business collateral instead).
 * Anything not in this list must resolve to a real packet, or the test fails.
 */
const EXPECTED_FALLBACK_LABELS = new Set(["Other", "Unknown", "General / Local Business"]);

/**
 * Extract the coarse bucket names classifyVertical() can return, straight from the
 * source file rather than re-typing them here — so if a future edit adds/renames a
 * bucket, this test picks it up automatically instead of testing a stale list.
 */
function extractClassifyVerticalBuckets(): string[] {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "server", "services", "sdr", "lead-finder.ts"),
    "utf8"
  );
  const fnMatch = src.match(/function classifyVertical\(category: string \| null, name: string\): string \{[\s\S]*?\n\}/);
  if (!fnMatch) {
    throw new Error("Could not locate classifyVertical() in lead-finder.ts \u2014 source shape changed");
  }
  const body = fnMatch[0];
  const returns = [...body.matchAll(/return "([^"]+)"/g)].map(m => m[1]);
  return [...new Set(returns)];
}

async function testDiscoveryCanonicalVerticalsResolve() {
  console.log("\n[1] Every CANONICAL_DISCOVERY_VERTICALS label resolves to a dedicated packet");
  assert(CANONICAL_DISCOVERY_VERTICALS.length > 0, "CANONICAL_DISCOVERY_VERTICALS is non-empty (sanity check)");

  for (const label of CANONICAL_DISCOVERY_VERTICALS) {
    if (EXPECTED_FALLBACK_LABELS.has(label)) continue;
    const resolved = resolvePacketVertical(label);
    assert(
      resolved !== null,
      `"${label}" (discovery canonical vertical) resolves to a packet`,
      "got null \u2014 would silently fall through to the General/Local Business packet"
    );
  }
}

async function testClassifyVerticalBucketsResolve() {
  console.log("\n[2] Every classifyVertical() coarse bucket resolves to a dedicated packet (except the intentional 'Other' fallback)");
  const buckets = extractClassifyVerticalBuckets();
  assert(buckets.includes("Other"), "classifyVertical() still has its 'Other' catch-all bucket (sanity check)");

  for (const bucket of buckets) {
    if (EXPECTED_FALLBACK_LABELS.has(bucket)) continue;
    const resolved = resolvePacketVertical(bucket);
    assert(
      resolved !== null,
      `"${bucket}" (classifyVertical coarse bucket) resolves to a packet`,
      "got null \u2014 would silently fall through to the General/Local Business packet"
    );
  }
}

async function testSchemaVerticalsResolve() {
  console.log("\n[3] Every VERTICALS (schema dropdown) label resolves to a dedicated packet (except the intentional 'Other' fallback)");
  for (const label of VERTICALS) {
    if (EXPECTED_FALLBACK_LABELS.has(label)) continue;
    const resolved = resolvePacketVertical(label);
    assert(
      resolved !== null,
      `"${label}" (schema VERTICALS dropdown) resolves to a packet`,
      "got null \u2014 would silently fall through to the General/Local Business packet"
    );
  }
}

async function testNoOrphanedPacketDefinitions() {
  console.log("\n[4] Every packet definition key is still reachable from at least one live vocabulary label (no dead/orphaned packets)");
  const allLiveLabels = [
    ...CANONICAL_DISCOVERY_VERTICALS,
    ...extractClassifyVerticalBuckets(),
    ...VERTICALS,
  ].filter(l => !EXPECTED_FALLBACK_LABELS.has(l));

  for (const def of PACKET_VERTICAL_DEFINITIONS) {
    const reachable = allLiveLabels.some(label => resolvePacketVertical(label) === def.key);
    assert(reachable, `Packet "${def.key}" is reachable from at least one current vocabulary label`, "no live label maps to this packet \u2014 dead definition or a vocabulary rename orphaned it");
  }
}

async function testFallbackLabelsStillFallBackAsExpected() {
  console.log("\n[5] Explicitly-fallback labels still resolve to null (sanity check that EXPECTED_FALLBACK_LABELS isn't stale)");
  for (const label of EXPECTED_FALLBACK_LABELS) {
    if (label === "General / Local Business") continue;
    assert(resolvePacketVertical(label) === null, `"${label}" resolves to null as expected (general fallback)`);
  }
}

async function main() {
  console.log("=== Collateral Packet Vertical Drift Guard (Task #814) ===");

  await testDiscoveryCanonicalVerticalsResolve();
  await testClassifyVerticalBucketsResolve();
  await testSchemaVerticalsResolve();
  await testNoOrphanedPacketDefinitions();
  await testFallbackLabelsStillFallBackAsExpected();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error(
      "\nDrift detected: a discovery/schema vertical label no longer resolves to its collateral packet.\n" +
      "Update the `aliases` list for the relevant entry in shared/collateral-packet-verticals.ts."
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error running tests:", err);
  process.exit(1);
});
