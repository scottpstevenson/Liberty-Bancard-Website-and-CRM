/**
 * new-lead-enrollment-job.ts
 *
 * Admin-triggered (and optionally periodic) enrollment of contacts linked to
 * "New Lead" sales deals into a sequence.
 *
 * Strict invariants enforced here (kill lines):
 *  - DNC contacts are NEVER enrolled.
 *  - Opted-out contacts are NEVER enrolled.
 *  - Contacts already actively enrolled in the target sequence are skipped.
 *  - Contacts without an email are skipped for email sequences.
 *  - Contacts without PEWC are skipped for SMS/voice/ringless sequences.
 *  - Sequences with status !== "active" are never used.
 *  - No deals are created.
 *  - No GHL sync is triggered.
 *  - No outbound send is triggered directly.
 *  - Enrollments go through storage.createSequenceEnrollment() — not direct DB inserts.
 *  - Only one new-lead enrollment job runs at a time (in-memory flag).
 *  - Preview path is fully read-only — no DB writes of any kind.
 *  - autoEnrollNewLeadDeals defaults to false; always checked before auto-runs.
 */

import { db } from "../db";
import { deals, contacts, sequenceEnrollments, sequenceSteps } from "@shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { canEnrollContactInSequence } from "./sequence-eligibility";
import { evaluateContactability } from "./contactability";

const NEW_LEAD_PROGRESS_KEY = "new_lead_enrollment_progress";
const NEW_LEAD_CANCEL_KEY = "new_lead_enrollment_cancel_requested";
const AUTO_ENROLL_SETTING = "autoEnrollNewLeadDeals";
const VERTICAL_MAP_SETTING = "verticalNewLeadSequenceMap";
const DEFAULT_SEQUENCE_SETTING = "defaultNewLeadSequenceId";

const SMS_VOICE_RINGLESS_TYPES = new Set(["sms", "call", "call_reminder", "voicemail_drop"]);

export interface NewLeadEnrollProgress {
  status: "idle" | "running" | "complete" | "cancelled" | "failed";
  total: number;
  processed: number;
  enrolled: number;
  alreadyEnrolled: number;
  dncBlocked: number;
  optOutBlocked: number;
  contactabilityBlocked: number;
  pewcBlocked: number;
  missingContactMethod: number;
  eligibilityBlocked: number;
  noSequenceBlocked: number;
  inactiveSequenceBlocked: number;
  noContactBlocked: number;
  errors: number;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  error?: string | null;
}

export interface NewLeadEnrollPreviewResult {
  total: number;
  eligible: number;
  alreadyEnrolled: number;
  dncBlocked: number;
  optOutBlocked: number;
  contactabilityBlocked: number;
  pewcBlocked: number;
  missingContactMethod: number;
  eligibilityBlocked: number;
  noSequenceBlocked: number;
  inactiveSequenceBlocked: number;
  noContactBlocked: number;
  sequenceChannelLabel: string;
  requiresTypedConfirmation: boolean;
  defaultSequenceId: number | null;
  verticalMap: Record<string, number>;
}

let _jobRunning = false;

export function isNewLeadEnrollJobRunning(): boolean {
  return _jobRunning;
}

export async function getNewLeadEnrollProgress(): Promise<NewLeadEnrollProgress> {
  const saved = await storage.getSystemSetting(NEW_LEAD_PROGRESS_KEY);
  return (saved as NewLeadEnrollProgress | null) ?? _emptyProgress();
}

export async function cancelNewLeadEnroll(): Promise<void> {
  await storage.setSystemSetting(NEW_LEAD_CANCEL_KEY, true);
}

/** Read the auto-enroll master switch. Defaults to false if never set. */
export async function getAutoEnrollEnabled(): Promise<boolean> {
  const val = await storage.getSystemSetting(AUTO_ENROLL_SETTING);
  return val === true;
}

/** Persist the auto-enroll master switch. */
export async function setAutoEnrollEnabled(enabled: boolean): Promise<void> {
  await storage.setSystemSetting(AUTO_ENROLL_SETTING, enabled);
}

