/**
 * VAS (Value-Added Service) Upsell Propensity Engine — Day 30
 *
 * Fires when the G. Go-Live Lifecycle workflow reaches the Day-30 milestone.
 * Maps each merchant's vertical → 1-2 targeted VAS sequences and creates
 * active enrollments (subject to the standard contactability gates in the
 * sequence worker).
 *
 * Suppression: if the merchant's deal has `vasUpsellSuppressedAt` set (toggled
 * by a rep from the portfolio page), the entire routine is skipped.
 *
 * Vertical routing (mirrors task spec):
 *   salon / spa / gym / fitness   → Recurring Billing
 *   restaurant / food / bar       → Omnichannel + Surcharge/Cash Discount
 *   medical / health / dental     → Recurring Billing
 *   retail / boutique             → Chargeback Defense + Surcharge/Cash Discount
 *   service / landscaping /
 *     construction / legal /
 *     contractor / plumbing /
 *     hvac / cleaning             → Text-to-Pay
 *   (no vertical / unknown)       → Text-to-Pay (safe default)
 */

import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Sequence name → canonical DB name mappings ─────────────────────────────
const SEQ_RECURRING_BILLING      = "13. Recurring Billing — Subscription Merchants";
const SEQ_TEXT_TO_PAY            = "14. Text-to-Pay & Payment Links";
const SEQ_OMNICHANNEL            = "15. Omnichannel — Online + In-Person";
const SEQ_SURCHARGE              = "9. Surcharge & Cash Discount — Compliance";
const SEQ_CHARGEBACK_DEFENSE     = "5. Chargeback Defense";

// ── Vertical → ordered list of sequence names ──────────────────────────────
const VERTICAL_SEQUENCE_MAP: Array<{ pattern: RegExp; sequences: string[] }> = [
  {
    pattern: /salon|spa|gym|fitness|beauty|nail|hair|barbershop|yoga|pilates/i,
    sequences: [SEQ_RECURRING_BILLING],
  },
  {
    pattern: /restaurant|food|cafe|coffee|bar|tavern|diner|bakery|catering|pizza|sushi/i,
    sequences: [SEQ_OMNICHANNEL, SEQ_SURCHARGE],
  },
  {
    pattern: /medical|health|dental|clinic|chiropractic|therapy|optom|pharmacy|veterinar/i,
    sequences: [SEQ_RECURRING_BILLING],
  },
  {
    pattern: /retail|boutique|shop|store|apparel|clothing|gift|hardware|florist/i,
    sequences: [SEQ_CHARGEBACK_DEFENSE, SEQ_SURCHARGE],
  },
  {
    pattern: /landscap|construct|legal|contractor|plumb|hvac|cleaning|janitorial|electrician|auto|mechanic|tow|pool|pest|painting|roofing/i,
    sequences: [SEQ_TEXT_TO_PAY],
  },
];

/** Resolve which sequence names to upsell for a given vertical string. */
function resolveSequenceNamesForVertical(vertical: string | null | undefined): string[] {
  if (!vertical) return [SEQ_TEXT_TO_PAY]; // safe default
  for (const { pattern, sequences } of VERTICAL_SEQUENCE_MAP) {
    if (pattern.test(vertical)) return sequences;
  }
  return [SEQ_TEXT_TO_PAY]; // fallback for unrecognised verticals
}

export interface VasUpsellResult {
  skipped: boolean;
  skipReason?: string;
  vertical?: string;
  sequencesAttempted: string[];
  enrolled: number;
  alreadyEnrolled: number;
  blocked: number;
  enrollmentIds: number[];
}

/**
 * Main entry point called by workflow-executor when the `vas_upsell_enrollment`
 * action fires on Day 30.
 */
