import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrChannelAttempts, sdrMerchants, sdrComplianceState, type SdrLeadState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { triggerWorkflow, isSdrGhlConfigured } from "./ghl-client";
import { onStageChange } from "./ghl-sync-rules";

export const VOICE_BOT_MODES = [
  "intro_qualification",
  "follow_up_callback",
  "statement_chase",
  "proposal_reminder",
  "appointment_reminder",
  "callback_request",
] as const;

export type VoiceBotMode = typeof VOICE_BOT_MODES[number];

export const CALL_DISPOSITIONS = [
  "interested",
  "not_interested",
  "callback_requested",
  "voicemail_left",
  "no_answer",
  "wrong_number",
  "gatekeeper",
  "do_not_call",
  "booked_meeting",
  "promised_statement",
] as const;

export type CallDisposition = typeof CALL_DISPOSITIONS[number];

const BOT_MODE_WORKFLOW_MAP: Record<VoiceBotMode, string> = {
  intro_qualification: process.env.GHL_WORKFLOW_INTRO_QUAL || "voice_intro_qualification",
  follow_up_callback: process.env.GHL_WORKFLOW_FOLLOW_UP || "voice_follow_up_callback",
  statement_chase: process.env.GHL_WORKFLOW_STATEMENT || "voice_statement_chase",
  proposal_reminder: process.env.GHL_WORKFLOW_PROPOSAL || "voice_proposal_reminder",
  appointment_reminder: process.env.GHL_WORKFLOW_APPT || "voice_appointment_reminder",
  callback_request: process.env.GHL_WORKFLOW_CALLBACK || "voice_callback_request",
};

const BUSINESS_HOURS = { start: 9, end: 17 };

function getFederalHolidays(year: number): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;

  const nthWeekday = (month: number, weekday: number, n: number): number => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    let day = 1 + ((weekday - firstDay + 7) % 7) + (n - 1) * 7;
    return day;
  };

  const lastMonday = (month: number): number => {
    const lastDay = new Date(year, month, 0).getDate();
    const lastDow = new Date(year, month - 1, lastDay).getDay();
    return lastDay - ((lastDow - 1 + 7) % 7);
  };

  return [
    fmt(1, 1),
    fmt(1, nthWeekday(1, 1, 3)),
    fmt(2, nthWeekday(2, 1, 3)),
    fmt(5, lastMonday(5)),
    fmt(6, 19),
    fmt(7, 4),
    fmt(9, nthWeekday(9, 1, 1)),
    fmt(10, nthWeekday(10, 1, 2)),
    fmt(11, 11),
    fmt(11, nthWeekday(11, 4, 4)),
    fmt(12, 25),
  ];
}

function isFederalHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4), 10);
  if (isNaN(year)) return false;
  return getFederalHolidays(year).includes(dateStr);
}

const CITY_TZ_OVERRIDES: Record<string, Record<string, string>> = {
  "FL": { "pensacola": "America/Chicago", "panama city": "America/Chicago" },
  "IN": { "evansville": "America/Chicago", "gary": "America/Chicago", "terre haute": "America/Indiana/Tell_City" },
  "KY": { "bowling green": "America/Chicago", "owensboro": "America/Chicago", "paducah": "America/Chicago" },
  "MI": { "iron mountain": "America/Menominee", "ironwood": "America/Menominee" },
  "ND": { "dickinson": "America/Denver", "williston": "America/Denver" },
  "NE": { "scottsbluff": "America/Denver", "valentine": "America/Denver" },
  "OR": { "ontario": "America/Boise", "burns": "America/Boise" },
  "SD": { "rapid city": "America/Denver", "pierre": "America/Chicago" },
  "TN": { "chattanooga": "America/New_York", "knoxville": "America/New_York" },
  "TX": { "el paso": "America/Denver", "hudspeth": "America/Denver" },
};

