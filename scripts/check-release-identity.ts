/**
 * scripts/check-release-identity.ts
 *
 * Task #1955 — release-identity verification.
 *
 * Confirms that the RELEASE_SHA a running instance reports (via
 * process.env.RELEASE_SHA, the same value /api/health-style routes surface
 * — see server/routes/identity-crosswalk.ts deriveEnvironment(),
 * server/routes/activation.ts, server/routes/cro03.ts) actually resolves
 * to a real commit in the `origin` GitHub remote's history. This catches
 * the case where a workspace's RELEASE_SHA was set by hand, by a stale
 * script, or points at a commit that only ever existed on an unpushed
 * local branch — any of which would make CRO03C's release-bound approval
 * scope (see .agents/memory/cro03c-release-bound-approvals.md) silently
 * unverifiable in production.
 *
 * Read-only: runs `git fetch --dry-run` / `git cat-file` / `git branch -r
 * --contains`, never pushes or mutates refs.
 *
 * Usage: npx tsx scripts/check-release-identity.ts
 * Exit code 0 = SHA present and reachable from an origin branch.
 * Exit code 1 = SHA missing, malformed, or not reachable from any origin branch.
 */
import { execSync } from "child_process";

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  const sha = (process.env.RELEASE_SHA ?? "").trim();

  console.log(`[check-release-identity] RELEASE_SHA env value: ${sha || "(not set)"}`);

  if (!sha || sha === "unknown") {
    console.error(
      "[check-release-identity] FAIL: RELEASE_SHA is unset or 'unknown'. " +
        "Every route that keys authority off RELEASE_SHA (cro03.ts, activation.ts, " +
        "identity-crosswalk.ts) will fall back to a fail-closed / stale state.",
    );
    process.exit(1);
  }

  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    console.error(`[check-release-identity] FAIL: RELEASE_SHA "${sha}" is not a valid git SHA format.`);
    process.exit(1);
  }

  // Make sure we have a reasonably fresh view of origin without mutating anything local.
  try {
    sh("git fetch origin --quiet");
  } catch (err) {
    console.warn(
      "[check-release-identity] WARN: `git fetch origin` failed — checking against local refs only. " +
        String((err as Error).message).split("\n")[0],
    );
  }

  let commitExists = false;
  try {
    sh(`git cat-file -e ${sha}^{commit}`);
    commitExists = true;
  } catch {
    commitExists = false;
  }

  if (!commitExists) {
    console.error(
      `[check-release-identity] FAIL: commit ${sha} does not exist in this repository's object database at all.`,
    );
    process.exit(1);
  }

  let containingBranches = "";
  try {
    containingBranches = sh(`git branch -r --contains ${sha}`);
  } catch {
    containingBranches = "";
  }

  if (!containingBranches) {
    console.error(
      `[check-release-identity] FAIL: commit ${sha} exists locally but is not reachable from any ` +
        `origin/* branch. This usually means RELEASE_SHA points at an unpushed or since-rebased commit — ` +
        `CRO03C approval-scope verification (which recomputes against live RELEASE_SHA) would treat this ` +
        `release's approvals as unverifiable against the published history.`,
    );
    process.exit(1);
  }

  console.log(`[check-release-identity] OK: ${sha} is reachable from:\n${containingBranches}`);
  process.exit(0);
}

main();
