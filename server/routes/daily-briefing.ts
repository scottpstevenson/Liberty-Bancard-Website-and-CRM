/**
 * Daily Briefing Route — GET /api/overview/daily-briefing
 *
 * Returns a morning briefing for the authenticated user:
 * - Tasks due today
 * - Overdue SLA alerts
 * - Unread inbox messages
 * - Hot leads (score >= 70) ready for outreach
 * - Yesterday's closed/won deals
 * - AI-generated 2-3 sentence morning summary (cached per user per calendar day)
 *
 * Admins/managers get team-wide numbers; agents/reps see only their own pipeline.
 */
import type { Express } from "express";
import { isDashboardUser } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import { serverError } from "../utils/server-error";
import { queryCr04ReadyProjection } from "../services/cr04-cohort-ready-authority";

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

async function generateAiBriefing(stats: {
  tasksDueToday: number;
  overdueSlaCount: number;
  unreadCount: number;
  outreachReadyCount: number | null;
  closedWonYesterday: number;
  role: string;
}): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) return null;

  try {
    const prompt = `You are a brief morning briefing assistant for a payment processing sales team.

Based on the following stats, write a concise 2-3 sentence morning summary to orient the rep for today. Be specific, encouraging, and action-oriented. Focus on what matters most.

Stats:
- Tasks due today: ${stats.tasksDueToday}
- Overdue SLA alerts: ${stats.overdueSlaCount}
- Unread messages: ${stats.unreadCount}
- Leads ready for outreach: ${stats.outreachReadyCount}
- Deals closed/won yesterday: ${stats.closedWonYesterday}
- User role: ${stats.role}

Write only the summary, no headers or labels.`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function buildDailyBriefing(user: any, bypassCache = false) {
      const userId = String(user?.id || "");
      const userEmail = String(user?.email || "");
      const role = user?.role || "agent";
      const isAdminOrManager = role === "admin" || role === "manager";
      const sectionStatus: Record<string, "ok" | "degraded"> = {};

      // Check cache: per user per calendar day
      // V2 avoids serving the old hot-lead contract after the shared
      // Ready-for-Outreach membership predicate replaced it.
      const cacheKey = `daily_briefing_v2_${userId}_${getTodayStr()}`;
      const cached = await storage.getSystemSetting(cacheKey);
      if (!bypassCache && cached && typeof cached === "object" && (cached as any).generatedAt) {
        return cached;
      }

      const todayRange = getTodayRange();
      const yesterdayRange = getYesterdayRange();

      // ── 1. Tasks due today ──────────────────────────────────────────────────
      let tasksDueToday = 0;
      try {
        const taskRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM tasks
          WHERE status NOT IN ('completed', 'cancelled')
            AND due_date >= ${todayRange.start.toISOString()}
            AND due_date < ${todayRange.end.toISOString()}
            ${!isAdminOrManager ? sql`AND (assigned_to = ${userEmail} OR created_by = ${userEmail})` : sql``}
        `);
        tasksDueToday = Number((taskRows.rows[0] as any)?.cnt || 0);
        sectionStatus.tasks = "ok";
      } catch { sectionStatus.tasks = "degraded"; }

      // ── 2. Overdue SLA alerts ───────────────────────────────────────────────
      let overdueSlaCount = 0;
      try {
        const slaRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM inbox_items
          WHERE sla_due_at < NOW()
            AND status NOT IN ('resolved', 'escalated')
            ${!isAdminOrManager ? sql`AND owner_id = ${userEmail}` : sql``}
        `);
        overdueSlaCount = Number((slaRows.rows[0] as any)?.cnt || 0);
        sectionStatus.sla = "ok";
      } catch { sectionStatus.sla = "degraded"; }

      // ── 3. Unread messages (inbox items) ────────────────────────────────────
      // We use a simple proxy from audit_logs for inbound unread
      let unreadCount = 0;
      try {
        const unreadRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM audit_logs
          WHERE action IN ('inbound_message_processed', 'inbound_email_received', 'email_inbound')
            AND created_at >= ${todayRange.start.toISOString()}
        `);
        unreadCount = Number((unreadRows.rows[0] as any)?.cnt || 0);
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
      let closedWonYesterday = 0;
      try {
        const wonRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM deals
          WHERE stage = 'Closed Won'
            AND updated_at >= ${yesterdayRange.start.toISOString()}
            AND updated_at < ${yesterdayRange.end.toISOString()}
            ${!isAdminOrManager ? sql`AND owner = ${userEmail}` : sql``}
        `);
        closedWonYesterday = Number((wonRows.rows[0] as any)?.cnt || 0);
        sectionStatus.closedWon = "ok";
      } catch { sectionStatus.closedWon = "degraded"; }

      // ── 6. Overdue tasks count ───────────────────────────────────────────────
      let overdueTaskCount = 0;
      try {
        const overdueRows = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM tasks
          WHERE status NOT IN ('completed', 'cancelled')
            AND due_date < NOW()
            ${!isAdminOrManager ? sql`AND (assigned_to = ${userEmail} OR created_by = ${userEmail})` : sql``}
        `);
        overdueTaskCount = Number((overdueRows.rows[0] as any)?.cnt || 0);
        sectionStatus.overdueTasks = "ok";
      } catch { sectionStatus.overdueTasks = "degraded"; }

      // ── 7. AI morning summary ────────────────────────────────────────────────
      const aiSummary = await generateAiBriefing({
        tasksDueToday,
        overdueSlaCount,
        unreadCount,
        outreachReadyCount,
        closedWonYesterday,
        role,
      });

      const briefing = {
        tasksDueToday,
        overdueTaskCount,
        overdueSlaCount,
        unreadCount,
        outreachReadyCount,
        closedWonYesterday,
        aiSummary,
        role,
        generatedAt: new Date().toISOString(),
        dateKey: getTodayStr(),
        sectionStatus,
      };

      // Cache for the calendar day (expire at next midnight ~28 hours max)
      storage.setSystemSetting(cacheKey, briefing).catch(() => {});

      return briefing;
}

export function registerDailyBriefingRoutes(app: Express) {
  // GET /api/overview/daily-briefing
  app.get("/api/overview/daily-briefing", isDashboardUser, async (req, res) => {
    try {
      res.json(await buildDailyBriefing(req.user as any));
    } catch (err: any) {
      console.error("[DailyBriefing] error:", err.message);
      serverError(res, err);
    }
  });

  // POST /api/overview/daily-briefing/refresh — force refresh (skip cache)
  app.post("/api/overview/daily-briefing/refresh", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = String(user?.id || "");
      const cacheKey = `daily_briefing_v2_${userId}_${getTodayStr()}`;
      await storage.setSystemSetting(cacheKey, null).catch(() => {});
      res.json(await buildDailyBriefing(user, true));
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
