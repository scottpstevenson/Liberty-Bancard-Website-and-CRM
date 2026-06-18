import { storage } from "../storage";
import { db } from "../db";
import type { Contact, Deal, Company, Task, Ticket, Note, UpdateContactRequest } from "@shared/schema";
import { ghlSyncStatus, GHL_PIPELINE_STAGE_MAP, GHL_PIPELINE_STAGE_REVERSE, ACTIVE_DEAL_STAGES } from "@shared/schema";
import { upsertGhlContact, isGhlConfigured, sendGhlEmail } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";
import { eq } from "drizzle-orm";

const CONFLICT_FIELDS: Array<{ ghlKey: string; contactKey: keyof Contact }> = [
  { ghlKey: "firstName", contactKey: "firstName" },
  { ghlKey: "lastName", contactKey: "lastName" },
  { ghlKey: "email", contactKey: "email" },
  { ghlKey: "phone", contactKey: "phone" },
  { ghlKey: "companyName", contactKey: "companyName" },
];

async function detectAndWriteConflicts(
  existing: Contact,
  ghlContact: any,
): Promise<{ conflictFields: string[]; cleanPayload: UpdateContactRequest }> {
  const conflictFields: string[] = [];
  const cleanPayload: UpdateContactRequest = {};
  const lastSynced = existing.lastSyncedAt;

  for (const { ghlKey, contactKey } of CONFLICT_FIELDS) {
    const ghlVal = ghlContact[ghlKey];
    if (ghlVal === undefined) continue;

    const normalizedGhl = ghlVal ?? "";
    const normalizedInternal = (existing[contactKey] as string) ?? "";

    if (normalizedGhl === normalizedInternal) {
      continue;
    }

    const internalUpdatedAt = existing.updatedAt ?? existing.createdAt;
    const wasModifiedSinceSync = lastSynced
      ? internalUpdatedAt && new Date(internalUpdatedAt) > new Date(lastSynced)
      : false;

    if (wasModifiedSinceSync) {
      conflictFields.push(contactKey as string);
      try {
        await storage.createSyncConflict({
          contactId: existing.id,
          fieldName: contactKey as string,
          internalValue: normalizedInternal || null,
          ghlValue: normalizedGhl || null,
          internalUpdatedAt: internalUpdatedAt ? new Date(internalUpdatedAt) : null,
          ghlUpdatedAt: null,
          resolution: "pending",
          resolvedAt: null,
        });
        console.log(`[GHL Sync] Conflict logged for contact #${existing.id} field '${contactKey as string}': internal='${normalizedInternal}' ghl='${normalizedGhl}'`);
      } catch (err: any) {
        console.error(`[GHL Sync] Failed to write conflict row for contact #${existing.id}:`, err.message);
      }
    } else {
      switch (contactKey) {
        case "firstName":    cleanPayload.firstName    = normalizedGhl; break;
        case "lastName":     cleanPayload.lastName     = normalizedGhl; break;
        case "email":        cleanPayload.email        = normalizedGhl; break;
        case "phone":        cleanPayload.phone        = normalizedGhl; break;
        case "companyName":  cleanPayload.companyName  = normalizedGhl; break;
      }
    }
  }

  return { conflictFields, cleanPayload };
}

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function getConfig() {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId, calendarId: process.env.GHL_CALENDAR_ID || undefined };
}

