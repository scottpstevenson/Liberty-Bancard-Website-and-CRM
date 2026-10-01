/**
 * Runtime-attestation identity shared by SFP disposable-DB certifications.
 * Call only after the script's disposable-database guard has passed.
 */
export async function getSfpRuntimeTestIdentity() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("SFP_RUNTIME_TEST_IDENTITY_REQUIRES_NODE_ENV_TEST");
  }
  if (!/^[0-9a-f]{40}$/i.test(process.env.RELEASE_SHA?.trim() ?? "")) {
    process.env.RELEASE_SHA = "a".repeat(40);
  }
  if (!process.env.REPL_DEPLOYMENT_ID?.trim()) {
    process.env.REPL_DEPLOYMENT_ID = `sfp-cert-deployment:${process.pid}`;
  }
  if (!process.env.PROCESS_IDENTITY?.trim()) {
    process.env.PROCESS_IDENTITY = `sfp-cert-worker:${process.pid}`;
  }
  const { getCro03cQueueTopologyHash } = await import("../../server/services/queue-manager");
  return {
    artifactSha: process.env.RELEASE_SHA,
    deploymentIdentity: process.env.REPL_DEPLOYMENT_ID,
    environmentIdentity: process.env.NODE_ENV,
    processIdentity: process.env.PROCESS_IDENTITY,
    queueTopologyHash: getCro03cQueueTopologyHash(),
  };
}

/** Select the current disposable process release through the normal audited
 * operator API. A missing private test administrator is created as an ordinary
 * users row; this helper never inserts owner or selector authority rows. */
export async function selectSfpRuntimeTestRelease(actorId: string) {
  const identity = await getSfpRuntimeTestIdentity();
  const artifactSha = identity.artifactSha!.toLowerCase();
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  const {
    getSfpRuntimeReleaseSelectionStatus,
    selectCurrentSfpRuntimeRelease,
  } = await import("../../server/services/cro03/sfp-provider-operations");
  const actorEmail = `${actorId.replace(/[^a-z0-9._+-]/gi, "-").slice(0, 48)}@cert.invalid`;
  await db.execute(sql`
    INSERT INTO users (id,email,first_name,last_name,role)
    VALUES (${actorId},${actorEmail},'SFP Runtime','Certification Admin','admin')
    ON CONFLICT (id) DO NOTHING
  `);
  const actor = (await db.execute(sql`
    SELECT id FROM users WHERE id=${actorId} AND role='admin'
  `) as any)?.rows?.[0];
  if (!actor) throw new Error("SFP_RUNTIME_TEST_RELEASE_REQUIRES_PERSISTED_ADMIN");

  const prior = await getSfpRuntimeReleaseSelectionStatus();
  if (!prior.currentReleaseSelected) {
    await selectCurrentSfpRuntimeRelease({
      actorId,
      expectedPreviousArtifactSha: prior.selectedRelease?.artifactSha ?? null,
      expectedPreviousSelectionVersion: prior.selectedRelease?.selectionVersion ?? null,
      publisherVerifiedArtifactSha: artifactSha,
      publisherVerifiedDeploymentIdentity: identity.deploymentIdentity!,
      verificationReference: `https://certification.invalid/sfp-publisher-release/${artifactSha}`,
    });
  }
  const selected = await getSfpRuntimeReleaseSelectionStatus();
  if (!selected.currentReleaseSelected ||
      selected.selectedRelease?.publisherVerifiedArtifactSha !== artifactSha ||
      selected.selectedRelease?.publisherVerifiedDeploymentIdentity !== identity.deploymentIdentity) {
    throw new Error("SFP_RUNTIME_TEST_RELEASE_SELECTION_DID_NOT_MATCH_CURRENT_PROCESS");
  }
  return selected;
}
