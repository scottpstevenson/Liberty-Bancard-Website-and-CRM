/**
 * promotional-enrollment-eligibility.ts
 *
 * Centralized promotional-enrollment eligibility service.
 *
 * Exports:
 *  - evaluatePromotionalEnrollmentEligibility() — contact-level pre-queue gate
 *  - enqueuePromotionalEnrollment()             — durable enqueue with DB row
 *
 * Kill-line invariants:
 *  - Redis unavailability writes DB row with status="deferred_queue_unavailable" — no in-memory enrollment.
 *  - eligibility is evaluated ONCE per worker attempt, result passed via preEvaluated to autoEnrollFromTrigger.
 *  - Does NOT check leadScore, dataReadinessScore, or sequence-level dedup.
 *  - Opt-out reason "existing_opt_out_preserved_on_resubmission" used ONLY when opts.isResubmission===true.
 *  - "promotional-enrollment-eval" jobs go to ENRICHMENT queue, never sequences queue.
 */

import { db } from "../db";
import { contacts, promotionalEnrollmentJobs } from "@shared/schema";
import type {
  PromotionalEnrollmentJob,
  PromotionalEnrollmentJobStatus,
  PromotionalEligibilityReason,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  evaluateContactability,
  type ContactabilityChannel,
  type ContactabilityResult,
} from "./contactability";
import { getQueueManager } from "./queue-manager";

export type { PromotionalEligibilityReason };

export interface PromotionalEnrollmentEligibilityResult {
  eligible: boolean;
  reasonCodes: PromotionalEligibilityReason[];
  contactabilityByChannel: Partial<Record<ContactabilityChannel, ContactabilityResult>>;
}

export interface EnqueuePromotionalEnrollmentInput {
  contactId: number;
  triggerType: string;
  formType?: string;
  sourceEventId: string;
  isResubmission?: boolean;
}

export interface EnqueuePromotionalEnrollmentResult {
  status: "queued" | "blocked_prequeue" | "deferred_queue_unavailable" | "already_queued";
  jobId?: string;
  reasonCodes?: PromotionalEligibilityReason[];
}

const PROMO_CHANNELS: ContactabilityChannel[] = ["email", "sms", "voice_ai", "ringless_vm"];

/**
 * Minimum-quality pre-enrollment gate checks.
 *
 * These run BEFORE any contactability evaluation or sequence enrollment.
 * They block spam, disposable inboxes, and permanently bad email addresses
 * that should never enter any outreach sequence.
 */

// Basic RFC-5321 shape: something@something.something
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Known disposable / throwaway email providers.
// Conservative hand-curated list of high-volume spam domains. Sorted alphabetically.
// Add new domains here; duplicates are silently ignored by Set.
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "airmail.cc",
  "anonbox.net",
  "antispam24.de",
  "bccto.me",
  "burnermail.io",
  "byom.de",
  "chacuo.net",
  "crapmail.org",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "dispostable.com",
  "dodgeit.com",
  "emailondeck.com",
  "fakeinbox.com",
  "filzmail.com",
  "getairmail.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "itwasntme.co",
  "junk.to",
  "kasmail.com",
  "klzlk.com",
  "lazyinbox.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mailnull.com",
  "moakt.cc",
  "moakt.co",
  "moakt.com",
  "moakt.ws",
  "mt2009.com",
  "mt2014.com",
  "mt2015.com",
  "nospam.ze.tc",
  "objectmail.com",
  "ownmail.net",
  "pookmail.com",
  "rtrtr.com",
  "sharklasers.com",
  "shitmail.me",
  "spam4.me",
  "spamgourmet.com",
  "spamgourmet.net",
  "spamgourmet.org",
  "spaml.de",
  "spamspot.com",
  "spamthisplease.com",
  "tempail.com",
  "tempe-mail.com",
  "tempinbox.com",
  "tempmail.com",
  "tempr.email",
  "throwam.com",
  "throwaway.email",
  "throwam.com",
  "trashmail.at",
  "trashmail.com",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "trashmail.xyz",
  "trbvm.com",
  "trbvn.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "yopmail.org",
  "yopmail.pp.ua",
  "zoemail.org",
]);

/**
 * Email statuses that permanently disqualify a contact from promotional enrollment.
 *
 * Canonical policy (aligns with sequence-worker.ts bounce guard at line ~450):
 *  - "bounced"     — hard bounce; deliverability is permanently broken
 *  - "invalid"     — ZeroBounce or local validation found the address non-existent
 *  - "unsafe"      — ZeroBounce: spam trap, abuse address, or do-not-mail flag
 *  - "blocked"     — manually suppressed by an admin
 *
 * NOT included (intentional):
 *  - "unverified"  — ZeroBounce returned UNKNOWN; enrichment is still pending.
 *                    The sequence worker will trigger ZeroBounce when it processes
 *                    the first email step and re-evaluate then. Blocking here would
 *                    permanently suppress contacts before enrichment completes.
 *  - "unknown"     — Same reasoning as "unverified"; pass through to enrichment.
 *  - "active"      — Healthy; always allowed.
 *  - "opted_out" / "unsubscribed" — Handled by the opt-out tier check above and
 *                    by evaluateContactability(); not a hard block here.
 */
