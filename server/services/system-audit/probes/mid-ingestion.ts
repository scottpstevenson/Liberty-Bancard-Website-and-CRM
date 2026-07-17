import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeMidIngestion(): Promise<ProbeResult> {
  try {
    const [midStats, lastIngestion] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS total_rows,
               MAX(stat_date) AS latest_date,
               COUNT(DISTINCT stat_date) AS distinct_dates
        FROM mid_daily_stats
      `),
      db.execute(sql`
        SELECT action, details, created_at
        FROM audit_logs
        WHERE action LIKE 'mid_ingestion%'
        ORDER BY created_at DESC
        LIMIT 3
      `),
    ]);

    const mid = midStats.rows[0] as any;
    const totalRows = Number(mid?.total_rows ?? 0);
    const latestDate = mid?.latest_date ? new Date(mid.latest_date) : null;
    const distinctDates = Number(mid?.distinct_dates ?? 0);

    const lastLog = (lastIngestion.rows[0] as any) ?? null;
    const lastRunAt = lastLog?.created_at ? new Date(lastLog.created_at) : null;
    const lastRunAgeHours = lastRunAt
      ? (Date.now() - lastRunAt.getTime()) / (1000 * 60 * 60)
      : null;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const hasYesterdayData = latestDate
      ? latestDate.toISOString().slice(0, 10) >= yesterdayStr
      : false;

    let status: ProbeResult["status"] = "ok";
    let summary = `MID stats: ${totalRows} rows across ${distinctDates} dates. Latest: ${latestDate?.toISOString().slice(0, 10) ?? "none"}`;

    if (totalRows === 0) {
      status = "warn";
      summary = "No MID daily stats found — ingestion may not have run yet";
    } else if (!hasYesterdayData) {
      status = "warn";
      summary = `MID stats missing for yesterday (${yesterdayStr}). Latest date: ${latestDate?.toISOString().slice(0, 10) ?? "none"}`;
    } else if (lastRunAgeHours !== null && lastRunAgeHours > 26) {
      status = "warn";
      summary += ` — ingestion last ran ${Math.round(lastRunAgeHours)}h ago (expected < 26h)`;
    }

    return {
      subsystem: "mid-ingestion",
      status,
      summary,
      details: {
        totalRows,
        distinctDates,
        latestDate: latestDate?.toISOString().slice(0, 10) ?? null,
        hasYesterdayData,
        lastIngestionAt: lastRunAt?.toISOString() ?? null,
        lastRunAgeHours: lastRunAgeHours != null ? Math.round(lastRunAgeHours) : null,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "mid-ingestion",
      status: "error",
      summary: `MID ingestion probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
