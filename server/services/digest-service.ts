import { storage } from "../storage";
import { pool } from "../db";
import { sendGhlInternalNotification, isGhlConfigured } from "./ghl";
import { sendSmtpEmail, isSmtpConfigured } from "./smtp-email";
import type { InsertNotification } from "@shared/schema";
import { observeCommercialReportingPopulation } from "./commercial-resolution";

async function observeDigestPopulation(): Promise<void> {
  await Promise.all([
    observeCommercialReportingPopulation({ subjectType: "contact" }),
    observeCommercialReportingPopulation({ subjectType: "deal" }),
  ]).catch((error) => {
    console.error("[CRO02_DIGEST_OBSERVATION_FAILED]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  });
}

async function deliverDigestEmail(to: string, subject: string, html: string): Promise<void> {
  if (isGhlConfigured()) {
    try {
      await sendGhlInternalNotification({ email: to, subject, body: html, fromEmail: "accounts@libertybancard.com", fromName: "Liberty Bancard" });
      console.log(`[Digest] Delivered via GHL to ${to}`);
      return;
    } catch (err) {
      console.warn(`[Digest] GHL delivery failed for ${to}, trying SMTP fallback:`, err);
    }
  }
  if (isSmtpConfigured()) {
    const result = await sendSmtpEmail({ to, subject, html, category: "internal_ops" });
    if (result.success) {
      console.log(`[Digest] Delivered via SMTP to ${to}`);
    } else {
      console.error(`[Digest] SMTP delivery also failed for ${to}: ${result.error}`);
    }
  } else {
    console.warn(`[Digest] No delivery channel available for ${to} — GHL not configured and SMTP_PASS not set. Digest stored as internal notification only.`);
  }
}

function parseCurrency(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function getEstHour(): number {
  const now = new Date();
  const estString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estString).getHours();
}

function getEstDayOfWeek(): number {
  const now = new Date();
  const estString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estString).getDay();
}

export async function buildDailyDigest(): Promise<{
  html: string;
  summary: Record<string, any>;
}> {
  await observeDigestPopulation();
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    newLeadsCountRow,
    newLeadsRows,
    dealsProgressedRow,
    closedWonRow,
    closedLostRow,
    tasksCompletedRow,
    tasksOverdueCountRow,
    tasksOverdueRows,
    newTicketsRow,
    resolvedTicketsRow,
  ] = await Promise.all([
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM contacts WHERE archived_at IS NULL AND record_class = 'production' AND created_at >= $1
    `, [twentyFourHoursAgo]),
    pool.query<{ first_name: string; last_name: string; company_name: string | null; lead_source: string | null }>(`
      SELECT first_name, last_name, company_name, lead_source
      FROM contacts WHERE archived_at IS NULL AND created_at >= $1
      ORDER BY created_at DESC LIMIT 10
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals
      WHERE archived_at IS NULL AND updated_at >= $1 AND stage != 'New Lead'
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals
      WHERE archived_at IS NULL AND stage = 'Closed Won' AND closed_at >= $1
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals
      WHERE archived_at IS NULL AND stage = 'Closed Lost' AND closed_at >= $1
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tasks
      WHERE status = 'completed' AND completed_at >= $1
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tasks WHERE status != 'completed' AND due_date < $1
    `, [now]),
    pool.query<{ id: number; title: string; assigned_to: string | null; due_date: string | null }>(`
      SELECT id, title, assigned_to, due_date FROM tasks
      WHERE status != 'completed' AND due_date < $1
      ORDER BY due_date ASC LIMIT 10
    `, [now]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tickets WHERE created_at >= $1
    `, [twentyFourHoursAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tickets WHERE resolved_at >= $1
    `, [twentyFourHoursAgo]),
  ]);

  const newLeads = newLeadsRows.rows;
  const tasksOverdue = tasksOverdueRows.rows;

  // --- Churn risk: High + Critical merchants ---
  let highRiskChurnMerchants: { name: string; score: number; tier: string }[] = [];
  try {
    const churnScores = await storage.getMerchantHealthScores();
    const atRisk = churnScores.filter(s => s.riskTier === "Critical" || s.riskTier === "High");
    highRiskChurnMerchants = await Promise.all(
      atRisk.slice(0, 10).map(async s => {
        try {
          const contact = await storage.getContact(s.contactId);
          const name = contact?.companyName
            || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ")
            || `Contact #${s.contactId}`;
          const effectiveScore = s.overrideScore !== null ? s.overrideScore : s.churnScore;
          return { name, score: Math.round(effectiveScore), tier: s.riskTier };
        } catch {
          return { name: `Contact #${s.contactId}`, score: Math.round(s.churnScore), tier: s.riskTier };
        }
      })
    );
  } catch {}

  const summary = {
    date: now.toLocaleDateString("en-US", { timeZone: "America/New_York" }),
    newLeadsCount: parseInt(newLeadsCountRow.rows[0]?.cnt ?? "0", 10),
    dealsProgressedCount: parseInt(dealsProgressedRow.rows[0]?.cnt ?? "0", 10),
    closedWonCount: parseInt(closedWonRow.rows[0]?.cnt ?? "0", 10),
    closedLostCount: parseInt(closedLostRow.rows[0]?.cnt ?? "0", 10),
    tasksCompletedCount: parseInt(tasksCompletedRow.rows[0]?.cnt ?? "0", 10),
    tasksOverdueCount: parseInt(tasksOverdueCountRow.rows[0]?.cnt ?? "0", 10),
    newTicketsCount: parseInt(newTicketsRow.rows[0]?.cnt ?? "0", 10),
    resolvedTicketsCount: parseInt(resolvedTicketsRow.rows[0]?.cnt ?? "0", 10),
    churnAtRiskCount: highRiskChurnMerchants.length,
  };

  const newLeadsList = newLeads
    .map(
      (c) =>
        `<li>${c.first_name} ${c.last_name}${c.company_name ? ` — ${c.company_name}` : ""}${c.lead_source ? ` (${c.lead_source})` : ""}</li>`
    )
    .join("");

  const overdueList = tasksOverdue
    .map(
      (t) =>
        `<li>${t.title}${t.assigned_to ? ` — ${t.assigned_to}` : ""} (due ${t.due_date ? new Date(t.due_date).toLocaleDateString() : "N/A"})</li>`
    )
    .join("");

  const churnRiskHtml = highRiskChurnMerchants.length > 0
    ? `<h3 style="color:#c0392b;">⚠ Churn Risk Alert (${highRiskChurnMerchants.length} merchants)</h3>
<p>The following merchants are classified as <strong>High</strong> or <strong>Critical</strong> churn risk and require immediate retention attention:</p>
<ul>
  ${highRiskChurnMerchants.map(m => `<li><strong>${m.name}</strong> — ${m.tier} (score: ${m.score}/100)</li>`).join("")}
</ul>`
    : "";

  const html = `
<h2>Liberty Bancard — Daily Activity Digest</h2>
<p><strong>Date:</strong> ${summary.date}</p>
<hr>
<h3>New Leads (${summary.newLeadsCount})</h3>
${newLeads.length > 0 ? `<ul>${newLeadsList}</ul>` : "<p>No new leads today.</p>"}
<h3>Pipeline Activity</h3>
<ul>
  <li>Deals Progressed: <strong>${summary.dealsProgressedCount}</strong></li>
  <li>Closed Won: <strong>${summary.closedWonCount}</strong></li>
  <li>Closed Lost: <strong>${summary.closedLostCount}</strong></li>
</ul>
<h3>Tasks</h3>
<ul>
  <li>Completed Today: <strong>${summary.tasksCompletedCount}</strong></li>
  <li>Currently Overdue: <strong>${summary.tasksOverdueCount}</strong></li>
</ul>
${tasksOverdue.length > 0 ? `<p><strong>Overdue Tasks:</strong></p><ul>${overdueList}</ul>` : ""}
<h3>Support</h3>
<ul>
  <li>New Tickets: <strong>${summary.newTicketsCount}</strong></li>
  <li>Resolved: <strong>${summary.resolvedTicketsCount}</strong></li>
</ul>
${churnRiskHtml}
<p style="color:#888;font-size:12px;">Auto-generated by Liberty Bancard CRM at ${now.toLocaleString("en-US", { timeZone: "America/New_York" })} EST</p>`;

  return { html, summary };
}

