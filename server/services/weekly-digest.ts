import { storage } from "../storage";
import { isGhlConfigured, sendGhlEmailForMerchant } from "./ghl";

let digestInterval: ReturnType<typeof setInterval> | null = null;

export async function generateAndSendWeeklyDigest(): Promise<void> {
  const adminEmail = process.env.ADMIN_DIGEST_EMAIL;
  if (!adminEmail) {
    console.log("[Weekly Digest] No ADMIN_DIGEST_EMAIL configured, skipping.");
    return;
  }
  if (!isGhlConfigured()) {
    console.log("[Weekly Digest] GHL not configured, skipping email send.");
    return;
  }

  try {
    const [allDeals, allContacts, allTickets, allTasks] = await Promise.all([
      storage.getDeals(),
      storage.getContacts(),
      storage.getTickets(),
      storage.getTasks(),
    ]);

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeads = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= sevenDaysAgo).length;
    const newDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= sevenDaysAgo).length;
    const closedWon = allDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
    const closedLost = allDeals.filter(d => d.stage === "Closed Lost" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
    const proposalsSent = allDeals.filter(d => d.stage === "Proposal Sent" && d.updatedAt && new Date(d.updatedAt) >= sevenDaysAgo).length;
    const newTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= sevenDaysAgo).length;
    const resolvedTickets = allTickets.filter(t => t.resolvedAt && new Date(t.resolvedAt) >= sevenDaysAgo).length;
    const overdueTaskCount = allTasks.filter(t => t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now).length;

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

    await sendGhlEmailForMerchant({ email: adminEmail, subject: "Weekly KPI Digest — Liberty Bancard", body: emailBody });
    console.log(`[Weekly Digest] Sent digest to ${adminEmail} for period ${period}`);
  } catch (err) {
    console.error("[Weekly Digest] Error generating/sending digest:", err);
  }
}

let lastSentWeek: string | null = null;

function isMondayMorningSendWindow(): boolean {
  const now = new Date();
  if (now.getUTCDay() !== 1) return false;
  const utcHour = now.getUTCHours();
  if (utcHour < 14 || utcHour > 16) return false;
  const weekKey = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - new Date(now.getUTCFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)}`;
  if (lastSentWeek === weekKey) return false;
  lastSentWeek = weekKey;
  return true;
}

export function startWeeklyDigestWorker(): void {
  console.log("[Weekly Digest Worker] Started - checking every 30min for Monday 9AM-11AM EST send window");
  digestInterval = setInterval(async () => {
    if (isMondayMorningSendWindow()) {
      console.log("[Weekly Digest Worker] Monday morning send window detected, generating digest...");
      await generateAndSendWeeklyDigest();
    }
  }, 30 * 60 * 1000);
}

export function stopWeeklyDigestWorker(): void {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
    console.log("[Weekly Digest Worker] Stopped");
  }
}