/** Read the vertical → sequenceId mapping. */
export async function getVerticalSequenceMap(): Promise<Record<string, number>> {
  const val = await storage.getSystemSetting(VERTICAL_MAP_SETTING);
  return (val && typeof val === "object" && !Array.isArray(val)) ? val as Record<string, number> : {};
}

/** Persist the vertical → sequenceId mapping. */
export async function setVerticalSequenceMap(map: Record<string, number>): Promise<void> {
  await storage.setSystemSetting(VERTICAL_MAP_SETTING, map);
}

/** Read the default sequence ID (used when no vertical match). */
export async function getDefaultSequenceId(): Promise<number | null> {
  const val = await storage.getSystemSetting(DEFAULT_SEQUENCE_SETTING);
  return typeof val === "number" ? val : null;
}

/** Persist the default sequence ID. */
export async function setDefaultSequenceId(id: number | null): Promise<void> {
  await storage.setSystemSetting(DEFAULT_SEQUENCE_SETTING, id);
}

// ─── Preview (fully read-only) ────────────────────────────────────────────────

export async function previewNewLeadEnroll(): Promise<NewLeadEnrollPreviewResult> {
  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  const dealRows = await _fetchNewLeadDeals();
  const counts = _emptyPreviewCounts();
  counts.total = dealRows.length;

  // Determine channel label from the default sequence (if set)
  let sequenceChannelLabel = "Email-only";
  if (defaultSeqId) {
    const seq = await storage.getFollowUpSequence(defaultSeqId);
    if (seq) {
      sequenceChannelLabel = await _getChannelLabel(defaultSeqId);
    }
  }

  const requiresPewcDefault = await _requiresPewc(defaultSeqId);

  for (const row of dealRows) {
    const contact = row.contact;
    if (!contact) { counts.noContactBlocked++; continue; }

    if (contact.doNotContact) { counts.dncBlocked++; continue; }
    const tier = contact.consentTier ?? "cold_no_consent";
    if (tier === "opted_out" || tier === "do_not_contact") { counts.optOutBlocked++; continue; }

    // Resolve sequence for this deal
    const seqId = (row.deal.vertical && verticalMap[row.deal.vertical]) || defaultSeqId;
    if (!seqId) { counts.noSequenceBlocked++; continue; }

    const sequence = await storage.getFollowUpSequence(seqId);
    if (!sequence) { counts.noSequenceBlocked++; continue; }
    if (sequence.status !== "active") { counts.inactiveSequenceBlocked++; continue; }

    // Channel-aware contact-method + PEWC gate:
    // SMS/voice/ringless sequences require PEWC consent + phone; email sequences require email.
    const requiresPewc = await _requiresPewc(seqId);
    if (requiresPewc) {
      if (tier !== "pewc_full_automation") { counts.pewcBlocked++; continue; }
      if (!contact.phone) { counts.missingContactMethod++; continue; }
    } else {
      if (!contact.email) { counts.missingContactMethod++; continue; }
    }

    // Check existing enrollment — any active/paused enrollment blocks re-enrollment
    const existingEnrollments = await storage.getContactEnrollments(contact.id);
    const isEnrolled = existingEnrollments.some(
      e => e.status === "active" || e.status === "paused"
    );
    if (isEnrolled) { counts.alreadyEnrolled++; continue; }

    const enrollCheck = await canEnrollContactInSequence(contact.id, sequence);
    if (!enrollCheck.allowed) { counts.eligibilityBlocked++; continue; }

    const contactResult = await evaluateContactability({
      contactId: contact.id,
      channel: requiresPewc ? "sms" : "email",
      mode: "dryRun",
    });
    if (!contactResult.allowed) { counts.contactabilityBlocked++; continue; }

    counts.eligible++;
  }

  return {
    ...counts,
    sequenceChannelLabel,
    requiresTypedConfirmation: counts.eligible >= 100,
    defaultSequenceId: defaultSeqId,
    verticalMap,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

export async function startNewLeadEnroll(): Promise<void> {
  if (_jobRunning) {
    throw new Error("A new-lead enrollment job is already running.");
  }

  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  const dealRows = await _fetchNewLeadDeals();

  await storage.setSystemSetting(NEW_LEAD_CANCEL_KEY, false);

  const initProgress: NewLeadEnrollProgress = {
    ..._emptyProgress(),
    status: "running",
    total: dealRows.length,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, initProgress);
  _jobRunning = true;

  setImmediate(() => {
    _runAsync({ dealRows, defaultSeqId, verticalMap, initProgress }).catch(async (err) => {
      console.error("[NewLeadEnrollJob] Unhandled error:", err);
      const progress = await getNewLeadEnrollProgress();
      await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, {
        ...progress,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      _jobRunning = false;
    });
  });
}

async function _runAsync(opts: {
  dealRows: Array<{ deal: any; contact: any }>;
  defaultSeqId: number | null;
  verticalMap: Record<string, number>;
  initProgress: NewLeadEnrollProgress;
}): Promise<void> {
  const { dealRows, defaultSeqId, verticalMap } = opts;
  let progress = { ...opts.initProgress };

  try {
    for (const row of dealRows) {
      const cancelRequested = await storage.getSystemSetting(NEW_LEAD_CANCEL_KEY);
      if (cancelRequested === true) {
        progress = {
          ...progress,
          status: "cancelled",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, progress);
        break;
      }

      progress.processed++;

      try {
        const { deal, contact } = row;

        if (!contact) {
          progress.noContactBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_eligibility",
            entityType: "deal",
            entityId: deal.id,
            details: { reason: "no_contact_linked", dealId: deal.id },
          });
          continue;
        }

        if (contact.doNotContact) {
          progress.dncBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_dnc",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, dealId: deal.id },
          });
          continue;
        }

        const tier = contact.consentTier ?? "cold_no_consent";
        if (tier === "opted_out" || tier === "do_not_contact") {
          progress.optOutBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_opted_out",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, consentTier: tier, dealId: deal.id },
          });
          continue;
        }

        // Resolve sequence
        const seqId = (deal.vertical && verticalMap[deal.vertical]) || defaultSeqId;
        if (!seqId) {
          progress.noSequenceBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_no_sequence",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, vertical: deal.vertical, dealId: deal.id },
          });
          continue;
        }

        const sequence = await storage.getFollowUpSequence(seqId);
        if (!sequence) {
          progress.noSequenceBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_no_sequence",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, sequenceId: seqId, reason: "not_found", dealId: deal.id },
          });
          continue;
        }
        if (sequence.status !== "active") {
          progress.inactiveSequenceBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_inactive_sequence",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, sequenceId: seqId, sequenceStatus: sequence.status, dealId: deal.id },
          });
          continue;
        }

        // Channel-aware contact-method + PEWC gate:
        // SMS/voice/ringless sequences require PEWC consent + phone; email sequences require email.
        const requiresPewc = await _requiresPewc(seqId);
        if (requiresPewc) {
          if (tier !== "pewc_full_automation") {
            progress.pewcBlocked++;
            await storage.createAuditLog({
              action: "new_lead_deal_enrollment_skipped_pewc",
              entityType: "deal",
              entityId: deal.id,
              details: { contactId: contact.id, sequenceId: seqId, consentTier: tier, dealId: deal.id },
            });
            continue;
          }
          if (!contact.phone) {
            progress.missingContactMethod++;
            await storage.createAuditLog({
              action: "new_lead_deal_enrollment_skipped_no_contact_method",
              entityType: "deal",
              entityId: deal.id,
              details: { contactId: contact.id, sequenceId: seqId, reason: "no_phone", dealId: deal.id },
            });
            continue;
          }
        } else {
          if (!contact.email) {
            progress.missingContactMethod++;
            await storage.createAuditLog({
              action: "new_lead_deal_enrollment_skipped_no_contact_method",
              entityType: "deal",
              entityId: deal.id,
              details: { contactId: contact.id, sequenceId: seqId, reason: "no_email", dealId: deal.id },
            });
            continue;
          }
        }

        // Duplicate check — any active/paused enrollment in ANY sequence blocks re-enrollment
        const existingEnrollments = await storage.getContactEnrollments(contact.id);
        const isEnrolled = existingEnrollments.some(
          e => e.status === "active" || e.status === "paused"
        );
        if (isEnrolled) {
          progress.alreadyEnrolled++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_already_enrolled",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, sequenceId: seqId, dealId: deal.id },
          });
          continue;
        }

        // Eligibility gate
        const enrollCheck = await canEnrollContactInSequence(contact.id, sequence);
        if (!enrollCheck.allowed) {
          progress.eligibilityBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_eligibility",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, sequenceId: seqId, reason: enrollCheck.reason, dealId: deal.id },
          });
          continue;
        }

        // Contactability gate (channel matches sequence type)
        const contactResult = await evaluateContactability({
          contactId: contact.id,
          channel: requiresPewc ? "sms" : "email",
          mode: "dryRun",
        });
        if (!contactResult.allowed) {
          progress.contactabilityBlocked++;
          await storage.createAuditLog({
            action: "new_lead_deal_enrollment_skipped_contactability",
            entityType: "deal",
            entityId: deal.id,
            details: { contactId: contact.id, sequenceId: seqId, reason: contactResult.reason, dealId: deal.id },
          });
          continue;
        }

        // Enroll
        await storage.createSequenceEnrollment({
          sequenceId: seqId,
          contactId: contact.id,
          dealId: deal.id,
          status: "active",
          currentStep: 0,
          nextActionAt: new Date(),
          metadata: {
            enrolledBy: "new_lead_enrollment_job",
            vertical: deal.vertical ?? null,
            dealId: deal.id,
          },
        });
        progress.enrolled++;
        await storage.createAuditLog({
          action: "new_lead_deal_enrolled",
          entityType: "deal",
          entityId: deal.id,
          details: { contactId: contact.id, sequenceId: seqId, vertical: deal.vertical ?? null, dealId: deal.id },
        });
      } catch (err) {
        console.error(`[NewLeadEnrollJob] Error processing deal ${row.deal?.id}:`, err);
        progress.errors++;
      }

      if (progress.processed % 50 === 0) {
        progress.updatedAt = new Date().toISOString();
        await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, progress);
      }
    }

    if (progress.status === "running") {
      progress = {
        ...progress,
        status: "complete",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, progress);
      await storage.createAuditLog({
        action: "new_lead_enrollment_sweep_completed",
        entityType: "system",
        entityId: 0,
        details: {
          total: progress.total,
          enrolled: progress.enrolled,
          skipped: progress.processed - progress.enrolled - progress.errors,
          errors: progress.errors,
          completedAt: progress.completedAt,
        },
      });
    }
  } catch (err) {
    progress = {
      ...progress,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.setSystemSetting(NEW_LEAD_PROGRESS_KEY, progress);
    throw err;
  } finally {
    _jobRunning = false;
    await storage.setSystemSetting(NEW_LEAD_CANCEL_KEY, false);
  }
}

