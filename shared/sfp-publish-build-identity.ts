/**
 * A per-build identifier is not a Replit platform deployment ID or permission
 * to execute. It distinguishes two Publishes of the same source SHA. Selection
 * uses the audited published-artifact handoff in production, or explicit
 * publisher verification for manual selection. Durable authority still applies.
 */
export interface SfpPublishBuildIdentity {
  version: 1;
  artifactSha: string;
  buildId: string;
  deploymentIdentity: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSfpPublishBuildIdentity(
  artifactSha: string,
  buildId: string,
): SfpPublishBuildIdentity {
  const sha = artifactSha.trim().toLowerCase();
  const id = buildId.trim().toLowerCase();
  if (!SHA_PATTERN.test(sha)) throw new Error("SFP_PUBLISH_ARTIFACT_SHA_INVALID");
  if (!BUILD_ID_PATTERN.test(id)) throw new Error("SFP_PUBLISH_BUILD_ID_INVALID");
  return { version: 1, artifactSha: sha, buildId: id, deploymentIdentity: `publish-build:${id}` };
}

export function readSfpPublishBuildIdentity(input: {
  releaseSha?: string;
  publishArtifactSha?: string;
  publishBuildId?: string;
}): SfpPublishBuildIdentity | null {
  try {
    if (!input.publishArtifactSha || !input.publishBuildId || !input.releaseSha) return null;
    const identity = createSfpPublishBuildIdentity(input.publishArtifactSha, input.publishBuildId);
    return identity.artifactSha === input.releaseSha.trim().toLowerCase() ? identity : null;
  } catch {
    return null;
  }
}

/** No workspace fallback. A present but broken artifact fails closed. */
export function resolveRoutineSfpDeploymentIdentity(input: {
  releaseSha?: string;
  publishArtifactSha?: string;
  publishBuildId?: string;
  platformDeploymentId?: string;
}): string | null {
  if (input.publishArtifactSha !== undefined || input.publishBuildId !== undefined) {
    return readSfpPublishBuildIdentity(input)?.deploymentIdentity ?? null;
  }
  // Keep explicitly supplied real platform identities and isolated fixtures.
  // This is never inferred from REPL_ID or the source SHA.
  return input.platformDeploymentId?.trim() || null;
}