async function ghlFetch(path: string, options: RequestInit = {}) {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured");
  const url = `${GHL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
    ...(options.headers as Record<string, string> || {}),
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`GHL API error ${response.status}: ${errorBody}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204 || !contentType.includes("application/json")) {
    return {};
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function updateSyncStatusRecord(entityType: string, direction: string, syncedCount: number, errorCount: number, lastError?: string) {
  try {
    const [existing] = await db.select().from(ghlSyncStatus).where(eq(ghlSyncStatus.entityType, entityType));
    if (existing) {
      await db.update(ghlSyncStatus).set({
        lastSyncAt: new Date(),
        lastSyncDirection: direction,
        syncedCount: (existing.syncedCount || 0) + syncedCount,
        errorCount: (existing.errorCount || 0) + errorCount,
        lastError: lastError || existing.lastError,
        updatedAt: new Date(),
      }).where(eq(ghlSyncStatus.entityType, entityType));
    } else {
      await db.insert(ghlSyncStatus).values({
        entityType,
        lastSyncAt: new Date(),
        lastSyncDirection: direction,
        syncedCount,
        errorCount,
        lastError: lastError || null,
      });
    }
  } catch (err) {
    console.error(`[GHL Sync] Failed to update sync status for ${entityType}:`, err);
  }
}

export async function syncContactToGhl(contactId: number): Promise<{ success: boolean; ghlContactId?: string; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };
    const contact = await storage.getContact(contactId);
    if (!contact) return { success: false, error: "Contact not found" };

    const ghlId = await upsertGhlContact(contact);
    if (ghlId && !contact.ghlContactId) {
      await storage.updateContact(contactId, { ghlContactId: ghlId });
    }
    if (ghlId) {
      console.log(`[GHL Sync] Contact #${contactId} synced → GHL ID ${ghlId}`);
    }

    await checkAndApplyActivePipelineTag(contact, ghlId);
    await applyParentLocationTags(contact, ghlId);

    await storage.createGhlActivityLog({
      contactId,
      direction: "outbound",
      channel: "sync",
      subject: "Contact synced to GHL",
      body: null,
      status: "sent",
      ghlMessageId: ghlId || null,
      dealId: null,
      templateId: null,
    });

    await updateSyncStatusRecord("contacts", "outbound", 1, 0);
    return { success: true, ghlContactId: ghlId };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync contact ${contactId}:`, err.message);
    await updateSyncStatusRecord("contacts", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncContactFromGhl(ghlContact: any): Promise<{ contactId: number; created: boolean } | null> {
  try {
    const existingByGhlId = ghlContact.id
      ? (await storage.getContacts({ limit: 500 })).data.find(c => c.ghlContactId === ghlContact.id)
      : null;

    if (existingByGhlId) {
      const { conflictFields, cleanPayload } = await detectAndWriteConflicts(existingByGhlId, ghlContact);

      // Tags are always applied (no conflict model for array fields)
      if (Array.isArray(ghlContact.tags)) {
        cleanPayload.tags = ghlContact.tags;
      }

      if (conflictFields.length === 0) {
        // Fully clean sync — apply field changes and advance the baseline.
        // syncUpdateContact does NOT bump updatedAt, so updatedAt stays as the last
        // genuine user-edit timestamp and future conflict detection stays accurate.
        cleanPayload.lastSyncedAt = new Date();
        await storage.syncUpdateContact(existingByGhlId.id, cleanPayload);
      } else if (Object.keys(cleanPayload).length > 0) {
        // Some fields were clean, some conflicted — apply only the clean ones, preserve baseline.
        await storage.syncUpdateContact(existingByGhlId.id, cleanPayload);
        console.log(`[GHL Sync] ${conflictFields.length} conflict(s) logged for contact #${existingByGhlId.id}: ${conflictFields.join(", ")}`);
      } else {
        // All changed fields were conflicted — don't touch anything; preserve lastSyncedAt.
        console.log(`[GHL Sync] ${conflictFields.length} conflict(s) logged for contact #${existingByGhlId.id}: ${conflictFields.join(", ")} — no DB write`);
      }

      await updateSyncStatusRecord("contacts", "inbound", 1, 0);
      return { contactId: existingByGhlId.id, created: false };
    }

    if (ghlContact.email) {
      const existingByEmail = (await storage.getContacts({ limit: 500 })).data.find(c => c.email?.toLowerCase() === ghlContact.email?.toLowerCase());
      if (existingByEmail) {
        const { conflictFields: emailConflicts, cleanPayload } = await detectAndWriteConflicts(existingByEmail, ghlContact);
        const mergedPayload: UpdateContactRequest = { ghlContactId: ghlContact.id, ...cleanPayload };
        if (Array.isArray(ghlContact.tags)) {
          mergedPayload.tags = ghlContact.tags;
        }
        // Only advance lastSyncedAt when no conflicts were detected.
        // syncUpdateContact preserves updatedAt so conflict detection stays accurate.
        if (emailConflicts.length === 0) {
          mergedPayload.lastSyncedAt = new Date();
        }
        await storage.syncUpdateContact(existingByEmail.id, mergedPayload);
        await updateSyncStatusRecord("contacts", "inbound", 1, 0);
        return { contactId: existingByEmail.id, created: false };
      }
    }

    const contact = await storage.createContact({
      firstName: ghlContact.firstName || "Unknown",
      lastName: ghlContact.lastName || "",
      email: ghlContact.email || "",
      phone: ghlContact.phone || "",
      companyName: ghlContact.companyName || "",
      ghlContactId: ghlContact.id,
      status: "New",
      tags: [...(ghlContact.tags || []), "ghl-import"],
      referralSource: "ghl_sync",
      lastSyncedAt: new Date(),
    });

    await updateSyncStatusRecord("contacts", "inbound", 1, 0);
    return { contactId: contact.id, created: true };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync from GHL:", err.message);
    await updateSyncStatusRecord("contacts", "inbound", 0, 1, err.message);
    return null;
  }
}

export async function fullSyncToGhl(): Promise<{ synced: number; failed: number; skipped: number }> {
  if (!isGhlConfigured()) return { synced: 0, failed: 0, skipped: 0 };

  const { data: contacts } = await storage.getContacts({ limit: 500 });
  const unsyncedContacts = contacts.filter(c => !c.ghlContactId && c.email);

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  console.log(`[GHL Sync] Starting full sync: ${unsyncedContacts.length} contacts to push`);

  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 1000;

  for (let i = 0; i < unsyncedContacts.length; i += BATCH_SIZE) {
    const batch = unsyncedContacts.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (contact) => {
      try {
        const result = await syncContactToGhl(contact.id);
        if (result.success) {
          synced++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`[GHL Sync] Error syncing contact ${contact.id}:`, err);
        failed++;
      }
    }));
    if (i + BATCH_SIZE < unsyncedContacts.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  skipped = contacts.filter(c => c.ghlContactId).length;
  console.log(`[GHL Sync] Full sync complete: ${synced} synced, ${failed} failed, ${skipped} already synced`);

  await storage.setSystemSetting("ghl_last_sync_to", {
    timestamp: new Date().toISOString(),
    synced,
    failed,
    skipped,
  });

  return { synced, failed, skipped };
}

