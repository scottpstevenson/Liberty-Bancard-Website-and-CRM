/**
 * Wave 1A — Backend Contactability Engine
 *
 * Single canonical permission gate for all outbound contact decisions.
 * Every automated send path must call evaluateContactability() before execution.
 *
 * Replit owns contactability truth. GHL executes; Replit decides.
 */

import { db } from "../db";
import { contacts, consentAuditLogs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { featureFlags } from "./feature-flags";
import {
  isWithinBusinessHours,
  getTimezoneFromState,
  getNextBusinessWindow,
} from "./sdr/voice-orchestrator";

export type ContactabilityChannel =
  | "email"
  | "manual_call"
  | "sms"
  | "voice_ai"
  | "ringless_vm";

export type ConsentTierValue =
  | "cold_no_consent"
  | "warm_no_pewc"
  | "pewc_full_automation"
  | "opted_out"
  | "do_not_contact";

export type LifecycleStageValue =
  | "prospect"
  | "lead"
  | "analysis_requested"
  | "statement_uploaded"
  | "call_booked"
  | "proposal_sent"
  | "verbal_commit"
  | "live_merchant"
  | "retained"
  | "referred"
  | "closed_lost"
  | "do_not_contact";

export type SourceCategoryValue =
  | "scraped"
  | "inbound"
  | "referral"
  | "partner"
  | "merchant"
  | "manual_import"
  | "ghl_import"
  | "unknown";

export interface ContactabilityInput {
  contactId: number;
  channel: ContactabilityChannel;
  campaignType?: string;
  leadSource?: string;
  sourceCategory?: string;
  state?: string;
  currentTime?: Date;
  mode: "enforcement" | "dryRun";
  sdrMerchantId?: number;
}

export interface ContactabilityResult {
  allowed: boolean;
  channel: ContactabilityChannel;
  reason: string;
  requiredConsent: string | null;
  complianceTier: string;
  consentTier: string;
  lifecycleStage: string;
  leadSource: string | null;
  sourceCategory: string | null;
  allowedChannels: string[];
  blockedChannels: Array<{ channel: string; reason: string }>;
  nextBestCompliantAction: string | null;
  rateLimitStatus: "not_evaluated" | "within_limit" | "limit_reached";
  ghlPermissionPayload: {
    lb_email_allowed: boolean;
    lb_manual_call_allowed: boolean;
    lb_sms_allowed: boolean;
    lb_voice_ai_allowed: boolean;
    lb_ringless_vm_allowed: boolean;
    lb_channel_block_reason: string | null;
    lb_next_best_action: string | null;
  };
  auditLogPayload: object;
}

const STRICT_STATE_CONSENT_REQUIRED = (
  process.env.STRICT_STATE_CONSENT_REQUIRED || "FL"
)
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const AUTOMATED_CHANNELS: ContactabilityChannel[] = [
  "email",
  "sms",
  "voice_ai",
  "ringless_vm",
];

function isAutomatedChannel(ch: ContactabilityChannel): boolean {
  return AUTOMATED_CHANNELS.includes(ch);
}

function getComplianceTier(
  consentTier: string,
  state: string | null | undefined
): string {
  const s = (state || "").toUpperCase();
  if (STRICT_STATE_CONSENT_REQUIRED.includes(s)) {
    return "florida_mini_tcpa";
  }
  if (consentTier === "pewc_full_automation") return "pewc";
  if (consentTier === "warm_no_pewc" || consentTier === "cold_no_consent")
    return "tcpa_cold";
  if (consentTier === "opted_out" || consentTier === "do_not_contact")
    return "suppressed";
  return "unknown";
}

function getNextBestCompliantAction(
  channel: ContactabilityChannel,
  consentTier: string,
  doNotContact: boolean,
  doNotAutoContact: boolean
): string | null {
  if (doNotContact) return null;
  if (channel === "sms" || channel === "voice_ai" || channel === "ringless_vm") {
    if (consentTier !== "pewc_full_automation") {
      return "Obtain PEWC before automated phone/SMS outreach; use email or create a manual call task instead.";
    }
  }
  if (doNotAutoContact) {
    return "Create a manual call task — automated outreach is blocked; a human rep may still reach out.";
  }
  if (channel === "email") {
    return "Review email status and opt-in; update consent if contact re-engages.";
  }
  return null;
}

async function hasPewcEvidence(contactId: number): Promise<boolean> {
  const logs = await db
    .select({
      consentType: consentAuditLogs.consentType,
      consentedPhone: consentAuditLogs.consentedPhone,
      disclosureVersion: consentAuditLogs.disclosureVersion,
    })
    .from(consentAuditLogs)
    .where(
      and(
        eq(consentAuditLogs.contactId, contactId),
        eq(consentAuditLogs.consented, true)
      )
    )
    .orderBy(desc(consentAuditLogs.createdAt))
    .limit(20);

  return logs.some(
    (l) =>
      l.consentType === "express_written" &&
      l.consentedPhone != null &&
      l.disclosureVersion != null
  );
}

/**
 * Derive a conservative consent tier from contact fields.
 *
 * @param contact        Contact fields (synchronous input)
 * @param pewcEvidenceVerified  Pass `true` when the caller has already confirmed that
 *                       verified PEWC audit evidence (express_written consent with
 *                       consentedPhone + disclosureVersion) exists for this contact.
 *                       When true, upgrades the tier to pewc_full_automation regardless
 *                       of source-category heuristics — PEWC evidence is authoritative.
 */
export function deriveConsentTier(
  contact: Pick<
    typeof contacts.$inferSelect,
    | "doNotContact"
    | "smsStatus"
    | "emailStatus"
    | "consentTier"
    | "leadSource"
    | "sourceCategory"
    | "consentSms"
    | "emailOptInAt"
  >,
  pewcEvidenceVerified?: boolean
): ConsentTierValue {
  if (contact.doNotContact) return "do_not_contact";

  if (
    contact.smsStatus === "opted_out" ||
    contact.emailStatus === "opted_out"
  ) {
    return "opted_out";
  }

  // Verified PEWC evidence takes priority over all source-category heuristics
  if (pewcEvidenceVerified === true) return "pewc_full_automation";

  const existingTier = contact.consentTier as ConsentTierValue | undefined;
  if (existingTier === "pewc_full_automation") return "pewc_full_automation";

  const src = (contact.sourceCategory || "").toLowerCase();
  const lead = (contact.leadSource || "").toLowerCase();

  if (src === "scraped" || src === "ghl_import" || src === "manual_import") {
    return "cold_no_consent";
  }

  if (src === "inbound" || src === "referral" || src === "partner") {
    return "warm_no_pewc";
  }

  if (lead === "website" || lead === "organic" || lead === "referral") {
    return "warm_no_pewc";
  }

  if (
    lead === "sunbiz" ||
    lead === "scrape" ||
    lead === "import" ||
    lead === "outscraper" ||
    lead === "apollo"
  ) {
    return "cold_no_consent";
  }

  return "cold_no_consent";
}

async function writeAuditLog(
  contactId: number,
  channel: ContactabilityChannel,
  result: Pick<
    ContactabilityResult,
    | "allowed"
    | "reason"
    | "consentTier"
    | "lifecycleStage"
    | "leadSource"
    | "sourceCategory"
    | "complianceTier"
    | "requiredConsent"
    | "rateLimitStatus"
  >,
  auditLogPayload: object
): Promise<void> {
  try {
    await db.insert(consentAuditLogs).values({
      contactId,
      channel,
      action: result.allowed ? "contactability_allowed" : "contactability_blocked",
      consented: result.allowed,
      consentType: result.allowed ? "contactability_check" : "contactability_blocked",
      source: "contactability_engine",
      details: {
        ...auditLogPayload,
        reason: result.reason,
        consentTier: result.consentTier,
        lifecycleStage: result.lifecycleStage,
        complianceTier: result.complianceTier,
        requiredConsent: result.requiredConsent,
        rateLimitStatus: result.rateLimitStatus,
      },
    });
  } catch (err) {
    console.error("[Contactability] Audit log write failed:", err);
  }
}

/**
 * evaluateContactability — The canonical 17-step permission gate.
 *
 * mode: 'enforcement' — used before actual sends; writes audit logs for automated channels
 * mode: 'dryRun'     — used by admin/dashboard reads; does NOT write audit logs
 */
export async function evaluateContactability(
  input: ContactabilityInput
): Promise<ContactabilityResult> {
  const {
    contactId,
    channel,
    campaignType,
    mode,
    sdrMerchantId,
  } = input;
  const currentTime = input.currentTime ?? new Date();

  const allChannels: ContactabilityChannel[] = [
    "email",
    "manual_call",
    "sms",
    "voice_ai",
    "ringless_vm",
  ];

  function blocked(
    reason: string,
    opts: {
      requiredConsent?: string;
      consentTier?: string;
      lifecycleStage?: string;
      leadSource?: string | null;
      sourceCategory?: string | null;
      allowedChannels?: string[];
      blockedChannels?: Array<{ channel: string; reason: string }>;
      nextBestCompliantAction?: string | null;
      phoneType?: string | null;
      timezone?: string | null;
      rateLimitStatus?: "not_evaluated" | "within_limit" | "limit_reached";
    } = {}
  ): ContactabilityResult {
    const ct = opts.consentTier ?? "unknown";
    const ls = opts.lifecycleStage ?? "unknown";
    const lsrc = opts.leadSource ?? null;
    const sc = opts.sourceCategory ?? null;
    const allowed = opts.allowedChannels ?? [];
    const blk = opts.blockedChannels ?? [];
    const nextBest = opts.nextBestCompliantAction ?? null;
    const complianceTier = getComplianceTier(ct, input.state);
    const rl = opts.rateLimitStatus ?? "not_evaluated";

    const auditLogPayload = {
      contactId,
      channel,
      allowed: false,
      reason,
      consentTier: ct,
      lifecycleStage: ls,
      leadSource: lsrc,
      sourceCategory: sc,
      campaignType: campaignType ?? null,
      featureFlagState: {
        SMS_ENABLED: featureFlags.SMS_ENABLED,
        VOICE_AI_ENABLED: featureFlags.VOICE_AI_ENABLED,
        RINGLESS_VM_ENABLED: featureFlags.RINGLESS_VM_ENABLED,
      },
      phoneType: opts.phoneType ?? null,
      timezone: opts.timezone ?? null,
      state: input.state ?? null,
      currentTime: currentTime.toISOString(),
      requiredConsent: opts.requiredConsent ?? null,
      complianceTier,
    };

    const result: ContactabilityResult = {
      allowed: false,
      channel,
      reason,
      requiredConsent: opts.requiredConsent ?? null,
      complianceTier,
      consentTier: ct,
      lifecycleStage: ls,
      leadSource: lsrc,
      sourceCategory: sc,
      allowedChannels: allowed,
      blockedChannels: [{ channel, reason }, ...blk],
      nextBestCompliantAction: nextBest,
      rateLimitStatus: rl,
      ghlPermissionPayload: {
        lb_email_allowed: allowed.includes("email"),
        lb_manual_call_allowed: allowed.includes("manual_call"),
        lb_sms_allowed: allowed.includes("sms"),
        lb_voice_ai_allowed: allowed.includes("voice_ai"),
        lb_ringless_vm_allowed: allowed.includes("ringless_vm"),
        lb_channel_block_reason: reason,
        lb_next_best_action: nextBest,
      },
      auditLogPayload,
    };

    if (mode === "enforcement" && isAutomatedChannel(channel)) {
      writeAuditLog(contactId, channel, result, auditLogPayload).catch(() => {});
    }

    return result;
  }

  function allowed(
    reason: string,
    opts: {
      consentTier?: string;
      lifecycleStage?: string;
      leadSource?: string | null;
      sourceCategory?: string | null;
      allowedChannels?: string[];
      phoneType?: string | null;
      timezone?: string | null;
      rateLimitStatus?: "not_evaluated" | "within_limit" | "limit_reached";
    } = {}
  ): ContactabilityResult {
    const ct = opts.consentTier ?? "unknown";
    const ls = opts.lifecycleStage ?? "unknown";
    const lsrc = opts.leadSource ?? null;
    const sc = opts.sourceCategory ?? null;
    const complianceTier = getComplianceTier(ct, input.state);
    const nextBest = getNextBestCompliantAction(channel, ct, false, false);
    const rl = opts.rateLimitStatus ?? "not_evaluated";

    const auditLogPayload = {
      contactId,
      channel,
      allowed: true,
      reason,
      consentTier: ct,
      lifecycleStage: ls,
      leadSource: lsrc,
      sourceCategory: sc,
      campaignType: campaignType ?? null,
      featureFlagState: {
        SMS_ENABLED: featureFlags.SMS_ENABLED,
        VOICE_AI_ENABLED: featureFlags.VOICE_AI_ENABLED,
        RINGLESS_VM_ENABLED: featureFlags.RINGLESS_VM_ENABLED,
      },
      phoneType: opts.phoneType ?? null,
      timezone: opts.timezone ?? null,
      state: input.state ?? null,
      currentTime: currentTime.toISOString(),
      requiredConsent: null,
      complianceTier,
    };

    const result: ContactabilityResult = {
      allowed: true,
      channel,
      reason,
      requiredConsent: null,
      complianceTier,
      consentTier: ct,
      lifecycleStage: ls,
      leadSource: lsrc,
      sourceCategory: sc,
      allowedChannels: opts.allowedChannels ?? [channel],
      blockedChannels: [],
      nextBestCompliantAction: nextBest,
      rateLimitStatus: rl,
      ghlPermissionPayload: {
        lb_email_allowed: true,
        lb_manual_call_allowed: true,
        lb_sms_allowed: ct === "pewc_full_automation" && featureFlags.SMS_ENABLED,
        lb_voice_ai_allowed: ct === "pewc_full_automation" && featureFlags.VOICE_AI_ENABLED,
        lb_ringless_vm_allowed: ct === "pewc_full_automation" && featureFlags.RINGLESS_VM_ENABLED,
        lb_channel_block_reason: null,
        lb_next_best_action: nextBest,
      },
      auditLogPayload,
    };

    if (mode === "enforcement" && isAutomatedChannel(channel)) {
      writeAuditLog(contactId, channel, result, auditLogPayload).catch(() => {});
    }

    return result;
  }

  // ── Step 1: Contact exists ─────────────────────────────────────────────
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) {
    return blocked("Contact not found");
  }

  // Pre-fetch PEWC evidence once — used for tier derivation AND step 12 verification.
  // Checked here so deriveConsentTier can receive the pre-computed result (avoids
  // a second DB round-trip at step 12 and ensures tier and evidence stay in sync).
  const pewcVerified = await hasPewcEvidence(contactId);

  const consentTier =
    pewcVerified && !contact.doNotContact &&
    contact.smsStatus !== "opted_out" && contact.emailStatus !== "opted_out"
      ? "pewc_full_automation"
      : contact.consentTier && contact.consentTier !== "cold_no_consent"
        ? contact.consentTier
        : deriveConsentTier(contact, pewcVerified);

  const lifecycleStage = contact.lifecycleStage ?? "prospect";
  const leadSource = contact.leadSource ?? null;
  const sourceCategory = contact.sourceCategory ?? null;
  const state = input.state ?? contact.state ?? null;
  const phoneType = contact.phoneType ?? "unknown";
  const timezone =
    contact.timezone ?? getTimezoneFromState(state, contact.city);

  const commonOpts = {
    consentTier,
    lifecycleStage,
    leadSource,
    sourceCategory,
  };

  // ── Step 2: doNotContact ──────────────────────────────────────────────
  if (contact.doNotContact) {
    return blocked("Contact is marked Do Not Contact", {
      ...commonOpts,
      consentTier: "do_not_contact",
      nextBestCompliantAction: null,
    });
  }

  // ── Step 3: doNotAutoContact ──────────────────────────────────────────
  // Blocks automated outreach and automated workflow enrollment.
  // Does NOT block manual_call task creation unless another rule also applies.
  if (contact.doNotAutoContact && channel !== "manual_call") {
    return blocked(
      "Contact is flagged Do Not Auto Contact — automated outreach blocked; create a manual call task instead",
      {
        ...commonOpts,
        allowedChannels: ["manual_call"],
        nextBestCompliantAction:
          "Create a manual call task — automated outreach is blocked for this contact.",
      }
    );
  }

  // ── Step 4: Global opt-out / suppression ─────────────────────────────
  if (
    consentTier === "opted_out" ||
    consentTier === "do_not_contact"
  ) {
    return blocked("Contact has globally opted out or is suppressed", {
      ...commonOpts,
      consentTier,
    });
  }

  // ── Step 5: Channel-specific opt-outs ────────────────────────────────
  if (
    channel === "email" &&
    (contact.emailStatus === "opted_out" || contact.emailStatus === "unsubscribed")
  ) {
    return blocked("Contact has unsubscribed from email", {
      ...commonOpts,
      allowedChannels: ["manual_call"],
    });
  }

  if (channel === "sms" && contact.smsStatus === "opted_out") {
    return blocked("Contact has sent STOP — SMS opt-out recorded", {
      ...commonOpts,
      allowedChannels: ["email", "manual_call"],
    });
  }

  if (
    (channel === "voice_ai" || channel === "ringless_vm") &&
    contact.smsStatus === "opted_out"
  ) {
    return blocked("Contact has opted out of automated phone contact", {
      ...commonOpts,
      allowedChannels: ["email", "manual_call"],
    });
  }

  // ── Step 6: Internal DNC ─────────────────────────────────────────────
  if (contact.dncReason && contact.dncReason.trim().length > 0) {
    const isCallDnc =
      channel === "voice_ai" ||
      channel === "ringless_vm" ||
      channel === "manual_call";
    if (isCallDnc) {
      return blocked(`DNC reason on file: ${contact.dncReason}`, {
        ...commonOpts,
        allowedChannels: ["email"],
      });
    }
  }

  // ── Step 7: consentTier ───────────────────────────────────────────────
  // warm_no_pewc or cold_no_consent cannot receive sms, voice_ai, ringless_vm
  if (
    (channel === "sms" || channel === "voice_ai" || channel === "ringless_vm") &&
    consentTier !== "pewc_full_automation"
  ) {
    return blocked(
      `${channel} requires prior express written consent (PEWC) — current tier: ${consentTier}`,
      {
        ...commonOpts,
        requiredConsent: "pewc_full_automation",
        allowedChannels: ["email", "manual_call"],
        nextBestCompliantAction:
          "Obtain PEWC before automated phone/SMS outreach; use email or create a manual call task instead.",
      }
    );
  }

  // ── Step 8: Lifecycle stage restrictions ─────────────────────────────
  if (lifecycleStage === "do_not_contact") {
    return blocked("Lifecycle stage is do_not_contact", {
      ...commonOpts,
      nextBestCompliantAction: null,
    });
  }

  // ── Step 9: Email status for email channel ───────────────────────────
  if (channel === "email") {
    if (
      contact.emailStatus === "bounced" ||
      contact.emailStatus === "invalid"
    ) {
      return blocked(
        `Email channel blocked — email status: ${contact.emailStatus}`,
        {
          ...commonOpts,
          allowedChannels: ["manual_call"],
        }
      );
    }
  }

  // ── Step 10: Phone validity / phoneType ──────────────────────────────
  const phoneChannels: ContactabilityChannel[] = [
    "sms",
    "voice_ai",
    "ringless_vm",
    "manual_call",
  ];
  if (phoneChannels.includes(channel)) {
    if (!contact.phone || contact.phone.trim().length < 7) {
      return blocked("No valid phone number on file", { ...commonOpts });
    }
    if (phoneType === "invalid") {
      return blocked("Phone number is marked invalid", { ...commonOpts });
    }
    if (
      (channel === "sms" || channel === "voice_ai" || channel === "ringless_vm") &&
      phoneType === "business_landline"
    ) {
      return blocked(
        "Automated phone outreach blocked — phone type is business landline; SMS and ATDS delivery unlikely",
        { ...commonOpts, allowedChannels: ["email", "manual_call"] }
      );
    }
  }

  // ── Step 11: SMS consent status ──────────────────────────────────────
  if (channel === "sms" && contact.smsStatus !== "active") {
    return blocked(`SMS status is '${contact.smsStatus}' — cannot send SMS`, {
      ...commonOpts,
      allowedChannels: ["email", "manual_call"],
    });
  }

  // ── Step 12: PEWC requirement ─────────────────────────────────────────
  // Already enforced at step 7; step 12 verifies the audit trail is intact.
  // Uses the pre-fetched `pewcVerified` result from the tier-derivation step
  // (no second DB round-trip needed).
  if (
    (channel === "sms" || channel === "voice_ai" || channel === "ringless_vm") &&
    consentTier === "pewc_full_automation"
  ) {
    if (!pewcVerified) {
      return blocked(
        "PEWC consent tier set but no verified audit evidence (consentedPhone + disclosureVersion) found — treating as warm_no_pewc",
        {
          ...commonOpts,
          consentTier: "warm_no_pewc",
          requiredConsent: "pewc_full_automation",
          allowedChannels: ["email", "manual_call"],
          nextBestCompliantAction:
            "Record PEWC evidence with consentedPhone and disclosureVersion before automated phone/SMS outreach.",
        }
      );
    }
  }

  // ── Step 13: Feature flag for requested channel ───────────────────────
  if (channel === "sms" && !featureFlags.SMS_ENABLED) {
    return blocked("SMS_ENABLED feature flag is off — SMS outreach disabled", {
      ...commonOpts,
      allowedChannels: ["email", "manual_call"],
    });
  }
  if (channel === "voice_ai" && !featureFlags.VOICE_AI_ENABLED) {
    return blocked(
      "VOICE_AI_ENABLED feature flag is off — AI voice outreach disabled",
      {
        ...commonOpts,
        allowedChannels: ["email", "manual_call"],
      }
    );
  }
  if (channel === "ringless_vm" && !featureFlags.RINGLESS_VM_ENABLED) {
    return blocked(
      "RINGLESS_VM_ENABLED feature flag is off — ringless voicemail disabled",
      {
        ...commonOpts,
        allowedChannels: ["email", "manual_call"],
      }
    );
  }

  // ── Step 14: Timezone / quiet hours ──────────────────────────────────
  // Phone-based channels and SMS must respect quiet hours (9 AM–5 PM local, no weekends/holidays).
  const quietHoursChannels: ContactabilityChannel[] = [
    "sms",
    "voice_ai",
    "ringless_vm",
    "manual_call",
  ];
  if (quietHoursChannels.includes(channel)) {
    const tz = timezone ?? "America/New_York";
    if (!isWithinBusinessHours(tz)) {
      return blocked(
        `Outside quiet hours (TCPA: 9 AM–5 PM local time in ${tz}, no weekends/holidays)`,
        {
          ...commonOpts,
          allowedChannels: ["email"],
        }
      );
    }
  }

  // ── Step 15: Florida-specific telephone solicitation risk rule ────────
  // For Florida contacts, automated SMS, AI voice, ringless voicemail, prerecorded/
  // artificial voice, or autodialed phone outreach must require PEWC.
  // Email and manual call tasks are NOT blocked solely because the contact is in Florida.
  const contactState = (state || "").toUpperCase();
  if (STRICT_STATE_CONSENT_REQUIRED.includes(contactState)) {
    if (
      channel === "sms" ||
      channel === "voice_ai" ||
      channel === "ringless_vm"
    ) {
      // At this point consentTier === 'pewc_full_automation' (enforced at step 7/12).
      // Double-check the Florida rule is satisfied by PEWC evidence already checked.
      // If we reach here, PEWC + evidence are confirmed — no additional block needed.
      // Just annotate the compliance tier for audit purposes.
    }
    // email and manual_call — not blocked by Florida rule alone. Continue.
  }

  // ── Step 16: Rate limits / sender limits ─────────────────────────────
  let rateLimitStatus: "not_evaluated" | "within_limit" | "limit_reached" =
    "not_evaluated";

  if (sdrMerchantId != null) {
    try {
      const { getDailyChannelCountForMerchant } = await import(
        "./sdr/compliance-engine"
      );
      const sdrChannel =
        channel === "email"
          ? "email"
          : channel === "sms"
          ? "sms"
          : channel === "voice_ai" || channel === "ringless_vm"
          ? "call"
          : null;

      if (sdrChannel) {
        const DAILY_SMS_LIMIT = parseInt(
          process.env.SDR_DAILY_SMS_LIMIT || "50",
          10
        );
        const DAILY_EMAIL_LIMIT = parseInt(
          process.env.SDR_DAILY_EMAIL_LIMIT || "200",
          10
        );
        const DAILY_CALL_LIMIT = parseInt(
          process.env.SDR_DAILY_CALL_LIMIT || "30",
          10
        );
        const limit =
          sdrChannel === "sms"
            ? DAILY_SMS_LIMIT
            : sdrChannel === "email"
            ? DAILY_EMAIL_LIMIT
            : DAILY_CALL_LIMIT;

        const count = await getDailyChannelCountForMerchant(
          sdrMerchantId,
          sdrChannel
        );
        if (count >= limit) {
          return blocked(
            `SDR daily ${sdrChannel} limit reached (${count}/${limit})`,
            {
              ...commonOpts,
              rateLimitStatus: "limit_reached",
              nextBestCompliantAction: `Daily ${sdrChannel} limit reached — retry tomorrow.`,
            }
          );
        }
        rateLimitStatus = "within_limit";
      }
    } catch (err) {
      console.warn("[Contactability] SDR rate limit check failed:", err);
      rateLimitStatus = "not_evaluated";
    }
  }

  // ── Step 17: Final allowed verdict ───────────────────────────────────
  return allowed("All compliance checks passed", {
    ...commonOpts,
    allowedChannels: [channel],
    phoneType,
    timezone,
    rateLimitStatus,
  });
}

