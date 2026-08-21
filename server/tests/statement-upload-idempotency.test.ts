/**
 * Focused integration test for the statement-upload idempotency foundation.
 *
 * Run with:
 *   npx tsx server/tests/statement-upload-idempotency.test.ts
 *
 * Requires DATABASE_URL to be set.  Creates and cleans up its own rows.
 *
 * Test scenarios
 * ──────────────
 * T1  Invalid UUIDv4 key → throws validation error
 * T2  First caller claims slot → outcome "claimed"
 * T3  Same key + same fingerprint + same scope → replay (idempotent)
 * T4  Same key + different fingerprint + same scope → conflict
 * T5  Same key + same fingerprint + DIFFERENT scope → scope_mismatch
 *     (the unique index is on (operationScope, requestId); a different
 *      ownerScope cannot steal or shadow an existing slot)
 * T6  Owner mismatch: claimed row not returned to a different scope after success
 * T7  Concurrent two-client attempt: only one gets "claimed", other gets
 *     "claimed_by_other" or "replay"
 * T8  updateCheckpoint writes to in-progress row
 * T9  markSucceeded transitions status and sets result
 * T10 markRecoverableFailed transitions status; re-claim returns
 *     "recoverable_failed_replay" (not a successful replay)
 * T11 recoverCommand atomically re-enters in_progress for owner; wrong owner
 *     returns null
 * T12 One-way terminal transitions: markRecoverableFailed after markSucceeded
 *     is a no-op (first terminal writer wins); replay still returns success
 * T13 One-way terminal transitions: markSucceeded after markRecoverableFailed
 *     is a no-op; replay still returns the honest failure
 * T14 Route contract (static): every statement-upload entry point maps
 *     replay→200, claimed_by_other→202, conflict→409, scope_mismatch→403 and
 *     handles recoverable_failed_replay before any business mutation
 */

import { randomUUID } from "crypto";
import {
  isValidUUIDv4,
  computeRequestFingerprint,
  claimCommand,
  updateCheckpoint,
  updateContext,
  markSucceeded,
  markRecoverableFailed,
  recoverCommand,
  getCommandForOwner,
  findCommandByRequestId,
} from "../services/statement-upload-idempotency";
import { db } from "../db";
import { statementUploadCommands } from "@shared/schema";
import { eq } from "drizzle-orm";

// ── helpers ───────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const createdIds: string[] = [];

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

async function cleanup(): Promise<void> {
  if (createdIds.length === 0) return;
  // De-duplicate IDs before cleanup.
  const unique = [...new Set(createdIds)];
  for (const id of unique) {
    await db.delete(statementUploadCommands).where(eq(statementUploadCommands.id, id));
  }
}

function fp(tag: string): string {
  return computeRequestFingerprint({
    fields: { tag },
    fileBuffer: Buffer.from(`file-content-for-${tag}`),
  });
}

/**
 * Claim helper — uses ownerScope (not the legacy operationScope field).
 */
async function claim(
  requestId: string,
  fingerprint: string,
  ownerScope: string
) {
  const r = await claimCommand({ requestId, fingerprint, ownerScope });
  if (r.outcome === "claimed" || r.outcome === "replay" || r.outcome === "recoverable_failed_replay") {
    createdIds.push(r.command.id);
  }
  return r;
}

