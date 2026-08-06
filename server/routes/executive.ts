/**
 * server/routes/executive.ts
 * Executive KPI layer — snapshot retrieval, goal management, manual refresh.
 * All routes require isDashboardUser + requireRole("admin","manager").
 * Goal writes require admin only.
 */

import { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { executiveWeeklySnapshots, executiveGoals } from "../../shared/schema";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { computeExecSnapshot, persistSnapshot, loadGoals, getWeekBounds, toDateStr } from "../services/executive-kpi";
import { generateGptBriefing, generateClaudeCoaching } from "../services/executive-ai";

export function registerExecutiveRoutes(app: Express): void {

  // ── GET /api/executive/snapshot ─────────────────────────────────────────
  // Returns the latest stored snapshot or computes the current week on-the-fly.
  app.get("/api/executive/snapshot", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { weekStart } = getWeekBounds(new Date());
      const weekStartStr = toDateStr(weekStart);

      // Try to load stored snapshot for current week
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT * FROM executive_weekly_snapshots
        WHERE week_start = ${weekStartStr}
        LIMIT 1
      `);
      const stored = (rows.rows ?? rows as any)[0];

      if (stored) {
        // Return stored snapshot enriched with live goals
        const goals = await loadGoals();
        return res.json({ ...stored, goals, source: "stored" });
      }

      // Compute fresh (no persistence — just return to UI)
      const snap = await computeExecSnapshot(new Date());
      return res.json({ ...snap, source: "live" });
    } catch (err: any) {
      console.error("[Executive] GET /snapshot error:", err.message);
      res.status(500).json({ message: "Failed to load executive snapshot", error: err.message });
    }
  });

  // ── GET /api/executive/snapshots ────────────────────────────────────────
  // Historical snapshots for sparklines (default last 12 weeks).
  app.get("/api/executive/snapshots", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 12), 52);
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT
          week_start, closed_won_volume, closed_won_count,
          gross_margin_pct, net_margin_pct,
          pipeline_value, pipeline_deal_count,
          proposals_sent, statements_received, meetings_booked,
          goals_vs_actuals, ai_generated_at
        FROM executive_weekly_snapshots
        ORDER BY week_start DESC
        LIMIT ${limit}
      `);
      res.json((rows.rows ?? rows as any));
    } catch (err: any) {
      console.error("[Executive] GET /snapshots error:", err.message);
      res.status(500).json({ message: "Failed to load snapshots" });
    }
  });

  // ── POST /api/executive/refresh ─────────────────────────────────────────
  // Admin-only: re-compute current week's snapshot + regenerate AI narratives.
  app.post("/api/executive/refresh", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const snap = await computeExecSnapshot(new Date());

      // Run AI generation concurrently
      const [gptBriefing, claudeCoaching] = await Promise.all([
        generateGptBriefing(snap),
        generateClaudeCoaching(snap),
      ]);

      await persistSnapshot(snap, gptBriefing, claudeCoaching);

      res.json({
        message: "Executive snapshot refreshed",
        weekStart: snap.weekStart,
        aiGenerated: !!(gptBriefing || claudeCoaching),
        gptAvailable: !!gptBriefing,
        claudeAvailable: !!claudeCoaching,
      });
    } catch (err: any) {
      console.error("[Executive] POST /refresh error:", err.message);
      res.status(500).json({ message: "Refresh failed", error: err.message });
    }
  });

  // ── GET /api/executive/goals ─────────────────────────────────────────────
  app.get("/api/executive/goals", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const goals = await loadGoals();
      res.json(goals);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load goals" });
    }
  });

  // ── PUT /api/executive/goals ─────────────────────────────────────────────
  // Admin-only: bulk upsert goals.
  // Body: [{ key, value, period?, label? }]
  app.put("/api/executive/goals", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const updates: { key: string; value: number; period?: string; label?: string }[] = req.body;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: "Body must be a non-empty array of goal updates" });
      }

      const user = (req as any).user;
      for (const u of updates) {
        if (!u.key || typeof u.value !== "number") {
          return res.status(400).json({ message: `Invalid goal entry: ${JSON.stringify(u)}` });
        }
        await db.execute(sql`
          INSERT INTO executive_goals (key, value, period, label, set_by, updated_at)
          VALUES (
            ${u.key}, ${u.value},
            ${u.period ?? "weekly"},
            ${u.label ?? null},
            ${user?.email ?? "admin"},
            NOW()
          )
          ON CONFLICT (key) DO UPDATE SET
            value      = EXCLUDED.value,
            period     = COALESCE(EXCLUDED.period, executive_goals.period),
            label      = COALESCE(EXCLUDED.label, executive_goals.label),
            set_by     = EXCLUDED.set_by,
            updated_at = NOW()
        `);
      }

      const goals = await loadGoals();
      res.json({ message: "Goals updated", goals });
    } catch (err: any) {
      console.error("[Executive] PUT /goals error:", err.message);
      res.status(500).json({ message: "Failed to update goals" });
    }
  });
}
