import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyReadyHeldBridgeOutcome,
  classifyReadyHeldBridgeError,
  drainClaimedReadyHeldIntents,
} from "../server/services/cro03/sfp-ready-held-consumer-contract";

const claims = [1, 2, 3, 4, 5].map((n) => ({
  id: `claim-${n}`,
  stagingIntentId: `intent-${n}`,
  claimToken: `token-${n}`,
  attemptCount: n === 5 ? 5 : 1,
  runtimeOwnerEpoch: 1,
  runtimeOwnerToken: "owner-token",
  runtimeDeploymentIdentity: "deployment-test",
  runtimeEnvironmentIdentity: "test",
  runtimeArtifactSha: "a".repeat(40),
  runtimeProcessIdentity: "process-test",
  runtimeQueueTopologyHash: "b".repeat(64),
}));

assert.equal(classifyReadyHeldBridgeOutcome({ status: "created" }).state, "completed");
assert.equal(classifyReadyHeldBridgeOutcome({ status: "already_bridged" }).state, "completed");
assert.equal(classifyReadyHeldBridgeOutcome({ status: "left_held", heldReason: "STALE_RECEIPT" }).state, "held");
assert.equal(classifyReadyHeldBridgeError(new Error("SFP_PACKAGE_SEQUENCE_NOT_PAUSED:active"), 1).state, "held");
assert.equal(classifyReadyHeldBridgeError(new Error("temporary database timeout"), 1).state, "retry");
assert.equal(classifyReadyHeldBridgeError(new Error("temporary database timeout"), 5).state, "dead_letter");

const attempted: string[] = [];
const persisted: string[] = [];
const summary = await drainClaimedReadyHeldIntents(claims, {
  actorId: "admin:independent-operator",
  bridge: async (intentId) => {
    attempted.push(intentId);
    if (intentId === "intent-2") throw new Error("SFP_BRIDGE_BLOCKED:current eligibility changed");
    if (intentId === "intent-3") throw new Error("temporary database timeout");
    if (intentId === "intent-4") return { status: "left_held", heldReason: "NO_VALIDATED_EMAIL" };
    if (intentId === "intent-5") throw new Error("temporary database timeout");
    return { status: "created", contactId: 10, sequenceEnrollmentId: 20 };
  },
  persist: async (claim, disposition) => {
    persisted.push(`${claim.stagingIntentId}:${disposition.state}`);
    if (claim.stagingIntentId === "intent-4") throw new Error("ledger connection lost");
  },
});

assert.deepEqual(attempted, claims.map((claim) => claim.stagingIntentId), "a failed intent must not stop the batch drain");
assert.deepEqual(persisted, [
  "intent-1:completed",
  "intent-2:held",
  "intent-3:retry",
  "intent-4:held",
  "intent-5:dead_letter",
]);
assert.deepEqual(summary, {
  attempted: 5,
  completed: 1,
  held: 1,
  retrying: 1,
  deadLettered: 1,
  persistenceFailures: 1,
});

// Contract assertions intentionally inspect text rather than importing the
// DB-backed worker or server routes against the shared development database.
const worker = readFileSync("server/services/cro03/sfp-ready-held-consumer.ts", "utf8");
const bridge = readFileSync("server/services/cro03/sfp-ready-held-consumer.ts", "utf8");
const canonicalBridge = readFileSync("server/services/cro03/sfp-enrollment-bridge.ts", "utf8");
const queueManager = readFileSync("server/services/queue-manager.ts", "utf8");
const routes = readFileSync("server/routes/lead-ops.ts", "utf8");
const readyHeldRoutes = readFileSync("server/routes/sfp-ready-held-operator.ts", "utf8");
const panel = readFileSync("client/src/components/lead-ops/SouthFloridaProspectingPanel.tsx", "utf8");
const operatorUi = readFileSync("client/src/pages/dashboard/LeadOpsCenter.tsx", "utf8");
assert.match(worker, /FOR UPDATE SKIP LOCKED/);
assert.match(worker, /claim_token=gen_random_uuid\(\)/);
assert.match(worker, /getPauseState/);
assert.match(worker, /runtime_owner_epoch=/);
assert.match(worker, /assertSfpRuntimeJobLease/);
assert.match(bridge, /bridgeReadyHeldIntentToPausedEnrollment/);
assert.match(canonicalBridge, /assertSfpRuntimeJobLease/);
assert.match(queueManager, /startSfpRuntimeOwnerHeartbeat/);
assert.match(readyHeldRoutes, /\/api\/lead-ops\/sfp\/program\/campaign-staging-schedule", requireRole\("admin"\)/);
assert.match(readyHeldRoutes, /\/api\/lead-ops\/sfp\/ready-held-consumer\/run", requireRole\("admin"\)/);
assert.match(readyHeldRoutes, /\/api\/lead-ops\/sfp\/ready-held-consumer\/items\/:id\/retry", requireRole\("admin"\)/);
assert.match(routes, /REVIEWER_MUST_BE_INDEPENDENT/);
assert.match(routes, /validation_expires_at/);
assert.match(operatorUi, /for \(const row of selectedRows\)/);
assert.match(operatorUi, /named-email-eligibility-reviews\/\$\{row\.eligibility_id\}/);
assert.match(operatorUi, /bulkReviewResult\.filter\(\(result\) => !result\.ok\)/);
assert.match(panel, /apiRequest\("POST", "\/api\/lead-ops\/sfp\/ready-held-consumer\/run"/);
assert.match(panel, /Process up to 25 ready-held intents \(paused only\)/);
assert.match(panel, /Retry after review/);

console.log("SFP ready-held consumer contract: PASS");