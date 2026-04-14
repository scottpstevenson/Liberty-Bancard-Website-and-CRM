import { storage } from "../storage";
import type { InsertContact, UpdateContactRequest, Contact } from "@shared/schema";
import { isGhlConfigured, upsertGhlContact } from "./ghl";
import { syncContactToGhl } from "./ghl-sync";

/**
 * GHL-first contact create.
 *
 * Attempts to write to GHL before the local DB. If GHL succeeds, the returned
 * ghlContactId is embedded in the local record. If GHL fails, the contact is
 * saved locally with a ghl_sync_pending audit entry; the 45-second auto-sync
 * loop and audit-log-based retry queue will ensure eventual consistency.
 *
 * Returns the created contact plus a `_ghlSyncPending` flag indicating whether
 * GHL sync succeeded at creation time.
 */
export async function createContactGhlFirst(
  input: InsertContact
): Promise<Contact & { _ghlSyncPending: boolean }> {
  let ghlContactId: string | undefined;
  let ghlSyncPending = false;

  if (isGhlConfigured()) {
    try {
      ghlContactId = await upsertGhlContact({
        id: 0,
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        ghlContactId: input.ghlContactId ?? null,
        companyName: input.companyName ?? undefined,
        tags: input.tags ?? [],
        vertical: input.vertical ?? undefined,
        monthlyVolume: input.monthlyVolume ?? undefined,
        primaryOfferPath: input.primaryOfferPath ?? undefined,
        currentProvider: input.currentProvider ?? undefined,
        painPoints: input.painPoints ?? undefined,
        interestedIn0Percent: input.interestedIn0Percent ?? false,
        needTerminal: input.needTerminal ?? false,
        utmSource: input.utmSource ?? undefined,
        utmMedium: input.utmMedium ?? undefined,
        utmCampaign: input.utmCampaign ?? undefined,
        promoCode: input.promoCode ?? undefined,
        consentSms: input.consentSms ?? false,
        consentEmail: input.consentEmail ?? false,
        landingPage: input.landingPage ?? undefined,
      });
      if (ghlContactId) {
        console.log(`[GHL Write-First] Pre-created contact in GHL: ${ghlContactId}`);
      }
    } catch (ghlErr: unknown) {
      const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
      console.warn(`[GHL Write-First] Failed to pre-create contact in GHL (will retry): ${msg}`);
      ghlSyncPending = true;
    }
  }

  const contact = await storage.createContact({
    ...input,
    ...(ghlContactId ? { ghlContactId } : {}),
  });

  if (ghlSyncPending) {
    await storage.createAuditLog({
      action: "ghl_sync_pending",
      entityType: "contact",
      entityId: contact.id,
      details: { trigger: "contact_created", reason: "GHL pre-create failed; auto-sync loop will retry" },
    });
    // Immediate async retry — auto-sync loop also picks this up every 45s
    syncContactToGhl(contact.id).then(result => {
      if (!result.success) {
        console.error(`[GHL Write-First] Retry sync failed for contact ${contact.id}: ${result.error}`);
        storage.createAuditLog({
          action: "ghl_sync_failed",
          entityType: "contact",
          entityId: contact.id,
          details: { error: result.error, trigger: "contact_created_retry" },
        }).catch(() => {});
      }
    }).catch((err: Error) => {
      console.error(`[GHL Write-First] Retry exception for contact ${contact.id}:`, err.message);
    });
  }

  return { ...contact, _ghlSyncPending: ghlSyncPending };
}

/**
 * GHL-first contact update.
 *
 * Attempts GHL upsert before local write. If GHL fails, local write still
 * succeeds (availability preserved) and an async retry is immediately fired.
 * The auto-sync loop's audit-log-based retry pass catches any remaining failures.
 *
 * Returns the updated contact plus `_ghlSyncFailed` flag.
 */
export async function updateContactGhlFirst(
  contactId: number,
  updates: UpdateContactRequest
): Promise<(Contact & { _ghlSyncFailed: boolean }) | null> {
  let ghlSyncFailed = false;

  if (isGhlConfigured()) {
    const existing = await storage.getContact(contactId);
    if (existing) {
      const merged: Contact = { ...existing, ...updates };
      try {
        const ghlId = await upsertGhlContact(merged);
        if (ghlId && !existing.ghlContactId) {
          updates = { ...updates, ghlContactId: ghlId };
        }
        console.log(`[GHL Write-First] Synced contact ${contactId} to GHL before local update`);
      } catch (ghlErr: unknown) {
        const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
        console.warn(`[GHL Write-First] GHL pre-update failed for contact ${contactId}: ${msg}`);
        ghlSyncFailed = true;
        await storage.createAuditLog({
          action: "ghl_sync_failed",
          entityType: "contact",
          entityId: contactId,
          details: { error: msg, trigger: "contact_updated" },
        });
      }
    }
  }

  const updated = await storage.updateContact(contactId, updates);
  if (!updated) return null;

  if (ghlSyncFailed) {
    syncContactToGhl(contactId).then(result => {
      if (!result.success) {
        console.error(`[GHL Write-First] Retry sync failed for contact ${contactId}: ${result.error}`);
      } else {
        console.log(`[GHL Write-First] Retry sync succeeded for contact ${contactId}`);
      }
    }).catch((err: Error) => {
      console.error(`[GHL Write-First] Retry exception for contact ${contactId}:`, err.message);
    });
  }

  return { ...updated, _ghlSyncFailed: ghlSyncFailed };
}
