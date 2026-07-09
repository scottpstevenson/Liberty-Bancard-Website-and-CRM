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
import { eq, and, isNull, inArray, isNotNull, sql } from "drizzle-orm";
import { storage } from "../storage";
import { canEnrollContactInSequence } from "./sequence-eligibility";
import { evaluateContactability } from "./contactability";

const NEW_LEAD_PROGRESS_KEY = "new_lead_enrollment_progress";
const NEW_LEAD_CANCEL_KEY = "new_lead_enrollment_cancel_requested";
const AUTO_ENROLL_SETTING = "autoEnrollNewLeadDeals";
const VERTICAL_MAP_SETTING = "verticalNewLeadSequenceMap";
const DEFAULT_SEQUENCE_SETTING = "defaultNewLeadSequenceId";

const SMS_VOICE_RINGLESS_TYPES = new Set(["sms", "call", "call_reminder", "voicemail_drop"]);

/** Key used in verticalMap for deals that have no/null/empty vertical. Must match the UI key. */
const UNKNOWN_VERTICAL_KEY = "__unknown__";

/**
 * Normalise a raw vertical string.
 * Returns null for null/undefined/""/whitespace-only/"unknown"/"uncategorized".
 * Returns the trimmed string for all other values.
 */
function _resolveVertical(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || t.toLowerCase() === "unknown" || t.toLowerCase() === "uncategorized") return null;
  return t;
}

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

// ─── Suppression helper ───────────────────────────────────────────────────────

/**
 * Central suppression helper.  Called by every unsubscribe / opt-out path.
 * Sets `autoEnrollmentSuppressedAt` + `autoEnrollmentSuppressedReason` on all
 * active New Lead deals for the contact, writes an audit log row, and pauses
 * any active sequence enrollments.
 *
 * This is additive back-pressure on top of the contactability / consent gates —
 * it does NOT change deal stage, DNC status, or consent fields.
 */