export function getTimezoneFromState(state: string | null | undefined, city?: string | null): string {
  const tzMap: Record<string, string> = {
    "AL": "America/Chicago", "AK": "America/Anchorage", "AZ": "America/Phoenix",
    "AR": "America/Chicago", "CA": "America/Los_Angeles", "CO": "America/Denver",
    "CT": "America/New_York", "DE": "America/New_York", "FL": "America/New_York",
    "GA": "America/New_York", "HI": "Pacific/Honolulu", "ID": "America/Boise",
    "IL": "America/Chicago", "IN": "America/Indiana/Indianapolis", "IA": "America/Chicago",
    "KS": "America/Chicago", "KY": "America/New_York", "LA": "America/Chicago",
    "ME": "America/New_York", "MD": "America/New_York", "MA": "America/New_York",
    "MI": "America/Detroit", "MN": "America/Chicago", "MS": "America/Chicago",
    "MO": "America/Chicago", "MT": "America/Denver", "NE": "America/Chicago",
    "NV": "America/Los_Angeles", "NH": "America/New_York", "NJ": "America/New_York",
    "NM": "America/Denver", "NY": "America/New_York", "NC": "America/New_York",
    "ND": "America/Chicago", "OH": "America/New_York", "OK": "America/Chicago",
    "OR": "America/Los_Angeles", "PA": "America/New_York", "RI": "America/New_York",
    "SC": "America/New_York", "SD": "America/Chicago", "TN": "America/Chicago",
    "TX": "America/Chicago", "UT": "America/Denver", "VT": "America/New_York",
    "VA": "America/New_York", "WA": "America/Los_Angeles", "WV": "America/New_York",
    "WI": "America/Chicago", "WY": "America/Denver", "DC": "America/New_York",
  };
  if (!state) return "America/New_York";
  const stateUpper = state.toUpperCase();

  if (city && CITY_TZ_OVERRIDES[stateUpper]) {
    const cityLower = city.toLowerCase().trim();
    const cityTz = CITY_TZ_OVERRIDES[stateUpper][cityLower];
    if (cityTz) return cityTz;
  }

  return tzMap[stateUpper] || "America/New_York";
}

export function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
    const weekday = parts.find(p => p.type === "weekday")?.value || "";

    if (["Sat", "Sun"].includes(weekday)) return false;

    const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    const dateStr = dateFormatter.format(now);
    if (isFederalHoliday(dateStr)) return false;

    return hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
  } catch (err) {
    console.error(`[Voice Orchestrator] Business hours check failed for timezone ${timezone}, failing closed:`, err);
    return false;
  }
}

export function getNextBusinessWindow(timezone: string): Date {
  const now = new Date();
  const oneHour = 3600_000;

  for (let i = 1; i <= 168; i++) {
    const candidate = new Date(now.getTime() + i * oneHour);
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      });
      const parts = formatter.formatToParts(candidate);
      const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
      const weekday = parts.find(p => p.type === "weekday")?.value || "";

      if (["Sat", "Sun"].includes(weekday)) continue;

      const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
      const dateStr = dateFormatter.format(candidate);
      if (isFederalHoliday(dateStr)) continue;

      if (hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(BUSINESS_HOURS.start, 0, 0, 0);
  return tomorrow;
}

export function getNextBusinessDay(timezone: string): Date {
  const now = new Date();
  for (let dayOffset = 1; dayOffset <= 10; dayOffset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(BUSINESS_HOURS.start, 0, 0, 0);

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
      });
      const weekday = formatter.formatToParts(candidate).find(p => p.type === "weekday")?.value || "";
      if (["Sat", "Sun"].includes(weekday)) continue;

      const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
      const dateStr = dateFormatter.format(candidate);
      if (isFederalHoliday(dateStr)) continue;

      return candidate;
    } catch {
      continue;
    }
  }

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(BUSINESS_HOURS.start, 0, 0, 0);
  return fallback;
}

export interface TriggerCallResult {
  success: boolean;
  scheduled: boolean;
  scheduledAt?: Date;
  reason?: string;
  callId?: string;
}

