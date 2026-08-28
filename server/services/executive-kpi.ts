/**
 * Executive KPI Aggregation Service
 *
 * Builds a canonical ExecutiveSnapshot from live DB data:
 * deals, dailyFunnelMetrics, residuals, leaderboard agent counts.
 * Returns structured data consumed by the AI generation service and the API route.
 */

import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import { deals, agents, dailyFunnelMetrics, executiveGoals } from "@shared/schema";
import { recordAggregateLineage } from "./commercial-classification-authority";
import { observeCommercialReportingPopulation } from "./commercial-resolution";

export interface RepBreakdown {
  agentId: number;
  name: string;
  initials: string;
  dealsClosed: number;
  revenue: number;
  grossProfit: number;
  proposalsSent: number;
  statementsReceived: number;
  prevDealsClosed: number;
  prevRevenue: number;
  prevProposalsSent: number;
  goalStatus: "green" | "yellow" | "red" | "none";
}

export interface GoalVsActual {
  key: string;
  label: string;
  goal: number;
  actual: number;
  pct: number;
  status: "green" | "yellow" | "red";
}

export interface ExecutiveSnapshot {
  weekStart: string;
  weekEnd: string;
  // Revenue
  closedWonRevenue: number;
  prevClosedWonRevenue: number;
  revenueDelta: number;
  revenueWoW: number;
  // Margin
  grossProfit: number;
  netProfit: number;
  grossMarginPct: number;
  netMarginPct: number;
  prevGrossMarginPct: number;
  // Pipeline
  pipelineValue: number;
  pipelineByStageSummary: Array<{ stage: string; count: number; value: number }>;
  // Activity
  newDealsClosed: number;
  prevDealsClosed: number;
  proposalsSent: number;
  prevProposalsSent: number;
  statementsReceived: number;
  meetingsBooked: number;
  outreachAttempts: number;
  // Team
  perRepBreakdown: RepBreakdown[];
  // Goals
  goalsVsActuals: GoalVsActual[];
  // Context for AI
  goals: Record<string, number>;
  lineageMetadata: { policyVersion: number; sourceRowCount: number; productionCount: number; excludedCount: number; unknownCount: number; lineageHwm: Date };
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function toEstDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function parseMoney(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Load stored goals keyed by goal key */
async function loadGoals(): Promise<Record<string, number>> {
  try {
    const rows = await db.select().from(executiveGoals);
    const result: Record<string, number> = {};
    for (const r of rows) {
      result[r.key] = parseFloat(r.value as string);
    }
    return result;
  } catch {
    return {};
  }
}

function goalStatus(actual: number, goal: number): "green" | "yellow" | "red" | "none" {
  if (!goal) return "none";
  const pct = actual / goal;
  if (pct >= 0.9) return "green";
  if (pct >= 0.6) return "yellow";
  return "red";
}

export async function buildExecutiveSnapshot(
  forDate: Date = new Date()
): Promise<ExecutiveSnapshot> {
  await observeCommercialReportingPopulation({ subjectType: "deal" }).catch((error) => {
    console.error("[CRO02_EXECUTIVE_KPI_OBSERVATION_FAILED]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  });
  const weekStart = getMonday(forDate);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000);
  const prevWeekEnd = new Date(weekStart.getTime() - 1);

  const weekStartStr = toEstDateString(weekStart);
  const prevWeekStartStr = toEstDateString(prevWeekStart);

  const [allAgentsResult, goalsMap] = await Promise.all([
    db.select().from(agents).where(sql`${agents.status} = 'active'`),
    loadGoals(),
  ]);

  // ── Deals for current + previous week ────────────────────────────────────────
  const [currDealsResult, prevDealsResult, pipelineResult, funnelResult] = await Promise.all([
    pool.query<any>(`
      SELECT d.*, a.first_name, a.last_name, a.email as agent_email
       FROM deals d
       LEFT JOIN contacts linked_contact ON linked_contact.id = d.contact_id
      LEFT JOIN agents a ON lower(d.owner) = lower(a.first_name || ' ' || a.last_name)
         OR lower(d.owner) = lower(a.email)
      WHERE d.stage = 'Closed Won'
        AND d.archived_at IS NULL
        AND d.record_class = 'production'
         AND (d.contact_id IS NULL OR linked_contact.record_class = 'production')
        AND (d.closed_at >= $1 OR (d.closed_at IS NULL AND d.updated_at >= $1))
        AND (d.closed_at <= $2 OR (d.closed_at IS NULL AND d.updated_at <= $2))
    `, [weekStart, weekEnd]),

    pool.query<any>(`
      SELECT d.*
       FROM deals d
       LEFT JOIN contacts linked_contact ON linked_contact.id = d.contact_id
      WHERE d.stage = 'Closed Won'
        AND d.archived_at IS NULL
        AND d.record_class = 'production'
         AND (d.contact_id IS NULL OR linked_contact.record_class = 'production')
        AND (d.closed_at >= $1 OR (d.closed_at IS NULL AND d.updated_at >= $1))
        AND (d.closed_at <= $2 OR (d.closed_at IS NULL AND d.updated_at <= $2))
    `, [prevWeekStart, prevWeekEnd]),

    pool.query<any>(`
      SELECT stage,
             COUNT(*) AS deal_count,
             SUM(CASE WHEN est_monthly_revenue ~ '^[0-9.]+$'
                 THEN est_monthly_revenue::numeric ELSE 0 END) AS pipeline_value
       FROM deals d
       LEFT JOIN contacts linked_contact ON linked_contact.id = d.contact_id
       WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
         AND d.archived_at IS NULL
         AND d.record_class = 'production'
         AND (d.contact_id IS NULL OR linked_contact.record_class = 'production')
      GROUP BY stage
      ORDER BY deal_count DESC
    `),

    pool.query<any>(`
      SELECT
        SUM(proposals_sent)       AS proposals_sent,
        SUM(statements_received)  AS statements_received,
        SUM(meetings_booked)      AS meetings_booked,
        SUM(emails_sent + sms_sent + calls_made) AS outreach_attempts
      FROM daily_funnel_metrics
      WHERE date >= $1 AND date <= $2
        AND vertical IS NULL AND state IS NULL AND source_type IS NULL
    `, [weekStartStr, toEstDateString(weekEnd)]),
  ]);

  // ── Proposal counts for prev week ─────────────────────────────────────────
  const prevFunnelResult = await pool.query<any>(`
    SELECT SUM(proposals_sent) AS proposals_sent
    FROM daily_funnel_metrics
    WHERE date >= $1 AND date <= $2
      AND vertical IS NULL AND state IS NULL AND source_type IS NULL
  `, [prevWeekStartStr, toEstDateString(prevWeekEnd)]);

  const currDeals = currDealsResult.rows;
  const prevDeals = prevDealsResult.rows;
  const funnel = funnelResult.rows[0] || {};
  const prevFunnel = prevFunnelResult.rows[0] || {};

  // Revenue / margin aggregation
  const closedWonRevenue = currDeals.reduce((s: number, d: any) => s + parseMoney(d.total_volume || d.est_monthly_revenue), 0);
  const prevClosedWonRevenue = prevDeals.reduce((s: number, d: any) => s + parseMoney(d.total_volume || d.est_monthly_revenue), 0);
  const grossProfit = currDeals.reduce((s: number, d: any) => s + parseMoney(d.estimated_gross_profit_monthly), 0);
  const netProfit = currDeals.reduce((s: number, d: any) => s + parseMoney(d.estimated_net_profit_monthly), 0);
  const grossMarginPct = closedWonRevenue > 0 ? (grossProfit / closedWonRevenue) * 100 : 0;
  const netMarginPct = closedWonRevenue > 0 ? (netProfit / closedWonRevenue) * 100 : 0;
  const prevGrossMarginPct = prevClosedWonRevenue > 0
    ? (prevDeals.reduce((s: number, d: any) => s + parseMoney(d.estimated_gross_profit_monthly), 0) / prevClosedWonRevenue) * 100
    : 0;
  const revenueWoW = prevClosedWonRevenue > 0
    ? Math.round(((closedWonRevenue - prevClosedWonRevenue) / prevClosedWonRevenue) * 100)
    : closedWonRevenue > 0 ? 100 : 0;

  const pipelineValue = pipelineResult.rows.reduce((s: number, r: any) => s + parseFloat(r.pipeline_value || 0), 0);
  const pipelineByStageSummary = pipelineResult.rows.map((r: any) => ({
    stage: r.stage,
    count: parseInt(r.deal_count),
    value: parseFloat(r.pipeline_value || 0),
  }));

  // ── Per-rep breakdown ─────────────────────────────────────────────────────
  const repGoal = goalsMap["rep_deals_closed"] || 0;
  const perRepBreakdown: RepBreakdown[] = allAgentsResult.map(agent => {
    const fullName = `${agent.firstName} ${agent.lastName}`.toLowerCase();
    const email = (agent.email || "").toLowerCase();

    const matchDeal = (d: any) => {
      const owner = (d.owner || "").toLowerCase();
      return owner === fullName || owner === email;
    };

    const agentCurrDeals = currDeals.filter(matchDeal);
    const agentPrevDeals = prevDeals.filter(matchDeal);
    const revenue = agentCurrDeals.reduce((s: number, d: any) => s + parseMoney(d.total_volume || d.est_monthly_revenue), 0);
    const gross = agentCurrDeals.reduce((s: number, d: any) => s + parseMoney(d.estimated_gross_profit_monthly), 0);
    const prevRevenue = agentPrevDeals.reduce((s: number, d: any) => s + parseMoney(d.total_volume || d.est_monthly_revenue), 0);

    return {
      agentId: agent.id,
      name: `${agent.firstName} ${agent.lastName}`,
      initials: `${agent.firstName[0]}${agent.lastName[0]}`.toUpperCase(),
      dealsClosed: agentCurrDeals.length,
      revenue,
      grossProfit: gross,
      proposalsSent: 0, // No per-rep funnel data yet; future enhancement
      statementsReceived: 0,
      prevDealsClosed: agentPrevDeals.length,
      prevRevenue,
      prevProposalsSent: 0,
      goalStatus: goalStatus(agentCurrDeals.length, repGoal),
    };
  }).filter(r => r.dealsClosed > 0 || r.prevDealsClosed > 0 || r.revenue > 0);

  perRepBreakdown.sort((a, b) => b.dealsClosed - a.dealsClosed);

  // ── Goals vs actuals ─────────────────────────────────────────────────────
  const goalsVsActuals: GoalVsActual[] = [
    {
      key: "weekly_revenue",
      label: "Weekly Revenue",
      goal: goalsMap["weekly_revenue"] || 0,
      actual: closedWonRevenue,
      pct: goalsMap["weekly_revenue"] ? Math.round((closedWonRevenue / goalsMap["weekly_revenue"]) * 100) : 0,
      status: goalStatus(closedWonRevenue, goalsMap["weekly_revenue"] || 0) as any,
    },
    {
      key: "weekly_deals",
      label: "Deals Closed",
      goal: goalsMap["weekly_deals"] || 0,
      actual: currDeals.length,
      pct: goalsMap["weekly_deals"] ? Math.round((currDeals.length / goalsMap["weekly_deals"]) * 100) : 0,
      status: goalStatus(currDeals.length, goalsMap["weekly_deals"] || 0) as any,
    },
    {
      key: "weekly_proposals",
      label: "Proposals Sent",
      goal: goalsMap["weekly_proposals"] || 0,
      actual: parseInt(funnel.proposals_sent || 0),
      pct: goalsMap["weekly_proposals"] ? Math.round((parseInt(funnel.proposals_sent || 0) / goalsMap["weekly_proposals"]) * 100) : 0,
      status: goalStatus(parseInt(funnel.proposals_sent || 0), goalsMap["weekly_proposals"] || 0) as any,
    },
    {
      key: "weekly_statements",
      label: "Statements Received",
      goal: goalsMap["weekly_statements"] || 0,
      actual: parseInt(funnel.statements_received || 0),
      pct: goalsMap["weekly_statements"] ? Math.round((parseInt(funnel.statements_received || 0) / goalsMap["weekly_statements"]) * 100) : 0,
      status: goalStatus(parseInt(funnel.statements_received || 0), goalsMap["weekly_statements"] || 0) as any,
    },
    {
      key: "gross_margin_pct",
      label: "Gross Margin %",
      goal: goalsMap["gross_margin_pct"] || 0,
      actual: Math.round(grossMarginPct * 10) / 10,
      pct: goalsMap["gross_margin_pct"] ? Math.round((grossMarginPct / goalsMap["gross_margin_pct"]) * 100) : 0,
      status: goalStatus(grossMarginPct, goalsMap["gross_margin_pct"] || 0) as any,
    },
  ];

  const lineageMetadata = {
    policyVersion: 1,
    sourceRowCount: currDeals.length,
    productionCount: currDeals.length,
    excludedCount: 0,
    unknownCount: 0,
    lineageHwm: new Date(),
  };
  await recordAggregateLineage({
    aggregateType: "executive_kpi",
    aggregateKey: weekStart.toISOString().split("T")[0],
    ...lineageMetadata,
  });

  return {
    weekStart: weekStart.toISOString().split("T")[0],
    weekEnd: weekEnd.toISOString().split("T")[0],
    closedWonRevenue,
    prevClosedWonRevenue,
    revenueDelta: closedWonRevenue - prevClosedWonRevenue,
    revenueWoW,
    grossProfit,
    netProfit,
    grossMarginPct: Math.round(grossMarginPct * 10) / 10,
    netMarginPct: Math.round(netMarginPct * 10) / 10,
    prevGrossMarginPct: Math.round(prevGrossMarginPct * 10) / 10,
    pipelineValue,
    pipelineByStageSummary,
    newDealsClosed: currDeals.length,
    prevDealsClosed: prevDeals.length,
    proposalsSent: parseInt(funnel.proposals_sent || 0),
    prevProposalsSent: parseInt(prevFunnel.proposals_sent || 0),
    statementsReceived: parseInt(funnel.statements_received || 0),
    meetingsBooked: parseInt(funnel.meetings_booked || 0),
    outreachAttempts: parseInt(funnel.outreach_attempts || 0),
    perRepBreakdown,
    goalsVsActuals,
    goals: goalsMap,
    lineageMetadata,
  };
}
