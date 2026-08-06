/**
 * executive-kpi.ts
 * Aggregates week-over-week KPI data for the executive dashboard.
 * Queries deals, pipeline, outreach, and per-rep stats.
 */

import { db } from "../db";
import { sql, and, gte, lte, isNull, ne, inArray } from "drizzle-orm";
import { deals, contacts, dailyFunnelMetrics, executiveWeeklySnapshots, executiveGoals } from "../../shared/schema";

export interface RepBreakdownEntry {
  agentId: string | null;
  name: string;
  closedWonCount: number;
  closedWonVolume: number;
  grossProfitMonthly: number;
  netProfitMonthly: number;
  proposalsSent: number;
  statementsReceived: number;
  meetingsBooked: number;
  emailsSent: number;
  replyCount: number;
}

export interface GoalEntry {
  key: string;
  value: number;
  period: string;
  label: string | null;
}

export interface GoalStatus {
  goal: number;
  actual: number;
  status: "green" | "yellow" | "red";
  pct: number;
}

export interface ExecutiveSnapshot {
  weekStart: string;           // ISO date 'YYYY-MM-DD'
  weekEnd: string;
  // Revenue
  closedWonVolume: number;
  closedWonCount: number;
  grossProfitMonthly: number;
  netProfitMonthly: number;
  grossMarginPct: number;      // e.g. 0.45 = 0.45%
  netMarginPct: number;
  // Pipeline
  pipelineValue: number;
  pipelineDealCount: number;
  // Funnel
  newLeads: number;
  proposalsSent: number;
  statementsReceived: number;
  meetingsBooked: number;
  // Outreach
  emailsSent: number;
  smsSent: number;
  callsMade: number;
  replyCount: number;
  // Goals
  goals: GoalEntry[];
  goalsVsActuals: Record<string, GoalStatus>;
  // Per-rep
  repBreakdown: RepBreakdownEntry[];
  // WoW
  prevWeekVolume: number | null;
  prevWeekDeals: number | null;
  prevWeekGrossMargin: number | null;
}

