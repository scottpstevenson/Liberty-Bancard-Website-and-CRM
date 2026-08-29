/**
 * bulk-enrollment-job.ts
 *
 * Admin-triggered bulk enrollment of hot/warm contacts into a sequence by vertical.
 *
 * Strict invariants enforced here (kill lines):
 *  - DNC contacts are NEVER enrolled.
 *  - Opted-out contacts are NEVER enrolled.
 *  - Already-enrolled contacts are skipped (no duplicates).
 *  - Contacts without an email are skipped for email sequences.
 *  - Contacts without PEWC are skipped for SMS/voice/ringless sequences.
 *  - No deals are created.
 *  - No GHL sync is triggered.
 *  - No outbound send is triggered directly.
 *  - Campaign enrollment is UNSUPPORTED (no safe per-contact campaign service exists).
 *  - Enrollments go through storage.createSequenceEnrollment() — not direct DB inserts.
 *  - Only one bulk-enroll job runs at a time (in-memory flag).
 */

import { db } from "../db";
import { contacts, sequenceEnrollments, sequenceSteps } from "@shared/schema";
import { isNull, eq, and, gte, sql, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { canEnrollContactInSequence } from "./sequence-eligibility";
import { evaluateContactability } from "./contactability";
import { decideCr06SequenceLifecycle } from "./cr06-promotional-lifecycle-decision";

const BULK_ENROLL_PROGRESS_KEY = "bulk_enroll_job_progress";
const BULK_ENROLL_CANCEL_KEY = "bulk_enroll_job_cancel_requested";

const SMS_VOICE_RINGLESS_TYPES = new Set(["sms", "call", "call_reminder", "voicemail_drop"]);

export interface BulkEnrollProgress {
  status: "idle" | "running" | "complete" | "cancelled" | "failed";
  sequenceId: number;
  vertical: string;
  minScore: number;
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
  errors: number;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  error?: string | null;
}

export interface BulkEnrollPreviewResult {
  total: number;
  eligible: number;
  alreadyEnrolled: number;
  dncBlocked: number;
  optOutBlocked: number;
  contactabilityBlocked: number;
  pewcBlocked: number;
  missingContactMethod: number;
  eligibilityBlocked: number;
  sequenceChannelLabel: string;
  requiresTypedConfirmation: boolean;
}

let _bulkEnrollJobRunning = false;

export function isBulkEnrollJobRunning(): boolean {
  return _bulkEnrollJobRunning;
}

export async function getBulkEnrollProgress(): Promise<BulkEnrollProgress> {
  const saved = await storage.getSystemSetting(BULK_ENROLL_PROGRESS_KEY);
  return (saved as BulkEnrollProgress | null) ?? {
    status: "idle",
    sequenceId: 0,
    vertical: "",
    minScore: 70,
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
    errors: 0,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    error: null,
  };
}

export async function cancelBulkEnrollJob(): Promise<void> {
  await storage.setSystemSetting(BULK_ENROLL_CANCEL_KEY, true);
}

export type SequenceChannelLabel = "Email-only" | "Mixed channel" | "SMS/Voice/Ringless requires PEWC";

export async function getSequenceChannelLabel(sequenceId: number): Promise<SequenceChannelLabel> {
  const steps = await storage.getSequenceSteps(sequenceId);
  const hasSmsVoiceRingless = steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  const hasEmail = steps.some(s => s.actionType === "email");
  if (hasSmsVoiceRingless) return "SMS/Voice/Ringless requires PEWC";
  if (hasEmail && steps.filter(s => s.actionType && !["wait", "condition", "task"].includes(s.actionType)).length > 0) {
    return steps.some(s => s.actionType && !["email", "wait", "condition", "task"].includes(s.actionType))
      ? "Mixed channel"
      : "Email-only";
  }
  return "Email-only";
}

export async function previewBulkEnroll(params: {
  vertical: string;
  minScore: number;
  sequenceId?: number;
  campaignId?: number;
}): Promise<BulkEnrollPreviewResult> {
  const { vertical, minScore, sequenceId, campaignId } = params;

  if (!vertical || vertical.trim() === "") {
    throw new Error("vertical is required for bulk enrollment.");
  }
  if (campaignId) {
    throw new Error("Campaign enrollment unsupported until a safe campaign enrollment service exists.");
  }
  if (!sequenceId) {
    throw new Error("sequenceId is required for bulk enrollment.");
  }

  const sequence = await storage.getFollowUpSequence(sequenceId);
  if (!sequence) throw new Error(`Sequence ${sequenceId} not found.`);
  if (sequence.status !== "active") throw new Error(`Sequence ${sequenceId} is not active.`);

  const steps = await storage.getSequenceSteps(sequenceId);
  const requiresPewc = steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  const channelLabel = await getSequenceChannelLabel(sequenceId);

  const rows = await _fetchCandidates(vertical, minScore);

  let eligible = 0;
  let alreadyEnrolled = 0;
  let dncBlocked = 0;
  let optOutBlocked = 0;
  let contactabilityBlocked = 0;
  let pewcBlocked = 0;
  let missingContactMethod = 0;
  let eligibilityBlocked = 0;

  for (const row of rows) {
    if (row.doNotContact) { dncBlocked++; continue; }
    const tier = (row as any).consentTier ?? "cold_no_consent";
    if (tier === "opted_out" || tier === "do_not_contact") { optOutBlocked++; continue; }
    if (!row.email) { missingContactMethod++; continue; }

    if (requiresPewc && tier !== "pewc_full_automation") { pewcBlocked++; continue; }

    const enrollCheck = await canEnrollContactInSequence(row.id, sequence);
    if (!enrollCheck.allowed) { eligibilityBlocked++; continue; }

    const existingEnrollments = await storage.getContactEnrollments(row.id);
    const isEnrolled = existingEnrollments.some(
      e => e.sequenceId === sequenceId && (e.status === "active" || e.status === "paused")
    );
    if (isEnrolled) { alreadyEnrolled++; continue; }

    const contactResult = await evaluateContactability({
      contactId: row.id,
      channel: "email",
      mode: "dryRun",
    });
    if (!contactResult.allowed) { contactabilityBlocked++; continue; }

    eligible++;
  }

  return {
    total: rows.length,
    eligible,
    alreadyEnrolled,
    dncBlocked,
    optOutBlocked,
    contactabilityBlocked,
    pewcBlocked,
    missingContactMethod,
    eligibilityBlocked,
    sequenceChannelLabel: channelLabel,
    requiresTypedConfirmation: eligible >= 100,
  };
}

export async function startBulkEnrollJob(params: {
  vertical: string;
  minScore: number;
  sequenceId?: number;
  campaignId?: number;
}): Promise<void> {
  if (_bulkEnrollJobRunning) {
    throw new Error("A bulk enrollment job is already running.");
  }
  const { vertical, minScore, sequenceId, campaignId } = params;

  if (campaignId) {
    throw new Error("Campaign enrollment unsupported until a safe campaign enrollment service exists.");
  }
  if (!sequenceId) {
    throw new Error("sequenceId is required for bulk enrollment.");
  }

  const sequence = await storage.getFollowUpSequence(sequenceId);
  if (!sequence) throw new Error(`Sequence ${sequenceId} not found.`);
  if (sequence.status !== "active") throw new Error(`Sequence ${sequenceId} is not active.`);
  const cr06Decision = decideCr06SequenceLifecycle(sequence, "bulk_enrollment");
  if (!cr06Decision.allowed) throw new Error(cr06Decision.reasonCode);

  const rows = await _fetchCandidates(vertical, minScore);

  await storage.setSystemSetting(BULK_ENROLL_CANCEL_KEY, false);

  const initProgress: BulkEnrollProgress = {
    status: "running",
    sequenceId,
    vertical,
    minScore,
    total: rows.length,
    processed: 0,
    enrolled: 0,
    alreadyEnrolled: 0,
    dncBlocked: 0,
    optOutBlocked: 0,
    contactabilityBlocked: 0,
    pewcBlocked: 0,
    missingContactMethod: 0,
    eligibilityBlocked: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, initProgress);
  _bulkEnrollJobRunning = true;

  setImmediate(() => {
    runBulkEnrollAsync({ sequence, rows, initProgress }).catch(async (err) => {
      console.error("[BulkEnrollJob] Unhandled error:", err);
      const progress = await getBulkEnrollProgress();
      await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, {
        ...progress,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      _bulkEnrollJobRunning = false;
    });
  });
}

async function runBulkEnrollAsync(opts: {
  sequence: any;
  rows: Array<{ id: number; email: string | null; doNotContact: boolean | null; consentTier?: string | null }>;
  initProgress: BulkEnrollProgress;
}): Promise<void> {
  const { sequence, rows } = opts;
  let progress = { ...opts.initProgress };

  const steps = await storage.getSequenceSteps(sequence.id);
  const requiresPewc = steps.some(s => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
  if (!decideCr06SequenceLifecycle(sequence, "bulk_enrollment").allowed) {
    return;
  }

  try {
    for (const row of rows) {
      const cancelRequested = await storage.getSystemSetting(BULK_ENROLL_CANCEL_KEY);
      if (cancelRequested === true) {
        progress = {
          ...progress,
          status: "cancelled",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, progress);
        break;
      }

      progress.processed++;

      try {
        if (row.doNotContact) { progress.dncBlocked++; continue; }
        const tier = (row as any).consentTier ?? "cold_no_consent";
        if (tier === "opted_out" || tier === "do_not_contact") { progress.optOutBlocked++; continue; }
        if (!row.email) { progress.missingContactMethod++; continue; }

        if (requiresPewc && tier !== "pewc_full_automation") { progress.pewcBlocked++; continue; }

        const enrollCheck = await canEnrollContactInSequence(row.id, sequence);
        if (!enrollCheck.allowed) { progress.eligibilityBlocked++; continue; }

        const existingEnrollments = await storage.getContactEnrollments(row.id);
        const isEnrolled = existingEnrollments.some(
          e => e.sequenceId === sequence.id && (e.status === "active" || e.status === "paused")
        );
        if (isEnrolled) { progress.alreadyEnrolled++; continue; }

        const contactResult = await evaluateContactability({
          contactId: row.id,
          channel: "email",
          mode: "dryRun",
        });
        if (!contactResult.allowed) { progress.contactabilityBlocked++; continue; }

        await storage.createSequenceEnrollment({
          sequenceId: sequence.id,
          contactId: row.id,
          status: "active",
          currentStep: 0,
          nextActionAt: new Date(),
          metadata: { enrolledBy: "bulk_enroll_job", vertical: progress.vertical, minScore: progress.minScore },
        });
        progress.enrolled++;
      } catch (err) {
        console.error(`[BulkEnrollJob] Error processing contact ${row.id}:`, err);
        progress.errors++;
      }

      if (progress.processed % 50 === 0) {
        progress.updatedAt = new Date().toISOString();
        await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, progress);
      }
    }

    if (progress.status === "running") {
      progress = {
        ...progress,
        status: "complete",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, progress);
    }
  } catch (err) {
    progress = {
      ...progress,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.setSystemSetting(BULK_ENROLL_PROGRESS_KEY, progress);
    throw err;
  } finally {
    _bulkEnrollJobRunning = false;
    await storage.setSystemSetting(BULK_ENROLL_CANCEL_KEY, false);
  }
}

async function _fetchCandidates(
  vertical: string,
  minScore: number
): Promise<Array<{ id: number; email: string | null; doNotContact: boolean | null; consentTier: string | null }>> {
  if (!vertical || vertical.trim() === "") {
    throw new Error("vertical is required.");
  }

  const rows = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      doNotContact: contacts.doNotContact,
      consentTier: contacts.consentTier,
      vertical: contacts.vertical,
      leadScore: contacts.leadScore,
    })
    .from(contacts)
    .where(
      sql`${contacts.archivedAt} IS NULL
        AND ${contacts.leadScore} >= ${minScore}
        AND lower(trim(${contacts.vertical})) = lower(trim(${vertical}))`
    )
    .orderBy(contacts.id);

  return rows;
}
