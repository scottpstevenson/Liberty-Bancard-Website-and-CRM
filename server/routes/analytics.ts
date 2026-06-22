import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { pool } from "../db";
import { contacts, toolClickEvents } from "@shared/schema";
import { isGhlConfigured, sendGhlEmailForMerchant } from "../services/ghl";
import { buildWeeklyDigest } from "../services/digest-service";
import { db } from "../db";
import { agents, deals, leaderboardSettings } from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";

export function registerAnalyticsRoutes(app: Express) {

  // === SALES TOOL CLICK TRACKING ===
  app.post("/api/analytics/tool-click", publicLeadRateLimit, async (req, res) => {
    try {
      const { toolId, toolTitle, source, sessionId } = req.body;
      if (!toolId) return res.status(400).json({ message: "toolId is required" });
      const userId = (req.user as any)?.id?.toString() ?? null;
      await db.insert(toolClickEvents).values({
        toolId,
        toolTitle: toolTitle ?? null,
        source: source ?? "sales-tools-hub",
        userId,
        sessionId: sessionId ?? null,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === AGENT RESIDUAL TIER CONFIG ===
  // Served from the server so rates can be updated without redeploying the frontend.
  app.get("/api/agent-tiers", async (_req, res) => {
    res.json([
      { label: "Starter",  minAccounts: 1,  maxAccounts: 4,  residualBps: 25, bonusLabel: null },
      { label: "Silver",   minAccounts: 5,  maxAccounts: 14, residualBps: 35, bonusLabel: "Priority support" },
      { label: "Gold",     minAccounts: 15, maxAccounts: 29, residualBps: 45, bonusLabel: "Marketing materials" },
      { label: "Platinum", minAccounts: 30, maxAccounts: 59, residualBps: 55, bonusLabel: "Co-branded collateral + bonus" },
      { label: "Elite",    minAccounts: 60, maxAccounts: null, residualBps: 70, bonusLabel: "Dedicated account manager" },
    ]);
  });

  app.get("/api/analytics/tool-clicks", isAuthenticated, async (req, res) => {
    try {
      const rows = await db
        .select({
          toolId: toolClickEvents.toolId,
          toolTitle: toolClickEvents.toolTitle,
          clicks: count(toolClickEvents.id),
        })
        .from(toolClickEvents)
        .groupBy(toolClickEvents.toolId, toolClickEvents.toolTitle)
        .orderBy(desc(count(toolClickEvents.id)));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Upload attribution by utm_content — shows which agent-shared tool links drove statement uploads
  app.get("/api/analytics/tool-upload-attribution", isAuthenticated, async (req, res) => {
    try {
      const rows = await db
        .select({
          utmContent: contacts.utmContent,
          uploads: count(contacts.id),
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.utmSource, "agent"),
            sql`${contacts.utmContent} IS NOT NULL`
          )
        )
        .groupBy(contacts.utmContent)
        .orderBy(desc(count(contacts.id)));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === KPI DASHBOARD ===
  app.get("/api/kpi/summary", isAuthenticated, async (req, res) => {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        dealStageRows,
        closedWonRow,
        closedLostRow,
        newLeads30dRow,
        newLeads7dRow,
        onboardingRows,
        openTicketsRow,
        breachedTicketsRow,
        pendingTasksRow,
        overdueTasksRow,
        totalContactsRow,
        newContacts30dRow,
        revenueRow,
      ] = await Promise.all([
        pool.query<{ stage: string; cnt: string }>(`
          SELECT stage, COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales'
          GROUP BY stage
        `),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales' AND stage = 'Closed Won'
            AND closed_at >= $1
        `, [thirtyDaysAgo]),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales' AND stage = 'Closed Lost'
            AND closed_at >= $1
        `, [thirtyDaysAgo]),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales' AND created_at >= $1
        `, [thirtyDaysAgo]),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales' AND created_at >= $1
        `, [sevenDaysAgo]),
        pool.query<{ stage: string; cnt: string }>(`
          SELECT stage, COUNT(*)::text AS cnt FROM deals
          WHERE archived_at IS NULL AND pipeline = 'onboarding'
          GROUP BY stage
        `),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM tickets
          WHERE status NOT IN ('Resolved', 'Closed')
        `),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM tickets
          WHERE sla_deadline < $1 AND resolved_at IS NULL
            AND status NOT IN ('Resolved', 'Closed')
        `, [now]),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM tasks WHERE status = 'pending'
        `),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM tasks WHERE status = 'pending' AND due_date < $1
        `, [now]),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM contacts WHERE archived_at IS NULL
        `),
        pool.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM contacts WHERE archived_at IS NULL AND created_at >= $1
        `, [thirtyDaysAgo]),
        pool.query<{ total_volume: string; total_residual: string; total_profit: string; deal_count: string }>(`
          SELECT
            COALESCE(SUM(CASE WHEN estimated_processing_volume IS NOT NULL AND estimated_processing_volume != ''
              THEN CAST(REGEXP_REPLACE(estimated_processing_volume, '[^0-9.]', '', 'g') AS DECIMAL) ELSE 0 END), 0)::text AS total_volume,
            COALESCE(SUM(CASE WHEN estimated_residual IS NOT NULL AND estimated_residual != ''
              THEN CAST(REGEXP_REPLACE(estimated_residual, '[^0-9.]', '', 'g') AS DECIMAL) ELSE 0 END), 0)::text AS total_residual,
            (SELECT COALESCE(SUM(CASE WHEN estimated_gross_profit_monthly IS NOT NULL AND estimated_gross_profit_monthly != ''
              THEN CAST(REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') AS DECIMAL) ELSE 0 END), 0)
             FROM deals WHERE archived_at IS NULL)::text AS total_profit,
            (SELECT COUNT(*) FROM deals WHERE archived_at IS NULL)::text AS deal_count
          FROM contacts WHERE archived_at IS NULL
        `),
      ]);

      const stagesCount: Record<string, number> = {};
      let totalActiveSales = 0;
      for (const row of dealStageRows.rows) {
        stagesCount[row.stage] = parseInt(row.cnt, 10);
        if (row.stage !== "Closed Won" && row.stage !== "Closed Lost") {
          totalActiveSales += parseInt(row.cnt, 10);
        }
      }

      const closedWon30d = parseInt(closedWonRow.rows[0]?.cnt ?? "0", 10);
      const closedLost30d = parseInt(closedLostRow.rows[0]?.cnt ?? "0", 10);
      const recentDealsCount = parseInt(newLeads30dRow.rows[0]?.cnt ?? "0", 10);

      const onboardingStages: Record<string, number> = {};
      for (const row of onboardingRows.rows) {
        onboardingStages[row.stage] = parseInt(row.cnt, 10);
      }
      const liveStages = new Set(["Live (First Batch)", "Active (7 Days)", "Active (30 Days)"]);
      const onboardingActive = Object.entries(onboardingStages)
        .filter(([stage]) => stage !== "Active (30 Days)")
        .reduce((s, [, cnt]) => s + cnt, 0);
      const onboardingLive = Object.entries(onboardingStages)
        .filter(([stage]) => liveStages.has(stage))
        .reduce((s, [, cnt]) => s + cnt, 0);

      const rev = revenueRow.rows[0];
      const totalEstProfit = parseFloat(rev?.total_profit ?? "0");
      const dealCount = parseInt(rev?.deal_count ?? "0", 10);

      res.json({
        pipeline: {
          totalActive: totalActiveSales,
          closedWon30d,
          closedLost30d,
          conversionRate: recentDealsCount > 0 ? Math.round((closedWon30d / recentDealsCount) * 100) : 0,
          stagesBreakdown: stagesCount,
          newLeads7d: parseInt(newLeads7dRow.rows[0]?.cnt ?? "0", 10),
        },
        onboarding: {
          active: onboardingActive,
          live: onboardingLive,
        },
        support: {
          openTickets: parseInt(openTicketsRow.rows[0]?.cnt ?? "0", 10),
          breachedSla: parseInt(breachedTicketsRow.rows[0]?.cnt ?? "0", 10),
          avgResolutionHours: 0,
        },
        tasks: {
          pending: parseInt(pendingTasksRow.rows[0]?.cnt ?? "0", 10),
          overdue: parseInt(overdueTasksRow.rows[0]?.cnt ?? "0", 10),
        },
        contacts: {
          total: parseInt(totalContactsRow.rows[0]?.cnt ?? "0", 10),
          new30d: parseInt(newContacts30dRow.rows[0]?.cnt ?? "0", 10),
        },
        revenue: {
          totalEstVolume: parseFloat(rev?.total_volume ?? "0"),
          totalEstResidual: parseFloat(rev?.total_residual ?? "0"),
          totalEstProfit,
          avgDealProfit: dealCount > 0 ? Math.round(totalEstProfit / dealCount) : 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === KPI COMPARATIVE ===
  app.get("/api/kpi/comparative", isAuthenticated, async (req, res) => {
    try {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const [dealsRows, contactsRows, wonRows, ticketsRows] = await Promise.all([
        pool.query<{ period: string; cnt: string }>(`
          SELECT
            CASE WHEN created_at >= $1 THEN 'current' ELSE 'previous' END AS period,
            COUNT(*)::text AS cnt
          FROM deals
          WHERE archived_at IS NULL AND created_at >= $2 AND created_at <= $3
          GROUP BY period
        `, [thisMonthStart, lastMonthStart, now]),
        pool.query<{ period: string; cnt: string }>(`
          SELECT
            CASE WHEN created_at >= $1 THEN 'current' ELSE 'previous' END AS period,
            COUNT(*)::text AS cnt
          FROM contacts
          WHERE archived_at IS NULL AND created_at >= $2 AND created_at <= $3
          GROUP BY period
        `, [thisMonthStart, lastMonthStart, now]),
        pool.query<{ period: string; cnt: string }>(`
          SELECT
            CASE WHEN updated_at >= $1 THEN 'current' ELSE 'previous' END AS period,
            COUNT(*)::text AS cnt
          FROM deals
          WHERE archived_at IS NULL AND stage = 'Closed Won'
            AND updated_at >= $2 AND updated_at <= $3
          GROUP BY period
        `, [thisMonthStart, lastMonthStart, now]),
        pool.query<{ period: string; cnt: string }>(`
          SELECT
            CASE WHEN created_at >= $1 THEN 'current' ELSE 'previous' END AS period,
            COUNT(*)::text AS cnt
          FROM tickets
          WHERE created_at >= $2 AND created_at <= $3
          GROUP BY period
        `, [thisMonthStart, lastMonthStart, now]),
      ]);

      const tally = (rows: { period: string; cnt: string }[]) => {
        let current = 0, previous = 0;
        for (const r of rows) {
          if (r.period === "current") current = parseInt(r.cnt, 10);
          else previous = parseInt(r.cnt, 10);
        }
        return { current, previous };
      };

      const calcChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      const deals = tally(dealsRows.rows);
      const contacts = tally(contactsRows.rows);
      const won = tally(wonRows.rows);
      const tickets = tally(ticketsRows.rows);

      res.json({
        newDeals: { ...deals, change: calcChange(deals.current, deals.previous) },
        newContacts: { ...contacts, change: calcChange(contacts.current, contacts.previous) },
        closedWon: { ...won, change: calcChange(won.current, won.previous) },
        tickets: { ...tickets, change: calcChange(tickets.current, tickets.previous) },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === ANALYTICS / REPORTING ===
  app.get("/api/analytics/pipeline", isAuthenticated, async (req, res) => {
    try {
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding");

      const stageDistribution: Record<string, number> = {};
      salesDeals.forEach(d => { stageDistribution[d.stage] = (stageDistribution[d.stage] || 0) + 1; });

      const closedWon = salesDeals.filter(d => d.stage === "Closed Won");
      const closedLost = salesDeals.filter(d => d.stage === "Closed Lost");
      const active = salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const winRate = (closedWon.length + closedLost.length) > 0
        ? Math.round((closedWon.length / (closedWon.length + closedLost.length)) * 100)
        : 0;

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const newLast30 = salesDeals.filter(d => d.createdAt && new Date(d.createdAt) > thirtyDaysAgo);
      const wonLast30 = closedWon.filter(d => d.updatedAt && new Date(d.updatedAt) > thirtyDaysAgo);

      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const stallingDeals = active.filter(d => d.updatedAt && new Date(d.updatedAt) < sevenDaysAgo);

      res.json({
        sales: {
          total: salesDeals.length,
          active: active.length,
          closedWon: closedWon.length,
          closedLost: closedLost.length,
          winRate,
          stageDistribution,
          newLast30Days: newLast30.length,
          wonLast30Days: wonLast30.length,
          stallingDeals: stallingDeals.length,
        },
        onboarding: {
          total: onboardingDeals.length,
          active: onboardingDeals.filter(d => d.stage !== "Live" && d.stage !== "Cancelled").length,
          completed: onboardingDeals.filter(d => d.stage === "Live").length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/support", isAuthenticated, async (req, res) => {
    try {
      const { data: allTickets } = await storage.getTickets({ limit: 500 });
      const now = new Date();

      const open = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const resolved = allTickets.filter(t => t.status === "Resolved" || t.status === "Closed");
      const breached = allTickets.filter(t => t.slaDeadline && new Date(t.slaDeadline) < now && t.status !== "Resolved" && t.status !== "Closed");

      const categoryBreakdown: Record<string, number> = {};
      allTickets.forEach(t => { categoryBreakdown[t.category || "Other"] = (categoryBreakdown[t.category || "Other"] || 0) + 1; });

      const priorityBreakdown: Record<string, number> = {};
      allTickets.forEach(t => { priorityBreakdown[t.priority || "Normal"] = (priorityBreakdown[t.priority || "Normal"] || 0) + 1; });

      const resolvedWithTimes = resolved.filter(t => t.createdAt && t.resolvedAt);
      const avgResolutionHours = resolvedWithTimes.length > 0
        ? Math.round(resolvedWithTimes.reduce((sum, t) => sum + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt!).getTime()) / (1000 * 60 * 60), 0) / resolvedWithTimes.length)
        : 0;

      res.json({
        total: allTickets.length,
        open: open.length,
        resolved: resolved.length,
        slaBreaches: breached.length,
        avgResolutionHours,
        categoryBreakdown,
        priorityBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/tasks", isAuthenticated, async (req, res) => {
    try {
      const allTasks = await storage.getTasks();
      const now = new Date();
      const pending = allTasks.filter(t => t.status === "pending");
      const inProgress = allTasks.filter(t => t.status === "in_progress");
      const completed = allTasks.filter(t => t.status === "completed");
      const overdue = allTasks.filter(t => t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now);

      const priorityBreakdown: Record<string, number> = {};
      allTasks.forEach(t => { priorityBreakdown[t.priority || "normal"] = (priorityBreakdown[t.priority || "normal"] || 0) + 1; });

      res.json({
        total: allTasks.length,
        pending: pending.length,
        inProgress: inProgress.length,
        completed: completed.length,
        overdue: overdue.length,
        priorityBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/lead-sources", isAuthenticated, async (req, res) => {
    try {
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo);

      const sourceMap: Record<string, { leads: number; deals: number; won: number }> = {};
      recentContacts.forEach(c => {
        const src = c.utmSource || c.leadSource || "direct";
        if (!sourceMap[src]) sourceMap[src] = { leads: 0, deals: 0, won: 0 };
        sourceMap[src].leads++;
      });

      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);
      salesDeals.forEach(d => {
        const src = d.leadSource || "direct";
        const normalizedSrc = src.startsWith("utm:") ? src.slice(4) : src;
        if (!sourceMap[normalizedSrc]) sourceMap[normalizedSrc] = { leads: 0, deals: 0, won: 0 };
        sourceMap[normalizedSrc].deals++;
        if (d.stage === "Closed Won") sourceMap[normalizedSrc].won++;
      });

      const sources = Object.entries(sourceMap)
        .map(([source, data]) => ({
          source,
          leads: data.leads,
          deals: data.deals,
          won: data.won,
          conversionRate: data.leads > 0 ? Math.round((data.won / data.leads) * 100) : 0,
        }))
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 10);

      res.json({ sources });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GROWTH KPI — weekly channel breakdown ===
  app.get("/api/analytics/growth-kpi", isAuthenticated, async (req, res) => {
    const role = (req.user as any)?.role;
    if (!["admin", "manager"].includes(role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    try {
      const displayWeeksParam = parseInt((req.query.weeks as string) || "12", 10);
      const displayWeeks = Math.min(Math.max(displayWeeksParam, 1), 24);

      // We must fetch enough history for:
      //   1. Two full displayWeeks periods (current + previous) for period comparison
      //   2. Always at least 8 weeks for sparklines
      //   3. Always at least 2 weeks for WoW on the arc cards
      const SPARKLINE_WEEKS = 8;
      const fetchWeeks = Math.max(displayWeeks * 2, SPARKLINE_WEEKS, 2);

      const now = new Date();

      // Monday-anchored ISO week start
      const getWeekStart = (date: Date): Date => {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
        d.setHours(0, 0, 0, 0);
        return d;
      };

      const currentWeekStart = getWeekStart(now);

      // Build week-start array for fetchWeeks (oldest → newest)
      const weekStarts: Date[] = [];
      for (let i = fetchWeeks - 1; i >= 0; i--) {
        const ws = new Date(currentWeekStart);
        ws.setDate(ws.getDate() - i * 7);
        weekStarts.push(ws);
      }

      const windowStart = weekStarts[0];

      const CHANNELS = ["linkedin", "reddit", "partner", "gbp", "affiliate", "newsletter", "haro", "youtube", "direct", "other"];

      // Normalise utm_source / lead_source to a canonical channel name
      const normalizeSource = (src: string | null | undefined): string => {
        if (!src) return "direct";
        const s = src.toLowerCase().trim().replace(/^utm:/, "");
        if (s.includes("linkedin")) return "linkedin";
        if (s.includes("reddit")) return "reddit";
        if (s.includes("partner") || s.includes("referral") || s.includes("iso")) return "partner";
        if (s.includes("gbp") || s.includes("google business") || s.includes("google_business")) return "gbp";
        if (s.includes("affiliate")) return "affiliate";
        if (s.includes("newsletter") || s.includes("email")) return "newsletter";
        if (s.includes("haro")) return "haro";
        if (s.includes("youtube") || s.includes("video")) return "youtube";
        if (s === "direct" || s === "" || s === "none") return "direct";
        return "other";
      };

      // ── Raw-SQL: contacts by week bucket (windowed) ────────────────────────
      const [contactRows, dealRows, allTimeContactRows] = await Promise.all([
        pool.query<{ week_start: Date; utm_source: string | null; lead_source: string | null; count: string }>(`
          SELECT
            date_trunc('week', created_at) AS week_start,
            utm_source,
            lead_source,
            COUNT(*)::text AS count
          FROM contacts
          WHERE archived_at IS NULL
            AND created_at >= $1
          GROUP BY week_start, utm_source, lead_source
          ORDER BY week_start
        `, [windowStart]),

        // All-time deals/won by lead_source for conversion rate denominator
        pool.query<{ lead_source: string | null; stage: string; count: string }>(`
          SELECT lead_source, stage, COUNT(*)::text AS count
          FROM deals
          WHERE archived_at IS NULL AND pipeline = 'sales'
          GROUP BY lead_source, stage
        `),

        // All-time contacts by channel (same scope as all-time deals, for consistent conv rate)
        pool.query<{ utm_source: string | null; lead_source: string | null; count: string }>(`
          SELECT utm_source, lead_source, COUNT(*)::text AS count
          FROM contacts
          WHERE archived_at IS NULL
          GROUP BY utm_source, lead_source
        `),
      ]);

      // ── Build weeklyByChannel: [fetchWeeks] arrays ────────────────────────
      const weeklyByChannel: Record<string, number[]> = {};
      CHANNELS.forEach(ch => { weeklyByChannel[ch] = new Array(fetchWeeks).fill(0); });

      contactRows.rows.forEach(row => {
        const ch = normalizeSource(row.utm_source || row.lead_source);
        const canonCh = CHANNELS.includes(ch) ? ch : "other";
        const rowWeek = new Date(row.week_start);
        for (let i = 0; i < weekStarts.length; i++) {
          if (rowWeek.getTime() === weekStarts[i].getTime()) {
            weeklyByChannel[canonCh][i] += parseInt(row.count, 10);
            break;
          }
        }
      });

      // ── All-time leads/deals/won by channel (consistent scope for conv rate) ──
      const allTimeLeads: Record<string, number> = {};
      CHANNELS.forEach(ch => { allTimeLeads[ch] = 0; });
      allTimeContactRows.rows.forEach(row => {
        const ch = normalizeSource(row.utm_source || row.lead_source);
        const canonCh = CHANNELS.includes(ch) ? ch : "other";
        allTimeLeads[canonCh] += parseInt(row.count, 10);
      });

      const dealsByChannel: Record<string, { deals: number; won: number }> = {};
      CHANNELS.forEach(ch => { dealsByChannel[ch] = { deals: 0, won: 0 }; });
      dealRows.rows.forEach(row => {
        const ch = normalizeSource(row.lead_source);
        const canonCh = CHANNELS.includes(ch) ? ch : "other";
        const n = parseInt(row.count, 10);
        dealsByChannel[canonCh].deals += n;
        if (row.stage === "Closed Won") dealsByChannel[canonCh].won += n;
      });

      // ── Key indices ────────────────────────────────────────────────────────
      // Current display period: last displayWeeks weeks
      // Previous display period: the displayWeeks weeks before that
      const currentPeriodStart = fetchWeeks - displayWeeks;   // inclusive
      const prevPeriodStart    = fetchWeeks - displayWeeks * 2; // inclusive (always >= 0 because fetchWeeks >= displayWeeks*2)
      const prevPeriodEnd      = currentPeriodStart;            // exclusive

      // Arc / WoW cards always show current vs previous single week
      const currentWeekIdx = fetchWeeks - 1;
      const prevWeekIdx    = fetchWeeks - 2; // always >= 0 (fetchWeeks >= 2)

      let thisWeekTotal = 0;
      let prevWeekTotal = 0;
      CHANNELS.forEach(ch => {
        thisWeekTotal += weeklyByChannel[ch][currentWeekIdx] || 0;
        prevWeekTotal += weeklyByChannel[ch][prevWeekIdx]    || 0;
      });

      const weekOverWeekChange = prevWeekTotal > 0
        ? Math.round(((thisWeekTotal - prevWeekTotal) / prevWeekTotal) * 100)
        : (thisWeekTotal > 0 ? 100 : 0);

      // ── Sparkline: always last SPARKLINE_WEEKS weeks (min 8), independent of toggle ──
      const sparklineStart = Math.max(fetchWeeks - SPARKLINE_WEEKS, 0);

      const channels = CHANNELS.map(ch => {
        const full = weeklyByChannel[ch];

        // Period-aggregated counts for the table columns (change with toggle)
        const periodCount = full.slice(currentPeriodStart).reduce((s, n) => s + n, 0);
        const prevPeriodCount = full.slice(prevPeriodStart, prevPeriodEnd).reduce((s, n) => s + n, 0);

        // Sparkline always last 8 weeks
        const sparkline = weekStarts.slice(sparklineStart).map((ws, i) => ({
          week:  ws.toISOString().split("T")[0],
          count: full[sparklineStart + i] || 0,
        }));

        // Conversion rate: lead → deal (all-time deals / all-time contacts, consistent scope)
        const atLeads = allTimeLeads[ch] || 0;
        const { deals, won } = dealsByChannel[ch];
        const conversionRate = atLeads > 0 ? Math.round((deals / atLeads) * 100) : 0;

        return {
          channel: ch,
          // period data for table (changes with time range toggle)
          periodCount,
          prevPeriodCount,
          // always-current-week for backward compat with arc cards
          thisWeek: full[currentWeekIdx] || 0,
          lastWeek: full[prevWeekIdx]    || 0,
          conversionRate,
          sparkline,
          won,
        };
      });

      const weekLabels = weekStarts.slice(currentPeriodStart).map(ws => ws.toISOString().split("T")[0]);

      res.json({
        thisWeekTotal,
        prevWeekTotal,
        weekOverWeekChange,
        target: 1000,
        displayWeeks,
        channels,
        weekLabels,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/conversion-funnel", isAuthenticated, async (req, res) => {
    try {
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recentContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo);
      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);

      const stages = ["New Lead", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Closed Won"];
      const funnel = stages.map(stage => {
        const atOrPast = salesDeals.filter(d => {
          const stageIdx = stages.indexOf(d.stage);
          const targetIdx = stages.indexOf(stage);
          return stageIdx >= targetIdx || d.stage === stage;
        });
        return { stage, count: atOrPast.length };
      });

      res.json({
        totalLeads: recentContacts.length,
        totalDeals: salesDeals.length,
        funnel,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/daily-leads", isAuthenticated, async (req, res) => {
    try {
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const dailyData: Record<string, { leads: number; deals: number }> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split("T")[0];
        dailyData[key] = { leads: 0, deals: 0 };
      }

      allContacts.forEach(c => {
        if (!c.createdAt) return;
        const key = new Date(c.createdAt).toISOString().split("T")[0];
        if (dailyData[key]) dailyData[key].leads++;
      });

      allDeals.filter(d => d.pipeline === "sales").forEach(d => {
        if (!d.createdAt) return;
        const key = new Date(d.createdAt).toISOString().split("T")[0];
        if (dailyData[key]) dailyData[key].deals++;
      });

      const today = now.toISOString().split("T")[0];
      const todayLeads = dailyData[today]?.leads || 0;
      const todayDeals = dailyData[today]?.deals || 0;

      const trend = Object.entries(dailyData)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({ todayLeads, todayDeals, trend });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/analytics/weekly-digest", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { html, summary } = await buildWeeklyDigest();
      const adminEmail = process.env.ADMIN_DIGEST_EMAIL;
      if (adminEmail && isGhlConfigured()) {
        try {
          await sendGhlEmailForMerchant({ email: adminEmail, subject: `Weekly KPI Digest — ${summary.period} — Liberty Bancard`, body: html });
          res.json({ ...summary, emailSent: true, emailRecipient: adminEmail });
          return;
        } catch (emailErr) {
          console.error("Weekly digest email error:", emailErr);
          res.json({ ...summary, emailSent: false, emailError: String(emailErr) });
          return;
        }
      }
      res.json({ ...summary, emailSent: false, emailError: !adminEmail ? "No admin email configured" : "GHL not configured" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === FORECASTING ===
  app.get("/api/forecasting/summary", isAuthenticated, async (req, res) => {
    try {
      const { data: deals } = await storage.getDeals({ limit: 500 });
      const activeDeals = deals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Lost");

      const stageWeights: Record<string, number> = {
        "New Lead": 0.1, "Statement Received": 0.25, "Review In Progress": 0.4,
        "Call Booked": 0.5, "Proposal Sent": 0.6, "Negotiation / Follow-Up": 0.75,
        "Verbal Commit": 0.9, "Closed Won": 1.0, "Closed Lost": 0
      };

      let totalPipeline = 0;
      let weightedForecast = 0;
      const stageBreakdown: Record<string, { count: number; volume: number; profit: number; weight: number }> = {};

      activeDeals.forEach(d => {
        const profit = parseFloat(d.estimatedGrossProfitMonthly || "0");
        const volume = parseFloat(d.totalVolume || "0");
        const weight = stageWeights[d.stage] || 0.1;

        totalPipeline += profit;
        weightedForecast += profit * weight;

        if (!stageBreakdown[d.stage]) {
          stageBreakdown[d.stage] = { count: 0, volume: 0, profit: 0, weight: weight * 100 };
        }
        stageBreakdown[d.stage].count++;
        stageBreakdown[d.stage].volume += volume;
        stageBreakdown[d.stage].profit += profit;
      });

      const now = new Date();
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

      const thisMonth = activeDeals.filter(d => d.nextFollowUp && new Date(d.nextFollowUp) <= thisMonthEnd)
        .reduce((sum, d) => sum + parseFloat(d.estimatedGrossProfitMonthly || "0") * (stageWeights[d.stage] || 0.1), 0);
      const nextMonth = activeDeals.filter(d => d.nextFollowUp && new Date(d.nextFollowUp) > thisMonthEnd && new Date(d.nextFollowUp) <= nextMonthEnd)
        .reduce((sum, d) => sum + parseFloat(d.estimatedGrossProfitMonthly || "0") * (stageWeights[d.stage] || 0.1), 0);

      res.json({ totalPipeline, weightedForecast, thisMonthForecast: thisMonth, nextMonthForecast: nextMonth, stageBreakdown });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === PIPELINE STATS (contacts by tier, deals by stage, outreach stats) ===
  app.get("/api/kpi/pipeline-stats", isAuthenticated, async (req, res) => {
    try {
      const tierResult = await pool.query(`
        SELECT
          CASE
            WHEN lead_score >= 70 THEN 'hot'
            WHEN lead_score >= 45 THEN 'warm'
            WHEN lead_score >= 20 THEN 'cold'
            ELSE 'unqualified'
          END as tier,
          COUNT(*) as count
        FROM contacts
        WHERE archived_at IS NULL
        GROUP BY tier
        ORDER BY count DESC
      `);

      const stageResult = await pool.query(`
        SELECT stage, COUNT(*) as count
        FROM deals
        WHERE archived_at IS NULL AND pipeline = 'sales'
        GROUP BY stage
        ORDER BY count DESC
      `);

      const scoredResult = await pool.query(`
        SELECT COUNT(*) as count FROM contacts WHERE archived_at IS NULL AND last_scored_at IS NOT NULL
      `);

      const unscoredResult = await pool.query(`
        SELECT COUNT(*) as count FROM contacts WHERE archived_at IS NULL AND last_scored_at IS NULL
      `);

      const totalDealsResult = await pool.query(`
        SELECT COUNT(*) as count FROM deals WHERE archived_at IS NULL
      `);

      const awaitingOutreach = await pool.query(`
        SELECT COUNT(*) as count FROM contacts c
        WHERE c.archived_at IS NULL AND c.lead_score >= 45
          AND c.last_contacted_at IS NULL
          AND (c.do_not_contact IS NULL OR c.do_not_contact = false)
      `);

      const pipelineValue = await pool.query(`
        SELECT
          COALESCE(SUM(
            CASE WHEN estimated_gross_profit_monthly IS NOT NULL
              AND REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') != ''
            THEN CAST(REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') AS DECIMAL)
            ELSE 0 END
          ), 0) as total_value
        FROM deals
        WHERE archived_at IS NULL AND pipeline = 'sales' AND stage NOT IN ('Closed Won', 'Closed Lost')
      `);

      const contactsByTier: Record<string, number> = {};
      for (const row of tierResult.rows) {
        contactsByTier[row.tier] = parseInt(row.count, 10);
      }

      const dealsByStage: Record<string, number> = {};
      for (const row of stageResult.rows) {
        dealsByStage[row.stage] = parseInt(row.count, 10);
      }

      res.json({
        contactsByTier,
        dealsByStage,
        scored: parseInt(scoredResult.rows[0].count, 10),
        unscored: parseInt(unscoredResult.rows[0].count, 10),
        totalDeals: parseInt(totalDealsResult.rows[0].count, 10),
        awaitingOutreach: parseInt(awaitingOutreach.rows[0].count, 10),
        pipelineValue: parseFloat(pipelineValue.rows[0].total_value) || 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === LEADERBOARD ===
  app.get("/api/leaderboard", isAuthenticated, async (req, res) => {
    try {
      const { period = "month" } = req.query as { period?: string };
      const now = new Date();

      // Compute time windows for current and previous period
      let currentStart: Date;
      let prevStart: Date;
      let prevEnd: Date;

      if (period === "week") {
        currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        prevEnd = currentStart;
      } else if (period === "quarter") {
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        currentStart = new Date(now.getFullYear(), qMonth, 1);
        prevStart = new Date(now.getFullYear(), qMonth - 3, 1);
        prevEnd = currentStart;
      } else if (period === "all") {
        currentStart = new Date(0);
        prevStart = new Date(0);
        prevEnd = new Date(0);
      } else {
        // month
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = currentStart;
      }

      const [allAgents, dealsResult, callLogsResult] = await Promise.all([
        storage.getAgents(),
        storage.getDeals({ limit: 10000 }),
        pool.query(`SELECT assigned_to, created_at FROM call_logs WHERE assigned_to IS NOT NULL`).catch(() => ({ rows: [] as any[] })),
      ]);

      const allDeals = dealsResult.data;

      const currentUser = req.user as any;
      const currentUserId = currentUser?.id;

      // Fetch leaderboard settings
      const [settingsRow] = await db.select().from(leaderboardSettings).limit(1);
      const settings = settingsRow || {
        showDeals: true,
        showRevenue: true,
        showProposals: true,
        showCallsMade: true,
        showResponseRate: false,
        visibleToAgents: true,
        monthlyDealGoal: 10,
        monthlyRevenueGoal: "50000",
      };

      const role = currentUser?.role;
      if (role === "agent" && !settings.visibleToAgents) {
        return res.json({ entries: [], period, settings });
      }

      const isCurrent = (date: Date | string | null | undefined) => {
        if (!date) return false;
        const d = new Date(date);
        return d >= currentStart && d <= now;
      };

      const isPrev = (date: Date | string | null | undefined) => {
        if (!date || period === "all") return false;
        const d = new Date(date);
        return d >= prevStart && d < prevEnd;
      };

      const parseMoney = (v: string | null | undefined) => {
        if (!v) return 0;
        const n = parseFloat(v.replace(/[^0-9.]/g, ""));
        return isNaN(n) ? 0 : n;
      };

      const entries = allAgents
        .filter(a => a.status === "active")
        .map(agent => {
          // Current period deals
          const agentDeals = allDeals.filter(d => {
            const owner = d.owner?.toLowerCase();
            const agentName = `${agent.firstName} ${agent.lastName}`.toLowerCase();
            return owner === agentName || owner === agent.email?.toLowerCase();
          });

          const currentDeals = agentDeals.filter(d => d.stage === "Closed Won" && isCurrent(d.closedAt || d.updatedAt));
          const prevDeals = agentDeals.filter(d => d.stage === "Closed Won" && isPrev(d.closedAt || d.updatedAt));

          const currentProposals = agentDeals.filter(d => isCurrent(d.proposalEmailSentAt));
          const prevProposals = agentDeals.filter(d => isPrev(d.proposalEmailSentAt));

          const currentRevenue = currentDeals.reduce((s, d) => s + parseMoney(d.totalVolume), 0);
          const prevRevenue = prevDeals.reduce((s, d) => s + parseMoney(d.totalVolume), 0);

          // Call logs (best effort)
          const agentCalls = callLogsResult.rows.filter((r: any) => {
            const assignedTo = (r.assigned_to || "").toLowerCase();
            return assignedTo === `${agent.firstName} ${agent.lastName}`.toLowerCase() || assignedTo === agent.email?.toLowerCase();
          });
          const currentCalls = agentCalls.filter((r: any) => isCurrent(r.created_at)).length;
          const prevCalls = agentCalls.filter((r: any) => isPrev(r.created_at)).length;

          const isCurrentUser = !!(currentUserId && (agent.userId === currentUserId || agent.email === currentUser?.email));

          // Response Rate = proposals sent / total deals touched in the period (as %)
          // "Touched" = deal exists in the period (created or updated)
          const currentTouched = agentDeals.filter(d => isCurrent(d.createdAt || d.updatedAt));
          const prevTouched = agentDeals.filter(d => isPrev(d.createdAt || d.updatedAt));
          const currentResponseRate = currentTouched.length > 0
            ? Math.round((currentProposals.length / currentTouched.length) * 100)
            : 0;
          const prevResponseRate = prevTouched.length > 0
            ? Math.round((prevProposals.length / prevTouched.length) * 100)
            : 0;

          return {
            agentId: agent.id,
            name: `${agent.firstName} ${agent.lastName}`,
            initials: `${agent.firstName[0]}${agent.lastName[0]}`.toUpperCase(),
            rank: 0,
            dealsClosed: currentDeals.length,
            revenueManaged: currentRevenue,
            proposalsSent: currentProposals.length,
            callsMade: currentCalls,
            responseRate: currentResponseRate,
            prevDealsClosed: prevDeals.length,
            prevRevenueManaged: prevRevenue,
            prevProposalsSent: prevProposals.length,
            prevCallsMade: prevCalls,
            prevResponseRate,
            isCurrentUser,
          };
        });

      // Sort by deals for default rank
      entries.sort((a, b) => b.dealsClosed - a.dealsClosed);
      entries.forEach((e, i) => { e.rank = i + 1; });

      res.json({ entries, period, settings });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === LEADERBOARD SETTINGS ===
  app.get("/api/leaderboard/settings", isAuthenticated, async (req, res) => {
    try {
      const [row] = await db.select().from(leaderboardSettings).limit(1);
      res.json(row || {
        showDeals: true, showRevenue: true, showProposals: true, showCallsMade: true,
        showResponseRate: false, visibleToAgents: true, monthlyDealGoal: 10, monthlyRevenueGoal: "50000",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/leaderboard/settings", isAuthenticated, async (req, res) => {
    const role = (req.user as any)?.role;
    if (role !== "admin" && role !== "manager") return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const updates = req.body;
      const [existing] = await db.select().from(leaderboardSettings).limit(1);
      if (existing) {
        const [updated] = await db.update(leaderboardSettings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(leaderboardSettings.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db.insert(leaderboardSettings).values(updates).returning();
        res.json(created);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
