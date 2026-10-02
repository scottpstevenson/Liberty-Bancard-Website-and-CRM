import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";
import { readSfpAutomaticPublish, assertSfpPublishMayAdvance } from "../shared/sfp-publish-handoff";

await assertDisposableTestInfrastructure({ operation: "SFP publish handoff certification", requireRedis: false });
applyCertificationProviderDenyBoundary({ fatal: true });
const { db, pool } = await import("../server/db");
const { claimSfpRuntimeDeploymentOwner, renewSfpRuntimeDeploymentOwner,
  getSfpRuntimeReleaseSelectionStatus, selectCurrentSfpRuntimeRelease } =
  await import("../server/services/cro03/sfp-provider-operations");
const rows = (result: any): any[] => result.rows ?? result;
const base = Date.now() - 120_000;
const first = { sha: "a".repeat(40), id: randomUUID(), at: new Date(base).toISOString() };
const second = { sha: "b".repeat(40), id: randomUUID(), at: new Date(base + 1000).toISOString() };
const republish = { ...second, id: randomUUID(), at: new Date(base + 2000).toISOString() };
function deploy(build: typeof first) {
  // Explicit fixtures in the guarded disposable process, not production proof.
  process.env.NODE_ENV = "production";
  process.env.REPLIT_DEPLOYMENT = "1";
  process.env.RELEASE_SHA = build.sha;
  process.env.SFP_PUBLISH_ARTIFACT_SHA = build.sha;
  process.env.SFP_PUBLISH_BUILD_ID = build.id;
  process.env.SFP_PUBLISH_BUILT_AT = build.at;
}
async function eventCount() {
  return Number(rows(await db.execute(sql`SELECT count(*) AS n FROM sfp_runtime_release_selection_events`))[0].n);
}
async function unchangedControls() {
  const provider = rows(await db.execute(sql`SELECT to_jsonb(p) AS value FROM provider_controls p ORDER BY provider`));
  const settings = rows(await db.execute(sql`SELECT to_jsonb(s) AS value FROM system_settings s ORDER BY to_jsonb(s)::text`));
  const operations = rows(await db.execute(sql`SELECT count(*) AS n FROM provider_operations`));
  return JSON.stringify({ provider, settings, operations });
}
try {
  const baseline = await unchangedControls();
  const validInput = {
    nodeEnv: "production", replitDeployment: "1", releaseSha: first.sha,
    publishArtifactSha: first.sha, publishBuildId: first.id, publishBuiltAt: first.at,
  };
  assert.ok(readSfpAutomaticPublish(validInput));
  for (const override of [
    { nodeEnv: "development" }, { replitDeployment: undefined },
    { publishBuiltAt: undefined }, { publishBuiltAt: "garbage" },
    { publishBuildId: "not-a-uuid" }, { releaseSha: second.sha },
  ]) assert.equal(readSfpAutomaticPublish({ ...validInput, ...override }), null);
  const policy = {
    builtAt: second.at, previousEnvironment: "production", environment: "production",
    previousSelectedAt: first.at, latestBuiltAt: first.at,
    previousWasAutomatic: true,
    previouslySelected: false, ownerRevoked: false,
  };
  assert.doesNotThrow(() => assertSfpPublishMayAdvance(policy));
  assert.throws(() => assertSfpPublishMayAdvance({ ...policy, ownerRevoked: true }), /OWNER_REVOKED/);
  assert.throws(() => assertSfpPublishMayAdvance({ ...policy, environment: "development" }), /ENVIRONMENT_MISMATCH/);
  assert.throws(() => assertSfpPublishMayAdvance({ ...policy, builtAt: first.at }), /BUILD_NOT_NEWER/);
  assert.throws(() => assertSfpPublishMayAdvance({ ...policy, previouslySelected: true }), /RETIRED_BUILD/);
  assert.throws(() => assertSfpPublishMayAdvance({
    ...policy, latestBuiltAt: null, previousSelectedAt: republish.at, previousWasAutomatic: false,
  }), /BUILD_NOT_NEWER/);
  assert.throws(() => assertSfpPublishMayAdvance({
    ...policy, previousSelectedAt: republish.at, previousWasAutomatic: false,
  }), /BUILD_NOT_NEWER/, "a manual rollback creates a floor even with older automatic history");

  deploy(first);
  process.env.REPLIT_DEPLOYMENT = "0";
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /CURRENT_RELEASE_NOT_SELECTED/);
  assert.equal(await eventCount(), 0);
  deploy(first);
  const firstOwner = await claimSfpRuntimeDeploymentOwner();
  assert.equal(await eventCount(), 1);
  const initial = await getSfpRuntimeReleaseSelectionStatus();
  assert.equal(initial.ready, true);
  assert.equal(initial.selectedRelease?.selectedBy, "system:sfp-publish-handoff");
  assert.equal(initial.selectedRelease?.selectionVersion, 1);
  const event = rows(await db.execute(sql`SELECT * FROM sfp_runtime_release_selection_events`))[0];
  assert.equal(event.selected_release.selectionMethod, "automatic_published_artifact");
  assert.equal(event.selected_release.buildCreatedAt, first.at);
  assert.match(event.publisher_verification_reference, /^sfp-publish-artifact:/);
  const replicas = await Promise.all(Array.from({ length: 5 }, () => claimSfpRuntimeDeploymentOwner()));
  assert.equal(await eventCount(), 1);
  assert.ok(replicas.every(owner => owner.ownerToken === firstOwner.ownerToken));

  deploy(second);
  const secondOwner = await claimSfpRuntimeDeploymentOwner();
  assert.ok(secondOwner.ownerEpoch > firstOwner.ownerEpoch);
  assert.notEqual(secondOwner.ownerToken, firstOwner.ownerToken);
  assert.equal(await eventCount(), 2);
  deploy(first);
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /RETIRED_BUILD/);
  await assert.rejects(renewSfpRuntimeDeploymentOwner(), /CURRENT_RELEASE_NOT_SELECTED/);
  assert.equal(await eventCount(), 2);
  deploy(republish);
  const republishedOwner = await claimSfpRuntimeDeploymentOwner();
  assert.equal(republishedOwner.artifactSha, secondOwner.artifactSha);
  assert.notEqual(republishedOwner.deploymentIdentity, secondOwner.deploymentIdentity);
  assert.ok(republishedOwner.ownerEpoch > secondOwner.ownerEpoch);
  assert.equal(await eventCount(), 3);
  deploy(second);
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /RETIRED_BUILD/);
  // A never-selected but older artifact is blocked, not merely seen UUIDs.
  deploy({ ...first, id: randomUUID() });
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /BUILD_NOT_NEWER/);
  assert.equal(await eventCount(), 3);

  deploy(republish);
  await db.execute(sql`UPDATE sfp_runtime_owner_authority SET lease_expires_at=clock_timestamp()-interval '1 second'`);
  await assert.rejects(renewSfpRuntimeDeploymentOwner(), /FENCE_LOST/);
  const recovered = await claimSfpRuntimeDeploymentOwner();
  assert.ok(recovered.ownerEpoch > republishedOwner.ownerEpoch);
  assert.equal(await eventCount(), 3);
  // Explicit manual rollback stays available; retired newer builds cannot
  // counteract it simply by restarting their old replicas.
  deploy(first);
  await selectCurrentSfpRuntimeRelease({
    actorId: "certification:manual-rollback", expectedPreviousSelectionVersion: 3,
    expectedPreviousArtifactSha: republish.sha, publisherVerifiedArtifactSha: first.sha,
    publisherVerifiedDeploymentIdentity: `publish-build:${first.id}`,
    verificationReference: "https://certification.invalid/manual-rollback",
  });
  deploy(republish);
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /RETIRED_BUILD/);
  deploy({ ...second, id: randomUUID(), at: new Date(base + 3000).toISOString() });
  await db.execute(sql`UPDATE sfp_runtime_owner_authority SET revoked_at=clock_timestamp()`);
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /OWNER_REVOKED/);
  deploy(first);
  await assert.rejects(claimSfpRuntimeDeploymentOwner(), /OWNER_REVOKED/);
  assert.equal(await eventCount(), 4);
  assert.equal(await unchangedControls(), baseline, "publish handoff changes no provider controls, settings or paid operations");
  console.log("SFP publish handoff PASS: artifact/runtime validation, automatic bootstrap/transfer, concurrent replicas, same-SHA republish, retired/older fencing, lease recovery, manual rollback, revoked hold, unchanged spend/pause controls.");
} finally {
  await pool.end();
}