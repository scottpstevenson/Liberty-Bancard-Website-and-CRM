/**
 * Continuous Health Monitor
 * Runs local and persisted system-health checks in parallel and persists the result
 * to system_settings. Generic health deliberately performs no provider I/O.
 * Wired into BullMQ via HEALTH_MONITOR queue (5-min prod / 15-min dev cadence).
 */

import { storage } from "../storage";
import { db, pool } from "../db";
import { sql } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus =
  | "ok"
  | "stale"
  | "degraded"
  | "error"
  | "unavailable"
  | "missed"
  | "unknown"
  | "misconfigured";

export interface CheckResult {
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
}
export interface HealthReport {
  runAt: string;
  overallOk: boolean;
  criticalFailures: string[];
  checks: {
    db: CheckResult;
    sequenceWorker: CheckResult;
    slaWorker: CheckResult;
    ghlSync: CheckResult;
    redis: CheckResult;
    dbBackup: CheckResult;
    kpiQuery: CheckResult;
    outboundPause: CheckResult;
    arbitrationErrors: CheckResult;
    slaHeartbeatWriteDegraded: CheckResult; // #1326 — heartbeat write failure counter
    productionSeedConvergence: CheckResult; // #1750 — required migration seed/backfill rows
  };
}
export const HEALTH_MONITOR_KEY = "health_monitor_last_result";

// Critical checks — failures make overallOk false
// sequenceWorker is critical: a stalled outbound worker means no sequences deliver.
// Wave 1A restores it to the critical set — a green health report must confirm the
// worker is alive, not just that the DB and Redis are reachable.
// productionSeedConvergence is critical: several systems (CRO-02/03/03A, CR-04,
// CR-06, inbound-effect orchestration) fail closed or misbehave when their
// required seed/backfill rows are silently absent (Task #1750).
const CRITICAL_CHECKS = new Set(["db", "sequenceWorker", "redis", "kpiQuery", "productionSeedConvergence"]);

// In-memory cache of last result
let _lastResult: HealthReport | null = null;

