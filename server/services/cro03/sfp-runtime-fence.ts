export interface SfpRuntimeFence {
  artifactSha: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  processIdentity: string;
  queueTopologyHash: string;
}

/** Derive the current process's fence using the same topology hash as fleet attestation. */
export async function getCurrentSfpRuntimeFence(): Promise<SfpRuntimeFence | null> {
  const { getCro03cQueueTopologyHash } = await import("../queue-manager");
  return buildSfpRuntimeFence({
    releaseSha: process.env.RELEASE_SHA,
    deploymentIdentity: process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID,
    environmentIdentity: process.env.NODE_ENV,
    processIdentity: process.env.PROCESS_IDENTITY,
    processId: process.pid,
    queueTopologyHash: getCro03cQueueTopologyHash(),
  });
}

/**
 * Build the identity tuple a live paid SFP call must match.
 * Keeping this separate makes it possible to prove a stale process cannot
 * borrow another release's short-lived attestation.
 */
export function buildSfpRuntimeFence(input: {
  releaseSha?: string | null;
  deploymentIdentity?: string | null;
  environmentIdentity?: string | null;
  processIdentity?: string | null;
  processId: number;
  queueTopologyHash: string;
}): SfpRuntimeFence | null {
  const artifactSha = input.releaseSha?.trim() ?? "";
  const deploymentIdentity = input.deploymentIdentity?.trim() ?? "";
  const environmentIdentity = input.environmentIdentity?.trim() ?? "";
  const processIdentity = input.processIdentity?.trim() || `process:${input.processId}`;
  if (!/^[0-9a-f]{40}$/i.test(artifactSha) || !deploymentIdentity || !environmentIdentity || !input.queueTopologyHash) {
    return null;
  }
  return {
    artifactSha,
    deploymentIdentity,
    environmentIdentity,
    processIdentity,
    queueTopologyHash: input.queueTopologyHash,
  };
}

/** Pure equivalent of the attestation SQL fence, used by certification. */
export function sfpAttestationMatchesRuntimeFence(
  fence: SfpRuntimeFence,
  attestation: {
    artifactSha: string;
    deploymentIdentity: string;
    environmentIdentity: string;
    workerIdentities: unknown;
    queueTopologyHash: string;
  },
): boolean {
  const identities = Array.isArray(attestation.workerIdentities)
    ? attestation.workerIdentities.map(String)
    : [];
  return attestation.artifactSha === fence.artifactSha &&
    attestation.deploymentIdentity === fence.deploymentIdentity &&
    attestation.environmentIdentity === fence.environmentIdentity &&
    attestation.queueTopologyHash === fence.queueTopologyHash &&
    identities.includes(fence.processIdentity);
}
