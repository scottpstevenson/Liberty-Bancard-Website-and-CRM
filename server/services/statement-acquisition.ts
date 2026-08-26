/**
 * Statement Acquisition Service
 *
 * Automatically chases statements when a contact enters STATEMENT_REQUESTED
 * state. When a statement is uploaded, stops the chase and triggers analysis.
 *
 * Flow:
 *   STATEMENT_REQUESTED lifecycle →
 *     syncStatementChaseSteps() — apply cadence config to DB step delays →
 *     enrollment in "Statement Chase (Auto)" sequence →
 *     rep task created (2h deadline) →
 *     analysis auto-queued on upload →
 *   STATEMENT_RECEIVED → STATEMENT_ANALYZED lifecycle advancement
 *
 * Cadence is configurable via system_settings key "statement_acquisition_config":
 *   {
 *     upload_nudge_sms_hours:    24,   // hours from enrollment to SMS nudge (step 2)
 *     rep_task_hours:            48,   // hours from enrollment to rep task (step 3)
 *     educational_email_hours:   72,   // hours from enrollment to edu email (step 4)
 *     stall_escalation_days:      5,   // days stuck before escalation task fires
 *   }
 *
 * All four values must be finite, non-negative integers.
 * upload_nudge_sms_hours ≥ 1, rep_task_hours > upload_nudge_sms_hours,
 * educational_email_hours > rep_task_hours.
 *
 * Changing any value takes effect on the NEXT enrollment (syncStatementChaseSteps
 * updates the DB rows that the sequence worker reads at execution time).
 */

import { storage } from "../storage";
import { db } from "../db";
import { sequenceEnrollments, followUpSequences, sequenceSteps } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { advanceDealStage } from "./deal-stage-service";

// ─── Cadence config ───────────────────────────────────────────────────────────

export interface AcquisitionConfig {
  upload_nudge_sms_hours: number;
  rep_task_hours: number;
  educational_email_hours: number;
  stall_escalation_days: number;
}

export const DEFAULT_CONFIG: AcquisitionConfig = {
  upload_nudge_sms_hours: 24,
  rep_task_hours: 48,
  educational_email_hours: 72,
  stall_escalation_days: 5,
};

/** Validates that a config object is well-formed; throws descriptively on error. */
export function validateAcquisitionConfig(cfg: Partial<AcquisitionConfig>): AcquisitionConfig {
  const merged: AcquisitionConfig = { ...DEFAULT_CONFIG, ...cfg };
  const { upload_nudge_sms_hours: sms, rep_task_hours: rep, educational_email_hours: edu, stall_escalation_days: stall } = merged;

  for (const [name, val] of [
    ["upload_nudge_sms_hours", sms],
    ["rep_task_hours", rep],
    ["educational_email_hours", edu],
    ["stall_escalation_days", stall],
  ] as [string, number][]) {
    if (!Number.isFinite(val) || val < 0) {
      throw new Error(`[StatementAcquisition] ${name} must be a finite non-negative number; got ${val}`);
    }
    if (!Number.isInteger(val)) {
      throw new Error(`[StatementAcquisition] ${name} must be a whole-hour integer; got ${val}`);
    }
  }
  if (sms < 1) throw new Error("[StatementAcquisition] upload_nudge_sms_hours must be ≥ 1");
  if (rep <= sms) throw new Error(`[StatementAcquisition] rep_task_hours (${rep}) must be > upload_nudge_sms_hours (${sms})`);
  if (edu <= rep) throw new Error(`[StatementAcquisition] educational_email_hours (${edu}) must be > rep_task_hours (${rep})`);

  return merged;
}

