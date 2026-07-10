/**
 * test-sla-reentrancy.ts
 * Verifies the runScheduledAiOps() single-process re-entrancy guard:
 *   1. A concurrent second invocation is skipped (guard blocks it).
 *   2. An exception inside the first invocation resets _aiOpsRunning.
 *   3. A subsequent call after reset can run normally.
 *
 * Architecture note: this guard is intentionally single-process only.
 * It does NOT protect against multi-instance deployments.
 * See the comment in sla-worker.ts near _aiOpsRunning for details.
 *
 * Run with:  npx tsx scripts/test-sla-reentrancy.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Replicate the guard pattern in isolation so we can test it without touching
// the actual DB or GHL. This mirrors the exact structure in sla-worker.ts.
// ---------------------------------------------------------------------------

let _aiOpsRunning = false;
const callLog: string[] = [];

async function mockRunScheduledAiOps(
  options: { shouldThrow?: boolean; delayMs?: number } = {},
): Promise<void> {
  if (_aiOpsRunning) {
    callLog.push("skipped");
    return;
  }
  _aiOpsRunning = true;
  try {
    callLog.push("started");
    if (options.delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.shouldThrow) {
      throw new Error("Simulated SLA worker failure");
    }
    callLog.push("completed");
  } catch (err) {
    callLog.push(`error:${(err as Error).message}`);
  } finally {
    _aiOpsRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Concurrent second invocation is skipped
// ---------------------------------------------------------------------------
console.log("\nTest 1: Concurrent second call is skipped while first is running");
{
  _aiOpsRunning = false;
  callLog.length = 0;

  // Start first call (slow — will still be running when second fires)
  const first = mockRunScheduledAiOps({ delayMs: 50 });
  // Fire second call immediately — first hasn't finished yet
  const second = mockRunScheduledAiOps();

  await Promise.all([first, second]);

  assert(callLog.includes("started"), "First invocation started");
  assert(callLog.includes("completed"), "First invocation completed");
  assert(callLog.filter((e) => e === "started").length === 1, "Only one invocation ran");
  assert(callLog.includes("skipped"), "Second invocation was skipped");
  assert(_aiOpsRunning === false, "_aiOpsRunning reset to false after first completes");
}

// ---------------------------------------------------------------------------
// Test 2: Exception inside the worker resets _aiOpsRunning
// ---------------------------------------------------------------------------
console.log("\nTest 2: Exception inside the worker resets _aiOpsRunning via finally");
{
  _aiOpsRunning = false;
  callLog.length = 0;

  await mockRunScheduledAiOps({ shouldThrow: true });

  assert(callLog.includes("started"), "Invocation started before throw");
  assert(
    callLog.some((e) => e.startsWith("error:")),
    "Error was logged in catch block",
  );
  assert(
    _aiOpsRunning === false,
    "_aiOpsRunning is false after exception (finally reset)",
  );
}

// ---------------------------------------------------------------------------
// Test 3: After exception reset, a subsequent invocation runs normally
// ---------------------------------------------------------------------------
console.log("\nTest 3: Subsequent invocation after exception-reset completes normally");
{
  // Guard should already be false from Test 2
  assert(_aiOpsRunning === false, "_aiOpsRunning starts as false");
  callLog.length = 0;

  await mockRunScheduledAiOps();

  assert(callLog.includes("started"), "Post-exception invocation started");
  assert(callLog.includes("completed"), "Post-exception invocation completed");
  assert(_aiOpsRunning === false, "_aiOpsRunning reset after normal completion");
}

// ---------------------------------------------------------------------------
// Test 4: Guard correctly blocks a second call even when first throws
// ---------------------------------------------------------------------------
console.log("\nTest 4: Guard blocks concurrent call even when first invocation throws");
{
  _aiOpsRunning = false;
  callLog.length = 0;

  const first = mockRunScheduledAiOps({ delayMs: 50, shouldThrow: true });
  const second = mockRunScheduledAiOps();

  await Promise.all([first, second]);

  assert(callLog.includes("skipped"), "Concurrent call skipped even during throwing first run");
  assert(_aiOpsRunning === false, "_aiOpsRunning reset to false after throwing first run");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n── Re-entrancy guard tests: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("All re-entrancy guard tests passed.");
  process.exit(0);
}