// ─── SLA worker periodic hook ─────────────────────────────────────────────────

/**
 * Called periodically from the SLA worker.
 * When autoEnrollNewLeadDeals=false: writes candidate audit entries, no enrollments.
 * When autoEnrollNewLeadDeals=true:  enrolls each eligible deal contact.
 */
export async function runNewLeadAutoEnrollCheck(): Promise<void> {
  const autoEnabled = await getAutoEnrollEnabled();
  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  const dealRows = await _fetchNewLeadDeals();

  for (const row of dealRows) {
    try {
      const { deal, contact } = row;
      if (!contact) continue;
      if (contact.doNotContact) continue;
      const tier = contact.consentTier ?? "cold_no_consent";
      if (tier === "opted_out" || tier === "do_not_contact") continue;

      const seqId = (deal.vertical && verticalMap[deal.vertical]) || defaultSeqId;
      if (!seqId) continue;

      const sequence = await storage.getFollowUpSequence(seqId);
      if (!sequence || sequence.status !== "active") continue;

      // Channel-aware contact-method + PEWC gate (parity with preview/_runAsync)
      const requiresPewc = await _requiresPewc(seqId);
      if (requiresPewc) {
        if (tier !== "pewc_full_automation") continue;
        if (!contact.phone) continue;
      } else {
        if (!contact.email) continue;
      }

      const existingEnrollments = await storage.getContactEnrollments(contact.id);
      // Any active/paused enrollment in ANY sequence blocks re-enrollment
      const isEnrolled = existingEnrollments.some(
        e => e.status === "active" || e.status === "paused"
      );
      if (isEnrolled) continue;

      const enrollCheck = await canEnrollContactInSequence(contact.id, sequence);
      if (!enrollCheck.allowed) continue;

      if (!autoEnabled) {
        // Candidate detection only — no enrollment
        await storage.createAuditLog({
          action: "new_lead_auto_enrollment_candidate_detected",
          entityType: "deal",
          entityId: deal.id,
          details: {
            contactId: contact.id,
            sequenceId: seqId,
            vertical: deal.vertical ?? null,
            dealId: deal.id,
            note: "autoEnrollNewLeadDeals=false — no enrollment created",
          },
        });
        continue;
      }

      // Auto-enroll — contactability check uses channel matching sequence type
      const contactResult = await evaluateContactability({
        contactId: contact.id,
        channel: requiresPewc ? "sms" : "email",
        mode: "dryRun",
      });
      if (!contactResult.allowed) continue;

      await storage.createSequenceEnrollment({
        sequenceId: seqId,
        contactId: contact.id,
        dealId: deal.id,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date(),
        metadata: {
          enrolledBy: "sla_auto_enroll",
          vertical: deal.vertical ?? null,
          dealId: deal.id,
        },
      });
      await storage.createAuditLog({
        action: "new_lead_deal_enrolled",
        entityType: "deal",
        entityId: deal.id,
        details: {
          contactId: contact.id,
          sequenceId: seqId,
          vertical: deal.vertical ?? null,
          dealId: deal.id,
          enrolledBy: "sla_auto_enroll",
        },
      });
    } catch (err) {
      console.error(`[NewLeadAutoEnroll] Error processing deal ${row.deal?.id}:`, err);
    }
  }
}