export async function fullSyncFromGhl(): Promise<{ created: number; updated: number; failed: number }> {
  if (!isGhlConfigured()) return { created: 0, updated: 0, failed: 0 };

  const config = getConfig();
  if (!config) return { created: 0, updated: 0, failed: 0 };

  let created = 0;
  let updated = 0;
  let failed = 0;
  let nextPageUrl: string | null = `/contacts/?locationId=${config.locationId}&limit=100`;

  console.log("[GHL Sync] Starting full sync from GHL...");

  try {
    while (nextPageUrl) {
      const data = await ghlFetch(nextPageUrl);
      const contacts = data.contacts || [];

      for (const ghlContact of contacts) {
        try {
          const result = await syncContactFromGhl(ghlContact);
          if (result) {
            if (result.created) created++;
            else updated++;
          }
        } catch (err) {
          failed++;
        }
      }

      const meta = data.meta;
      if (meta?.nextPageUrl || meta?.nextPage) {
        const next = meta.nextPageUrl || meta.nextPage;
        nextPageUrl = next.startsWith("http") ? next.replace(GHL_API_BASE, "") : next;
      } else if (data.meta?.total && (created + updated + failed) < data.meta.total && contacts.length === 100) {
        nextPageUrl = `/contacts/?locationId=${config.locationId}&limit=100&startAfter=${contacts[contacts.length - 1]?.id}`;
      } else {
        nextPageUrl = null;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err: any) {
    console.error("[GHL Sync] Error during full sync from GHL:", err.message);
  }

  console.log(`[GHL Sync] From GHL complete: ${created} created, ${updated} updated, ${failed} failed`);

  await storage.setSystemSetting("ghl_last_sync_from", {
    timestamp: new Date().toISOString(),
    created,
    updated,
    failed,
  });

  return { created, updated, failed };
}

let cachedPipelineId: string | null = null;
let cachedStageIdMap: Record<string, string> = {};
// Timestamp of when the pipeline/stage cache was last populated.
// A 5-minute TTL ensures stale stage IDs are refreshed without hammering GHL on every job.
let cachedPipelineAt: number | null = null;
const PIPELINE_CACHE_TTL_MS = 5 * 60 * 1000;

function isPipelineCacheValid(): boolean {
  return (
    cachedPipelineId !== null &&
    Object.keys(cachedStageIdMap).length > 0 &&
    cachedPipelineAt !== null &&
    Date.now() - cachedPipelineAt < PIPELINE_CACHE_TTL_MS
  );
}

async function ensurePipeline(): Promise<string> {
  const envPipelineId = process.env.GHL_PIPELINE_ID;
  if (envPipelineId && envPipelineId !== "default" && isPipelineCacheValid()) {
    return envPipelineId;
  }
  if (isPipelineCacheValid()) return cachedPipelineId!;

  const config = getConfig();
  if (!config) throw new Error("GHL not configured");

  try {
    const data = await ghlFetch(`/opportunities/pipelines?locationId=${config.locationId}`);
    const pipelines = data.pipelines || [];

    let chosenPipeline = null;
    if (envPipelineId && envPipelineId !== "default") {
      chosenPipeline = pipelines.find((p: any) => p.id === envPipelineId);
    }
    if (!chosenPipeline) {
      const lbPipeline = pipelines.find((p: any) =>
        p.name?.toLowerCase().includes("liberty") || p.name?.toLowerCase().includes("lb-")
      );
      chosenPipeline = lbPipeline || (pipelines.length > 0 ? pipelines[0] : null);
    }
    if (chosenPipeline) {
      cachedPipelineId = chosenPipeline.id;
      const stages = chosenPipeline.stages || [];
      for (const stage of stages) {
        if (stage.name && stage.id) {
          cachedStageIdMap[stage.name] = stage.id;
        }
      }
      cachedPipelineAt = Date.now();
      console.log(`[GHL Sync] Using pipeline: "${chosenPipeline.name}" (${chosenPipeline.id}) with ${stages.length} stages`);
      return chosenPipeline.id;
    }

    const stageNames = Object.keys(GHL_PIPELINE_STAGE_MAP);
    const newPipeline = await ghlFetch("/opportunities/pipelines", {
      method: "POST",
      body: JSON.stringify({
        locationId: config.locationId,
        name: "Liberty Bancard Sales Pipeline",
        stages: stageNames.map((name, i) => ({
          name,
          position: i,
        })),
      }),
    });

    cachedPipelineId = newPipeline.pipeline?.id || newPipeline.id;
    const createdStages = newPipeline.pipeline?.stages || newPipeline.stages || [];
    if (createdStages.length > 0) {
      const stageIdMap: Record<string, string> = {};
      for (const stage of createdStages) {
        if (stage.name && stage.id) {
          stageIdMap[stage.name] = stage.id;
        }
      }
      cachedStageIdMap = stageIdMap;
      cachedPipelineAt = Date.now();
      console.log(`[GHL Sync] Captured ${Object.keys(stageIdMap).length} stage IDs from new pipeline`);
    }

    console.log(`[GHL Sync] Created new pipeline: ${cachedPipelineId}`);
    return cachedPipelineId!;
  } catch (err: any) {
    console.error("[GHL Sync] Pipeline discovery failed:", err.message);
    return process.env.GHL_PIPELINE_ID || "default";
  }
}

function getGhlStageIdOverrides(): Record<string, string> {
  const raw = process.env.GHL_STAGE_ID_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(`[GHL Sync] GHL_STAGE_ID_MAP parsed but is not a plain object (got ${Array.isArray(parsed) ? "array" : typeof parsed}): ${raw}`);
      return {};
    }
    return parsed;
  } catch {
    console.warn(`[GHL Sync] GHL_STAGE_ID_MAP failed to parse as JSON — stage ID overrides disabled. Bad value: ${raw}`);
    return {};
  }
}

