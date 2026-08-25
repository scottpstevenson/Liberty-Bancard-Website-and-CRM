import { storage } from "../storage";
import { buildSafeEnrichmentFailureProgress } from "./enrichment-progress-helpers";
import { enrichSunbizEntity, convertToProspect } from "./sunbiz-enrichment";
import { queueCampaignMessages, processSendQueue } from "./campaign-engine";
import { scoreContact } from "./lead-scoring";
import { sanitizeFirstName } from "./contact-name-utils";
import { routeContact } from "./smart-router";
import { enqueuePromotionalEnrollment } from "./promotional-enrollment-eligibility";
import { triggerWorkflowsByEvent } from "./workflow-executor";
import { createContactLocalFirst, updateContactLocalFirst } from "./contact-writer";
import { getEmailSignatureHtml } from "./email-signatures";
import { streamCorevtFromZip, downloadCordataFromSunbiz, streamCordataFromZip, type CordataRecord } from "./sunbiz-scraper";
import { toProperCase } from "./sunbiz-scraper";
import type { InsertSunbizEntity } from "@shared/schema";

const DAILY_OUTREACH_LIMIT = 100;
const ENRICHMENT_BATCH_SIZE = 200;
const ENRICHMENT_DELAY_MS = 500;

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

let cordataImportRunning = false;

