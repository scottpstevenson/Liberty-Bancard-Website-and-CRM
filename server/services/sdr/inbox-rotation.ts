import { db } from "../../db";
import { sendingIdentities, identityPerformanceDaily, domainBusinessLog } from "@shared/schema";
import type { SendingIdentity, InsertIdentityPerformanceDaily } from "@shared/schema";
import { eq, and, desc, sql, gte, lte, asc } from "drizzle-orm";

const WARMUP_START_LIMIT = 5;
const WARMUP_DAILY_INCREMENT = 3;
const WARMUP_DURATION_DAYS = 14;
const BOUNCE_RATE_THRESHOLD = 0.05;
const COMPLAINT_RATE_THRESHOLD = 0.001;
const HEALTH_SCORE_PAUSE_THRESHOLD = 50;
const MIN_SAFE_DAILY_LIMIT = 20;
const MAX_SAFE_DAILY_LIMIT = 35;

function getEstDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function daysSince(date: Date | null): number {
  if (!date) return 999;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

const SCOTT_EMAIL = "Scott@mail.libertybancard.com";

/**
 * Seeds Scott@mail.libertybancard.com as the primary sending identity if it does not
 * already exist. Called automatically on server startup.
 * Values: warmupStatus=warm, isActive=true, dailyLimit=30, healthScore=100.
 */
export async function seedScottSendingIdentity(): Promise<void> {
  const [existing] = await db
    .select()
    .from(sendingIdentities)
    .where(eq(sendingIdentities.emailAddress, SCOTT_EMAIL))
    .limit(1);

  if (existing) {
    console.log(`[Seed] Scott sending identity already exists (id=${existing.id}), skipping.`);
    return;
  }

  const [identity] = await db
    .insert(sendingIdentities)
    .values({
      label: "Scott - Liberty Bancard",
      domain: "mail.libertybancard.com",
      emailAddress: SCOTT_EMAIL,
      mailboxType: "google_workspace",
      isActive: true,
      warmupStatus: "warm",
      warmupStartedAt: new Date(),
      dailyLimit: 30,
      sentToday: 0,
      bouncesToday: 0,
      complaintsToday: 0,
      healthScore: 100,
      verticalAssignment: null,
      lastUsedAt: null,
      provider: null,
      ghlLocationId: null,
    })
    .returning();

  console.log(`[Seed] Scott sending identity created (id=${identity.id}): ${SCOTT_EMAIL}, warmupStatus=warm, dailyLimit=30, healthScore=100`);
}

export async function selectBestInbox(
  businessId: number,
  vertical?: string
): Promise<SendingIdentity | null> {
  const allIdentities = await db
    .select()
    .from(sendingIdentities)
    .where(
      and(
        eq(sendingIdentities.isActive, true),
        sql`${sendingIdentities.warmupStatus} IN ('warm', 'warming')`
      )
    );

  const available = allIdentities.filter((id) => {
    const effectiveLimit = getEffectiveDailyLimit(id);
    return (id.sentToday || 0) < effectiveLimit;
  });

  if (available.length === 0) return null;

  const usedDomains = await db
    .select({ domain: domainBusinessLog.domain })
    .from(domainBusinessLog)
    .where(eq(domainBusinessLog.businessId, businessId));

  const usedDomainSet = new Set(usedDomains.map((d) => d.domain));

  let filtered = available.filter((id) => !usedDomainSet.has(id.domain));

  if (filtered.length === 0) {
    // Explicit fallback: if all other domains have been used for this business,
    // check if Scott's identity is still within its daily limit before giving up.
    const scottIdentity = available.find(id => id.emailAddress === SCOTT_EMAIL);
    if (scottIdentity && (scottIdentity.sentToday || 0) < getEffectiveDailyLimit(scottIdentity)) {
      console.log(`[Inbox Rotation] Falling back to Scott's identity for business ${businessId} (all other domains exhausted)`);
      return scottIdentity;
    }
    console.log(`[Inbox Rotation] All domains already used for business ${businessId}, no inbox available`);
    return null;
  }

  // Sort: fewest sent today → highest health score → warm before warming → vertical match
  filtered.sort((a, b) => {
    const sentDiff = (a.sentToday || 0) - (b.sentToday || 0);
    if (sentDiff !== 0) return sentDiff;

    const healthDiff = (b.healthScore || 0) - (a.healthScore || 0);
    if (healthDiff !== 0) return healthDiff;

    const warmthOrder = { warm: 0, warming: 1, paused: 2, disabled: 3 };
    const aWarmth = warmthOrder[(a.warmupStatus as keyof typeof warmthOrder) || "disabled"] ?? 3;
    const bWarmth = warmthOrder[(b.warmupStatus as keyof typeof warmthOrder) || "disabled"] ?? 3;
    if (aWarmth !== bWarmth) return aWarmth - bWarmth;

    if (vertical) {
      const aMatch = a.verticalAssignment === vertical ? 0 : (a.verticalAssignment ? 2 : 1);
      const bMatch = b.verticalAssignment === vertical ? 0 : (b.verticalAssignment ? 2 : 1);
      if (aMatch !== bMatch) return aMatch - bMatch;
    }

    return 0;
  });

  return filtered[0] || null;
}

/**
 * Atomically records a send for the given identity.
 * Uses a single SQL UPDATE with a WHERE guard (sent_today < effective_limit)
 * so concurrent sends cannot race past the daily cap.
 * Returns true when the increment succeeded, false when the cap was already reached.
 */
export async function recordSend(
  identityId: number,
  businessId: number
): Promise<boolean> {
  // Read identity once to compute the warmup-aware effective limit.
  const [identity] = await db
    .select()
    .from(sendingIdentities)
    .where(eq(sendingIdentities.id, identityId))
    .limit(1);

  if (!identity) return false;

  const effectiveLimit = getEffectiveDailyLimit(identity);

  // Atomic increment — only executes when still under the daily cap.
  const updated = await db
    .update(sendingIdentities)
    .set({
      sentToday: sql`COALESCE(${sendingIdentities.sentToday}, 0) + 1`,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sendingIdentities.id, identityId),
        sql`COALESCE(${sendingIdentities.sentToday}, 0) < ${effectiveLimit}`
      )
    )
    .returning({ id: sendingIdentities.id });

  if (updated.length === 0) {
    console.log(`[Inbox Rotation] Daily cap reached for identity ${identityId} (limit: ${effectiveLimit}), blocking send`);
    return false;
  }

  await db.insert(domainBusinessLog).values({
    domain: identity.domain,
    businessId,
  });

  // Update daily performance counters using SQL expression to avoid read-write race.
  const today = getEstDateString();
  const existing = await db
    .select()
    .from(identityPerformanceDaily)
    .where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identityId),
        eq(identityPerformanceDaily.date, today)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(identityPerformanceDaily)
      .set({ emailsSent: sql`COALESCE(${identityPerformanceDaily.emailsSent}, 0) + 1` })
      .where(eq(identityPerformanceDaily.id, existing[0].id));
  } else {
    await db.insert(identityPerformanceDaily).values({
      sendingIdentityId: identityId,
      date: today,
      emailsSent: 1,
    });
  }

  return true;
}

