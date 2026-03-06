import { storage } from "../storage";
import { enrichSunbizEntity, convertToProspect } from "./sunbiz-enrichment";
import { queueCampaignMessages, processSendQueue } from "./campaign-engine";
import { scoreContact } from "./lead-scoring";
import { routeContact } from "./smart-router";
import { autoEnrollFromTrigger } from "./sequence-worker";
import { triggerWorkflowsByEvent } from "./workflow-executor";
import { syncContactToGhl } from "./ghl-sync";
import { getEmailSignatureHtml } from "./email-signatures";
import { streamCorevtFromZip } from "./sunbiz-scraper";
import type { InsertSunbizEntity } from "@shared/schema";

const DAILY_OUTREACH_LIMIT = 100;
const ENRICHMENT_BATCH_SIZE = 50;
const ENRICHMENT_DELAY_MS = 1500;

let importRunning = false;

export async function importFullCorevt(options?: {
  maxRecords?: number;
  onlyActive?: boolean;
}): Promise<void> {
  if (importRunning) {
    console.log("[Import] Import already running, skipping");
    return;
  }

  importRunning = true;
  const filePath = "attached_assets/corevt_1770743342093.zip";
  const maxRecords = options?.maxRecords || Infinity;
  const onlyActive = options?.onlyActive !== false;

  try {
    const existingFilings = await storage.getExistingFilingNumbers();
    console.log(`[Import] ${existingFilings.size} existing entities in DB, starting full import...`);

    await storage.setSystemSetting("corevt_import_progress", {
      status: "running",
      startedAt: new Date().toISOString(),
      totalProcessed: 0,
      totalImported: 0,
      totalSkipped: 0,
      totalDuplicates: 0,
    });

    const allLists = await storage.getProspectLists();
    let importList = allLists.find((l: any) => l.name === "Sunbiz FL Full Import");
    if (!importList) {
      importList = await storage.createProspectList({
        name: "Sunbiz FL Full Import",
        description: "Full Florida Sunbiz corevt database import",
        fileName: "corevt.zip",
        totalRecords: 0,
        status: "processing",
      });
    }

    let totalProcessed = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalDuplicates = 0;
    let batchCount = 0;

    for await (const batch of streamCorevtFromZip(filePath, { maxRecords, onlyActive })) {
      const newEntities: InsertSunbizEntity[] = [];

      for (const p of batch) {
        if (p.filingNumber && existingFilings.has(p.filingNumber)) {
          totalDuplicates++;
          continue;
        }

        if (p.entityName.length <= 2) {
          totalSkipped++;
          continue;
        }

        if (p.filingNumber) existingFilings.add(p.filingNumber);

        newEntities.push({
          entityName: p.entityName || "",
          filingNumber: p.filingNumber || undefined,
          feiEinNumber: p.feiEinNumber || undefined,
          entityType: p.entityType || undefined,
          entityStatus: p.entityStatus || "Active",
          filingDate: p.filingDate || undefined,
          principalAddress: p.principalAddress || undefined,
          principalCity: p.principalCity || undefined,
          principalState: p.principalState || "FL",
          principalZip: p.principalZip || undefined,
          mailingAddress: p.mailingAddress || undefined,
          registeredAgentName: p.registeredAgentName || undefined,
          registeredAgentAddress: p.registeredAgentAddress || undefined,
          officers: p.officers && p.officers.length > 0 ? p.officers : undefined,
          dba: p.dba || undefined,
          website: p.website || undefined,
          email: p.email || undefined,
          phone: p.phone || undefined,
          detailUrl: p.detailUrl || undefined,
          listId: importList.id,
          source: "corevt",
          enrichmentStatus: "pending" as const,
          searchQuery: "Sunbiz FL Full Import",
        });
      }

      if (newEntities.length > 0) {
        try {
          const batchSize = 200;
          for (let i = 0; i < newEntities.length; i += batchSize) {
            const chunk = newEntities.slice(i, i + batchSize);
            await storage.createSunbizEntitiesBulk(chunk);
            totalImported += chunk.length;
          }
        } catch (err: any) {
          console.error(`[Import] Batch insert error:`, err.message);
          for (const entity of newEntities) {
            try {
              await storage.createSunbizEntity(entity);
              totalImported++;
            } catch {
              totalSkipped++;
            }
          }
        }
      }

      totalProcessed += batch.length;
      batchCount++;

      if (batchCount % 20 === 0) {
        console.log(`[Import] Progress: ${totalProcessed} processed, ${totalImported} imported, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);
        await storage.setSystemSetting("corevt_import_progress", {
          status: "running",
          startedAt: new Date().toISOString(),
          totalProcessed,
          totalImported,
          totalSkipped,
          totalDuplicates,
          lastUpdate: new Date().toISOString(),
        });
      }

      if (totalImported >= maxRecords) break;
    }

    await storage.updateProspectList(importList.id, {
      totalRecords: totalImported,
      status: "ready",
    });

    await storage.setSystemSetting("corevt_import_progress", {
      status: "complete",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      totalProcessed,
      totalImported,
      totalSkipped,
      totalDuplicates,
    });

    console.log(`[Import] COMPLETE: ${totalProcessed} processed, ${totalImported} imported, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);
  } catch (err: any) {
    console.error("[Import] Fatal error:", err);
    await storage.setSystemSetting("corevt_import_progress", {
      status: "error",
      error: err.message,
      completedAt: new Date().toISOString(),
    });
  } finally {
    importRunning = false;
  }
}

export async function reEnrichAllSunbizEntities(limit: number = 200): Promise<{
  processed: number;
  classified: number;
  emailsFound: number;
  phonesFound: number;
  errors: number;
}> {
  const allEntities = await storage.getSunbizEntities();
  const toProcess = allEntities
    .filter(e => !e.vertical || e.vertical === "Other" || e.score === "cold" || !e.email)
    .slice(0, limit);

  console.log(`[Re-Enrich] Starting re-enrichment for ${toProcess.length} entities...`);

  let processed = 0;
  let classified = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let errors = 0;

  await storage.setSystemSetting("enrichment_progress", {
    status: "running",
    total: toProcess.length,
    processed: 0,
    classified: 0,
    emailsFound: 0,
    phonesFound: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
  });

  for (const entity of toProcess) {
    try {
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "pending" });

      const result = await enrichSunbizEntity(entity.id);
      processed++;

      if (result) {
        if (result.vertical && result.vertical !== "Other") classified++;
        if (result.email) emailsFound++;
        if (result.phone) phonesFound++;
      }

      if (processed % 10 === 0) {
        console.log(`[Re-Enrich] Progress: ${processed}/${toProcess.length} (${classified} classified, ${emailsFound} emails, ${phonesFound} phones)`);
        await storage.setSystemSetting("enrichment_progress", {
          status: "running",
          total: toProcess.length,
          processed,
          classified,
          emailsFound,
          phonesFound,
          errors,
          lastUpdate: new Date().toISOString(),
        });
      }

      await new Promise(resolve => setTimeout(resolve, ENRICHMENT_DELAY_MS));
    } catch (err) {
      console.error(`[Re-Enrich] Failed for entity ${entity.id} (${entity.entityName}):`, err);
      errors++;
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "failed" });
    }
  }

  await storage.setSystemSetting("enrichment_progress", {
    status: "complete",
    total: toProcess.length,
    processed,
    classified,
    emailsFound,
    phonesFound,
    errors,
    completedAt: new Date().toISOString(),
  });

  console.log(`[Re-Enrich] Complete: ${processed} processed, ${classified} classified, ${emailsFound} emails, ${phonesFound} phones, ${errors} errors`);

  return { processed, classified, emailsFound, phonesFound, errors };
}

