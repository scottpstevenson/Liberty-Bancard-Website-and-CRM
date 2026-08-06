/**
 * DB Backup Service
 *
 * Streams a pg_dump of the primary Postgres database through gzip and writes
 * the compressed SQL dump to ./backups/. The previous `exec`-based approach
 * buffered the entire dump in memory and used a 5-minute timeout — both of
 * which caused ETIMEDOUT on Neon, whose connection proxy has a short idle
 * timeout that fires mid-dump on large databases.
 *
 * Fix: spawn pg_dump and stream stdout → zlib.createGzip() → fs.WriteStream
 * so no data is buffered in Node's heap. A 30-minute timeout covers the
 * worst-case dump size. The DATABASE_URL is patched with connect_timeout=30
 * and statement_timeout=0 so Neon's proxy doesn't kill the connection
 * between rows.
 *
 * Completion is two-gated: BOTH conditions must hold before the promise
 * resolves:
 *   1. pg_dump exited with code 0
 *   2. the output WriteStream finished flushing to disk
 *
 * This eliminates the race where pg_dump emits all stdout (stream finishes)
 * and then exits non-zero for a late error. Without the two-gate, the
 * `finish` event would have already resolved the promise, leaving a corrupt
 * artifact logged as a successful backup.
 *
 * Audit logging, alert-feed writes, and Slack notifications are all
 * fire-and-forget (never awaited; each is internally try/caught) so that a
 * failure in any of those subsystems — including a dynamic-import failure —
 * cannot propagate and change runDatabaseBackup's documented return type from
 * BackupResult to a thrown error.
 *
 * Called by the BullMQ "db-backup" queue (daily at 3:00 AM UTC) and also
 * available as a manual trigger from the Operator Dashboard.
 */
import { spawn } from "child_process";
import { createGzip } from "zlib";
import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_BACKUPS_TO_KEEP = 7;
/** 30 minutes — large databases on Neon can take 10–20 min to dump. */
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000;

export interface BackupResult {
  ok: boolean;
  filePath?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Patch DATABASE_URL so pg_dump doesn't time out mid-stream on Neon:
 *   connect_timeout=30        — TCP handshake budget
 *   sslmode=require           — required by Neon (set only when absent)
 *   options=-c statement_timeout=0  — disables the per-statement timeout so
 *                                     a long COPY from large tables isn't killed
 */
function buildDumpUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", "30");
    }
    if (!u.searchParams.has("sslmode")) {
      u.searchParams.set("sslmode", "require");
    }
    const existing = u.searchParams.get("options") ?? "";
    if (!existing.includes("statement_timeout")) {
      u.searchParams.set(
        "options",
        [existing, "-c statement_timeout=0"].filter(Boolean).join(" "),
      );
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Stream pg_dump → gzip → file with a two-gate completion guard.
 *
 * The promise resolves only when BOTH are true:
 *   - pg_dump closed with exit code 0        (Gate 1)
 *   - the output WriteStream emitted finish  (Gate 2)
 *
 * If pg_dump exits non-zero — even after the stream has already finished —
 * the promise rejects and the caller removes the partial output file.
 * This prevents a corrupt dump from being recorded as a success.
 *
 * Exported so tests can inject a short timeoutMs without touching the module
 * constant.
 */
export function runPgDumpStreaming(
  rawDbUrl: string,
  outFile: string,
  timeoutMs = BACKUP_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const connUrl = buildDumpUrl(rawDbUrl);

    // Two-gate tracking
    let pgDumpExitedOk = false;
    let streamFinished = false;
    // Once settled (either resolved or rejected) no further state transitions.
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { pgDump.kill("SIGTERM"); } catch {}
      reject(err);
    };

    // Resolve only when BOTH gates are open.
    const tryResolve = () => {
      if (settled) return;
      if (pgDumpExitedOk && streamFinished) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    };

    const timer = setTimeout(() => {
      fail(new Error(`pg_dump timed out after ${timeoutMs / 60000} minutes`));
    }, timeoutMs);

    // --no-password so pg_dump never hangs waiting for a password prompt
    const pgDump = spawn("pg_dump", ["--no-password", connUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const gzip = createGzip({ level: 6 });
    const outStream = fs.createWriteStream(outFile);

    let stderr = "";
    pgDump.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 4096);
    });

    // Pipeline: pg_dump stdout → gzip → disk
    pgDump.stdout.pipe(gzip).pipe(outStream);

    pgDump.on("error", fail);
    gzip.on("error", fail);
    outStream.on("error", fail);

    // Gate 2: all bytes written and flushed to disk.
    outStream.on("finish", () => {
      streamFinished = true;
      tryResolve();
    });

    // Gate 1: pg_dump process exited.
    // Checked unconditionally — a non-zero exit rejects even if the stream
    // already finished (settled is still false because tryResolve() requires
    // BOTH gates, so it could not have fired when only Gate 2 was set).
    pgDump.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || `pg_dump exited with code ${code}`;
        fail(new Error(msg));
        return;
      }
      pgDumpExitedOk = true;
      tryResolve();
    });
  });
}

