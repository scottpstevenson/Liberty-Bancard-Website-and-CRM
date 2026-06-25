import { db } from "../../db";
import { sdrComplianceState, sdrMerchants, sdrMerchantContacts, sdrChannelAttempts, sdrLeadEvents, contacts, consentAuditLogs } from "@shared/schema";
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

async function hasExpressWrittenConsent(merchantEmail: string | null | undefined, channel: "sms" | "call"): Promise<boolean> {
  if (!merchantEmail) return false;
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, merchantEmail))
    .limit(1);
  if (!contact) return false;
  const logs = await db
    .select({ consentType: consentAuditLogs.consentType })
    .from(consentAuditLogs)
    .where(
      and(
        eq(consentAuditLogs.contactId, contact.id),
        eq(consentAuditLogs.channel, channel),
        eq(consentAuditLogs.consented, true),
      )
    )
    .orderBy(sql`${consentAuditLogs.createdAt} DESC`)
    .limit(10);
  return logs.some((l) => l.consentType === "express_written");
}

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
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant) {
    return { allowed: false, reason: "Merchant not found" };
  }

  if (merchant.doNotContactFlag) {
    return { allowed: false, reason: "Merchant flagged as Do Not Contact" };
  }

  const [compliance] = await db.select().from(sdrComplianceState).where(eq(sdrComplianceState.merchantId, merchantId));

  if (compliance) {
    if (compliance.dncBlock) {
      return { allowed: false, reason: "DNC block active" };
    }
    if (compliance.litigationBlock) {
      return { allowed: false, reason: "Litigation block active" };
    }
    if (compliance.complaintBlock) {
      return { allowed: false, reason: "Complaint block active" };
    }
    if (compliance.quietHoursBlock && purpose === "prospecting") {
      return { allowed: false, reason: "Outreach paused (appointment booked or manual pause)" };
    }

    const coolingExpiry = parseCoolingExpiry(compliance.notes);
    if (coolingExpiry) {
      if (new Date() < coolingExpiry) {
        return { allowed: false, reason: `Cooling period active until ${coolingExpiry.toISOString()}`, details: { coolingUntil: coolingExpiry.toISOString() } };
      } else {
        await db.update(sdrComplianceState).set({
          smsAllowed: true,
          emailAllowed: true,
          callAllowed: true,
          notes: `Cooling period expired at ${coolingExpiry.toISOString()} — channels re-enabled`,
          updatedAt: new Date(),
        }).where(eq(sdrComplianceState.merchantId, merchantId));
      }
    }
  }

  if (channel === "sms") {
    return checkSmsCompliance(merchantId, merchant, compliance);
  } else if (channel === "email") {
    return checkEmailCompliance(merchantId, merchant, compliance);
  } else if (channel === "call") {
    return checkCallCompliance(merchantId, merchant, compliance);
  }

  return { allowed: false, reason: "Unknown channel" };
}