/** Get Monday–Sunday bounds for a given date */
export function getWeekBounds(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { weekStart: monday, weekEnd: sunday };
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Load all goals from DB */
export async function loadGoals(): Promise<GoalEntry[]> {
  const rows = await db.select().from(executiveGoals);
  return rows.map((r) => ({
    key: r.key,
    value: Number(r.value),
    period: r.period,
    label: r.label,
  }));
}

/** Map goals array to a lookup dict */
function goalsMap(goals: GoalEntry[]): Record<string, number> {
  return Object.fromEntries(goals.map((g) => [g.key, g.value]));
}

/** Compute green/yellow/red for a metric vs its goal */
function rateStatus(actual: number, goal: number): GoalStatus {
  if (goal === 0) return { goal, actual, status: "green", pct: 100 };
  const pct = Math.round((actual / goal) * 100);
  const status: GoalStatus["status"] = pct >= 90 ? "green" : pct >= 70 ? "yellow" : "red";
  return { goal, actual, status, pct };
}

/** Compute the full executive snapshot for the given week */
export async function computeExecSnapshot(weekDate: Date = new Date()): Promise<ExecutiveSnapshot> {
  const { weekStart, weekEnd } = getWeekBounds(weekDate);
  const weekStartStr = toDateStr(weekStart);
  const weekEndStr = toDateStr(weekEnd);

  // ── Closed-Won deals this week ───────────────────────────────────────────
  const closedRows = await db.execute<{
    owner: string | null;
    est_monthly_revenue: string | null;
    estimated_gross_profit_monthly: string | null;
    estimated_net_profit_monthly: string | null;
  }>(sql`
    SELECT
      owner,
      est_monthly_revenue,
      estimated_gross_profit_monthly,
      estimated_net_profit_monthly
    FROM deals
    WHERE stage = 'Closed Won'
      AND archived_at IS NULL
      AND closed_at >= ${weekStart}
      AND closed_at <= ${weekEnd}
  `);
  const closedDeals = closedRows.rows ?? (closedRows as any) as typeof closedRows.rows;

  const closedWonVolume = closedDeals.reduce((s, r) => s + Number(r.est_monthly_revenue ?? 0), 0);
  const grossProfitMonthly = closedDeals.reduce((s, r) => s + Number(r.estimated_gross_profit_monthly ?? 0), 0);
  const netProfitMonthly = closedDeals.reduce((s, r) => s + Number(r.estimated_net_profit_monthly ?? 0), 0);
  const closedWonCount = closedDeals.length;
  const grossMarginPct = closedWonVolume > 0 ? (grossProfitMonthly / closedWonVolume) * 100 : 0;
  const netMarginPct   = closedWonVolume > 0 ? (netProfitMonthly   / closedWonVolume) * 100 : 0;

  // ── Pipeline (all open deals) ────────────────────────────────────────────
  const pipelineRows = await db.execute<{
    cnt: string;
    total_value: string;
  }>(sql`
    SELECT
      COUNT(*) AS cnt,
      COALESCE(SUM(CAST(est_monthly_revenue AS NUMERIC)), 0) AS total_value
    FROM deals
    WHERE stage NOT IN ('Closed Won', 'Closed Lost')
      AND archived_at IS NULL
  `);
  const pipelineRow = (pipelineRows.rows ?? pipelineRows as any)[0] ?? {};
  const pipelineValue     = Number(pipelineRow.total_value ?? 0);
  const pipelineDealCount = Number(pipelineRow.cnt ?? 0);

  // ── Funnel from dailyFunnelMetrics ───────────────────────────────────────
  const funnelRows = await db.execute<{
    leads_found: string;
    proposals_sent: string;
    statements_received: string;
    meetings_booked: string;
    emails_sent: string;
    sms_sent: string;
    calls_made: string;
    replies: string;
  }>(sql`
    SELECT
      COALESCE(SUM(leads_found), 0)         AS leads_found,
      COALESCE(SUM(proposals_sent), 0)      AS proposals_sent,
      COALESCE(SUM(statements_received), 0) AS statements_received,
      COALESCE(SUM(meetings_booked), 0)     AS meetings_booked,
      COALESCE(SUM(emails_sent), 0)         AS emails_sent,
      COALESCE(SUM(sms_sent), 0)            AS sms_sent,
      COALESCE(SUM(calls_made), 0)          AS calls_made,
      COALESCE(SUM(replies), 0)             AS replies
    FROM daily_funnel_metrics
    WHERE date >= ${weekStartStr} AND date <= ${weekEndStr}
  `);
  const f = (funnelRows.rows ?? funnelRows as any)[0] ?? {};
  const newLeads          = Number(f.leads_found ?? 0);
  const proposalsSent     = Number(f.proposals_sent ?? 0);
  const statementsReceived = Number(f.statements_received ?? 0);
  const meetingsBooked    = Number(f.meetings_booked ?? 0);
  const emailsSent        = Number(f.emails_sent ?? 0);
  const smsSent           = Number(f.sms_sent ?? 0);
  const callsMade         = Number(f.calls_made ?? 0);
  const replyCount        = Number(f.replies ?? 0);

  // ── Per-rep breakdown ────────────────────────────────────────────────────
  const repMap: Record<string, RepBreakdownEntry> = {};
  for (const row of closedDeals) {
    const key = row.owner ?? "__unassigned__";
    if (!repMap[key]) {
      repMap[key] = {
        agentId: row.owner,
        name: row.owner ?? "Unassigned",
        closedWonCount: 0,
        closedWonVolume: 0,
        grossProfitMonthly: 0,
        netProfitMonthly: 0,
        proposalsSent: 0,
        statementsReceived: 0,
        meetingsBooked: 0,
        emailsSent: 0,
        replyCount: 0,
      };
    }
    repMap[key].closedWonCount++;
    repMap[key].closedWonVolume += Number(row.est_monthly_revenue ?? 0);
    repMap[key].grossProfitMonthly += Number(row.estimated_gross_profit_monthly ?? 0);
    repMap[key].netProfitMonthly += Number(row.estimated_net_profit_monthly ?? 0);
  }
  const repBreakdown = Object.values(repMap);

  // ── Goals ────────────────────────────────────────────────────────────────
  const goals = await loadGoals();
  const gm = goalsMap(goals);

  const goalsVsActuals: Record<string, GoalStatus> = {
    weekly_volume:    rateStatus(closedWonVolume,     gm["weekly_volume_goal"]      ?? 346154),
    weekly_deals:     rateStatus(closedWonCount,      gm["weekly_deals_closed_goal"] ?? 4),
    weekly_proposals: rateStatus(proposalsSent,       gm["weekly_proposals_goal"]    ?? 10),
    weekly_statements: rateStatus(statementsReceived, gm["weekly_statements_goal"]   ?? 8),
    weekly_meetings:  rateStatus(meetingsBooked,      gm["weekly_meetings_goal"]     ?? 6),
    gross_margin_pct: rateStatus(grossMarginPct,      gm["gross_margin_pct_goal"]    ?? 0.5),
    net_margin_pct:   rateStatus(netMarginPct,        gm["net_margin_pct_goal"]      ?? 0.25),
  };

  // ── Previous week for WoW delta ──────────────────────────────────────────
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const prevRows = await db.execute<{
    closed_won_volume: string;
    closed_won_count: string;
    gross_margin_pct: string;
  }>(sql`
    SELECT closed_won_volume, closed_won_count, gross_margin_pct
    FROM executive_weekly_snapshots
    WHERE week_start = ${toDateStr(prevWeekStart)}
    LIMIT 1
  `);
  const prev = (prevRows.rows ?? prevRows as any)[0];
  const prevWeekVolume      = prev ? Number(prev.closed_won_volume) : null;
  const prevWeekDeals       = prev ? Number(prev.closed_won_count)  : null;
  const prevWeekGrossMargin = prev ? Number(prev.gross_margin_pct)  : null;

  return {
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    closedWonVolume,
    closedWonCount,
    grossProfitMonthly,
    netProfitMonthly,
    grossMarginPct: Math.round(grossMarginPct * 10000) / 10000,
    netMarginPct:   Math.round(netMarginPct   * 10000) / 10000,
    pipelineValue,
    pipelineDealCount,
    newLeads,
    proposalsSent,
    statementsReceived,
    meetingsBooked,
    emailsSent,
    smsSent,
    callsMade,
    replyCount,
    goals,
    goalsVsActuals,
    repBreakdown,
    prevWeekVolume,
    prevWeekDeals,
    prevWeekGrossMargin,
  };
}

/** Persist a snapshot to DB (upsert on week_start) */
export async function persistSnapshot(
  snap: ExecutiveSnapshot,
  gptBriefing: string | null,
  claudeCoaching: object | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO executive_weekly_snapshots (
      week_start, closed_won_volume, closed_won_count,
      gross_profit_monthly, net_profit_monthly, gross_margin_pct, net_margin_pct,
      pipeline_value, pipeline_deal_count,
      new_leads, proposals_sent, statements_received, meetings_booked,
      emails_sent, sms_sent, calls_made, reply_count,
      goals_snapshot, goals_vs_actuals, rep_breakdown,
      gpt_briefing, claude_coaching, ai_generated_at, updated_at
    ) VALUES (
      ${snap.weekStart},
      ${snap.closedWonVolume}, ${snap.closedWonCount},
      ${snap.grossProfitMonthly}, ${snap.netProfitMonthly},
      ${snap.grossMarginPct}, ${snap.netMarginPct},
      ${snap.pipelineValue}, ${snap.pipelineDealCount},
      ${snap.newLeads}, ${snap.proposalsSent}, ${snap.statementsReceived}, ${snap.meetingsBooked},
      ${snap.emailsSent}, ${snap.smsSent}, ${snap.callsMade}, ${snap.replyCount},
      ${JSON.stringify(snap.goals)}::jsonb,
      ${JSON.stringify(snap.goalsVsActuals)}::jsonb,
      ${JSON.stringify(snap.repBreakdown)}::jsonb,
      ${gptBriefing},
      ${claudeCoaching ? JSON.stringify(claudeCoaching) : null}::jsonb,
      ${gptBriefing || claudeCoaching ? new Date() : null},
      NOW()
    )
    ON CONFLICT (week_start) DO UPDATE SET
      closed_won_volume    = EXCLUDED.closed_won_volume,
      closed_won_count     = EXCLUDED.closed_won_count,
      gross_profit_monthly = EXCLUDED.gross_profit_monthly,
      net_profit_monthly   = EXCLUDED.net_profit_monthly,
      gross_margin_pct     = EXCLUDED.gross_margin_pct,
      net_margin_pct       = EXCLUDED.net_margin_pct,
      pipeline_value       = EXCLUDED.pipeline_value,
      pipeline_deal_count  = EXCLUDED.pipeline_deal_count,
      new_leads            = EXCLUDED.new_leads,
      proposals_sent       = EXCLUDED.proposals_sent,
      statements_received  = EXCLUDED.statements_received,
      meetings_booked      = EXCLUDED.meetings_booked,
      emails_sent          = EXCLUDED.emails_sent,
      sms_sent             = EXCLUDED.sms_sent,
      calls_made           = EXCLUDED.calls_made,
      reply_count          = EXCLUDED.reply_count,
      goals_snapshot       = EXCLUDED.goals_snapshot,
      goals_vs_actuals     = EXCLUDED.goals_vs_actuals,
      rep_breakdown        = EXCLUDED.rep_breakdown,
      gpt_briefing         = COALESCE(EXCLUDED.gpt_briefing, executive_weekly_snapshots.gpt_briefing),
      claude_coaching      = COALESCE(EXCLUDED.claude_coaching, executive_weekly_snapshots.claude_coaching),
      ai_generated_at      = COALESCE(EXCLUDED.ai_generated_at, executive_weekly_snapshots.ai_generated_at),
      updated_at           = NOW()
  `);
}
