#!/usr/bin/env tsx
/**
 * Verify that a deployed health endpoint serves the SHA that passed release
 * validation. This is intentionally an operator-run post-deploy check because
 * CI has no authority to deploy or inspect the production environment.
 *
 * Usage:
 *   RELEASE_SHA="$(git rev-parse HEAD)" RELEASE_URL="https://example.com" \
 *     npx tsx scripts/verify-release-identity.ts
 */
import { spawnSync } from "node:child_process";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const releaseSha = process.env.RELEASE_SHA ?? "";
const releaseUrl = process.env.RELEASE_URL ?? "";

async function main(): Promise<void> {
  if (!SHA_PATTERN.test(releaseSha)) {
    throw new Error("RELEASE_SHA must be the tested 40-character Git SHA");
  }
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const checkedOutSha = gitHead.status === 0 ? gitHead.stdout.trim() : "";
  if (!SHA_PATTERN.test(checkedOutSha) || checkedOutSha.toLowerCase() !== releaseSha.toLowerCase()) {
    throw new Error("RELEASE_SHA does not match the checked-out tested commit");
  }
  if (!/^https?:\/\//i.test(releaseUrl)) {
    throw new Error("RELEASE_URL must be an http(s) deployment URL");
  }

  const healthUrl = `${releaseUrl.replace(/\/$/, "")}/api/health`;
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Deployed health endpoint returned HTTP ${response.status}`);
  }
  const body = await response.json() as { sha?: unknown };
  if (body.sha !== releaseSha) {
    throw new Error("Deployed health SHA does not match RELEASE_SHA");
  }

  console.log("verify-release-identity: PASS — deployed /api/health SHA matches the tested release");
}

main().catch((error) => {
  console.error(
    `verify-release-identity: FAIL — ${error instanceof Error ? error.message : "release identity check failed"}`,
  );
  process.exitCode = 1;
});
