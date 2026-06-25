import { db } from "../../db";
import { sdrComplianceState, sdrMerchants, sdrChannelAttempts, sdrLeadEvents, contacts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { isWithinBusinessHours, getNextBusinessWindow, getTimezoneFromState } from "./voice-orchestrator";

export { getTimezoneFromState } from "./voice-orchestrator";

const DAILY_SMS_LIMIT = parseInt(process.env.SDR_DAILY_SMS_LIMIT || "50", 10);
const DAILY_EMAIL_LIMIT = parseInt(process.env.SDR_DAILY_EMAIL_LIMIT || "200", 10);
const DAILY_CALL_LIMIT = parseInt(process.env.SDR_DAILY_CALL_LIMIT || "30", 10);

const STRICT_STATE_CONSENT_REQUIRED = (process.env.STRICT_STATE_CONSENT_REQUIRED || "FL")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);


const QUIET_HOURS = { start: 9, end: 17 };

function getFederalHolidays(year: number): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;
  const nthWeekday = (month: number, weekday: number, n: number): number => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    return 1 + ((weekday - firstDay + 7) % 7) + (n - 1) * 7;
  };
  const lastMonday = (month: number): number => {
    const lastDay = new Date(year, month, 0).getDate();
    const lastDow = new Date(year, month - 1, lastDay).getDay();
    return lastDay - ((lastDow - 1 + 7) % 7);
  };
  return [
    fmt(1, 1), fmt(1, nthWeekday(1, 1, 3)), fmt(2, nthWeekday(2, 1, 3)),
    fmt(5, lastMonday(5)), fmt(6, 19), fmt(7, 4),
    fmt(9, nthWeekday(9, 1, 1)), fmt(10, nthWeekday(10, 1, 2)),
    fmt(11, 11), fmt(11, nthWeekday(11, 4, 4)), fmt(12, 25),
  ];
}

function isFederalHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4), 10);
  if (isNaN(year)) return false;
  return getFederalHolidays(year).includes(dateStr);
}

export interface ComplianceCheckResult {
  allowed: boolean;
  reason: string;
  details?: Record<string, unknown>;
  nextValidWindow?: Date;
}

export async function upsertOutreachPause(merchantId: number, paused: boolean, reason: string): Promise<void> {
  const pauseNote = paused
    ? `OUTREACH_PAUSED: ${reason} at ${new Date().toISOString()}`
    : `OUTREACH_RESUMED: ${reason} at ${new Date().toISOString()}`;

  const [existing] = await db.select().from(sdrComplianceState).where(eq(sdrComplianceState.merchantId, merchantId));
  if (existing) {
    await db.update(sdrComplianceState).set({
      quietHoursBlock: paused,
      notes: pauseNote,
      updatedAt: new Date(),
    }).where(eq(sdrComplianceState.merchantId, merchantId));
  } else {
    await db.insert(sdrComplianceState).values({
      merchantId,
      quietHoursBlock: paused,
      notes: pauseNote,
    });
  }

  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType: paused ? "outreach_paused" : "outreach_resumed",
    channel: "system",
    actorType: "system",
    payloadJson: { paused, reason },
    complianceResult: pauseNote,
    decisionReason: reason,
  });
}

export type SendPurpose = "prospecting" | "transactional" | "reminder";