export async function getAcquisitionConfig(): Promise<AcquisitionConfig> {
  try {
    const raw = await storage.getSystemSetting("statement_acquisition_config");
    if (raw && typeof raw === "object") {
      return validateAcquisitionConfig(raw as Partial<AcquisitionConfig>);
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_CONFIG;
}

// ─── Sequence step sync ───────────────────────────────────────────────────────

/**
 * Reads the cadence config from system_settings and updates the DB step delays
 * for "Statement Chase (Auto)" so the sequence worker picks up the new timing
 * on the next tick.
 *
 * Step delays are computed as cumulative hours from enrollment:
 *   Step 1 (email):    delay = 0          (immediate)
 *   Step 2 (SMS):      delay = upload_nudge_sms_hours from enrollment
 *                             (= upload_nudge_sms_hours relative to step 1)
 *   Step 3 (task):     delay = rep_task_hours from enrollment
 *                             (= rep_task_hours - upload_nudge_sms_hours relative to step 2)
 *   Step 4 (edu email):delay = educational_email_hours from enrollment
 *                             (= educational_email_hours - rep_task_hours relative to step 3)
 *
 * Also applies consent/eligibility metadata to the sequence row if not already set.
 *
 * @returns The resolved config used for the sync
 */
export async function syncStatementChaseSteps(configOverride?: AcquisitionConfig): Promise<AcquisitionConfig> {
  const config = configOverride ?? await getAcquisitionConfig();

  // Find the sequence
  const [seq] = await db
    .select({ id: followUpSequences.id, eligibleConsentTiers: followUpSequences.eligibleConsentTiers })
    .from(followUpSequences)
    .where(eq(followUpSequences.name, "Statement Chase (Auto)"))
    .limit(1);

  if (!seq) {
    console.warn("[StatementAcquisition] syncStatementChaseSteps: 'Statement Chase (Auto)' sequence not found in DB — run seed");
    return config;
  }

  // Ensure consent/eligibility metadata is set on the sequence row.
  // The seed now carries this data; this backfills any pre-seed DB rows.
  if (!seq.eligibleConsentTiers || seq.eligibleConsentTiers.length === 0) {
    await db
      .update(followUpSequences)
      .set({
        eligibleConsentTiers: ["cold_no_consent", "implied", "explicit", "pewc"],
        channelsAllowed: ["email", "sms", "task"],
        lifecycleStagesAllowed: ["STATEMENT_REQUESTED"],
        sequenceFamily: "statement_acquisition",
      })
      .where(eq(followUpSequences.id, seq.id))
      .catch(err => console.warn("[StatementAcquisition] Could not update sequence metadata:", err.message));
  }

  // Load the existing steps ordered by stepOrder
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, seq.id));
  steps.sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));

  if (steps.length < 4) {
    console.warn(`[StatementAcquisition] syncStatementChaseSteps: expected ≥4 steps, found ${steps.length} — skipping timing sync`);
    return config;
  }

  const { upload_nudge_sms_hours: smsHrs, rep_task_hours: repHrs, educational_email_hours: eduHrs } = config;

  // Convert absolute-from-enrollment hours to per-step relative delays.
  // Step 1 fires immediately; each subsequent step fires relative to the previous.
  const stepDelays: Array<{ delayDays: number; delayHours: number }> = [
    { delayDays: 0, delayHours: 0 },                                                   // Step 1: immediate email
    { delayDays: Math.floor(smsHrs / 24), delayHours: smsHrs % 24 },                  // Step 2: SMS (from step 1)
    { delayDays: Math.floor((repHrs - smsHrs) / 24), delayHours: (repHrs - smsHrs) % 24 }, // Step 3: task (from step 2)
    { delayDays: Math.floor((eduHrs - repHrs) / 24), delayHours: (eduHrs - repHrs) % 24 }, // Step 4: edu email (from step 3)
  ];

  for (let i = 0; i < Math.min(steps.length, stepDelays.length); i++) {
    const step = steps[i];
    const { delayDays, delayHours } = stepDelays[i];
    if (step.delayDays !== delayDays || step.delayHours !== delayHours) {
      await storage.updateSequenceStep(step.id, { delayDays, delayHours }).catch(err =>
        console.warn(`[StatementAcquisition] Could not update step ${step.id} delay:`, err.message),
      );
    }
  }

  console.log(
    `[StatementAcquisition] syncStatementChaseSteps: applied config sms=${smsHrs}h rep=${repHrs}h edu=${eduHrs}h`,
  );
  return config;
}

// ─── Statement Requested trigger ─────────────────────────────────────────────

/**
 * Called fire-and-forget from LifecycleService when a contact transitions to
 * STATEMENT_REQUESTED. Syncs the sequence step delays from config, then enrolls
 * the contact in "Statement Chase (Auto)" if not already enrolled.
 */
