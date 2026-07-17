import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";

export async function probeEnrichment(): Promise<ProbeResult> {
  try {
    const [enrichmentStats, leadScoring] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS created_24h,
          COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours') AS completed_24h
        FROM enrichment_jobs
      `),
      db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'pending_enqueue') AS pending_enqueue,
          COUNT(*) FILTER (WHERE status = 'failed_terminal') AS failed_terminal
        FROM contact_lead_scoring_jobs
        WHERE created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const enrich = enrichmentStats.rows[0] as any;
    const scoring = leadScoring.rows[0] as any;

    const pending = Number(enrich?.pending ?? 0);
    const failed = Number(enrich?.failed ?? 0);
    const completed24h = Number(enrich?.completed_24h ?? 0);
    const scoringFailed = Number(scoring?.failed_terminal ?? 0);

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `Enrichment: ${completed24h} completed in 24h, ${pending} pending. Lead scoring: ${scoringFailed} failed (7d)`;

    if (failed > 100 || scoringFailed > 50) {
      status = "error";
      summary = `High enrichment failures: ${failed} enrichment, ${scoringFailed} lead scoring`;
    } else if (failed > 20 || pending > 200 || scoringFailed > 10) {
      status = "warn";
      summary += ` — elevated failures/backlog`;
    }

    return {
      subsystem: "enrichment",
      status,
      summary,
      details: {
        enrichmentJobs: {
          total: Number(enrich?.total ?? 0),
          pending,
          completed: Number(enrich?.completed ?? 0),
          failed,
          completed24h,
        },
        leadScoring: {
          total7d: Number(scoring?.total ?? 0),
          pendingEnqueue: Number(scoring?.pending_enqueue ?? 0),
          failedTerminal: scoringFailed,
        },
        serperEnabled: !!process.env.SERPER_API_KEY,
        apolloEnabled: !!process.env.APOLLO_API_KEY,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "enrichment",
      status: "error",
      summary: `Enrichment probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