export async function importCordataEnrichment(options?: {
  maxRecords?: number;
  download?: boolean;
}): Promise<void> {
  if (cordataImportRunning) {
    console.log("[Cordata Import] Already running, skipping");
    return;
  }
  cordataImportRunning = true;

  const filePath = "attached_assets/cordata.zip";
  const shouldDownload = options?.download !== false;
  const maxRecords = options?.maxRecords || Infinity;

  try {
    const fs = await import("fs");
    if (!fs.existsSync(filePath) || shouldDownload) {
      console.log("[Cordata Import] Downloading cordata.zip from FL Sunbiz SFTP...");
      await storage.setSystemSetting("cordata_import_progress", {
        status: "downloading",
        startedAt: new Date().toISOString(),
      });
      const success = await downloadCordataFromSunbiz(filePath);
      if (!success) {
        console.error("[Cordata Import] Download failed");
        await storage.setSystemSetting("cordata_import_progress", {
          status: "error",
          error: "Download failed",
        });
        return;
      }
      console.log("[Cordata Import] Download complete");
    }

    const startCount = await storage.getSunbizEntityCount();
    console.log(`[Cordata Import] ${startCount} entities in DB, starting fast bulk upsert...`);

    await storage.setSystemSetting("cordata_import_progress", {
      status: "processing",
      startedAt: new Date().toISOString(),
      totalProcessed: 0,
    });

    let totalProcessed = 0;
    let totalUpserted = 0;
    let totalErrors = 0;
    let batchCount = 0;

    const allLists = await storage.getProspectLists();
    let importList = allLists.find((l: any) => l.name === "Sunbiz FL Full Import");
    if (!importList) {
      importList = await storage.createProspectList({
        name: "Sunbiz FL Full Import",
        description: "Full Florida Sunbiz corporate database import",
        fileName: "cordata.zip",
        totalRecords: 0,
        status: "processing",
      });
    }

    const officerTitles: Record<string, string> = {
      P: "President", T: "Treasurer", C: "Chairman",
      V: "Vice President", S: "Secretary", D: "Director",
      M: "Manager", MGRM: "Manager/Member", AMBR: "Authorized Member",
    };

    for await (const batch of streamCordataFromZip(filePath, { maxRecords, onlyActive: false })) {
      const upsertRecords: Array<{
        filingNumber: string; entityName: string; feiEinNumber?: string;
        entityType?: string; entityStatus?: string; filingDate?: string; lastEvent?: string;
        principalAddress?: string; principalCity?: string; principalState?: string; principalZip?: string;
        mailingAddress?: string; registeredAgentName?: string; registeredAgentAddress?: string;
        officers?: any; ownerName?: string; enrichmentData?: any; listId?: number; source?: string;
      }> = [];

      for (const rec of batch) {
        if (!rec.corporationNumber) continue;

        const officers = rec.officers.map(o => ({
          title: officerTitles[o.title.toUpperCase()] || o.title,
          name: toProperCase(o.name),
          address: [toProperCase(o.address), toProperCase(o.city), o.state, o.zip].filter(Boolean).join(", "),
        }));

        const raAddress = [toProperCase(rec.registeredAgentAddress), toProperCase(rec.registeredAgentCity), rec.registeredAgentState, rec.registeredAgentZip].filter(Boolean).join(", ");
        const principalAddr = [rec.principalAddress1, rec.principalAddress2].filter(Boolean).join(", ");
        const mailingAddr = [rec.mailAddress1, rec.mailAddress2].filter(Boolean).join(", ");
        const ownerOfficer = officers.find((o: any) => ["President", "Manager", "Chairman", "Director"].includes(o.title));

        const enrichmentData: Record<string, any> = { cordataSource: true };
        if (rec.annualReports.length > 0) enrichmentData.annualReports = rec.annualReports;
        if (rec.feiNumber) enrichmentData.feiNumber = rec.feiNumber;

        upsertRecords.push({
          filingNumber: rec.corporationNumber,
          entityName: toProperCase(rec.corporationName) || "",
          feiEinNumber: rec.feiNumber || undefined,
          entityType: rec.filingType || undefined,
          entityStatus: rec.status,
          filingDate: rec.fileDate || undefined,
          lastEvent: rec.lastTransactionDate ? `Last Transaction: ${rec.lastTransactionDate}` : undefined,
          principalAddress: principalAddr ? toProperCase(principalAddr) : undefined,
          principalCity: toProperCase(rec.principalCity) || undefined,
          principalState: rec.principalState || "FL",
          principalZip: rec.principalZip || undefined,
          mailingAddress: mailingAddr ? toProperCase(mailingAddr) : undefined,
          registeredAgentName: toProperCase(rec.registeredAgentName) || undefined,
          registeredAgentAddress: raAddress || undefined,
          officers: officers.length > 0 ? officers : undefined,
          ownerName: ownerOfficer?.name || undefined,
          enrichmentData,
          listId: importList.id,
          source: "cordata",
        });
      }

      if (upsertRecords.length > 0) {
        const UPSERT_CHUNK = 100;
        for (let i = 0; i < upsertRecords.length; i += UPSERT_CHUNK) {
          const chunk = upsertRecords.slice(i, i + UPSERT_CHUNK);
          try {
            const result = await storage.bulkUpsertSunbizEntities(chunk);
            totalUpserted += result.inserted;
          } catch (err: any) {
            totalErrors += chunk.length;
            if (totalErrors <= 5) {
              console.error(`[Cordata Import] Upsert error: ${err.message?.substring(0, 300)}`);
            }
          }
        }
      }

      totalProcessed += batch.length;
      batchCount++;

      if (batchCount === 1 || batchCount % 20 === 0) {
        console.log(`[Cordata Import] Progress: ${totalProcessed.toLocaleString()} processed, ${totalUpserted.toLocaleString()} upserted, ${totalErrors} errors`);
        await storage.setSystemSetting("cordata_import_progress", {
          status: "processing",
          totalProcessed,
          totalUpserted,
          totalErrors,
          lastUpdate: new Date().toISOString(),
        });
      }

      if (totalProcessed >= maxRecords) break;
    }

    const endCount = await storage.getSunbizEntityCount();
    const newRecords = endCount - startCount;

    await storage.setSystemSetting("cordata_import_progress", {
      status: "complete",
      completedAt: new Date().toISOString(),
      totalProcessed,
      totalUpserted,
      totalErrors,
      newRecords,
      finalCount: endCount,
    });

    console.log(`[Cordata Import] COMPLETE: ${totalProcessed.toLocaleString()} processed, ${totalUpserted.toLocaleString()} upserted, ${totalErrors} errors, ${newRecords.toLocaleString()} net new (${endCount.toLocaleString()} total)`);
  } catch (err: any) {
    console.error("[Cordata Import] Fatal error:", err);
    await storage.setSystemSetting("cordata_import_progress", {
      status: "error",
      error: err.message,
    });
  } finally {
    cordataImportRunning = false;
  }
}

let reEnrichRunning = false;

export function isReEnrichRunning(): boolean {
  return reEnrichRunning;
}