/**
 * Evaluate all channels for a contact and return a full contactability matrix.
 * Used by the GET /api/contacts/:id/contactability endpoint (dryRun mode only).
 */
export async function evaluateAllChannels(
  contactId: number
): Promise<{
  results: Record<ContactabilityChannel, ContactabilityResult>;
  summary: {
    allowedChannels: string[];
    blockedChannels: Array<{ channel: string; reason: string }>;
    consentTier: string;
    lifecycleStage: string;
    leadSource: string | null;
    sourceCategory: string | null;
    nextBestCompliantAction: string | null;
    ghlPermissionPayload: ContactabilityResult["ghlPermissionPayload"];
  };
}> {
  const channels: ContactabilityChannel[] = [
    "email",
    "manual_call",
    "sms",
    "voice_ai",
    "ringless_vm",
  ];

  const results: Record<string, ContactabilityResult> = {};
  const allowedChannels: string[] = [];
  const blockedChannels: Array<{ channel: string; reason: string }> = [];

  for (const ch of channels) {
    const r = await evaluateContactability({
      contactId,
      channel: ch,
      mode: "dryRun",
    });
    results[ch] = r;
    if (r.allowed) {
      allowedChannels.push(ch);
    } else {
      blockedChannels.push({ channel: ch, reason: r.reason });
    }
  }

  const emailResult = results["email"];
  const nextBest =
    allowedChannels.length > 0
      ? null
      : emailResult?.nextBestCompliantAction ?? null;

  return {
    results: results as Record<ContactabilityChannel, ContactabilityResult>,
    summary: {
      allowedChannels,
      blockedChannels,
      consentTier: emailResult?.consentTier ?? "unknown",
      lifecycleStage: emailResult?.lifecycleStage ?? "unknown",
      leadSource: emailResult?.leadSource ?? null,
      sourceCategory: emailResult?.sourceCategory ?? null,
      nextBestCompliantAction: nextBest,
      ghlPermissionPayload: {
        lb_email_allowed: allowedChannels.includes("email"),
        lb_manual_call_allowed: allowedChannels.includes("manual_call"),
        lb_sms_allowed: allowedChannels.includes("sms"),
        lb_voice_ai_allowed: allowedChannels.includes("voice_ai"),
        lb_ringless_vm_allowed: allowedChannels.includes("ringless_vm"),
        lb_channel_block_reason:
          blockedChannels.length > 0 ? blockedChannels[0].reason : null,
        lb_next_best_action: nextBest,
      },
    },
  };
}