export function mapDealStageToGhl(stage: string): { pipelineStageId: string; status: "open" | "won" | "lost" | "abandoned" } {
  const overrides = getGhlStageIdOverrides();
  const ghlStageId = overrides[stage] || cachedStageIdMap[stage] || GHL_PIPELINE_STAGE_MAP[stage] || "new_lead";
  let status: "open" | "won" | "lost" | "abandoned" = "open";
  if (stage === "Closed Won") status = "won";
  else if (stage === "Closed Lost") status = "lost";
  else if (stage === "Nurture / Not Now") status = "abandoned";
  return { pipelineStageId: ghlStageId, status };
}

export function mapGhlStageToDeal(ghlStageId: string, ghlStatus?: string): string {
  if (ghlStatus === "won") return "Closed Won";
  if (ghlStatus === "lost") return "Closed Lost";
  const overrides = getGhlStageIdOverrides();
  const reverseOverrides = Object.fromEntries(Object.entries(overrides).map(([k, v]) => [v, k]));
  const reverseCached = Object.fromEntries(Object.entries(cachedStageIdMap).map(([k, v]) => [v, k]));
  return reverseOverrides[ghlStageId] || reverseCached[ghlStageId] || GHL_PIPELINE_STAGE_REVERSE[ghlStageId] || "New Lead";
}

