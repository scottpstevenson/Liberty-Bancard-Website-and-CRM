import { db } from "../../db";
import { sql } from "drizzle-orm";
import { probeGhlSync, type ProbeResult } from "./probes/ghl-sync";
import { probeQueues } from "./probes/queues";
import { probeSequences } from "./probes/sequences";
import { probeDatabase } from "./probes/database";
import { probeEnrichment } from "./probes/enrichment";
import { probeInboxHealth } from "./probes/inbox-health";
import { probeAiOps } from "./probes/ai-ops";
import { probeGhlAuth } from "./probes/ghl-auth";
import { probeGhlFields } from "./probes/ghl-fields";
import { probeComplianceEngine } from "./probes/compliance-engine";
import { probeSdrPipeline } from "./probes/sdr-pipeline";
import { probeContactability } from "./probes/contactability";
import { probeOnboardingPipeline } from "./probes/onboarding-pipeline";
import { probeMidIngestion } from "./probes/mid-ingestion";
import { probeRoleGuards } from "./probes/role-guards";
import { probeAiAdvisor } from "./probes/ai-advisor";
import { probeGhlWorkflowRegistry } from "./probes/ghl-workflow-registry";
import { probeAnomalyDetection } from "./probes/anomaly-detection";
import { probePublicFormEndpoints } from "./probes/public-form-endpoints";
import { synthesizeNarrative } from "./synthesize";
import { sendAuditReport } from "./slack-notifier";

export type AuditTrigger = "schedule" | "manual" | "critical";

export interface AuditRunResult {
  runId: number;
  status: "completed" | "failed";
  probeResults: ProbeResult[];
  overallScore: number;
  narrative: string | null;
  slackStatus: string;
  durationMs: number;
}

function calcOverallScore(probeResults: ProbeResult[]): number {
  if (probeResults.length === 0) return 0;
  const passing = probeResults.filter(p => p.status === "ok").length;
  return Math.round((passing / probeResults.length) * 100);
}

async function isConcurrentRunActive(): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM system_audit_runs
    WHERE ran_at > NOW() - INTERVAL '10 minutes'
    ORDER BY ran_at DESC
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

export async function runSystemAudit(
  triggeredBy: AuditTrigger = "schedule",
  triggeredByUserId?: number
): Promise<AuditRunResult> {
  if (await isConcurrentRunActive()) {
    console.log("[SystemAudit] Skipping — a run completed within the last 10 minutes");
    return {
      runId: -1,
      status: "failed",
      probeResults: [],
      overallScore: 0,
      narrative: null,
      slackStatus: "skipped",
      durationMs: 0,
    };
  }

  const startMs = Date.now();

  const insertResult = await db.execute(sql`
    INSERT INTO system_audit_runs (triggered_by, ran_at, overall_score, slack_status)
    VALUES (${triggeredBy}, NOW(), 0, 'skipped')
    RETURNING id
  `);
  const runId: number = (insertResult.rows[0] as any).id;

  try {
    console.log(`[SystemAudit] Run #${runId} started (trigger: ${triggeredBy})`);

    const settled = await Promise.allSettled([
      probeDatabase(),
      probeGhlAuth(),
      probeGhlSync(),
      probeQueues(),
      probeSequences(),
      probeEnrichment(),
      probeInboxHealth(),
      probeAiOps(),
      probeGhlFields(),
      probeComplianceEngine(),
      probeSdrPipeline(),
      probeContactability(),
      probeOnboardingPipeline(),
      probeMidIngestion(),
      probeRoleGuards(),
      probeAiAdvisor(),
      probeGhlWorkflowRegistry(),
      probeAnomalyDetection(),
      probePublicFormEndpoints(),
    ]);

    const probeResults: ProbeResult[] = settled.map((result, idx) => {
      const names = [
        "database", "ghl-auth", "ghl-sync", "queues", "sequences",
        "enrichment", "inbox-health", "ai-ops", "ghl-fields", "compliance-engine",
        "sdr-pipeline", "contactability", "onboarding-pipeline", "mid-ingestion",
        "role-guards", "ai-advisor", "ghl-workflow-registry", "anomaly-detection",
        "public-form-endpoints",
      ];
      if (result.status === "fulfilled") return result.value;
      return {
        subsystem: names[idx] ?? `probe-${idx}`,
        status: "error" as const,
        summary: `Probe threw: ${result.reason?.message ?? "unknown error"}`,
        details: { error: String(result.reason) },
      };
    });

    const overallScore = calcOverallScore(probeResults);
    const narrative = await synthesizeNarrative(probeResults);

    const slackResult = await sendAuditReport({ runId, probeResults, overallScore, narrative });
    const slackStatus: string =
      slackResult.status === "not_configured" ? "skipped" : slackResult.status;

    const durationMs = Date.now() - startMs;

    await db.execute(sql`
      UPDATE system_audit_runs
      SET probe_results      = ${JSON.stringify(probeResults)}::jsonb,
          claude_narrative   = ${narrative},
          slack_status       = ${slackStatus},
          overall_score      = ${overallScore},
          ran_at             = NOW()
      WHERE id = ${runId}
    `);

    await db.execute(sql`
      INSERT INTO audit_logs (action, entity_type, entity_id, details)
      VALUES ('system_audit_completed', 'system', ${runId}, ${JSON.stringify((await import("../audit-sanitizer")).sanitizeAuditPayload({
        runId,
        triggeredBy,
        durationMs,
        overallScore,
        overallStatus: probeResults.some(p => p.status === "error")
          ? "critical"
          : probeResults.some(p => p.status === "warn")
          ? "degraded"
          : "healthy",
        probeCount: probeResults.length,
        passingCount: probeResults.filter(p => p.status === "ok").length,
        slackStatus,
      }))}::jsonb)
    `);

    console.log(
      `[SystemAudit] Run #${runId} completed in ${durationMs}ms. ` +
      `Score: ${overallScore}%. Slack: ${slackStatus}`
    );

    return {
      runId,
      status: "completed",
      probeResults,
      overallScore,
      narrative,
      slackStatus,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    console.error(`[SystemAudit] Run #${runId} failed:`, err.message);

    await db.execute(sql`
      UPDATE system_audit_runs
      SET slack_status = 'skipped',
          overall_score = 0
      WHERE id = ${runId}
    `).catch(() => {});

    return {
      runId,
      status: "failed",
      probeResults: [],
      overallScore: 0,
      narrative: null,
      slackStatus: "skipped",
      durationMs,
    };
  }
}
