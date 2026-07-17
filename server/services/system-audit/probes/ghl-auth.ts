import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeGhlAuth(): Promise<ProbeResult> {
  try {
    const { getGhlCircuitStatus } = await import("../../ghl-sync");
    const circuit = getGhlCircuitStatus();

    const ghlEnabled = !!(
      process.env.GHL_LOCATION_ID && process.env.GHL_PRIVATE_INTEGRATION_TOKEN
    );

    if (!ghlEnabled) {
      return {
        subsystem: "ghl-auth",
        status: "warn",
        summary: "GHL credentials not configured — sync disabled",
        details: { ghlEnabled: false, circuitOpen: false },
      };
    }

    const recentSyncs = await db.execute(sql`
      SELECT action, created_at
      FROM audit_logs
      WHERE action IN ('ghl_sync_tick_complete', 'GHL_CIRCUIT_OPEN')
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const entries = recentSyncs.rows as Array<{ action: string; created_at: Date }>;
    const lastSuccess = entries.find(r => r.action === "ghl_sync_tick_complete");
    const lastCircuitOpen = entries.find(r => r.action === "GHL_CIRCUIT_OPEN");

    const lastSyncAgeMs = lastSuccess
      ? Date.now() - new Date(lastSuccess.created_at).getTime()
      : null;

    const expectedCadenceMs = 5 * 60 * 1000;
    const staleThresholdMs = 15 * 60 * 1000;

    let status: ProbeResult["status"] = "ok";
    let summary = `GHL connected. Circuit: ${circuit.circuitOpen ? "OPEN" : "closed"} (${circuit.consecutiveFailures}/${circuit.threshold} failures). Last sync: ${lastSuccess?.created_at?.toISOString() ?? "never"}`;

    if (circuit.circuitOpen) {
      status = "error";
      summary = `GHL circuit breaker OPEN — ${circuit.consecutiveFailures} consecutive failures. Sync halted.`;
    } else if (lastSyncAgeMs !== null && lastSyncAgeMs > staleThresholdMs) {
      status = "warn";
      summary = `GHL sync stale — last success ${Math.round(lastSyncAgeMs / 60000)}m ago (threshold: ${staleThresholdMs / 60000}m)`;
    } else if (circuit.consecutiveFailures > 0) {
      status = "warn";
      summary += ` — ${circuit.consecutiveFailures} recent failures (not yet open)`;
    }

    return {
      subsystem: "ghl-auth",
      status,
      summary,
      details: {
        ghlEnabled,
        circuitOpen: circuit.circuitOpen,
        consecutiveFailures: circuit.consecutiveFailures,
        threshold: circuit.threshold,
        lastSuccessAt: lastSuccess?.created_at?.toISOString() ?? null,
        lastCircuitOpenAt: lastCircuitOpen?.created_at?.toISOString() ?? null,
        lastSyncAgeMinutes: lastSyncAgeMs != null ? Math.round(lastSyncAgeMs / 60000) : null,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "ghl-auth",
      status: "error",
      summary: `GHL auth probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
