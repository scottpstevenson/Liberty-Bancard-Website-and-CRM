import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";

export async function probeAiOps(): Promise<ProbeResult> {
  try {
    const [aiOpsStats, classifyStats] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE action = 'scheduled_ai_ops' AND created_at > NOW() - INTERVAL '7 days') AS ai_ops_runs_7d,
          COUNT(*) FILTER (WHERE action = 'scheduled_ai_ops' AND created_at > NOW() - INTERVAL '24 hours') AS ai_ops_runs_24h,
          COUNT(*) FILTER (WHERE action LIKE 'ai_%' AND created_at > NOW() - INTERVAL '24 hours') AS ai_actions_24h,
          MAX(created_at) FILTER (WHERE action = 'scheduled_ai_ops') AS last_ai_ops_at
        FROM audit_logs
      `),
      db.execute(sql`
        SELECT
          COUNT(*) AS total_classified_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS classified_24h
        FROM sdr_lead_events
        WHERE event_type = 'intent_classified'
          AND created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const aiOps = aiOpsStats.rows[0] as any;
    const classify = classifyStats.rows[0] as any;

    const aiOpsRuns7d = Number(aiOps?.ai_ops_runs_7d ?? 0);
    const aiOpsRuns24h = Number(aiOps?.ai_ops_runs_24h ?? 0);
    const aiActions24h = Number(aiOps?.ai_actions_24h ?? 0);
    const lastAiOpsAt = aiOps?.last_ai_ops_at ? new Date(aiOps.last_ai_ops_at).toISOString() : null;
    const classifiedTotal7d = Number(classify?.total_classified_7d ?? 0);
    const classified24h = Number(classify?.classified_24h ?? 0);

    const openAiEnabled = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `AI Ops: ${aiOpsRuns7d} runs in 7d (${aiOpsRuns24h} today). ${classifiedTotal7d} leads classified (7d)`;

    if (!openAiEnabled) {
      status = "warn";
      summary = "OpenAI not configured — AI ops, enrichment, and intent classification disabled";
    } else if (aiOpsRuns7d === 0) {
      status = "warn";
      summary = "No scheduled AI ops runs recorded in 7 days";
    }

    return {
      subsystem: "ai-ops",
      status,
      summary,
      details: {
        openAiEnabled,
        aiOpsRuns7d,
        aiOpsRuns24h,
        aiActions24h,
        lastAiOpsAt,
        intentClassified7d: classifiedTotal7d,
        intentClassified24h: classified24h,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "ai-ops",
      status: "error",
      summary: `AI ops probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