export async function triggerDay30VasUpsell(
  contactId: number,
  dealId: number | undefined,
): Promise<VasUpsellResult> {
  const result: VasUpsellResult = {
    skipped: false,
    sequencesAttempted: [],
    enrolled: 0,
    alreadyEnrolled: 0,
    blocked: 0,
    enrollmentIds: [],
  };

  // ── 1. Load deal to check suppression ──────────────────────────────────
  if (dealId) {
    const deal = await storage.getDeal(dealId);
    if (deal && (deal as any).vasUpsellSuppressedAt) {
      result.skipped = true;
      result.skipReason = "vas_upsell_suppressed_by_rep";
      await storage.createAuditLog({
        action: "day30_vas_upsell_skipped",
        entityType: "contact",
        entityId: contactId,
        actorType: "system",
        details: { dealId, reason: "vas_upsell_suppressed_by_rep" },
      });
      return result;
    }
  }

  // ── 2. Determine vertical ───────────────────────────────────────────────
  const contact = await storage.getContact(contactId);
  if (!contact) {
    result.skipped = true;
    result.skipReason = "contact_not_found";
    return result;
  }

  // Prefer deal.vertical, fall back to contact.vertical
  let vertical: string | null = null;
  if (dealId) {
    const deal = await storage.getDeal(dealId);
    vertical = (deal as any)?.vertical || null;
  }
  if (!vertical) {
    vertical = contact.vertical || null;
  }
  result.vertical = vertical ?? undefined;

  // ── 3. Resolve sequence names ───────────────────────────────────────────
  const targetSequenceNames = resolveSequenceNamesForVertical(vertical);
  result.sequencesAttempted = targetSequenceNames;

  // ── 4. Load all sequences once ─────────────────────────────────────────
  const allSequences = await storage.getFollowUpSequences();

  // ── 5. Load existing enrollments for this contact ──────────────────────
  const existingEnrollments = await storage.getContactEnrollments(contactId);

  // ── 6. Import contactability evaluator ─────────────────────────────────
  const { evaluateContactability } = await import("./contactability");

  // ── 7. Enroll in each target sequence ──────────────────────────────────
  for (const seqName of targetSequenceNames) {
    const sequence = allSequences.find(
      s => s.name === seqName && s.status === "active",
    );
    if (!sequence) {
      console.warn(`[VasUpsell] Sequence not found or inactive: "${seqName}"`);
      result.blocked++;
      await storage.createAuditLog({
        action: "day30_vas_upsell_sequence_not_found",
        entityType: "contact",
        entityId: contactId,
        actorType: "system",
        details: { sequenceName: seqName, vertical, dealId },
      });
      continue;
    }

    // Skip if already enrolled (active or completed)
    const alreadyIn = existingEnrollments.some(
      e => e.sequenceId === sequence.id && (e.status === "active" || e.status === "completed"),
    );
    if (alreadyIn) {
      result.alreadyEnrolled++;
      continue;
    }

    // Contactability gate — check email channel (same as autoEnrollFromTrigger)
    const steps = await storage.getSequenceSteps(sequence.id);
    const hasEmail = steps.some(s => s.actionType === "email");
    const hasSms   = steps.some(s => s.actionType === "sms");

    const channelToCheck: "email" | "sms" = hasEmail ? "email" : "sms";
    const contactabilityCheck = await evaluateContactability({
      contactId,
      channel: channelToCheck,
      campaignType: "auto_enrollment",
      mode: "enforcement",
    });

    if (!contactabilityCheck.allowed) {
      result.blocked++;
      await storage.createAuditLog({
        action: "day30_vas_upsell_blocked_contactability",
        entityType: "contact",
        entityId: contactId,
        actorType: "system",
        details: {
          sequenceId: sequence.id,
          sequenceName: seqName,
          channel: channelToCheck,
          reason: contactabilityCheck.reason,
          consentTier: contactabilityCheck.consentTier,
          lifecycleStage: contactabilityCheck.lifecycleStage,
          vertical,
          dealId,
        },
      });
      continue;
    }

    // Create enrollment
    const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
    const delayMs = firstStep
      ? ((firstStep.delayDays || 0) * 86_400_000) + ((firstStep.delayHours || 0) * 3_600_000)
      : 0;

    const enrollment = await storage.createSequenceEnrollment({
      sequenceId: sequence.id,
      contactId,
      dealId: dealId || undefined,
      status: "active",
      currentStep: 0,
      nextActionAt: new Date(Date.now() + Math.max(delayMs, 1_000)),
    });

    if (enrollment?.id) {
      result.enrollmentIds.push(enrollment.id);
    }

    result.enrolled++;

    await storage.createAuditLog({
      action: "day30_vas_upsell_enrolled",
      entityType: "contact",
      entityId: contactId,
      actorType: "system",
      details: {
        sequenceId: sequence.id,
        sequenceName: seqName,
        enrollmentId: enrollment?.id,
        vertical,
        dealId,
        trigger: "day30_vas_upsell",
      },
    });

    console.log(
      `[VasUpsell] Enrolled contact #${contactId} in "${seqName}" (vertical: ${vertical ?? "unknown"})`,
    );
  }

  return result;
}
