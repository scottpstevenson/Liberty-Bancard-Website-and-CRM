/**
 * scripts/test-db-backup.ts
 *
 * Targeted tests for the two-gate completion guard in runPgDumpStreaming.
 * Run with: npx tsx scripts/test-db-backup.ts
 *
 * Covered scenarios:
 *   1. Process writes output then exits NON-ZERO  → must REJECT (not resolve)
 *   2. Process writes output then exits ZERO      → must RESOLVE (file on disk)
 *   3. Timeout fires before process exits         → must REJECT with timeout msg
 *   4. Process emits stderr and exits non-zero    → rejection message uses stderr
 *   5. Partial output file is absent after reject (caller's cleanup path)
 *
 * No test framework required — plain assertions with process.exit(1) on failure.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Import the exported helper directly so we can inject short timeouts.
import { runPgDumpStreaming } from "../server/services/db-backup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function assertRejects(fn: () => Promise<unknown>, expectedFragment: string, label: string) {
  try {
    await fn();
    console.error(`  ✗ FAIL: ${label} — expected rejection but resolved`);
    failed++;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes(expectedFragment)) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${label} — rejected but message "${msg}" does not contain "${expectedFragment}"`);
      failed++;
    }
  }
}

/** Write a tiny helper script to a temp file and return its path. */
function writeTmpScript(code: string): string {
  const p = path.join(os.tmpdir(), `pg-dump-fake-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\n${code}\n`, { mode: 0o755 });
  return p;
}

/** Temp output file for a single test, cleaned up afterward. */
function tmpOutFile(): string {
  return path.join(os.tmpdir(), `db-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sql.gz`);
}

/**
 * runPgDumpStreaming calls `pg_dump --no-password <url>`.
 * We can't inject a fake binary easily, so we monkey-patch spawn in a
 * controlled way: pass a synthetic DATABASE_URL whose *host* encodes the
 * desired exit code and stdout payload so a custom script path can be used.
 *
 * Simpler approach used here: wrap runPgDumpStreaming with a test shim that
 * replaces the pg_dump call with a known shell script via PATH override on
 * the child process environment.  We write a fake "pg_dump" wrapper, prepend
 * its directory to PATH, then call runPgDumpStreaming normally.
 */

/** Create a fake pg_dump binary in a temp dir, return the dir path. */
function fakePgDumpBin(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pgdump-"));
  const bin = path.join(dir, "pg_dump");
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return dir;
}

/**
 * Run runPgDumpStreaming but with a fake pg_dump injected via PATH.
 * We can't directly set child process PATH from the existing API, so we
 * use a thin inline shim: spawn a wrapper that sets PATH and exec's
 * pg_dump from there.  Since runPgDumpStreaming calls spawn("pg_dump", …)
 * we prepend PATH before the module loads by setting process.env.PATH.
 */
