export interface SfpRuntimeFence {
  artifactSha: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  processIdentity: string;
  queueTopologyHash: string;
}

export const SFP_RUNTIME_OWNER_LEASE_MS = 2 * 60_000;

/** Derive the current deployment/process identity used by durable SFP ownership. */
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

/** Build the identity tuple persisted with each durable SFP owner/job lease. */
export function buildSfpRuntimeFence(input: {
  releaseSha?: string | null;
  deploymentIdentity?: string | null;
  environmentIdentity?: string | null;
  processIdentity?: string | null;
  processId: number;
  queueTopologyHash: string;
}): SfpRuntimeFence | null {
  const artifactSha = input.releaseSha?.trim().toLowerCase() ?? "";
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
    queueTopologyHash: input.queueTopologyHash.trim().toLowerCase(),
  };
}

export interface PersistedSfpRuntimeOwner {
  artifactSha: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  queueTopologyHash: string;
  leaseExpiresAt: string | Date;
  revokedAt?: string | Date | null;
}

export type SfpAuthorizedRelease = Pick<
  SfpRuntimeFence,
  "artifactSha" | "deploymentIdentity" | "environmentIdentity" | "queueTopologyHash"
>;

export type SfpRuntimeOwnerDecision =
  | "renew_current"
  | "acquire_selected_release"
  | "release_not_selected";

export function sameSfpRuntimeRelease(
  left: SfpAuthorizedRelease,
  right: SfpAuthorizedRelease,
): boolean {
  return left.artifactSha === right.artifactSha &&
    left.deploymentIdentity === right.deploymentIdentity &&
    left.environmentIdentity === right.environmentIdentity &&
    left.queueTopologyHash === right.queueTopologyHash;
}

/**
 * The durable release selector, not owner-row absence/expiry/revocation,
 * decides whether a process may acquire ownership. A selected process may
 * establish a new owner epoch when the prior lease is gone; an unselected
 * process may never acquire merely because the row is absent or expired.
 */
export function decideSfpRuntimeOwnerClaim(
  current: PersistedSfpRuntimeOwner | null,
  candidate: SfpRuntimeFence,
  nowMs: number,
  selectedRelease: SfpAuthorizedRelease | null,
): SfpRuntimeOwnerDecision {
  if (!selectedRelease || !sameSfpRuntimeRelease(selectedRelease, candidate)) {
    return "release_not_selected";
  }
  if (!current) return "acquire_selected_release";
  const sameDeployment = sameSfpRuntimeRelease(current, candidate);
  const live = Date.parse(String(current.leaseExpiresAt)) > nowMs;
  if (sameDeployment && !current.revokedAt && live) return "renew_current";
  return "acquire_selected_release";
}
