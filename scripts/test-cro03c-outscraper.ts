import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  executeCro03cOutscraper,
  searchOutscraper,
} from "../server/services/sdr/outscraper";

const source = readFileSync("server/services/sdr/outscraper.ts", "utf8");
assert.match(source, /consideredResultLimit > 5/);
assert.match(source, /await assertCro03cAuthorityBeforeIo\(context\);[\s\S]*?response = await \(options\.fetchOverride \?\? fetch\)/);
assert.match(source, /CRO03_OUTSCRAPER_LEGACY_CONTEXT_DENIED/);
assert.doesNotMatch(
  source.match(/function redactedCro03cEvidence[\s\S]*?\n}\n\nfunction ambiguousCro03cEvidence/)?.[0] ?? "",
  /(?:email|phone|rawData):\s*business/,
);

await assert.rejects(
  searchOutscraper("legacy"),
  (error: any) => error?.message === "CRO03_OUTSCRAPER_LEGACY_CONTEXT_DENIED",
);

const oldKey = process.env.OUTSCRAPER_API_KEY;
process.env.OUTSCRAPER_API_KEY = "test-key";
let transportCalls = 0;
const context = {
  kind: "cro03c_live" as const, provider: "outscraper" as const, activationRevision: 1,
  generationId: "generation", commandId: "command", runId: "run", stageKey: "outscraper",
  claimToken: "claim", executionFence: 1, runtimeAttestationId: "attestation",
  expiresAt: new Date(Date.now() + 60_000), noOutboundSnapshotHash: "a".repeat(64),
  caller: "server/services/cro03/live-provider-executors.ts",
};
const invalidPrice = Object.freeze({
  provider: "outscraper" as const, query: "florist miami", region: "US" as const,
  consideredResultLimit: 5, justification: Object.freeze({ reason: "strong anchor" }),
  amountMicros: -1, reservedUnits: 5,
});
await assert.rejects(
  executeCro03cOutscraper(context, invalidPrice, {
    fetchOverride: async () => {
      transportCalls++;
      return new Response("[]");
    },
  }),
  (error: any) => error?.message === "CRO03C_PRICE_SCHEDULE_UNKNOWN",
);
assert.equal(transportCalls, 0, "unknown pricing must block before injected transport");
if (oldKey === undefined) delete process.env.OUTSCRAPER_API_KEY;
else process.env.OUTSCRAPER_API_KEY = oldKey;

console.log("CRO-03C Outscraper injected no-network controls: PASS");