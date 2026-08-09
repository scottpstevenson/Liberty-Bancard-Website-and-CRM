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

  // ── Global-pause gate ────────────────────────────────────────────────────
  const globalPausedRaw = await storage.getSystemSetting("outboundGlobalPaused").catch(() => null);
  if (globalPausedRaw === true || globalPausedRaw === "true") {
    console.log("[OnboardingReminder] outboundGlobalPaused is set — skipping entire run");
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
          const { channelOrchestrator } = await import("./transports/index");
          const contactName =
            contact.companyName ||
            [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
            "Merchant";
          const pendingItems = stalePendingItems.map(i => `<li>${i.itemKey}</li>`).join("");
          await channelOrchestrator.sendEmail(
            {
              contactId: deal.contactId,
              subject: `Action Required: ${stalePendingItems.length} Onboarding Item${stalePendingItems.length > 1 ? "s" : ""} Pending`,
              body: `<p>Hi ${contactName},</p><p>Your Liberty Bancard onboarding has ${stalePendingItems.length} item${stalePendingItems.length > 1 ? "s" : ""} that still need${stalePendingItems.length === 1 ? "s" : ""} attention:</p><ul>${pendingItems}</ul><p>Please complete these items so we can finish activating your account. Reply to this email or contact your account manager if you need help.</p>`,
              category: "onboarding",
            },
            {
              // Full compliance fence — onboarding reminders respect DNC and global pause
              skipContactabilityCheck: false,
              skipGlobalPauseCheck: false,
            },
          ).catch(err =>
            console.error(`[OnboardingReminder] Orchestrator email error for deal ${deal.id}:`, err),
          );
        }

        await storage.createNotification({
          channel: "internal",
          title: "Onboarding Documents Overdue",
          message: `Deal #${deal.id}${contact ? ` — ${contact.companyName || contact.firstName + " " + contact.lastName}` : ""} has ${stalePendingItems.length} document(s) pending > 2 days.`,
          type: "urgent",
          metadata: { dealId: deal.id, contactId: deal.contactId, eventType: "onboarding_reminder", stalePendingCount: stalePendingItems.length },
        });

        reminded++;
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
