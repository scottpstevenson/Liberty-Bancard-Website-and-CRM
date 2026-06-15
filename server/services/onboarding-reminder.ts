import { storage } from "../storage";
import { isGhlConfigured } from "./ghl";
import { getWorkflowId } from "./ghl-workflows";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export async function runOnboardingReminderTick(): Promise<{ processed: number; reminded: number; errors: number }> {
  let processed = 0;
  let reminded = 0;
  let errors = 0;

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

        if (contact?.ghlContactId && isGhlConfigured()) {
          const workflowId = await getWorkflowId("GHL_WORKFLOW_ONBOARDING_REMINDER");
          if (workflowId) {
            const { enrollInGhlWorkflow } = await import("./ghl");
            await enrollInGhlWorkflow(contact.ghlContactId, workflowId);
            console.log(`[OnboardingReminder] Enrolled contact ${contact.id} in GHL workflow ${workflowId} for deal ${deal.id}`);
          }
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
  return { processed, reminded, errors };
}