export async function suppressNewLeadAutoEnrollmentForContact(
  contactId: number,
  reason: string
): Promise<void> {
  try {
    const now = new Date();

    // 1. Find active New Lead deals for this contact
    const newLeadDeals = await db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          eq(deals.contactId, contactId),
          eq(deals.pipeline, "sales"),
          eq(deals.stage, "New Lead"),
          isNull(deals.archivedAt)
        )
      );

    for (const deal of newLeadDeals) {
      // 2. Set suppression metadata on the deal
      await db
        .update(deals)
        .set({
          autoEnrollmentSuppressedAt: now,
          autoEnrollmentSuppressedReason: reason,
          updatedAt: now,
        })
        .where(eq(deals.id, deal.id));

      // 3. Write audit log
      await storage.createAuditLog({
        action: "new_lead_auto_enrollment_suppressed",
        entityType: "deal",
        entityId: deal.id,
        actorType: "system",
        details: {
          contactId,
          dealId: deal.id,
          reason,
          suppressedAt: now.toISOString(),
        },
      });
    }

    // 4. Pause any active sequence enrollments for this contact
    const enrollments = await storage.getContactEnrollments(contactId);
    for (const enrollment of enrollments) {
      if (enrollment.status === "active") {
        await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
      }
    }
  } catch (err) {
    console.error("[suppressNewLeadAutoEnrollment] Error suppressing contact", contactId, err);
  }
}

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
  const startMs = Date.now();
  console.log(JSON.stringify({ event: "new_lead_enrollment_preview_started" }));

  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  const dealRows = await _fetchNewLeadDeals();
  const counts = _emptyPreviewCounts();
  counts.total = dealRows.length;

  // ── 1. Collect all unique sequence IDs referenced by this deal set ───────
  const allSeqIdSet = new Set<number>();
  if (defaultSeqId) allSeqIdSet.add(defaultSeqId);
  for (const { deal } of dealRows) {
    const v = _resolveVertical(deal.vertical);
    if (v && verticalMap[v]) {
      allSeqIdSet.add(verticalMap[v]);
    }
  }
  // Always include the unknown-vertical sequence if mapped, so it's bulk-loaded
  if (verticalMap[UNKNOWN_VERTICAL_KEY]) allSeqIdSet.add(verticalMap[UNKNOWN_VERTICAL_KEY]);
  const seqIdList = Array.from(allSeqIdSet);

  // ── 2. Bulk-fetch sequences and steps once ────────────────────────────────
  const [allSequences, allSteps] = await Promise.all([
    seqIdList.length > 0 ? storage.getFollowUpSequencesByIds(seqIdList) : Promise.resolve([]),
    seqIdList.length > 0 ? storage.getSequenceStepsForSequences(seqIdList) : Promise.resolve([]),
  ]);

  const sequenceById = new Map(allSequences.map(s => [s.id, s]));
  const stepsBySequenceId = new Map<number, typeof sequenceSteps.$inferSelect[]>();
  for (const step of allSteps) {
    if (!stepsBySequenceId.has(step.sequenceId)) stepsBySequenceId.set(step.sequenceId, []);
    stepsBySequenceId.get(step.sequenceId)!.push(step);
  }

  // Cached PEWC helper — uses pre-fetched steps, never hits DB
  const requiresPewcCached = (seqId: number): boolean => {
    const steps = stepsBySequenceId.get(seqId) ?? [];
    return steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  };

  // ── 3. Collect all contact IDs and bulk-fetch enrollments ─────────────────
  const allContactIds = [...new Set(
    dealRows.filter(r => r.contact != null).map(r => r.contact.id as number)
  )];

  const allEnrollments = allContactIds.length > 0
    ? await storage.getContactEnrollmentsForContacts(allContactIds)
    : [];

  const enrollmentsByContactId = new Map<number, typeof sequenceEnrollments.$inferSelect[]>();
  for (const enrollment of allEnrollments) {
    if (!enrollmentsByContactId.has(enrollment.contactId)) {
      enrollmentsByContactId.set(enrollment.contactId, []);
    }
    enrollmentsByContactId.get(enrollment.contactId)!.push(enrollment);
  }

  // ── 4. Determine channel label from default sequence (from cache) ─────────
  let sequenceChannelLabel = "Email-only";
  if (defaultSeqId) {
    const seq = sequenceById.get(defaultSeqId);
    if (seq) {
      const steps = stepsBySequenceId.get(defaultSeqId) ?? [];
      const hasSmsVoiceRingless = steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
      if (hasSmsVoiceRingless) {
        sequenceChannelLabel = "SMS/Voice/Ringless requires PEWC";
      } else {
        const hasOtherChannels = steps.some(
          s => s.actionType && !["email", "wait", "condition", "task"].includes(s.actionType)
        );
        sequenceChannelLabel = hasOtherChannels ? "Mixed channel" : "Email-only";
      }
    }
  }

  // ── 5. Per-deal classification — no storage calls inside this loop ────────
  for (const row of dealRows) {
    const contact = row.contact;
    if (!contact) { counts.noContactBlocked++; continue; }

    if (contact.doNotContact) { counts.dncBlocked++; continue; }
    const tier = contact.consentTier ?? "cold_no_consent";
    if (tier === "opted_out" || tier === "do_not_contact") { counts.optOutBlocked++; continue; }

    // Resolve sequence for this deal — 3-tier: vertical map → unknown map → default
    const v = _resolveVertical(row.deal.vertical);
    const seqId = (v && verticalMap[v]) || (!v && verticalMap[UNKNOWN_VERTICAL_KEY]) || defaultSeqId;
    if (!seqId) { counts.noSequenceBlocked++; continue; }

    const sequence = sequenceById.get(seqId);
    if (!sequence) { counts.noSequenceBlocked++; continue; }
    if (sequence.status !== "active") { counts.inactiveSequenceBlocked++; continue; }

    // Channel-aware contact-method + PEWC gate (uses cached steps)
    const requiresPewc = requiresPewcCached(seqId);
    if (requiresPewc) {
      if (tier !== "pewc_full_automation") { counts.pewcBlocked++; continue; }
      if (!contact.phone) { counts.missingContactMethod++; continue; }
    } else {
      if (!contact.email) { counts.missingContactMethod++; continue; }
    }

    // Check existing enrollment from bulk-fetched cache
    const existingEnrollments = enrollmentsByContactId.get(contact.id) ?? [];
    const isEnrolled = existingEnrollments.some(
      e => e.status === "active" || e.status === "paused"
    );
    if (isEnrolled) { counts.alreadyEnrolled++; continue; }

    // Eligibility and contactability checks run on the filtered, much-smaller pool
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

  const durationMs = Date.now() - startMs;
  console.log(JSON.stringify({
    event: "new_lead_enrollment_preview_completed",
    dealCount: dealRows.length,
    contactCount: allContactIds.length,
    sequenceCount: seqIdList.length,
    durationMs,
  }));

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

        // Resolve sequence — 3-tier: vertical map → unknown map → default
        const v = _resolveVertical(deal.vertical);
        const seqId = (v && verticalMap[v]) || (!v && verticalMap[UNKNOWN_VERTICAL_KEY]) || defaultSeqId;
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
 *
 * Performance: builds 3 Maps once before the loop so there are zero per-deal
 * DB round-trips for sequence lookup, PEWC check, or enrollment check.
 */
export async function runNewLeadAutoEnrollCheck(): Promise<void> {
  // Re-entrancy guard — safe for single-process deployment (Replit).
  // Both the manual startNewLeadEnroll() path and the SLA auto-check path share
  // _jobRunning so they are mutually exclusive at the process level.
  if (_jobRunning) {
    await storage.createAuditLog({
      action: "new_lead_auto_enrollment_tick_skipped_already_running",
      entityType: "system",
      entityId: 0,
      actorType: "system",
      details: { reason: "Previous runNewLeadAutoEnrollCheck() is still in progress; tick skipped." },
    });
    return;
  }
  _jobRunning = true;
  try {
  const startMs = Date.now();
  const autoEnabled = await getAutoEnrollEnabled();
  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  const dealRows = await _fetchNewLeadDeals();

  // ── 1. Collect all distinct sequence IDs referenced by this deal set ─────
  const allSeqIdSet = new Set<number>();
  if (defaultSeqId) allSeqIdSet.add(defaultSeqId);
  for (const { deal } of dealRows) {
    const v = _resolveVertical(deal.vertical);
    if (v && verticalMap[v]) {
      allSeqIdSet.add(verticalMap[v]);
    }
  }
  // Always include the unknown-vertical sequence if mapped, so it's bulk-loaded
  if (verticalMap[UNKNOWN_VERTICAL_KEY]) allSeqIdSet.add(verticalMap[UNKNOWN_VERTICAL_KEY]);
  const seqIdList = Array.from(allSeqIdSet);

  // ── 2. Bulk-fetch sequences and steps in parallel ─────────────────────────
  const [allSequences, allSteps] = await Promise.all([
    seqIdList.length > 0 ? storage.getFollowUpSequencesByIds(seqIdList) : Promise.resolve([]),
    seqIdList.length > 0 ? storage.getSequenceStepsForSequences(seqIdList) : Promise.resolve([]),
  ]);

  const sequencesById = new Map(allSequences.map(s => [s.id, s]));
  const stepsBySequenceId = new Map<number, typeof sequenceSteps.$inferSelect[]>();
  for (const step of allSteps) {
    if (!stepsBySequenceId.has(step.sequenceId)) stepsBySequenceId.set(step.sequenceId, []);
    stepsBySequenceId.get(step.sequenceId)!.push(step);
  }

  // Cached PEWC helper — uses pre-fetched steps, never hits DB
  const requiresPewcCached = (seqId: number): boolean => {
    const steps = stepsBySequenceId.get(seqId) ?? [];
    return steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  };

  // ── 3. Collect all contact IDs and bulk-fetch enrollments ─────────────────
  const allContactIds = [...new Set(
    dealRows.filter(r => r.contact != null).map(r => r.contact.id as number)
  )];

  const allEnrollments = allContactIds.length > 0
    ? await storage.getContactEnrollmentsForContacts(allContactIds)
    : [];

  const enrollmentsByContactId = new Map<number, typeof sequenceEnrollments.$inferSelect[]>();
  for (const enrollment of allEnrollments) {
    if (!enrollmentsByContactId.has(enrollment.contactId)) {
      enrollmentsByContactId.set(enrollment.contactId, []);
    }
    enrollmentsByContactId.get(enrollment.contactId)!.push(enrollment);
  }

  // ── 4. Per-deal loop — zero DB calls for sequence/PEWC/enrollment lookups ─
  let skipped = 0;
  let candidates = 0;
  let enrolled = 0;
  let eligible = 0;

  for (const row of dealRows) {
    try {
      const { deal, contact } = row;
      if (!contact) { skipped++; continue; }

      if (contact.doNotContact) {
        await storage.createAuditLog({
          action: "new_lead_auto_enrollment_skipped",
          entityType: "deal",
          entityId: deal.id,
          actorType: "system",
          details: { contactId: contact.id, dealId: deal.id, skipReason: "dnc" },
        });
        skipped++;
        continue;
      }

      const tier = contact.consentTier ?? "cold_no_consent";
      if (tier === "opted_out" || tier === "do_not_contact") {
        await storage.createAuditLog({
          action: "new_lead_auto_enrollment_skipped",
          entityType: "deal",
          entityId: deal.id,
          actorType: "system",
          details: { contactId: contact.id, dealId: deal.id, skipReason: "opted_out", consentTier: tier },
        });
        skipped++;
        continue;
      }

      // Suppression guard: skip contacts that have unsubscribed via email-status or
      // optedOutEmail flag, and deals that carry an explicit suppression timestamp.
      if (contact.emailStatus === "unsubscribed" || contact.emailStatus === "opted_out") { skipped++; continue; }
      if (contact.optedOutEmail === true) { skipped++; continue; }
      if (deal.autoEnrollmentSuppressedAt != null) { skipped++; continue; }

      // Resolve sequence — 3-tier: vertical map → unknown map → default
      const v = _resolveVertical(deal.vertical);
      const seqId = (v && verticalMap[v]) || (!v && verticalMap[UNKNOWN_VERTICAL_KEY]) || defaultSeqId;
      if (!seqId) { skipped++; continue; }

      // Map lookup — no DB call
      const sequence = sequencesById.get(seqId);
      if (!sequence || sequence.status !== "active") { skipped++; continue; }

      // Channel-aware contact-method + PEWC gate — no DB call
      const requiresPewc = requiresPewcCached(seqId);
      if (requiresPewc) {
        if (tier !== "pewc_full_automation") { skipped++; continue; }
        if (!contact.phone) { skipped++; continue; }
      } else {
        if (!contact.email) { skipped++; continue; }
      }

      // Enrollment check — no DB call
      const existingEnrollments = enrollmentsByContactId.get(contact.id) ?? [];
      const isEnrolled = existingEnrollments.some(
        e => e.status === "active" || e.status === "paused"
      );
      if (isEnrolled) { skipped++; continue; }

      const enrollCheck = await canEnrollContactInSequence(contact.id, sequence);
      if (!enrollCheck.allowed) { skipped++; continue; }

      eligible++;

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
        candidates++;
        continue;
      }

      // Auto-enroll — contactability check uses channel matching sequence type
      const contactResult = await evaluateContactability({
        contactId: contact.id,
        channel: requiresPewc ? "sms" : "email",
        mode: "dryRun",
      });
      if (!contactResult.allowed) { skipped++; continue; }

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
        action: "new_lead_auto_enrollment_created",
        entityType: "deal",
        entityId: deal.id,
        actorType: "system",
        details: {
          contactId: contact.id,
          sequenceId: seqId,
          vertical: deal.vertical ?? null,
          dealId: deal.id,
          enrolledBy: "sla_auto_enroll",
        },
      });
      enrolled++;
    } catch (err) {
      console.error(`[NewLeadAutoEnroll] Error processing deal ${row.deal?.id}:`, err);
      skipped++;
    }
  }

  // ── 5. One summary audit per run (not per deal) ───────────────────────────
  const durationMs = Date.now() - startMs;
  await storage.createAuditLog({
    action: "new_lead_auto_enrollment_check_completed",
    entityType: "system",
    entityId: 0,
    actorType: "system",
    details: {
      dealCount: dealRows.length,
      contactCount: allContactIds.length,
      sequenceCount: seqIdList.length,
      eligibleCount: eligible,
      enrolledCount: enrolled,
      candidateCount: candidates,
      skippedCount: skipped,
      durationMs,
    },
  });
  } finally {
    _jobRunning = false;
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

  // Bulk-fetch all contacts in one chunked query instead of per-deal serial fetches
  const uniqueContactIds = [...new Set(
    dealRows.filter(d => d.contactId != null).map(d => d.contactId as number)
  )];
  const contactList = uniqueContactIds.length > 0
    ? await storage.getContactsByIds(uniqueContactIds)
    : [];
  const contactById = new Map(contactList.map(c => [c.id, c]));

  return dealRows.map(deal => ({
    deal,
    contact: deal.contactId ? (contactById.get(deal.contactId) ?? null) : null,
  }));
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
