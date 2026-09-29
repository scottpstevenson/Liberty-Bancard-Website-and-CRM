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