export async function reEnrichAllSunbizEntities(limit: number = 200): Promise<{
  processed: number;
  classified: number;
  emailsFound: number;
  phonesFound: number;
  errors: number;
}> {
  if (reEnrichRunning) {
    console.log("[Re-Enrich] Skipping run — previous re-enrichment batch still in progress");
    return { processed: 0, classified: 0, emailsFound: 0, phonesFound: 0, errors: 0 };
  }
  reEnrichRunning = true;
  // Counters declared outside try so outer catch can always use current in-memory values
  // even if getSunbizEntitiesNeedingEnrichment throws before they are ever incremented.
  let processed = 0;
  let classified = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let errors = 0;
  let total = 0;
  try {
  const toProcess = await storage.getSunbizEntitiesNeedingEnrichment(limit);
  total = toProcess.length;

  console.log(`[Re-Enrich] Starting re-enrichment for ${toProcess.length} entities...`);

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
      console.log(`[Re-Enrich] Processing entity ${entity.id}: ${entity.entityName}...`);
      const result = await enrichSunbizEntity(entity.id);
      processed++;

      if (result) {
        if (result.vertical && result.vertical !== "Other") classified++;
        if (result.email) emailsFound++;
        if (result.phone) phonesFound++;
        console.log(`[Re-Enrich] Entity ${entity.id} → ${result.vertical || 'unclassified'} / ${result.score} ${result.email ? '(email found)' : ''}`);
      }

      await storage.setSystemSetting("enrichment_progress", {
        status: "running", total: toProcess.length, processed, classified, emailsFound, phonesFound, errors,
        lastUpdate: new Date().toISOString(),
      });

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
  } catch (err) {
    console.error("[Re-Enrich] Batch-level failure:", err);

    // Use in-memory counters for this run — never read from storage here,
    // which could carry stale metadata/counts from a prior run if initialization
    // threw before the fresh "running" payload was written.
    try {
      const failPayload = buildSafeEnrichmentFailureProgress(
        { total, processed, classified, emailsFound, phonesFound, errors },
        err,
        new Date().toISOString()
      );
      await storage.setSystemSetting("enrichment_progress", failPayload);
    } catch (writeErr) {
      console.error("[Re-Enrich] Could not persist failed state:", writeErr);
      // Do not rethrow writeErr — original error takes priority
    }

    throw err;
  } finally {
    reEnrichRunning = false;
  }
}

let massEnrichmentRunning = false;

export function isMassEnrichmentRunning(): boolean {
  return massEnrichmentRunning;
}

export async function runMassEnrichment(totalLimit: number = 2000): Promise<{
  processed: number;
  emailsFound: number;
  phonesFound: number;
  errors: number;
}> {
  if (massEnrichmentRunning) {
    throw new Error("Mass enrichment is already running");
  }

  massEnrichmentRunning = true;
  let processed = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let errors = 0;
  const batchSize = 50;

  try {
    console.log(`[Mass Enrich] Starting mass enrichment for up to ${totalLimit} hot/warm entities...`);

    await storage.setSystemSetting("mass_enrichment_progress", {
      status: "running",
      totalLimit,
      processed: 0,
      emailsFound: 0,
      phonesFound: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
    });

    while (processed < totalLimit) {
      const remaining = Math.min(batchSize, totalLimit - processed);
      const batch = await storage.getSunbizEntitiesNeedingEnrichment(remaining);
      if (batch.length === 0) {
        console.log(`[Mass Enrich] No more entities need enrichment.`);
        break;
      }

      for (const entity of batch) {
        try {
          const result = await enrichSunbizEntity(entity.id);
          processed++;
          if (result?.email) emailsFound++;
          if (result?.phone) phonesFound++;
        } catch (err) {
          errors++;
          console.error(`[Mass Enrich] Failed entity ${entity.id}:`, err);
        }
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`[Mass Enrich] Progress: ${processed}/${totalLimit} (${emailsFound} emails, ${phonesFound} phones, ${errors} errors)`);
      await storage.setSystemSetting("mass_enrichment_progress", {
        status: "running",
        totalLimit,
        processed,
        emailsFound,
        phonesFound,
        errors,
        lastUpdate: new Date().toISOString(),
      });
    }

    await storage.setSystemSetting("mass_enrichment_progress", {
      status: "complete",
      totalLimit,
      processed,
      emailsFound,
      phonesFound,
      errors,
      completedAt: new Date().toISOString(),
    });

    console.log(`[Mass Enrich] Complete: ${processed} processed, ${emailsFound} emails, ${phonesFound} phones, ${errors} errors`);
    return { processed, emailsFound, phonesFound, errors };
  } finally {
    massEnrichmentRunning = false;
  }
}

