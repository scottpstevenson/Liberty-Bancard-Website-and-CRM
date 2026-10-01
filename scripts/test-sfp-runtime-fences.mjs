import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSfpRuntimeFence,
  decideSfpRuntimeOwnerClaim,
} from "../server/services/cro03/sfp-runtime-fence.ts";
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

check(!buildSfpRuntimeFence({ ...base, releaseSha: "short" }), "invalid release SHA fails closed");
check(!buildSfpRuntimeFence({ ...base, deploymentIdentity: "" }), "missing deployment identity fails closed");
check(buildSfpRuntimeFence({ ...base, processIdentity: null })?.processIdentity === "process:123", "worker identity fallback matches heartbeat convention");
const liveOwner = {
  artifactSha: fence.artifactSha,
  deploymentIdentity: fence.deploymentIdentity,
  environmentIdentity: fence.environmentIdentity,
  queueTopologyHash: fence.queueTopologyHash,
  leaseExpiresAt: new Date(2_000_000).toISOString(),
  revokedAt: null,
};
const selectedRelease = {
  artifactSha: fence.artifactSha,
  deploymentIdentity: fence.deploymentIdentity,
  environmentIdentity: fence.environmentIdentity,
  queueTopologyHash: fence.queueTopologyHash,
};
check(decideSfpRuntimeOwnerClaim(null, fence, 1_000_000, selectedRelease) === "acquire_selected_release", "only an explicitly selected release can establish the owner row");
check(decideSfpRuntimeOwnerClaim(liveOwner, fence, 1_000_000, selectedRelease) === "renew_current", "only a live matching selected owner is renewed");
check(decideSfpRuntimeOwnerClaim({ ...liveOwner, leaseExpiresAt: new Date(999_999).toISOString() }, fence, 1_000_000, selectedRelease) === "acquire_selected_release", "an expired selected-release lease gets a new owner epoch rather than being heartbeat-renewed");
check(decideSfpRuntimeOwnerClaim(null, fence, 1_000_000, null) === "release_not_selected", "an unselected process cannot claim even when the owner row is absent");
check(decideSfpRuntimeOwnerClaim({ ...liveOwner, leaseExpiresAt: new Date(999_999).toISOString() }, { ...fence, artifactSha: "b".repeat(40) }, 1_000_000, selectedRelease) === "release_not_selected", "an expired owner cannot authorize a retired artifact");
const nextRelease = { ...selectedRelease, artifactSha: "b".repeat(40), deploymentIdentity: "prod-deploy-2" };
check(decideSfpRuntimeOwnerClaim(liveOwner, { ...fence, artifactSha: "b".repeat(40), deploymentIdentity: "prod-deploy-2" }, 1_000_000, nextRelease) === "acquire_selected_release", "an audited current selector permits transfer to the exact next release");
check(decideSfpRuntimeOwnerClaim(liveOwner, { ...fence, deploymentIdentity: "other-deploy" }, 1_000_000, selectedRelease) === "release_not_selected", "deployment identity must match the currently selected tuple");

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
check(providerOperationsSource.includes("claimSfpRuntimeDeploymentOwner") && providerOperationsSource.includes("sfp_runtime_owner_authority"), "provider admission uses durable deployment ownership");
check(providerOperationsSource.includes("sfp_runtime_job_leases") && providerOperationsSource.includes("operation_claim_token"), "provider dispatch uses token/epoch-fenced job leases");
check(providerOperationsSource.includes("AND oa.lease_expires_at>clock_timestamp()") && providerOperationsSource.includes("AND jl.lease_expires_at>clock_timestamp()"), "owner and job renewal require their current live leases");
check(providerOperationsSource.includes("AND p.is_active=TRUE") && providerOperationsSource.includes("FOR UPDATE OF o,pc,a,oa,jl,r,i,p"), "Phase-A dispatch locks and verifies the active program");
check(!providerOperationsSource.includes("GREATEST(0") && !providerOperationsSource.includes("FOR UPDATE OF o,a"), "accounting rejects underflow and reconciliation avoids nullable outer-join locks");
check(!providerOperationsSource.includes("cro03c_runtime_attestations") && !providerOperationsSource.includes("worker_identities @>"), "routine SFP provider authority no longer consumes CRO03C attestations");
const validationSource = readFileSync("server/services/cro03/cohort-validation.ts", "utf8");
check(validationSource.includes("getSfpDeploymentOwnerReadiness") && !validationSource.includes("cro03c_runtime_attestations"), "legacy validation preview uses current durable owner readiness");
const leadOpsSource = readFileSync("server/routes/lead-ops.ts", "utf8");
check(leadOpsSource.includes("claimSfpRuntimeDeploymentOwner") && leadOpsSource.includes("getSfpDeploymentOwnerReadiness"), "candidate promotion and profile readiness use durable SFP ownership");
check(!leadOpsSource.slice(leadOpsSource.indexOf("/api/lead-ops/candidates/promotion-state"), leadOpsSource.indexOf("// ── Level 1 ROI cohort routes")).includes("cro03c_runtime_attestations"), "routine-SFP promotion status no longer queries CRO03C attestations");

console.log(`SFP runtime-generation fences: ${checks}/${checks} checks passed`);