export async function promoteQualifiedToContacts(): Promise<{
  promoted: number;
  skipped: number;
  dealsCreated: number;
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
  let dealsCreated = 0;

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

      if (!prospect.qualificationScore || !["A", "B", "C"].includes(prospect.qualificationScore)) {
        skipped++;
        continue;
      }

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
        email: entity.email || entity.ownerEmail || "",
        phone: entity.phone || entity.ownerPhone || "",
        companyName: entity.dba || entity.entityName,
        vertical: entity.vertical || undefined,
        status: "New",
        tags: ["auto-generated", "sunbiz", entity.score || "cold", entity.vertical || "unclassified"],
        notes: entity.aiSummary || `Auto-imported from Sunbiz. Filing: ${entity.filingNumber}`,
        referralSource: "sunbiz_enrichment",
      });

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        priorityScore: entity.score === "hot" ? 80 : entity.score === "warm" ? 50 : 20,
        notes: entity.aiSummary || `Auto-imported from Sunbiz. Filing: ${entity.filingNumber}`,
        leadSource: "sunbiz_enrichment",
        offerPath: entity.vertical || undefined,
      });
      dealsCreated++;

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("contact_created", {
        entityType: "contact",
        entityId: contact.id,
        contactId: contact.id,
      }).catch(err => console.error("Workflow trigger error:", err));

      syncContactToGhl(contact.id).catch(err => console.error("GHL sync error:", err));

      await storage.updateProspect(prospectId, { contactId: contact.id, status: "converted" });

      promoted++;
    } catch (err) {
      console.error(`[Promote] Failed for entity ${entity.id}:`, err);
      skipped++;
    }
  }

  console.log(`[Promote] Complete: ${promoted} promoted, ${skipped} skipped, ${dealsCreated} deals created`);
  return { promoted, skipped, dealsCreated };
}