export async function onStatementRequested(contactId: number): Promise<void> {
  try {
    // Find the active sales deal for this contact
    const dealsForContact = await storage.getDealsByContact(contactId);
    const activeDeal = dealsForContact.find(
      d => d.pipeline === "sales" &&
           d.stage !== "Closed Won" && d.stage !== "Closed Lost",
    );

    const contact = await storage.getContact(contactId);
    if (!contact) return;

    const dealId = activeDeal?.id;

    // Re-read the contact first. If the lifecycle has already advanced past
    // STATEMENT_REQUESTED (e.g., an upload arrived while this fire-and-forget
    // handler was mid-execution), skip all writes and enrollment entirely.
    const refreshedContact = await storage.getContact(contactId);
    if (!refreshedContact || refreshedContact.lifecycleState !== "STATEMENT_REQUESTED") {
      console.log(`[StatementAcquisition] Skipping enrollment — contact ${contactId} is now in state "${refreshedContact?.lifecycleState}" (no longer STATEMENT_REQUESTED)`);
      return;
    }

    // Advance deal stage to "Statement Requested" ONLY if it is still at a
    // pre-request stage. Re-read the deal fresh (not the stale snapshot from
    // above) so a concurrent upload that set "Statement Received" is respected.
    // This is the conditional stage guard that prevents the race regression.
    const PRE_REQUEST_STAGES = new Set([
      "Discovery", "Appointment Set", "Appointment Completed", "Follow-Up",
      "Warm Lead", "New", "",
    ]);
    if (dealId) {
      const freshDeal = await storage.getDeal(dealId);
      if (freshDeal && PRE_REQUEST_STAGES.has(freshDeal.stage ?? "")) {
        await advanceDealStage(dealId, "Statement Requested", "statement_acquisition_requested", {
          reason: "Conditional statement acquisition progression",
          actor: "system",
          expectedStage: freshDeal.stage,
        });
      } else if (freshDeal) {
        console.log(`[StatementAcquisition] Deal ${dealId} is at stage "${freshDeal.stage}" — not overwriting with "Statement Requested"`);
      }
    }

    // Sync sequence step delays from system_settings cadence config.
    // This ensures any admin-tuned cadence takes effect before enrollment.
    const config = await syncStatementChaseSteps().catch(err => {
      console.warn("[StatementAcquisition] syncStatementChaseSteps failed (non-fatal):", err.message);
      return DEFAULT_CONFIG;
    });

    // Prefer the dedicated "Statement Chase (Auto)" sequence; fall back to any
    // active sequence with "statement" or "switch & save" in the name.
    const sequences = await storage.getFollowUpSequences();
    const statementSequence =
      sequences.find(s => s.status === "active" && s.name === "Statement Chase (Auto)") ??
      sequences.find(
        s => s.status === "active" && (
          s.name.toLowerCase().includes("statement") ||
          s.name.toLowerCase().includes("switch & save")
        ),
      );

    if (statementSequence) {
      // #1385 — Check autoEnrollmentSuppressedAt before re-enrolling.
      // If a rep manually stopped the statement-chase sequence (or set the
      // suppression flag from the deal detail panel), do not re-enroll.
      if (activeDeal?.autoEnrollmentSuppressedAt) {
        await storage.createAuditLog({
          action: "statement_acquisition_suppressed",
          entityType: "contact",
          entityId: contactId,
          details: {
            dealId,
            sequenceId: statementSequence.id,
            sequenceName: statementSequence.name,
            suppressedAt: activeDeal.autoEnrollmentSuppressedAt,
            suppressedReason: activeDeal.autoEnrollmentSuppressedReason ?? "manual_stop",
            trigger: "STATEMENT_REQUESTED lifecycle transition",
          },
        });
        console.log(
          `[StatementAcquisition] Enrollment blocked for contact ${contactId} — deal ${dealId} has autoEnrollmentSuppressedAt set (${activeDeal.autoEnrollmentSuppressedAt.toISOString()})`
        );
        return;
      }

      // Check for existing active enrollment
      const existing = await db.select({ id: sequenceEnrollments.id })
        .from(sequenceEnrollments)
        .where(
          and(
            eq(sequenceEnrollments.contactId, contactId),
            eq(sequenceEnrollments.sequenceId, statementSequence.id),
            inArray(sequenceEnrollments.status, ["active", "paused"]),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await storage.createSequenceEnrollment({
          contactId,
          sequenceId: statementSequence.id,
          dealId: dealId ?? null,
          status: "active",
          currentStep: 0,
          nextActionAt: new Date(),
          metadata: {
            trigger: "lifecycle_statement_requested",
            autoEnrolled: true,
            cadenceConfig: {
              upload_nudge_sms_hours: config.upload_nudge_sms_hours,
              rep_task_hours: config.rep_task_hours,
              educational_email_hours: config.educational_email_hours,
            },
          },
        });

        await storage.createAuditLog({
          action: "statement_acquisition_enrolled",
          entityType: "contact",
          entityId: contactId,
          details: {
            sequenceId: statementSequence.id,
            sequenceName: statementSequence.name,
            dealId,
            trigger: "STATEMENT_REQUESTED lifecycle transition",
            cadence: {
              smsNudgeHours: config.upload_nudge_sms_hours,
              repTaskHours: config.rep_task_hours,
              educationalEmailHours: config.educational_email_hours,
            },
          },
        });
        console.log(`[StatementAcquisition] Enrolled contact ${contactId} in "${statementSequence.name}" (deal ${dealId})`);
      }
    }

    // Create a rep task as immediate action fallback (fires regardless of sequence)
    const companyName = contact.companyName || contact.firstName || `Contact #${contactId}`;
    await (storage.createTask as Function)({
      contactId,
      dealId: dealId ?? undefined,
      title: `Send statement request to ${companyName}`,
      description: `Contact entered Statement Requested stage. Send the secure upload link and follow up until received.`,
      priority: "high",
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h
      assignedTo: activeDeal?.owner ?? undefined,
      source: "statement_acquisition",
      automationKey: `statement-request-${contactId}`,
    }).catch((err: Error) => console.warn(`[StatementAcquisition] Could not create rep task for contact ${contactId}:`, err.message));

  } catch (err) {
    console.warn(`[StatementAcquisition] onStatementRequested error for contact ${contactId}:`, (err as Error).message);
  }
}

// ─── Statement Received — stop the chase ─────────────────────────────────────

/**
 * Called when a statement document is successfully uploaded.
 * Stops any active statement-chase sequence enrollments and queues analysis.
 */
export async function onStatementReceived(contactId: number, dealId?: number): Promise<void> {
  try {
    // Find all active enrollments for this contact
    const enrollments = await db.select()
      .from(sequenceEnrollments)
      .where(
        and(
          eq(sequenceEnrollments.contactId, contactId),
          inArray(sequenceEnrollments.status, ["active", "paused"]),
        ),
      );

    // Identify statement-related sequences by name
    const sequences = await storage.getFollowUpSequences();
    const statementSeqIds = new Set(
      sequences
        .filter(s =>
          s.name === "Statement Chase (Auto)" ||
          s.name.toLowerCase().includes("statement") ||
          s.name.toLowerCase().includes("switch & save"),
        )
        .map(s => s.id),
    );

    for (const enrollment of enrollments) {
      if (!enrollment.sequenceId || !statementSeqIds.has(enrollment.sequenceId)) continue;

      await storage.updateSequenceEnrollment(enrollment.id, {
        status: "completed",
        completedAt: new Date(),
      });
      await storage.createAuditLog({
        action: "statement_acquisition_stopped",
        entityType: "contact",
        entityId: contactId,
        details: {
          enrollmentId: enrollment.id,
          sequenceId: enrollment.sequenceId,
          reason: "statement_received",
          dealId,
        },
      });
      console.log(`[StatementAcquisition] Stopped enrollment ${enrollment.id} for contact ${contactId} — statement received`);
    }

    // Complete any open "send statement request" rep tasks for this contact
    const openTasks = await storage.getTasks();
    const statementTasks = openTasks.filter(
      (t: any) =>
        t.contactId === contactId &&
        t.status === "pending" &&
        t.automationKey === `statement-request-${contactId}`,
    );
    for (const t of statementTasks) {
      await (storage.updateTask as Function)(t.id, {
        status: "completed",
        completedAt: new Date(),
      }).catch(() => {});
    }

    // Advance the deal stage to "Statement Received" ONLY if it is currently at
    // "Statement Requested". Never regress a deal already past this stage (e.g.,
    // Proposal Sent, Underwriting, Closed Won/Lost). This prevents a late or
    // duplicate upload from moving an already-progressed deal backwards.
    const STATEMENT_PRE_RECEIPT_STAGES = new Set(["Statement Requested", "Statement Received"]);
    if (dealId) {
      const deal = await storage.getDeal(dealId).catch(() => null);
      if (deal && deal.stage === "Statement Requested") {
        await advanceDealStage(dealId, "Statement Received", "statement_acquisition_received", {
          reason: "Statement upload received",
          actor: "system",
          expectedStage: deal.stage,
        }).catch(err =>
          console.warn(`[StatementAcquisition] Could not advance deal ${dealId} to Statement Received:`, err.message),
        );
      }
    } else {
      // No explicit dealId — find the active sales deal at the expected stage
      try {
        const dealsForContact = await storage.getDealsByContact(contactId);
        const activeDeal = dealsForContact.find(
          d => d.pipeline === "sales" && d.stage === "Statement Requested",
        );
        if (activeDeal) {
          await advanceDealStage(activeDeal.id, "Statement Received", "statement_acquisition_received", {
            reason: "Statement upload received",
            actor: "system",
            expectedStage: activeDeal.stage,
          }).catch(err =>
            console.warn(`[StatementAcquisition] Could not advance deal ${activeDeal.id} to Statement Received:`, err.message),
          );
        }
      } catch {
        // non-fatal
      }
    }
    void STATEMENT_PRE_RECEIPT_STAGES; // referenced for documentation clarity

    // Advance lifecycle to STATEMENT_RECEIVED
    const { LifecycleService } = await import("./lifecycle-service");
    await LifecycleService.transition(contactId, "STATEMENT_RECEIVED", {
      trigger: "statement_uploaded",
      actorType: "system",
      source: "statement_acquisition",
    }).catch(() => {/* may already be at this state or further */});

    // NOTE: Analysis enqueueing is intentionally NOT done here.
    // The upload chain (statement-upload-chain.ts STEP 5) and queue-manager exclusively
    // own enqueueing to prevent duplicate jobs. onStatementReceived() is responsible
    // only for stopping the chase, advancing the deal stage, and advancing lifecycle.

  } catch (err) {
    console.warn(`[StatementAcquisition] onStatementReceived error for contact ${contactId}:`, (err as Error).message);
  }
}

// ─── Post-analysis lifecycle advancement ─────────────────────────────────────

/**
 * Called by queue-manager after statement analysis completes successfully.
 * Advances the contact's lifecycle to STATEMENT_ANALYZED and triggers NBA
 * recompute (LifecycleService.transition fires NBA invalidation automatically).
 */
export async function onStatementAnalyzed(contactId: number, dealId: number): Promise<void> {
  try {
    const { LifecycleService } = await import("./lifecycle-service");
    await LifecycleService.transition(contactId, "STATEMENT_ANALYZED", {
      trigger: "statement_analysis_complete",
      actorType: "system",
      source: "statement_acquisition",
      metadata: { dealId },
    }).catch(() => {/* may already be at this state or further */});

    console.log(`[StatementAcquisition] Contact ${contactId} advanced to STATEMENT_ANALYZED (deal ${dealId})`);
  } catch (err) {
    console.warn(`[StatementAcquisition] onStatementAnalyzed error for contact ${contactId}:`, (err as Error).message);
  }
}

// ─── SLA escalation check ─────────────────────────────────────────────────────

/**
 * Called from the SLA worker loop. Finds deals stuck in Statement Requested
 * for more than `stallDays` days and creates escalation tasks (once per 24h).
 * `stallDays` defaults to the value in system_settings (stall_escalation_days),
 * falling back to 5 days if not configured.
 */
export async function checkStatementAcquisitionStalls(stallDaysOverride?: number): Promise<{ escalated: number }> {
  let escalated = 0;
  try {
    const config = await getAcquisitionConfig();
    const stallDays = stallDaysOverride ?? config.stall_escalation_days;
    const stallMinutes = stallDays * 24 * 60;
    const stuckDeals = await storage.getDealsStuckInStage("Statement Requested", stallMinutes).catch(() => [] as any[]);

    for (const deal of stuckDeals) {
      if (!deal.contactId) continue;

      // Throttle: skip if already escalated in last 24h
      const recent = await storage.getAuditLogs({
        entityType: "deal",
        entityId: deal.id,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        limit: 10,
      }).catch(() => [] as any[]);
      const alreadyEscalated = recent.some((l: any) => l.action === "statement_stall_escalated");
      if (alreadyEscalated) continue;

      const contact = await storage.getContact(deal.contactId).catch(() => null);
      const companyName = contact?.companyName || contact?.firstName || `Deal #${deal.id}`;
      const daysStuck = Math.round((Date.now() - new Date(deal.updatedAt!).getTime()) / 86400000);

      await (storage.createTask as Function)({
        contactId: deal.contactId,
        dealId: deal.id,
        title: `Statement stalled ${daysStuck}d — follow up with ${companyName}`,
        description: `${companyName} has been in "Statement Requested" for ${daysStuck} days with no statement uploaded. Try a personal outreach.`,
        priority: "high",
        dueDate: new Date(Date.now() + 60 * 60 * 1000),
        assignedTo: deal.owner ?? undefined,
        source: "statement_acquisition",
        automationKey: `statement-stall-${deal.id}`,
      }).catch(() => {});

      await storage.createAuditLog({
        action: "statement_stall_escalated",
        entityType: "deal",
        entityId: deal.id,
        details: { daysStuck, contactId: deal.contactId, companyName, stallDays },
      }).catch(() => {});

      escalated++;
    }
  } catch (err) {
    console.warn("[StatementAcquisition] checkStatementAcquisitionStalls error:", (err as Error).message);
  }
  return { escalated };
}
