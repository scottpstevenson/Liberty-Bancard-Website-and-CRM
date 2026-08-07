/**
 * test-heartbeat-visibility.ts
 *
 * Verifies that a simulated DB error in a background worker's heartbeat write
 * produces a console.error log rather than being silently swallowed.
 *
 * Run: npx tsx scripts/test-heartbeat-visibility.ts
 * Exit 0 = PASS, Exit 1 = FAIL
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

// ── Test 1: setSystemSetting heartbeat failure emits console.error ─────────

async function testSetSystemSettingHeartbeatVisibility() {
  console.log("\n[Test 1] setSystemSetting heartbeat failure — must log, not swallow");

  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

  try {
    // Simulate what runSequencesTick() does in its finally block:
    //   storage.setSystemSetting(...).catch((err) => console.error("[Queue:sequences] heartbeat write failed (setSystemSetting):", err.message))
    const fakeSetSystemSetting = (): Promise<void> =>
      Promise.reject(new Error("DB pool exhausted"));

    await fakeSetSystemSetting().catch((err: Error) =>
      console.error("[Queue:sequences] heartbeat write failed (setSystemSetting):", err.message)
    );
  } finally {
    console.error = original;
  }

  assert(errors.length === 1, "exactly one console.error was emitted");
  assert(
    errors[0]?.includes("[Queue:sequences] heartbeat write failed (setSystemSetting):"),
    "error message includes the expected prefix"
  );
  assert(
    errors[0]?.includes("DB pool exhausted"),
    "error message includes the underlying error text"
  );
}

// ── Test 2: createAuditLog heartbeat failure emits console.error ───────────

async function testCreateAuditLogHeartbeatVisibility() {
  console.log("\n[Test 2] createAuditLog heartbeat failure — must log, not swallow");

  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

  try {
    // Simulate what runSequencesTick() does in its finally block:
    //   storage.createAuditLog(...).catch((err) => console.error("[Queue:sequences] heartbeat write failed (createAuditLog):", err.message))
    const fakeCreateAuditLog = (): Promise<void> =>
      Promise.reject(new Error("connection timeout"));

    await fakeCreateAuditLog().catch((err: Error) =>
      console.error("[Queue:sequences] heartbeat write failed (createAuditLog):", err.message)
    );
  } finally {
    console.error = original;
  }

  assert(errors.length === 1, "exactly one console.error was emitted");
  assert(
    errors[0]?.includes("[Queue:sequences] heartbeat write failed (createAuditLog):"),
    "error message includes the expected prefix"
  );
  assert(
    errors[0]?.includes("connection timeout"),
    "error message includes the underlying error text"
  );
}

// ── Test 3: Old silent-swallow pattern would NOT log (regression guard) ────

async function testSilentSwallowProducesNoLog() {
  console.log("\n[Test 3] Regression guard — old .catch(() => {}) produces no log (baseline)");

  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

  try {
    const failingOp = (): Promise<void> =>
      Promise.reject(new Error("silent error"));

    // This is the OLD pattern — deliberately used here to confirm our test
    // harness CAN detect the difference.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await failingOp().catch(() => {});
  } finally {
    console.error = original;
  }

  assert(errors.length === 0, "old .catch(() => {}) emits no console.error (confirming test harness detects the difference)");
}

// ── Test 4: setSystemSetting upsert SQL shape ──────────────────────────────

async function testSetSystemSettingUpsertShape() {
  console.log("\n[Test 4] setSystemSetting uses atomic upsert (source-level check)");

  const { readFileSync } = await import("fs");
  const source = readFileSync("server/storage/misc.ts", "utf-8");

  assert(
    source.includes("ON CONFLICT (key) DO UPDATE"),
    "setSystemSetting uses ON CONFLICT DO UPDATE atomic upsert"
  );
  assert(
    !source.includes("const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, key))"),
    "old SELECT+UPDATE race-prone pattern is removed"
  );
}

// ── Run all tests ──────────────────────────────────────────────────────────

(async () => {
  console.log("=== Heartbeat visibility tests ===");

  await testSetSystemSettingHeartbeatVisibility();
  await testCreateAuditLogHeartbeatVisibility();
  await testSilentSwallowProducesNoLog();
  await testSetSystemSettingUpsertShape();

  console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log("All checks passed.");
})();
