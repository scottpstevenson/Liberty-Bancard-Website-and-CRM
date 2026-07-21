/**
 * DB Backup Service
 *
 * Runs a pg_dump of the primary Postgres database and writes the compressed
 * SQL dump to ./backups/. On success an audit log is written. On failure a
 * critical Slack alert is fired so on-call can take action.
 *
 * Called by the BullMQ "db-backup" queue (daily at 3:00 AM UTC) and also
 * available as a manual trigger from the Operator Dashboard.
 */
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

const BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_BACKUPS_TO_KEEP = 7;

export interface BackupResult {
  ok: boolean;
  filePath?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
}

export async function runDatabaseBackup(triggeredBy = "scheduled"): Promise<BackupResult> {
  const { storage } = await import("../storage");
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

  // Build pg_dump command — pipe through gzip for compression.
  // DATABASE_URL format: postgresql://user:pass@host:port/db
  const cmd = `pg_dump "${process.env.DATABASE_URL}" | gzip > "${outFile}"`;

  let result: BackupResult;
  try {
    await execAsync(cmd, { timeout: 5 * 60 * 1000 }); // 5-min timeout
    const { size } = fs.statSync(outFile);
    const durationMs = Date.now() - startMs;
    console.log(`[DB Backup] Success — ${outFile} (${(size / 1024 / 1024).toFixed(1)} MB, ${durationMs}ms)`);

    result = { ok: true, filePath: outFile, sizeBytes: size, durationMs };

    await storage.createAuditLog({
      action: "db_backup_success",
      entityType: "system",
      actorType: "system",
      details: { triggeredBy, filePath: path.basename(outFile), sizeBytes: size, durationMs },
    });
  } catch (err: any) {
    // Clean up partial file if it exists
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
    console.error("[DB Backup] Failed:", err.message);
    result = { ok: false, error: err.message, durationMs: Date.now() - startMs };

    await storage.createAuditLog({
      action: "db_backup_failed",
      entityType: "system",
      actorType: "system",
      details: { triggeredBy, error: err.message },
    }).catch(() => {});

    try {
      const { sendCriticalAlert } = await import("./system-audit/slack-notifier");
      await sendCriticalAlert({
        subsystem: "database",
        status: "error",
        summary: `DB backup failed (triggered by: ${triggeredBy})`,
        details: { error: err.message },
      });
    } catch {}
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