export function getLastHealthResult(): HealthReport | null {
  return _lastResult;
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkDb(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    // Two fast queries that cannot time out under production load:
    //   1. SELECT 1 — pure connectivity probe
    //   2. pg_class.reltuples — microsecond approximate row counts (same approach
    //      as checkKpiQuery); avoids the full-table COUNT(*) that was subject to
    //      the pool's 30-second statement_timeout and caused false critical failures
    //      under production load.
    const [pingResult, estResult] = await Promise.all([
      db.execute(sql`SELECT 1 AS ping`),
      db.execute(sql`
        SELECT relname, reltuples::bigint AS est
        FROM   pg_class
        WHERE  relname IN ('contacts', 'deals')
      `),
    ]);

    const ping = (pingResult.rows[0] as any)?.ping;
    if (!ping) {
      return { status: "error", message: "SELECT 1 returned no rows", latencyMs: Date.now() - t0 };
    }

    const latencyMs = Date.now() - t0;
    const rows = estResult.rows as Array<{ relname: string; est: string | number }>;
    const contactsEst = Number(rows.find(r => r.relname === "contacts")?.est ?? 0);
    const dealsEst    = Number(rows.find(r => r.relname === "deals")?.est    ?? 0);

    if (contactsEst > 0 && dealsEst > 0) {
      return { status: "ok", message: `contacts≈${contactsEst} deals≈${dealsEst}`, latencyMs };
    }
    // Ping succeeded but pg_class shows zero (fresh DB or stats not yet collected)
    return {
      status: "degraded",
      message: `contacts≈${contactsEst} deals≈${dealsEst} (pg_class zero — VACUUM pending or fresh DB)`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkWorkerTick(
  key: string,
  thresholdMs: number
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const raw = await storage.getSystemSetting(key);
    if (!raw) {
      return { status: "unknown", message: `No setting found for key "${key}"`, latencyMs: Date.now() - t0 };
    }

    // Value may be stored as { at: ISO } or { ts: ISO } depending on caller
    const value = raw as Record<string, unknown>;
    const tsStr = (value.ts ?? value.at) as string | undefined;
    if (!tsStr) {
      return { status: "unknown", message: "Setting exists but has no timestamp field", latencyMs: Date.now() - t0 };
    }

    const tsMs = new Date(tsStr).getTime();
    const ageMs = Date.now() - tsMs;
    const latencyMs = Date.now() - t0;

    if (ageMs <= thresholdMs) {
      return { status: "ok", message: `Last tick ${Math.round(ageMs / 1000)}s ago`, latencyMs };
    }
    return {
      status: "stale",
      message: `Last tick ${Math.round(ageMs / 60000)}m ago (threshold ${thresholdMs / 60000}m)`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkSequenceWorker(): Promise<CheckResult> {
  // When LEGACY_OUTREACH_ENABLED is off the sequence worker intentionally
  // does not tick — reporting stale here would be a false positive.
  const { featureFlags } = await import("./feature-flags");
  if (!featureFlags.LEGACY_OUTREACH_ENABLED) {
    return { status: "ok", message: "LEGACY_OUTREACH_ENABLED is off — sequence worker intentionally idle", latencyMs: 0 };
  }

  const t0 = Date.now();
  const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min
  const MAX_DURATION_MS = parseInt(process.env.SEQUENCE_WORKER_MAX_DURATION_MS ?? "600000", 10) || 600000; // 10 min default

  try {
    const raw = await storage.getSystemSetting("sequence_worker_last_run");
    const latencyMs = Date.now() - t0;

    // Key not set yet (first deploy) — report as degraded/unknown rather than error
    if (!raw || typeof raw !== "object") {
      // Fall back to legacy tick key for backwards compatibility
      return checkWorkerTick("sequence_runner_last_tick", STALE_THRESHOLD_MS);
    }

    const runData = raw as Record<string, unknown>;
    const ranAt = runData.ran_at as string | undefined;
    const durationMs = typeof runData.duration_ms === "number" ? runData.duration_ms : null;

    if (!ranAt) {
      return { status: "degraded", message: "sequence_worker_last_run exists but has no ran_at field", latencyMs };
    }

    const ageMs = Date.now() - new Date(ranAt).getTime();

    if (ageMs > STALE_THRESHOLD_MS) {
      return {
        status: "stale",
        message: `Last run ${Math.round(ageMs / 60000)}m ago (threshold 15m)`,
        latencyMs,
      };
    }

    if (durationMs !== null && durationMs > MAX_DURATION_MS) {
      return {
        status: "degraded",
        message: `Last run completed but took ${Math.round(durationMs / 1000)}s (threshold ${MAX_DURATION_MS / 1000}s) — worker may be overloaded`,
        latencyMs,
      };
    }

    const enrollmentsDueTotal = typeof (runData as any).enrollments_due_total === "number"
      ? (runData as any).enrollments_due_total
      : null;

    return {
      status: "ok",
      message: [
        `Last run ${Math.round(ageMs / 1000)}s ago`,
        `duration ${durationMs !== null ? Math.round(durationMs / 1000) + "s" : "unknown"}`,
        enrollmentsDueTotal !== null ? `backlog_after=${enrollmentsDueTotal}` : null,
      ].filter(Boolean).join(", "),
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkSlaWorker(): Promise<CheckResult> {
  return checkWorkerTick("sla_worker_last_tick", 10 * 60 * 1000);
}

async function checkGhlSync(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    // 1. Try system_settings first
    const raw = await storage.getSystemSetting("ghl_sync_last_tick");
    let tsMs: number | null = null;

    if (raw) {
      const value = raw as Record<string, unknown>;
      const tsStr = (value.ts ?? value.at) as string | undefined;
      if (tsStr) tsMs = new Date(tsStr).getTime();
    }

    // 2. Fall back to audit_logs if not found in settings
    if (!tsMs) {
      const result = await db.execute(sql`
        SELECT MAX(created_at) AS last_sync
        FROM audit_logs
        WHERE action = 'ghl_sync_completed'
          AND created_at > NOW() - INTERVAL '1 hour'
      `);
      const row = result.rows[0] as any;
      if (row?.last_sync) {
        tsMs = new Date(row.last_sync).getTime();
      }
    }

    const latencyMs = Date.now() - t0;

    if (!tsMs) {
      return { status: "error", message: "No GHL sync activity in the last hour", latencyMs };
    }

    const ageMs = Date.now() - tsMs;
    if (ageMs <= 5 * 60 * 1000) {
      return { status: "ok", message: `Last sync ${Math.round(ageMs / 1000)}s ago`, latencyMs };
    }
    if (ageMs <= 60 * 60 * 1000) {
      return { status: "stale", message: `Last sync ${Math.round(ageMs / 60000)}m ago`, latencyMs };
    }
    return { status: "error", message: `Last sync >60m ago`, latencyMs };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const pingResult = await Promise.race<string>([
      (async () => {
        const { getSharedRedisClientIfReady } = await import("./queue-connection");
        const client = getSharedRedisClientIfReady();
        if (!client) {
          // Health checks must not create workers or repeat schedules.
          const { requireQueueManagerReady } = await import("./queue-manager");
          requireQueueManagerReady();
          const { getSharedRedisClientIfReady: get2 } = await import("./queue-connection");
          const c2 = get2();
          if (!c2) throw new Error("Redis client not available");
          return (await c2.ping()) as string;
        }
        return (await client.ping()) as string;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout (5s)")), 5000)
      ),
    ]);

    const latencyMs = Date.now() - t0;
    if (pingResult === "PONG") {
      return { status: "ok", message: "PONG", latencyMs };
    }
    return { status: "degraded", message: `Unexpected ping response: ${pingResult}`, latencyMs };
  } catch (err: any) {
    return { status: "unavailable", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkDbBackup(): Promise<CheckResult> {
  const t0 = Date.now();
  const THRESHOLD_OK_MS = 26 * 60 * 60 * 1000;   // 26 hours
  const THRESHOLD_LOOK_MS = 28 * 60 * 60 * 1000; // 28 hours

  try {
    let tsMs: number | null = null;

    // 1. Check system_settings
    const raw = await storage.getSystemSetting("last_db_backup_success_at");
    if (raw) {
      const tsStr = typeof raw === "string" ? raw : (raw as any).ts ?? (raw as any).at;
      if (tsStr) tsMs = new Date(tsStr).getTime();
    }

    // 2. Fall back to audit_logs
    if (!tsMs) {
      const result = await db.execute(sql`
        SELECT MAX(created_at) AS last_backup
        FROM audit_logs
        WHERE action = 'db_backup_completed'
          AND created_at > NOW() - INTERVAL '28 hours'
      `);
      const row = result.rows[0] as any;
      if (row?.last_backup) tsMs = new Date(row.last_backup).getTime();
    }

    const latencyMs = Date.now() - t0;

    if (!tsMs) {
      return { status: "missed", message: "No backup activity found in last 28 hours", latencyMs };
    }

    const ageMs = Date.now() - tsMs;
    if (ageMs <= THRESHOLD_OK_MS) {
      return { status: "ok", message: `Last backup ${Math.round(ageMs / 3600000)}h ago`, latencyMs };
    }
    return {
      status: "missed",
      message: `Last backup ${Math.round(ageMs / 3600000)}h ago (threshold 26h)`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkKpiQuery(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    // Use pg_class.reltuples for approximate counts — runs in microseconds regardless of
    // table size, so this check can never time out due to a slow full-table scan.
    // reltuples is updated by VACUUM/ANALYZE and is accurate to within ~5–10% in production.
    // The purpose here is DB responsiveness + data presence, not exact row counts.
    const result = await db.execute(sql`
      SELECT relname, reltuples::bigint AS est
      FROM   pg_class
      WHERE  relname IN ('contacts', 'deals')
    `);

    const latencyMs = Date.now() - t0;
    const rows = result.rows as Array<{ relname: string; est: string | number }>;
    const contactsEst = Number(rows.find(r => r.relname === "contacts")?.est ?? 0);
    const dealsEst    = Number(rows.find(r => r.relname === "deals")?.est    ?? 0);

    if (contactsEst > 0 && dealsEst > 0) {
      return {
        status: "ok",
        message: `contacts≈${contactsEst} deals≈${dealsEst} (approx)`,
        latencyMs,
      };
    }
    // pg_class not yet analysed (fresh DB) — fall back to a lightweight exact check
    const fallback = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM contacts LIMIT 1) AS contacts,
        (SELECT COUNT(*) FROM deals    LIMIT 1) AS deals
    `);
    const fallbackRow = fallback.rows[0] as any;
    const contacts = Number(fallbackRow?.contacts ?? 0);
    const deals    = Number(fallbackRow?.deals    ?? 0);

    if (contacts > 0 && deals > 0) {
      return { status: "ok", message: `contacts=${contacts} deals=${deals} (exact, stats pending)`, latencyMs };
    }
    return {
      status: "degraded",
      message: `contacts≈${contactsEst} deals≈${dealsEst} — pg_class shows zero (new DB or VACUUM pending)`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "degraded", message: err.message, latencyMs: Date.now() - t0 };
  }
}

async function checkOutboundPause(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const { getPauseState } = await import("./outbound-pause-authority");
    const pause = await getPauseState();
    const latencyMs = Date.now() - t0;
    const healthy = pause.state === "unpaused" && pause.source !== "safe_default";
    return {
      status: healthy ? "ok" : "degraded",
      message: `state=${pause.state} source=${pause.source} epoch=${pause.epoch.toString()}${pause.reason ? ` reason=${pause.reason}` : ""}`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

// #1326 — Heartbeat write failure counter check.
// Reads the in-memory counter exported by sla-worker.ts and surfaces it as
// a distinct "degraded" health state so operators know the worker is alive
// but can't persist its last-tick timestamp.
async function checkSlaHeartbeatWriteDegraded(): Promise<CheckResult> {
  try {
    // Dynamic import to avoid circular dependency (sla-worker imports storage)
    const { _slaHeartbeatFailureCount } = await import("./sla-worker");
    if (_slaHeartbeatFailureCount === 0) {
      return { status: "ok", message: "No heartbeat write failures since last restart" };
    }
    return {
      status: "degraded",
      message: `SLA worker heartbeat write failed ${_slaHeartbeatFailureCount} time(s) since last restart — worker is alive but last_tick timestamp may be stale`,
    };
  } catch (err: any) {
    return { status: "unknown", message: `Counter unavailable: ${err.message}` };
  }
}

// Task #1750 — production seed convergence. Read-only re-verification (no
// writes) so a deploy cannot report healthy while a required migration
// seed/backfill row is absent, even if it was present at the last restart.
async function checkProductionSeedConvergence(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const { verifyProductionSeedConvergence } = await import("./production-seed-convergence");
    const report = await verifyProductionSeedConvergence();
    if (report.ok) {
      return { status: "ok", message: `${report.results.length}/${report.results.length} seed targets converged`, latencyMs: Date.now() - t0 };
    }
    const bad = report.results.filter((r) => r.outcome !== "already_present" && r.outcome !== "inserted" && r.outcome !== "backfilled");
    return {
      status: "error",
      message: `${bad.length} seed target(s) diverged: ${bad.map((r) => `${r.id} (${r.detail})`).join("; ")}`,
      latencyMs: Date.now() - t0,
    };
  } catch (err: any) {
    return { status: "error", message: `Convergence check threw: ${err.message}`, latencyMs: Date.now() - t0 };
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runHealthChecks(): Promise<HealthReport> {
  const runAt = new Date().toISOString();
  const t0 = Date.now();

  // ── Two-phase bounded fan-out ─────────────────────────────────────────────
  // Phase 1: fast checks — in-memory counters, Redis ping, or single
  //          system_settings reads. These do not hold a DB pool connection
  //          for long and are safe to run concurrently.
  // Phase 2: DB-heavy checks — each can run multiple sequential queries or
  //          table scans. Serialised in groups of 3 (one sequential group)
  //          so at most 3 pool connections are held simultaneously instead of
  //          the previous 11-way parallel burst.
  // This prevents the health-monitor tick from saturating the DB pool and
  // starving concurrent API requests or other background workers.

  const [
    slaHeartbeatRes,
    redisRes,
    outboundPauseRes,
    sequenceWorkerRes,
    slaWorkerRes,
  ] = await Promise.allSettled([
    checkSlaHeartbeatWriteDegraded(), // in-memory
    checkRedis(),                     // Redis ping only
    checkOutboundPause(),             // single system_settings read
    checkSequenceWorker(),            // single system_settings read
    checkSlaWorker(),                 // single system_settings read
  ]);

  // Phase 2: DB-heavy — run in two batches of 3 to bound concurrency.
  const [dbRes, ghlSyncRes, dbBackupRes] = await Promise.allSettled([
    checkDb(),
    checkGhlSync(),
    checkDbBackup(),
  ]);
  const [kpiQueryRes, arbitrationErrorsRes, productionSeedConvergenceRes] = await Promise.allSettled([
    checkKpiQuery(),
    checkArbitrationErrors(),
    checkProductionSeedConvergence(),
  ]);

  function settle(r: PromiseSettledResult<CheckResult>, name: string): CheckResult {
    if (r.status === "fulfilled") return r.value;
    return { status: "error", message: `Check threw: ${(r.reason as Error)?.message ?? String(r.reason)}` };
  }

  const checks = {
    db: settle(dbRes, "db"),
    sequenceWorker: settle(sequenceWorkerRes, "sequenceWorker"),
    slaWorker: settle(slaWorkerRes, "slaWorker"),
    ghlSync: settle(ghlSyncRes, "ghlSync"),
    redis: settle(redisRes, "redis"),
    dbBackup: settle(dbBackupRes, "dbBackup"),
    kpiQuery: settle(kpiQueryRes, "kpiQuery"),
    outboundPause: settle(outboundPauseRes, "outboundPause"),
    arbitrationErrors: settle(arbitrationErrorsRes, "arbitrationErrors"),
    slaHeartbeatWriteDegraded: settle(slaHeartbeatRes, "slaHeartbeatWriteDegraded"),
    productionSeedConvergence: settle(productionSeedConvergenceRes, "productionSeedConvergence"),
  };

  // Determine overall health (only critical checks matter)
  const criticalFailures: string[] = [];
  for (const name of CRITICAL_CHECKS) {
    const check = (checks as Record<string, CheckResult>)[name];
    const status = check?.status ?? "error";
    // ok, stale, unknown → not a failure; everything else → failure
    if (!["ok", "stale", "unknown"].includes(status)) {
      criticalFailures.push(name);
    }
  }
  const overallOk = criticalFailures.length === 0;

  const report: HealthReport = { runAt, overallOk, criticalFailures, checks };

  // Persist result
  try {
    await storage.setSystemSetting(HEALTH_MONITOR_KEY, report);
  } catch (err: any) {
    console.warn("[HealthMonitor] Could not persist result:", err.message);
  }

  // Update in-memory cache
  _lastResult = report;

  const okCount = Object.values(checks).filter(c => c.status === "ok").length;
  const TOTAL_CHECKS = Object.keys(checks).length;

  // One-line summary log
  const totalMs = Date.now() - t0;
  console.log(
    `[HealthMonitor] ok=${okCount}/${TOTAL_CHECKS} critical=${CRITICAL_CHECKS.size - criticalFailures.length}/${CRITICAL_CHECKS.size} latencyMs=${totalMs} overallOk=${overallOk}${criticalFailures.length > 0 ? ` failures=[${criticalFailures.join(",")}]` : ""}`
  );

  return report;
}

/**
 * Arbitration error monitor (#1412).
 * Queries audit_logs for ARBITRATION_ERROR events in the last 24 hours.
 * A degraded status is persisted in the health report for operators.
 */
async function checkArbitrationErrors(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM audit_logs
       WHERE action = 'ARBITRATION_ERROR'
         AND created_at > NOW() - INTERVAL '24 hours'`
    );
    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    const latencyMs = Date.now() - t0;
    if (count === 0) {
      return { status: "ok", message: "No arbitration errors in last 24 h", latencyMs };
    }
    return {
      status: "degraded",
      message: `${count} arbitration error${count > 1 ? "s" : ""} in last 24 h — compliance fence may be impaired`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: `Arbitration check threw: ${err.message}`, latencyMs: Date.now() - t0 };
  }
}
// Provider checks intentionally do not belong in the generic health monitor.