export async function promoteQualifiedToContacts(): Promise<{
  promoted: number;
  skipped: number;
  dealsCreated: number;
}> {
  const { data: allEntities } = await storage.getSunbizEntities(undefined, { limit: 500 });
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
      const rawFirstName = nameParts[0] || entity.entityName.split(" ")[0];
      const firstName = sanitizeFirstName(rawFirstName) || entity.entityName.split(" ")[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const contact = await createContactLocalFirst({
        firstName: firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : "",
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
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "contact_created", sourceEventId: `discovery-enroll-${contact.id}-${Date.now()}` }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("contact_created", {
        entityType: "contact",
        entityId: contact.id,
        contactId: contact.id,
      }).catch(err => console.error("Workflow trigger error:", err));

      // Canonical contact creation persists the durable GHL projection; never
      // issue a detached provider mutation from this promotion loop.

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

export async function processQuizLeadsForSunbizMatch(): Promise<number> {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const quizLeads = contacts.filter(c => {
      const tags = c.tags || [];
      return tags.includes("lead_free_analysis") && !tags.includes("sunbiz_matched") && !tags.includes("sunbiz_no_match");
    });

    let matched = 0;
    for (const contact of quizLeads.slice(0, 50)) {
      try {
        const searchName = contact.companyName || `${contact.firstName} ${contact.lastName}`;
        const matches = await storage.searchSunbizEntitiesByNameCity(searchName);
        if (matches.length > 0) {
          const match = matches[0];
          const enrichUpdates: Record<string, any> = {};
          if (match.vertical && !contact.vertical) enrichUpdates.vertical = match.vertical;
          const existingTags = contact.tags || [];
          enrichUpdates.tags = [...existingTags, "sunbiz_matched"];
          enrichUpdates.notes = `${contact.notes || ""}\nSunbiz Match: ${match.entityName} (Filing: ${match.filingNumber || "N/A"})`.trim();
          if (match.aiSummary) {
            enrichUpdates.notes = `${enrichUpdates.notes}\nSunbiz AI: ${match.aiSummary}`.trim();
          }
          await updateContactLocalFirst(contact.id, enrichUpdates);
          await storage.updateSunbizEntity(match.id, {
            tags: [...(match.tags || []), "quiz_lead_linked"],
            notes: `${match.notes || ""}\nLinked to quiz contact #${contact.id} (${contact.firstName} ${contact.lastName})`.trim(),
          });
          matched++;
        } else {
          const existingTags = contact.tags || [];
          await updateContactLocalFirst(contact.id, { tags: [...existingTags, "sunbiz_no_match"] });
        }
      } catch (err) {
        console.error(`[Quiz Lead Match] Error for contact ${contact.id}:`, err);
      }
    }
    return matched;
  } catch (err) {
    console.error("[Quiz Lead Match] Error:", err);
    return 0;
  }
}

type DailyOutreachResult = {
  enriched: number;
  promoted: number;
  dealsCreated: number;
  queued: number;
  sent: { sent: number; failed: number };
  execution: "completed" | "held" | "unavailable";
};

async function runDailyOutreachCycle(
  assertOwned: () => void = () => {},
): Promise<Omit<DailyOutreachResult, "execution">> {
  console.log(`[Daily Outreach] Starting daily outreach cycle...`);

  // ── Phase gating (#1532): 4 independently-gated logical phases ────────────
  // Phase A (enrichment/DB work) is always safe — runs unconditionally.
  // Phases B/C/D (promotion, enrollment, send) are outbound-gated by coordinator.
  // The daily send-cap early return applies only to outbound phases, not enrichment.
  const { authorize } = await import("./outbound-pause-authority");
  const { canExecute } = await import("./outbound-queue-coordinator");
  const decision = await authorize({});
  const discoveryPromotionOk  = decision.allowed && await canExecute("discovery-promotion");
  const discoveryEnrollmentOk = decision.allowed && await canExecute("discovery-enrollment");
  const discoverySendOk       = decision.allowed && await canExecute("discovery-send");

  // Phase A: Lead enrichment/DB work — runs regardless of outbound pause
  assertOwned();
  console.log(`[Daily Outreach] Step 1 (Phase A — always runs): Re-enriching unenriched entities (batch of ${ENRICHMENT_BATCH_SIZE})...`);
  const enrichResult = await reEnrichAllSunbizEntities(ENRICHMENT_BATCH_SIZE);

  // Daily cap check only relevant for outbound phases
  const dailyCount = await getDailySendCount();
  const remaining = Math.max(0, DAILY_OUTREACH_LIMIT - dailyCount);

  // Phase B: Promotion evaluation — gated
  let promoteResult = { promoted: 0, dealsCreated: 0 };
  let quizLeadsProcessed = 0;
  if (discoveryPromotionOk) {
    assertOwned();
    console.log(`[Daily Outreach] Step 2 (Phase B): Promoting qualified leads to contacts...`);
    promoteResult = await promoteQualifiedToContacts();
    console.log(`[Daily Outreach] Step 2b: Processing quiz leads for Sunbiz matching...`);
    quizLeadsProcessed = await processQuizLeadsForSunbizMatch();
    console.log(`[Daily Outreach] Quiz leads matched: ${quizLeadsProcessed}`);
  } else {
    console.log(`[Daily Outreach] Step 2 (Phase B) SKIPPED — coordinator hold on 'discovery-promotion' or authority blocked (reason=${decision.reasonCode})`);
  }

  // Phase C: Enrollment/workflow triggering — gated
  let totalQueued = 0;
  if (discoveryEnrollmentOk && remaining > 0) {
    assertOwned();
    // BT-10: an automated tick cannot reselect a mutable campaign audience.
    // Only an admin-accepted frozen preview may create a durable queue run.
    console.log("[Daily Outreach] Step 3 (Phase C) SKIPPED — campaign enqueue requires a frozen preview queue run");
  } else if (!discoveryEnrollmentOk) {
    console.log(`[Daily Outreach] Step 3 (Phase C) SKIPPED — coordinator hold on 'discovery-enrollment' or authority blocked`);
  } else {
    console.log(`[Daily Outreach] Daily limit reached (${dailyCount}/${DAILY_OUTREACH_LIMIT}), skipping enrollment phase`);
  }

  // Phase D: Send queue — gated
  let sendResult = { sent: 0, failed: 0 };
  if (discoverySendOk && remaining > 0) {
    assertOwned();
    console.log(`[Daily Outreach] Step 4 (Phase D): Processing send queue (budget remaining: ${remaining - totalQueued})...`);
    const sendBudget = Math.max(0, remaining - totalQueued);
    sendResult = await processSendQueue(sendBudget > 0 ? sendBudget : 0);
  } else if (!discoverySendOk) {
    console.log(`[Daily Outreach] Step 4 (Phase D) SKIPPED — coordinator hold on 'discovery-send' or authority blocked`);
  }

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

/**
 * The entire daily command is a deployment-wide singleton. Enrichment remains
 * inside this boundary because a manual run and the legacy fallback must not
 * execute the same logical cycle concurrently.
 */
export async function runDailyOutreach(): Promise<DailyOutreachResult> {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat } = await import("./job-registry");
  const lease = await acquireJobLock("daily-outreach");
  if (lease.status === "held") {
    return { enriched: 0, promoted: 0, dealsCreated: 0, queued: 0, sent: { sent: 0, failed: 0 }, execution: "held" };
  }
  if (lease.status === "unavailable") {
    return { enriched: 0, promoted: 0, dealsCreated: 0, queued: 0, sent: { sent: 0, failed: 0 }, execution: "unavailable" };
  }

  return executeDailyOutreachLease(lease);
}

async function executeDailyOutreachLease(lease: { status: "acquired"; lockToken: string }): Promise<DailyOutreachResult> {
  const { releaseJobLock, startJobLockHeartbeat } = await import("./job-registry");
  const heartbeat = startJobLockHeartbeat("daily-outreach", lease.lockToken);
  try {
    heartbeat.assertOwned();
    const result = await runDailyOutreachCycle(() => heartbeat.assertOwned());
    heartbeat.assertOwned();
    await releaseJobLock("daily-outreach", true, undefined, lease.lockToken);
    return { ...result, execution: "completed" };
  } catch (error) {
    await releaseJobLock(
      "daily-outreach",
      false,
      error instanceof Error ? error.message : "Daily outreach failed",
      lease.lockToken,
    );
    throw error;
  } finally {
    heartbeat.stop();
  }
}

/** Claim first so HTTP callers can truthfully respond before the long cycle runs. */
export async function startDailyOutreachInBackground(): Promise<"accepted" | "held" | "unavailable"> {
  const { acquireJobLock } = await import("./job-registry");
  const lease = await acquireJobLock("daily-outreach");
  if (lease.status !== "acquired") return lease.status;
  void executeDailyOutreachLease(lease).catch((error) => {
    console.error("[Daily Outreach] Background cycle failed:", error);
  });
  return "accepted";
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
  console.log(`[Daily Outreach Worker] Started - outreach every ${intervalMinutes}min, enrichment every 10min`);

  enrichmentInterval = setInterval(async () => {
    try {
      console.log("[Enrichment Worker] Running enrichment batch...");
      await reEnrichAllSunbizEntities(ENRICHMENT_BATCH_SIZE);
    } catch (err) {
      console.error("[Enrichment Worker] Error:", err);
    }
  }, 10 * 60 * 1000);

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
