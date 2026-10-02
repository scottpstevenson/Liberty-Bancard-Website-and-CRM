import { readSfpPublishBuildIdentity } from "./sfp-publish-build-identity";

/** Build time is embedded once, never minted by replicas or heartbeats. */
export function readSfpAutomaticPublish(input: {
  nodeEnv?: string;
  replitDeployment?: string;
  releaseSha?: string;
  publishArtifactSha?: string;
  publishBuildId?: string;
  publishBuiltAt?: string;
}) {
  if (input.nodeEnv !== "production" || input.replitDeployment !== "1") return null;
  const identity = readSfpPublishBuildIdentity(input);
  const builtAt = input.publishBuiltAt;
  if (!identity || !builtAt || !Number.isFinite(Date.parse(builtAt))
      || new Date(builtAt).toISOString() !== builtAt) return null;
  return { ...identity, builtAt };
}

/** A retired build cannot reselect itself, even after a manual rollback. */
export function assertSfpPublishMayAdvance(input: {
  builtAt: string;
  previousEnvironment: string | null;
  environment: string;
  previousSelectedAt: string | null;
  previousWasAutomatic?: boolean;
  latestBuiltAt: string | null;
  previouslySelected: boolean;
  ownerRevoked: boolean;
}) {
  if (input.ownerRevoked) throw new Error("SFP_PUBLISH_HANDOFF_OWNER_REVOKED");
  if (input.previousEnvironment && input.previousEnvironment !== input.environment) {
    throw new Error("SFP_PUBLISH_HANDOFF_ENVIRONMENT_MISMATCH");
  }
  if (input.previouslySelected) throw new Error("SFP_PUBLISH_HANDOFF_RETIRED_BUILD");
  // Legacy manual selections have no build timestamp: their selection time
  // is the conservative migration floor. New records use immutable build time.
  const floors = [
    input.latestBuiltAt,
    input.previousWasAutomatic ? null : input.previousSelectedAt,
  ].filter((value): value is string => value != null);
  for (const floor of floors) {
    if (!Number.isFinite(Date.parse(floor)) || Date.parse(input.builtAt) <= Date.parse(floor)) {
      throw new Error("SFP_PUBLISH_HANDOFF_BUILD_NOT_NEWER");
    }
  }
}