import { storage } from "../../storage";
import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrChannelAttempts, sdrMerchants, contacts } from "@shared/schema";
import type { SdrLeadState, InsertSdrLeadEvent, InsertSdrChannelAttempt } from "@shared/schema";
import { eq, lte, and, isNull, sql } from "drizzle-orm";
import { scoreLeadFull, getLeadProcessorData, getLeadGrowthData } from "./scoring";
import { getProcessorSignals, getProcessorTemplate } from "./processor-detector";
import { decideNextAction, getAllowedTransitions } from "./stage-rules";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "../ghl";
import { resolveVoiceScriptForLead, buildGhlVoicePayload } from "./voice-orchestrator";
import { selectBestInbox, recordSend, rollbackSend, recordBounce, recordDelivered } from "./inbox-rotation";
import { tagContactForInboxOrganization } from "../ghl-workflow-enrollment";
import { getCanonicalLeadVertical } from "./vertical-resolver";
import { ingestBusiness } from "./dedupe";
import { featureFlags } from "../feature-flags";
import OpenAI from "openai";
import { logAiCall } from "../ai-audit-logger";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

const ORCHESTRATOR_SWEEP_MINUTES = 5;
const EMAIL_DAILY_LIMIT = 200;
const SMS_DAILY_LIMIT = 100;
const CALL_DAILY_LIMIT = 50;

interface DailyCounters {
  date: string;
  emailsSent: number;
  smsSent: number;
  callsMade: number;
}

let dailyCounters: DailyCounters = {
  date: new Date().toISOString().slice(0, 10),
  emailsSent: 0,
  smsSent: 0,
  callsMade: 0,
};

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let isSweeping = false;
let globalPaused = false;
let globalPauseReason = "";
let lastSweepTime: Date | null = null;
let lastSweepErrors = 0;
let sweepBounceCount = 0;
let sweepSendCount = 0;
const sentMessageIds = new Set<string>();

export function isGloballyPaused(): boolean { return globalPaused; }
export function getGlobalPauseReason(): string { return globalPauseReason; }
export function getLastSweepTime(): Date | null { return lastSweepTime; }
export function getLastSweepErrors(): number { return lastSweepErrors; }

export function pauseAll(reason?: string): void {
  globalPaused = true;
  globalPauseReason = reason || "Manual pause";
  console.log(`[SDR Orchestrator] GLOBAL PAUSE activated: ${globalPauseReason}`);
}

export function resumeAll(): void {
  globalPaused = false;
  globalPauseReason = "";
  sweepBounceCount = 0;
  sweepSendCount = 0;
  sentMessageIds.clear();
  webhookFailureCount = 0;
  console.log("[SDR Orchestrator] GLOBAL PAUSE released — resumed");
}

function checkKillSwitch(): boolean {
  if (sweepSendCount > 0 && sweepBounceCount / sweepSendCount > 0.05) {
    pauseAll(`Auto-pause: bounce rate ${((sweepBounceCount / sweepSendCount) * 100).toFixed(1)}% exceeds 5% threshold (${sweepBounceCount}/${sweepSendCount})`);
    return true;
  }
  return false;
}

function trackSendForKillSwitch(messageId?: string | null): boolean {
  sweepSendCount++;
  if (messageId) {
    if (sentMessageIds.has(messageId)) {
      pauseAll(`Auto-pause: duplicate send detected for messageId=${messageId}`);
      return true;
    }
    sentMessageIds.add(messageId);
    if (sentMessageIds.size > 10000) {
      const arr = Array.from(sentMessageIds);
      sentMessageIds.clear();
      arr.slice(-5000).forEach(id => sentMessageIds.add(id));
    }
  }
  return false;
}

function trackBounceForKillSwitch(): void {
  sweepBounceCount++;
  checkKillSwitch();
}

let webhookFailureCount = 0;
const WEBHOOK_FAILURE_THRESHOLD = 20;

export function trackWebhookFailure(): void {
  webhookFailureCount++;
  if (webhookFailureCount >= WEBHOOK_FAILURE_THRESHOLD) {
    pauseAll(`Auto-pause: webhook failure count (${webhookFailureCount}) exceeded threshold (${WEBHOOK_FAILURE_THRESHOLD})`);
  }
}

export function resetWebhookFailureCount(): void {
  webhookFailureCount = 0;
}

export function getWebhookFailureCount(): number {
  return webhookFailureCount;
}

function getEstDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function resetDailyCountersIfNeeded() {
  const today = getEstDateString();
  if (dailyCounters.date !== today) {
    dailyCounters = { date: today, emailsSent: 0, smsSent: 0, callsMade: 0 };
  }
}

function canSendEmail(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.emailsSent < EMAIL_DAILY_LIMIT;
}

function canSendSms(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.smsSent < SMS_DAILY_LIMIT;
}

function canMakeCall(): boolean {
  resetDailyCountersIfNeeded();
  return dailyCounters.callsMade < CALL_DAILY_LIMIT;
}

function isQuietHours(): boolean {
  const now = new Date();
  const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  return estHour < 8 || estHour >= 21;
}

async function logLeadEvent(leadStateId: number, event: Omit<InsertSdrLeadEvent, "leadStateId">) {
  try {
    await db.insert(sdrLeadEvents).values({ ...event, leadStateId });
  } catch (err) {
    console.error("[SDR Orchestrator] Failed to log event:", err);
  }
}

async function logChannelAttempt(attempt: InsertSdrChannelAttempt) {
  try {
    await db.insert(sdrChannelAttempts).values(attempt);
  } catch (err) {
    console.error("[SDR Orchestrator] Failed to log channel attempt:", err);
  }
}