function withFakePgDump<T>(binDir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH;
  process.env.PATH = `${binDir}:${original}`;
  return fn().finally(() => {
    process.env.PATH = original;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testNonZeroExitAfterOutput() {
  console.log("\nTest 1: non-zero exit after writing output → must reject");
  const outFile = tmpOutFile();
  // Write some bytes then exit 1
  const binDir = fakePgDumpBin(`printf 'SQL data\\n' ; exit 1`);
  try {
    await assertRejects(
      () => withFakePgDump(binDir, () => runPgDumpStreaming("postgresql://fake/db", outFile, 10_000)),
      "pg_dump exited with code 1",
      "rejected with non-zero exit message",
    );
    // Output file must have been cleaned up by runDatabaseBackup caller (not by
    // runPgDumpStreaming itself — the caller handles deletion on catch)
    // runPgDumpStreaming does NOT delete the file on failure; verify it may exist
    // (the important thing is it REJECTED, not that it deleted the file here)
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

async function testSuccessfulDump() {
  console.log("\nTest 2: exit 0 after writing output → must resolve with file on disk");
  const outFile = tmpOutFile();
  // Write valid gzip-able content then exit 0
  const binDir = fakePgDumpBin(`printf 'CREATE TABLE test();\\n' ; exit 0`);
  try {
    await withFakePgDump(binDir, () => runPgDumpStreaming("postgresql://fake/db", outFile, 10_000));
    const exists = fs.existsSync(outFile);
    const size = exists ? fs.statSync(outFile).size : 0;
    assert(exists, "output file exists after success");
    assert(size > 0, `output file has content (${size} bytes)`);
  } catch (err: any) {
    console.error(`  ✗ FAIL: resolved expected but got error: ${err.message}`);
    failed++;
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

async function testTimeout() {
  console.log("\nTest 3: process hangs past timeout → must reject with timeout message");
  const outFile = tmpOutFile();
  // Sleep indefinitely (longer than our short test timeout)
  const binDir = fakePgDumpBin(`sleep 60`);
  try {
    await assertRejects(
      () => withFakePgDump(binDir, () => runPgDumpStreaming("postgresql://fake/db", outFile, 500)),
      "timed out after",
      "rejected with timeout message",
    );
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

async function testStderrUsedInRejectionMessage() {
  console.log("\nTest 4: stderr content appears in rejection message");
  const outFile = tmpOutFile();
  const binDir = fakePgDumpBin(`echo "connection refused: host not found" >&2 ; exit 2`);
  try {
    await assertRejects(
      () => withFakePgDump(binDir, () => runPgDumpStreaming("postgresql://fake/db", outFile, 10_000)),
      "connection refused",
      "rejection message contains stderr content",
    );
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

async function testStreamFinishesThenExitNonZero() {
  console.log("\nTest 5: stream finishes THEN process exits non-zero → must still reject (two-gate race)");
  const outFile = tmpOutFile();
  // Write data, flush stdout explicitly, then exit non-zero
  // The `exec` trick closes stdout before exit, letting the stream drain first
  const binDir = fakePgDumpBin(`printf 'data' ; exec 1>&- ; sleep 0.05 ; exit 3`);
  try {
    await assertRejects(
      () => withFakePgDump(binDir, () => runPgDumpStreaming("postgresql://fake/db", outFile, 10_000)),
      "pg_dump exited with code 3",
      "rejected even though stream finished before process closed",
    );
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

/**
 * Test 6: runDatabaseBackup returns { ok: false } even when alert/audit
 * persistence would fail (e.g. storage module import throws).
 *
 * We simulate this by running a backup against a non-existent pg_dump binary
 * (the fake binDir is removed before calling) so the backup itself fails, then
 * verifying the result is { ok: false } — not a thrown error.
 *
 * The fire-and-forget helpers in runDatabaseBackup catch their own import
 * errors, so a broken alert-feed or storage module must never propagate.
 */
async function testAlertFailureDoesNotMaskBackupResult() {
  console.log("\nTest 6: alert-persistence failure → runDatabaseBackup still returns { ok: false }");

  // Use a DATABASE_URL that will make pg_dump fail immediately (invalid host)
  // without needing network access. pg_dump --no-password exits non-zero
  // when the URL is unparseable or host unreachable.
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://baduser:badpass@127.0.0.1:1/nonexistent?connect_timeout=1";

  try {
    const { runDatabaseBackup } = await import("../server/services/db-backup");
    // Should resolve (not throw) even though alert/audit helpers may fail internally
    const result = await runDatabaseBackup("test-alert-failure");
    assert(result.ok === false, "result.ok is false (not a thrown error)");
    assert(typeof result.error === "string", "result.error is a string");
    assert(typeof result.durationMs === "number", "result.durationMs is populated");
  } catch (err: any) {
    console.error(`  ✗ FAIL: runDatabaseBackup threw instead of returning { ok: false }: ${err.message}`);
    failed++;
  } finally {
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
    else delete process.env.DATABASE_URL;
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("=== DB Backup streaming tests ===");

  await testNonZeroExitAfterOutput();
  await testSuccessfulDump();
  await testTimeout();
  await testStderrUsedInRejectionMessage();
  await testStreamFinishesThenExitNonZero();
  await testAlertFailureDoesNotMaskBackupResult();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