function parseCoolingExpiry(notes: string | null | undefined): Date | null {
  if (!notes) return null;
  const match = notes.match(/Suppressed \d+ days until (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (match) {
    const d = new Date(match[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function checkSmsCompliance(
  merchantId: number,
  merchant: typeof sdrMerchants.$inferSelect,
  compliance: typeof sdrComplianceState.$inferSelect | undefined
): Promise<ComplianceCheckResult> {
  if (compliance?.smsAllowed === false) {
    return { allowed: false, reason: "SMS not allowed — merchant opted out or STOP received" };
  }

  const merchantContacts = await db.select().from(sdrMerchantContacts)
    .where(and(
      eq(sdrMerchantContacts.merchantId, merchantId),
      eq(sdrMerchantContacts.primaryContactFlag, true)
    ));

  const primaryContact = merchantContacts[0];
  if (!primaryContact || !primaryContact.consentSms) {
    return { allowed: false, reason: primaryContact ? "No SMS consent on primary contact record" : "No primary contact with SMS consent found" };
  }

  const merchantState = (merchant.state || "").toUpperCase();
  if (STRICT_STATE_CONSENT_REQUIRED.includes(merchantState)) {
    const hasPewc = await hasExpressWrittenConsent(merchant.mainEmail, "sms");
    if (!hasPewc) {
      return {
        allowed: false,
        reason: `Florida Mini-TCPA (SB 1120): prior express written consent required before automated SMS to ${merchantState} contacts — general opt-in is insufficient`,
        details: { state: merchantState, requiredConsentType: "express_written" },
      };
    }
  }

  const timezone = getTimezoneFromState(merchant.state, merchant.city);
  if (!isWithinQuietHours(timezone)) {
    const nextWindow = getNextBusinessWindow(timezone);
    return {
      allowed: false,
      reason: "Outside quiet hours (TCPA: 9 AM - 5 PM local time, no weekends/holidays)",
      nextValidWindow: nextWindow,
    };
  }

  const dailyCount = await getDailyChannelCount(merchantId, "sms");
  if (dailyCount >= DAILY_SMS_LIMIT) {
    return {
      allowed: false,
      reason: `Daily SMS limit reached (${dailyCount}/${DAILY_SMS_LIMIT})`,
      details: { dailyCount, limit: DAILY_SMS_LIMIT },
    };
  }

  return { allowed: true, reason: "All SMS compliance checks passed" };
}

async function checkEmailCompliance(
  merchantId: number,
  merchant: typeof sdrMerchants.$inferSelect,
  compliance: typeof sdrComplianceState.$inferSelect | undefined
): Promise<ComplianceCheckResult> {
  if (compliance?.emailAllowed === false) {
    return { allowed: false, reason: "Email not allowed — merchant unsubscribed" };
  }

  const bounceEvents = await db.select().from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.merchantId, merchantId),
      eq(sdrLeadEvents.eventType, "email_bounced")
    ));

  if (bounceEvents.length >= 2) {
    return {
      allowed: false,
      reason: `Email blocked — ${bounceEvents.length} bounce(s) recorded`,
      details: { bounceCount: bounceEvents.length },
    };
  }

  const timezone = getTimezoneFromState(merchant.state, merchant.city);
  if (!isWithinQuietHours(timezone)) {
    const nextWindow = getNextBusinessWindow(timezone);
    return {
      allowed: false,
      reason: "Outside quiet hours for email (9 AM - 5 PM local time, no weekends/holidays)",
      nextValidWindow: nextWindow,
    };
  }

  const dailyCount = await getDailyChannelCount(merchantId, "email");
  if (dailyCount >= DAILY_EMAIL_LIMIT) {
    return {
      allowed: false,
      reason: `Daily email limit reached (${dailyCount}/${DAILY_EMAIL_LIMIT})`,
      details: { dailyCount, limit: DAILY_EMAIL_LIMIT },
    };
  }

  return { allowed: true, reason: "All email compliance checks passed" };
}

async function checkCallCompliance(
  merchantId: number,
  merchant: typeof sdrMerchants.$inferSelect,
  compliance: typeof sdrComplianceState.$inferSelect | undefined
): Promise<ComplianceCheckResult> {
  if (compliance?.callAllowed === false) {
    return { allowed: false, reason: "Call not allowed — merchant on DNC list" };
  }

  if (!merchant.mainPhone) {
    return { allowed: false, reason: "No callable phone number on file" };
  }

  const merchantState = (merchant.state || "").toUpperCase();
  if (STRICT_STATE_CONSENT_REQUIRED.includes(merchantState)) {
    const hasPewc = await hasExpressWrittenConsent(merchant.mainEmail, "call");
    if (!hasPewc) {
      return {
        allowed: false,
        reason: `Florida Mini-TCPA (SB 1120): prior express written consent required before automated calls to ${merchantState} contacts — general opt-in is insufficient`,
        details: { state: merchantState, requiredConsentType: "express_written" },
      };
    }
  }

  const timezone = getTimezoneFromState(merchant.state, merchant.city);
  if (!isWithinBusinessHours(timezone)) {
    const nextWindow = getNextBusinessWindow(timezone);
    return {
      allowed: false,
      reason: "Outside business hours (TCPA: 9 AM - 5 PM local time, no weekends/holidays)",
      nextValidWindow: nextWindow,
    };
  }

  const dailyCount = await getDailyChannelCount(merchantId, "call");
  if (dailyCount >= DAILY_CALL_LIMIT) {
    return {
      allowed: false,
      reason: `Daily call limit reached (${dailyCount}/${DAILY_CALL_LIMIT})`,
      details: { dailyCount, limit: DAILY_CALL_LIMIT },
    };
  }

  return { allowed: true, reason: "All call compliance checks passed" };
}

function isWithinQuietHours(timezone: string): boolean {
  return isWithinBusinessHours(timezone);
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