const EMAIL_TEMPLATES: Record<string, { subject: string; body: string }[]> = {
  default: [
    {
      subject: "Quick question about {{company_name}}'s payment processing",
      body: "Hi {{first_name}},\n\nI noticed {{company_name}} and wanted to reach out. Many {{vertical}} businesses in {{city}} are saving significantly on payment processing fees.\n\nWould you be open to a quick comparison of your current rates? No obligation — just a free analysis.\n\nBest regards,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Following up — {{company_name}} payment savings",
      body: "Hi {{first_name}},\n\nI wanted to follow up on my previous email. We've been helping {{vertical}} businesses reduce their processing costs, and I'd love to show you how {{company_name}} could benefit.\n\nWould you have 10 minutes for a quick call this week?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note — processing savings for {{company_name}}",
      body: "Hi {{first_name}},\n\nJust one more quick note. If you're happy with your current processor, no worries at all. But if you've ever wondered whether you're overpaying, our free statement analysis takes just a few minutes and could save {{company_name}} hundreds each month.\n\nHere when you're ready.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Auto": [
    {
      subject: "Quick question on card fees at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe work with Florida repair shops that do larger tickets and get crushed on card fees. We've been helping owners lower cost and make front-counter payments smoother.\n\n3 common issues we see at shops like {{company_name}}:\n- Pricing too high on {{service_type}} repair tickets\n- Clunky terminals that slow front-counter flow\n- No big-ticket payment process (text-to-pay, financing)\n\nEstimated monthly volume in your range ({{estimated_volume}}) usually means $200-500/month in savings waiting to be found.\n\nWe do a free 10-minute statement review. Interested?\n\nBest,\nLiberty Bancard Team\n\nFlorida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Eligibility, underwriting, and applicable laws apply.",
    },
    {
      subject: "How a shop similar to {{company_name}} saved $X/month",
      body: "Hi {{first_name}},\n\nA Florida {{service_type}} shop similar to {{company_name}} came to us overpaying on processing.\n\nAfter switching:\n- Effective rate dropped significantly\n- Text-to-pay enabled for invoices over $500\n- Chargebacks cut in half with better documentation\n- Verified savings on their monthly volume\n\nWant to see what your numbers look like? Send us your latest statement for a free side-by-side comparison.\n\nBest,\nLiberty Bancard Team\n\nFlorida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note about your processing at {{company_name}}",
      body: "Hi {{first_name}},\n\nLast note — our free merchant statement review covers:\n- Your true effective rate (not the advertised one)\n- Hidden fees your processor might not explain\n- Text-to-pay and financing integration options for {{service_type}} tickets\n- Chargeback exposure and how to reduce it\n\nNo pressure. If your setup is already solid, we'll tell you.\n\nFree statement review offer — upload your latest statement and we'll have results in 24 hours.\n\nBest,\nLiberty Bancard Team\n\nFL auto repair shops must be registered with FDACS per the FL Motor Vehicle Repair Act. Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Eligibility, underwriting, and applicable laws apply.",
    },
  ],
  "Salon/Spa": [
    {
      subject: "Question about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe work with Florida med spas on memberships, card-on-file, and higher-ticket payment flow.\n\n4 issues we see at practices like {{company_name}}:\n- No-show leakage without deposit/card-on-file protection\n- Weak card-on-file process\n- Clunky membership billing for {{service_type}} packages\n- Overpaying on processing (especially on higher-ticket procedures)\n\nWe help build a payment workflow — not just processing — that supports memberships, deposits, cancellation protection, and patient financing.\n\nWould a complimentary payment workflow review be helpful? Usually uncovers $300-800/month in savings or revenue opportunities.\n\nBest,\nLiberty Bancard Team\n\nMed spas in FL are regulated by the FL Dept of Health, Division of Medical Quality Assurance. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a practice similar to {{company_name}} improved membership revenue",
      body: "Hi {{first_name}},\n\nA Florida med spa similar to {{company_name}} offering {{service_type}} came to us with recurring billing challenges.\n\nAfter implementing our payment workflow:\n- Membership churn dropped significantly with automated card updater + smart retries\n- No-show rate cut dramatically with required card-on-file and deposit policy\n- Average ticket increased with patient financing on packages\n- Clean online checkout links for package purchases between visits\n\nIf you're running memberships or packages, this kind of review usually pays for itself in the first month.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Quick follow-up on payment flow at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur complimentary payment workflow review for {{company_name}} covers:\n- Membership/recurring billing review for {{service_type}}\n- Card-on-file and deposit policies for no-show protection\n- Patient financing for higher-ticket services\n- Online checkout links for remote package purchases\n- Processing cost optimization for your estimated volume ({{estimated_volume}})\n\nNo commodity pitch — just a workflow review focused on how payments support your growth.\n\nBest,\nLiberty Bancard Team\n\nMed spas in FL are regulated by the FL Dept of Health, Division of Medical Quality Assurance. Eligibility, underwriting, and applicable laws apply.",
    },
  ],
  "Healthcare": [
    {
      subject: "Patient payment question for {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida {{service_type}} practices improve patient payment flow.\n\n4 common issues at practices like {{company_name}}:\n- Manual collection work consuming front-desk time\n- No text-to-pay option for patient balances\n- Lack of structured payment plans for larger balances\n- Processing pricing unreviewed (estimated volume: {{estimated_volume}})\n\nWe improve patient collections and payment plans without making front-desk work harder.\n\nFree patient collections review — takes about 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nLiberty Bancard does not request, store, or access protected health information (PHI). HIPAA applies to covered entities and business associates. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a similar {{service_type}} practice improved patient collections",
      body: "Hi {{first_name}},\n\nA Florida {{service_type}} practice similar to {{company_name}} came to us with front-desk collection challenges.\n\nAfter implementing our patient payment workflow:\n- Outstanding balances collected significantly faster with automated text-to-pay reminders\n- Front desk saved hours per week on payment-related calls\n- Formal payment plans reduced write-offs\n- Card-on-file for recurring visits eliminated manual collection at checkout\n\nIf your front desk is spending time chasing payments, this kind of review usually pays for itself immediately.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last check-in about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free patient collections review for {{company_name}} covers:\n- Manual collection taking up front-desk time\n- Text-to-pay for remote patient payments\n- Payment plan structure for larger balances\n- Processing fee benchmarking (your estimated volume: {{estimated_volume}})\n- Card storage security and compliance\n\nFree, 10 minutes, and usually finds actionable improvements right away.\n\nBest,\nLiberty Bancard Team\n\nHIPAA applies to covered entities and business associates. Liberty Bancard does not access PHI. Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Eligibility, underwriting, and applicable laws apply.",
    },
  ],
  "Medical/Dental/Medspa": [
    {
      subject: "Patient payment question for {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida {{service_type}} practices improve patient payment flow — text-to-pay, payment plans, and front-desk collections.\n\n4 common issues at practices like {{company_name}}:\n- Manual collection work at the front desk\n- No text-to-pay for patient balances\n- Lack of payment plans for larger balances\n- Processing fees unreviewed (estimated volume: {{estimated_volume}})\n\nFree patient collections review — 10 minutes. Interested?\n\nBest,\nLiberty Bancard Team\n\nLiberty Bancard does not access PHI. HIPAA applies to covered entities. Eligibility, underwriting, and applicable laws apply.",
    },
    {
      subject: "How a similar {{service_type}} practice improved collections",
      body: "Hi {{first_name}},\n\nA Florida {{service_type}} practice similar to {{company_name}} saw:\n- Significantly faster balance collection with text-to-pay\n- Hours saved at front desk each week\n- Reduced write-offs with structured payment plans\n\nWant to see what {{company_name}} could improve?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last check-in about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nFree patient collections review for {{company_name}} covers text-to-pay, payment plans, card-on-file, and fee benchmarking for {{service_type}} practices. Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nHIPAA applies to covered entities and business associates. Liberty Bancard does not access PHI. Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Eligibility, underwriting, and applicable laws apply.",
    },
  ],
  "Salon": [
    {
      subject: "Quick question about card fees at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe work with Florida salons and beauty businesses on payment processing — card-on-file for appointments, tip management, and reducing overall swipe fees.\n\n3 common issues at salons like {{company_name}}:\n- No card-on-file for no-show protection or deposits\n- Tip prompt configuration that slows checkout\n- Overpaying on processing (especially on higher-ticket services)\n\nMost salons we review at your estimated volume ({{estimated_volume}}) find $150-400/month in savings or workflow improvements.\n\nFree 10-minute payment review — interested?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a salon similar to {{company_name}} improved payment flow",
      body: "Hi {{first_name}},\n\nA Florida salon similar to {{company_name}} came to us with common checkout challenges.\n\nAfter switching:\n- Card-on-file set up for deposits and no-show protection\n- Tip prompts streamlined at checkout\n- Processing rate reduced on service and retail tickets\n- Online booking integrated with payment capture\n\nWant to see what your numbers look like? We do a free side-by-side review.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers:\n- Card-on-file and deposit setup for appointments\n- Tip configuration and checkout flow\n- Processing cost benchmarking (estimated volume: {{estimated_volume}})\n- Online payment and booking integration options\n\nNo pressure — if your setup is already working, we'll tell you.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Gym": [
    {
      subject: "Quick question about billing at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida gyms and fitness studios streamline membership billing and reduce payment processing costs.\n\n4 issues we commonly see at fitness businesses like {{company_name}}:\n- Failed recurring payments eating into membership revenue\n- No automated retry logic for declined cards\n- Overpaying on processing (estimated volume: {{estimated_volume}})\n- Clunky front-desk checkout for drop-ins and packages\n\nA payment workflow review usually uncovers $200-600/month in savings or recovered revenue.\n\nFree 10-minute review — interested?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a gym similar to {{company_name}} reduced failed payments",
      body: "Hi {{first_name}},\n\nA Florida fitness studio similar to {{company_name}} came to us losing membership revenue to failed billing.\n\nAfter implementing our payment workflow:\n- Failed payment retry logic recovered significant monthly revenue\n- Card updater reduced churn from expired cards\n- Processing rate lowered across membership and drop-in transactions\n- Front-desk checkout streamlined for classes and packages\n\nWant to see what {{company_name}} could improve?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last check-in about membership payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers membership billing, failed payment recovery, processing cost benchmarking ({{estimated_volume}}), and drop-in checkout flow. Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Hotel": [
    {
      subject: "Quick question about payment processing at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe work with Florida hotels and hospitality businesses on payment processing — card-on-file for reservations, incidental holds, and reducing overall processing costs.\n\n4 common issues at properties like {{company_name}}:\n- Card authorization and incidental hold complexity\n- No-show and cancellation payment capture\n- High effective rate on card-present and card-not-present transactions\n- Fragmented payment systems across front desk, restaurant, and ancillary revenue\n\nFree 10-minute payment review for hospitality properties — interested?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a property similar to {{company_name}} reduced processing costs",
      body: "Hi {{first_name}},\n\nA Florida hospitality property similar to {{company_name}} came to us with fragmented payment systems.\n\nAfter our review:\n- Effective processing rate lowered across front-desk and F&B transactions\n- Card-on-file and incidental hold workflow simplified\n- No-show payment capture improved\n- Unified reporting across all revenue centers\n\nWant to see what your numbers look like? Free side-by-side comparison.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers processing cost benchmarking ({{estimated_volume}}), card-on-file and authorization workflows, no-show capture, and multi-department payment consolidation. Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Landscaping": [
    {
      subject: "Quick question about card payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida landscaping and lawn care businesses get paid faster and reduce card processing costs.\n\n3 common issues we see at field service businesses like {{company_name}}:\n- No text-to-pay or mobile invoicing for job completion\n- Overpaying on processing (estimated volume: {{estimated_volume}})\n- Slow payment collection after service — waiting for checks or cash\n\nText-to-pay alone typically accelerates collection by several days and reduces outstanding balances.\n\nFree 10-minute payment review — interested?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a landscaping company similar to {{company_name}} sped up collections",
      body: "Hi {{first_name}},\n\nA Florida landscaping company similar to {{company_name}} came to us waiting too long to get paid after completing jobs.\n\nAfter implementing our payment workflow:\n- Text-to-pay enabled for on-site and remote invoicing\n- Processing rate lowered on card transactions\n- Recurring billing set up for maintenance contracts\n- Mobile payments enabled in the field\n\nWant to see what {{company_name}} could improve?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last check-in about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers text-to-pay setup, mobile field payments, recurring billing for maintenance contracts, and processing cost benchmarking ({{estimated_volume}}). Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Construction": [
    {
      subject: "Quick question about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida contractors and construction businesses get paid faster on larger job tickets and reduce card processing costs.\n\n4 common issues we see at businesses like {{company_name}}:\n- No efficient way to collect deposits or progress payments by card\n- High effective rate on larger-ticket transactions\n- No text-to-pay or invoice payment link for remote collection\n- Clunky process for change orders or additional billing\n\nFor contractors at your estimated volume ({{estimated_volume}}), a payment review typically finds $300-800/month in savings or revenue acceleration.\n\nFree 10-minute review — interested?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a contractor similar to {{company_name}} improved payment collection",
      body: "Hi {{first_name}},\n\nA Florida contractor similar to {{company_name}} came to us struggling to collect efficiently on larger job tickets.\n\nAfter our payment review:\n- Deposit and progress payment collection streamlined via card or ACH\n- Text-to-pay enabled for remote invoice collection\n- Effective processing rate lowered on higher-ticket transactions\n- Change order billing handled cleanly without extra steps\n\nWant to see what your numbers look like?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last note about payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers deposit and progress payment collection, text-to-pay setup, processing cost benchmarking ({{estimated_volume}}), and ACH options for larger job payments. Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
  "Legal": [
    {
      subject: "Quick question about payment processing at {{company_name}}",
      body: "Hi {{first_name}},\n\nWe help Florida law firms and legal professionals manage client payment processing — trust account compliance, retainer collection, and reducing overall card processing costs.\n\n4 issues we commonly see at firms like {{company_name}}:\n- No compliant way to accept cards into trust (IOLTA) accounts\n- Overpaying on processing for retainer and invoice payments\n- No online payment link for remote client invoice collection\n- Clunky reconciliation between payments and billing systems\n\nFree 10-minute payment review for legal professionals — interested?\n\nBest,\nLiberty Bancard Team\n\nLaw firms accepting credit cards for legal fees should consult applicable bar ethics rules regarding surcharging and trust account compliance. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "How a firm similar to {{company_name}} streamlined client payments",
      body: "Hi {{first_name}},\n\nA Florida law firm similar to {{company_name}} came to us with client payment collection challenges.\n\nAfter our review:\n- Compliant card acceptance workflow for retainers and fees\n- Online payment links for remote client invoice collection\n- Processing rate lowered on client payment transactions\n- Cleaner reconciliation between payment processor and billing software\n\nWant to see what {{company_name}} could improve?\n\nBest,\nLiberty Bancard Team\n\nConsult applicable bar ethics rules regarding surcharging and trust account compliance. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
    {
      subject: "Last check-in about client payments at {{company_name}}",
      body: "Hi {{first_name}},\n\nOur free payment review for {{company_name}} covers retainer and fee collection workflow, trust account compliance, online payment link setup, and processing cost benchmarking ({{estimated_volume}}). Takes 10 minutes.\n\nBest,\nLiberty Bancard Team\n\nConsult applicable bar ethics rules regarding surcharging and trust account compliance. Eligibility, underwriting, card brand rules, and applicable laws apply.",
    },
  ],
};

const SMS_TEMPLATES: Record<string, string[]> = {
  default: [
    "Hi {{first_name}}, this is Liberty Bancard. We help {{vertical}} businesses save on payment processing. Interested in a free rate comparison? Reply YES and we'll set it up.",
    "Hi {{first_name}}, following up about payment processing savings for {{company_name}}. Many {{vertical}} businesses save 20-40%. Quick chat? Reply YES or let us know a good time.",
  ],
  "Auto": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL auto shops cut card fees on big {{service_type}} repair tickets. Worth a quick look? Reply YES or visit {{link}} FL surcharging rules apply (credit only).",
    "Still interested in seeing if {{company_name}} is overpaying on card processing? Free 10-min review: {{link}} FL surcharging disclosure required per card brand rules.",
  ],
  "Salon/Spa": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL med spas streamline memberships, deposits & payment flow for {{service_type}}. Quick review? {{link}}",
    "Following up — would a free payment workflow review for {{company_name}} be helpful? Takes 10 min: {{link}}",
  ],
  "Healthcare": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL {{service_type}} practices improve patient payment flow & collections. Quick review? {{link}}",
    "Following up on patient payments at {{company_name}}. Free collections review takes 10 min: {{link}}",
  ],
  "Medical/Dental/Medspa": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL {{service_type}} practices improve patient payment flow & collections. Quick review? {{link}}",
    "Following up on patient payments at {{company_name}}. Free collections review takes 10 min: {{link}}",
  ],
  "Salon": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL salons set up card-on-file, tips & cut processing costs. Free 10-min review? {{link}}",
    "Following up on payment processing for {{company_name}}. Most salons find savings quickly — free review: {{link}}",
  ],
  "Gym": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL gyms & studios reduce failed membership payments & cut card fees. Free review? {{link}}",
    "Following up on membership billing at {{company_name}}. Free payment review takes 10 min: {{link}}",
  ],
  "Hotel": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL hotels streamline card-on-file, incidental holds & lower processing costs. Quick review? {{link}}",
    "Following up on payment processing at {{company_name}}. Free hospitality payment review: {{link}}",
  ],
  "Landscaping": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL landscapers get paid faster with text-to-pay & cut card fees. Free review? {{link}}",
    "Following up on collections for {{company_name}}. Text-to-pay can speed up payment on every job — free review: {{link}}",
  ],
  "Construction": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL contractors collect deposits & job payments faster & cut card fees. Free review? {{link}}",
    "Following up on payment collection for {{company_name}}. Free 10-min payment review for contractors: {{link}}",
  ],
  "Legal": [
    "Hi {{first_name}}, this is {{agent_name}} with Liberty Bancard. We help FL law firms accept client payments compliantly & reduce processing costs. Free review? {{link}}",
    "Following up on client payment processing for {{company_name}}. Free 10-min review for legal professionals: {{link}}",
  ],
};

export function normalizeVerticalKey(vertical: string | null | undefined): string {
  if (!vertical) return "";
  const v = vertical.toLowerCase().trim();

  // Auto repair / automotive (before salon to avoid "auto" matching other things)
  if (/auto|automotive|auto repair|collision|body shop|tire/i.test(v)) return "Auto";

  // Med Spa — clinical aesthetic treatments (keep existing bucket)
  const hasMedSpaTerms = /med.?spa|medspa|aesthetic|botox|filler|laser/i.test(v);
  const hasClinicalTerms = /dental|dentist|chiro|optom|podiatr|dermat|urgent care|physical therapy|behavioral|healthcare|clinic/i.test(v);
  const hasMedicalPrimary = /^medical(?!.*spa)/i.test(v) || hasClinicalTerms;
  if (hasMedSpaTerms && !hasMedicalPrimary) return "Salon/Spa";
  if (hasMedicalPrimary || /^medical/i.test(v)) return "Healthcare";
  if (hasMedSpaTerms) return "Salon/Spa";
  if (/spa/i.test(v)) return "Salon/Spa";

  // Plain beauty salons, hair salons, nail salons, barbers
  if (/\bsalon\b|hair salon|nail salon|beauty salon|barber|beauty parlor|cosmetolog/i.test(v)) return "Salon";

  // Gym / fitness / wellness studios
  if (/\bgym\b|fitness|crossfit|yoga|pilates|martial arts|personal training|boxing|dance studio|wellness center/i.test(v)) return "Gym";

  // Hotel / hospitality / lodging
  if (/\bhotel\b|motel|\binn\b|\blodge\b|\bresort\b|hospitality|bed and breakfast|b&b|vacation rental|airbnb/i.test(v)) return "Hotel";

  // Landscaping / lawn / grounds
  if (/landscap|lawn care|lawn service|lawn mowing|tree service|tree trimm|grounds.?keep|irrigation|pest control|exterminator/i.test(v)) return "Landscaping";

  // Construction / trades / contractors
  if (/\bconstruct|contractor|builder|roofer|roofing|plumb|electrician|electrical|hvac|remodel|renovati|carpent|mason|concrete|drywall|paint|siding|window install|flooring install/i.test(v)) return "Construction";

  // Legal / professional services / law
  if (/attorney|law firm|\blawyer\b|\blegal\b|solicitor|paralegal|notary|title company/i.test(v)) return "Legal";

  return "";
}

const VERTICAL_SEQUENCE_MAP: Record<string, string> = {
  "Auto":                   "V-Auto Repair: SDR Outbound Prospecting",
  "Automotive":             "V-Auto Repair: SDR Outbound Prospecting",
  "Auto Repair":            "V-Auto Repair: SDR Outbound Prospecting",
  "Salon/Spa":              "V-Salon: SDR Outbound Prospecting",
  "Salon":                  "V-Salon: SDR Outbound Prospecting",
  "Healthcare":             "V-Medical: SDR Outbound Prospecting",
  "Medical/Dental/Medspa":  "V-Medical: SDR Outbound Prospecting",
  "Medical":                "V-Medical: SDR Outbound Prospecting",
  "Dental":                 "V-Dental: SDR Outbound Prospecting",
  "Dentist":                "V-Dental: SDR Outbound Prospecting",
  "Med Spa":                "V-Med Spa: SDR Outbound Prospecting",
  "Medspa":                 "V-Med Spa: SDR Outbound Prospecting",
  "Retail":                 "V-Retail: SDR Outbound Prospecting",
  "Gym":                    "V-Gym: SDR Outbound Prospecting",
  "Fitness/Recreation":     "V-Gym: SDR Outbound Prospecting",
  "Fitness":                "V-Gym: SDR Outbound Prospecting",
  "Hotel":                  "V-Hotel: SDR Outbound Prospecting",
  "Hospitality":            "V-Hotel: SDR Outbound Prospecting",
  "Landscaping":            "V-Landscaping: SDR Outbound Prospecting",
  "Construction":           "V-Construction: SDR Outbound Prospecting",
  "Legal":                  "V-Legal: SDR Outbound Prospecting",
  "Professional Services":  "V-Legal: SDR Outbound Prospecting",
};

export function resolveVerticalSequenceName(verticalKey: string, rawVertical: string | null | undefined): string {
  return VERTICAL_SEQUENCE_MAP[verticalKey] || "1. Switch & Save — Statement Audit";
}

async function attachAgentName(lead: SdrLeadState): Promise<void> {
  try {
    if (!lead.contactId) return;
    const contact = await storage.getContact(lead.contactId);
    if (!contact) return;
    const deals = await storage.getDealsByContact(contact.id);
    for (const deal of deals) {
      const agentMerchantList = await storage.getAgentMerchantsByDeal(deal.id);
      if (agentMerchantList.length > 0) {
        const agentRecord = await storage.getAgent(agentMerchantList[0].agentId);
        if (agentRecord?.name) {
          (lead as any)._resolvedAgentName = agentRecord.name;
          return;
        }
      }
    }
  } catch (err) {
    console.warn("[SDR Orchestrator] Could not resolve agent name:", err);
  }
}

function personalizeTemplate(template: string, lead: SdrLeadState): string {
  const firstName = lead.ownerName?.split(" ")[0] || "there";
  const enrichment = (lead.enrichmentData as Record<string, any>) || {};
  const serviceType = enrichment.serviceType || lead.vertical || "general";
  const estimatedVolume = enrichment.estimatedVolume || "your current volume";

  const bookingLink = process.env.GHL_DEFAULT_BOOKING_LINK || process.env.SALES_CALENDAR_URL || "https://calendly.com/libertybancard";

  return template
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{company_name\}\}/g, lead.companyName || "your business")
    .replace(/\{\{vertical\}\}/g, lead.vertical || "local")
    .replace(/\{\{city\}\}/g, lead.city || "your area")
    .replace(/\{\{service_type\}\}/g, serviceType)
    .replace(/\{\{estimated_volume\}\}/g, estimatedVolume)
    .replace(/\{\{agent_name\}\}/g, (lead as any)._resolvedAgentName || "Liberty Bancard")
    .replace(/\{\{link\}\}/g, bookingLink);
}

async function personalizeWithAI(template: string, lead: SdrLeadState, channel: string): Promise<string> {
  try {
    const openai = getOpenAI();
    const isSms = channel === "sms";
    const lengthRule = isSms ? "160 characters" : "200 words";
    const detectedProcessor = (lead as any).enrichmentData?.detectedProcessor || "";
    const serviceType = (lead as any).enrichmentData?.serviceType || "";
    const ownerFirstName = lead.ownerName?.split(" ")[0] || "";
    const orchMessages = [
      {
        role: "system" as const,
        content: `You are an expert B2B copywriter specializing in merchant payment processing outreach for Liberty Bancard. You personalize cold outreach templates for specific businesses without inventing facts.

Rules you must never break:
1. Never alter or remove the compliance/legal disclaimer line at the end.
2. Never quote specific rates, percentages, or guaranteed savings amounts.
3. Never add emojis.
4. Never address the recipient by a generic placeholder like "there" if a real first name is available.
5. Never change the core call-to-action or booking link.
6. Output only the final message text — no subject line, no explanation, no markdown.`,
      },
      {
        role: "user" as const,
        content: `Personalize this ${channel} for:
Business: ${lead.companyName || "the business"}
Owner first name: ${ownerFirstName}
Vertical: ${lead.vertical || "business"}
City: ${lead.city || ""}
Current processor (if known): ${detectedProcessor}
Estimated monthly volume: ${(lead as any).estimatedVolume || ""}
Service focus: ${serviceType}

Make it feel like it was written specifically for this business — adjust city references, reference their vertical's specific pain points, and make any general phrases more specific. Keep it under ${lengthRule}. Return only the final message.

Template:
${template}`,
      },
    ];
    const { completion: response, flagged: orchFlagged, reviewQueueId: orchReviewId } = await logAiCall(
      { triggerType: "outbound-copy", actorType: "system", rawPrompt: JSON.stringify(orchMessages) },
      () => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: orchMessages,
        max_tokens: channel === "sms" ? 100 : 300,
      }));

    if (orchFlagged) {
      console.warn(`[AI Governance] SDR outbound personalization flagged (reviewQueueId=${orchReviewId}) — using unmodified template to prevent low-confidence outbound send`);
      return template;
    }

    return response.choices[0]?.message?.content || template;
  } catch (err) {
    console.error("[SDR Orchestrator] AI personalization failed:", err);
    return template;
  }
}

function isAllowedSendingDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const allowedDomains = [
    "libertypayments.co",
    "getlibertyprocessing.com",
    "libertybancard.com",
    "libertybancardconsulting.com",
  ];
  return allowedDomains.includes(domain);
}

function isPersonalInbox(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return true;
  const personalDomains = [
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "aol.com", "icloud.com", "me.com", "live.com", "msn.com",
    "protonmail.com", "mail.com",
  ];
  return personalDomains.includes(domain);
}

async function isContactExcludedFromSdr(lead: SdrLeadState): Promise<boolean> {
  if (!lead.contactId) return false;
  try {
    const contact = await storage.getContact(lead.contactId);
    if (!contact) return false;
    const tags = contact.tags || [];
    if (tags.includes("LB-ACTIVE-PIPELINE")) return true;
    if (tags.includes("LB-DO-NOT-AUTO")) return true;
    if (contact.doNotContact) return true;
    if (contact.doNotAutoContact) return true;

    const deals = await storage.getDealsByContact(contact.id);
    const activeStages = [
      "Statement Received", "Review In Progress", "Call Booked",
      "Proposal Sent", "Negotiation / Follow-Up", "Contract Sent",
      "Application Started", "Underwriting Submitted", "Approved",
      "Terminal Ordered", "Go-Live Scheduled",
    ];
    const hasActiveDeal = deals.some(d => activeStages.includes(d.stage));
    if (hasActiveDeal) return true;
  } catch (err) {
    console.error(`[SDR Orchestrator] Error checking SDR exclusion for lead ${lead.id}:`, err);
  }
  return false;
}

