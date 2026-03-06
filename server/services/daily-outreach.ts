import { storage } from "../storage";
import { enrichSunbizEntity, convertToProspect } from "./sunbiz-enrichment";
import { queueCampaignMessages, processSendQueue } from "./campaign-engine";
import { scoreContact } from "./lead-scoring";
import { routeContact } from "./smart-router";
import { autoEnrollFromTrigger } from "./sequence-worker";
import { triggerWorkflowsByEvent } from "./workflow-executor";

const DAILY_OUTREACH_LIMIT = 100;
const ENRICHMENT_BATCH_SIZE = 10;
const ENRICHMENT_DELAY_MS = 2000;

export async function reEnrichAllSunbizEntities(limit: number = 200): Promise<{
  processed: number;
  classified: number;
  emailsFound: number;
  phonesFound: number;
  errors: number;
}> {
  const allEntities = await storage.getSunbizEntities();
  const toProcess = allEntities
    .filter(e => !e.vertical || e.score === "cold" || !e.email)
    .slice(0, limit);

  console.log(`[Re-Enrich] Starting re-enrichment for ${toProcess.length} entities...`);

  let processed = 0;
  let classified = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let errors = 0;

  for (const entity of toProcess) {
    try {
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "pending" });

      const result = await enrichSunbizEntity(entity.id);
      processed++;

      if (result) {
        if (result.vertical) classified++;
        if (result.email) emailsFound++;
        if (result.phone) phonesFound++;
      }

      if (processed % 10 === 0) {
        console.log(`[Re-Enrich] Progress: ${processed}/${toProcess.length} (${classified} classified, ${emailsFound} emails, ${phonesFound} phones)`);
      }

      await new Promise(resolve => setTimeout(resolve, ENRICHMENT_DELAY_MS));
    } catch (err) {
      console.error(`[Re-Enrich] Failed for entity ${entity.id} (${entity.entityName}):`, err);
      errors++;
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "failed" });
    }
  }

  console.log(`[Re-Enrich] Complete: ${processed} processed, ${classified} classified, ${emailsFound} emails, ${phonesFound} phones, ${errors} errors`);

  return { processed, classified, emailsFound, phonesFound, errors };
}

export async function promoteQualifiedToContacts(): Promise<{
  promoted: number;
  skipped: number;
}> {
  const allEntities = await storage.getSunbizEntities();
  const qualified = allEntities.filter(e =>
    e.enrichmentStatus === "enriched" &&
    (e.score === "hot" || e.score === "warm") &&
    (e.email || e.phone) &&
    !e.prospectId
  );

  console.log(`[Promote] Found ${qualified.length} qualified entities to promote`);

  let promoted = 0;
  let skipped = 0;

  for (const entity of qualified) {
    try {
      const prospectId = await convertToProspect(entity.id);
      if (!prospectId) {
        skipped++;
        continue;
      }

      const prospect = await storage.getProspect(prospectId);
      if (!prospect) {
        skipped++;
        continue;
      }

      if (prospect.qualificationScore && ["A", "B"].includes(prospect.qualificationScore)) {
        const officers = (entity.officers as any[]) || [];
        const owner = officers.find((o: any) =>
          /president|ceo|owner|managing|principal/i.test(o.title)
        ) || officers[0];

        const nameParts = (entity.ownerName || owner?.name || entity.entityName).split(" ");
        const firstName = nameParts[0] || entity.entityName.split(" ")[0];
        const lastName = nameParts.slice(1).join(" ") || "";

        const contact = await storage.createContact({
          firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
          lastName: lastName ? lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase() : "(Business)",
          email: entity.email || entity.ownerEmail || `info@${entity.website || "unknown.com"}`,
          phone: entity.phone || entity.ownerPhone || "",
          companyName: entity.dba || entity.entityName,
          vertical: entity.vertical || undefined,
          status: "New",
          tags: ["auto-generated", "sunbiz", entity.score || "cold"],
          notes: entity.aiSummary || `Auto-imported from Sunbiz. Filing: ${entity.filingNumber}`,
          referralSource: "sunbiz_enrichment",
        });

        scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
        routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
        autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("Auto-enroll error:", err));
        triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));

        await storage.updateProspect(prospectId, { contactId: contact.id, status: "converted" });
      }

      promoted++;
    } catch (err) {
      console.error(`[Promote] Failed for entity ${entity.id}:`, err);
      skipped++;
    }
  }

  console.log(`[Promote] Complete: ${promoted} promoted, ${skipped} skipped`);
  return { promoted, skipped };
}

export async function runDailyOutreach(): Promise<{
  enriched: number;
  promoted: number;
  queued: number;
  sent: { sent: number; failed: number };
}> {
  console.log(`[Daily Outreach] Starting daily outreach cycle...`);

  console.log(`[Daily Outreach] Step 1: Re-enriching unenriched entities...`);
  const enrichResult = await reEnrichAllSunbizEntities(ENRICHMENT_BATCH_SIZE);

  console.log(`[Daily Outreach] Step 2: Promoting qualified leads to contacts...`);
  const promoteResult = await promoteQualifiedToContacts();

  console.log(`[Daily Outreach] Step 3: Queueing campaign messages...`);
  let totalQueued = 0;
  const campaigns = await storage.getCampaigns();
  const activeCampaigns = campaigns.filter(c => c.status === "active");
  for (const campaign of activeCampaigns) {
    const queued = await queueCampaignMessages(campaign.id);
    totalQueued += queued;
    if (totalQueued >= DAILY_OUTREACH_LIMIT) break;
  }

  console.log(`[Daily Outreach] Step 4: Processing send queue...`);
  const sendResult = await processSendQueue();

  console.log(`[Daily Outreach] Complete: ${enrichResult.processed} enriched, ${promoteResult.promoted} promoted, ${totalQueued} queued, ${sendResult.sent} sent`);

  return {
    enriched: enrichResult.processed,
    promoted: promoteResult.promoted,
    queued: totalQueued,
    sent: sendResult,
  };
}

let dailyOutreachInterval: NodeJS.Timeout | null = null;

export function startDailyOutreachWorker(intervalMinutes: number = 60): void {
  if (dailyOutreachInterval) {
    clearInterval(dailyOutreachInterval);
  }

  console.log(`[Daily Outreach Worker] Started - running every ${intervalMinutes} minutes`);

  dailyOutreachInterval = setInterval(async () => {
    try {
      await runDailyOutreach();
    } catch (err) {
      console.error("[Daily Outreach Worker] Error:", err);
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopDailyOutreachWorker(): void {
  if (dailyOutreachInterval) {
    clearInterval(dailyOutreachInterval);
    dailyOutreachInterval = null;
    console.log("[Daily Outreach Worker] Stopped");
  }
}
