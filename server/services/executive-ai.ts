/**
 * Executive AI Generation Service
 *
 * Uses Replit's built-in AI (OpenAI-compatible endpoint) for both:
 *   - GPT-4o: strategic executive briefing (analytical, concise)
 *   - Claude: per-rep coaching cards (empathetic, actionable)
 */

import type { ExecutiveSnapshot } from "./executive-kpi";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function generateGptBriefing(snap: ExecutiveSnapshot): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const openai = await getOpenAiClient();
    const snapshotText = buildSnapshotText(snap);

    const prompt = `You are the Chief Revenue Officer of Liberty Bancard, a payments processing company. Review this week's business performance data and write a concise executive briefing for leadership.

WEEKLY PERFORMANCE DATA:
${snapshotText}

Write an executive briefing (200–300 words) with:
1. A revenue and margin verdict (2-3 sentences): what the numbers mean, good or bad
2. What is working well this week (1-2 specific observations)
3. Top 3 action items for leadership this week (numbered, specific, actionable)
4. One-sentence overall verdict: Momentum / On Track / At Risk / Critical

Rules: Professional business prose, no markdown headers, flowing paragraphs for the body. The 3 action items may be a numbered list. Be direct and specific — cite actual numbers. 200–300 words total.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 700,
      temperature: 0.3,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? null;

    // Audit log
    try {
      await db.execute(sql`
        INSERT INTO audit_logs (action, entity_type, entity_id, metadata, created_at)
        VALUES ('executive_gpt_briefing', 'executive_snapshot', 0,
          ${JSON.stringify({ weekStart: snap.weekStart, tokens: response.usage?.total_tokens })}::jsonb,
          NOW())
      `);
    } catch { /* non-critical */ }

    return text;
  } catch (err: any) {
    console.error("[ExecutiveAI] GPT briefing failed:", err.message);
    return null;
  }
}

export async function generateClaudeCoaching(
  snap: ExecutiveSnapshot
): Promise<Array<{ agentId: number; name: string; coaching: string }> | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey || snap.perRepBreakdown.length === 0) return null;

  try {
    const openai = await getOpenAiClient();

    const repSummaries = snap.perRepBreakdown.slice(0, 8).map(r => {
      const dealDelta = r.dealsClosed - r.prevDealsClosed;
      const revDelta = r.revenue - r.prevRevenue;
      return `${r.name}: ${r.dealsClosed} deals closed (${dealDelta >= 0 ? "+" : ""}${dealDelta} WoW), ` +
        `${fmt(r.revenue)} revenue (${revDelta >= 0 ? "+" : ""}${fmt(Math.abs(revDelta))} WoW), ` +
        `goal status: ${r.goalStatus}`;
    }).join("\n");

    const goalContext = snap.goalsVsActuals.filter(g => g.goal > 0)
      .map(g => `${g.label}: goal=${g.goal}, team actual=${g.actual}`).join("; ");

    const prompt = `You are an experienced sales coach at Liberty Bancard, a payments processing company. Write short, empathetic, actionable coaching cards for each sales rep based on their weekly performance.

TEAM GOALS THIS WEEK: ${goalContext || "No goals set"}

REP PERFORMANCE (Week of ${snap.weekStart}):
${repSummaries}

For EACH rep listed above, write a coaching card. Format as valid JSON array:
[
  {
    "name": "Rep Name",
    "coaching": "2-3 sentence coaching note. Acknowledge what went well (if anything). Give 2 specific, empathetic, actionable recommendations. Max 120 words."
  }
]

