/**
 * Daily Briefing Route — GET /api/overview/daily-briefing
 *
 * Returns a morning briefing for the authenticated user:
 * - Tasks due today
 * - Overdue SLA alerts
 * - Scoped contact inbound audit events (not unread messages)
 * - Hot leads (score >= 70) ready for outreach
 * - Yesterday's closed/won deals
 * - Deterministic factual summary, labelled daily snapshot
 *
 * Admins/managers get team-wide numbers; agents/reps see only their own pipeline.
 */
import type { Express } from "express";
import { isDashboardUser } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import { briefingFactsSummary, type BriefingFacts } from "@shared/briefing-facts";
import { serverError } from "../utils/server-error";
import { queryCr04ReadyProjection } from "../services/cr04-cohort-ready-authority";
import { taskReadPredicate, readTaskMetrics } from "../services/task-read-authority";
import { dealReadPredicate } from "../services/revenue-read-authority";
import { crmFactRevision } from "../services/crm-fact-freshness";
import { crmDayWindow } from "@shared/crm-time-window";

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

function getYesterdayRange(): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

function getTodayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function generateAiBriefing(stats: BriefingFacts): Promise<string> {
  // Kept as a compatibility name; this factual summary invokes no AI transport.
  return briefingFactsSummary(stats);
}

async function buildDailyBriefing(user: any, bypassCache = false, timezone="UTC") {
      const userId = String(user?.id || "");
      const userEmail = String(user?.email || "");
      const role = user?.role || "agent";
      const isAdminOrManager = role === "admin" || role === "manager";
      const sectionStatus: Record<string, "ok" | "degraded"> = {};

      // Check cache: per user per calendar day
      // V4 versions the null/degraded/scoped-event factual contract.
      const day=crmDayWindow(new Date(),timezone);
      const cacheKey = `daily_briefing_v5_${userId}_${role}_${timezone}_${day.start.toISOString()}`;
      const factRevision = await crmFactRevision();
      const cached = await storage.getSystemSetting(cacheKey);
      if (!bypassCache && cached && typeof cached === "object" && (cached as any).generatedAt &&
        (cached as any).factRevision === factRevision) {
        return cached;
      }

      const todayRange = {start:day.start,end:day.endExclusive};
      const yesterdayRange = getYesterdayRange();
      const taskAsOf = new Date();
      const taskScope = { actor: user, asOf: taskAsOf, timezone };

      // ── 1. Tasks due today ──────────────────────────────────────────────────
      let tasksDueToday: number | null = null;
      try {
        const taskRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM tasks
          WHERE ${taskReadPredicate({ ...taskScope, states: ["open", "in_progress"],
            dueFrom: todayRange.start, dueBefore: todayRange.end })}
        `);
        tasksDueToday = Number((taskRows.rows[0] as any)?.cnt || 0);
        sectionStatus.tasks = "ok";
      } catch { sectionStatus.tasks = "degraded"; }

      // ── 2. Overdue SLA alerts ───────────────────────────────────────────────
      let overdueSlaCount: number | null = null;
      try {
        const slaRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM inbox_items i
          JOIN contacts c ON c.id=i.contact_id
          WHERE i.sla_due_at < ${taskAsOf.toISOString()}
            AND i.status NOT IN ('resolved', 'escalated')
            AND c.archived_at IS NULL AND c.record_class='production'
            ${!isAdminOrManager ? sql`AND c.assigned_to = ${userEmail}` : sql``}
        `);
        overdueSlaCount = Number((slaRows.rows[0] as any)?.cnt || 0);
        sectionStatus.sla = "ok";
      } catch { sectionStatus.sla = "degraded"; }

      // ── 3. Scoped contact inbound audit events today (NOT unread messages) ──
      let inboundEventCount: number | null = null;
      const unreadCount = null; // legacy DTO compatibility; never a proxy count
      try {
        const unreadRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM audit_logs a
          JOIN contacts c ON a.entity_type='contact' AND a.entity_id=c.id
          WHERE a.action IN ('inbound_message_processed', 'inbound_email_received', 'email_inbound')
            AND a.created_at >= ${todayRange.start.toISOString()}
            AND a.created_at <= ${taskAsOf.toISOString()}
            AND c.archived_at IS NULL AND c.record_class='production'
            ${!isAdminOrManager ? sql`AND c.assigned_to = ${userEmail}` : sql``}
        `);
        inboundEventCount = Number((unreadRows.rows[0] as any)?.cnt || 0);
        sectionStatus.inbox = "ok";
      } catch { sectionStatus.inbox = "degraded"; }

      // ── 4. Hot leads ready for outreach ─────────────────────────────────────
      let outreachReadyCount: number | null = null;
      try {
        const role = user?.role as "admin" | "manager" | "agent";
        const ready = await queryCr04ReadyProjection({
          scope: { role, actorId: String(user?.id ?? userEmail), email: userEmail },
          filters: { channel: "email", score: "hot" },
          limit: 1,
        });
        outreachReadyCount = ready.exactTotal ? ready.total : null;
        sectionStatus.outreach = ready.exactTotal ? "ok" : "degraded";
      } catch { sectionStatus.outreach = "degraded"; }

      // ── 5. Yesterday's closed/won deals ─────────────────────────────────────
      let closedWonYesterday: number | null = null;
      try {
        const values: unknown[] = [yesterdayRange.start, yesterdayRange.end];
        const predicate = dealReadPredicate(user, {}, values);
        const wonRows = await pool.query(`
          SELECT COUNT(*) AS cnt FROM deals d
          WHERE stage = 'Closed Won'
            AND closed_at >= $1 AND closed_at < $2 AND ${predicate}
        `, values);
        closedWonYesterday = Number((wonRows.rows[0] as any)?.cnt || 0);
        sectionStatus.closedWon = "ok";
      } catch { sectionStatus.closedWon = "degraded"; }

      // ── 6. Overdue tasks count ───────────────────────────────────────────────
      let overdueTaskCount: number | null = null;
      try {
        const overdueRows = await readTaskMetrics(taskScope);
        overdueTaskCount = Number(overdueRows.rows[0]?.overdue);
        sectionStatus.overdueTasks = "ok";
      } catch { sectionStatus.overdueTasks = "degraded"; }

      // ── 7. Deterministic factual summary; no model/transport ─────────────────
      const aiSummary = await generateAiBriefing({
        tasksDueToday,
        overdueTaskCount,
        overdueSlaCount,
        inboundEventCount,
        outreachReadyCount,
        closedWonYesterday,
      });

      const briefing = {
        factRevision,
        tasksDueToday,
        overdueTaskCount,
        overdueSlaCount,
        unreadCount,
        inboundEventCount,
        outreachReadyCount,
        closedWonYesterday,
        aiSummary,
        role,
        generatedAt: new Date().toISOString(),
        dateKey: getTodayStr(),
        sectionStatus,
        factPopulation: { inbox: "authorized_production_contact_inbound_audit_events_today",
          closedWon: "closed_at_yesterday", asOf: taskAsOf.toISOString(), snapshot: "separate_statements" },
        taskMetricContract: { version: 1, population: "scoped_non_deleted_tasks", recordClass: "production",
          asOf: taskAsOf.toISOString(), timezone: taskScope.timezone, snapshot: "separate_statements",
          cachedDailySnapshot: true },
      };

      // Cache for the calendar day (expire at next midnight ~28 hours max)
      storage.setSystemSetting(cacheKey, briefing).catch(() => {});

      return briefing;
}

export function registerDailyBriefingRoutes(app: Express) {
  // GET /api/overview/daily-briefing
  app.get("/api/overview/daily-briefing", isDashboardUser, async (req, res) => {
    try {
      const timezone=typeof req.query.timezone==="string"?req.query.timezone:"UTC";
      try { crmDayWindow(new Date(),timezone); } catch { return res.status(400).json({message:"Valid IANA timezone required"}); }
      res.json(await buildDailyBriefing(req.user as any,false,timezone));
    } catch (err: any) {
      console.error("[DailyBriefing] error:", err.message);
      serverError(res, err);
    }
  });

  // POST /api/overview/daily-briefing/refresh — force refresh (skip cache)
  app.post("/api/overview/daily-briefing/refresh", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const timezone=typeof req.query.timezone==="string"?req.query.timezone:"UTC";
      try { crmDayWindow(new Date(),timezone); } catch { return res.status(400).json({message:"Valid IANA timezone required"}); }
      res.json(await buildDailyBriefing(user, true,timezone));
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
