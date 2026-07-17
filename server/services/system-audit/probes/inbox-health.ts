import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";

export async function probeInboxHealth(): Promise<ProbeResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE is_active = false) AS paused,
        COUNT(*) FILTER (WHERE health_score IS NOT NULL AND health_score < 40) AS unhealthy,
        ROUND(AVG(health_score)::numeric, 1) AS avg_health_score,
        SUM(emails_sent_today) AS emails_sent_today,
        SUM(emails_sent_week) AS emails_sent_week
      FROM sending_identities
    `);

    const stats = rows.rows[0] as any;
    const total = Number(stats?.total ?? 0);
    const active = Number(stats?.active ?? 0);
    const paused = Number(stats?.paused ?? 0);
    const unhealthy = Number(stats?.unhealthy ?? 0);
    const avgHealth = stats?.avg_health_score ? Number(stats.avg_health_score) : null;
    const sentToday = Number(stats?.emails_sent_today ?? 0);
    const sentWeek = Number(stats?.emails_sent_week ?? 0);

    if (total === 0) {
      return {
        subsystem: "inbox-health",
        status: "warn",
        summary: "No sending identities configured",
        details: { total: 0 },
      };
    }

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `${active}/${total} inboxes active. Avg health: ${avgHealth ?? "N/A"}. Sent today: ${sentToday}`;

    if (unhealthy > 0 && unhealthy >= active) {
      status = "error";
      summary = `All active inboxes unhealthy (${unhealthy}/${active}). Deliverability at risk`;
    } else if (unhealthy > 0) {
      status = "warn";
      summary += `. ${unhealthy} unhealthy inbox(es)`;
    } else if (active === 0) {
      status = "error";
      summary = `No active sending inboxes — all ${paused} paused`;
    }

    return {
      subsystem: "inbox-health",
      status,
      summary,
      details: {
        total,
        active,
        paused,
        unhealthy,
        avgHealthScore: avgHealth,
        emailsSentToday: sentToday,
        emailsSentWeek: sentWeek,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "inbox-health",
      status: "error",
      summary: `Inbox health probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