export async function syncDealToGhl(dealId: number): Promise<{ success: boolean; ghlOpportunityId?: string; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };
    const config = getConfig();
    if (!config) return { success: false, error: "GHL not configured" };

    const deal = await storage.getDeal(dealId);
    if (!deal) return { success: false, error: "Deal not found" };

    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
    let ghlContactId = contact?.ghlContactId;
    if (contact && !ghlContactId) {
      const syncResult = await syncContactToGhl(contact.id);
      ghlContactId = syncResult.ghlContactId;
    }
    if (!ghlContactId) return { success: false, error: "No GHL contact linked" };

    const pipelineId = await ensurePipeline();
    const stageMapping = mapDealStageToGhl(deal.stage);

    const opportunityPayload: Record<string, any> = {
      pipelineId,
      locationId: config.locationId,
      name: deal.contactId ? `${contact?.companyName || contact?.firstName} - Deal #${deal.id}` : `Deal #${deal.id}`,
      status: stageMapping.status,
      contactId: ghlContactId,
      monetaryValue: deal.totalVolume ? Number(deal.totalVolume) : undefined,
      pipelineStageId: stageMapping.pipelineStageId,
    };

    const existingGhlOpportunityId = deal.ghlOpportunityId;

    let ghlOpportunityId: string | undefined;
    if (existingGhlOpportunityId) {
      await ghlFetch(`/opportunities/${existingGhlOpportunityId}`, {
        method: "PUT",
        body: JSON.stringify(opportunityPayload),
      });
      ghlOpportunityId = existingGhlOpportunityId;
    } else {
      const result = await ghlFetch("/opportunities/", {
        method: "POST",
        body: JSON.stringify(opportunityPayload),
      });
      ghlOpportunityId = result?.opportunity?.id || result?.id;
      if (ghlOpportunityId) {
        await storage.updateDeal(dealId, { ghlOpportunityId });
      }
    }

    if (contact) {
      await checkAndApplyActivePipelineTag(contact, ghlContactId);
    }

    await updateSyncStatusRecord("deals", "outbound", 1, 0);
    return { success: true, ghlOpportunityId };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync deal ${dealId}:`, err.message);
    await updateSyncStatusRecord("deals", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncDealFromGhl(ghlOpportunity: any): Promise<{ dealId: number; created: boolean } | null> {
  try {
    const ghlContactId = ghlOpportunity.contactId || ghlOpportunity.contact?.id;
    if (!ghlContactId) return null;

    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === ghlContactId);
    if (!contact) return null;

    const ghlStageId = ghlOpportunity.pipelineStageId || ghlOpportunity.stageId;
    const ghlStatus = ghlOpportunity.status;
    const localStage = mapGhlStageToDeal(ghlStageId, ghlStatus);

    const existingDeals = await storage.getDealsByContact(contact.id);
    const existingDeal = existingDeals.find(d => d.ghlOpportunityId === ghlOpportunity.id);

    if (existingDeal) {
      const updatePayload: Record<string, any> = { stage: localStage };
      if (ghlOpportunity.monetaryValue !== undefined && ghlOpportunity.monetaryValue !== null) {
        updatePayload.totalVolume = String(ghlOpportunity.monetaryValue);
      } else if (ghlOpportunity.monetaryValue === null) {
        updatePayload.totalVolume = null;
      }
      if (ghlOpportunity.name) {
        updatePayload.notes = existingDeal.notes || `GHL Opportunity: ${ghlOpportunity.name}`;
      }
      await storage.updateDeal(existingDeal.id, updatePayload);
      await updateSyncStatusRecord("deals", "inbound", 1, 0);
      return { dealId: existingDeal.id, created: false };
    }

    const newDeal = await storage.createDeal({
      contactId: contact.id,
      stage: localStage,
      pipeline: "sales",
      totalVolume: (ghlOpportunity.monetaryValue !== undefined && ghlOpportunity.monetaryValue !== null) ? String(ghlOpportunity.monetaryValue) : undefined,
      notes: `Synced from GHL opportunity: ${ghlOpportunity.name || ghlOpportunity.id}`,
    });

    if (ghlOpportunity.id) {
      await storage.updateDeal(newDeal.id, { ghlOpportunityId: ghlOpportunity.id });
    }

    await updateSyncStatusRecord("deals", "inbound", 1, 0);
    return { dealId: newDeal.id, created: true };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync deal from GHL:", err.message);
    await updateSyncStatusRecord("deals", "inbound", 0, 1, err.message);
    return null;
  }
}

export async function syncCompanyToGhl(companyId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };
    const config = getConfig();
    if (!config) return { success: false, error: "GHL not configured" };

    const companies = await storage.getCompanies();
    const company = companies.find(c => c.id === companyId);
    if (!company) return { success: false, error: "Company not found" };

    const companyPayload = {
      name: company.legalName,
      website: company.website || undefined,
      address: company.address || undefined,
      locationId: config.locationId,
    };

    await ghlFetch("/companies/", {
      method: "POST",
      body: JSON.stringify(companyPayload),
    });

    await updateSyncStatusRecord("companies", "outbound", 1, 0);
    console.log(`[GHL Sync] Company ${companyId} (${company.legalName}) synced to GHL`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync company ${companyId}:`, err.message);
    await updateSyncStatusRecord("companies", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncTaskToGhl(taskId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };
    const config = getConfig();
    if (!config) return { success: false, error: "GHL not configured" };

    const allTasks = await storage.getTasks({ limit: 500 });
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: "Task not found" };

    let ghlContactId: string | undefined;
    if (task.contactId) {
      const contact = await storage.getContact(task.contactId);
      ghlContactId = contact?.ghlContactId || undefined;
      if (contact && !ghlContactId) {
        const syncResult = await syncContactToGhl(contact.id);
        ghlContactId = syncResult.ghlContactId;
      }
    }

    if (!ghlContactId) return { success: false, error: "No GHL contact linked to task" };

    const taskPayload = {
      title: task.title,
      body: task.description || "",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
      completed: task.status === "completed",
      contactId: ghlContactId,
    };

    await ghlFetch(`/contacts/${ghlContactId}/tasks`, {
      method: "POST",
      body: JSON.stringify(taskPayload),
    });

    await updateSyncStatusRecord("tasks", "outbound", 1, 0);
    console.log(`[GHL Sync] Task ${taskId} synced to GHL`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync task ${taskId}:`, err.message);
    await updateSyncStatusRecord("tasks", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncTicketToGhl(ticketId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };
    const config = getConfig();
    if (!config) return { success: false, error: "GHL not configured" };

    const ticket = await storage.getTicket(ticketId);
    if (!ticket) return { success: false, error: "Ticket not found" };

    let ghlContactId: string | undefined;
    if (ticket.contactId) {
      const contact = await storage.getContact(ticket.contactId);
      ghlContactId = contact?.ghlContactId || undefined;
      if (contact && !ghlContactId) {
        const syncResult = await syncContactToGhl(contact.id);
        ghlContactId = syncResult.ghlContactId;
      }
    }

    if (!ghlContactId) return { success: false, error: "No GHL contact linked to ticket" };

    const taskPayload = {
      title: `[Ticket #${ticket.id}] ${ticket.subject}`,
      body: `${ticket.description}\n\nPriority: ${ticket.priority}\nCategory: ${ticket.category}\nStatus: ${ticket.status}`,
      dueDate: ticket.slaDeadline ? new Date(ticket.slaDeadline).toISOString() : undefined,
      completed: ticket.status === "Resolved" || ticket.status === "Closed",
      contactId: ghlContactId,
    };

    await ghlFetch(`/contacts/${ghlContactId}/tasks`, {
      method: "POST",
      body: JSON.stringify(taskPayload),
    });

    await updateSyncStatusRecord("tickets", "outbound", 1, 0);
    console.log(`[GHL Sync] Ticket ${ticketId} synced to GHL as task`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync ticket ${ticketId}:`, err.message);
    await updateSyncStatusRecord("tickets", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncNoteToGhl(noteId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };

    const noteRow = await storage.getNote(noteId);
    if (!noteRow) return { success: false, error: "Note not found" };

    const entityType = noteRow.entityType;
    const entityId = noteRow.entityId;
    const content = noteRow.content;

    let ghlContactId: string | undefined;
    if (entityType === "contact") {
      const contact = await storage.getContact(entityId);
      ghlContactId = contact?.ghlContactId || undefined;
      if (contact && !ghlContactId) {
        const syncResult = await syncContactToGhl(contact.id);
        ghlContactId = syncResult.ghlContactId;
      }
    } else if (entityType === "deal") {
      const deal = await storage.getDeal(entityId);
      if (deal?.contactId) {
        const contact = await storage.getContact(deal.contactId);
        ghlContactId = contact?.ghlContactId || undefined;
      }
    }

    if (!ghlContactId) return { success: false, error: "No GHL contact linked to note entity" };

    await ghlFetch(`/contacts/${ghlContactId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: content }),
    });

    await updateSyncStatusRecord("notes", "outbound", 1, 0);
    console.log(`[GHL Sync] Note ${noteId} synced to GHL`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync note ${noteId}:`, err.message);
    await updateSyncStatusRecord("notes", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncTaskFromGhl(ghlTask: any, ghlContactId: string): Promise<{ success: boolean; taskId?: number; error?: string }> {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === ghlContactId);
    if (!contact) return { success: false, error: "Contact not found for GHL contact" };

    const allTasks = await storage.getTasks({ limit: 500 });
    const existingTask = allTasks.find(t =>
      t.contactId === contact.id &&
      t.title === ghlTask.title
    );

    if (existingTask) {
      await storage.updateTask(existingTask.id, {
        status: ghlTask.completed ? "completed" : existingTask.status,
        description: ghlTask.body || existingTask.description,
      });
      await updateSyncStatusRecord("tasks", "inbound", 1, 0);
      return { success: true, taskId: existingTask.id };
    }

    const newTask = await storage.createTask({
      title: ghlTask.title || "Task from GHL",
      contactId: contact.id,
      status: ghlTask.completed ? "completed" : "pending",
      priority: "medium",
      dueDate: ghlTask.dueDate ? new Date(ghlTask.dueDate) : undefined,
      description: ghlTask.body || "",
      assignedTo: "Unassigned",
    });

    await updateSyncStatusRecord("tasks", "inbound", 1, 0);
    return { success: true, taskId: newTask.id };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync task from GHL:", err.message);
    await updateSyncStatusRecord("tasks", "inbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncCompanyFromGhl(ghlCompany: any): Promise<{ success: boolean; companyId?: number; error?: string }> {
  try {
    const companies = await storage.getCompanies();
    const existing = companies.find(c =>
      c.legalName?.toLowerCase() === (ghlCompany.name || "").toLowerCase()
    );

    if (existing) {
      await updateSyncStatusRecord("companies", "inbound", 1, 0);
      return { success: true, companyId: existing.id };
    }

    const newCompany = await storage.createCompany({
      legalName: ghlCompany.name || "Unknown Company",
      dba: ghlCompany.dba || ghlCompany.name || "",
      website: ghlCompany.website || "",
      address: ghlCompany.address || "",
    });

    await updateSyncStatusRecord("companies", "inbound", 1, 0);
    return { success: true, companyId: newCompany.id };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync company from GHL:", err.message);
    await updateSyncStatusRecord("companies", "inbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncTagsToGhl(contactId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) return { success: false, error: "GHL not configured" };

    const contact = await storage.getContact(contactId);
    if (!contact) return { success: false, error: "Contact not found" };

    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      const syncResult = await syncContactToGhl(contactId);
      ghlContactId = syncResult.ghlContactId;
    }
    if (!ghlContactId) return { success: false, error: "No GHL contact linked" };

    const tags = contact.tags || [];
    if (tags.length === 0) return { success: true };

    await ghlFetch(`/contacts/${ghlContactId}`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    });

    await updateSyncStatusRecord("tags", "outbound", 1, 0);
    console.log(`[GHL Sync] Tags synced for contact ${contactId}: ${tags.join(", ")}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync tags for contact ${contactId}:`, err.message);
    await updateSyncStatusRecord("tags", "outbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncTagsFromGhl(ghlContactId: string, tags: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === ghlContactId);
    if (!contact) return { success: false, error: "Contact not found" };

    const mergedTags = [...new Set([...(contact.tags || []), ...tags])];
    await storage.updateContact(contact.id, { tags: mergedTags });

    await updateSyncStatusRecord("tags", "inbound", 1, 0);
    return { success: true };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync tags from GHL:", err.message);
    await updateSyncStatusRecord("tags", "inbound", 0, 1, err.message);
    return { success: false, error: err.message };
  }
}

export async function removeTagsFromLocal(ghlContactId: string, tags: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === ghlContactId);
    if (!contact) return { success: false, error: "Contact not found" };

    const filteredTags = (contact.tags || []).filter(t => !tags.includes(t));
    await storage.updateContact(contact.id, { tags: filteredTags });

    await updateSyncStatusRecord("tags", "inbound", 1, 0);
    return { success: true };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to remove tags from local:", err.message);
    return { success: false, error: err.message };
  }
}

export async function applyParentLocationTags(contact: Contact, ghlContactId?: string): Promise<void> {
  try {
    if (!ghlContactId) ghlContactId = contact.ghlContactId || undefined;
    if (!ghlContactId) return;

    const currentTags: string[] = contact.tags || [];
    let updatedTags = [...currentTags];
    const customFields: Array<{ key: string; field_value: string }> = [];

    if (contact.isParentAccount) {
      if (!updatedTags.includes("lb_parent_account")) {
        updatedTags = [...updatedTags, "lb_parent_account"];
      }
    } else {
      updatedTags = updatedTags.filter(t => t !== "lb_parent_account");
    }

    if (contact.parentContactId) {
      const parent = await storage.getContact(contact.parentContactId);
      if (parent) {
        const parentName = parent.companyName || `${parent.firstName} ${parent.lastName}`.trim();
        customFields.push({ key: "lb_location_of", field_value: parentName });
      }
    } else {
      customFields.push({ key: "lb_location_of", field_value: "" });
    }

    const tagsChanged = updatedTags.join(",") !== currentTags.join(",");
    if (tagsChanged || customFields.length > 0) {
      const payload: Record<string, any> = {};
      if (tagsChanged) {
        payload.tags = updatedTags;
        await storage.syncUpdateContact(contact.id, { tags: updatedTags });
      }
      if (customFields.length > 0) {
        payload.customFields = customFields;
      }
      await ghlFetch(`/contacts/${ghlContactId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (contact.isParentAccount) {
        console.log(`[GHL Sync] Applied lb_parent_account tag to contact ${contact.id}`);
      }
      if (contact.parentContactId) {
        console.log(`[GHL Sync] Applied lb_location_of custom field to contact ${contact.id}`);
      }
    }
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to apply parent/location tags for contact ${contact.id}:`, err.message);
  }
}

export async function checkAndApplyActivePipelineTag(contact: Contact, ghlContactId?: string): Promise<void> {
  try {
    if (!ghlContactId) ghlContactId = contact.ghlContactId || undefined;
    if (!ghlContactId) return;

    const deals = await storage.getDealsByContact(contact.id);
    const hasActiveDeal = deals.some(d => (ACTIVE_DEAL_STAGES as readonly string[]).includes(d.stage));

    const currentTags = contact.tags || [];
    const hasActiveTag = currentTags.includes("LB-ACTIVE-PIPELINE");

    if (hasActiveDeal && !hasActiveTag) {
      const updatedTags = [...currentTags, "LB-ACTIVE-PIPELINE"];
      await storage.updateContact(contact.id, { tags: updatedTags });

      await ghlFetch(`/contacts/${ghlContactId}`, {
        method: "PUT",
        body: JSON.stringify({
          tags: updatedTags,
          customFields: [{ key: "lb_do_not_sdr", field_value: "true" }],
        }),
      });
      console.log(`[GHL Sync] Applied LB-ACTIVE-PIPELINE tag to contact ${contact.id}`);
    } else if (!hasActiveDeal && hasActiveTag) {
      const updatedTags = currentTags.filter(t => t !== "LB-ACTIVE-PIPELINE");
      await storage.updateContact(contact.id, { tags: updatedTags });

      await ghlFetch(`/contacts/${ghlContactId}`, {
        method: "PUT",
        body: JSON.stringify({
          tags: updatedTags,
          customFields: [{ key: "lb_do_not_sdr", field_value: "false" }],
        }),
      });
      console.log(`[GHL Sync] Removed LB-ACTIVE-PIPELINE tag from contact ${contact.id}`);
    }
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to check active pipeline for contact ${contact.id}:`, err.message);
  }
}