Rules: Empathetic and encouraging tone, never harsh. Cite specific numbers. Focus on behaviors they can change this week. Return only the JSON array, no other text.`;

    const response = await openai.chat.completions.create({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 1500,
      temperature: 0.4,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Parse JSON from response
    let parsed: Array<{ name: string; coaching: string }> = [];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      console.warn("[ExecutiveAI] Claude coaching parse failed, raw:", raw.slice(0, 200));
      return null;
    }

    const result = parsed.map(item => {
      const rep = snap.perRepBreakdown.find(
        r => r.name.toLowerCase() === item.name.toLowerCase()
      );
      return {
        agentId: rep?.agentId ?? 0,
        name: item.name,
        coaching: item.coaching,
      };
    });

    // Audit log
    try {
      await db.execute(sql`
        INSERT INTO audit_logs (action, entity_type, entity_id, metadata, created_at)
        VALUES ('executive_claude_coaching', 'executive_snapshot', 0,
          ${JSON.stringify({ weekStart: snap.weekStart, repCount: result.length, tokens: response.usage?.total_tokens })}::jsonb,
          NOW())
      `);
    } catch { /* non-critical */ }

    return result;
  } catch (err: any) {
    console.error("[ExecutiveAI] Claude coaching failed:", err.message);
    return null;
  }
}

export async function generateExecutiveAi(
  snap: ExecutiveSnapshot
): Promise<AiGenerationResult> {
  const [gptBriefing, claudeCoaching] = await Promise.allSettled([
    generateGptBriefing(snap),
    generateClaudeCoaching(snap),
  ]);

  return {
    gptBriefing: gptBriefing.status === "fulfilled" ? gptBriefing.value : null,
    claudeCoaching: claudeCoaching.status === "fulfilled" ? claudeCoaching.value : null,
    gptError: gptBriefing.status === "rejected" ? (gptBriefing.reason as Error).message : undefined,
    claudeError: claudeCoaching.status === "rejected" ? (claudeCoaching.reason as Error).message : undefined,
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export interface AiGenerationResult {
  gptBriefing: string | null;
  claudeCoaching: Array<{ agentId: number; name: string; coaching: string }> | null;
  gptError?: string;
  claudeError?: string;
}

function buildSnapshotText(snap: ExecutiveSnapshot): string {
  const revWoW = snap.revenueWoW >= 0 ? `+${snap.revenueWoW}%` : `${snap.revenueWoW}%`;
  const lines = [
    `Week: ${snap.weekStart} → ${snap.weekEnd}`,
    `Closed-Won Revenue: ${fmt(snap.closedWonRevenue)} (${revWoW} WoW vs ${fmt(snap.prevClosedWonRevenue)})`,
    `Deals Closed: ${snap.newDealsClosed} (prev week: ${snap.prevDealsClosed})`,
    `Proposals Sent: ${snap.proposalsSent} (prev: ${snap.prevProposalsSent})`,
    `Statements Received: ${snap.statementsReceived}`,
    `Meetings Booked: ${snap.meetingsBooked}`,
    `Gross Margin: ${snap.grossMarginPct}% (prev: ${snap.prevGrossMarginPct}%)`,
    `Net Margin: ${snap.netMarginPct}%`,
    `Active Pipeline: ${fmt(snap.pipelineValue)}`,
    ``,
    `Pipeline by Stage:`,
    ...snap.pipelineByStageSummary.map(s => `  ${s.stage}: ${s.count} deals / ${fmt(s.value)}`),
    ``,
    `Goals vs Actuals:`,
    ...snap.goalsVsActuals.filter(g => g.goal > 0).map(g =>
      `  ${g.label}: ${g.actual} / ${g.goal} goal (${g.pct}%) — ${g.status.toUpperCase()}`
    ),
    ``,
    `Top Reps (deals closed this week):`,
    ...snap.perRepBreakdown.slice(0, 6).map(r =>
      `  ${r.name}: ${r.dealsClosed} deals / ${fmt(r.revenue)} revenue (prev: ${r.prevDealsClosed} deals)`
    ),
  ];
  return lines.join("\n");
}

async function getOpenAiClient() {
  const { OpenAI } = await import("openai");
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL }
      : {}),
  });
}
