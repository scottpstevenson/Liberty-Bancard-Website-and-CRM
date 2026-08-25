import { storage } from "../storage";
import { db } from "../db";
import { merchantApplications } from "@shared/schema";
import { lt, and, or, eq, sql } from "drizzle-orm";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const ABANDON_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours stale before attempting recovery
const ABANDON_REMINDER_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours between nudges per application
const ABANDON_MAX_PER_RUN = 30;

export async function runOnboardingReminderTick(): Promise<{ processed: number; reminded: number; errors: number }> {
  let processed = 0;
  let reminded = 0;
  let errors = 0;

  // ── Global-pause gate — canonical authority with fail-closed semantics ──
  const { authorize: pauseAuthorize } = await import("./outbound-pause-authority");
  const pauseDecision = await pauseAuthorize({}).catch(() => ({ allowed: false }));
  if (!pauseDecision.allowed) {
    console.log("[OnboardingReminder] Global outbound pause active — skipping entire run");
    return { processed, reminded, errors };
  }

  try {
    const { data: allDeals } = await storage.getDeals({ limit: 5000 });
    const onboardingDeals = allDeals.filter(d =>
      d.pipeline === "onboarding" &&
      !d.archivedAt &&
      d.boardingStatus !== "approved" &&
      d.stage !== "Active"
    );

    const twoDaysAgo = new Date(Date.now() - TWO_DAYS_MS);

    for (const deal of onboardingDeals) {
      processed++;
      try {
        const checklistItems = await storage.getOnboardingChecklistItems(deal.id);
        if (!checklistItems || checklistItems.length === 0) continue;

        const stalePendingItems = checklistItems.filter(item => {
          const isStale = item.status === "not_requested" || item.status === "requested";
          const lastUpdated = new Date(item.updatedAt || item.createdAt || Date.now());
          return isStale && lastUpdated < twoDaysAgo;
        });

        if (stalePendingItems.length === 0) continue;

        await storage.createAuditLog({
          action: "onboarding_reminder_triggered",
          entityType: "deal",
          entityId: deal.id,
          details: {
            stalePendingItems: stalePendingItems.map(i => ({ key: i.itemKey, status: i.status })),
            count: stalePendingItems.length,
          },
        });

        const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;

        // Wave 1A: Route reminder email through ChannelOrchestrator instead of
        // triggering a GHL native workflow directly. Liberty now composes the message
        // and the orchestrator routes it through the GHL email transport.
        if (contact && deal.contactId) {
          // Durable 24-hour cooldown: check for a recent successful send BEFORE
          // acquiring any lock, so the audit log is the authoritative idempotency
          // record that survives restarts, redeploys, and TTL expiry.
          const recentSendResult = await db.execute(sql`
            SELECT id FROM audit_logs
            WHERE action = 'onboarding_reminder_sent'
              AND entity_type = 'contact'
              AND entity_id = ${deal.contactId}
              AND created_at > NOW() - INTERVAL '24 hours'
            LIMIT 1
          `);
          if (recentSendResult.rows.length > 0) {
            console.log(`[OnboardingReminder] Contact ${deal.contactId} already reminded in last 24h — skipping`);
            continue;
          }

          // Concurrent-execution lock: prevent two workers in the same deployment
          // from racing on the same contact within the same worker-tick window.
          // We do NOT release this lock on success — the audit log above is the
          // source of truth for the 24h cooldown; the lock's 20-min TTL only
          // prevents intra-tick duplication.
          const { acquireJobLock, releaseJobLock } = await import("./job-registry");
          const lockKey = `onboarding-reminder:${deal.contactId}`;
          const reminderLease = await acquireJobLock(lockKey);
          if (reminderLease.status !== "acquired") {
            console.log(`[OnboardingReminder] Lock already held for contact ${deal.contactId} — skipping duplicate send`);
            continue;
          }
          const reminderLock = reminderLease.lockToken;

          const { channelOrchestrator } = await import("./transports/index");
          const contactName =
            contact.companyName ||
            [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
            "Merchant";
          const pendingItems = stalePendingItems.map(i => `<li>${i.itemKey}</li>`).join("");
          const reminderSubject = `Action Required: ${stalePendingItems.length} Onboarding Item${stalePendingItems.length > 1 ? "s" : ""} Pending`;
          const reminderBody = `<p>Hi ${contactName},</p><p>Your Liberty Bancard onboarding has ${stalePendingItems.length} item${stalePendingItems.length > 1 ? "s" : ""} that still need${stalePendingItems.length === 1 ? "s" : ""} attention:</p><ul>${pendingItems}</ul><p>Please complete these items so we can finish activating your account. Reply to this email or contact your account manager if you need help.</p>`;
          // channelOrchestrator.sendEmail() resolves (never rejects) for both
          // success and failure; we must inspect result.success explicitly.
          let orchResult: { success: boolean; skipReason?: string; error?: string } = { success: false };
          try {
            orchResult = await channelOrchestrator.sendEmail(
              {
                contactId: deal.contactId,
                subject: reminderSubject,
                body: reminderBody,
                category: "onboarding",
              },
              {
                // Full compliance fence — onboarding reminders respect DNC and global pause
                // pauseExceptionKey is intentionally absent — standard automated send
              },
            );
          } catch (orchErr: any) {
            // Unexpected throw (e.g. Redis down) — treat as failure
            console.error(`[OnboardingReminder] Orchestrator threw for deal ${deal.id}:`, orchErr.message);
            orchResult = { success: false, error: orchErr.message };
          }

          if (orchResult.success) {
            // Write the durable idempotency record ONLY when delivery confirmed.
            // Await the write — if it fails, we do NOT retain the success lock so
            // the audit-log-based 24h dedup will not suppress the next tick.
            let auditWritten = false;
            try {
              await storage.createAuditLog({
                action: "onboarding_reminder_sent",
                entityType: "contact",
                entityId: deal.contactId!,
                details: { dealId: deal.id, stalePendingCount: stalePendingItems.length },
              });
              auditWritten = true;
            } catch (auditErr: any) {
              console.error(`[OnboardingReminder] Audit log write failed for contact ${deal.contactId} — releasing lock so next tick can retry:`, auditErr.message);
              // Release lock so the dedup check can guard the next attempt
              releaseJobLock(lockKey, false, auditErr.message, reminderLock).catch(() => {});
            }

            if (auditWritten) {
              // #1397 — record to canonical communication_events table
              const { recordOutboundSend } = await import("./communication-events");
              recordOutboundSend({
                contactId: deal.contactId!,
                dealId: deal.id,
                channel: "email",
                provider: "ghl",
                subject: reminderSubject,
                status: "sent",
                metadata: { worker: "onboarding_reminder", stalePendingCount: stalePendingItems.length },
              }).catch((e: any) => console.warn("[OnboardingReminder] recordOutboundSend failed:", e.message));
              // Lock intentionally NOT released on confirmed, durably-recorded success.
              // The audit log handles the 24h cooldown; the lock's 20-min TTL prevents
              // intra-tick re-acquisition by another concurrent worker.
              // reminded++ only here: delivery is confirmed AND the idempotency record
              // was durably written; not on send-only or audit-write-failed paths.
              reminded++;
            }
          } else {
            // Failed, skipped (DNC/global-pause), or suppressed — release the lock
            // so the next eligible tick can retry. Do NOT write the audit log.
            const reason = orchResult.error ?? orchResult.skipReason ?? "send failed or suppressed";
            console.warn(`[OnboardingReminder] Send not confirmed for deal ${deal.id} (${reason}) — releasing lock for retry`);
            releaseJobLock(lockKey, false, reason, reminderLock).catch(() => {});
          }
        }

        await storage.createNotification({
          channel: "internal",
          title: "Onboarding Documents Overdue",
          message: `Deal #${deal.id}${contact ? ` — ${contact.companyName || contact.firstName + " " + contact.lastName}` : ""} has ${stalePendingItems.length} document(s) pending > 2 days.`,
          type: "urgent",
          metadata: { dealId: deal.id, contactId: deal.contactId, eventType: "onboarding_reminder", stalePendingCount: stalePendingItems.length },
        });
      } catch (dealErr: any) {
        console.error(`[OnboardingReminder] Error processing deal ${deal.id}:`, dealErr.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[OnboardingReminder] Fatal error:", err.message);
    errors++;
  }

  console.log(`[OnboardingReminder] Done — ${processed} deals checked, ${reminded} reminded, ${errors} errors`);

  // Also run abandon recovery for stale draft/in_progress merchant applications
  await runAbandonedDraftRecovery().catch(err =>
    console.error("[OnboardingReminder] Abandon recovery error:", err.message)
  );

  return { processed, reminded, errors };
}

async function runAbandonedDraftRecovery(): Promise<void> {
  const thresholdDate = new Date(Date.now() - ABANDON_THRESHOLD_MS);

  let staleApps: (typeof merchantApplications.$inferSelect)[] = [];
  try {
    staleApps = await db
      .select()
      .from(merchantApplications)
      .where(
        and(
          or(
            eq(merchantApplications.status, "draft"),
            eq(merchantApplications.status, "in_progress"),
          ),
          lt(merchantApplications.updatedAt, thresholdDate),
          sql`(${merchantApplications.ownerEmail} IS NOT NULL OR ${merchantApplications.businessEmail} IS NOT NULL)`,
          sql`${merchantApplications.legalBusinessName} IS NOT NULL`,
        ),
      )
      .limit(ABANDON_MAX_PER_RUN);
  } catch (err: any) {
    console.error("[AbandonRecovery] DB query error:", err.message);
    return;
  }

  if (staleApps.length === 0) return;

  let recovered = 0;
  let skipped = 0;

  for (const app of staleApps) {
    try {
      const recipientEmail = app.ownerEmail || app.businessEmail;
      if (!recipientEmail) { skipped++; continue; }

      // Idempotency: use abandon_recovery_enrolled as the authoritative cooldown marker
      const recentLogs = await storage.getAuditLogsByEntity("merchant_application", app.id, 20).catch(() => []);
      const lastEnrolled = recentLogs.find(l => l.action === "abandon_recovery_enrolled");
      if (lastEnrolled?.createdAt) {
        const elapsed = Date.now() - new Date(lastEnrolled.createdAt).getTime();
        if (elapsed < ABANDON_REMINDER_COOLDOWN_MS) { skipped++; continue; }
      }

      const businessName = app.legalBusinessName || app.dba || "your business";

      // Record attempt before enrollment — does NOT serve as the idempotency guard
      await storage.createAuditLog({
        action: "abandon_recovery_attempted",
        entityType: "merchant_application",
        entityId: app.id,
        actorType: "system",
        details: { recipientEmail, businessName, currentStep: app.currentStep, status: app.status },
      });

      // Internal alert
      await storage.createNotification({
        channel: "internal",
        title: "Abandoned Application — Recovery Triggered",
        message: `Application #${app.id} (${businessName}) stale for >24h. Enrolling in re-engagement sequence. Contact: ${recipientEmail}`,
        type: "info",
        metadata: { applicationId: app.id, recipientEmail, eventType: "abandoned_application", link: "/dashboard/merchant-applications" },
      }).catch((err: Error) => console.error("[OnboardingReminder] Notification write failed:", err.message));

      // Sequence enrollment: look up contact by email, gate through canEnrollContactInSequence
      try {
        const { canEnrollContactInSequence } = await import("./sequence-eligibility");
        const { data: contacts } = await storage.getContacts({ limit: 1000 });
        const matchedContact = contacts.find((c: any) =>
          c.email?.toLowerCase() === recipientEmail.toLowerCase(),
        );
        if (matchedContact) {
          const allSeqs = await storage.getFollowUpSequences().catch(() => []);
          // Find sequence by exact sequenceFamily first, then name fallback
          const abandonedSeq = allSeqs.find((s: any) => s.sequenceFamily === "application-abandoned")
            ?? allSeqs.find((s: any) => s.name?.toLowerCase().includes("application-abandoned"));
          if (abandonedSeq) {
            // True family-level dedup: collect ALL sequence IDs in the application-abandoned family
            const familySequenceIds = new Set(
              allSeqs
                .filter((s: any) => s.sequenceFamily === "application-abandoned")
                .map((s: any) => s.id),
            );
            const contactEnrollments = await storage.getContactEnrollments(matchedContact.id).catch(() => []);
            const alreadyInFamily = contactEnrollments.some(
              (e: any) => familySequenceIds.has(e.sequenceId) && (e.status === "active" || e.status === "paused"),
            );

            if (alreadyInFamily) {
              console.log(`[AbandonRecovery] Contact #${matchedContact.id} already has active application-abandoned enrollment — skipping`);
            } else {
              const eligibility = await canEnrollContactInSequence(matchedContact.id, {
                id: abandonedSeq.id,
                name: abandonedSeq.name,
                status: abandonedSeq.status,
                sequenceFamily: "application-abandoned",
                eligibleConsentTiers: abandonedSeq.eligibleConsentTiers,
                lifecycleStagesAllowed: abandonedSeq.lifecycleStagesAllowed,
              });
              if (eligibility.allowed) {
                await storage.createSequenceEnrollment({
                  sequenceId: abandonedSeq.id,
                  contactId: matchedContact.id,
                  status: "active",
                  nextActionAt: new Date(),
                  currentStep: 0,
                });
                // Audit marker written AFTER successful enrollment
                await storage.createAuditLog({
                  action: "abandon_recovery_enrolled",
                  entityType: "merchant_application",
                  entityId: app.id,
                  actorType: "system",
                  details: { contactId: matchedContact.id, sequenceId: abandonedSeq.id, sequenceFamily: "application-abandoned" },
                });
              } else {
                console.log(`[AbandonRecovery] Enrollment blocked for contact #${matchedContact.id}: ${eligibility.reason}`);
              }
            }
          }
        }
      } catch (seqErr: any) {
        console.warn(`[AbandonRecovery] Sequence enrollment skipped for app #${app.id}:`, seqErr.message);
      }

      recovered++;
    } catch (err: any) {
      console.error(`[AbandonRecovery] Error processing app #${app.id}:`, err.message);
    }
  }

  if (recovered > 0 || skipped > 0) {
    console.log(`[AbandonRecovery] ${recovered} notified, ${skipped} skipped of ${staleApps.length} checked`);
  }
}
