import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";

export async function probeSequences(): Promise<ProbeResult> {
  try {
    const [seqRows, enrollRows, recentDelivery] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'active') AS active,
               COUNT(*) FILTER (WHERE status = 'paused') AS paused
        FROM follow_up_sequences
      `),
      db.execute(sql`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'active') AS active,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM sequence_enrollments
        WHERE created_at > NOW() - INTERVAL '7 days'
      `),
      db.execute(sql`
        SELECT COUNT(*) AS sent_last_24h
        FROM outbound_messages
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND status IN ('sent', 'delivered')
      `),
    ]);

    const seqStats = seqRows.rows[0] as any;
    const enrollStats = enrollRows.rows[0] as any;
    const deliveryStats = recentDelivery.rows[0] as any;

    const totalSeqs = Number(seqStats?.total ?? 0);
    const activeSeqs = Number(seqStats?.active ?? 0);
    const pausedSeqs = Number(seqStats?.paused ?? 0);
    const activeEnrollments = Number(enrollStats?.active ?? 0);
    const failedEnrollments = Number(enrollStats?.failed ?? 0);
    const sentLast24h = Number(deliveryStats?.sent_last_24h ?? 0);

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `${activeSeqs}/${totalSeqs} sequences active. ${activeEnrollments} active enrollments. ${sentLast24h} messages sent in 24h`;

    if (failedEnrollments > 50) {
      status = "error";
      summary = `${failedEnrollments} failed enrollments in the last 7 days`;
    } else if (failedEnrollments > 10) {
      status = "warn";
      summary += `. Warning: ${failedEnrollments} failed enrollments (7d)`;
    }

    return {
      subsystem: "sequences",
      status,
      summary,
      details: {
        totalSequences: totalSeqs,
        activeSequences: activeSeqs,
        pausedSequences: pausedSeqs,
        activeEnrollments7d: activeEnrollments,
        failedEnrollments7d: failedEnrollments,
        sentLast24h,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "sequences",
      status: "error",
      summary: `Sequences probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
