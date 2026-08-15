import { db } from "../db";
import { deals, auditLogs, sequenceEnrollments, followUpSequences } from "@shared/schema";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { storage } from "../storage";
import { evaluateContactability } from "./contactability";

const MAX_RESENDS = 2;
const PROPOSAL_NOT_OPENED_DAYS = 3;

export async function runProposalFollowUpCheck(): Promise<{
  checked: number;
  resendsSent: number;
  skipped: number;
  suppressed: number;
  errors: number;
}> {
  let checked = 0;
  let resendsSent = 0;
  let skipped = 0;
  let suppressed = 0;
  let errors = 0;

  // ── Global-pause gate (upgraded from raw setting to OutboundPauseAuthority + coordinator) ──
  {
    const { authorize } = await import("./outbound-pause-authority");
    const { canExecute } = await import("./outbound-queue-coordinator");
    const decision = await authorize({});
    if (!decision.allowed) {
      console.log(`[ProposalFollowUpWorker] Blocked by OutboundPauseAuthority (reason=${decision.reasonCode})`);
      return { checked, resendsSent, skipped, suppressed, errors };
    }
    const coordOk = await canExecute("proposal-followup");
    if (!coordOk) {
      console.log("[ProposalFollowUpWorker] Blocked by coordinator hold on 'proposal-followup'");
      return { checked, resendsSent, skipped, suppressed, errors };
    }
  }

  try {
    const cutoff = new Date(Date.now() - PROPOSAL_NOT_OPENED_DAYS * 24 * 60 * 60 * 1000);

    // Find deals where the proposal was sent (or previously re-sent) more than 3 days ago
    // and the contact still hasn't viewed it.
    const eligibleDeals = await db
      .select()
      .from(deals)
      .where(
        and(
          inArray(deals.proposalStatus, ["sent", "resent"]),
          isNotNull(deals.proposalEmailSentAt),
          lt(deals.proposalEmailSentAt, cutoff),
        ),
      );

    for (const deal of eligibleDeals) {
      checked++;
      try {
        if (!deal.contactId) {
          skipped++;
          continue;
        }

        // ── Sequence-collision guard ─────────────────────────────────────────
        // If the contact is already in an active/paused "proposal" family
        // sequence, skip the worker send to avoid double-messaging.
        const proposalSequenceRows = await db
          .select({ id: followUpSequences.id })
          .from(followUpSequences)
          .where(
            sql`lower(${followUpSequences.name}) LIKE '%proposal%' OR ${followUpSequences.sequenceFamily} LIKE '%proposal%'`,
          );

        if (proposalSequenceRows.length > 0) {
          const proposalSeqIds = new Set(proposalSequenceRows.map((r) => r.id));
          const existingEnrollments = await db
            .select({ sequenceId: sequenceEnrollments.sequenceId, status: sequenceEnrollments.status })
            .from(sequenceEnrollments)
            .where(
              and(
                eq(sequenceEnrollments.contactId, deal.contactId),
                inArray(sequenceEnrollments.status, ["active", "paused"]),
              ),
            );

          const alreadyEnrolled = existingEnrollments.some(
            (e) => e.sequenceId != null && proposalSeqIds.has(e.sequenceId),
          );

          if (alreadyEnrolled) {
            console.log(
              `[ProposalFollowUpWorker] Contact #${deal.contactId} already has active/paused proposal-family sequence enrollment — skipping deal #${deal.id}`,
            );
            await storage.createAuditLog({
              action: "proposal_resend_skipped_sequence_collision",
              entityType: "deal",
              entityId: deal.id,
              actorType: "system",
              details: {
                contactId: deal.contactId,
                reason: "active_proposal_sequence_enrollment_exists",
              },
            });
            skipped++;
            continue;
          }
        }

        // ── Suppression gate ────────────────────────────────────────────────
        // Enforce opt-out, doNotAutoContact, bounce, and DNC before any send.
        const contactability = await evaluateContactability({
          contactId: deal.contactId,
          channel: "email",
          campaignType: "proposal_followup",
          mode: "enforcement",
        });

        if (!contactability.allowed) {
          await storage.createAuditLog({
            action: "proposal_resend_suppressed",
            entityType: "deal",
            entityId: deal.id,
            actorType: "system",
            details: {
              contactId: deal.contactId,
              reason: contactability.reason,
              consentTier: contactability.consentTier,
              nextBestCompliantAction: contactability.nextBestCompliantAction,
            },
          });
          suppressed++;
          continue;
        }

        // Count prior automated resend attempts for this deal
        const [{ resendCount }] = await db
          .select({ resendCount: sql<number>`COUNT(*)::int` })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, "proposal_resend_triggered"),
              eq(auditLogs.entityType, "deal"),
              eq(auditLogs.entityId, deal.id),
            ),
          );

        if (resendCount >= MAX_RESENDS) {
          // Already hit the resend cap — do not spam the contact further.
          skipped++;
          continue;
        }

        const attemptNumber = resendCount + 1;

        const { sendProposalFollowUpEmail } = await import("./proposal-engine");
        const sent = await sendProposalFollowUpEmail(deal.id, attemptNumber);

        if (!sent) {
          skipped++;
          continue;
        }

        // Mark as resent so the pipeline UI reflects the re-send state.
        await storage.updateDeal(deal.id, { proposalStatus: "resent" });

        await storage.createAuditLog({
          action: "proposal_resend_triggered",
          entityType: "deal",
          entityId: deal.id,
          actorType: "system",
          details: {
            attemptNumber,
            contactId: deal.contactId,
            proposalToken: deal.proposalToken,
            originalSentAt: deal.proposalEmailSentAt?.toISOString(),
            resendWindow: `${PROPOSAL_NOT_OPENED_DAYS} days`,
          },
        });

        resendsSent++;
      } catch (rowErr: any) {
        console.error(`[ProposalFollowUpWorker] Error processing deal #${deal.id}:`, rowErr.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[ProposalFollowUpWorker] Fatal error:", err.message);
    errors++;
  }

  console.log(
    `[ProposalFollowUpWorker] Done — ${checked} deals checked, ${resendsSent} resends sent, ` +
    `${suppressed} suppressed (opt-out/DNC), ${skipped} skipped, ${errors} errors`,
  );
  return { checked, resendsSent, skipped, suppressed, errors };
}
