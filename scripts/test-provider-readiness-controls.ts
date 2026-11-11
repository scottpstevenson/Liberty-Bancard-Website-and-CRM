/**
 * Deterministic BT-10 kill-line checks. No database, queue, secrets, or
 * network transport is touched by this suite.
 */
import assert from "node:assert/strict";
import {
  assertProviderActivation,
  validateProviderManifest,
} from "../server/services/provider-manifest";
import {
  decideMarketingEmailValidation,
  hashEmailToken,
} from "../server/services/provider-readiness-decision";

const email = "example@merchant.test";
const token = hashEmailToken(email)!;
const now = new Date("2026-08-25T12:00:00.000Z");
const positive = decideMarketingEmailValidation(email, {
  emailStatus: "valid",
  emailTokenHash: token,
  subjectGeneration: 3,
  evidenceGeneration: 3,
  verifiedAt: new Date(now.getTime() - 60_000),
  providerOutcome: "valid",
}, now);
assert.equal(positive.allowed, true, "only fresh current valid evidence may allow marketing");

for (const outcome of [
  "unknown", "unverified", "catch_all", "risky", "not_configured",
  "budget_blocked", "circuit_blocked", "rate_limited", "timeout",
  "transport", "parse_error", "ambiguous_billing", "invalid",
]) {
  const decision = decideMarketingEmailValidation(email, {
    emailStatus: outcome,
    emailTokenHash: token,
    subjectGeneration: 3,
    evidenceGeneration: 3,
    verifiedAt: new Date(now.getTime() - 60_000),
    providerOutcome: outcome,
  }, now);
  assert.equal(decision.allowed, false, `${outcome} must not authorize marketing`);
}

assert.equal(decideMarketingEmailValidation(email, {
  emailStatus: "valid", emailTokenHash: "wrong", subjectGeneration: 3,
  evidenceGeneration: 3, verifiedAt: now, providerOutcome: "valid",
}, now).allowed, false, "mismatched token must block");
assert.equal(decideMarketingEmailValidation(email, {
  emailStatus: "valid", emailTokenHash: token, subjectGeneration: 3,
  evidenceGeneration: 2, verifiedAt: now, providerOutcome: "valid",
}, now).allowed, false, "mismatched generation must block");
assert.equal(decideMarketingEmailValidation(email, {
  emailStatus: "valid", emailTokenHash: token, subjectGeneration: 3,
  evidenceGeneration: 3, verifiedAt: new Date(now.getTime() - 181 * 24 * 60 * 60 * 1000),
  providerOutcome: "valid",
}, now).allowed, false, "stale evidence must block");

assert.equal(validateProviderManifest().ok, true, "every in-scope source must have a valid manifest row");
assert.throws(
  () => assertProviderActivation({ sourceId: "apollo", caller: "server/services/cro03/enrichment-factory.ts" }),
  /(?:explicit approval|Unapproved provider caller)/,
  "an approved caller and configured paid secret alone must not activate a provider",
);

// Recovery replay contract (source-level; this suite never opens a database or queue). recoverValidationIntents
// selects intents whose worker died mid-claim ('processing' with an expired lease), so the enqueue step must accept
// them, and it must not let a retained finished BullMQ job with the same id swallow the replay.
{
  const { readFileSync } = await import("node:fs");
  const readiness = readFileSync("server/services/provider-readiness-control.ts", "utf8");
  const start = readiness.indexOf("export async function enqueueValidationIntent");
  const end = readiness.indexOf("export async function enqueueCurrentValidationIntent");
  assert.ok(start > 0 && end > start, "enqueueValidationIntent must exist");
  const enqueue = readiness.slice(start, end);
  assert.match(
    enqueue,
    /state='pending' OR \(state='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<NOW\(\)\)/,
    "an expired-lease processing intent must be enqueueable for recovery",
  );
  assert.doesNotMatch(
    enqueue,
    /state='processing' AND lease_expires_at IS NULL|state='processing'\)(?! AND lease)/,
    "a processing intent with a live or missing lease must never be re-enqueued",
  );
  assert.match(enqueue, /queue\.getJob\(jobId\)/, "a retained job with the same id must be inspected before add");
  assert.match(
    enqueue,
    /retainedState === "completed" \|\| retainedState === "failed"[\s\S]*?retained\.remove\(\)/,
    "only a finished (completed/failed) retained job may be dropped",
  );
  assert.ok(
    enqueue.indexOf("retained.remove()") < enqueue.indexOf('queue.add("validation-intent"'),
    "the finished job must be removed before the replay is added",
  );
}

console.log("Provider readiness controls: PASS");