export async function checkBeforeSend(
  merchantId: number,
  channel: "sms" | "email" | "call",
  purpose: SendPurpose = "prospecting"
): Promise<ComplianceCheckResult> {
  const [merchant] = await db
    .select({
      id: sdrMerchants.id,
      doNotContactFlag: sdrMerchants.doNotContactFlag,
      mainEmail: sdrMerchants.mainEmail,
      mainPhone: sdrMerchants.mainPhone,
      state: sdrMerchants.state,
      city: sdrMerchants.city,
    })
    .from(sdrMerchants)
    .where(eq(sdrMerchants.id, merchantId));
  if (!merchant) {
    return { allowed: false, reason: "Merchant not found" };
  }

  if (merchant.doNotContactFlag) {
    return { allowed: false, reason: "Merchant flagged as Do Not Contact" };
  }

  // ── SDR compliance state (merchant-level suppression) ─────────────────
  // These suppression flags live on the SDR merchant record and are independent
  // of the contact-level consent/tier gate that follows. Both layers must pass.
  const [compliance] = await db
    .select()
    .from(sdrComplianceState)
    .where(eq(sdrComplianceState.merchantId, merchantId));

  if (compliance) {
    if (compliance.dncBlock) {
      return { allowed: false, reason: "DNC block active (SDR compliance state)" };
    }
    if (compliance.litigationBlock) {
      return { allowed: false, reason: "Litigation block active (SDR compliance state)" };
    }
    if (compliance.complaintBlock) {
      return { allowed: false, reason: "Complaint block active (SDR compliance state)" };
    }
    if (compliance.quietHoursBlock && purpose === "prospecting") {
      return { allowed: false, reason: "Outreach paused (appointment booked or manual pause)" };
    }

    // Inline cooling-period check (notes field may encode expiry)
    if (compliance.notes) {
      const coolingMatch = compliance.notes.match(
        /Suppressed \d+ days until (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/
      );
      if (coolingMatch) {
        const coolingExpiry = new Date(coolingMatch[1]);
        if (!isNaN(coolingExpiry.getTime()) && new Date() < coolingExpiry) {
          return {
            allowed: false,
            reason: `Cooling period active until ${coolingExpiry.toISOString()}`,
            details: { coolingUntil: coolingExpiry.toISOString() },
          };
        } else {
          // Cooling expired — re-enable channels
          await db
            .update(sdrComplianceState)
            .set({
              smsAllowed: true,
              emailAllowed: true,
              callAllowed: true,
              notes: `Cooling period expired at ${coolingExpiry.toISOString()} — channels re-enabled`,
              updatedAt: new Date(),
            })
            .where(eq(sdrComplianceState.merchantId, merchantId));
        }
      }
    }
  }

  // ── Shared contactability gate — sole decision authority ──────────────
  // ALL automated channels (email, SMS, voice) require a linked contacts record.
  // evaluateContactability() is the single source of truth.
  // If no contacts record can be found, or the bridge lookup fails, we FAIL CLOSED.
  // There is no legacy fallback — the gate is canonical for every channel.

  const contactabilityChannelMap: Record<"sms" | "email" | "call", import("../contactability").ContactabilityChannel> = {
    sms: "sms",
    email: "email",
    call: "voice_ai",
  };
  const contactabilityChannel = contactabilityChannelMap[channel];

  if (!merchant.mainEmail) {
    console.warn(
      `[SDR Compliance] Merchant ${merchantId} has no mainEmail — contactability bridge unavailable. Blocking ${channel}.`
    );
    return {
      allowed: false,
      reason: `Automated ${channel} blocked — merchant ${merchantId} has no email on file; ` +
        `cannot verify consent via contactability bridge. Add an email and link a contact record.`,
    };
  }

  try {
    const [linkedContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, merchant.mainEmail))
      .limit(1);

    if (!linkedContact) {
      // Fail closed — no contacts record means we cannot verify consent for any channel
      console.warn(
        `[SDR Compliance] No contacts record found for merchant ${merchantId} (email: ${merchant.mainEmail}). ` +
        `Blocking all automated channels (${channel}) — create a contact record first.`
      );
      return {
        allowed: false,
        reason: `Automated ${channel} blocked — no contacts record found for merchant ${merchantId}. ` +
          `All automated outreach requires a linked contact record; create one first.`,
      };
    }

    const { evaluateContactability } = await import("../contactability");
    const evalResult = await evaluateContactability({
      contactId: linkedContact.id,
      channel: contactabilityChannel,
      campaignType: purpose,
      state: merchant.state ?? undefined,
      mode: "enforcement",
      sdrMerchantId: merchantId,
    });

    if (!evalResult.allowed) {
      return { allowed: false, reason: evalResult.reason };
    }

    if (evalResult.rateLimitStatus === "limit_reached") {
      return { allowed: false, reason: `Daily ${channel} limit reached` };
    }

    return { allowed: true, reason: "All compliance checks passed (shared gate)" };

  } catch (err) {
    // Bridge lookup error — fail CLOSED for all channels
    console.warn("[SDR Compliance] Contactability bridge lookup failed:", err);
    return {
      allowed: false,
      reason: `Automated ${channel} blocked — contactability bridge error for merchant ${merchantId}. ` +
        `Cannot proceed without verified consent check.`,
    };
  }
}


export async function getDailyChannelCountForMerchant(merchantId: number, channel: string): Promise<number> {
  return getDailyChannelCount(merchantId, channel);
}

