import { db } from "../db";
import { sql } from "drizzle-orm";

export interface SystemAuditRunInsert {
  triggeredBy?: string;
  overallScore?: number;
  probeResults?: unknown;
  claudeNarrative?: string | null;
  slackStatus?: string;
}

export class SystemAuditStorage {
  async insertSystemAuditRun(data: SystemAuditRunInsert): Promise<{ id: number }> {
    const result = await db.execute(sql`
      INSERT INTO system_audit_runs
        (triggered_by, overall_score, probe_results, claude_narrative, slack_status, ran_at)
      VALUES (
        ${data.triggeredBy ?? "schedule"},
        ${data.overallScore ?? 0},
        ${data.probeResults ? JSON.stringify(data.probeResults) : null}::jsonb,
        ${data.claudeNarrative ?? null},
        ${data.slackStatus ?? "skipped"},
        NOW()
      )
      RETURNING id
    `);
    return { id: (result.rows[0] as any).id };
  }

  async getSystemAuditRuns(limit = 10): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT id, triggered_by, ran_at, overall_score,
             probe_results, claude_narrative, slack_status, created_at
      FROM system_audit_runs
      ORDER BY ran_at DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async getSystemAuditRun(id: number): Promise<any | null> {
    const result = await db.execute(sql`
      SELECT id, triggered_by, ran_at, overall_score,
             probe_results, claude_narrative, slack_status, created_at
      FROM system_audit_runs
      WHERE id = ${id}
    `);
    return (result.rows[0] as any) ?? null;
  }
}