export async function syncActivityFromGhl(payload: {
  contactId: string;
  type: string;
  channel: string;
  body?: string;
  subject?: string;
  messageId?: string;
  direction?: string;
}): Promise<void> {
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === payload.contactId);
    if (!contact) return;

    const { data: deals } = await storage.getDeals({ limit: 500 });
    const contactDeal = deals.find(d => d.contactId === contact.id);

    await storage.createGhlActivityLog({
      contactId: contact.id,
      dealId: contactDeal?.id || null,
      direction: payload.direction || "inbound",
      channel: payload.channel || "email",
      templateId: null,
      subject: payload.subject || null,
      body: payload.body || null,
      status: "received",
      ghlMessageId: payload.messageId || null,
      metadata: { source: "ghl_webhook", type: payload.type },
    });

    await updateSyncStatusRecord("activity", "inbound", 1, 0);
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync activity from GHL:", err.message);
    await updateSyncStatusRecord("activity", "inbound", 0, 1, err.message);
  }
}

export async function getGhlSyncStatus() {
  const contactStats = await storage.getContactAggregateStats();
  const lastSyncTo = await storage.getSystemSetting("ghl_last_sync_to");
  const lastSyncFrom = await storage.getSystemSetting("ghl_last_sync_from");

  let entitySyncStatuses: any[] = [];
  try {
    const rows = await db.select().from(ghlSyncStatus);
    entitySyncStatuses = rows;
  } catch {
    entitySyncStatuses = [];
  }

  return {
    configured: isGhlConfigured(),
    totalContacts: contactStats.total,
    syncedToGhl: contactStats.syncedToGhl,
    unsyncedToGhl: contactStats.total - contactStats.syncedToGhl,
    lastSyncTo,
    lastSyncFrom,
    entitySyncStatuses,
  };
}

