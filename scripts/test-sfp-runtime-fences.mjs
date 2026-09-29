import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSfpRuntimeFence, sfpAttestationMatchesRuntimeFence } from "../server/services/cro03/sfp-runtime-fence.ts";
import { buildSfpQueueNamespace } from "../server/services/cro03/sfp-queue-namespace.ts";

let checks = 0;
function check(value, message) {
  assert.equal(value, true, message);
  checks++;
}

const base = {
  releaseSha: "a".repeat(40),
  deploymentIdentity: "prod-deploy-1",
  environmentIdentity: "production",
  processIdentity: "ordinal:0",
  processId: 123,
  queueTopologyHash: "topology-a",
};
const fence = buildSfpRuntimeFence(base);
assert.ok(fence, "complete runtime identity creates a fence");
checks++;

const attestation = {
  artifactSha: fence.artifactSha,
  deploymentIdentity: fence.deploymentIdentity,
  environmentIdentity: fence.environmentIdentity,
  workerIdentities: [fence.processIdentity],
  queueTopologyHash: fence.queueTopologyHash,
};
check(sfpAttestationMatchesRuntimeFence(fence, attestation), "matching release/deployment/environment/topology/worker passes");
for (const [field, value] of [
  ["artifactSha", "b".repeat(40)],
  ["deploymentIdentity", "other-deploy"],
  ["environmentIdentity", "development"],
  ["queueTopologyHash", "other-topology"],
  ["workerIdentities", ["other-worker"]],
]) {
  check(!sfpAttestationMatchesRuntimeFence(fence, { ...attestation, [field]: value }), `${field} mismatch is rejected`);
}
check(!buildSfpRuntimeFence({ ...base, releaseSha: "short" }), "invalid release SHA fails closed");
check(!buildSfpRuntimeFence({ ...base, deploymentIdentity: "" }), "missing deployment identity fails closed");
check(buildSfpRuntimeFence({ ...base, processIdentity: null })?.processIdentity === "process:123", "worker identity fallback matches heartbeat convention");

const namespaceInput = {
  queueName: "sfp-continuous-discovery",
  environmentIdentity: "production",
  deploymentIdentity: "prod-deploy-1",
  releaseSha: "a".repeat(40),
  queueTopologyHash: "topology-a",
};
const namespace = buildSfpQueueNamespace(namespaceInput);
assert.match(namespace, /^liberty-sfp-[a-f0-9]{20}$/);
checks++;
check(buildSfpQueueNamespace(namespaceInput) === namespace, "same deployment identity creates a stable queue namespace");
check(buildSfpQueueNamespace({ ...namespaceInput, releaseSha: "b".repeat(40) }) !== namespace, "new release gets an isolated SFP queue namespace");
check(buildSfpQueueNamespace({ ...namespaceInput, deploymentIdentity: "prod-deploy-2" }) !== namespace, "new deployment gets an isolated SFP queue namespace");
check(buildSfpQueueNamespace({ ...namespaceInput, queueTopologyHash: "topology-b" }) !== namespace, "changed worker topology gets an isolated SFP queue namespace");
check(buildSfpQueueNamespace({ ...namespaceInput, queueName: "enrichment" }) === undefined, "non-SFP queues keep their legacy namespace");
assert.throws(() => buildSfpQueueNamespace({ ...namespaceInput, deploymentIdentity: " " }), /SFP_QUEUE_DEPLOYMENT_IDENTITY_REQUIRED/);
checks++;
assert.throws(() => buildSfpQueueNamespace({ ...namespaceInput, queueTopologyHash: " " }), /SFP_QUEUE_TOPOLOGY_IDENTITY_REQUIRED/);
checks++;
assert.throws(() => buildSfpQueueNamespace({ ...namespaceInput, releaseSha: "short" }), /SFP_QUEUE_RELEASE_IDENTITY_REQUIRED/);
checks++;
check(buildSfpQueueNamespace({ ...namespaceInput, environmentIdentity: "development", releaseSha: "" })?.startsWith("liberty-sfp-"), "development can run an explicitly unreleased SFP queue namespace");

const queueManagerSource = readFileSync("server/services/queue-manager.ts", "utf8");
check((queueManagerSource.match(/prefix: this\.queuePrefix\(config\.name\)/g) ?? []).length === 2, "both SFP Queue and Worker use the generation-scoped queue namespace");
check(queueManagerSource.includes("this.processLastCompletedAt.get(config.name)") && queueManagerSource.includes("lastRetainedRedisCompletedAt"), "process-local completion and Redis-retained history are reported as separate fields");
check(queueManagerSource.includes("this.readyWorkers.has(queueName) && worker.isRunning()"), "worker capability requires ready and running state");
const providerOperationsSource = readFileSync("server/services/cro03/sfp-provider-operations.ts", "utf8");
check(providerOperationsSource.includes("getCurrentSfpRuntimeFence()") && providerOperationsSource.includes("worker_identities @>"), "paid provider gates require the current process in the attested fleet");
const validationSource = readFileSync("server/services/cro03/cohort-validation.ts", "utf8");
check(validationSource.includes("const runtimeFence = await getCurrentSfpRuntimeFence()"), "legacy validation admission preview uses the same runtime fence");
const leadOpsSource = readFileSync("server/routes/lead-ops.ts", "utf8");
check(leadOpsSource.includes("no live runtime attestation matches this release, deployment, topology, and worker") && leadOpsSource.includes("worker_identities @>"), "CRM admission status reports and enforces the exact worker attestation");
const fleetSource = readFileSync("server/services/cro03/runtime-fleet-snapshot.ts", "utf8");
check(fleetSource.includes("AND worker_identities @> ${JSON.stringify(logicalWorkers)}::jsonb") && fleetSource.includes("jsonb_array_length(worker_identities)=${logicalWorkers.length}"), "fleet diagnostics only report an attestation matching the observed worker set");

console.log(`SFP runtime-generation fences: ${checks}/${checks} checks passed`);
