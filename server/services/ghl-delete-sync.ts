import crypto from "crypto";
import { storage } from "../storage";
import { auditChange } from "./audit-change";
import { isGhlConfigured } from "./ghl";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function getConfig() {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId };
}

/** Typed result for delete propagation (C-02, #1626). */
export interface GhlDeletePropagationResult {
  ok: boolean;
  /** True when there was legitimately nothing to do (no GHL link, GHL not configured). */
  skipped?: boolean;
  reason?: string;
}

/**
 * Typed error thrown when the outbound pause authority denies a GHL mutation.
 */
export class GhlDeletePausedError extends Error {
  constructor(reasonCode: string) {
    super(`GHL delete blocked by pause authority: ${reasonCode}`);
    this.name = "GhlDeletePausedError";
  }
}

async function ghlDeleteFetch(path: string): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured");

  // ── C-02 (#1626): unavoidable pause authority gate before any GHL DELETE ──
  // Ordering: authorize → registerInflight → recheckEpoch → I/O → deregister.
  const { authorize, recheckEpoch } = await import("./outbound-pause-authority");
  const { registerInflight, deregisterInflight } = await import("./outbound-control-service");
  const decision = await authorize({});
  if (!decision.allowed) {
    throw new GhlDeletePausedError(decision.reasonCode);
  }
  const tokenId = crypto.randomUUID();
  await registerInflight(tokenId, decision.epoch);
  try {
    const epochOk = await recheckEpoch(decision.epoch);
    if (!epochOk) {
      throw new GhlDeletePausedError("epoch_changed_before_delete");
    }
    const response = await fetch(`${GHL_API_BASE}${path}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Version": "2021-07-28",
      },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`GHL DELETE failed with HTTP ${response.status}`);
    }
  } finally {
    deregisterInflight(tokenId);
  }
}

export async function propagateContactDeleteToGhl(contactId: number): Promise<GhlDeletePropagationResult> {
  if (!isGhlConfigured()) return { ok: true, skipped: true, reason: "ghl_not_configured" };
  try {
    const contact = await storage.getContact(contactId);
    if (!contact?.ghlContactId) {
      console.log(`[GHL Delete] Contact #${contactId} has no ghlContactId — skipping GHL delete`);
      await auditChange({
        entityType: "contact",
        entityId: contactId,
        action: "ghl_delete_skipped",
        actorType: "system",
        details: { reason: "no_ghl_contact_id", direction: "replit_to_ghl" },
      }).catch(() => {});
      return { ok: true, skipped: true, reason: "no_ghl_contact_id" };
    }
    await ghlDeleteFetch(`/contacts/${contact.ghlContactId}`);
    console.log(`[GHL Delete] Contact #${contactId} (GHL ${contact.ghlContactId}) deleted from GHL`);
    await auditChange({
      entityType: "contact",
      entityId: contactId,
      entityKey: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || String(contactId),
      action: "ghl_delete_propagated",
      actorType: "system",
      details: { ghlContactId: contact.ghlContactId, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) {
    console.error(`[GHL Delete] Failed to delete contact #${contactId} from GHL:`, err.message);
    await auditChange({
      entityType: "contact",
      entityId: contactId,
      action: "ghl_delete_failed",
      actorType: "system",
      details: { error: err.message, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: false, reason: err instanceof GhlDeletePausedError ? "paused" : err.message };
  }
}

export async function propagateDealDeleteToGhl(dealId: number): Promise<GhlDeletePropagationResult> {
  if (!isGhlConfigured()) return { ok: true, skipped: true, reason: "ghl_not_configured" };
  try {
    const deal = await storage.getDeal(dealId);
    if (!deal?.ghlOpportunityId) {
      console.log(`[GHL Delete] Deal #${dealId} has no ghlOpportunityId — skipping GHL delete`);
      await auditChange({
        entityType: "deal",
        entityId: dealId,
        action: "ghl_delete_skipped",
        actorType: "system",
        details: { reason: "no_ghl_opportunity_id", direction: "replit_to_ghl" },
      }).catch(() => {});
      return { ok: true, skipped: true, reason: "no_ghl_opportunity_id" };
    }
    await ghlDeleteFetch(`/opportunities/${deal.ghlOpportunityId}`);
    console.log(`[GHL Delete] Deal #${dealId} (GHL opportunity ${deal.ghlOpportunityId}) deleted from GHL`);
    await auditChange({
      entityType: "deal",
      entityId: dealId,
      action: "ghl_delete_propagated",
      actorType: "system",
      details: { ghlOpportunityId: deal.ghlOpportunityId, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) {
    console.error(`[GHL Delete] Failed to delete deal #${dealId} from GHL:`, err.message);
    await auditChange({
      entityType: "deal",
      entityId: dealId,
      action: "ghl_delete_failed",
      actorType: "system",
      details: { error: err.message, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: false, reason: err instanceof GhlDeletePausedError ? "paused" : err.message };
  }
}

export async function propagateTaskDeleteToGhl(taskId: number, ghlTaskId?: string | null, ghlContactId?: string | null): Promise<GhlDeletePropagationResult> {
  if (!isGhlConfigured()) return { ok: true, skipped: true, reason: "ghl_not_configured" };
  if (!ghlTaskId || !ghlContactId) {
    console.log(`[GHL Delete] Task #${taskId} missing ghlTaskId/ghlContactId — skipping GHL delete`);
    await auditChange({
      entityType: "task",
      entityId: taskId,
      action: "ghl_delete_skipped",
      actorType: "system",
      details: { reason: !ghlTaskId ? "no_ghl_task_id" : "no_ghl_contact_id", direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: true, skipped: true, reason: !ghlTaskId ? "no_ghl_task_id" : "no_ghl_contact_id" };
  }
  try {
    await ghlDeleteFetch(`/contacts/${ghlContactId}/tasks/${ghlTaskId}`);
    console.log(`[GHL Delete] Task #${taskId} (GHL ${ghlTaskId}) deleted from GHL`);
    await auditChange({
      entityType: "task",
      entityId: taskId,
      action: "ghl_delete_propagated",
      actorType: "system",
      details: { ghlTaskId, ghlContactId, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) {
    console.error(`[GHL Delete] Failed to delete task #${taskId} from GHL:`, err.message);
    await auditChange({
      entityType: "task",
      entityId: taskId,
      action: "ghl_delete_failed",
      actorType: "system",
      details: { ghlTaskId, error: err.message, direction: "replit_to_ghl" },
    }).catch(() => {});
    return { ok: false, reason: err instanceof GhlDeletePausedError ? "paused" : err.message };
  }
}

export async function handleContactDeleteWebhook(payload: any): Promise<void> {
  const ghlContactId = payload.id || payload.contactId;
  if (!ghlContactId) {
    console.warn("[GHL Delete Webhook] ContactDelete: missing contact ID in payload");
    return;
  }
  const contact = await storage.getContactByGhlContactId(ghlContactId);
  if (!contact) {
    console.log(`[GHL Delete Webhook] ContactDelete: no local record for GHL contact ${ghlContactId} — no-op`);
    return;
  }
  await storage.archiveContact(contact.id, { actorType: "system" });
  console.log(`[GHL Delete Webhook] ContactDelete: soft-deleted local contact #${contact.id} (GHL ${ghlContactId})`);
  await auditChange({
    entityType: "contact",
    entityId: contact.id,
    entityKey: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || String(contact.id),
    action: "ghl_delete_received",
    actorType: "system",
    details: { ghlContactId, source: "webhook", direction: "ghl_to_replit" },
  }).catch(() => {});
}

export async function handleOpportunityDeleteWebhook(payload: any): Promise<void> {
  const ghlOpportunityId = payload.id || payload.opportunityId;
  if (!ghlOpportunityId) {
    console.warn("[GHL Delete Webhook] OpportunityDelete: missing opportunity ID in payload");
    return;
  }
  const deal = await storage.getDealByGhlOpportunityId(ghlOpportunityId);
  if (!deal) {
    console.log(`[GHL Delete Webhook] OpportunityDelete: no local record for GHL opportunity ${ghlOpportunityId} — no-op`);
    return;
  }
  await storage.archiveDeal(deal.id, { actorType: "system" });
  console.log(`[GHL Delete Webhook] OpportunityDelete: soft-deleted local deal #${deal.id} (GHL opportunity ${ghlOpportunityId})`);
  await auditChange({
    entityType: "deal",
    entityId: deal.id,
    action: "ghl_delete_received",
    actorType: "system",
    details: { ghlOpportunityId, source: "webhook", direction: "ghl_to_replit" },
  }).catch(() => {});
}

export async function handleTaskDeleteWebhook(payload: any): Promise<void> {
  const ghlTaskId = payload.id || payload.taskId;
  if (!ghlTaskId) {
    console.warn("[GHL Delete Webhook] TaskDelete: missing task ID in payload");
    return;
  }
  const task = await storage.getTaskByGhlTaskId(ghlTaskId);
  if (!task) {
    console.log(`[GHL Delete Webhook] TaskDelete: no local record for GHL task ${ghlTaskId} — no-op`);
    return;
  }
  await storage.softDeleteTask(task.id);
  console.log(`[GHL Delete Webhook] TaskDelete: soft-deleted local task #${task.id} (GHL ${ghlTaskId})`);
  await auditChange({
    entityType: "task",
    entityId: task.id,
    entityKey: task.title,
    action: "ghl_delete_received",
    actorType: "system",
    details: { ghlTaskId, source: "webhook", direction: "ghl_to_replit" },
  }).catch(() => {});
}

export async function runDeleteDetectionTick(): Promise<{ contactsDeleted: number; dealsDeleted: number }> {
  if (process.env.GHL_SYNC_DELETE_DETECTION !== "true") return { contactsDeleted: 0, dealsDeleted: 0 };
  if (!isGhlConfigured()) return { contactsDeleted: 0, dealsDeleted: 0 };

  const config = getConfig();
  if (!config) return { contactsDeleted: 0, dealsDeleted: 0 };

  let contactsDeleted = 0;
  let dealsDeleted = 0;

  try {
    const ghlContactIds = new Set<string>();
    let nextPage: string | null = `/contacts/?locationId=${config.locationId}&limit=100`;
    let pageCount = 0;
    let contactFetchSuccess = false;
    while (nextPage && pageCount < 20) {
      pageCount++;
      const response = await fetch(`${GHL_API_BASE}${nextPage}`, {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Version": "2021-07-28",
        },
      });
      if (!response.ok) {
        console.warn(`[GHL Delete Detection] Contact page fetch failed (HTTP ${response.status}) — aborting tick to avoid false positives`);
        break;
      }
      const data: any = await response.json();
      for (const c of data.contacts || []) {
        if (c.id) ghlContactIds.add(c.id);
      }
      const meta = data.meta;
      if (meta?.nextPageUrl || meta?.nextPage) {
        const next = meta.nextPageUrl || meta.nextPage;
        nextPage = next.startsWith("http") ? next.replace(GHL_API_BASE, "") : next;
      } else {
        nextPage = null;
        contactFetchSuccess = true;
      }
    }
    if (nextPage === null) contactFetchSuccess = true;

    if (!contactFetchSuccess) {
      console.warn("[GHL Delete Detection] Contact fetch incomplete — skipping contact archival to prevent false-positive deletions");
    } else {
      const { data: localContacts } = await storage.getContacts({ limit: 1000 });
      const syncedContacts = localContacts.filter((c: any) => c.ghlContactId && !c.archivedAt);
      for (const contact of syncedContacts) {
        if (!ghlContactIds.has(contact.ghlContactId!)) {
          await storage.archiveContact(contact.id, { actorType: "system" });
          contactsDeleted++;
          console.log(`[GHL Delete Detection] Contact #${contact.id} (GHL ${contact.ghlContactId}) absent from GHL — soft-deleted`);
          await auditChange({
            entityType: "contact",
            entityId: contact.id,
            entityKey: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || String(contact.id),
            action: "ghl_delete_detected",
            actorType: "system",
            details: { ghlContactId: contact.ghlContactId, source: "sync_tick", direction: "ghl_to_replit" },
          }).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.error("[GHL Delete Detection] Error during contact delete detection:", err.message);
  }

  try {
    const ghlOpportunityIds = new Set<string>();
    let oppPage = 1;
    let oppPageCount = 0;
    let dealFetchSuccess = false;
    let dealFetchExhausted = false;
    while (oppPageCount < 20) {
      oppPageCount++;
      const response = await fetch(`${GHL_API_BASE}/opportunities/search?location_id=${config.locationId}&page=${oppPage}&limit=100`, {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Version": "2021-07-28",
        },
      });
      if (!response.ok) {
        console.warn(`[GHL Delete Detection] Opportunity page fetch failed (HTTP ${response.status}) — aborting tick to avoid false positives`);
        break;
      }
      const data: any = await response.json();
      const opps: any[] = data.opportunities || [];
      for (const opp of opps) {
        if (opp.id) ghlOpportunityIds.add(opp.id);
      }
      const meta = data.meta;
      if (meta && meta.currentPage < meta.totalPages) {
        oppPage++;
      } else {
        dealFetchExhausted = true;
        break;
      }
    }
    dealFetchSuccess = dealFetchExhausted;

    if (!dealFetchSuccess) {
      console.warn("[GHL Delete Detection] Opportunity fetch incomplete — skipping deal archival to prevent false-positive deletions");
    } else {
      const { data: localDeals } = await storage.getDeals({ limit: 1000 });
      const syncedDeals = localDeals.filter((d: any) => d.ghlOpportunityId && !d.archivedAt);
      for (const deal of syncedDeals) {
        if (!ghlOpportunityIds.has((deal as any).ghlOpportunityId)) {
          await storage.archiveDeal(deal.id, { actorType: "system" });
          dealsDeleted++;
          console.log(`[GHL Delete Detection] Deal #${deal.id} (GHL opp ${(deal as any).ghlOpportunityId}) absent from GHL — soft-deleted`);
          await auditChange({
            entityType: "deal",
            entityId: deal.id,
            action: "ghl_delete_detected",
            actorType: "system",
            details: { ghlOpportunityId: (deal as any).ghlOpportunityId, source: "sync_tick", direction: "ghl_to_replit" },
          }).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.error("[GHL Delete Detection] Error during deal delete detection:", err.message);
  }

  if (contactsDeleted > 0 || dealsDeleted > 0) {
    console.log(`[GHL Delete Detection] Tick complete: ${contactsDeleted} contacts, ${dealsDeleted} deals soft-deleted`);
  }

  return { contactsDeleted, dealsDeleted };
}
