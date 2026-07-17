import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeSdrPipeline(): Promise<ProbeResult> {
  try {
    const { featureFlags } = await import("../../feature-flags");

    if (!featureFlags.SDR_ENABLED) {
      return {
        subsystem: "sdr-pipeline",
        status: "warn",
        summary: "SDR pipeline is disabled (SDR_ENABLED=false)",
        details: { sdrEnabled: false },
      };
    }

    const [identityRows, eligibleRows, failureRows] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE is_active = true) AS active
        FROM sending_identities
      `),
      db.execute(sql`
        SELECT COUNT(*) AS eligible
        FROM sdr_lead_state
        WHERE stage NOT IN ('DEAD', 'CONVERTED')
          AND next_action_at IS NOT NULL
      `),
      db.execute(sql`
        SELECT COUNT(*) AS failures_24h
        FROM sdr_channel_attempts
        WHERE status = 'failed'
          AND sent_at > NOW() - INTERVAL '24 hours'
      `),
    ]);

    const identities = identityRows.rows[0] as any;
    const total = Number(identities?.total ?? 0);
    const active = Number(identities?.active ?? 0);
    const eligible = Number((eligibleRows.rows[0] as any)?.eligible ?? 0);
    const failures24h = Number((failureRows.rows[0] as any)?.failures_24h ?? 0);

    const {
      isOrchestratorRunning, isGloballyPaused, getGlobalPauseReason,
      getLastSweepTime, getLastSweepErrors,
    } = await import("../../sdr/orchestrator");
    const orchRunning = isOrchestratorRunning();
    const globalPaused = isGloballyPaused();
    const pauseReason = getGlobalPauseReason();
    const lastSweepTime = getLastSweepTime();
    const lastSweepErrors = getLastSweepErrors();

    const sweepStaleMs = lastSweepTime ? Date.now() - lastSweepTime.getTime() : null;
    const sweepStaleHours = sweepStaleMs !== null ? Math.round(sweepStaleMs / 36e5 * 10) / 10 : null;

    let status: ProbeResult["status"] = "ok";
    let summary = `SDR: ${active}/${total} inboxes active, ${eligible} eligible leads, ${failures24h} failures (24h)`;

    if (active === 0) {
      status = "error";
      summary = `SDR has no active sending identities — outreach halted`;
    } else if (globalPaused) {
      status = "warn";
      summary = `SDR globally paused${pauseReason ? ` (${pauseReason})` : ""}. ${eligible} eligible leads waiting`;
    } else if (failures24h > 50) {
      status = "error";
      summary = `SDR high failure rate: ${failures24h} send failures in 24h`;
    } else if (failures24h > 20) {
      status = "warn";
      summary += ` — elevated failure rate`;
    } else if (sweepStaleHours !== null && sweepStaleHours > 4) {
      status = "warn";
      summary += ` — last sweep ${sweepStaleHours}h ago (expected <4h)`;
    }

    return {
      subsystem: "sdr-pipeline",
      status,
      summary,
      details: {
        totalIdentities: total,
        activeIdentities: active,
        eligibleLeads: eligible,
        failures24h,
        orchestratorRunning: orchRunning,
        globallyPaused: globalPaused,
        globalPauseReason: pauseReason || null,
        lastSweepAt: lastSweepTime?.toISOString() ?? null,
        lastSweepAgeHours: sweepStaleHours,
        lastSweepErrors,
        sdrEnabled: featureFlags.SDR_ENABLED,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "sdr-pipeline",
      status: "error",
      summary: `SDR pipeline probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