async function executeEmailAction(lead: SdrLeadState, strongerCta?: boolean): Promise<boolean> {
  if (!canSendEmail()) {
    console.log(`[SDR Orchestrator] Email daily limit reached (${dailyCounters.emailsSent}/${EMAIL_DAILY_LIMIT})`);
    return false;
  }

  if (!isGhlConfigured()) {
    console.log("[SDR Orchestrator] GHL not configured, skipping email send");
    return false;
  }

  if (await isContactExcludedFromSdr(lead)) {
    console.log(`[SDR Orchestrator] Lead ${lead.id} excluded from SDR (active pipeline or do-not-sdr)`);
    return false;
  }

  const toEmail = lead.ownerEmail || lead.email;
  if (!toEmail) return false;

  const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
  if (!selectedInbox) {
    console.log(`[SDR Orchestrator] No eligible inbox available for lead ${lead.id} (merchantId: ${lead.merchantId}) — all inboxes at daily cap, deferring email`);
    try {
      await storage.createAuditLog({
        action: "DAILY_CAP_REACHED",
        entityType: "sdr_lead",
        entityId: lead.id,
        details: `All sending identities at daily cap — lead ${lead.id} deferred (merchantId: ${lead.merchantId}, vertical: ${lead.vertical || "unknown"})`,
      });
    } catch (auditErr) {
      console.warn("[SDR Orchestrator] Failed to write DAILY_CAP_REACHED audit event:", auditErr);
    }
    return false;
  }

  if (isPersonalInbox(selectedInbox.emailAddress)) {
    console.log(`[SDR Orchestrator] Rejecting personal inbox ${selectedInbox.emailAddress} for lead ${lead.id} — domain sending identities required`);
    return false;
  }

  if (!isAllowedSendingDomain(selectedInbox.emailAddress)) {
    console.log(`[SDR Orchestrator] Rejecting inbox ${selectedInbox.emailAddress} — not from allowed sending domain for lead ${lead.id}`);
    return false;
  }

  console.log(`[SDR Orchestrator] Using inbox ${selectedInbox.label} (${selectedInbox.emailAddress}) for lead ${lead.id}`);

  const attemptNumber = (lead.emailAttempts || 0) + 1;
  const templateIndex = Math.min(attemptNumber - 1, 2);

  let subject: string = "";
  let body: string = "";

  let usedProcessorTemplate = false;
  if (attemptNumber === 1 && lead.businessId) {
    try {
      const signals = await getProcessorSignals(lead.businessId);
      const highConfidenceSignals = signals.filter(s => (s.confidenceScore || 0) >= 0.70);
      if (highConfidenceSignals.length > 0) {
        const topSignal = highConfidenceSignals.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))[0];
        const processorTpl = getProcessorTemplate(topSignal.vendorName);
        if (processorTpl) {
          subject = personalizeTemplate(processorTpl.subject, lead);
          body = personalizeTemplate(processorTpl.body, lead);
          usedProcessorTemplate = true;
          console.log(`[SDR Orchestrator] Using processor-specific template for ${topSignal.vendorName}`);
        }
      }
    } catch (err) {
      console.error("[SDR Orchestrator] Failed to load processor email template:", err);
    }
  }

  if (!usedProcessorTemplate) {
    const verticalKey = normalizeVerticalKey(lead.vertical);
    const templates = EMAIL_TEMPLATES[verticalKey] || EMAIL_TEMPLATES[lead.vertical || ""] || EMAIL_TEMPLATES.default;
    const template = templates[templateIndex] || templates[templates.length - 1];
    subject = personalizeTemplate(template.subject, lead);
    body = personalizeTemplate(template.body, lead);
  }

  try {
    body = await personalizeWithAI(body, lead, "email");
  } catch (err) {
    console.error("[SDR Orchestrator] AI personalization failed, using template as-is:", err);
  }

  if (!lead.contactId) {
    console.log(`[SDR Orchestrator] Lead ${lead.id} has no contactId, cannot send GHL email`);
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: "failed",
      subject,
      body,
      error: "No contactId for GHL",
      sentAt: new Date(),
    });
    return false;
  }

  const slotReserved = await recordSend(selectedInbox.id, lead.merchantId);
  if (!slotReserved) {
    console.log(`[SDR Orchestrator] Inbox ${selectedInbox.emailAddress} hit daily cap (atomic check) for lead ${lead.id} — aborting send`);
    try {
      await storage.createAuditLog({
        action: "DAILY_CAP_REACHED",
        entityType: "sdr_lead",
        entityId: lead.id,
        details: `Send slot reservation failed — inbox ${selectedInbox.emailAddress} at daily cap for lead ${lead.id}`,
      });
    } catch { /* non-fatal */ }
    return false;
  }

  try {
    const result = await sendGhlEmail({
      contactId: lead.contactId,
      subject,
      body,
      fromEmail: selectedInbox.emailAddress,
      fromName: selectedInbox.label,
    });

    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: result.success ? "sent" : "failed",
      ghlMessageId: result.messageId || null,
      subject,
      body,
      error: result.error || null,
      sentAt: new Date(),
    });

    if (result.success) {
      dailyCounters.emailsSent++;
      await recordDelivered(selectedInbox.id);
      trackSendForKillSwitch(result.messageId);
      await db.update(sdrLeadState).set({
        emailAttempts: attemptNumber,
        lastEmailAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      if (lead.contactId && lead.ghlContactId) {
        const vertKey = normalizeVerticalKey(lead.vertical);
        const resolvedSeqName = resolveVerticalSequenceName(vertKey, lead.vertical);
        const [taggingMerchant] = lead.merchantId
          ? await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, lead.merchantId))
          : [];
        const canonicalVertical = getCanonicalLeadVertical({
          subvertical: taggingMerchant?.subvertical,
          vertical: taggingMerchant?.vertical ?? lead.vertical,
        });
        tagContactForInboxOrganization({
          contactId: lead.contactId,
          ghlContactId: lead.ghlContactId,
          sequenceName: resolvedSeqName,
          vertical: canonicalVertical,
          stage: "active",
        }).catch(err => console.warn("[SDR Orchestrator] Inbox tagging failed:", err));
      }
    } else if (result.error) {
      const errorLower = (result.error || "").toLowerCase();
      if (errorLower.includes("bounce") || errorLower.includes("invalid") || errorLower.includes("undeliverable")) {
        await recordBounce(selectedInbox.id);
        trackBounceForKillSwitch();
      }
    }

    return result.success;
  } catch (err: any) {
    await rollbackSend(selectedInbox.id);
    const errorLower = (err.message || "").toLowerCase();
    if (errorLower.includes("bounce") || errorLower.includes("invalid") || errorLower.includes("undeliverable")) {
      await recordBounce(selectedInbox.id);
      trackBounceForKillSwitch();
    }
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "email",
      attemptNumber,
      status: "failed",
      subject,
      body,
      error: err.message,
      sentAt: new Date(),
    });
    return false;
  }
}

