import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertCro03cOpenAiInputApproved } from "../server/services/cro03/live-provider-executors";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const source = readFileSync("server/services/cro03/live-provider-executors.ts", "utf8");
const readinessSource = readFileSync("server/services/provider-readiness-control.ts", "utf8");
const apolloSource = readFileSync("server/services/sdr/apollo.ts", "utf8");
const outscraperSource = readFileSync("server/services/sdr/outscraper.ts", "utf8");

const approvedShape = {
  provider: "openai" as const,
  amountMicros: 1,
  reservedUnits: 1,
  model: "gpt-test",
  modelHash: digest("gpt-test"),
  system: "reviewed system",
  systemPromptHash: digest("reviewed system"),
  prompt: "reviewed prompt",
  promptHash: digest("reviewed prompt"),
  maxCompletionTokens: 1,
};

assert.throws(
  () => assertCro03cOpenAiInputApproved(approvedShape),
  (error: any) => error?.message === "CRO03C_OPENAI_PROMPT_NOT_APPROVED",
);
assert.throws(
  () => assertCro03cOpenAiInputApproved({ ...approvedShape, promptHash: "0".repeat(64) }),
  (error: any) => error?.message === "CRO03C_OPENAI_HASH_MISMATCH",
);

assert.match(source, /executeApolloForCro03c/);
assert.doesNotMatch(source, /resolveApolloOrganizationForFrozenIdentity/);
assert.doesNotMatch(source, /max_tokens:/);
assert.match(source, /max_completion_tokens:\s*input\.maxCompletionTokens/);
assert.doesNotMatch(source, /data:\s*response\.data/);
assert.doesNotMatch(source, /error:\s*response\.error/);
assert.match(source, /CRO03C_OPENAI_PROMPT_NOT_APPROVED/);
// Paid provider receipts are operational metadata: only provider identifiers,
// hashes, and counts may cross this boundary.
assert.match(source, /organizationCount:\s*1/);
assert.match(source, /peopleCount:\s*response\.people\.length/);
assert.doesNotMatch(source, /organization:\s*response\.organization/);
assert.match(outscraperSource, /resultHashes:/);
assert.doesNotMatch(outscraperSource, /results:\s*results\.map/);

// Readiness uses the current shared contract but does not import the live
// executor (which would form a provider-executor-readiness cycle).
assert.match(readinessSource, /CRO03C_CURRENT_MIGRATION_HEAD/);
assert.doesNotMatch(readinessSource, /from ["']\.\/cro03\/live-execution["']/);
assert.match(readinessSource, /"claim" \| "pre_reservation" \| "pre_io"/);
assert.match(apolloSource, /const remainingUnits = resultCap - creditedUnits/);
assert.match(apolloSource, /per_page: Math\.min\(resultCap, remainingUnits\)/);

console.log("CRO-03C provider executor hardening: PASS");