const BLOCKED_EMAIL_STATUSES = new Set(["blocked", "invalid", "bounced", "unsafe"]);

/**
 * Returns a block reason if the email fails minimum quality, or null if OK.
 * Does NOT throw — caller decides how to surface failures.
 */
function checkEmailQuality(
  email: string | null | undefined
): { blocked: true; reason: PromotionalEligibilityReason; detail: string } | null {
  if (!email || !email.trim()) {
    // No email — usable-channel check will catch this below; don't double-block.
    return null;
  }
  const addr = email.trim().toLowerCase();

  if (!EMAIL_FORMAT_RE.test(addr)) {
    return {
      blocked: true,
      reason: "invalid_email_format",
      detail: `Email '${addr}' failed format validation`,
    };
  }

  const domain = addr.split("@")[1] ?? "";
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      blocked: true,
      reason: "disposable_email_domain",
      detail: `Email domain '${domain}' is a known disposable provider`,
    };
  }

  return null;
}

/**
 * Contact-level pre-queue eligibility gate for promotional enrollment.
 *
 * Checks (in order, fail-fast):
 *   (a) contact exists
 *   (b) doNotContact === true
 *   (c) consentTier is opted_out or do_not_contact
 *   (d) at least one usable channel exists (email OR phone with PEWC)
 *
 * Then calls evaluateContactability() for each promotional channel and
 * returns the map as contactabilityByChannel for the worker to pass
 * into autoEnrollFromTrigger() (avoiding a redundant second round-trip).
 *
 * Does NOT check leadScore, dataReadinessScore, or sequence-level dedup.
 */
export async function evaluatePromotionalEnrollmentEligibility(
  contactId: number,
  triggerType: string,
  opts?: { isResubmission?: boolean }
): Promise<PromotionalEnrollmentEligibilityResult> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) {
    return {
      eligible: false,
      reasonCodes: ["contact_not_found"],
      contactabilityByChannel: {},
    };
  }

  if (contact.doNotContact) {
    return {
      eligible: false,
      reasonCodes: ["dnc"],
      contactabilityByChannel: {},
    };
  }

  const tier = contact.consentTier ?? "cold_no_consent";
  if (tier === "opted_out" || tier === "do_not_contact") {
    const reason: PromotionalEligibilityReason =
      opts?.isResubmission === true
        ? "existing_opt_out_preserved_on_resubmission"
        : "existing_opt_out";
    return {
      eligible: false,
      reasonCodes: [reason],
      contactabilityByChannel: {},
    };
  }

  // ── Minimum email quality gate ────────────────────────────────────────────
  // Run BEFORE any contactability evaluation so spam/junk contacts never reach
  // sequence enrollment audit logs.
  //
  // (a) Email format + disposable-domain check
  const emailQuality = checkEmailQuality(contact.email);
  if (emailQuality) {
    console.info(
      `[PromotionalEligibility] contact #${contactId} blocked — ${emailQuality.reason}: ${emailQuality.detail}`
    );
    return {
      eligible: false,
      reasonCodes: [emailQuality.reason],
      contactabilityByChannel: {},
    };
  }

  // (b) Permanently bad email status
  if (contact.email && BLOCKED_EMAIL_STATUSES.has(contact.emailStatus ?? "")) {
    console.info(
      `[PromotionalEligibility] contact #${contactId} blocked — email_status_blocked: emailStatus=${contact.emailStatus}`
    );
    return {
      eligible: false,
      reasonCodes: ["email_status_blocked"],
      contactabilityByChannel: {},
    };
  }

  const hasEmail = !!(contact.email && contact.email.trim());
  const hasPhone = !!(contact.phone && contact.phone.trim());
  const hasPewc = tier === "pewc_full_automation";

  if (!hasEmail && !(hasPhone && hasPewc)) {
    return {
      eligible: false,
      reasonCodes: ["no_usable_channel"],
      contactabilityByChannel: {},
    };
  }

  const contactabilityByChannel: Partial<Record<ContactabilityChannel, ContactabilityResult>> = {};
  let anyAllowed = false;

  for (const channel of PROMO_CHANNELS) {
    try {
      const result = await evaluateContactability({
        contactId,
        channel,
        campaignType: "promotional_enrollment",
        mode: "enforcement",
      });
      contactabilityByChannel[channel] = result;
      if (result.allowed) anyAllowed = true;
    } catch (err) {
      console.error(`[PromotionalEligibility] evaluateContactability(${channel}) error:`, err);
    }
  }

  if (!anyAllowed) {
    return {
      eligible: false,
      reasonCodes: ["no_usable_channel"],
      contactabilityByChannel,
    };
  }

  return {
    eligible: true,
    reasonCodes: ["eligible"],
    contactabilityByChannel,
  };
}

