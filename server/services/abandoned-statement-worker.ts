import { storage } from "../storage";
import { db } from "../db";
import { tasks } from "@shared/schema";
import { and, eq, ilike } from "drizzle-orm";

const STATEMENT_CHASE_SEQ_NAME = "SDR: Statement Chase";
const STATEMENT_CHASE_CATEGORY = "sdr_statement_chase";

export async function runAbandonedStatementCheck(): Promise<{ checked: number; tasksCreated: number; enrolled: number; errors: number }> {
  let checked = 0;
  let tasksCreated = 0;
  let enrolled = 0;
  let errors = 0;

  try {
    const openRequests = await storage.listOpenStatementRequests(3);

    for (const req of openRequests) {
      checked++;
      try {
        const marker = `statement_request_id:${req.id}`;
        // Statement requests retain their original subject for evidence, but
        // any live enrollment must use the fail-closed redirect resolution.
        const { resolveLiveContactRedirect } = await import("./contact-identity");
        const redirect = await resolveLiveContactRedirect(req.contactId);
        const liveContactId = redirect.effectiveContactId;

        const existingTask = await db.select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.contactId, req.contactId),
              eq(tasks.status, "pending"),
              ilike(tasks.description, `%${marker}%`),
            ),
          )
          .limit(1);

        if (existingTask.length > 0) {
          continue;
        }

        // ── Sequence enrollment ──────────────────────────────────────────────────
        // Attempt to enroll the contact in the statement-chase sequence before
        // creating the task so we can embed the enrollment status in the
        // description.  All errors are non-fatal; the rep task is always created.
        let enrollmentNote = "";
        let enrollmentId: number | null = null;

        try {
          const { canEnrollContactInSequence } = await import("./sequence-eligibility");
          const allSeqs = await storage.getFollowUpSequences().catch(() => []);

          const chaseSeq = allSeqs.find(
            (s: any) =>
              s.name === STATEMENT_CHASE_SEQ_NAME ||
              (s.triggerConfig as any)?.category === STATEMENT_CHASE_CATEGORY,
          );

          if (!chaseSeq) {
            enrollmentNote = " (Statement-chase sequence not found in library — rep follow-up required.)";
          } else if (chaseSeq.status !== "active") {
            enrollmentNote = ` (Statement-chase sequence is ${chaseSeq.status} — automated outreach skipped.)`;
          } else {
            // Family-level dedup: skip if already actively enrolled
            const existingEnrollments = await storage.getContactEnrollments(liveContactId).catch(() => []);
            const alreadyEnrolled = existingEnrollments.some(
              (e: any) =>
                e.sequenceId === chaseSeq.id &&
                (e.status === "active" || e.status === "paused"),
            );

            if (alreadyEnrolled) {
              enrollmentNote = " (Contact already enrolled in statement-chase sequence — automated outreach ongoing.)";
            } else {
            const eligibility = await canEnrollContactInSequence(liveContactId, {
                id: chaseSeq.id,
                name: chaseSeq.name,
                status: chaseSeq.status,
                sequenceFamily: chaseSeq.sequenceFamily,
                eligibleConsentTiers: chaseSeq.eligibleConsentTiers,
                lifecycleStagesAllowed: chaseSeq.lifecycleStagesAllowed,
              });

              if (eligibility.allowed) {
                const enrollment = await storage.createSequenceEnrollment({
                  sequenceId: chaseSeq.id,
                  contactId: liveContactId,
                  status: "active",
                  nextActionAt: new Date(),
                  currentStep: 0,
                });

                if (enrollment) {
                  enrollmentId = enrollment.id;
                  enrolled++;
                  enrollmentNote =
                    ` Enrolled in "${STATEMENT_CHASE_SEQ_NAME}" (enrollment #${enrollment.id}).` +
                    " To stop automated outreach for this contact, mark them Do Not Contact.";

                  await storage.createAuditLog({
                    action: "abandoned_statement_sequence_enrolled",
                    entityType: "contact",
                    entityId: liveContactId,
                    actorType: "system",
                    details: {
                      statementRequestId: req.id,
                      sequenceId: chaseSeq.id,
                      sequenceName: chaseSeq.name,
                      enrollmentId: enrollment.id,
                      requestedContactId: req.contactId,
                      redirectOperationIds: redirect.operationIds,
                    },
                  });
                }
              } else {
                enrollmentNote = ` (Sequence enrollment blocked: ${eligibility.reason})`;
                console.log(
                  `[AbandonedStatementWorker] Enrollment blocked for contact #${req.contactId}: ${eligibility.reason}`,
                );
              }
            }
          }
        } catch (seqErr: any) {
          console.warn(
            `[AbandonedStatementWorker] Sequence enrollment skipped for request #${req.id}:`,
            seqErr.message,
          );
        }

        // ── Rep task ─────────────────────────────────────────────────────────────
        await storage.createAuthorityTask({
          contactId: req.contactId,
          dealId: req.dealId ?? undefined,
          title: "Follow up: merchant statement upload not completed",
          description: `Merchant has not uploaded their statement. ${marker}.${enrollmentNote}`,
          priority: "normal",
          status: "pending",
        });

        await storage.updateStatementRequest(req.id, {
          lastReminderTaskAt: new Date(),
        });

        await storage.createAuditLog({
          action: "abandoned_statement_task_created",
          entityType: "contact",
          entityId: req.contactId,
          actorType: "system",
          details: {
            statementRequestId: req.id,
            marker,
            requestedAt: req.requestedAt.toISOString(),
            enrollmentId,
          },
        });

        tasksCreated++;
      } catch (rowErr: any) {
        console.error(`[AbandonedStatementWorker] Error processing request #${req.id}:`, rowErr.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[AbandonedStatementWorker] Fatal error:", err.message);
    errors++;
  }

  console.log(
    `[AbandonedStatementWorker] Done — ${checked} requests checked, ${tasksCreated} tasks created, ${enrolled} sequence enrollments, ${errors} errors`,
  );
  return { checked, tasksCreated, enrolled, errors };
}