async function getDailyChannelCount(merchantId: number, channel: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const conditions = [
    eq(sdrChannelAttempts.channel, channel),
    gte(sdrChannelAttempts.createdAt, todayStart),
  ];
  if (merchantId > 0) {
    conditions.push(eq(sdrChannelAttempts.merchantId, merchantId));
  }

  const result = await db.select({
    count: sql<number>`count(*)`,
  }).from(sdrChannelAttempts).where(and(...conditions));

  return Number(result[0]?.count || 0);
}

async function getGlobalDailyChannelCount(channel: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await db.select({
    count: sql<number>`count(*)`,
  }).from(sdrChannelAttempts).where(and(
    eq(sdrChannelAttempts.channel, channel),
    gte(sdrChannelAttempts.createdAt, todayStart)
  ));

  return Number(result[0]?.count || 0);
}

export interface BlockedSendRecord {
  merchantId: number;
  merchantName: string;
  channel: string;
  reason: string;
  blockedAt: Date;
  nextValidWindow?: Date;
}

export async function getBlockedSends(limit = 100): Promise<BlockedSendRecord[]> {
  const events = await db.select({
    id: sdrLeadEvents.id,
    merchantId: sdrLeadEvents.merchantId,
    channel: sdrLeadEvents.channel,
    payloadJson: sdrLeadEvents.payloadJson,
    createdAt: sdrLeadEvents.createdAt,
  }).from(sdrLeadEvents)
    .where(eq(sdrLeadEvents.eventType, "compliance_blocked"))
    .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
    .limit(limit);

  const results: BlockedSendRecord[] = [];
  for (const event of events) {
    const payload = event.payloadJson as Record<string, unknown> | null;
    let merchantName = "Unknown";
    if (event.merchantId) {
      const [m] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, event.merchantId));
      if (m) merchantName = m.businessName;
    }
    results.push({
      merchantId: event.merchantId || 0,
      merchantName,
      channel: event.channel || "unknown",
      reason: (payload?.reason as string) || "Unknown reason",
      blockedAt: event.createdAt || new Date(),
      nextValidWindow: payload?.nextValidWindow ? new Date(payload.nextValidWindow as string) : undefined,
    });
  }

  return results;
}

export async function checkAndLogCompliance(
  merchantId: number,
  channel: "sms" | "email" | "call",
  purpose: SendPurpose = "prospecting"
): Promise<ComplianceCheckResult> {
  const result = await checkBeforeSend(merchantId, channel, purpose);

  if (!result.allowed) {
    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "compliance_blocked",
      channel,
      actorType: "system",
      payloadJson: {
        reason: result.reason,
        details: result.details,
        nextValidWindow: result.nextValidWindow?.toISOString(),
      },
      complianceResult: result.reason,
      decisionReason: `Compliance blocked: ${result.reason}`,
    });
  }

  return result;
}

export interface ComplianceDashboardData {
  totalBlockedToday: number;
  blockedByReason: Record<string, number>;
  blockedByChannel: Record<string, number>;
  recentBlocked: BlockedSendRecord[];
  dailyLimits: {
    sms: { used: number; limit: number };
    email: { used: number; limit: number };
    call: { used: number; limit: number };
  };
}

export async function getComplianceDashboard(): Promise<ComplianceDashboardData> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const blockedEvents = await db.select({
    channel: sdrLeadEvents.channel,
    payloadJson: sdrLeadEvents.payloadJson,
  }).from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.eventType, "compliance_blocked"),
      gte(sdrLeadEvents.createdAt, todayStart)
    ));

  const blockedByReason: Record<string, number> = {};
  const blockedByChannel: Record<string, number> = {};
  for (const event of blockedEvents) {
    const payload = event.payloadJson as Record<string, unknown> | null;
    const reason = (payload?.reason as string) || "Unknown";
    const ch = event.channel || "unknown";
    blockedByReason[reason] = (blockedByReason[reason] || 0) + 1;
    blockedByChannel[ch] = (blockedByChannel[ch] || 0) + 1;
  }

  const recentBlocked = await getBlockedSends(20);

  const smsUsed = await getGlobalDailyChannelCount("sms");
  const emailUsed = await getGlobalDailyChannelCount("email");
  const callUsed = await getGlobalDailyChannelCount("call");

  return {
    totalBlockedToday: blockedEvents.length,
    blockedByReason,
    blockedByChannel,
    recentBlocked,
    dailyLimits: {
      sms: { used: smsUsed, limit: DAILY_SMS_LIMIT },
      email: { used: emailUsed, limit: DAILY_EMAIL_LIMIT },
      call: { used: callUsed, limit: DAILY_CALL_LIMIT },
    },
  };
}
