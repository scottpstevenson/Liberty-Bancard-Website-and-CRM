import { storage } from "../storage";
import { isGhlConfigured, sendGhlInternalNotification } from "./ghl";
import { db } from "../db";
import { systemSettings } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

let digestInterval: ReturnType<typeof setInterval> | null = null;

export async function generateAndSendWeeklyDigest(): Promise<void> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const lockToken = await acquireJobLock(JOB_NAMES.WEEKLY_DIGEST);
  if (!lockToken) return;

  const adminEmail = process.env.ADMIN_DIGEST_EMAIL;
  if (!adminEmail) {
    console.log("[Weekly Digest] No ADMIN_DIGEST_EMAIL configured, skipping.");
    await releaseJobLock(JOB_NAMES.WEEKLY_DIGEST, true, undefined, lockToken);
    return;
  }
  if (!isGhlConfigured()) {
    console.log("[Weekly Digest] GHL not configured, skipping email send.");
    await releaseJobLock(JOB_NAMES.WEEKLY_DIGEST, true, undefined, lockToken);
    return;
  }

  try {
    const [dealsResult, contactsResult, ticketsResult, allTasks] = await Promise.all([
      storage.getDeals({ limit: 500 }),
      storage.getContacts({ limit: 500 }),
      storage.getTickets({ limit: 500 }),
      storage.getTasks(),
    ]);
    const allDeals = dealsResult.data;
    const allContacts = contactsResult.data;
    const allTickets = ticketsResult.data;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeads = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= sevenDaysAgo).length;
    const newDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= sevenDaysAgo).length;
    const closedWon = allDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
    const closedLost = allDeals.filter(d => d.stage === "Closed Lost" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
    const proposalsSent = allDeals.filter(d => d.stage === "Proposal Sent" && d.updatedAt && new Date(d.updatedAt) >= sevenDaysAgo).length;
    const newTickets = allTickets.filter((t: any) => t.createdAt && new Date(t.createdAt) >= sevenDaysAgo).length;
    const resolvedTickets = allTickets.filter((t: any) => t.resolvedAt && new Date(t.resolvedAt) >= sevenDaysAgo).length;
    const overdueTaskCount = allTasks.filter((t: any) => t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now).length;

    const parseCurrency = (v: string | null | undefined): number => {
      if (!v) return 0;
      const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const wonDeals = allDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo);
    const weeklyRevenue = wonDeals.reduce((s, d) => s + parseCurrency(d.estimatedGrossProfitMonthly), 0);
    const conversionRate = (newDeals > 0) ? Math.round((closedWon / newDeals) * 100) : 0;

    const sourceBreakdown: Record<string, number> = {};
    allContacts
      .filter(c => c.createdAt && new Date(c.createdAt) >= sevenDaysAgo)
      .forEach(c => {
        const src = c.utmSource || c.leadSource || "direct";
        sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
      });

    const period = `${sevenDaysAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`;

    let kpiSection = "";
    try {
      const { getWeeklyKpiDigestData } = await import("./sdr/funnel-metrics");
      const kpi = await getWeeklyKpiDigestData();

      kpiSection = `
<h3>SDR Funnel Metrics</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr style="background:#f5f5f5;">
    <th style="text-align:left;padding:6px;border:1px solid #ddd;">Top of Funnel</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Count</th>
  </tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Leads Found</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.topFunnel.leadsFound}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Enriched</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.topFunnel.leadsEnriched}</strong> (${kpi.topFunnel.enrichmentRate}%)</td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Hot Leads</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.topFunnel.hotCreated}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Warm Leads</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.topFunnel.warmCreated}</strong></td></tr>
</table>
<br>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr style="background:#f5f5f5;">
    <th style="text-align:left;padding:6px;border:1px solid #ddd;">Outreach</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Count</th>
  </tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Emails Sent</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.outreach.emailsSent}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">SMS Sent</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.outreach.smsSent}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Calls Made</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.outreach.callsMade}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Replies</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.outreach.replies}</strong> (${kpi.outreach.replyRate}%)</td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Meetings Booked</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.outreach.meetingsBooked}</strong></td></tr>
</table>
<br>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr style="background:#f5f5f5;">
    <th style="text-align:left;padding:6px;border:1px solid #ddd;">Mid/Bottom Funnel</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Count</th>
  </tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Statements Received</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.midFunnel.statementsReceived}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Proposals Sent</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.midFunnel.proposalsSent}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Closed Won</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.bottomFunnel.closedWon}</strong></td></tr>
  <tr><td style="padding:6px;border:1px solid #ddd;">Win Rate</td><td style="text-align:right;padding:6px;border:1px solid #ddd;"><strong>${kpi.bottomFunnel.winRate}%</strong></td></tr>
</table>

${kpi.verticalPerformance.length > 0 ? `
<h3>Vertical Performance</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr style="background:#f5f5f5;">
    <th style="text-align:left;padding:6px;border:1px solid #ddd;">Vertical</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Leads</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Replies</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Meetings</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Won</th>
  </tr>
  ${kpi.verticalPerformance.map((v: any) => `<tr><td style="padding:6px;border:1px solid #ddd;">${v.vertical}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${v.leads}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${v.replies}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${v.meetings}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${v.closedWon}</td></tr>`).join("")}
</table>` : ""}

${kpi.sourceQuality.length > 0 ? `
<h3>Source Quality</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr style="background:#f5f5f5;">
    <th style="text-align:left;padding:6px;border:1px solid #ddd;">Source</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Leads</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Enrich%</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Reply%</th>
    <th style="text-align:right;padding:6px;border:1px solid #ddd;">Close%</th>
  </tr>
  ${kpi.sourceQuality.map((s: any) => `<tr><td style="padding:6px;border:1px solid #ddd;">${s.sourceType}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${s.totalLeads}</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${s.enrichmentRate}%</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${s.replyRate}%</td><td style="text-align:right;padding:6px;border:1px solid #ddd;">${s.closeRate}%</td></tr>`).join("")}
</table>` : ""}

${kpi.identityHealth.some((i: any) => i.alert) ? `
<h3>Inbox Health Alerts</h3>
<ul>
  ${kpi.identityHealth.filter((i: any) => i.alert).map((i: any) => `<li><strong>${i.label}</strong> (${i.domain}) — Health: ${i.healthScore}%, Alert: ${i.alert}</li>`).join("")}
</ul>` : ""}

${kpi.expansionSuggestions.length > 0 ? `
<h3>Market Expansion Recommendations</h3>
<ul>
  ${kpi.expansionSuggestions.map((s: any) => `<li>${s.reason}</li>`).join("")}
</ul>` : ""}`;
    } catch (kpiErr) {
      console.warn("[Weekly Digest] KPI funnel data unavailable:", kpiErr);
    }

    const emailBody = `
<h2>Liberty Bancard — Weekly KPI Digest</h2>
<p><strong>Period:</strong> ${period}</p>
<hr>
<h3>Pipeline</h3>
<ul>
  <li>New Leads: <strong>${newLeads}</strong></li>
  <li>New Deals: <strong>${newDeals}</strong></li>
  <li>Proposals Sent: <strong>${proposalsSent}</strong></li>
  <li>Closed Won: <strong>${closedWon}</strong></li>
  <li>Closed Lost: <strong>${closedLost}</strong></li>
  <li>Conversion Rate: <strong>${conversionRate}%</strong></li>
  <li>Revenue (Est.): <strong>$${Math.round(weeklyRevenue).toLocaleString()}</strong></li>
</ul>
<h3>Support</h3>
<ul>
  <li>New Tickets: <strong>${newTickets}</strong></li>
  <li>Resolved: <strong>${resolvedTickets}</strong></li>
  <li>Overdue Tasks: <strong>${overdueTaskCount}</strong></li>
</ul>
<h3>Lead Sources</h3>
<ul>
  ${Object.entries(sourceBreakdown).map(([s, c]) => `<li>${s}: <strong>${c}</strong></li>`).join("")}
</ul>
${kpiSection}
<p style="color:#888;font-size:12px;">Auto-generated by Liberty Bancard CRM</p>`;

    const sendResult = await sendGhlInternalNotification({ email: adminEmail, subject: "Weekly KPI Digest — Liberty Bancard", body: emailBody });
    if (!sendResult.success) {
      throw new Error(`GHL email delivery failed for digest: ${sendResult.error ?? "unknown error"}`);
    }
    console.log(`[Weekly Digest] Sent digest to ${adminEmail} for period ${period}`);
    await releaseJobLock(JOB_NAMES.WEEKLY_DIGEST, true, undefined, lockToken);
  } catch (err: any) {
    console.error("[Weekly Digest] Error generating/sending digest:", err);
    await releaseJobLock(JOB_NAMES.WEEKLY_DIGEST, false, err?.message ?? String(err), lockToken);
    // Rethrow so startWeeklyDigestWorker can release the atomic week claim and
    // allow a retry within the same send window.
    throw err;
  }
}