/** Alias matching the requested external contract name. */
export const runNewLeadEnroll = startNewLeadEnroll;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _fetchNewLeadDeals(): Promise<Array<{ deal: any; contact: any }>> {
  const dealRows = await db
    .select()
    .from(deals)
    .where(
      and(
        eq(deals.pipeline, "sales"),
        eq(deals.stage, "New Lead"),
        isNull(deals.archivedAt)
      )
    )
    .orderBy(deals.id);

  const results: Array<{ deal: any; contact: any }> = [];
  for (const deal of dealRows) {
    if (!deal.contactId) {
      results.push({ deal, contact: null });
      continue;
    }
    const contact = await storage.getContact(deal.contactId);
    results.push({ deal, contact: contact ?? null });
  }
  return results;
}

async function _requiresPewc(sequenceId: number | null): Promise<boolean> {
  if (!sequenceId) return false;
  const steps = await storage.getSequenceSteps(sequenceId);
  return steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
}

async function _getChannelLabel(sequenceId: number): Promise<string> {
  const steps = await storage.getSequenceSteps(sequenceId);
  const hasSmsVoiceRingless = steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  if (hasSmsVoiceRingless) return "SMS/Voice/Ringless requires PEWC";
  const hasOtherChannels = steps.some(
    s => s.actionType && !["email", "wait", "condition", "task"].includes(s.actionType)
  );
  return hasOtherChannels ? "Mixed channel" : "Email-only";
}

function _emptyProgress(): NewLeadEnrollProgress {
  return {
    status: "idle",
    total: 0,
    processed: 0,
    enrolled: 0,
    alreadyEnrolled: 0,
    dncBlocked: 0,
    optOutBlocked: 0,
    contactabilityBlocked: 0,
    pewcBlocked: 0,
    missingContactMethod: 0,
    eligibilityBlocked: 0,
    noSequenceBlocked: 0,
    inactiveSequenceBlocked: 0,
    noContactBlocked: 0,
    errors: 0,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    error: null,
  };
}

function _emptyPreviewCounts() {
  return {
    total: 0,
    eligible: 0,
    alreadyEnrolled: 0,
    dncBlocked: 0,
    optOutBlocked: 0,
    contactabilityBlocked: 0,
    pewcBlocked: 0,
    missingContactMethod: 0,
    eligibilityBlocked: 0,
    noSequenceBlocked: 0,
    inactiveSequenceBlocked: 0,
    noContactBlocked: 0,
  };
}