export async function getFullSyncDashboard() {
  const baseStatus = await getGhlSyncStatus();

  const dealStats = await storage.getDealAggregateStats();

  let entityStatuses: Record<string, any> = {};
  try {
    const rows = await db.select().from(ghlSyncStatus);
    for (const row of rows) {
      entityStatuses[row.entityType] = {
        lastSyncAt: row.lastSyncAt,
        lastSyncDirection: row.lastSyncDirection,
        syncedCount: row.syncedCount,
        errorCount: row.errorCount,
        lastError: row.lastError,
      };
    }
  } catch {
    entityStatuses = {};
  }

  if (!entityStatuses["contacts"]) entityStatuses["contacts"] = {};
  entityStatuses["contacts"].localCount = baseStatus.totalContacts;
  entityStatuses["contacts"].ghlSyncedCount = baseStatus.syncedToGhl;

  if (!entityStatuses["deals"]) entityStatuses["deals"] = {};
  entityStatuses["deals"].localCount = dealStats.total;

  return {
    ...baseStatus,
    totalDeals: dealStats.total,
    entityStatuses,
  };
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
const syncedCompanyIds = new Set<number>();
const syncedTaskIds = new Set<number>();

const GHL_CIRCUIT_THRESHOLD = 5;
let consecutiveGhlFailures = 0;

export function startAutoSyncLoop(intervalMs: number = 45000): void {
  if (syncIntervalId) return;

  console.log(`[GHL Sync] Auto-sync loop started (every ${intervalMs / 1000}s)`);
  syncIntervalId = setInterval(async () => {
    if (!isGhlConfigured()) return;
    try {
      await runGhlFullSyncTick();
    } catch (err: any) {
      console.error("[GHL Sync] Auto-sync loop error:", err.message);
    }
  }, intervalMs);
}

export function stopAutoSyncLoop(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log("[GHL Sync] Auto-sync loop stopped");
  }
}