async function executeSmsAction(lead: SdrLeadState): Promise<boolean> {
  if (!featureFlags.SMS_ENABLED) {
    console.log("[SDR Orchestrator] SMS_ENABLED=false, skipping SMS send");
    return false;
  }

  if (!canSendSms()) {
    console.log(`[SDR Orchestrator] SMS daily limit reached (${dailyCounters.smsSent}/${SMS_DAILY_LIMIT})`);
    return false;
  }

  if (isQuietHours()) {
    console.log("[SDR Orchestrator] Quiet hours, deferring SMS");
    return false;
  }

  if (!isGhlConfigured()) {
    console.log("[SDR Orchestrator] GHL not configured, skipping SMS send");
    return false;
  }

  if (lead.optedOutSms || !lead.consentSms) {
    console.log(`[SDR Orchestrator] Lead ${lead.id} has not consented to SMS or opted out`);
    return false;
  }

  const toPhone = lead.ownerPhone || lead.phone;
  if (!toPhone) return false;

  const attemptNumber = (lead.smsAttempts || 0) + 1;
  const templateIndex = Math.min(attemptNumber - 1, 1);

  let body: string = "";

  let usedProcessorSms = false;
  if (attemptNumber === 1 && lead.businessId) {
    try {
      const signals = await getProcessorSignals(lead.businessId);
      const highConf = signals.filter(s => (s.confidenceScore || 0) >= 0.70);
      if (highConf.length > 0) {
        const topSignal = highConf.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))[0];
        const processorSmsTemplates: Record<string, string> = {
          Square: "Hi {{first_name}}, noticed {{company_name}} uses Square. Many {{vertical}} businesses save significantly by switching from flat-rate to custom processing. Free rate comparison? Reply YES {{link}}",
          Stripe: "Hi {{first_name}}, {{company_name}} on Stripe? Custom processing often beats standard Stripe rates for {{vertical}} businesses. Want to see your numbers? Reply YES {{link}}",
          Toast: "Hi {{first_name}}, we help restaurants like {{company_name}} optimize what Toast charges for processing. Quick comparison? Reply YES {{link}}",
          Clover: "Hi {{first_name}}, {{company_name}} using Clover? You can keep your hardware and often get better rates. Free review: Reply YES {{link}}",
          PayPal: "Hi {{first_name}}, {{company_name}} accepting PayPal? A dedicated merchant account usually means lower fees and faster funding. See how much: Reply YES {{link}}",
          Shopify: "Hi {{first_name}}, {{company_name}} on Shopify Payments? Many merchants save by switching processing while keeping Shopify. Check your savings: Reply YES {{link}}",
        };
        const smsTemplate = processorSmsTemplates[topSignal.vendorName];
        if (smsTemplate) {
          body = personalizeTemplate(smsTemplate, lead);
          usedProcessorSms = true;
        }
      }
    } catch (err) {
      console.error("[SDR Orchestrator] Failed to load processor SMS template:", err);
    }
  }

  if (!usedProcessorSms) {
    const smsVerticalKey = normalizeVerticalKey(lead.vertical);
    const templates = SMS_TEMPLATES[smsVerticalKey] || SMS_TEMPLATES[lead.vertical || ""] || SMS_TEMPLATES.default;
    const template = templates[templateIndex] || templates[templates.length - 1];
    body = personalizeTemplate(template, lead);
  }

  if (!lead.contactId) {
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: "failed",
      body,
      error: "No contactId for GHL",
      sentAt: new Date(),
    });
    return false;
  }

  try {
    const result = await sendGhlSms({
      contactId: lead.contactId,
      body,
    });

    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: result.success ? "sent" : "failed",
      ghlMessageId: result.messageId || null,
      body,
      error: result.error || null,
      sentAt: new Date(),
    });

    if (result.success) {
      dailyCounters.smsSent++;
      await db.update(sdrLeadState).set({
        smsAttempts: attemptNumber,
        lastSmsAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      if (lead.contactId && lead.ghlContactId) {
        const smsVertKey = normalizeVerticalKey(lead.vertical);
        const smsResolvedSeqName = resolveVerticalSequenceName(smsVertKey, lead.vertical);
        const [smsTaggingMerchant] = lead.merchantId
          ? await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, lead.merchantId))
          : [];
        const smsCanonicalVertical = getCanonicalLeadVertical({
          subvertical: smsTaggingMerchant?.subvertical,
          vertical: smsTaggingMerchant?.vertical ?? lead.vertical,
        });
        tagContactForInboxOrganization({
          contactId: lead.contactId,
          ghlContactId: lead.ghlContactId,
          sequenceName: smsResolvedSeqName,
          vertical: smsCanonicalVertical,
          stage: "active",
        }).catch(err => console.warn("[SDR Orchestrator] SMS inbox tagging failed:", err));
      }
    }

    return result.success;
  } catch (err: any) {
    await logChannelAttempt({
      leadStateId: lead.id,
      channel: "sms",
      attemptNumber,
      status: "failed",
      body,
      error: err.message,
      sentAt: new Date(),
    });
    return false;
  }
}

