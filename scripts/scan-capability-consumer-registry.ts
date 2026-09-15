#!/usr/bin/env npx tsx
/**
 * scripts/scan-capability-consumer-registry.ts
 *
 * MI-09 corrective item 1 — registry/census guard.
 *
 * Fails when a WORKER_CAPABILITY_GROUPS entry names a physical queue that has
 * no matching QUEUE_CONFIGS entry (i.e. selecting that capability group would
 * silently start zero consumers for one of its named queues — the exact bug
 * this corrective item was written to close for `free-enrichment-lane`).
 *
 * Also asserts, by direct static analysis of the source text (not runtime
 * import graph, which would be defeated by dynamic `await import(...)`),
 * that the `free-enrichment-lane` queue's case block in queue-manager.ts does
 * not reference any paid-provider, ZeroBounce, GHL, sequence, campaign, or
 * outreach module — and that MI09_ACTIVATION_SCOPE no longer omits the
 * `free-enrichment-lane` capability group in favor of the broad `enrichment`
 * group alone.
 *
 * Read-only. No DB connection required. Safe to run in CI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { WORKER_CAPABILITY_GROUPS } from "../server/services/background-profile";
import { QUEUE_CONFIGS } from "../server/services/queue-manager";
import { MI09_ACTIVATION_SCOPE } from "../server/services/mi09-pilot-authority";

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`FAIL: ${msg}`); };
const ok = (msg: string) => console.log(`OK:   ${msg}`);

const configuredQueueNames = new Set(QUEUE_CONFIGS.map((c) => c.name));

// 1. Every capability-group queue must have a registered QUEUE_CONFIGS entry.
for (const [group, queues] of Object.entries(WORKER_CAPABILITY_GROUPS)) {
  for (const q of queues as readonly string[]) {
    if (!configuredQueueNames.has(q as any)) {
      fail(`capability group "${group}" names queue "${q}", but no QUEUE_CONFIGS entry registers a consumer for it`);
    } else {
      ok(`capability group "${group}" -> queue "${q}" has a registered consumer`);
    }
  }
}

// 2. free-enrichment-lane must resolve to exactly its own physical queue, never
//    substituting or including the broad "enrichment" queue.
const freeLaneQueues = WORKER_CAPABILITY_GROUPS["free-enrichment-lane"] as readonly string[];
if (freeLaneQueues.length !== 1 || freeLaneQueues[0] !== "free-enrichment-lane") {
  fail(`WORKER_CAPABILITY_GROUPS["free-enrichment-lane"] must be exactly ["free-enrichment-lane"], got ${JSON.stringify(freeLaneQueues)}`);
} else {
  ok('WORKER_CAPABILITY_GROUPS["free-enrichment-lane"] resolves to exactly its own physical queue');
}
if ((WORKER_CAPABILITY_GROUPS["enrichment"] as readonly string[]).includes("free-enrichment-lane")) {
  fail('WORKER_CAPABILITY_GROUPS["enrichment"] must not also include "free-enrichment-lane" (defeats isolation)');
} else {
  ok('WORKER_CAPABILITY_GROUPS["enrichment"] does not include "free-enrichment-lane"');
}

// 3. MI09_ACTIVATION_SCOPE must explicitly list free-enrichment-lane, not rely
//    on the broad "enrichment" group alone to cover it.
if (!MI09_ACTIVATION_SCOPE.split(":")[1]?.split(",").includes("free-enrichment-lane")) {
  fail(`MI09_ACTIVATION_SCOPE does not explicitly include "free-enrichment-lane": ${MI09_ACTIVATION_SCOPE}`);
} else {
  ok("MI09_ACTIVATION_SCOPE explicitly includes free-enrichment-lane");
}

// 4. Static source-text scan of the free-enrichment-lane case block: it must
//    never reference a paid-provider / ZeroBounce / GHL / sequence / campaign
//    / outreach module, directly or via a banned identifier substring.
const qmPath = path.resolve(__dirname, "../server/services/queue-manager.ts");
const qmSrc = fs.readFileSync(qmPath, "utf8");
const caseStart = qmSrc.indexOf("case QUEUE_NAMES.FREE_ENRICHMENT_LANE:");
if (caseStart === -1) {
  fail("could not locate `case QUEUE_NAMES.FREE_ENRICHMENT_LANE:` block in queue-manager.ts");
} else {
  // Extract up to the next sibling `case QUEUE_NAMES.` at the same indent level.
  const rest = qmSrc.slice(caseStart + 1);
  const nextCaseIdx = rest.search(/\n        case QUEUE_NAMES\./);
  const rawBlock = nextCaseIdx === -1 ? rest : rest.slice(0, nextCaseIdx);
  // Strip // line comments before scanning so explanatory prose (which
  // legitimately names the banned systems to document the guarantee) does
  // not trip the scan — only executable code references matter here.
  const block = rawBlock.replace(/\/\/.*$/gm, "");
  const bannedPatterns = [
    /zerobounce/i,
    /\bghl[-_]/i,
    /campaign-engine/i,
    /sequence-worker/i,
    /outreach/i,
    /provider-context/i,
    /enrichment-factory/i,
    /live-execution/i,
    /live-worker/i,
    /cro03c/i,
    /apollo/i,
    /outscraper/i,
    /openai/i,
    /serper/i,
  ];
  const hit = bannedPatterns.find((re) => re.test(block));
  if (hit) {
    fail(`free-enrichment-lane case block matches banned pattern ${hit} — it must remain free-only`);
  } else {
    ok("free-enrichment-lane case block contains no paid-provider/ZeroBounce/GHL/sequence/campaign/outreach reference");
  }
  const allowedImportRe = /await import\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  const imports: string[] = [];
  while ((m = allowedImportRe.exec(block))) imports.push(m[1]);
  const allowlist = new Set(["./feature-flags", "../db", "drizzle-orm", "./dbpr", "./free-enrichment-lane"]);
  for (const imp of imports) {
    if (!allowlist.has(imp)) {
      fail(`free-enrichment-lane case block imports "${imp}", which is outside the allowlist ${JSON.stringify([...allowlist])}`);
    } else {
      ok(`free-enrichment-lane case block import "${imp}" is allowlisted`);
    }
  }
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