/**
 * Full GHL sync tick — mirrors the complete body of startAutoSyncLoop's
 * setInterval callback (contacts, failed-contact retry, deals, recent tasks,
 * unsynced companies), sharing the same module-level tracking sets so state
 * is preserved across BullMQ repeatable job invocations within the same process.
 */
export async function runGhlFullSyncTick(): Promise<void> {
  if (!isGhlConfigured()) return;
  consecutiveGhlFailures = 0;
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.GHL_SYNC);
  if (!acquired) return;
  try {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const unsyncedContacts = contacts.filter(c => !c.ghlContactId && c.email);
    let synced = 0;
    for (const contact of unsyncedContacts.slice(0, 10)) {
      if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
        console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting tick`);
        storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures in contacts phase — tick aborted` }).catch(() => {});
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncContactToGhl(contact.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          synced++;
        } else {
          consecutiveGhlFailures++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        consecutiveGhlFailures++;
        console.error(`[Queue:ghl-sync] Contact ${contact.id} sync error:`, e.message);
      }
    }

    if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
      console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures after contacts phase, aborting tick`);
      storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures after contacts phase — tick aborted` }).catch(() => {});
      await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
      return;
    }

    try {
      const auditLogs = await storage.getAuditLogs();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const failedContactIds = [...new Set(
        auditLogs
          .filter(l => l.action === "ghl_sync_failed" && l.entityType === "contact" && l.createdAt && new Date(l.createdAt).getTime() > oneHourAgo)
          .map(l => l.entityId)
          .filter((id): id is number => typeof id === "number")
      )].slice(0, 5);
      for (const contactId of failedContactIds) {
        if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
          console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting retry phase`);
          break;
        }
        try {
          const result = await syncContactToGhl(contactId);
          if (result.success) {
            consecutiveGhlFailures = 0;
            synced++;
            console.log(`[Queue:ghl-sync] Retry succeeded for failed contact ${contactId}`);
          } else {
            consecutiveGhlFailures++;
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (e: any) {
          consecutiveGhlFailures++;
          console.warn(`[Queue:ghl-sync] Retry failed for contact ${contactId}:`, e.message);
        }
      }
    } catch (auditErr: any) {
      console.warn(`[Queue:ghl-sync] Could not check audit log for retry candidates:`, auditErr.message);
    }

    if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
      console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting tick before deals`);
      storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures before deals phase — tick aborted` }).catch(() => {});
      await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
      return;
    }

    const { data: deals } = await storage.getDeals({ limit: 500 });
    const unsyncedDeals = deals.filter(d => !d.ghlOpportunityId && d.contactId);
    let dealsSynced = 0;
    for (const deal of unsyncedDeals.slice(0, 5)) {
      if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
        console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting deals phase`);
        storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures in deals phase — tick aborted` }).catch(() => {});
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncDealToGhl(deal.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          dealsSynced++;
        } else {
          consecutiveGhlFailures++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        consecutiveGhlFailures++;
        console.error(`[Queue:ghl-sync] Deal ${deal.id} sync error:`, e.message);
      }
    }

    if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
      console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures after deals phase, aborting tick`);
      storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures after deals phase — tick aborted` }).catch(() => {});
      await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
      return;
    }

    const allTasks = await storage.getTasks({ limit: 100 });
    const recentTasks = allTasks.filter(t => {
      if (!t.contactId || syncedTaskIds.has(t.id)) return false;
      const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      return Date.now() - created < 120000;
    });
    let tasksSynced = 0;
    for (const task of recentTasks.slice(0, 5)) {
      if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
        console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting tasks phase`);
        storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures in tasks phase — tick aborted` }).catch(() => {});
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncTaskToGhl(task.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          tasksSynced++;
          syncedTaskIds.add(task.id);
        } else {
          consecutiveGhlFailures++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        consecutiveGhlFailures++;
        console.error(`[Queue:ghl-sync] Task ${task.id} sync error:`, e.message);
      }
    }

    if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
      console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures after tasks phase, aborting tick`);
      storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures after tasks phase — tick aborted` }).catch(() => {});
      await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
      return;
    }

    const companies = await storage.getCompanies();
    const unsyncedCompanies = companies.filter(c => !syncedCompanyIds.has(c.id));
    let companiesSynced = 0;
    for (const company of unsyncedCompanies.slice(0, 5)) {
      if (consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD) {
        console.error(`[Queue:ghl-sync] GHL_CIRCUIT_OPEN — ${consecutiveGhlFailures} consecutive failures, aborting companies phase`);
        storage.createAuditLog({ action: "GHL_CIRCUIT_OPEN", entityType: "system", details: `Circuit opened: ${consecutiveGhlFailures} consecutive GHL failures in companies phase — tick aborted` }).catch(() => {});
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncCompanyToGhl(company.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          companiesSynced++;
          syncedCompanyIds.add(company.id);
        } else {
          consecutiveGhlFailures++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        consecutiveGhlFailures++;
        console.error(`[Queue:ghl-sync] Company ${company.id} sync error:`, e.message);
      }
    }

    if (synced > 0 || dealsSynced > 0 || tasksSynced > 0 || companiesSynced > 0) {
      console.log(`[Queue:ghl-sync] Batch: ${synced} contacts, ${dealsSynced} deals, ${tasksSynced} tasks, ${companiesSynced} companies`);
    }
    await releaseJobLock(JOB_NAMES.GHL_SYNC, true);
  } catch (err: any) {
    await releaseJobLock(JOB_NAMES.GHL_SYNC, false, err.message);
    throw err;
  }
}
