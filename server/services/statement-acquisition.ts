/**
 * Statement Acquisition Service
 *
 * Automatically chases statements when a contact enters STATEMENT_REQUESTED
 * state. When a statement is uploaded, stops the chase and triggers analysis.
 *
 * Flow:
 *   STATEMENT_REQUESTED lifecycle →
 *     enrollment in statement-chase sequence →
 *     rep task created (2h deadline) →
 *     analysis auto-queued on upload →
 *   STATEMENT_RECEIVED + STATEMENT_ANALYZED lifecycle advancement
 */

import { storage } from "../storage";
import { db } from "../db";
import { sequenceEnrollments } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── Statement Requested trigger ─────────────────────────────────────────────

/**
 * Called fire-and-forget from LifecycleService when a contact transitions to
 * STATEMENT_REQUESTED. Finds the contact's active sales deal, and enrolls in
 * the statement-chase sequence if not already enrolled.
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

    // Advance deal stage to "Statement Requested" if not already there
    if (activeDeal && activeDeal.stage !== "Statement Requested") {
      await storage.updateDeal(activeDeal.id, { stage: "Statement Requested" });
    }

    // Look for any active sequence with "statement" or "switch & save" in name
    const sequences = await storage.getFollowUpSequences();
    const statementSequence = sequences.find(
      s => s.status === "active" && (
        s.name.toLowerCase().includes("statement") ||
        s.name.toLowerCase().includes("switch & save")
      ),
    );

    if (statementSequence) {
      // Check for existing active enrollment (direct query — storage has no contact+sequence filter)
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
          },
        });
        console.log(`[StatementAcquisition] Enrolled contact ${contactId} in "${statementSequence.name}" (deal ${dealId})`);
      }
    }

    // Create a rep task as fallback (fires regardless of sequence)
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
    });

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
      });
    }

    // Advance lifecycle to STATEMENT_RECEIVED
    const { LifecycleService } = await import("./lifecycle-service");
    await LifecycleService.transition(contactId, "STATEMENT_RECEIVED", {
      trigger: "statement_uploaded",
      actorType: "system",
      source: "statement_acquisition",
    }).catch(() => {/* may already be at this state */});

    // Enqueue statement analysis for the deal
    if (dealId) {
      const { enqueueStatementAnalysis } = await import("./queue-manager");
      await enqueueStatementAnalysis(dealId).catch(err =>
        console.warn(`[StatementAcquisition] Could not enqueue analysis for deal ${dealId}:`, err.message),
      );
    }

  } catch (err) {
    console.warn(`[StatementAcquisition] onStatementReceived error for contact ${contactId}:`, (err as Error).message);
  }
}

// ─── SLA escalation check ─────────────────────────────────────────────────────

/**
 * Called from the SLA worker loop. Finds deals stuck in Statement Requested
 * for more than `stallDays` days and creates escalation tasks (once per 24h).
 */
export async function checkStatementAcquisitionStalls(stallDays = 5): Promise<{ escalated: number }> {
  let escalated = 0;
  try {
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
        details: { daysStuck, contactId: deal.contactId, companyName },
      }).catch(() => {});

      escalated++;
    }
  } catch (err) {
    console.warn("[StatementAcquisition] checkStatementAcquisitionStalls error:", (err as Error).message);
  }
  return { escalated };
}