// ── tests ─────────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log("\n=== Statement Upload Idempotency Foundation Tests ===\n");

  // T1 – UUID v4 validation
  console.log("T1: UUID v4 validation");
  assert(isValidUUIDv4(randomUUID()), "randomUUID() passes");
  assert(!isValidUUIDv4("not-a-uuid"), "random string fails");
  assert(!isValidUUIDv4("12345678-1234-1234-1234-123456789012"), "v1-style fails (wrong version nibble)");
  assert(!isValidUUIDv4(""), "empty string fails");

  let threw = false;
  try {
    await claimCommand({
      requestId: "bad-key",
      fingerprint: fp("t1"),
      ownerScope: "user:1",
    });
  } catch {
    threw = true;
  }
  assert(threw, "claimCommand throws for invalid UUID");

  // T2 – First caller claims slot
  console.log("\nT2: First caller claims slot");
  const key2 = randomUUID();
  const fp2 = fp("t2");
  const r2 = await claim(key2, fp2, "user:100");
  assert(r2.outcome === "claimed", "outcome is 'claimed'");

  // T3 – Same key + same fingerprint + same scope → replay
  console.log("\nT3: Replay (same key, fingerprint, scope)");
  // Mark succeeded so the row is in a terminal state for replay
  if (r2.outcome === "claimed") {
    await markSucceeded(r2.command.id, { proposal_id: 999 });
  }
  const r3 = await claim(key2, fp2, "user:100");
  assert(r3.outcome === "replay", "outcome is 'replay'");
  if (r3.outcome === "replay") {
    assert(r3.command.status === "succeeded", "replayed command is succeeded");
    assert((r3.command.result as any)?.proposal_id === 999, "replayed result matches");
  }

  // T4 – Same key + different fingerprint → conflict
  console.log("\nT4: Conflict (same key, different fingerprint)");
  const key4 = randomUUID();
  const fp4a = fp("t4-variant-a");
  const fp4b = fp("t4-variant-b");
  const r4a = await claim(key4, fp4a, "user:100");
  assert(r4a.outcome === "claimed", "first claim succeeds");
  if (r4a.outcome === "claimed") {
    await markSucceeded(r4a.command.id, {});
  }
  const r4b = await claim(key4, fp4b, "user:100");
  assert(r4b.outcome === "conflict", "second attempt with different fingerprint → conflict");

  // T5 – Same key + same fingerprint + DIFFERENT scope → scope_mismatch
  // The unique index is on (operationScope, requestId) with a fixed operationScope
  // of "statement_upload", so a different ownerScope cannot insert a second row
  // for the same requestId. The existing row is not revealed to the new caller.
  console.log("\nT5: Different owner scope gets scope_mismatch (not an independent slot)");
  const key5 = randomUUID();
  const fp5 = fp("t5");
  const r5a = await claim(key5, fp5, "user:200");
  assert(r5a.outcome === "claimed", "scope user:200 claims slot");
  const r5b = await claim(key5, fp5, "user:201");
  assert(r5b.outcome === "scope_mismatch", "scope user:201 gets scope_mismatch (row not revealed)");

  // T6 – Owner mismatch: getCommandForOwner returns null for wrong scope
  console.log("\nT6: Owner mismatch — row not returned to different scope");
  if (r5a.outcome === "claimed") {
    const seen = await getCommandForOwner(r5a.command.id, "user:201");
    assert(seen === null, "user:201 cannot read user:200's command by ID");
    const own = await getCommandForOwner(r5a.command.id, "user:200");
    assert(own !== null, "user:200 can read its own command by ID");
  }

  // T7 – Concurrent two-client attempt
  console.log("\nT7: Concurrent two-client attempt (race simulation)");
  const key7 = randomUUID();
  const fp7 = fp("t7");
  // Launch two concurrent inserts for the same (scope, key).
  const [rA, rB] = await Promise.all([
    claimCommand({ requestId: key7, fingerprint: fp7, ownerScope: "user:300" }),
    claimCommand({ requestId: key7, fingerprint: fp7, ownerScope: "user:300" }),
  ]);
  // Track created IDs
  if (rA.outcome === "claimed" || rA.outcome === "replay" || rA.outcome === "recoverable_failed_replay") createdIds.push(rA.command.id);
  if (rB.outcome === "claimed" || rB.outcome === "replay" || rB.outcome === "recoverable_failed_replay") createdIds.push(rB.command.id);

  const outcomes = [rA.outcome, rB.outcome].sort();
  const oneClaimedOneOther =
    (rA.outcome === "claimed" && (rB.outcome === "claimed_by_other" || rB.outcome === "replay")) ||
    (rB.outcome === "claimed" && (rA.outcome === "claimed_by_other" || rA.outcome === "replay"));
  assert(
    oneClaimedOneOther,
    `one gets 'claimed', other gets 'claimed_by_other'/'replay' (got: ${outcomes.join(", ")})`
  );

  // T8 – updateCheckpoint
  console.log("\nT8: updateCheckpoint persists data");
  const key8 = randomUUID();
  const fp8 = fp("t8");
  const r8 = await claim(key8, fp8, "user:400");
  if (r8.outcome === "claimed") {
    await updateCheckpoint(r8.command.id, { step: "upload_complete", pct: 50 });
    const fetched = await getCommandForOwner(r8.command.id, "user:400");
    assert(
      (fetched?.checkpoint as any)?.step === "upload_complete",
      "checkpoint.step persisted"
    );
  } else {
    assert(false, "T8 precondition: claim succeeded", `got ${r8.outcome}`);
  }

  // T9 – markSucceeded
  console.log("\nT9: markSucceeded transitions status");
  const key9 = randomUUID();
  const fp9 = fp("t9");
  const r9 = await claim(key9, fp9, "user:500");
  if (r9.outcome === "claimed") {
    const done = await markSucceeded(r9.command.id, { proposal_id: 42 });
    assert(done?.status === "succeeded", "status is succeeded");
    assert((done?.result as any)?.proposal_id === 42, "result persisted");
    assert(done?.completedAt !== null, "completedAt set");
  } else {
    assert(false, "T9 precondition: claim succeeded", `got ${r9.outcome}`);
  }

  // T10 – markRecoverableFailed + re-claim returns recoverable_failed_replay
  console.log("\nT10: markRecoverableFailed transitions status; re-claim is recoverable_failed_replay");
  const key10 = randomUUID();
  const fp10 = fp("t10");
  const r10 = await claim(key10, fp10, "user:600");
  if (r10.outcome === "claimed") {
    const done = await markRecoverableFailed(r10.command.id, { error: "timeout" });
    assert(done?.status === "recoverable_failed", "status is recoverable_failed");
    assert((done?.result as any)?.error === "timeout", "error detail persisted");

    // Re-claiming the same key must NOT return "replay" — it must surface the
    // failure so the route can respond with an error, not a success body.
    const r10b = await claim(key10, fp10, "user:600");
    assert(
      r10b.outcome === "recoverable_failed_replay",
      "re-claim of failed key returns recoverable_failed_replay (not 'replay')"
    );
    if (r10b.outcome === "recoverable_failed_replay") {
      assert(
        r10b.command.status === "recoverable_failed",
        "command.status is recoverable_failed in replay result"
      );
      assert(
        (r10b.command.result as any)?.error === "timeout",
        "error detail accessible in recoverable_failed_replay"
      );
    }
  } else {
    assert(false, "T10 precondition: claim succeeded", `got ${r10.outcome}`);
  }

  // T11 – recoverCommand: owner-scoped atomic recover/resume claim
  console.log("\nT11: recoverCommand atomically re-enters in_progress for owner");
  const key11 = randomUUID();
  const fp11 = fp("t11");
  const r11 = await claim(key11, fp11, "user:700");
  if (r11.outcome === "claimed") {
    await markRecoverableFailed(r11.command.id, { error: "transient" });

    // Wrong owner gets null
    const wrongOwner = await recoverCommand(r11.command.id, "user:999");
    assert(wrongOwner === null, "wrong owner gets null from recoverCommand");

    // Correct owner transitions back to in_progress
    const recovered = await recoverCommand(r11.command.id, "user:700");
    assert(recovered !== null, "correct owner recovers successfully");
    assert(recovered?.status === "in_progress", "recovered command is in_progress");
    assert(recovered?.result === null, "result cleared on recover");
    assert(recovered?.checkpoint === null, "checkpoint cleared on recover");
    assert(recovered?.completedAt === null, "completedAt cleared on recover");

    // Calling recoverCommand again (already in_progress) returns null
    const double = await recoverCommand(r11.command.id, "user:700");
    assert(double === null, "recoverCommand on in_progress row returns null (idempotent guard)");
  } else {
    assert(false, "T11 precondition: claim succeeded", `got ${r11.outcome}`);
  }

  // T12 – One-way terminal transitions: success wins over a late failure
  console.log("\nT12: markRecoverableFailed after markSucceeded is a no-op (chain success cannot be overwritten)");
  const key12 = randomUUID();
  const r12 = await claim(key12, fp("t12"), "user:800");
  if (r12.outcome === "claimed") {
    const s = await markSucceeded(r12.command.id, { proposal_id: 12 });
    assert(s !== null, "markSucceeded on in_progress row succeeds");

    // A late route-level failure (e.g. SDR post-chain mutation throwing) must NOT
    // overwrite the chain's terminal success.
    const lateFail = await markRecoverableFailed(r12.command.id, { error: "late route failure" });
    assert(lateFail === null, "markRecoverableFailed on succeeded row is a no-op (returns null)");

    const after = await getCommandForOwner(r12.command.id, "user:800");
    assert(after?.status === "succeeded", "status remains succeeded");
    assert((after?.result as any)?.proposal_id === 12, "original success result preserved");

    // Retry with the same key still replays the success, not a false failure.
    const replay12 = await claim(key12, fp("t12"), "user:800");
    assert(replay12.outcome === "replay", "retry with same key replays success (not recoverable_failed_replay)");
  } else {
    assert(false, "T12 precondition: claim succeeded", `got ${r12.outcome}`);
  }

  // T13 – One-way terminal transitions: failure cannot be promoted to success
  console.log("\nT13: markSucceeded after markRecoverableFailed is a no-op (failure cannot be promoted)");
  const key13 = randomUUID();
  const r13 = await claim(key13, fp("t13"), "user:801");
  if (r13.outcome === "claimed") {
    const f = await markRecoverableFailed(r13.command.id, { error: "chain failure" });
    assert(f !== null, "markRecoverableFailed on in_progress row succeeds");

    const lateSuccess = await markSucceeded(r13.command.id, { proposal_id: 13 });
    assert(lateSuccess === null, "markSucceeded on recoverable_failed row is a no-op (returns null)");

    const after13 = await getCommandForOwner(r13.command.id, "user:801");
    assert(after13?.status === "recoverable_failed", "status remains recoverable_failed");
    assert((after13?.result as any)?.error === "chain failure", "original failure detail preserved");

    // Retry with the same key surfaces the honest failure.
    const replay13 = await claim(key13, fp("t13"), "user:801");
    assert(replay13.outcome === "recoverable_failed_replay", "retry with same key returns recoverable_failed_replay");
  } else {
    assert(false, "T13 precondition: claim succeeded", `got ${r13.outcome}`);
  }

  // T14 – Route contract: consistent status mapping across all entry points
  console.log("\nT14: route-level idempotency status contract (static source check)");
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const routeFiles = [
    "server/routes/public.ts",
    "server/routes/documents.ts",
    "server/routes/rate-review.ts",
    "server/routes/sdr.ts",
    "server/routes/partner-orgs.ts",
  ];
  for (const rel of routeFiles) {
    const src = readFileSync(join(process.cwd(), rel), "utf8");

    // Every successful replay branch must respond 200 (replayed), never 201.
    const replayBlocks = src.split(/outcome === "replay"/).slice(1);
    const replayOk =
      replayBlocks.length > 0 &&
      replayBlocks.every(b => /res\s*\.status\(200\)/.test(b.slice(0, 500)));
    assert(replayOk, `${rel}: all replay branches return 200`);

    // Every claimed_by_other branch must respond 202 (in progress), never 409.
    const inProgressBlocks = src.split(/outcome === "claimed_by_other"/).slice(1);
    const inProgressOk =
      inProgressBlocks.length > 0 &&
      inProgressBlocks.every(b => /res\s*\.status\(202\)/.test(b.slice(0, 400)));
    assert(inProgressOk, `${rel}: all claimed_by_other branches return 202`);

    // Every fingerprint conflict branch must respond 409, never 422.
    const conflictBlocks = src.split(/outcome === "conflict"/).slice(1);
    const conflictOk =
      conflictBlocks.length > 0 &&
      conflictBlocks.every(b => /res\s*\.status\(409\)/.test(b.slice(0, 400)));
    assert(conflictOk, `${rel}: all conflict branches return 409`);

    // Every scope mismatch branch must respond 403.
    const scopeBlocks = src.split(/outcome === "scope_mismatch"/).slice(1);
    const scopeOk =
      scopeBlocks.length > 0 &&
      scopeBlocks.every(b => /res\s*\.status\(403\)/.test(b.slice(0, 400)));
    assert(scopeOk, `${rel}: all scope_mismatch branches return 403`);

    // recoverable_failed_replay must be handled explicitly (early return, no
    // fall-through to fresh mutations).
    assert(
      src.includes('outcome === "recoverable_failed_replay"'),
      `${rel}: recoverable_failed_replay handled explicitly`
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: ${pass}  Failed: ${fail}`);
  if (fail > 0) {
    console.error("\nSome tests failed.");
    process.exitCode = 1;
  } else {
    console.log("\nAll tests passed ✓");
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

runTests()
  .catch((err) => {
    console.error("\nFatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log(`\n(Cleaned up ${createdIds.length} test row(s))`);
    } catch (e) {
      console.warn("Cleanup error:", e);
    }
    // Give the pool a moment to drain then exit.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