const DIGEST_LAST_SENT_WEEK_KEY = "digest_last_sent_week";

/**
 * Return the ISO week key for the current moment when we are inside the Monday
 * morning send window (09:00–11:00 EST = 14:00–16:00 UTC), or null otherwise.
 * Pure time check — no DB access.
 */
function getMondayMorningWeekKey(): string | null {
  const now = new Date();
  if (now.getUTCDay() !== 1) return null;
  const utcHour = now.getUTCHours();
  if (utcHour < 14 || utcHour > 16) return null;
  const weekNum = Math.ceil(
    ((now.getTime() - new Date(now.getUTCFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
  );
  return `${now.getUTCFullYear()}-W${weekNum}`;
}

/**
 * Atomically claim the right to send the digest for `weekKey`.
 *
 * Uses a raw-SQL INSERT … ON CONFLICT DO NOTHING RETURNING so only one
 * concurrent caller wins the slot regardless of race conditions.
 *
 * Returns true  → this process owns the send for this week.
 * Returns false → another process (or a prior successful run) already claimed it.
 */
async function claimWeekSend(weekKey: string): Promise<boolean> {
  try {
    const value = JSON.stringify({ week: weekKey });
    // Attempt to insert a fresh row. If the key already exists with the SAME
    // week value, DO NOTHING → 0 rows → skip.  If it exists with a DIFFERENT
    // (older) week value, overwrite it → 1 row → we own this week.
    const result = await db.execute(sql`
      INSERT INTO system_settings (key, value)
      VALUES (${DIGEST_LAST_SENT_WEEK_KEY}, ${value}::jsonb)
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE system_settings.value->>'week' IS DISTINCT FROM ${weekKey}
      RETURNING key
    `);
    return (result.rows?.length ?? 0) > 0;
  } catch (err: any) {
    console.warn("[Weekly Digest] claimWeekSend failed (non-fatal):", err?.message);
    return false;
  }
}

/**
 * Release a previously claimed week slot after a delivery failure so the next
 * interval tick can retry.  Silently swallows errors.
 */
async function releaseWeekClaim(): Promise<void> {
  try {
    await db.delete(systemSettings).where(eq(systemSettings.key, DIGEST_LAST_SENT_WEEK_KEY));
  } catch {
    // Non-fatal — worst case the digest is skipped for the rest of the window
  }
}

export function startWeeklyDigestWorker(): void {
  console.log("[Weekly Digest Worker] Started - checking every 30min for Monday 9AM-11AM EST send window");
  digestInterval = setInterval(() => {
    void (async () => {
      try {
        const weekKey = getMondayMorningWeekKey();
        if (!weekKey) return;

        // Check prerequisites before consuming the once-per-week send slot.
        // Config-skip conditions (no adminEmail, GHL not configured) must not
        // burn the claim so they don't suppress the window for a properly
        // configured process running concurrently or after a restart.
        const adminEmail = process.env.ADMIN_DIGEST_EMAIL;
        if (!adminEmail || !isGhlConfigured()) {
          console.log("[Weekly Digest Worker] GHL or ADMIN_DIGEST_EMAIL not configured — skipping without claiming week slot");
          return;
        }

        // Atomic claim: only one worker proceeds even under concurrent deployment
        const claimed = await claimWeekSend(weekKey);
        if (!claimed) return; // already sent this week

        console.log("[Weekly Digest Worker] Monday morning send window detected, generating digest...");
        try {
          await generateAndSendWeeklyDigest();
        } catch (sendErr: any) {
          console.error("[Weekly Digest Worker] Failed to send digest:", sendErr.message);
          // Release the claim so the next tick can retry within the send window
          await releaseWeekClaim();
        }
      } catch (err: any) {
        console.warn("[Weekly Digest Worker] Window check failed:", err.message);
      }
    })();
  }, 30 * 60 * 1000);
}

export function stopWeeklyDigestWorker(): void {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
    console.log("[Weekly Digest Worker] Stopped");
  }
}