export async function triggerAiCall(
  merchantId: number,
  botMode: VoiceBotMode
): Promise<TriggerCallResult> {
  const { featureFlags } = await import("../feature-flags");
  if (!featureFlags.VOICE_AI_ENABLED) {
    return { success: false, scheduled: false, reason: "VOICE_AI_ENABLED=false — voice AI is disabled" };
  }

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant) {
    return { success: false, scheduled: false, reason: "Merchant not found" };
  }

  if (!merchant.ghlContactId) {
    return { success: false, scheduled: false, reason: "No GHL contact ID for merchant" };
  }

  if (!merchant.mainPhone) {
    return { success: false, scheduled: false, reason: "No phone number on file" };
  }

  const { checkAndLogCompliance } = await import("./compliance-engine");
  const complianceResult = await checkAndLogCompliance(merchantId, "call");
  if (!complianceResult.allowed) {
    if (complianceResult.nextValidWindow) {
      await db.update(sdrLeadState).set({
        nextAction: `ai_call_${botMode}`,
        nextActionType: "call",
        nextActionAt: complianceResult.nextValidWindow,
        nextActionPayload: { botMode, merchantId },
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));

      return { success: true, scheduled: true, scheduledAt: complianceResult.nextValidWindow, reason: complianceResult.reason };
    }
    return { success: false, scheduled: false, reason: complianceResult.reason };
  }

  const timezone = getTimezoneFromState(merchant.state, merchant.city);
  if (!isWithinBusinessHours(timezone)) {
    const nextWindow = getNextBusinessWindow(timezone);
    await db.update(sdrLeadState).set({
      nextAction: `ai_call_${botMode}`,
      nextActionType: "call",
      nextActionAt: nextWindow,
      nextActionPayload: { botMode, merchantId },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchantId));

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "call_scheduled",
      channel: "call",
      actorType: "system",
      payloadJson: { botMode, scheduledAt: nextWindow.toISOString(), reason: "Outside business hours" },
      decisionReason: `Call to merchant ${merchantId} scheduled for ${nextWindow.toISOString()} (outside business hours in ${timezone})`,
    });

    return { success: true, scheduled: true, scheduledAt: nextWindow, reason: "Scheduled for next business window" };
  }

  if (!isSdrGhlConfigured()) {
    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "call_skipped",
      channel: "call",
      actorType: "system",
      payloadJson: { botMode, reason: "GHL not configured" },
      decisionReason: "GHL integration not configured — call not placed",
    });
    return { success: false, scheduled: false, reason: "GHL not configured" };
  }

  try {
    const workflowId = BOT_MODE_WORKFLOW_MAP[botMode];
    const result = await triggerWorkflow({
      workflowId,
      contactId: merchant.ghlContactId,
    });

    await db.insert(sdrChannelAttempts).values({
      merchantId,
      channel: "call",
      attemptNo: 1,
      templateId: botMode,
      sentAt: new Date(),
      outcome: "initiated",
    });

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "call_initiated",
      channel: "call",
      actorType: "system",
      payloadJson: { botMode, workflowId, ghlResult: result },
      decisionReason: `Voice AI call initiated: mode=${botMode}`,
    });

    if (botMode !== "appointment_reminder") {
      await db.update(sdrLeadState).set({
        lastCallAt: new Date(),
        lastTouchAt: new Date(),
        nextAction: "check_call_outcome",
        nextActionType: "call_followup",
        nextActionAt: new Date(Date.now() + 30 * 60_000),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
    }

    return { success: true, scheduled: false };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Voice Orchestrator] Failed to trigger call for merchant ${merchantId}:`, errMsg);

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "call_failed",
      channel: "call",
      actorType: "system",
      payloadJson: { botMode, error: errMsg },
      decisionReason: `Call trigger failed: ${errMsg}`,
    });

    return { success: false, scheduled: false, reason: errMsg };
  }
}

export interface DispositionAction {
  newStage?: string;
  scheduleFollowUp?: string;
  followUpDelayMinutes?: number;
  sendBookingLink?: boolean;
  suppressContact?: boolean;
  retryNextBusinessDay?: boolean;
}

export function mapDispositionToAction(disposition: CallDisposition): DispositionAction {
  switch (disposition) {
    case "booked_meeting":
      return { newStage: "MEETING_SET" };
    case "interested":
      return { sendBookingLink: true, newStage: "ENGAGED" };
    case "promised_statement":
      return { newStage: "STATEMENT_REQUESTED" };
    case "callback_requested":
      return { scheduleFollowUp: "callback", followUpDelayMinutes: 60 };
    case "voicemail_left":
      return { scheduleFollowUp: "sms_followup", followUpDelayMinutes: 5 };
    case "no_answer":
      return { retryNextBusinessDay: true };
    case "wrong_number":
      return { suppressContact: true };
    case "do_not_call":
      return { suppressContact: true };
    case "not_interested":
      return { newStage: "NURTURE" };
    case "gatekeeper":
      return { scheduleFollowUp: "callback_different_time", followUpDelayMinutes: 120 };
    default:
      return {};
  }
}

export async function handleCallDisposition(
  merchantId: number,
  disposition: CallDisposition,
  callMetadata?: Record<string, unknown>
): Promise<void> {
  const action = mapDispositionToAction(disposition);

  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType: "call_disposition",
    channel: "call",
    actorType: "system",
    payloadJson: { disposition, action, ...callMetadata },
    decisionReason: `Call disposition: ${disposition} → ${JSON.stringify(action)}`,
  });

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));

  if (action.suppressContact) {
    const [existing] = await db.select().from(sdrComplianceState).where(eq(sdrComplianceState.merchantId, merchantId));
    if (existing) {
      await db.update(sdrComplianceState).set({
        callAllowed: false,
        dncBlock: disposition === "do_not_call",
        notes: `${disposition} recorded at ${new Date().toISOString()}`,
        updatedAt: new Date(),
      }).where(eq(sdrComplianceState.merchantId, merchantId));
    } else {
      await db.insert(sdrComplianceState).values({
        merchantId,
        callAllowed: false,
        dncBlock: disposition === "do_not_call",
        notes: `${disposition} recorded at ${new Date().toISOString()}`,
      });
    }

    if (disposition === "do_not_call") {
      await db.update(sdrMerchants).set({
        doNotContactFlag: true,
        updatedAt: new Date(),
      }).where(eq(sdrMerchants.id, merchantId));
    }
  }

  if (action.newStage && state) {
    const oldStage = state.currentStage;
    if (oldStage !== action.newStage) {
      await db.update(sdrLeadState).set({
        currentStage: action.newStage,
        lastCallAt: new Date(),
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
      await onStageChange(merchantId, action.newStage, oldStage);
    }
  }

  if (action.scheduleFollowUp && state) {
    const followUpAt = new Date(Date.now() + (action.followUpDelayMinutes || 60) * 60_000);
    await db.update(sdrLeadState).set({
      nextAction: action.scheduleFollowUp,
      nextActionType: action.scheduleFollowUp === "sms_followup" ? "sms" : "call",
      nextActionAt: followUpAt,
      nextActionPayload: { disposition, followUpType: action.scheduleFollowUp },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchantId));
  }

  if (action.retryNextBusinessDay && state) {
    const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
    const timezone = getTimezoneFromState(merchant?.state, merchant?.city);
    const nextDay = getNextBusinessDay(timezone);

    await db.update(sdrLeadState).set({
      nextAction: "retry_call",
      nextActionType: "call",
      nextActionAt: nextDay,
      nextActionPayload: { disposition, retryReason: "no_answer" },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchantId));
  }

  if (action.sendBookingLink && state) {
    try {
      const { sendBookingLink } = await import("./scheduling");
      const result = await sendBookingLink(merchantId, "sms");
      console.log(`[Voice Orchestrator] Booking link for merchant ${merchantId}: ${result.sent ? "sent" : result.reason}`);
    } catch (err: unknown) {
      console.error(`[Voice Orchestrator] Failed to send booking link for merchant ${merchantId}:`, err);
      await db.update(sdrLeadState).set({
        nextAction: "send_booking_link",
        nextActionType: "booking",
        nextActionAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
    }
  }


  console.log(`[Voice Orchestrator] Disposition processed: merchant=${merchantId}, disposition=${disposition}`);
}

export interface VoiceScript {
  verticalKey: string;
  verticalLabel: string;
  opening: string;
  qualifyingQuestions: string[];
  valuePitch: string;
  close: string;
  objectionHandlers: Record<string, string>;
  complianceDisclosure: string;
  gatekeeperScript?: string;
  meetingOffer: string;
}

const FL_AUTO_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_auto",
  verticalLabel: "Florida Auto Repair",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We work with Florida repair shops on card processing costs, especially on bigger repair tickets. Who handles your merchant services?",
  qualifyingQuestions: [
    "Who is your current processor?",
    "What's your approximate monthly card volume?",
    "What's your biggest frustration with your current setup?",
    "Are you currently using text-to-pay or financing for larger tickets?",
  ],
  valuePitch: "We specialize in helping Florida auto shops lower their effective processing cost, set up text-to-pay for customer convenience, and reduce chargebacks on big-ticket repairs. Most shops we work with save between $200 and $500 a month.",
  close: "We do a free 10-minute statement review that usually finds $200-500/month in savings. Can I send you a link to upload your latest statement?",
  objectionHandlers: {
    "happy_with_current": "Totally fair — most shops we work with thought the same thing until they saw a line-by-line breakdown. Even if you don't switch, you'll know exactly what you're paying and whether it's competitive.",
    "too_busy": "I completely understand. The review takes less than 10 minutes and we do all the work. I can send a secure upload link and have results back to you within 24 hours.",
    "under_contract": "No problem. Most contracts have already rolled to month-to-month without the owner knowing. We can check that for you too — takes 2 minutes.",
    "rates_are_fine": "That's great to hear. But rates are only part of the picture — most overpayment we find is in junk fees and downgrades, not the advertised rate. The review covers all of that.",
    "not_the_decision_maker": "No worries — who would be the best person to speak with about this? I can call back at a time that works for them.",
    "send_info_by_email": "Absolutely. What's the best email address? I'll send over a quick summary and a link for the free statement review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company. This is a business solicitation call. Florida surcharging applies to credit only, requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules.",
  meetingOffer: "Merchant statement review — a free 10-minute review of your latest processing statement to find hidden fees and savings opportunities.",
};

const FL_MEDSPA_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_medspa",
  verticalLabel: "Florida Med Spa",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We work with Florida med spas on membership billing, deposits, and payment experience. Is the owner or practice manager available?",
  qualifyingQuestions: [
    "Are you currently offering memberships or treatment packages?",
    "What's your current card-on-file process for appointments?",
    "Are you dealing with no-show issues?",
    "Who is your current processor and how long have you been with them?",
  ],
  valuePitch: "We help med spas build a payment workflow that supports recurring memberships, protects against no-shows with card-on-file and deposit policies, and offers patient financing for higher-ticket procedures like body contouring and injectable packages. It's not about commodity processing — it's about your revenue workflow.",
  close: "We do a complimentary payment workflow review that usually uncovers $300-800/month in savings or revenue opportunities. Can I send you the details?",
  objectionHandlers: {
    "happy_with_current": "That's great. Our review isn't about switching processors — it's about your entire payment workflow. Memberships, deposits, financing, checkout experience. Most practices find at least one area to improve.",
    "too_busy": "Totally understand — practice owners are always busy. The review is 10 minutes and we can do it over a quick call or even email. I'll send a link and you can book whenever works.",
    "not_interested": "No problem at all. Can I ask — are you currently offering memberships? Most med spas we talk to find that's where the biggest revenue opportunity is, and the payment side is often the bottleneck.",
    "already_have_memberships": "Perfect — then this review is especially relevant. We'd look at your churn rate, failed payment handling, and whether card updater is set up properly. Those three things alone usually recover thousands per year.",
    "not_the_decision_maker": "Understood — is the owner or practice manager available? Or can I leave a message with the best time to reach them?",
    "send_info_by_email": "Happy to. What's the best email for the owner or practice manager? I'll send a quick summary of what we cover in the review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company specializing in aesthetic and medical practices. This is a business solicitation call.",
  meetingOffer: "Membership/recurring billing review — a complimentary review of your payment workflow including memberships, deposits, card-on-file, and patient financing.",
};

const FL_MEDICAL_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_medical",
  verticalLabel: "Florida Medical (Dental, Chiro, PT, Urgent Care)",
  gatekeeperScript: "We help Florida medical practices improve patient payment flow — things like text-to-pay, payment plans, and front-desk collections. Who handles payment systems or merchant services there?",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We help Florida medical practices improve patient payment flow — text-to-pay, payment plans, and front-desk collections. Who handles payment systems there?",
  qualifyingQuestions: [
    "What does your current patient payment collection process look like?",
    "Are you offering payment plans for larger balances?",
    "Do you currently use text-to-pay for patient balances?",
    "What's the biggest frustration for your front desk around payments?",
  ],
  valuePitch: "We help medical practices collect patient payments faster with text-to-pay, structured payment plans, and card-on-file — all without adding front-desk complexity. Our practices typically see a significant reduction in outstanding balances and manual collection work.",
  close: "We do a free patient collections review that usually finds ways to speed up payments and reduce manual work. Can I send you the details?",
  objectionHandlers: {
    "hipaa_concern": "Great question. We don't access any patient health information — we only handle the payment side. Our systems are PCI-compliant and we never touch PHI. We're not a business associate under HIPAA for payment processing.",
    "too_busy": "I hear that from every practice — that's exactly why we focus on reducing front-desk workload. The review itself is 10 minutes and we do it by phone or email.",
    "have_a_billing_company": "That's common. We work alongside billing companies — they handle insurance, we handle the patient-pay side. Text-to-pay and payment plans are usually gaps that billing companies don't cover.",
    "happy_with_current": "That's fine. Can I ask — does your current processor offer text-to-pay for patient balances? That's usually the biggest gap we find, and it has nothing to do with rates.",
    "not_the_decision_maker": "Understood. We help with patient payment flow — text-to-pay, payment plans, and front-desk collections. Who handles payment systems or merchant services there?",
    "send_info_by_email": "Absolutely. What's the best email for whoever handles payment systems? I'll send a quick summary of the review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company specializing in medical practices. This is a business solicitation call. We do not access or store protected health information.",
  meetingOffer: "Patient collections review — a free review of your patient payment workflow including text-to-pay, payment plans, card-on-file, and front-desk efficiency.",
};

const VOICE_SCRIPTS: Record<string, VoiceScript> = {
  fl_auto: FL_AUTO_VOICE_SCRIPT,
  fl_medspa: FL_MEDSPA_VOICE_SCRIPT,
  fl_medical: FL_MEDICAL_VOICE_SCRIPT,
};

export function getVoiceScript(verticalKey: string): VoiceScript | null {
  return VOICE_SCRIPTS[verticalKey] || null;
}

export function getAllVoiceScripts(): VoiceScript[] {
  return Object.values(VOICE_SCRIPTS);
}

export function resolveVoiceScriptForLead(lead: SdrLeadState): VoiceScript | null {
  const vertical = (lead.vertical || "").toLowerCase();
  const state = (lead.state || "").toLowerCase();
  const isFlorida = state === "fl" || state === "florida";

  if (!isFlorida) return null;

  if (/auto|automotive|car|vehicle|mechanic|tire|collision|body shop|transmission|brake|repair/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_auto;
  }

  const hasMedSpaTerms = /med.?spa|medspa|aesthetic|beauty|salon/i.test(vertical);
  const hasClinicalTerms = /dental|dentist|chiro|optom|podiatr|dermat|urgent care|physical therapy|behavioral|healthcare|clinic/i.test(vertical);
  const hasMedicalPrimary = /^medical(?!.*spa)/i.test(vertical) || hasClinicalTerms;

  if (hasMedSpaTerms && !hasMedicalPrimary) {
    return VOICE_SCRIPTS.fl_medspa;
  }

  if (hasMedicalPrimary || /^medical/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_medical;
  }

  if (hasMedSpaTerms || /spa\b/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_medspa;
  }

  return null;
}

export function personalizeVoiceScript(script: VoiceScript, lead: SdrLeadState, agentName: string = "a team member"): VoiceScript {
  const firstName = lead.ownerName?.split(" ")[0] || "there";
  const companyName = lead.companyName || "your business";

  function replaceVars(text: string): string {
    return text
      .replace(/\{\{agentName\}\}/g, agentName)
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{companyName\}\}/g, companyName)
      .replace(/\{\{shopName\}\}/g, companyName)
      .replace(/\{\{spaName\}\}/g, companyName)
      .replace(/\{\{practiceName\}\}/g, companyName);
  }

  return {
    ...script,
    opening: replaceVars(script.opening),
    valuePitch: replaceVars(script.valuePitch),
    close: replaceVars(script.close),
    complianceDisclosure: replaceVars(script.complianceDisclosure),
    gatekeeperScript: script.gatekeeperScript ? replaceVars(script.gatekeeperScript) : undefined,
    qualifyingQuestions: script.qualifyingQuestions.map(replaceVars),
    objectionHandlers: Object.fromEntries(
      Object.entries(script.objectionHandlers).map(([k, v]) => [k, replaceVars(v)])
    ),
  };
}

export function buildGhlVoicePayload(script: VoiceScript, lead: SdrLeadState, agentName: string = "a team member"): Record<string, any> {
  const personalized = personalizeVoiceScript(script, lead, agentName);

  return {
    type: "outbound_call",
    vertical: personalized.verticalKey,
    script: {
      greeting: personalized.complianceDisclosure,
      opening: personalized.opening,
      gatekeeperScript: personalized.gatekeeperScript || null,
      qualifyingQuestions: personalized.qualifyingQuestions,
      valuePitch: personalized.valuePitch,
      close: personalized.close,
      objectionHandlers: personalized.objectionHandlers,
      meetingOffer: personalized.meetingOffer,
    },
    lead: {
      name: lead.ownerName || lead.companyName,
      company: lead.companyName,
      phone: lead.ownerPhone || lead.phone,
      vertical: lead.vertical,
      state: lead.state,
      city: lead.city,
    },
  };
}