/**
 * Enqueue a promotional enrollment evaluation job.
 *
 * Steps:
 *  (a) UPSERT a DB row with status="pending" on source_event_id conflict.
 *      If a row already exists with status pending/processing, return already_queued.
 *  (b) Add "promotional-enrollment-eval" job to ENRICHMENT queue.
 *  (c) Update DB row with returned BullMQ jobId.
 *  (d) If getQueueManager() throws (Redis unavailable), set status="deferred_queue_unavailable"
 *      and return without any in-memory enrollment attempt.
 */
export async function enqueuePromotionalEnrollment(
  input: EnqueuePromotionalEnrollmentInput
): Promise<EnqueuePromotionalEnrollmentResult> {
  const { contactId, triggerType, formType, sourceEventId, isResubmission } = input;

  let dbRow: PromotionalEnrollmentJob | undefined;

  try {
    const existing = await db
      .select()
      .from(promotionalEnrollmentJobs)
      .where(eq(promotionalEnrollmentJobs.sourceEventId, sourceEventId))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      // Terminal states (enrolled, blocked, no_matching_sequence, already_enrolled, failed)
      // are idempotent — the event has been fully processed or deliberately rejected.
      // Only deferred_queue_unavailable rows are re-attempted (queue was down; retry when available).
      if (row.status !== "deferred_queue_unavailable") {
        return { status: "already_queued", jobId: row.jobId ?? undefined };
      }
      // Re-use the existing row for deferred retry
      dbRow = row;
    }

    if (!dbRow) {
      const [inserted] = await db
        .insert(promotionalEnrollmentJobs)
        .values({
          sourceEventId,
          contactId,
          triggerType,
          formType: formType ?? null,
          status: "pending",
          attempts: 0,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        const [recheck] = await db
          .select()
          .from(promotionalEnrollmentJobs)
          .where(eq(promotionalEnrollmentJobs.sourceEventId, sourceEventId))
          .limit(1);
        if (recheck && (recheck.status === "pending" || recheck.status === "processing")) {
          return { status: "already_queued", jobId: recheck.jobId ?? undefined };
        }
        dbRow = recheck;
      } else {
        dbRow = inserted;
      }
    }

    if (!dbRow) {
      console.error("[PromotionalEnrollment] Failed to insert or retrieve DB row for", sourceEventId);
      return { status: "deferred_queue_unavailable" };
    }

    const promotionalEnrollmentJobId = dbRow.id;

    try {
      const qm = await getQueueManager();
      const queue = qm.getQueue("enrichment");

      if (!queue) {
        await db
          .update(promotionalEnrollmentJobs)
          .set({ status: "deferred_queue_unavailable" })
          .where(eq(promotionalEnrollmentJobs.id, promotionalEnrollmentJobId));
        return { status: "deferred_queue_unavailable" };
      }

      const bullJobId = `promotional-enroll-${sourceEventId}`;
      await queue.add(
        "promotional-enrollment-eval",
        {
          promotionalEnrollmentJobId,
          contactId,
          triggerType,
          formType: formType ?? null,
          sourceEventId,
          isResubmission: isResubmission ?? false,
        },
        {
          jobId: bullJobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 10000 },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { count: 200 },
        }
      );

      await db
        .update(promotionalEnrollmentJobs)
        .set({ jobId: bullJobId })
        .where(eq(promotionalEnrollmentJobs.id, promotionalEnrollmentJobId));

      return { status: "queued", jobId: bullJobId };
    } catch (queueErr) {
      console.warn(
        "[PromotionalEnrollment] Queue unavailable — deferring enrollment for",
        sourceEventId,
        (queueErr as Error).message
      );
      await db
        .update(promotionalEnrollmentJobs)
        .set({ status: "deferred_queue_unavailable" })
        .where(eq(promotionalEnrollmentJobs.id, promotionalEnrollmentJobId));
      return { status: "deferred_queue_unavailable" };
    }
  } catch (err) {
    console.error("[PromotionalEnrollment] Unexpected error in enqueuePromotionalEnrollment:", err);
    return { status: "deferred_queue_unavailable" };
  }
}
