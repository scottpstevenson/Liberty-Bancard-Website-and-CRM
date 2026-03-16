import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { pool } from "../db";
import { contacts } from "@shared/schema";
import { isGhlConfigured, sendGhlEmailForMerchant } from "../services/ghl";
import { buildWeeklyDigest } from "../services/digest-service";

export function registerAnalyticsRoutes(app: Express) {
  // === KPI DASHBOARD ===
  app.get("/api/kpi/summary", async (req, res) => {
    try {
      const [allDeals, allTickets, allContacts, allTasks] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getContacts(),
        storage.getTasks(),
      ]);

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding");
      const recentDeals = salesDeals.filter(d => d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);
      const closedWon = salesDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= thirtyDaysAgo);
      const closedLost = salesDeals.filter(d => d.stage === "Closed Lost" && d.closedAt && new Date(d.closedAt) >= thirtyDaysAgo);

      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const breachedTickets = allTickets.filter(t =>
        t.slaDeadline && new Date(t.slaDeadline) < now && !t.resolvedAt && t.status !== "Resolved" && t.status !== "Closed"
      );

      const pendingTasks = allTasks.filter(t => t.status === "pending");
      const overdueTasks = allTasks.filter(t => t.status === "pending" && t.dueDate && new Date(t.dueDate) < now);

      const stagesCount: Record<string, number> = {};
      salesDeals.forEach(d => { stagesCount[d.stage] = (stagesCount[d.stage] || 0) + 1; });

      const parseCurrency = (v: string | null | undefined): number => {
        if (!v) return 0;
        const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
        return isNaN(n) ? 0 : n;
      };

      const totalEstVolume = allContacts.reduce((s, c) => s + parseCurrency(c.estimatedProcessingVolume), 0);
      const totalEstResidual = allContacts.reduce((s, c) => s + parseCurrency(c.estimatedResidual), 0);
      const totalEstProfit = allDeals.reduce((s, d) => s + parseCurrency(d.estimatedGrossProfitMonthly), 0);

      res.json({
        pipeline: {
          totalActive: salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost").length,
          closedWon30d: closedWon.length,
          closedLost30d: closedLost.length,
          conversionRate: recentDeals.length > 0 ? Math.round((closedWon.length / recentDeals.length) * 100) : 0,
          stagesBreakdown: stagesCount,
          newLeads7d: salesDeals.filter(d => d.createdAt && new Date(d.createdAt) >= sevenDaysAgo).length,
        },
        onboarding: {
          active: onboardingDeals.filter(d => d.stage !== "Active (30 Days)").length,
          live: onboardingDeals.filter(d => d.stage === "Live (First Batch)" || d.stage === "Active (7 Days)" || d.stage === "Active (30 Days)").length,
        },
        support: {
          openTickets: openTickets.length,
          breachedSla: breachedTickets.length,
          avgResolutionHours: 0,
        },
        tasks: {
          pending: pendingTasks.length,
          overdue: overdueTasks.length,
        },
        contacts: {
          total: allContacts.length,
          new30d: allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo).length,
        },
        revenue: {
          totalEstVolume,
          totalEstResidual,
          totalEstProfit,
          avgDealProfit: allDeals.length > 0 ? Math.round(totalEstProfit / allDeals.length) : 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === KPI COMPARATIVE ===
  app.get("/api/kpi/comparative", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allContacts, allTickets] = await Promise.all([
        storage.getDeals(),
        storage.getContacts(),
        storage.getTickets(),
      ]);

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const thisMonthDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= thisMonthStart);
      const lastMonthDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= lastMonthStart && new Date(d.createdAt) <= lastMonthEnd);

      const thisMonthContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thisMonthStart);
      const lastMonthContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= lastMonthStart && new Date(c.createdAt) <= lastMonthEnd);

      const thisMonthWon = allDeals.filter(d => d.stage === "Closed Won" && d.updatedAt && new Date(d.updatedAt) >= thisMonthStart);
      const lastMonthWon = allDeals.filter(d => d.stage === "Closed Won" && d.updatedAt && new Date(d.updatedAt) >= lastMonthStart && new Date(d.updatedAt) <= lastMonthEnd);

      const thisMonthTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= thisMonthStart);
      const lastMonthTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= lastMonthStart && new Date(t.createdAt) <= lastMonthEnd);

      const calcChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      res.json({
        newDeals: { current: thisMonthDeals.length, previous: lastMonthDeals.length, change: calcChange(thisMonthDeals.length, lastMonthDeals.length) },
        newContacts: { current: thisMonthContacts.length, previous: lastMonthContacts.length, change: calcChange(thisMonthContacts.length, lastMonthContacts.length) },
        closedWon: { current: thisMonthWon.length, previous: lastMonthWon.length, change: calcChange(thisMonthWon.length, lastMonthWon.length) },
        tickets: { current: thisMonthTickets.length, previous: lastMonthTickets.length, change: calcChange(thisMonthTickets.length, lastMonthTickets.length) },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === ANALYTICS / REPORTING ===
  app.get("/api/analytics/pipeline", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
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
      const allTickets = await storage.getTickets();
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
      const allContacts = await storage.getContacts();
      const allDeals = await storage.getDeals();
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

  app.get("/api/analytics/conversion-funnel", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const allContacts = await storage.getContacts();
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
      const allContacts = await storage.getContacts();
      const allDeals = await storage.getDeals();
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
      const deals = await storage.getDeals();
      const activeDeals = deals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Lost");

      const stageWeights: Record<string, number> = {
        "New Lead": 0.1, "Contacted": 0.2, "Statement Collected": 0.4,
        "Proposal": 0.6, "Negotiation": 0.75, "Closed Won": 1.0, "Closed Lost": 0
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
  app.get("/api/kpi/pipeline-stats", async (req, res) => {
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

}
