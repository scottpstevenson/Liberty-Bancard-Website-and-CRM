/**
 * CRO-03A v1-vs-v3 Impact Preview (Operator CLI)
 *
 * Dry-run comparison of the active v1 policy against a named draft document.
 * Prints flip counts by source_system and v1 disposition, a bounded example
 * list, grand total, policy IDs/hashes, selection hash, and evaluatedAsOf.
 *
 * Guards:
 *   1. Candidate document must exist in cro03a_policy_documents.
 *   2. Candidate document must be in status='draft'.
 *   3. Candidate must NOT be the current cro03a_policy_control active pointer.
 *
 * This script NEVER calls activateCro03aPolicy(). It is read-only.
 *
 * Usage:
 *   npx tsx scripts/preview-cro03a-v1-v3.ts --candidateId <uuid>
 *
 * Not registered in ci-suite-manifest.ts — this is an environment-dependent
 * operator tool that will legitimately fail after v3 is activated.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { compareCro03aPolicies } from "../server/services/cro03a/policy-comparison-service";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

async function main() {
  const args = process.argv.slice(2);
  const candidateIdIdx = args.indexOf("--candidateId");
  if (candidateIdIdx === -1 || !args[candidateIdIdx + 1]) {
    console.error("Usage: npx tsx scripts/preview-cro03a-v1-v3.ts --candidateId <uuid>");
    process.exit(1);
  }
  const candidateId = args[candidateIdIdx + 1].trim();
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) {
    console.error(`[preview] ERROR: --candidateId must be a valid UUID; got: ${candidateId}`);
    process.exit(1);
  }

  // ── Guard 1: Candidate must exist ──────────────────────────────────────────
  const docRow = rows(await db.execute(sql`
    SELECT id, version, policy_key, policy_hash, status
      FROM cro03a_policy_documents
     WHERE id = ${candidateId}::uuid
  `))[0];
  if (!docRow) {
    console.error(`[preview] ERROR: candidate document not found: ${candidateId}`);
    process.exit(1);
  }

  // ── Guard 2: Candidate must be in draft status ─────────────────────────────
  if (String(docRow.status) !== "draft") {
    console.error(
      `[preview] ERROR: candidate document status must be 'draft'; got '${docRow.status}' ` +
      `(id=${candidateId} version=${docRow.version})`,
    );
    process.exit(1);
  }

  // ── Guard 3: Candidate must not be the active pointer ─────────────────────
  const controlRow = rows(await db.execute(sql`
    SELECT active_policy_id FROM cro03a_policy_control WHERE id = 1
  `))[0];
  if (controlRow && String(controlRow.active_policy_id) === candidateId) {
    console.error(
      `[preview] ERROR: candidate ${candidateId} is already the active policy. ` +
      "This preview is only meaningful for a non-active draft.",
    );
    process.exit(1);
  }

  console.log(`\n[preview] CRO-03A Policy Impact Preview`);
  console.log(`[preview] Candidate: id=${candidateId} key=${docRow.policy_key} version=${docRow.version} status=${docRow.status}`);
  console.log("[preview] Loading eligible occurrence population and evaluating — this may take a moment...\n");

  const result = await compareCro03aPolicies(candidateId, db);

  console.log("══ Policy IDs & Hashes ══════════════════════════════════════════════════════");
  console.log(`  Active    id=${result.policies.active.id}`);
  console.log(`            version=${result.policies.active.version}  hash=${result.policies.active.hash}`);
  console.log(`  Candidate id=${result.policies.candidate.id}`);
  console.log(`            version=${result.policies.candidate.version}  hash=${result.policies.candidate.hash}`);
  console.log(`\n  selectionHash : ${result.selectionHash}`);
  console.log(`  evaluatedAsOf : ${result.evaluatedAsOf}`);
  console.log(`  totalOccurrences : ${result.totalOccurrences}`);

  console.log("\n══ Flip Summary (v1 disposition → v3 disposition) ══════════════════════════");
  if (result.flipCount === 0) {
    console.log("  No flips — both policies produce identical dispositions for this population.");
  } else {
    console.log(`  Total flips: ${result.flipCount} of ${result.totalOccurrences} occurrences\n`);
    const header = `  ${"sourceSystem".padEnd(30)} ${"active".padEnd(20)} → ${"candidate".padEnd(20)} count`;
    console.log(header);
    console.log("  " + "─".repeat(header.length - 2));
    for (const row of result.flipsBySourceAndDisposition) {
      console.log(
        `  ${row.sourceSystem.padEnd(30)} ${row.activePolicyDisposition.padEnd(20)} → ${row.candidatePolicyDisposition.padEnd(20)} ${row.count}`,
      );
    }
  }

  if (result.sampleFlips.length > 0) {
    console.log(`\n══ Sample Flips (up to ${result.sampleFlips.length}) ══════════════════════════════════════════`);
    for (const flip of result.sampleFlips) {
      const name = flip.businessName ? ` "${flip.businessName}"` : "";
      console.log(`  [${flip.sourceSystem}]${name}  ${flip.activePolicyDisposition} → ${flip.candidatePolicyDisposition}  (${flip.occurrenceId})`);
    }
  }

  console.log("\n[preview] DONE — no writes performed; activateCro03aPolicy() was not called.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("[preview] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
