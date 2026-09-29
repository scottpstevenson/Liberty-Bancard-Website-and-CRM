import { createHash } from "node:crypto";

const SFP_GENERATION_SCOPED_QUEUES = new Set([
  "sfp-campaign-staging",
  "sfp-free-classification",
  "sfp-continuous-discovery",
  "sfp-continuous-validation",
  "sfp-attestation-refresh",
]);

/**
 * Build the Redis prefix for repeatable SFP queues. Including the deployment,
 * release, and capability topology prevents a stale process sharing REDIS_URL
 * from claiming this deployment's ticks. Non-SFP queues keep their existing
 * namespace so durable queues and their current Redis data remain compatible.
 */
export function buildSfpQueueNamespace(input: {
  queueName: string;
  environmentIdentity: string;
  deploymentIdentity: string;
  releaseSha: string;
  queueTopologyHash: string;
}): string | undefined {
  if (!SFP_GENERATION_SCOPED_QUEUES.has(input.queueName)) return undefined;
  if (!input.deploymentIdentity.trim()) throw new Error("SFP_QUEUE_DEPLOYMENT_IDENTITY_REQUIRED");
  if (!input.queueTopologyHash.trim()) throw new Error("SFP_QUEUE_TOPOLOGY_IDENTITY_REQUIRED");
  const releaseSha = input.releaseSha.trim();
  if (input.environmentIdentity.trim() === "production" && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error("SFP_QUEUE_RELEASE_IDENTITY_REQUIRED");
  }

  const digest = createHash("sha256")
    .update([
      input.environmentIdentity.trim() || "unknown",
      input.deploymentIdentity.trim(),
      releaseSha || "unreleased",
      input.queueTopologyHash.trim(),
    ].join("\0"))
    .digest("hex")
    .slice(0, 20);
  return `liberty-sfp-${digest}`;
}
