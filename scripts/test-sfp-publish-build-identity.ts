import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  createSfpPublishBuildIdentity,
  readSfpPublishBuildIdentity,
  resolveRoutineSfpDeploymentIdentity,
} from "../shared/sfp-publish-build-identity";
import {
  buildSfpRuntimeFence,
  decideSfpRuntimeOwnerClaim,
} from "../server/services/cro03/sfp-runtime-fence";

const sha = "a".repeat(40);
const first = createSfpPublishBuildIdentity(sha, randomUUID());
const second = createSfpPublishBuildIdentity(sha, randomUUID());
assert.notEqual(first.buildId, second.buildId, "same-SHA builds have different identities");
assert.notEqual(first.deploymentIdentity, second.deploymentIdentity);
assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "artifact identity round-trips");
assert.throws(() => createSfpPublishBuildIdentity("unset", randomUUID()));
assert.throws(() => createSfpPublishBuildIdentity(sha, "ordinal:0"));
assert.throws(() => createSfpPublishBuildIdentity(sha, sha));

const identityInput = {
  releaseSha: sha,
  publishArtifactSha: first.artifactSha,
  publishBuildId: first.buildId,
};
assert.equal(readSfpPublishBuildIdentity(identityInput)?.deploymentIdentity, first.deploymentIdentity);
assert.equal(resolveRoutineSfpDeploymentIdentity(identityInput), first.deploymentIdentity);
for (const malformed of [
  { publishBuildId: "" },
  { publishBuildId: "unset" },
  { publishArtifactSha: "" },
  { publishArtifactSha: "b".repeat(40) },
  { releaseSha: "b".repeat(40) },
  { releaseSha: undefined },
]) {
  assert.equal(readSfpPublishBuildIdentity({ ...identityInput, ...malformed }), null);
  assert.equal(resolveRoutineSfpDeploymentIdentity({
    ...identityInput, ...malformed, platformDeploymentId: "must-not-bypass-broken-artifact",
  }), null);
}
assert.equal(resolveRoutineSfpDeploymentIdentity({ releaseSha: sha }), null);
assert.equal(resolveRoutineSfpDeploymentIdentity({ platformDeploymentId: "real-explicit-platform-id" }),
  "real-explicit-platform-id");

function fence(deploymentIdentity: string) {
  const value = buildSfpRuntimeFence({
    releaseSha: sha, deploymentIdentity, environmentIdentity: "production",
    processIdentity: "replica:1", processId: 1, queueTopologyHash: "same-topology",
  });
  assert.ok(value);
  return value;
}
const oldFence = fence(first.deploymentIdentity);
const newFence = fence(second.deploymentIdentity);
const newOwner = {
  ...newFence, leaseExpiresAt: new Date(2_000_000).toISOString(), revokedAt: null,
};
assert.equal(decideSfpRuntimeOwnerClaim(null, oldFence, 1_000_000, null), "release_not_selected");
assert.equal(decideSfpRuntimeOwnerClaim(null, oldFence, 1_000_000, newFence), "release_not_selected");
assert.equal(decideSfpRuntimeOwnerClaim(newOwner, oldFence, 1_000_000, newFence), "release_not_selected");
assert.equal(decideSfpRuntimeOwnerClaim({ ...newOwner, leaseExpiresAt: new Date(0) },
  oldFence, 1_000_000, newFence), "release_not_selected");
assert.equal(decideSfpRuntimeOwnerClaim(null, newFence, 1_000_000, newFence), "acquire_selected_release");
assert.equal(decideSfpRuntimeOwnerClaim(newOwner, newFence, 1_000_000, newFence), "renew_current");

// Compile the actual runtime reader with the same defines as the production
// build. Stub only its unused queue import: this test must not load db/workers.
const bundled = await build({
  stdin: {
    contents: 'import { getCurrentRoutineSfpDeploymentIdentity } from "./server/services/cro03/sfp-runtime-fence"; console.log(JSON.stringify(getCurrentRoutineSfpDeploymentIdentity()));',
    resolveDir: process.cwd(), loader: "ts",
  },
  platform: "node", format: "cjs", bundle: true, write: false,
  define: {
    "process.env.SFP_PUBLISH_BUILD_ID": JSON.stringify(first.buildId),
    "process.env.SFP_PUBLISH_ARTIFACT_SHA": JSON.stringify(first.artifactSha),
  },
  plugins: [{
    name: "deny-queue-db-import",
    setup(builder) {
      builder.onResolve({ filter: /queue-manager$/ }, () => ({ path: "unused-queue", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: 'throw new Error("Unexpected queue/database import");', loader: "js",
      }));
    },
  }],
});
function runReplica(releaseSha: string): unknown {
  return JSON.parse(execFileSync(process.execPath, ["-e", bundled.outputFiles[0].text], {
    encoding: "utf8",
    env: {
      RELEASE_SHA: releaseSha,
      // Compiled identity must win over ambient variables/configuration.
      SFP_PUBLISH_BUILD_ID: second.buildId,
      SFP_PUBLISH_ARTIFACT_SHA: "b".repeat(40),
      REPL_DEPLOYMENT_ID: "ambient-override",
    },
  }));
}
assert.equal(runReplica(sha), first.deploymentIdentity);
assert.equal(runReplica(sha), first.deploymentIdentity, "replicas share the compiled artifact identity");
assert.equal(runReplica("b".repeat(40)), null, "runtime SHA must match the compiled artifact");
assert.equal(runReplica("unset"), null);

if (process.argv.includes("--artifact")) {
  const actual = JSON.parse(readFileSync("dist/sfp-publish-build.json", "utf8"));
  const sourceSha = readFileSync("dist/RELEASE_SHA", "utf8").trim();
  const { builtAt, ...recordedIdentity } = actual;
  assert.equal(new Date(builtAt).toISOString(), builtAt);
  assert.deepEqual(createSfpPublishBuildIdentity(sourceSha, actual.buildId), recordedIdentity);
  const serverBundle = readFileSync("dist/index.cjs", "utf8");
  assert.ok(serverBundle.includes(actual.buildId), "server contains the exact recorded build UUID");
  assert.ok(serverBundle.includes(actual.artifactSha), "server contains the exact recorded source SHA");
  assert.ok(serverBundle.includes(actual.builtAt), "server contains the immutable build timestamp");
}
console.log("SFP publish-build identity: artifact binding, replica consistency, missing/malformed rejection, ambient override resistance and same-SHA retired-build fences PASS");