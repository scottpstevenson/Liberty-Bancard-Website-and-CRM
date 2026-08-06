/**
 * executive-ai.ts
 * Dual-AI generation for the executive coaching layer.
 *
 * GPT-4o  → Executive briefing (strategic, analytical, leadership-focused)
 * Claude  → Per-rep coaching cards (empathetic, actionable, gap-analysis)
 *
 * Both functions degrade gracefully: if the relevant API key is absent they
 * return null and the dashboard shows a "Not yet generated" placeholder.
 */

import type { ExecutiveSnapshot, RepBreakdownEntry } from "./executive-kpi";

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number): string {
  return `${n.toFixed(3)}%`;
}

function buildSnapshotSummary(snap: ExecutiveSnapshot): string {
  const wow = (snap.prevWeekVolume != null && snap.prevWeekVolume > 0)
    ? ` (${snap.closedWonVolume >= snap.prevWeekVolume ? "+" : ""}${(((snap.closedWonVolume - snap.prevWeekVolume) / snap.prevWeekVolume) * 100).toFixed(1)}% WoW)`
    : "";
  return `
Week of ${snap.weekStart} to ${snap.weekEnd}

REVENUE PERFORMANCE
  New processing volume boarded: ${fmt$(snap.closedWonVolume)}${wow}
  Deals closed: ${snap.closedWonCount}
  Gross profit (monthly recurring): ${fmt$(snap.grossProfitMonthly)}
  Net profit (monthly recurring): ${fmt$(snap.netProfitMonthly)}
  Gross margin %: ${fmtPct(snap.grossMarginPct)} (goal: ${fmtPct(snap.goalsVsActuals["gross_margin_pct"]?.goal ?? 0.5)})
  Net margin %: ${fmtPct(snap.netMarginPct)} (goal: ${fmtPct(snap.goalsVsActuals["net_margin_pct"]?.goal ?? 0.25)})

PIPELINE
  Open pipeline value: ${fmt$(snap.pipelineValue)} across ${snap.pipelineDealCount} deals

FUNNEL ACTIVITY
  New leads: ${snap.newLeads}
  Proposals sent: ${snap.proposalsSent} (goal: ${snap.goalsVsActuals["weekly_proposals"]?.goal ?? 10})
  Statements received: ${snap.statementsReceived} (goal: ${snap.goalsVsActuals["weekly_statements"]?.goal ?? 8})
  Meetings booked: ${snap.meetingsBooked} (goal: ${snap.goalsVsActuals["weekly_meetings"]?.goal ?? 6})

OUTREACH
  Emails: ${snap.emailsSent} | SMS: ${snap.smsSent} | Calls: ${snap.callsMade} | Replies: ${snap.replyCount}

GOALS STATUS
${Object.entries(snap.goalsVsActuals).map(([k, v]) =>
  `  ${k}: ${v.actual} vs goal ${v.goal} → ${v.status.toUpperCase()} (${v.pct}%)`).join("\n")}

TEAM (${snap.repBreakdown.length} reps with activity)
${snap.repBreakdown.map((r) =>
  `  ${r.name}: ${r.closedWonCount} deals, ${fmt$(r.closedWonVolume)} volume`).join("\n")}
`.trim();
}

// ─── GPT-4o Executive Briefing ────────────────────────────────────────────────

export async function generateGptBriefing(snap: ExecutiveSnapshot): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ExecAI] OpenAI key not set — skipping GPT briefing");
    return null;
  }
  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const summary = buildSnapshotSummary(snap);
    const prompt = `You are the Chief Revenue Officer's strategic AI advisor for Liberty Bancard, a merchant payment processing ISO.

Below is this week's executive KPI summary. Write a concise executive briefing of 200–280 words for leadership.

Structure your response with these three sections (use these exact headers):
**Revenue Verdict** — 2–3 sentences on volume, margin, and WoW trend.
**What's Working** — 2–3 bullet points on the strongest signals this week.
**Top 3 Actions** — Numbered list. Each action must be specific, owner-ready, and revenue-impact focused.

Tone: direct, data-driven, no fluff. Write for a CEO who has 90 seconds.

KPI DATA:
${summary}`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 600,
      temperature: 0.3,
    });

    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch (err: any) {
    console.error("[ExecAI] GPT briefing failed:", err?.message ?? err);
    return null;
  }
}

// ─── Claude Per-Rep Coaching ──────────────────────────────────────────────────

export interface RepCoachingCard {
  agentId: string | null;
  name: string;
  coachingText: string;
  gapSummary: string;
}

export async function generateClaudeCoaching(
  snap: ExecutiveSnapshot,
): Promise<RepCoachingCard[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[ExecAI] ANTHROPIC_API_KEY not set — skipping Claude coaching");
    return null;
  }
  if (snap.repBreakdown.length === 0) return [];

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const goalVolume   = snap.goalsVsActuals["weekly_volume"]?.goal    ?? 346154;
    const goalDeals    = snap.goalsVsActuals["weekly_deals"]?.goal     ?? 4;
    const goalProposals = snap.goalsVsActuals["weekly_proposals"]?.goal ?? 10;

    const repSummaries = snap.repBreakdown.map((r) => `
Rep: ${r.name}
  Deals closed: ${r.closedWonCount} (team goal: ${goalDeals})
  Volume boarded: $${r.closedWonVolume.toLocaleString()} (per-rep pace toward $${goalVolume.toLocaleString()} weekly team goal)
  Proposals sent: ${r.proposalsSent} (goal: ${goalProposals})
  Statements received: ${r.statementsReceived}
  Emails sent: ${r.emailsSent} | Replies: ${r.replyCount}
`.trim()).join("\n\n");

    const prompt = `You are a sales performance coach at Liberty Bancard, a merchant payment processing company.

Write an individual coaching card for each sales rep listed below. For each rep:
1. A GAP SUMMARY (1 sentence): where they fell short vs goal this week, or what they did well.
2. COACHING NOTE (2–4 sentences): empathetic, specific, actionable advice grounded in their numbers. Focus on one behavioral change that would move the needle most next week.

Return a JSON array ONLY — no other text. Each element:
{
  "name": "<rep name>",
  "gapSummary": "<1 sentence>",
  "coachingText": "<2-4 sentence coaching note>"
}

Team context this week:
- Total team volume closed: $${snap.closedWonVolume.toLocaleString()}
- Team volume goal: $${(snap.goalsVsActuals["weekly_volume"]?.goal ?? 346154).toLocaleString()}
- Team status: ${snap.goalsVsActuals["weekly_volume"]?.status ?? "unknown"}

Individual rep data:
${repSummaries}`;

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    // Extract JSON array from response (Claude sometimes wraps in markdown)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn("[ExecAI] Claude response had no JSON array:", raw.slice(0, 200));
      return null;
    }
    const parsed: { name: string; gapSummary: string; coachingText: string }[] =
      JSON.parse(jsonMatch[0]);

    return parsed.map((p) => {
      const rep = snap.repBreakdown.find((r) => r.name === p.name);
      return {
        agentId: rep?.agentId ?? null,
        name: p.name,
        coachingText: p.coachingText,
        gapSummary: p.gapSummary,
      };
    });
  } catch (err: any) {
    console.error("[ExecAI] Claude coaching failed:", err?.message ?? err);
    return null;
  }
}
