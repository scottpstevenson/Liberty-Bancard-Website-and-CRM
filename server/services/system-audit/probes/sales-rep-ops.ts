import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";
import { featureFlags } from "../../feature-flags";

export async function probeSalesRepOps(): Promise<ProbeResult> {
  const startMs = Date.now();
  try {
    const [knowledgeRows, agentBindingRows, readinessRows] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM knowledge_source_revisions
        WHERE index_state = 'indexed' AND review_state = 'approved'
      `),
      db.execute(sql`
        SELECT COUNT(*) AS conflicts
        FROM (
          SELECT user_id FROM agents WHERE status = 'active' GROUP BY user_id HAVING COUNT(*) > 1
        ) sub
      `),
      db.execute(sql`
        SELECT aggregate_verdict, completed_at, release_sha, config_fingerprint, population_fingerprint
        FROM sales_rep_ops_readiness_runs
        WHERE status = 'complete'
          AND triggered_by_user_id IN (SELECT id FROM users WHERE role = 'admin')
        ORDER BY completed_at DESC
        LIMIT 1
      `),
    ]);

    const knowledgeCount = Number((knowledgeRows.rows[0] as any)?.cnt ?? 0);
    const bindingConflicts = Number((agentBindingRows.rows[0] as any)?.conflicts ?? 0);
    const lastRun = readinessRows.rows[0] as any;
    const lastVerdict: string = lastRun?.aggregate_verdict ?? "none";
    const receiptSha: string | null = lastRun?.release_sha ?? null;
    const callAssistEnabled = featureFlags.CALL_ASSIST_ENABLED;
    const fieldSalesEnabled = featureFlags.FIELD_SALES_ENABLED;

    // Treat absent/unknown RELEASE_SHA as stale: if we cannot identify the running release,
    // any prior PASS receipt is unverifiable and must not be accepted as current certification.
    const currentSha = (process.env.RELEASE_SHA ?? "").trim() || null;
    const receiptStale = !currentSha || !receiptSha || currentSha !== receiptSha;

    const issues: string[] = [];
    if (knowledgeCount === 0) issues.push("no approved+indexed knowledge revision");
    if (bindingConflicts > 0) issues.push(`${bindingConflicts} agent binding conflict(s)`);
    if (callAssistEnabled) issues.push("CALL_ASSIST_ENABLED=true");
    if (fieldSalesEnabled) issues.push("FIELD_SALES_ENABLED=true");
    // Absent, BLOCKED_EXTERNAL, FAIL, or stale receipts all mean not certified
    const verdictIsPass = lastVerdict === "PASS";
    if (!verdictIsPass) issues.push(`last readiness run verdict is ${lastVerdict} (need PASS)`);
    if (receiptStale) issues.push(`stale receipt: cert=${receiptSha?.slice(0, 12)}, running=${currentSha?.slice(0, 12)}`);

    const status: "ok" | "warn" | "error" =
      issues.length === 0 ? "ok" :
      (knowledgeCount === 0 || bindingConflicts > 0 || !verdictIsPass || receiptStale) ? "error" : "warn";

    const flagLine = `CALL_ASSIST=${callAssistEnabled ? "ON" : "off"}, FIELD_SALES=${fieldSalesEnabled ? "ON" : "off"}`;
    const summary = issues.length === 0
      ? `Sales Rep Ops healthy. Knowledge: ${knowledgeCount} approved. ${flagLine}. Last readiness: ${lastVerdict}.`
      : `Sales Rep Ops issues: ${issues.join("; ")}`;

    return {
      subsystem: "sales-rep-ops",
      status,
      summary,
      details: {
        knowledgeRevisionsApproved: knowledgeCount,
        agentBindingConflicts: bindingConflicts,
        callAssistEnabled,
        fieldSalesEnabled,
        lastReadinessVerdict: lastVerdict,
        lastReadinessCompletedAt: lastRun?.completed_at ?? null,
        probeMs: Date.now() - startMs,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "sales-rep-ops",
      status: "error",
      summary: `Sales Rep Ops probe failed: ${err.message}`,
      details: { error: err.message, probeMs: Date.now() - startMs },
    };
  }
}
