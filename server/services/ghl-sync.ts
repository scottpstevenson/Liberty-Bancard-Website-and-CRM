import { storage } from "../storage";
import type { Contact, Deal } from "@shared/schema";
import { upsertGhlContact, isGhlConfigured, sendGhlEmail } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";

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
  return response.json();
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

    return { success: true, ghlContactId: ghlId };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync contact ${contactId}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncContactFromGhl(ghlContact: any): Promise<{ contactId: number; created: boolean } | null> {
  try {
    const existingByGhlId = ghlContact.id
      ? (await storage.getContacts({ limit: 500 })).data.find(c => c.ghlContactId === ghlContact.id)
      : null;

    if (existingByGhlId) {
      await storage.updateContact(existingByGhlId.id, {
        firstName: ghlContact.firstName || existingByGhlId.firstName,
        lastName: ghlContact.lastName || existingByGhlId.lastName,
        email: ghlContact.email || existingByGhlId.email,
        phone: ghlContact.phone || existingByGhlId.phone,
        companyName: ghlContact.companyName || existingByGhlId.companyName,
        tags: [...new Set([...(existingByGhlId.tags || []), ...(ghlContact.tags || [])])],
      });
      return { contactId: existingByGhlId.id, created: false };
    }

    if (ghlContact.email) {
      const existingByEmail = (await storage.getContacts({ limit: 500 })).data.find(c => c.email?.toLowerCase() === ghlContact.email?.toLowerCase());
      if (existingByEmail) {
        await storage.updateContact(existingByEmail.id, {
          ghlContactId: ghlContact.id,
          phone: ghlContact.phone || existingByEmail.phone,
          tags: [...new Set([...(existingByEmail.tags || []), ...(ghlContact.tags || [])])],
        });
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
    });

    return { contactId: contact.id, created: true };
  } catch (err: any) {
    console.error("[GHL Sync] Failed to sync from GHL:", err.message);
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

  for (const contact of unsyncedContacts) {
    try {
      const result = await syncContactToGhl(contact.id);
      if (result.success) {
        synced++;
      } else {
        failed++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`[GHL Sync] Error syncing contact ${contact.id}:`, err);
      failed++;
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

export async function syncDealToGhl(dealId: number): Promise<{ success: boolean; error?: string }> {
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

    const opportunityPayload = {
      pipelineId: "default",
      locationId: config.locationId,
      name: `Deal #${deal.id}`,
      status: deal.stage === "Won" ? "won" : deal.stage === "Lost" ? "lost" : "open",
      contactId: ghlContactId,
      monetaryValue: deal.totalVolume ? Number(deal.totalVolume) : undefined,
      pipelineStageId: deal.stage || "New Lead",
    };

    await ghlFetch("/opportunities/", {
      method: "POST",
      body: JSON.stringify(opportunityPayload),
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync deal ${dealId}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function getGhlSyncStatus() {
  const contactStats = await storage.getContactAggregateStats();
  const lastSyncTo = await storage.getSystemSetting("ghl_last_sync_to");
  const lastSyncFrom = await storage.getSystemSetting("ghl_last_sync_from");

  return {
    configured: isGhlConfigured(),
    totalContacts: contactStats.total,
    syncedToGhl: contactStats.syncedToGhl,
    unsyncedToGhl: contactStats.total - contactStats.syncedToGhl,
    lastSyncTo,
    lastSyncFrom,
  };
}
