import { db } from "../../db";
import { dailyFunnelMetrics, sendingIdentities, identityPerformanceDaily, sdrChannelAttempts } from "@shared/schema";
import { sql, and, gte, eq } from "drizzle-orm";

export interface AnomalyAlert {
  id: string;
  type: "send_volume_deviation" | "reply_rate_drop" | "inbox_bounce_spike" | "inbox_degraded";
  severity: "warning" | "critical";
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  threshold: number;
  detectedAt: string;
  identityId?: number;
  identityLabel?: string;
}

function getEstDateString(date?: Date): string {
  return (date || new Date()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function checkSendVolumeAnomaly(): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  const today = getEstDateString();
  const sevenDaysAgo = getEstDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const yesterday = getEstDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const weekAvg = await db.select({
    avgEmails: sql<number>`COALESCE(AVG(${dailyFunnelMetrics.emailsSent}), 0)`,
    avgSms: sql<number>`COALESCE(AVG(${dailyFunnelMetrics.smsSent}), 0)`,
    avgCalls: sql<number>`COALESCE(AVG(${dailyFunnelMetrics.callsMade}), 0)`,
  }).from(dailyFunnelMetrics).where(
    and(
      sql`${dailyFunnelMetrics.date} >= ${sevenDaysAgo}`,
      sql`${dailyFunnelMetrics.date} < ${today}`,
      sql`${dailyFunnelMetrics.vertical} IS NULL AND ${dailyFunnelMetrics.state} IS NULL AND ${dailyFunnelMetrics.sourceType} IS NULL`
    )
  );

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCounts = await db.select({
    channel: sdrChannelAttempts.channel,
    count: sql<number>`count(*)`,
  }).from(sdrChannelAttempts).where(
    gte(sdrChannelAttempts.sentAt, todayStart)
  ).groupBy(sdrChannelAttempts.channel);

  const avg = weekAvg[0] || { avgEmails: 0, avgSms: 0, avgCalls: 0 };
  const todayMap: Record<string, number> = {};
  for (const row of todayCounts) {
    if (row.channel) todayMap[row.channel] = row.count;
  }

  const channels = [
    { name: "email", current: todayMap["email"] || 0, avg: avg.avgEmails },
    { name: "sms", current: todayMap["sms"] || 0, avg: avg.avgSms },
    { name: "call", current: todayMap["call"] || 0, avg: avg.avgCalls },
  ];

  for (const ch of channels) {
    if (ch.avg > 5) {
      const deviation = Math.abs(ch.current - ch.avg) / ch.avg;
      if (deviation > 0.5) {
        const direction = ch.current > ch.avg ? "above" : "below";
        alerts.push({
          id: `volume_${ch.name}_${today}`,
          type: "send_volume_deviation",
          severity: deviation > 0.75 ? "critical" : "warning",
          title: `${ch.name.charAt(0).toUpperCase() + ch.name.slice(1)} volume ${direction} normal`,
          description: `Today's ${ch.name} volume (${ch.current}) is ${Math.round(deviation * 100)}% ${direction} the 7-day average (${Math.round(ch.avg)})`,
          metric: `${ch.name}_send_volume`,
          currentValue: ch.current,
          expectedValue: Math.round(ch.avg),
          threshold: 0.5,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return alerts;
}

async function checkReplyRateDrop(): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  const today = getEstDateString();
  const sevenDaysAgo = getEstDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

  const weekStats = await db.select({
    totalEmails: sql<number>`COALESCE(SUM(${dailyFunnelMetrics.emailsSent}), 0)`,
    totalReplies: sql<number>`COALESCE(SUM(${dailyFunnelMetrics.replies}), 0)`,
  }).from(dailyFunnelMetrics).where(
    and(
      sql`${dailyFunnelMetrics.date} >= ${sevenDaysAgo}`,
      sql`${dailyFunnelMetrics.date} < ${today}`,
      sql`${dailyFunnelMetrics.vertical} IS NULL AND ${dailyFunnelMetrics.state} IS NULL AND ${dailyFunnelMetrics.sourceType} IS NULL`
    )
  );

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEmails = await db.select({
    count: sql<number>`count(*)`,
  }).from(sdrChannelAttempts).where(
    and(
      eq(sdrChannelAttempts.channel, "email"),
      gte(sdrChannelAttempts.sentAt, todayStart)
    )
  );

  const todayReplies = await db.select({
    count: sql<number>`count(*)`,
  }).from(sdrChannelAttempts).where(
    and(
      eq(sdrChannelAttempts.channel, "email"),
      gte(sdrChannelAttempts.sentAt, todayStart),
      sql`${sdrChannelAttempts.repliedAt} IS NOT NULL`
    )
  );

  const ws = weekStats[0] || { totalEmails: 0, totalReplies: 0 };
  const weekReplyRate = ws.totalEmails > 10 ? ws.totalReplies / ws.totalEmails : 0;
  const todayEmailCount = todayEmails[0]?.count || 0;
  const todayReplyCount = todayReplies[0]?.count || 0;
  const todayReplyRate = todayEmailCount > 10 ? todayReplyCount / todayEmailCount : 0;

  if (weekReplyRate > 0.01 && todayEmailCount > 10) {
    const drop = (weekReplyRate - todayReplyRate) / weekReplyRate;
    if (drop > 0.3) {
      alerts.push({
        id: `reply_rate_drop_${today}`,
        type: "reply_rate_drop",
        severity: drop > 0.5 ? "critical" : "warning",
        title: "Reply rate declining",
        description: `Today's reply rate (${(todayReplyRate * 100).toFixed(1)}%) is ${Math.round(drop * 100)}% below the 7-day average (${(weekReplyRate * 100).toFixed(1)}%)`,
        metric: "email_reply_rate",
        currentValue: Math.round(todayReplyRate * 1000) / 10,
        expectedValue: Math.round(weekReplyRate * 1000) / 10,
        threshold: 0.3,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

async function checkInboxBounceSpikes(): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  const today = getEstDateString();

  const identities = await db.select().from(sendingIdentities).where(
    sql`${sendingIdentities.warmupStatus} IN ('warm', 'warming') AND ${sendingIdentities.isActive} = true`
  );

  for (const identity of identities) {
    const todayPerf = await db.select({
      sent: sql<number>`COALESCE(${identityPerformanceDaily.emailsSent}, 0)`,
      bounced: sql<number>`COALESCE(${identityPerformanceDaily.bounced}, 0)`,
    }).from(identityPerformanceDaily).where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identity.id),
        eq(identityPerformanceDaily.date, today)
      )
    );

    const perf = todayPerf[0];
    if (!perf || perf.sent < 5) continue;

    const bounceRate = perf.bounced / perf.sent;
    if (bounceRate > 0.03) {
      alerts.push({
        id: `bounce_spike_${identity.id}_${today}`,
        type: "inbox_bounce_spike",
        severity: bounceRate > 0.05 ? "critical" : "warning",
        title: `High bounce rate on ${identity.label}`,
        description: `${identity.emailAddress} has a ${(bounceRate * 100).toFixed(1)}% bounce rate today (${perf.bounced}/${perf.sent} bounced)`,
        metric: "inbox_bounce_rate",
        currentValue: Math.round(bounceRate * 1000) / 10,
        expectedValue: 3,
        threshold: 3,
        detectedAt: new Date().toISOString(),
        identityId: identity.id,
        identityLabel: identity.label,
      });
    }
  }

  return alerts;
}

async function checkInboxDegradation(): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];

  const degradedInboxes = await db.select().from(sendingIdentities).where(
    and(
      sql`${sendingIdentities.isActive} = true`,
      sql`(${sendingIdentities.healthScore} IS NOT NULL AND ${sendingIdentities.healthScore} < 70)`
    )
  );

  for (const inbox of degradedInboxes) {
    alerts.push({
      id: `degraded_${inbox.id}`,
      type: "inbox_degraded",
      severity: (inbox.healthScore || 0) < 50 ? "critical" : "warning",
      title: `Inbox health degraded: ${inbox.label}`,
      description: `${inbox.emailAddress} health score is ${inbox.healthScore}/100. Consider pausing or investigating deliverability.`,
      metric: "inbox_health_score",
      currentValue: inbox.healthScore || 0,
      expectedValue: 80,
      threshold: 70,
      detectedAt: new Date().toISOString(),
      identityId: inbox.id,
      identityLabel: inbox.label,
    });
  }

  return alerts;
}

export async function runAnomalyDetection(): Promise<AnomalyAlert[]> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("../job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.ANOMALY_DETECTION);
  if (!acquired) return [];

  const allAlerts: AnomalyAlert[] = [];

  try {
    const [volumeAlerts, replyAlerts, bounceAlerts, degradedAlerts] = await Promise.all([
      checkSendVolumeAnomaly(),
      checkReplyRateDrop(),
      checkInboxBounceSpikes(),
      checkInboxDegradation(),
    ]);

    allAlerts.push(...volumeAlerts, ...replyAlerts, ...bounceAlerts, ...degradedAlerts);

    if (allAlerts.length > 0) {
      console.log(`[AnomalyDetection] Found ${allAlerts.length} alerts: ${allAlerts.map(a => a.type).join(", ")}`);
    }
    await releaseJobLock(JOB_NAMES.ANOMALY_DETECTION, true);
  } catch (err: any) {
    console.error("[AnomalyDetection] Error running detection:", err);
    await releaseJobLock(JOB_NAMES.ANOMALY_DETECTION, false, err?.message ?? String(err));
  }

  return allAlerts;
}

export async function getAnomalyAlertsSummary(): Promise<{
  alerts: AnomalyAlert[];
  criticalCount: number;
  warningCount: number;
  lastChecked: string;
}> {
  const alerts = await runAnomalyDetection();

  return {
    alerts,
    criticalCount: alerts.filter(a => a.severity === "critical").length,
    warningCount: alerts.filter(a => a.severity === "warning").length,
    lastChecked: new Date().toISOString(),
  };
}