async function executeAction(lead: SdrLeadState, actionType: string, actionParams?: Record<string, any>): Promise<boolean> {
  const channelMap: Record<string, "sms" | "email" | "call"> = {
    send_email: "email",
    send_sms: "sms",
    schedule_call: "call",
  };
  const complianceChannel = channelMap[actionType];
  if (complianceChannel && lead.merchantId) {
    try {
      const { checkAndLogCompliance } = await import("./compliance-engine");
      const complianceResult = await checkAndLogCompliance(lead.merchantId, complianceChannel);
      if (!complianceResult.allowed) {
        console.log(`[SDR Orchestrator] Compliance blocked ${actionType} for lead ${lead.id}: ${complianceResult.reason}`);
        await logLeadEvent(lead.id, {
          eventType: "compliance_blocked",
          actionType,
          channel: complianceChannel,
          decisionReason: `Compliance blocked: ${complianceResult.reason}`,
        });
        if (complianceResult.nextValidWindow) {
          await db.update(sdrLeadState).set({
            nextActionAt: complianceResult.nextValidWindow,
            decisionReason: `Deferred to ${complianceResult.nextValidWindow.toISOString()}: ${complianceResult.reason}`,
            updatedAt: new Date(),
          }).where(eq(sdrLeadState.id, lead.id));
        }
        return false;
      }
    } catch (err: unknown) {
      console.error(`[SDR Orchestrator] Compliance check failed for lead ${lead.id}, failing closed:`, err);
      return false;
    }
  }

  switch (actionType) {
    case "send_email":
      return executeEmailAction(lead, actionParams?.strongerCta);

    case "send_sms":
      return executeSmsAction(lead);

    case "schedule_call":
      if (!featureFlags.VOICE_AI_ENABLED) {
        console.log("[SDR Orchestrator] VOICE_AI_ENABLED=false, skipping voice call");
        return false;
      }
      if (!canMakeCall()) {
        console.log(`[SDR Orchestrator] Call daily limit reached (${dailyCounters.callsMade}/${CALL_DAILY_LIMIT})`);
        return false;
      }
      dailyCounters.callsMade++;

      const resolvedScript = resolveVoiceScriptForLead(lead);
      const voicePayload = resolvedScript ? buildGhlVoicePayload(resolvedScript, lead, "a Liberty Bancard specialist") : null;

      await logLeadEvent(lead.id, {
        eventType: "call_scheduled",
        actionType: "schedule_call",
        channel: "call",
        decisionReason: `Call scheduled (attempt ${(lead.callAttempts || 0) + 1})${resolvedScript ? ` [voice script: ${resolvedScript.verticalKey}]` : " [generic]"}`,
        metadata: voicePayload ? { voiceScript: resolvedScript!.verticalKey, ghlPayload: voicePayload } : undefined,
      });
      await db.update(sdrLeadState).set({
        callAttempts: (lead.callAttempts || 0) + 1,
        lastCallAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
      return true;

    case "enrich":
    case "score":
    case "classify_intent":
    case "generate_proposal":
    case "send_reminder":
    case "follow_up_statement":
    case "nurture_email":
      return true;

    default:
      console.log(`[SDR Orchestrator] Unknown action type: ${actionType}`);
      return true;
  }
}

const INBOUND_EVENT_TYPES = ["reply_received", "email_opened", "call_interested", "call_booked", "sms_reply_received"];

async function getLatestInboundEvent(leadId: number): Promise<{ eventType: string; metadata?: any } | undefined> {
  const events = await db.select()
    .from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.leadStateId, leadId),
      sql`${sdrLeadEvents.eventType} IN (${sql.join(INBOUND_EVENT_TYPES.map(e => sql`${e}`), sql`, `)})`
    ))
    .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
    .limit(1);
  return events[0] || undefined;
}

