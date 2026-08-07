/**
 * Continuous Health Monitor
 * Runs all system-health checks in parallel and persists the result to system_settings.
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
    ai: CheckResult;
    dbBackup: CheckResult;
    kpiQuery: CheckResult;
    outboundPause: CheckResult;
  };
}

export const HEALTH_MONITOR_KEY = "health_monitor_last_result";

// Critical checks — failures make overallOk false
// "ai" is intentionally excluded from critical — AI availability is validated by
// the dedicated AI Assistant Boundaries suite.  The custom AI_INTEGRATIONS_OPENAI_BASE_URL
// may use a different auth scheme that returns 401 in CI/gate contexts.
const CRITICAL_CHECKS = new Set(["db", "sequenceWorker", "redis", "kpiQuery"]);

// In-memory cache of last result
let _lastResult: HealthReport | null = null;

export function getLastHealthResult(): HealthReport | null {
  return _lastResult;
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkDb(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    // Ping + count critical tables
    const [pingResult, countsResult] = await Promise.all([
      db.execute(sql`SELECT 1 AS ping`),
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM contacts)               AS contacts,
          (SELECT COUNT(*) FROM deals)                  AS deals,
          (SELECT COUNT(*) FROM follow_up_sequences)    AS sequences
      `),
    ]);

    const ping = (pingResult.rows[0] as any)?.ping;
    if (!ping) {
      return { status: "error", message: "SELECT 1 returned no rows", latencyMs: Date.now() - t0 };
    }

    const row = countsResult.rows[0] as any;
    const contacts = Number(row?.contacts ?? 0);
    const deals = Number(row?.deals ?? 0);

    const latencyMs = Date.now() - t0;

    if (contacts > 0 && deals > 0) {
      return { status: "ok", message: `contacts=${contacts} deals=${deals}`, latencyMs };
    }
    // Ping succeeded but counts are zero — degraded, not hard error
    return {
      status: "degraded",
      message: `contacts=${contacts} deals=${deals} (zero counts)`,
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
  return checkWorkerTick("sequence_runner_last_tick", 15 * 60 * 1000);
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
          // Try to get the queue manager to initialise the connection
          const { getQueueManager } = await import("./queue-manager");
          const qm = await getQueueManager();
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

async function checkAi(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { status: "error", message: "No OpenAI API key configured", latencyMs: Date.now() - t0 };
    }

    const { checkAiGate: gate, recordAiSpend } = await import("./ai-audit-logger");
    const slot = await gate("gpt-4o-mini");
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    let completion;
    try {
      completion = await Promise.race([
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          max_tokens: 5,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI probe timeout (8s)")), 8000)
        ),
      ]);
    } catch (providerErr) {
      slot.refund();
      throw providerErr;
    }

    const latencyMs = Date.now() - t0;
    const text = (completion.choices[0]?.message?.content ?? "").toLowerCase();
    slot.settle(recordAiSpend("gpt-4o-mini", completion.usage?.prompt_tokens ?? 0, completion.usage?.completion_tokens ?? 0, "system-health"));
    if (text.includes("ok")) {
      return { status: "ok", message: `Responded in ${latencyMs}ms`, latencyMs };
    }
    return { status: "degraded", message: `Unexpected response: "${text.slice(0, 50)}"`, latencyMs };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
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
    const value = await storage.getSystemSetting("outboundGlobalPaused");
    const latencyMs = Date.now() - t0;

    if (value === true || value === false) {
      return { status: "ok", message: `outboundGlobalPaused=${value}`, latencyMs };
    }
    if (value === null || value === undefined) {
      // Key missing — treat as unconfigured but not misconfigured
      return { status: "ok", message: "Key not set (defaults to unpaused)", latencyMs };
    }
    return {
      status: "misconfigured",
      message: `Unexpected value type: ${typeof value} (${String(value).slice(0, 40)})`,
      latencyMs,
    };
  } catch (err: any) {
    return { status: "error", message: err.message, latencyMs: Date.now() - t0 };
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runHealthChecks(): Promise<HealthReport> {
  const runAt = new Date().toISOString();
  const t0 = Date.now();

  // Read previous result for change-detection before running checks
  let previousReport: HealthReport | null = _lastResult;
  if (!previousReport) {
    try {
      const stored = await storage.getSystemSetting(HEALTH_MONITOR_KEY);
      if (stored) previousReport = stored as HealthReport;
    } catch {
      // best-effort
    }
  }

  // Run all checks in parallel
  const [
    dbRes,
    sequenceWorkerRes,
    slaWorkerRes,
    ghlSyncRes,
    redisRes,
    aiRes,
    dbBackupRes,
    kpiQueryRes,
    outboundPauseRes,
  ] = await Promise.allSettled([
    checkDb(),
    checkSequenceWorker(),
    checkSlaWorker(),
    checkGhlSync(),
    checkRedis(),
    checkAi(),
    checkDbBackup(),
    checkKpiQuery(),
    checkOutboundPause(),
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
    ai: settle(aiRes, "ai"),
    dbBackup: settle(dbBackupRes, "dbBackup"),
    kpiQuery: settle(kpiQueryRes, "kpiQuery"),
    outboundPause: settle(outboundPauseRes, "outboundPause"),
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

  // Change-detection: alert if any critical check newly became non-ok
  if (previousReport) {
    const newlyFailed: string[] = [];
    for (const name of CRITICAL_CHECKS) {
      const prev = (previousReport.checks as Record<string, CheckResult>)[name]?.status ?? "unknown";
      const curr = (checks as Record<string, CheckResult>)[name]?.status ?? "unknown";
      const wasOk = ["ok", "stale", "unknown"].includes(prev);
      const isNowBad = !["ok", "stale", "unknown"].includes(curr);
      if (wasOk && isNowBad) newlyFailed.push(name);
    }

    if (newlyFailed.length > 0) {
      // Fire-and-forget alert email
      (async () => {
        try {
          const { sendSmtpEmail } = await import("./smtp-email");
          const recipient = process.env.ADMIN_ALERT_EMAIL || "accounts@libertybancard.com";
          const details = newlyFailed
            .map(n => `  • ${n}: ${(checks as Record<string, CheckResult>)[n]?.status} — ${(checks as Record<string, CheckResult>)[n]?.message ?? ""}`)
            .join("\n");
          await sendSmtpEmail({
            to: recipient,
            subject: `[HealthMonitor] Critical alert — ${newlyFailed.join(", ")} degraded`,
            html: `<pre style="font-family:monospace">HealthMonitor detected new critical failures at ${runAt}:\n\n${details}\n\nOverall ok: ${overallOk}</pre>`,
            category: "internal_ops",
          });
        } catch (emailErr: any) {
          console.warn("[HealthMonitor] Alert email failed (non-fatal):", emailErr.message);
        }
      })().catch(() => {});
    }
  }

  // Threshold alert: if fewer than 3 checks are ok, fire a separate cooldown-gated email
  const okCount = Object.values(checks).filter(c => c.status === "ok").length;
  const HEALTH_LOW_OK_THRESHOLD = 3;
  const HEALTH_LOW_OK_COOLDOWN_KEY = "health_monitor_low_ok_alert_at";
  const HEALTH_LOW_OK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

  if (okCount < HEALTH_LOW_OK_THRESHOLD) {
    (async () => {
      try {
        // Check cooldown
        const lastAlertRaw = await storage.getSystemSetting(HEALTH_LOW_OK_COOLDOWN_KEY);
        const lastAlertAt = lastAlertRaw ? new Date(lastAlertRaw as string).getTime() : 0;
        if (Date.now() - lastAlertAt < HEALTH_LOW_OK_COOLDOWN_MS) {
          return; // still in cooldown
        }
        // Update cooldown before sending to avoid double-fires
        await storage.setSystemSetting(HEALTH_LOW_OK_COOLDOWN_KEY, new Date().toISOString());

        const { sendSmtpEmail } = await import("./smtp-email");
        const recipient = process.env.ADMIN_ALERT_EMAIL || "accounts@libertybancard.com";
        const failingChecks = Object.entries(checks)
          .filter(([, c]) => c.status !== "ok")
          .map(([name, c]) => `  • ${name}: ${c.status} — ${c.message ?? ""}`)
          .join("\n");
        await sendSmtpEmail({
          to: recipient,
          subject: `[HealthMonitor] System health critical — only ${okCount}/9 checks ok`,
          html: `<pre style="font-family:monospace">HealthMonitor: only ${okCount}/9 checks are OK at ${runAt} (threshold: ${HEALTH_LOW_OK_THRESHOLD}).\n\nFailing/degraded checks:\n${failingChecks}\n\nOverall ok: ${overallOk}\nCritical failures: ${criticalFailures.join(", ") || "none"}</pre>`,
          category: "internal_ops",
        });
        console.warn(`[HealthMonitor] Low-ok alert sent: ok=${okCount}/9`);
      } catch (alertErr: any) {
        console.warn("[HealthMonitor] Low-ok alert email failed (non-fatal):", alertErr.message);
      }
    })().catch(() => {});
  }

  // One-line summary log
  const totalMs = Date.now() - t0;
  console.log(
    `[HealthMonitor] ok=${okCount}/9 critical=${CRITICAL_CHECKS.size - criticalFailures.length}/${CRITICAL_CHECKS.size} latencyMs=${totalMs} overallOk=${overallOk}${criticalFailures.length > 0 ? ` failures=[${criticalFailures.join(",")}]` : ""}`
  );

  return report;
}