/**
 * Rolls back a previously-reserved send slot when the provider send fails
 * after slot reservation. Decrements sentToday by 1, never below 0.
 */
export async function rollbackSend(identityId: number): Promise<void> {
  try {
    await db
      .update(sendingIdentities)
      .set({
        sentToday: sql`GREATEST(COALESCE(${sendingIdentities.sentToday}, 0) - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(sendingIdentities.id, identityId));
  } catch (err) {
    console.warn(`[Inbox Rotation] rollbackSend failed for identity ${identityId}:`, err);
  }
}

export async function recordDelivered(identityId: number): Promise<void> {
  const today = getEstDateString();
  await db
    .update(identityPerformanceDaily)
    .set({
      delivered: sql`COALESCE(${identityPerformanceDaily.delivered}, 0) + 1`,
    })
    .where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identityId),
        eq(identityPerformanceDaily.date, today)
      )
    );
}

export async function recordBounce(identityId: number): Promise<void> {
  const identity = await db
    .select()
    .from(sendingIdentities)
    .where(eq(sendingIdentities.id, identityId))
    .limit(1);

  if (!identity[0]) return;

  await db
    .update(sendingIdentities)
    .set({
      bouncesToday: (identity[0].bouncesToday || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(sendingIdentities.id, identityId));

  const today = getEstDateString();
  await db
    .update(identityPerformanceDaily)
    .set({
      bounced: sql`COALESCE(${identityPerformanceDaily.bounced}, 0) + 1`,
    })
    .where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identityId),
        eq(identityPerformanceDaily.date, today)
      )
    );
}

export async function recordComplaint(identityId: number): Promise<void> {
  const identity = await db
    .select()
    .from(sendingIdentities)
    .where(eq(sendingIdentities.id, identityId))
    .limit(1);

  if (!identity[0]) return;

  await db
    .update(sendingIdentities)
    .set({
      complaintsToday: (identity[0].complaintsToday || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(sendingIdentities.id, identityId));

  const today = getEstDateString();
  await db
    .update(identityPerformanceDaily)
    .set({
      complaints: sql`COALESCE(${identityPerformanceDaily.complaints}, 0) + 1`,
    })
    .where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identityId),
        eq(identityPerformanceDaily.date, today)
      )
    );
}

export async function recordOpen(identityId: number): Promise<void> {
  const today = getEstDateString();
  await db
    .update(identityPerformanceDaily)
    .set({
      opened: sql`COALESCE(${identityPerformanceDaily.opened}, 0) + 1`,
    })
    .where(
      and(
        eq(identityPerformanceDaily.sendingIdentityId, identityId),
        eq(identityPerformanceDaily.date, today)
      )
    );
}

export async function recordReply(
  identityId: number,
  positive?: boolean
): Promise<void> {
  const today = getEstDateString();
  if (positive) {
    await db
      .update(identityPerformanceDaily)
      .set({
        replied: sql`COALESCE(${identityPerformanceDaily.replied}, 0) + 1`,
        positiveReplies: sql`COALESCE(${identityPerformanceDaily.positiveReplies}, 0) + 1`,
      })
      .where(
        and(
          eq(identityPerformanceDaily.sendingIdentityId, identityId),
          eq(identityPerformanceDaily.date, today)
        )
      );
  } else {
    await db
      .update(identityPerformanceDaily)
      .set({
        replied: sql`COALESCE(${identityPerformanceDaily.replied}, 0) + 1`,
      })
      .where(
        and(
          eq(identityPerformanceDaily.sendingIdentityId, identityId),
          eq(identityPerformanceDaily.date, today)
        )
      );
  }
}

export function clampDailyLimit(limit: number): number {
  return Math.max(MIN_SAFE_DAILY_LIMIT, Math.min(MAX_SAFE_DAILY_LIMIT, limit));
}

function getEffectiveDailyLimit(identity: SendingIdentity): number {
  if (identity.warmupStatus === "warm") {
    const limit = identity.dailyLimit || 30;
    return Math.min(limit, MAX_SAFE_DAILY_LIMIT);
  }
  if (identity.warmupStatus === "warming") {
    const days = daysSince(identity.warmupStartedAt);
    const warmupLimit = WARMUP_START_LIMIT + days * WARMUP_DAILY_INCREMENT;
    const configuredLimit = Math.min(identity.dailyLimit || 30, MAX_SAFE_DAILY_LIMIT);
    return Math.min(warmupLimit, configuredLimit);
  }
  return 0;
}

export async function runWarmupManager(): Promise<{
  transitioned: number;
  updated: number;
}> {
  let transitioned = 0;
  let updated = 0;

  const warmingIdentities = await db
    .select()
    .from(sendingIdentities)
    .where(eq(sendingIdentities.warmupStatus, "warming"));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  for (const identity of warmingIdentities) {
    const days = daysSince(identity.warmupStartedAt);
    if (days >= WARMUP_DURATION_DAYS) {
      const recentStats = await db
        .select({
          totalSent: sql<number>`COALESCE(SUM(${identityPerformanceDaily.emailsSent}), 0)`,
          totalBounced: sql<number>`COALESCE(SUM(${identityPerformanceDaily.bounced}), 0)`,
          totalComplaints: sql<number>`COALESCE(SUM(${identityPerformanceDaily.complaints}), 0)`,
        })
        .from(identityPerformanceDaily)
        .where(
          and(
            eq(identityPerformanceDaily.sendingIdentityId, identity.id),
            gte(identityPerformanceDaily.date, sevenDaysAgoStr)
          )
        );

      const stats = recentStats[0];
      const bounceRate = stats && stats.totalSent > 0 ? stats.totalBounced / stats.totalSent : 0;
      const complaintRate = stats && stats.totalSent > 0 ? stats.totalComplaints / stats.totalSent : 0;
      const minVolume = stats ? stats.totalSent >= 10 : false;

      if (minVolume && bounceRate <= BOUNCE_RATE_THRESHOLD && complaintRate <= COMPLAINT_RATE_THRESHOLD) {
        await db
          .update(sendingIdentities)
          .set({ warmupStatus: "warm", updatedAt: new Date() })
          .where(eq(sendingIdentities.id, identity.id));
        transitioned++;
        console.log(`[Inbox Rotation] Identity ${identity.label} transitioned to warm (stable: bounce ${(bounceRate * 100).toFixed(1)}%, complaint ${(complaintRate * 100).toFixed(2)}%)`);
      } else {
        updated++;
        console.log(`[Inbox Rotation] Identity ${identity.label} not yet stable for warm transition (sent: ${stats?.totalSent || 0}, bounce: ${(bounceRate * 100).toFixed(1)}%, complaint: ${(complaintRate * 100).toFixed(2)}%)`);
      }
    } else {
      updated++;
    }
  }

  return { transitioned, updated };
}

export async function calculateHealthScores(): Promise<{
  updated: number;
  paused: number;
}> {
  let updated = 0;
  let paused = 0;

  const allIdentities = await db
    .select()
    .from(sendingIdentities)
    .where(
      sql`${sendingIdentities.warmupStatus} IN ('warm', 'warming')`
    );

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  for (const identity of allIdentities) {
    const stats = await db
      .select({
        totalSent: sql<number>`COALESCE(SUM(${identityPerformanceDaily.emailsSent}), 0)`,
        totalDelivered: sql<number>`COALESCE(SUM(${identityPerformanceDaily.delivered}), 0)`,
        totalBounced: sql<number>`COALESCE(SUM(${identityPerformanceDaily.bounced}), 0)`,
        totalOpened: sql<number>`COALESCE(SUM(${identityPerformanceDaily.opened}), 0)`,
        totalReplied: sql<number>`COALESCE(SUM(${identityPerformanceDaily.replied}), 0)`,
        totalComplaints: sql<number>`COALESCE(SUM(${identityPerformanceDaily.complaints}), 0)`,
      })
      .from(identityPerformanceDaily)
      .where(
        and(
          eq(identityPerformanceDaily.sendingIdentityId, identity.id),
          gte(identityPerformanceDaily.date, sevenDaysAgoStr)
        )
      );

    const s = stats[0];
    if (!s || s.totalSent === 0) {
      await db
        .update(sendingIdentities)
        .set({ healthScore: 100, updatedAt: new Date() })
        .where(eq(sendingIdentities.id, identity.id));
      updated++;
      continue;
    }

    const bounceRate = s.totalBounced / s.totalSent;
    const complaintRate = s.totalComplaints / s.totalSent;
    const deliveryRate = s.totalDelivered > 0 ? s.totalDelivered / s.totalSent : (1 - bounceRate);
    const openRate = s.totalSent > 0 ? s.totalOpened / s.totalSent : 0;
    const replyRate = s.totalSent > 0 ? s.totalReplied / s.totalSent : 0;

    let score = 100;
    if (bounceRate > BOUNCE_RATE_THRESHOLD) score -= 30;
    else if (bounceRate > 0.03) score -= 15;
    if (complaintRate > COMPLAINT_RATE_THRESHOLD) score -= 40;
    else if (complaintRate > 0.0005) score -= 20;
    if (deliveryRate < 0.9) score -= 15;
    else if (deliveryRate < 0.95) score -= 5;
    if (openRate < 0.1) score -= 10;
    if (replyRate > 0.05) score += 5;
    score = Math.max(0, Math.min(100, score));

    const shouldPause =
      bounceRate > BOUNCE_RATE_THRESHOLD ||
      complaintRate > COMPLAINT_RATE_THRESHOLD ||
      score < HEALTH_SCORE_PAUSE_THRESHOLD;

    if (shouldPause && identity.warmupStatus !== "paused") {
      await db
        .update(sendingIdentities)
        .set({
          healthScore: score,
          warmupStatus: "paused",
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(sendingIdentities.id, identity.id));
      paused++;
      console.log(
        `[Inbox Rotation] Identity ${identity.label} auto-paused (health: ${score}, bounce: ${(bounceRate * 100).toFixed(1)}%, complaint: ${(complaintRate * 100).toFixed(2)}%)`
      );
    } else {
      await db
        .update(sendingIdentities)
        .set({ healthScore: score, updatedAt: new Date() })
        .where(eq(sendingIdentities.id, identity.id));
      updated++;
    }
  }

  return { updated, paused };
}

export async function resetDailySendCounts(): Promise<number> {
  const result = await db
    .update(sendingIdentities)
    .set({ sentToday: 0, bouncesToday: 0, complaintsToday: 0, updatedAt: new Date() })
    .returning();
  return result.length;
}

export async function getInboxHealthDashboard(): Promise<{
  identities: (SendingIdentity & {
    effectiveDailyLimit: number;
    last7Days: {
      sent: number;
      bounced: number;
      opened: number;
      replied: number;
      complaints: number;
      bounceRate: number;
      openRate: number;
      replyRate: number;
      complaintRate: number;
    };
  })[];
  totalCapacity: number;
  usedCapacity: number;
  activeCount: number;
  warmingCount: number;
  pausedCount: number;
}> {
  const allIdentities = await db
    .select()
    .from(sendingIdentities)
    .orderBy(asc(sendingIdentities.domain), asc(sendingIdentities.label));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const enriched = await Promise.all(
    allIdentities.map(async (identity) => {
      const stats = await db
        .select({
          totalSent: sql<number>`COALESCE(SUM(${identityPerformanceDaily.emailsSent}), 0)`,
          totalBounced: sql<number>`COALESCE(SUM(${identityPerformanceDaily.bounced}), 0)`,
          totalOpened: sql<number>`COALESCE(SUM(${identityPerformanceDaily.opened}), 0)`,
          totalReplied: sql<number>`COALESCE(SUM(${identityPerformanceDaily.replied}), 0)`,
          totalComplaints: sql<number>`COALESCE(SUM(${identityPerformanceDaily.complaints}), 0)`,
        })
        .from(identityPerformanceDaily)
        .where(
          and(
            eq(identityPerformanceDaily.sendingIdentityId, identity.id),
            gte(identityPerformanceDaily.date, sevenDaysAgoStr)
          )
        );

      const s = stats[0] || {
        totalSent: 0,
        totalBounced: 0,
        totalOpened: 0,
        totalReplied: 0,
        totalComplaints: 0,
      };

      return {
        ...identity,
        effectiveDailyLimit: getEffectiveDailyLimit(identity),
        last7Days: {
          sent: s.totalSent,
          bounced: s.totalBounced,
          opened: s.totalOpened,
          replied: s.totalReplied,
          complaints: s.totalComplaints,
          bounceRate: s.totalSent > 0 ? s.totalBounced / s.totalSent : 0,
          openRate: s.totalSent > 0 ? s.totalOpened / s.totalSent : 0,
          replyRate: s.totalSent > 0 ? s.totalReplied / s.totalSent : 0,
          complaintRate: s.totalSent > 0 ? s.totalComplaints / s.totalSent : 0,
        },
      };
    })
  );

  const active = enriched.filter(
    (i) => i.isActive && (i.warmupStatus === "warm" || i.warmupStatus === "warming")
  );

  return {
    identities: enriched,
    totalCapacity: active.reduce((sum, i) => sum + i.effectiveDailyLimit, 0),
    usedCapacity: active.reduce((sum, i) => sum + (i.sentToday || 0), 0),
    activeCount: enriched.filter((i) => i.warmupStatus === "warm" && i.isActive).length,
    warmingCount: enriched.filter((i) => i.warmupStatus === "warming").length,
    pausedCount: enriched.filter(
      (i) => i.warmupStatus === "paused" || i.warmupStatus === "disabled"
    ).length,
  };
}

export async function runDailyMaintenance(): Promise<{
  countersReset: number;
  warmup: { transitioned: number; updated: number };
  health: { updated: number; paused: number };
}> {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat, JOB_NAMES } = await import("../job-registry");
  const lease = await acquireJobLock(JOB_NAMES.INBOX_ROTATION);
  if (lease.status !== "acquired") return { countersReset: 0, warmup: { transitioned: 0, updated: 0 }, health: { updated: 0, paused: 0 } };
  const lockToken = lease.lockToken;
  const heartbeat = startJobLockHeartbeat(JOB_NAMES.INBOX_ROTATION, lockToken);

  try {
    const countersReset = await resetDailySendCounts();
    heartbeat.assertOwned();
    const warmup = await runWarmupManager();
    heartbeat.assertOwned();
    const health = await calculateHealthScores();

    console.log(
      `[Inbox Rotation] Daily maintenance: ${countersReset} counters reset, ${warmup.transitioned} warmed up, ${health.paused} paused`
    );

    await releaseJobLock(JOB_NAMES.INBOX_ROTATION, true, undefined, lockToken);
    return { countersReset, warmup, health };
  } catch (err: any) {
    console.error("[Inbox Rotation] Daily maintenance error:", err);
    await releaseJobLock(JOB_NAMES.INBOX_ROTATION, false, err?.message ?? String(err), lockToken);
    return { countersReset: 0, warmup: { transitioned: 0, updated: 0 }, health: { updated: 0, paused: 0 } };
  } finally {
    heartbeat.stop();
  }
}

let dailyMaintenanceInterval: ReturnType<typeof setInterval> | null = null;

export function startDailyMaintenanceScheduler(): void {
  if (dailyMaintenanceInterval) return;

  function msUntilNextMidnightEST(): number {
    const now = new Date();
    const estOffset = -5;
    const utcHour = now.getUTCHours();
    const estHour = (utcHour + estOffset + 24) % 24;
    const hoursUntilMidnight = (24 - estHour) % 24 || 24;
    return hoursUntilMidnight * 60 * 60 * 1000 - now.getUTCMinutes() * 60 * 1000 - now.getUTCSeconds() * 1000;
  }

  function scheduleNext() {
    const ms = msUntilNextMidnightEST();
    console.log(`[Inbox Rotation] Daily maintenance scheduled in ${(ms / 1000 / 60 / 60).toFixed(1)} hours`);
    setTimeout(async () => {
      try {
        await runDailyMaintenance();
      } catch (err) {
        console.error("[Inbox Rotation] Daily maintenance error:", err);
      }
      scheduleNext();
    }, ms);
  }

  scheduleNext();
  console.log("[Inbox Rotation] Daily maintenance scheduler started");
}