function isImmediateAction(actionType: string): boolean {
  return ["send_email", "send_sms", "schedule_call"].includes(actionType);
}

async function processLead(lead: SdrLeadState): Promise<void> {
  try {
    await attachAgentName(lead);

    if (lead.stage === "DISCOVERED" || lead.stage === "ENRICHED" || lead.stage === "DEDUPED" || lead.stage === "CLASSIFIED") {
      const processorData = await getLeadProcessorData(lead.businessId);
      const growthData = await getLeadGrowthData(lead.businessId, lead);
      const scores = scoreLeadFull(lead, processorData, growthData);
      await db.update(sdrLeadState).set({
        fitScore: scores.fitScore,
        revenueScore: scores.revenueScore,
        reachabilityScore: scores.reachabilityScore,
        processorScore: scores.processorScore,
        growthScore: scores.growthScore,
        priorityScore: scores.priorityScore,
        priorityBucket: scores.priorityBucket,
        scoreBreakdown: scores.breakdown,
        lastScoredAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      lead = {
        ...lead,
        fitScore: scores.fitScore,
        revenueScore: scores.revenueScore,
        reachabilityScore: scores.reachabilityScore,
        processorScore: scores.processorScore,
        growthScore: scores.growthScore,
        priorityScore: scores.priorityScore,
        priorityBucket: scores.priorityBucket,
      };
    }

    const latestInboundEvent = await getLatestInboundEvent(lead.id);

    const decision = decideNextAction(lead, latestInboundEvent);
    if (!decision) {
      await db.update(sdrLeadState).set({
        nextActionType: null,
        nextActionAt: null,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));
      return;
    }

    const allowedTransitions = getAllowedTransitions(lead.stage);
    const stageChanging = decision.nextStage !== lead.stage;

    if (stageChanging && !allowedTransitions.includes(decision.nextStage)) {
      console.warn(`[SDR Orchestrator] Invalid transition ${lead.stage} → ${decision.nextStage} for lead ${lead.id}`);
      return;
    }

    const shouldExecuteNow = isImmediateAction(decision.nextActionType) && decision.nextActionAt.getTime() <= Date.now();

    if (isImmediateAction(decision.nextActionType) && !shouldExecuteNow) {
      await db.update(sdrLeadState).set({
        stage: decision.nextStage,
        nextActionType: decision.nextActionType,
        nextActionAt: decision.nextActionAt,
        decisionReason: decision.decisionReason,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      await logLeadEvent(lead.id, {
        eventType: stageChanging ? "stage_changed" : "action_scheduled",
        fromStage: lead.stage,
        toStage: decision.nextStage,
        actionType: decision.nextActionType,
        decisionReason: `${decision.decisionReason} (scheduled for ${decision.nextActionAt.toISOString()})`,
      });
      return;
    }

    if (shouldExecuteNow) {
      if (decision.nextActionType === "send_email") {
        const enrollInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
        if (!enrollInbox) {
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
          try {
            await storage.createAuditLog({
              action: "DAILY_CAP_REACHED",
              entityType: "sdr_lead",
              entityId: lead.id,
              details: `Enrollment deferred to next day — all inboxes at daily cap (lead ${lead.id}, merchantId: ${lead.merchantId})`,
            });
          } catch { /* non-fatal */ }
          await db.update(sdrLeadState).set({
            nextActionAt: tomorrow,
            decisionReason: "Enrollment deferred to next day: all sending identities at daily cap",
            updatedAt: new Date(),
          }).where(eq(sdrLeadState.id, lead.id));
          return;
        }
      }

      const actionSuccess = await executeAction(lead, decision.nextActionType, decision.actionParams);

      if (!actionSuccess) {
        const deferTime = new Date(Date.now() + 60 * 60 * 1000);
        await db.update(sdrLeadState).set({
          nextActionAt: deferTime,
          decisionReason: `Action deferred: ${decision.decisionReason} (limit reached or failed)`,
          updatedAt: new Date(),
        }).where(eq(sdrLeadState.id, lead.id));
        return;
      }
    }

    const nextDecision = shouldExecuteNow ? decideNextAction({ ...lead, stage: decision.nextStage, emailAttempts: (lead.emailAttempts || 0) + (decision.nextActionType === "send_email" ? 1 : 0), smsAttempts: (lead.smsAttempts || 0) + (decision.nextActionType === "send_sms" ? 1 : 0), callAttempts: (lead.callAttempts || 0) + (decision.nextActionType === "schedule_call" ? 1 : 0) }) : null;

    await db.update(sdrLeadState).set({
      stage: decision.nextStage,
      nextActionType: nextDecision?.nextActionType || decision.nextActionType,
      nextActionAt: nextDecision?.nextActionAt || decision.nextActionAt,
      decisionReason: decision.decisionReason,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, lead.id));

    await logLeadEvent(lead.id, {
      eventType: stageChanging ? "stage_changed" : "action_executed",
      fromStage: lead.stage,
      toStage: decision.nextStage,
      actionType: decision.nextActionType,
      decisionReason: decision.decisionReason,
    });

  } catch (err) {
    console.error(`[SDR Orchestrator] Error processing lead ${lead.id}:`, err);
    await logLeadEvent(lead.id, {
      eventType: "processing_error",
      decisionReason: `Error: ${(err as Error).message}`,
    });
  }
}

export async function sweepLeads(): Promise<{ processed: number; errors: number; reviewMode?: boolean; skippedSends?: number }> {
  if (isSweeping) {
    console.log("[SDR Orchestrator] Sweep already in progress, skipping");
    return { processed: 0, errors: 0 };
  }

  if (globalPaused) {
    console.log(`[SDR Orchestrator] Globally paused (${globalPauseReason}), skipping sweep`);
    return { processed: 0, errors: 0 };
  }

  const reviewMode = featureFlags.ORCHESTRATOR_REVIEW_MODE;
  const batchSize = featureFlags.ORCHESTRATOR_BATCH_SIZE;

  isSweeping = true;
  let processed = 0;
  let errors = 0;
  let skippedSends = 0;

  try {
    resetDailyCountersIfNeeded();

    const now = new Date();
    const dueLeads = await db.select()
      .from(sdrLeadState)
      .where(
        and(
          lte(sdrLeadState.nextActionAt, now),
          sql`${sdrLeadState.stage} NOT IN ('DEAD', 'CONVERTED')`,
        )
      )
      .orderBy(sql`COALESCE(${sdrLeadState.businessId}, 0), ${sdrLeadState.priorityScore} DESC NULLS LAST`)
      .limit(batchSize);

    console.log(`[SDR Orchestrator] Found ${dueLeads.length} leads due for processing (batch=${batchSize}, reviewMode=${reviewMode})`);

    const processedBusinessIds = new Set<number>();
    for (const lead of dueLeads) {
      if (globalPaused) {
        console.log("[SDR Orchestrator] Global pause triggered mid-sweep, stopping");
        break;
      }
      try {
        if (lead.pausedUntil && new Date(lead.pausedUntil) > now) {
          continue;
        }
        if (lead.businessId) {
          if (processedBusinessIds.has(lead.businessId)) {
            continue;
          }
          processedBusinessIds.add(lead.businessId);
        }
        if (reviewMode) {
          console.log(`[SDR Orchestrator][REVIEW] Would process lead ${lead.id} (${lead.companyName || "unknown"}, stage=${lead.stage}, next=${lead.nextActionType})`);
          skippedSends++;
        } else {
          await processLead(lead);
        }
        processed++;
      } catch (err) {
        errors++;
        console.error(`[SDR Orchestrator] Failed to process lead ${lead.id} (business ${lead.businessId || "N/A"}):`, err);
      }
    }

    lastSweepTime = new Date();
    lastSweepErrors = errors;
    console.log(`[SDR Orchestrator] Sweep complete: ${processed} processed, ${errors} errors${reviewMode ? `, ${skippedSends} sends skipped (review mode)` : ""}`);
  } catch (err) {
    console.error("[SDR Orchestrator] Sweep failed:", err);
  } finally {
    isSweeping = false;
  }

  return { processed, errors, reviewMode, skippedSends };
}

export function startOrchestrator() {
  if (!featureFlags.ORCHESTRATOR_ENABLED) {
    console.log("[SDR Orchestrator] ORCHESTRATOR_ENABLED=false, refusing to start");
    return;
  }

  if (sweepInterval) {
    console.log("[SDR Orchestrator] Already running");
    return;
  }

  console.log(`[SDR Orchestrator] Starting sweep every ${ORCHESTRATOR_SWEEP_MINUTES} minutes (batch=${featureFlags.ORCHESTRATOR_BATCH_SIZE}, reviewMode=${featureFlags.ORCHESTRATOR_REVIEW_MODE})`);
  sweepInterval = setInterval(async () => {
    try {
      await sweepLeads();
    } catch (err) {
      console.error("[SDR Orchestrator] Sweep error:", err);
    }
  }, ORCHESTRATOR_SWEEP_MINUTES * 60 * 1000);

  setTimeout(() => sweepLeads().catch(err => console.error("[SDR Orchestrator] Initial sweep error:", err)), 10000);
}

export function stopOrchestrator() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log("[SDR Orchestrator] Stopped");
  }
}

export function isOrchestratorRunning(): boolean {
  return sweepInterval !== null;
}

export function getDailyLimits() {
  resetDailyCountersIfNeeded();
  return {
    email: { sent: dailyCounters.emailsSent, limit: EMAIL_DAILY_LIMIT },
    sms: { sent: dailyCounters.smsSent, limit: SMS_DAILY_LIMIT },
    call: { made: dailyCounters.callsMade, limit: CALL_DAILY_LIMIT },
    date: dailyCounters.date,
  };
}

export async function bridgeContactsToSdr(options?: { limit?: number; contactIds?: number[] }): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0;
  let skipped = 0;
  let errorCount = 0;

  try {
    const { data: allContacts } = await storage.getContacts({ limit: 500 });
    let contactsToProcess = allContacts;

    if (options?.contactIds && options.contactIds.length > 0) {
      contactsToProcess = allContacts.filter(c => options.contactIds!.includes(c.id));
    }

    if (options?.limit) {
      contactsToProcess = contactsToProcess.slice(0, options.limit);
    }

    const existingLeads = await db.select({ contactId: sdrLeadState.contactId, businessId: sdrLeadState.businessId })
      .from(sdrLeadState)
      .where(sql`${sdrLeadState.contactId} IS NOT NULL`);
    const existingContactIds = new Set(existingLeads.map(l => l.contactId));
    const existingBusinessIds = new Set(existingLeads.filter(l => l.businessId).map(l => l.businessId!));

    for (const contact of contactsToProcess) {
      if (existingContactIds.has(contact.id)) {
        skipped++;
        continue;
      }
      if (contact.businessId && existingBusinessIds.has(contact.businessId)) {
        skipped++;
        continue;
      }

      try {
        let resolvedBusinessId = contact.businessId || null;
        const businessName = contact.companyName || `${contact.firstName} ${contact.lastName}`.trim();
        if (!resolvedBusinessId && businessName && businessName !== "Unknown") {
          try {
            const bizResult = await ingestBusiness({
              name: businessName,
              website: contact.website,
              phone: contact.phone,
              email: contact.email,
              address: contact.address,
              city: contact.city,
              state: contact.state,
              vertical: contact.vertical,
              industryPrimary: contact.industry,
              facebookUrl: contact.facebookUrl,
              sourceType: contact.leadSource || "manual_upload",
              sourceLabel: `sdr_bridge_${contact.id}`,
              contactId: contact.id,
            });
            resolvedBusinessId = bizResult.businessId;
            const [updatedContact] = await db.update(contacts)
              .set({ businessId: resolvedBusinessId })
              .where(eq(contacts.id, contact.id))
              .returning();
            const { auditChange } = await import("../../services/audit-change");
            auditChange({ actorType: "system", action: "contact_business_linked",
              entityType: "contact", entityId: contact.id,
              before: contact as unknown as Record<string, unknown>,
              after: (updatedContact ?? contact) as unknown as Record<string, unknown> }).catch(() => {});
            if (existingBusinessIds.has(resolvedBusinessId!)) {
              skipped++;
              continue;
            }
            existingBusinessIds.add(resolvedBusinessId!);
          } catch (bizErr) {
            console.warn(`[SDR Bridge] Business ingest failed for contact ${contact.id}:`, bizErr);
          }
        }

        const deals = await storage.getDealsByContact(contact.id);
        const primaryDeal = deals[0] || null;

        const fitScore = contact.revPotentialScore || 0;
        const revenueScore = contact.switchabilityScore || 0;
        const reachabilityScore = contact.uwConfidenceScore || 0;
        const totalOldScore = contact.leadScore || 0;

        let priorityBucket: "A" | "B" | "C" | "nurture" = "C";
        if (totalOldScore >= 70) priorityBucket = "A";
        else if (totalOldScore >= 45) priorityBucket = "B";
        else if (totalOldScore >= 20) priorityBucket = "C";
        else priorityBucket = "nurture";

        const stage = contact.doNotContact ? "DEAD" :
          totalOldScore >= 45 ? "QUALIFIED" :
          totalOldScore >= 20 ? "CLASSIFIED" : "DISCOVERED";

        const [merchant] = await db.insert(sdrMerchants).values({
          businessName,
          website: contact.website || null,
          mainPhone: contact.phone || null,
          mainEmail: contact.email || null,
          address: contact.address || null,
          city: contact.city || null,
          state: contact.state || null,
          vertical: contact.vertical || null,
          source: "contact_bridge",
          sourceRef: `contact_${contact.id}`,
          businessId: resolvedBusinessId,
        }).returning();

        await db.insert(sdrLeadState).values({
          merchantId: merchant.id,
          businessId: resolvedBusinessId,
          contactId: contact.id,
          companyName: contact.companyName || null,
          email: contact.email || null,
          phone: contact.phone || null,
          website: contact.website || null,
          vertical: contact.vertical || null,
          city: contact.city || null,
          state: contact.state || null,
          stage,
          fitScore: Math.min(100, fitScore * 3),
          revenueScore: Math.min(100, revenueScore * 3),
          reachabilityScore: Math.min(100, reachabilityScore * 3),
          priorityScore: totalOldScore,
          priorityBucket,
          consentEmail: contact.consentEmail ?? true,
          consentSms: contact.consentSms ?? false,
          consentCall: false,
          optedOutEmail: false,
          optedOutSms: false,
          ghlContactId: contact.ghlContactId || null,
          ownerName: contact.firstName && contact.lastName ? `${contact.firstName} ${contact.lastName}` : null,
          ownerEmail: contact.email || null,
          ownerPhone: contact.phone || null,
          locationCount: contact.locationCount || 1,
          estimatedVolume: contact.monthlyVolume || contact.estimatedProcessingVolume || null,
          estimatedTicketSize: contact.avgTicket || null,
          sourceType: "import",
          sourceId: `contact_${contact.id}`,
          nextActionType: stage === "DEAD" ? null : "score",
          nextActionAt: stage === "DEAD" ? null : new Date(),
        });

        imported++;
      } catch (err) {
        errorCount++;
        console.error(`[SDR Bridge] Failed to import contact ${contact.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[SDR Bridge] Fatal error:", err);
  }

  return { imported, skipped, errors: errorCount };
}

export async function getSdrDashboardStats() {
  try {
    const allLeads = await db.select().from(sdrLeadState);

    const stageCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    let totalLeads = 0;

    for (const lead of allLeads) {
      totalLeads++;
      stageCounts[lead.stage] = (stageCounts[lead.stage] || 0) + 1;
      const bucket = lead.priorityBucket || "C";
      priorityCounts[bucket] = (priorityCounts[bucket] || 0) + 1;
    }

    return {
      totalLeads,
      stageCounts,
      priorityCounts,
      dailyLimits: getDailyLimits(),
      orchestratorRunning: isOrchestratorRunning(),
    };
  } catch (err) {
    console.error("[SDR Dashboard] Error:", err);
    return {
      totalLeads: 0,
      stageCounts: {},
      priorityCounts: {},
      dailyLimits: getDailyLimits(),
      orchestratorRunning: isOrchestratorRunning(),
    };
  }
}