// ── Safe fire-and-forget helpers ─────────────────────────────────────────────
//
// Audit log, alert-feed, and Slack writes are best-effort side effects.
// They must NEVER throw back into runDatabaseBackup — not even if the dynamic
// import itself fails (e.g. DB pool unavailable at startup). Each helper
// resolves unconditionally; callers don't await them.

function fireSafeAuditLog(action: string, details: Record<string, unknown>): void {
  import("../storage")
    .then(({ storage }) =>
      storage.createAuditLog({ action, entityType: "system", actorType: "system", details })
    )
    .catch((e) => console.error("[DB Backup] audit log failed:", (e as Error).message));
}

function fireSafeAlert(
  severity: "critical" | "warning" | "info",
  subsystem: string,
  summary: string,
  details: Record<string, unknown>,
): void {
  import("./alert-feed")
    .then(({ persistAlert }) => persistAlert({ severity, subsystem, summary, details }))
    .catch((e) => console.error("[DB Backup] alert-feed failed:", (e as Error).message));
}

function fireSafeSlack(summary: string, details: Record<string, unknown>): void {
  import("./system-audit/slack-notifier")
    .then(({ sendCriticalAlert }) =>
      sendCriticalAlert({ subsystem: "database", status: "error", summary, details })
    )
    .catch((e) => console.error("[DB Backup] Slack alert failed:", (e as Error).message));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runDatabaseBackup(triggeredBy = "scheduled"): Promise<BackupResult> {
  const startMs = Date.now();

  if (!process.env.DATABASE_URL) {
    const msg = "DATABASE_URL not set — cannot run pg_dump";
    console.error("[DB Backup]", msg);
    return { ok: false, error: msg };
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(BACKUP_DIR, `db-backup-${timestamp}.sql.gz`);

  let result: BackupResult;
  try {
    await runPgDumpStreaming(process.env.DATABASE_URL, outFile);
    const { size } = fs.statSync(outFile);
    const durationMs = Date.now() - startMs;
    const sizeMb = (size / 1024 / 1024).toFixed(1);
    console.log(`[DB Backup] Success — ${outFile} (${sizeMb} MB, ${durationMs}ms)`);

    result = { ok: true, filePath: outFile, sizeBytes: size, durationMs };

    // Non-critical side effects — fire-and-forget, never propagate
    fireSafeAuditLog("db_backup_success", {
      triggeredBy,
      filePath: path.basename(outFile),
      sizeBytes: size,
      durationMs,
    });
    fireSafeAlert(
      "info",
      "db-backup",
      `DB backup completed — ${sizeMb} MB in ${Math.round(durationMs / 1000)}s (${triggeredBy})`,
      { triggeredBy, filePath: path.basename(outFile), sizeBytes: size, durationMs },
    );
  } catch (err: any) {
    // Clean up partial/corrupt file so the rotator doesn't count it
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
    console.error("[DB Backup] Failed:", err.message);
    result = { ok: false, error: err.message, durationMs: Date.now() - startMs };

    // Non-critical side effects — fire-and-forget, never propagate
    fireSafeAuditLog("db_backup_failed", { triggeredBy, error: err.message });
    fireSafeAlert(
      "critical",
      "db-backup",
      `DB backup FAILED (${triggeredBy}): ${err.message}`,
      { triggeredBy, error: err.message },
    );
    fireSafeSlack(`DB backup failed (triggered by: ${triggeredBy})`, { error: err.message });
  }

  // Rotate old backups — keep only the N most recent.
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("db-backup-") && f.endsWith(".sql.gz"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of files.slice(MAX_BACKUPS_TO_KEEP)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
      console.log("[DB Backup] Rotated old backup:", old.name);
    }
  } catch {}

  return result;
}

export async function listBackups(): Promise<{ name: string; sizeBytes: number; createdAt: string }[]> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("db-backup-") && f.endsWith(".sql.gz"))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