export async function buildWeeklyDigest(): Promise<{
  html: string;
  summary: Record<string, any>;
}> {
  await observeDigestPopulation();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    newLeadsRow,
    newDealsRow,
    closedWonRows,
    closedLostRow,
    proposalsSentRow,
    newTicketsRow,
    resolvedTicketsRow,
    overdueTasksRow,
    pipelineValueRow,
    sourceRows,
    leaderboardRows,
    avgCycleRow,
  ] = await Promise.all([
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM contacts
      WHERE archived_at IS NULL AND record_class = 'production' AND created_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals WHERE archived_at IS NULL AND record_class = 'production' AND created_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ owner: string | null; estimated_gross_profit_monthly: string | null }>(`
      SELECT owner, estimated_gross_profit_monthly FROM deals
      WHERE archived_at IS NULL AND record_class = 'production' AND stage = 'Closed Won' AND closed_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals
      WHERE archived_at IS NULL AND record_class = 'production' AND stage = 'Closed Lost' AND closed_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM deals
      WHERE archived_at IS NULL AND record_class = 'production' AND stage = 'Proposal Sent' AND updated_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tickets WHERE created_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tickets WHERE resolved_at >= $1
    `, [sevenDaysAgo]),
    pool.query<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt FROM tasks WHERE status != 'completed' AND due_date < $1
    `, [now]),
    pool.query<{ total_value: string }>(`
      SELECT COALESCE(SUM(CASE WHEN estimated_gross_profit_monthly IS NOT NULL AND estimated_gross_profit_monthly != ''
        THEN CAST(REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') AS DECIMAL) ELSE 0 END), 0)::text AS total_value
      FROM deals WHERE archived_at IS NULL AND record_class = 'production' AND pipeline = 'sales'
        AND stage NOT IN ('Closed Won', 'Closed Lost')
    `),
    pool.query<{ src: string; cnt: string }>(`
      SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(lead_source, ''), 'direct') AS src, COUNT(*)::text AS cnt
      FROM contacts WHERE archived_at IS NULL AND record_class = 'production' AND created_at >= $1
      GROUP BY src ORDER BY cnt::int DESC LIMIT 5
    `, [sevenDaysAgo]),
    pool.query<{ owner: string; wins: string }>(`
      SELECT COALESCE(owner, 'Unassigned') AS owner, COUNT(*)::text AS wins
      FROM deals WHERE archived_at IS NULL AND record_class = 'production' AND stage = 'Closed Won' AND closed_at >= $1
      GROUP BY owner ORDER BY wins::int DESC LIMIT 5
    `, [sevenDaysAgo]),
    pool.query<{ avg_days: string }>(`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400), 0)::text AS avg_days
      FROM deals WHERE archived_at IS NULL AND record_class = 'production' AND stage = 'Closed Won'
        AND closed_at >= $1 AND created_at IS NOT NULL AND closed_at IS NOT NULL
    `, [sevenDaysAgo]),
  ]);

  const closedWonList = closedWonRows.rows;
  const newDeals = parseInt(newDealsRow.rows[0]?.cnt ?? "0", 10);
  const closedWonCount = closedWonList.length;
  const weeklyRevenue = closedWonList.reduce((s, d) => s + parseCurrency(d.estimated_gross_profit_monthly), 0);
  const conversionRate = newDeals > 0 ? Math.round((closedWonCount / newDeals) * 100) : 0;

  const topSources = sourceRows.rows.map(r => [r.src, parseInt(r.cnt, 10)] as [string, number]);
  const leaderboard = leaderboardRows.rows.map(r => [r.owner, parseInt(r.wins, 10)] as [string, number]);

  const summary = {
    period: `${sevenDaysAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`,
    newLeads: parseInt(newLeadsRow.rows[0]?.cnt ?? "0", 10),
    newDeals,
    proposalsSent: parseInt(proposalsSentRow.rows[0]?.cnt ?? "0", 10),
    closedWonCount,
    closedLost: parseInt(closedLostRow.rows[0]?.cnt ?? "0", 10),
    conversionRate,
    weeklyRevenue: Math.round(weeklyRevenue),
    pipelineValue: Math.round(parseFloat(pipelineValueRow.rows[0]?.total_value ?? "0")),
    avgCycleTimeDays: Math.round(parseFloat(avgCycleRow.rows[0]?.avg_days ?? "0")),
    newTickets: parseInt(newTicketsRow.rows[0]?.cnt ?? "0", 10),
    resolvedTickets: parseInt(resolvedTicketsRow.rows[0]?.cnt ?? "0", 10),
    overdueTaskCount: parseInt(overdueTasksRow.rows[0]?.cnt ?? "0", 10),
    topSources,
    leaderboard,
  };

  const html = `
<h2>Liberty Bancard — Weekly KPI Digest</h2>
<p><strong>Period:</strong> ${summary.period}</p>
<hr>
<h3>Pipeline Overview</h3>
<ul>
  <li>Active Pipeline Value: <strong>$${summary.pipelineValue.toLocaleString()}/mo</strong></li>
  <li>New Leads: <strong>${summary.newLeads}</strong></li>
  <li>New Deals: <strong>${summary.newDeals}</strong></li>
  <li>Proposals Sent: <strong>${summary.proposalsSent}</strong></li>
  <li>Closed Won: <strong>${summary.closedWonCount}</strong></li>
  <li>Closed Lost: <strong>${summary.closedLost}</strong></li>
  <li>Win Rate: <strong>${summary.conversionRate}%</strong></li>
  <li>Avg Deal Cycle: <strong>${summary.avgCycleTimeDays} days</strong></li>
  <li>Revenue (Est.): <strong>$${summary.weeklyRevenue.toLocaleString()}</strong></li>
</ul>
<h3>Support</h3>
<ul>
  <li>New Tickets: <strong>${summary.newTickets}</strong></li>
  <li>Resolved: <strong>${summary.resolvedTickets}</strong></li>
  <li>Overdue Tasks: <strong>${summary.overdueTaskCount}</strong></li>
</ul>
<h3>Top Lead Sources</h3>
<ul>
  ${topSources.map(([s, c]) => `<li>${s}: <strong>${c}</strong></li>`).join("")}
</ul>
${
  leaderboard.length > 0
    ? `<h3>Rep Leaderboard (Closed Won)</h3>
<ol>
  ${leaderboard.map(([name, wins]) => `<li>${name}: <strong>${wins} win${wins > 1 ? "s" : ""}</strong></li>`).join("")}
</ol>`
    : ""
}
<p style="color:#888;font-size:12px;">Auto-generated by Liberty Bancard CRM</p>`;

  return { html, summary };
}

export async function createPreferenceAwareNotification(
  notif: InsertNotification,
  eventType?: string
): Promise<void> {
  if (eventType && notif.recipientId) {
    const prefs = await storage.getNotificationPreferences(notif.recipientId);
    const pref = prefs.find((p) => p.eventType === eventType);
    if (pref && pref.enabled === false) return;
  }
  await storage.createNotification(notif);
}

async function resolveOwnerEmail(ownerName?: string | null): Promise<string | null> {
  if (!ownerName) return null;
  const allUsers = await storage.getUsersByRole(["admin", "manager", "agent"]);
  const ownerLower = ownerName.toLowerCase().trim();
  const match = allUsers.find((u) => {
    if (u.email && u.email.toLowerCase() === ownerLower) return true;
    if (u.id === ownerName) return true;
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").toLowerCase().trim();
    if (fullName && fullName === ownerLower) return true;
    if (u.firstName && u.firstName.toLowerCase().trim() === ownerLower) return true;
    return false;
  });
  return match?.email || null;
}

async function getDigestRecipients(digestType: "daily" | "weekly"): Promise<string[]> {
  const recipients: string[] = [];
  const adminManagerUsers = await storage.getUsersByRole(["admin", "manager"]);

  for (const user of adminManagerUsers) {
    if (!user.email) continue;
    const prefs = await storage.getNotificationPreferences(user.id);
    const eventType = digestType === "daily" ? "daily_digest" : "weekly_digest";
    const pref = prefs.find((p) => p.eventType === eventType);
    const optedIn = digestType === "daily"
      ? (pref ? !!pref.digestDaily : true)
      : (pref ? !!pref.digestWeekly : true);
    if (optedIn) {
      recipients.push(user.email);
    }
  }

  const fallbackEmail = process.env.ADMIN_DIGEST_EMAIL;
  if (recipients.length === 0 && fallbackEmail) {
    recipients.push(fallbackEmail);
  }

  return [...new Set(recipients)];
}

async function getEmailEnabledRecipients(eventType: string): Promise<string[]> {
  const recipients: string[] = [];
  const allPrefs = await storage.getAllNotificationPreferencesByEvent(eventType);
  const enabledPrefs = allPrefs.filter((p) => p.emailEnabled);

  if (enabledPrefs.length > 0) {
    const allUsers = await storage.getUsersByRole(["admin", "manager", "agent"]);
    for (const pref of enabledPrefs) {
      const user = allUsers.find((u) => u.id === pref.userId);
      if (user?.email) {
        recipients.push(user.email);
      }
    }
  }

  const fallbackEmail = process.env.ADMIN_DIGEST_EMAIL;
  if (recipients.length === 0 && fallbackEmail) {
    recipients.push(fallbackEmail);
  }

  return [...new Set(recipients)];
}

export async function sendCriticalEmailNotification(params: {
  eventType: string;
  subject: string;
  body: string;
  recipientEmail?: string;
  ownerName?: string | null;
}): Promise<void> {
  if (!isGhlConfigured()) return;

  const recipients: string[] = [];

  if (params.recipientEmail) {
    recipients.push(params.recipientEmail);
  }

  if (params.ownerName) {
    const ownerEmail = await resolveOwnerEmail(params.ownerName);
    if (ownerEmail && !recipients.includes(ownerEmail)) {
      recipients.push(ownerEmail);
    }
  }

  const prefRecipients = await getEmailEnabledRecipients(params.eventType);
  for (const email of prefRecipients) {
    if (!recipients.includes(email)) {
      recipients.push(email);
    }
  }

  if (recipients.length === 0) {
    const fallback = process.env.ADMIN_DIGEST_EMAIL;
    if (fallback) recipients.push(fallback);
  }

  for (const email of recipients) {
    try {
      await sendGhlInternalNotification({
        email,
        subject: params.subject,
        body: params.body,
      });
      console.log(
        `[Notification] Sent ${params.eventType} email to ${email}`
      );
    } catch (err) {
      console.error(
        `[Notification] Failed to send ${params.eventType} email to ${email}:`,
        err
      );
    }
  }
}

export async function checkAndSendDigests(): Promise<void> {
  const estHour = getEstHour();
  const estDay = getEstDayOfWeek();
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
  });

  const lastDailyDigestDate = await storage.getSystemSetting("last_daily_digest_date");
  const lastWeeklyDigestDate = await storage.getSystemSetting("last_weekly_digest_date");
  const lastSdrDigestDate = await storage.getSystemSetting("last_sdr_daily_digest_date");

  if (estHour === 8 && lastSdrDigestDate !== todayStr) {
    await storage.setSystemSetting("last_sdr_daily_digest_date", todayStr);
    try {
      const { buildSdrDailyDigest, sendSdrDailyDigest } = await import("./sdr/operator-digest");
      const digest = await buildSdrDailyDigest();
      await sendSdrDailyDigest(digest);
      console.log("[Digest] SDR daily digest sent");
    } catch (err) {
      console.error("[Digest] SDR daily digest error:", err);
    }
  }

  if (estHour === 8 && lastDailyDigestDate !== todayStr) {
    await storage.setSystemSetting("last_daily_digest_date", todayStr);
    try {
      const { html, summary } = await buildDailyDigest();

      await storage.createNotification({
        channel: "internal",
        title: "Daily Activity Digest",
        message: `${summary.newLeadsCount} new leads, ${summary.closedWonCount} closed won, ${summary.tasksOverdueCount} overdue tasks`,
        type: "info",
        metadata: { digestType: "daily", ...summary },
      });

      const dailyRecipients = await getDigestRecipients("daily");
      for (const email of dailyRecipients) {
        await deliverDigestEmail(email, `Daily Digest — ${summary.date} — Liberty Bancard`, html);
      }

      await storage.createAuditLog({
        action: "daily_digest_sent",
        entityType: "system",
        details: summary,
      });
    } catch (err) {
      console.error("[Digest] Daily digest error:", err);
    }
  }

  if (estHour === 9 && estDay === 1 && lastWeeklyDigestDate !== todayStr) {
    await storage.setSystemSetting("last_weekly_digest_date", todayStr);
    try {
      const { html, summary } = await buildWeeklyDigest();

      await storage.createNotification({
        channel: "internal",
        title: "Weekly KPI Digest",
        message: `${summary.closedWonCount} closed won, ${summary.conversionRate}% win rate, $${summary.weeklyRevenue.toLocaleString()} revenue`,
        type: "info",
        metadata: { digestType: "weekly", ...summary },
      });

      const weeklyRecipients = await getDigestRecipients("weekly");
      for (const email of weeklyRecipients) {
        await deliverDigestEmail(email, `Weekly KPI Digest — ${summary.period} — Liberty Bancard`, html);
      }

      await storage.createAuditLog({
        action: "weekly_digest_sent",
        entityType: "system",
        details: summary,
      });
    } catch (err) {
      console.error("[Digest] Weekly digest error:", err);
    }
  }
}
