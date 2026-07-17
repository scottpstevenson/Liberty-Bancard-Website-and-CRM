import { db } from "../../../db";
import { sql } from "drizzle-orm";

export interface ProbeResult {
  subsystem: string;
  status: "ok" | "warn" | "error";
  summary: string;
  details: Record<string, unknown>;
}

export async function probeGhlSync(): Promise<ProbeResult> {
  try {
    const rows = await db.execute(sql`
      SELECT action, details, created_at
      FROM audit_logs
      WHERE action IN ('ghl_sync_tick_complete', 'ghl_sync_tick_error', 'ghl_sync_mode')
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const entries = rows.rows as Array<{ action: string; details: unknown; created_at: Date }>;
    const modeRow = entries.find(r => r.action === "ghl_sync_mode");
    const lastSuccess = entries.find(r => r.action === "ghl_sync_tick_complete");
    const lastError = entries.find(r => r.action === "ghl_sync_tick_error");
    const errorRows = entries.filter(r => r.action === "ghl_sync_tick_error");

    const ghlEnabled = !!(process.env.GHL_LOCATION_ID && process.env.GHL_PRIVATE_INTEGRATION_TOKEN);

    if (!ghlEnabled) {
      return {
        subsystem: "ghl-sync",
        status: "warn",
        summary: "GHL credentials not configured — sync disabled",
        details: { ghlEnabled: false },
      };
    }

    const syncMode = (modeRow?.details as any)?.mode ?? "unknown";
    const recentErrors = errorRows.length;
    const lastSuccessAt = lastSuccess?.created_at?.toISOString() ?? null;
    const lastErrorAt = lastError?.created_at?.toISOString() ?? null;

    const lastSuccessAge = lastSuccess
      ? Date.now() - new Date(lastSuccess.created_at).getTime()
      : null;
    const staleThresholdMs = 10 * 60 * 1000;

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `GHL sync active (${syncMode} mode). Last success: ${lastSuccessAt ?? "never"}`;

    if (recentErrors >= 5) {
      status = "error";
      summary = `GHL sync failing — ${recentErrors} recent errors. Last error: ${lastErrorAt}`;
    } else if (recentErrors > 0) {
      status = "warn";
      summary = `GHL sync has ${recentErrors} recent errors but is recovering`;
    } else if (lastSuccessAge !== null && lastSuccessAge > staleThresholdMs) {
      status = "warn";
      summary = `GHL sync stale — last success was ${Math.round(lastSuccessAge / 60000)}m ago`;
    }

    return {
      subsystem: "ghl-sync",
      status,
      summary,
      details: {
        syncMode,
        recentErrors,
        lastSuccessAt,
        lastErrorAt,
        ghlEnabled,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "ghl-sync",
      status: "error",
      summary: `GHL sync probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