export async function runDailyOutreach(): Promise<{
  enriched: number;
  promoted: number;
  dealsCreated: number;
  queued: number;
  sent: { sent: number; failed: number };
}> {
  console.log(`[Daily Outreach] Starting daily outreach cycle...`);

  const dailyCount = await getDailySendCount();
  const remaining = Math.max(0, DAILY_OUTREACH_LIMIT - dailyCount);
  if (remaining === 0) {
    console.log(`[Daily Outreach] Daily limit reached (${dailyCount}/${DAILY_OUTREACH_LIMIT}), skipping`);
    return { enriched: 0, promoted: 0, dealsCreated: 0, queued: 0, sent: { sent: 0, failed: 0 } };
  }

  console.log(`[Daily Outreach] Step 1: Re-enriching unenriched entities (batch of ${ENRICHMENT_BATCH_SIZE})...`);
  const enrichResult = await reEnrichAllSunbizEntities(ENRICHMENT_BATCH_SIZE);

  console.log(`[Daily Outreach] Step 2: Promoting qualified leads to contacts...`);
  const promoteResult = await promoteQualifiedToContacts();

  console.log(`[Daily Outreach] Step 3: Queueing campaign messages (up to ${remaining})...`);
  let totalQueued = 0;
  const campaigns = await storage.getCampaigns();
  const activeCampaigns = campaigns.filter(c => c.status === "active");
  for (const campaign of activeCampaigns) {
    const budgetLeft = remaining - totalQueued;
    if (budgetLeft <= 0) break;
    const queued = await queueCampaignMessages(campaign.id, budgetLeft);
    totalQueued += queued;
  }

  console.log(`[Daily Outreach] Step 4: Processing send queue (budget remaining: ${remaining - totalQueued})...`);
  const sendBudget = Math.max(0, remaining - totalQueued);
  const sendResult = await processSendQueue(sendBudget > 0 ? sendBudget : 0);

  await storage.setSystemSetting("daily_outreach_last_run", {
    timestamp: new Date().toISOString(),
    enriched: enrichResult.processed,
    promoted: promoteResult.promoted,
    dealsCreated: promoteResult.dealsCreated,
    queued: totalQueued,
    sent: sendResult.sent,
    failed: sendResult.failed,
    dailyTotal: dailyCount + sendResult.sent,
  });

  console.log(`[Daily Outreach] Complete: ${enrichResult.processed} enriched, ${promoteResult.promoted} promoted, ${promoteResult.dealsCreated} deals, ${totalQueued} queued, ${sendResult.sent} sent`);

  return {
    enriched: enrichResult.processed,
    promoted: promoteResult.promoted,
    dealsCreated: promoteResult.dealsCreated,
    queued: totalQueued,
    sent: sendResult,
  };
}

async function getDailySendCount(): Promise<number> {
  const lastRun = await storage.getSystemSetting("daily_outreach_last_run");
  if (!lastRun) return 0;

  const lastTimestamp = new Date(lastRun.timestamp);
  const now = new Date();
  const isToday = lastTimestamp.toDateString() === now.toDateString();
  return isToday ? (lastRun.dailyTotal || 0) : 0;
}

let dailyOutreachInterval: NodeJS.Timeout | null = null;
let enrichmentInterval: NodeJS.Timeout | null = null;
let workerRunning = false;

export function startDailyOutreachWorker(intervalMinutes: number = 60): void {
  if (dailyOutreachInterval) clearInterval(dailyOutreachInterval);
  if (enrichmentInterval) clearInterval(enrichmentInterval);

  workerRunning = true;
  console.log(`[Daily Outreach Worker] Started - outreach every ${intervalMinutes}min, enrichment every 30min`);

  enrichmentInterval = setInterval(async () => {
    try {
      console.log("[Enrichment Worker] Running enrichment batch...");
      await reEnrichAllSunbizEntities(ENRICHMENT_BATCH_SIZE);
    } catch (err) {
      console.error("[Enrichment Worker] Error:", err);
    }
  }, 30 * 60 * 1000);

  dailyOutreachInterval = setInterval(async () => {
    try {
      await runDailyOutreach();
    } catch (err) {
      console.error("[Daily Outreach Worker] Error:", err);
    }
  }, intervalMinutes * 60 * 1000);

  storage.setSystemSetting("outreach_worker_status", {
    running: true,
    startedAt: new Date().toISOString(),
    intervalMinutes,
  });
}

export function stopDailyOutreachWorker(): void {
  if (dailyOutreachInterval) {
    clearInterval(dailyOutreachInterval);
    dailyOutreachInterval = null;
  }
  if (enrichmentInterval) {
    clearInterval(enrichmentInterval);
    enrichmentInterval = null;
  }
  workerRunning = false;
  console.log("[Daily Outreach Worker] Stopped");

  storage.setSystemSetting("outreach_worker_status", {
    running: false,
    stoppedAt: new Date().toISOString(),
  });
}

export function isWorkerRunning(): boolean {
  return workerRunning;
}

export { importRunning };
