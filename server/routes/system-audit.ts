import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerSystemAuditRoutes(app: Express) {
  app.get("/api/system-audit/runs", isDashboardUser, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT id, triggered_by, ran_at, overall_score,
               probe_results, claude_narrative, slack_status, created_at
        FROM system_audit_runs
        ORDER BY ran_at DESC
        LIMIT 10
      `);
      res.json(rows.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/system-audit/runs/:id", isDashboardUser, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid run ID" });

      const rows = await db.execute(sql`
        SELECT id, triggered_by, ran_at, overall_score,
               probe_results, claude_narrative, slack_status, created_at
        FROM system_audit_runs
        WHERE id = ${id}
      `);
      if (!rows.rows[0]) return res.status(404).json({ message: "Run not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/system-audit/latest", isDashboardUser, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT id, triggered_by, ran_at, overall_score,
               probe_results, claude_narrative, slack_status, created_at
        FROM system_audit_runs
        ORDER BY ran_at DESC
        LIMIT 1
      `);
      if (!rows.rows[0]) return res.json(null);
      res.json(rows.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/system-audit/run-now", requireRole("admin", "manager"), async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const { runSystemAudit } = await import("../services/system-audit/runner");

      setImmediate(async () => {
        try {
          await runSystemAudit("manual", userId);
        } catch (err: any) {
          console.error("[SystemAudit] Manual run failed:", err.message);
        }
      });

      res.json({
        success: true,
        message: "System audit started — results will appear within 90 seconds",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
