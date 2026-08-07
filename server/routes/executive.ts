/**
 * server/routes/executive.ts
 * Executive KPI layer — snapshot retrieval, goal management, manual refresh.
 * All routes require isDashboardUser + requireRole("admin","manager").
 * Goal writes require admin only.
 */

import type { Express } from "express";
import { db } from "../db";
import { desc } from "drizzle-orm";
import { executiveWeeklySnapshots, executiveGoals } from "@shared/schema";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { buildExecutiveSnapshot } from "../services/executive-kpi";
import { generateExecutiveAi } from "../services/executive-ai";
import { serverError } from "../utils/server-error";

export function registerExecutiveRoutes(app: Express) {
  const adminOrManager = requireRole("admin", "manager");

  // GET /api/executive/snapshot
  // Returns the most recent stored snapshot, or computes current week on-the-fly
  app.get("/api/executive/snapshot", isDashboardUser, adminOrManager, async (req, res) => {
    try {
      const [latest] = await db
        .select()
        .from(executiveWeeklySnapshots)
        .orderBy(desc(executiveWeeklySnapshots.weekStart))
        .limit(1);

      // If there's a stored snapshot from this week, return it
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      if (latest && latest.weekStart <= todayStr && latest.createdAt) {
        const snapshotAge = Date.now() - new Date(latest.createdAt).getTime();
        // Serve stored snapshot if < 24 hours old
        if (snapshotAge < 24 * 60 * 60 * 1000) {
          return res.json({ source: "stored", snapshot: latest });
        }
      }

      // Compute on-the-fly (no AI generation for on-the-fly)
      const snap = await buildExecutiveSnapshot(now);
      return res.json({ source: "live", snapshot: snap });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/executive/snapshots?limit=12
  app.get("/api/executive/snapshots", isDashboardUser, adminOrManager, async (req, res) => {
    try {
      const parsed = parseInt((req.query.limit as string) || "12", 10);
      const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 12, 52);
      const rows = await db
        .select()
        .from(executiveWeeklySnapshots)
        .orderBy(desc(executiveWeeklySnapshots.weekStart))
        .limit(limit);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/executive/refresh — admin only
  app.post("/api/executive/refresh", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const snap = await buildExecutiveSnapshot(new Date());
      const aiResult = await generateExecutiveAi(snap);

      // Upsert snapshot
      const [stored] = await db
        .insert(executiveWeeklySnapshots)
        .values({
          weekStart: snap.weekStart,
          closedWonRevenue: snap.closedWonRevenue.toString(),
          grossProfit: snap.grossProfit.toString(),
          netProfit: snap.netProfit.toString(),
          grossMarginPct: snap.grossMarginPct.toString(),
          netMarginPct: snap.netMarginPct.toString(),
          pipelineValue: snap.pipelineValue.toString(),
          newDealsClosed: snap.newDealsClosed,
          proposalsSent: snap.proposalsSent,
          statementsReceived: snap.statementsReceived,
          meetingsBooked: snap.meetingsBooked,
          outreachAttempts: snap.outreachAttempts,
          perRepBreakdown: snap.perRepBreakdown as any,
          goalsVsActuals: snap.goalsVsActuals as any,
          gptBriefing: aiResult.gptBriefing,
          claudeCoaching: aiResult.claudeCoaching as any,
          generatedAt: new Date(),
          trigger: "manual",
        })
        .onConflictDoUpdate({
          target: executiveWeeklySnapshots.weekStart,
          set: {
            closedWonRevenue: snap.closedWonRevenue.toString(),
            grossProfit: snap.grossProfit.toString(),
            netProfit: snap.netProfit.toString(),
            grossMarginPct: snap.grossMarginPct.toString(),
            netMarginPct: snap.netMarginPct.toString(),
            pipelineValue: snap.pipelineValue.toString(),
            newDealsClosed: snap.newDealsClosed,
            proposalsSent: snap.proposalsSent,
            statementsReceived: snap.statementsReceived,
            meetingsBooked: snap.meetingsBooked,
            outreachAttempts: snap.outreachAttempts,
            perRepBreakdown: snap.perRepBreakdown as any,
            goalsVsActuals: snap.goalsVsActuals as any,
            gptBriefing: aiResult.gptBriefing,
            claudeCoaching: aiResult.claudeCoaching as any,
            generatedAt: new Date(),
            trigger: "manual",
            createdAt: new Date(),
          },
        })
        .returning();

      res.json({
        ok: true,
        snapshot: stored,
        aiResult: {
          gptBriefingLength: aiResult.gptBriefing?.length ?? 0,
          coachingCardsGenerated: aiResult.claudeCoaching?.length ?? 0,
          gptError: aiResult.gptError,
          claudeError: aiResult.claudeError,
        },
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/executive/vas-upsell-metrics
  // Returns VAS upsell enrollment rates by vertical for the last N days (default 90).
  // Counts day30_vas_upsell_enrolled vs day30_vas_upsell_blocked_contactability
  // and day30_vas_upsell_skipped from audit_logs to produce a per-vertical funnel.
  app.get("/api/executive/vas-upsell-metrics", isDashboardUser, adminOrManager, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt((req.query.days as string) || "90", 10), 7), 365);

      // Use pool directly for flexibility with jsonb extraction
      const { pool: pgPool } = await import("../db");

      const enrolled = await pgPool.query(`
        SELECT
          COALESCE(details->>'vertical', 'unknown') AS vertical,
          COALESCE(details->>'sequenceName', 'unknown') AS sequence_name,
          COUNT(*) AS enrolled
        FROM audit_logs
        WHERE action = 'day30_vas_upsell_enrolled'
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY 1, 2
        ORDER BY enrolled DESC
      `);

      const blocked = await pgPool.query(`
        SELECT
          COALESCE(details->>'vertical', 'unknown') AS vertical,
          COUNT(*) AS blocked
        FROM audit_logs
        WHERE action = 'day30_vas_upsell_blocked_contactability'
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY 1
        ORDER BY blocked DESC
      `);

      const skipped = await pgPool.query(`
        SELECT
          COALESCE(details->>'reason', 'unknown') AS skip_reason,
          COUNT(*) AS skipped
        FROM audit_logs
        WHERE action = 'day30_vas_upsell_skipped'
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY 1
        ORDER BY skipped DESC
      `);

      const totalEnrolled = enrolled.rows.reduce((s: number, r: any) => s + parseInt(r.enrolled, 10), 0);
      const totalBlocked  = blocked.rows.reduce((s: number, r: any) => s + parseInt(r.blocked, 10), 0);
      const totalSkipped  = skipped.rows.reduce((s: number, r: any) => s + parseInt(r.skipped, 10), 0);
      const totalAttempts = totalEnrolled + totalBlocked + totalSkipped;
      const enrollmentRate = totalAttempts > 0 ? Math.round((totalEnrolled / totalAttempts) * 100) : 0;

      res.json({
        days,
        totalAttempts,
        totalEnrolled,
        totalBlocked,
        totalSkipped,
        enrollmentRate,
        byVertical: enrolled.rows,
        blockedByVertical: blocked.rows,
        skipReasons: skipped.rows,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/executive/goals
  app.get("/api/executive/goals", isDashboardUser, adminOrManager, async (req, res) => {
    try {
      const rows = await db.select().from(executiveGoals);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PUT /api/executive/goals — admin only
  // Body: Array<{ key: string; value: number; periodType?: string }>
  app.put("/api/executive/goals", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const userId = (req.user as any)?.id ?? null;
      const goals: Array<{ key: string; value: number; periodType?: string }> = req.body;

      if (!Array.isArray(goals)) {
        return res.status(400).json({ message: "Body must be an array of goal objects" });
      }

      const results = [];
      for (const g of goals) {
        if (!g.key || g.value == null) continue;
        const [row] = await db
          .insert(executiveGoals)
          .values({
            key: g.key,
            value: g.value.toString(),
            periodType: g.periodType || "weekly",
            setBy: userId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [executiveGoals.key, executiveGoals.periodType],
            set: {
              value: g.value.toString(),
              setBy: userId,
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push(row);
      }

      res.json({ ok: true, goals: results });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
