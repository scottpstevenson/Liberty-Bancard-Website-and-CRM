import { db } from "../db";
import { storage } from "../storage";
import {
  contacts,
  contactSourceEvents,
  type InsertContact,
  type UpdateContactRequest,
  type Contact,
  type ServerInsertContact,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { isGhlConfigured, upsertGhlContact, GhlIdentityConflictError, GhlInvalidContactError } from "./ghl";
import { normalizeGhlId } from "../utils/normalize";
import { syncContactToGhl } from "./ghl-sync";
import { READINESS_DEPENDENT_FIELDS, enqueueReadinessRecalculation } from "./contact-readiness";
import { requestContactLeadScoring } from "./contact-lead-scoring-trigger";
import { recordContactIdentityObservations } from "./contact-identity";

// ---------------------------------------------------------------------------
// Source category / type validation
// Reject invalid combinations before any DB write.
// ---------------------------------------------------------------------------
const VALID_SOURCE_COMBOS: ReadonlySet<string> = new Set([
  "website_form|statement_upload",
  "website_form|estimate_form",
  "website_form|callback_form",
  "website_form|equipment_order",
  "website_form|support_form",
  "website_form|partner_application",
  "website_form|merchant_application",
  "website_form|get_started_form",
  "website_form|integration_request",
  "website_form|testimonial_submit",
  "website_form|newsletter_signup",
  "manual_crm|dashboard",
  "ghl_sync|inbound",
  "csv_import|csv_contact",
  "csv_import|outscraper",
  "csv_import|apollo",
  "csv_import|apify",
  "registry_import|sunbiz_upload",
  "registry_import|sunbiz_corevt",
  "prospect_conversion|csv_prospect",
  "discovery|apollo",
  "discovery|outscraper",
  "discovery|apify",
  "discovery|serper",
  "partner_referral|partner_form",
  "legacy_unknown|historical_backfill",
]);

function assertValidSourceCombo(sourceCategory: string, sourceType: string): void {
  const key = `${sourceCategory}|${sourceType}`;
  if (!VALID_SOURCE_COMBOS.has(key)) {
    throw new Error(`[ContactWriter] Invalid sourceCategory/sourceType combination: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type WriteMode =
  | "ghl_upsert_first"    // GHL first, then local DB (public forms, manual CRM)
  | "ghl_inbound_no_echo" // Local DB only — skip GHL write to avoid echo loop
  | "local_only";         // Local DB only — no GHL (CSV imports, bulk ops)

export interface ProvenanceInput {
  sourceCategory: string;
  sourceType: string;
  eventKey: string; // non-null, server-generated
  sourceExternalId?: string;
  importExecutionId?: string; // UUID
  sourceRowNumber?: number;
  rowFingerprint?: string;
  actorType: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActorCtx {
  actorType: string;
  actorId?: string | null;
  userId?: string | null;
}

// ---------------------------------------------------------------------------
// Provenance fields that must never be accepted from client input
// ---------------------------------------------------------------------------
export const PROVENANCE_FIELDS = [
  "sourceCategory",
  "primarySourceCategory",
  "primarySourceType",
  "primarySourceEventId",
  // Vertical provenance — server-assigned; never accepted from client input
  "verticalSource",
  "verticalConfidence",
  "manualVerticalOverride",
] as const;

// Consent, suppression, tiers, and delivery reachability have a dedicated
// authority. Creation payloads are untrusted even when the caller is an
// authenticated dashboard user, so these fields must never reach either the
// provider pre-write or the contacts insert through this generic writer.
export const CONTACT_AUTHORITY_OWNED_FIELDS = [
  // Commercial class is exclusively assigned by CommercialClassificationAuthority.
  // New subjects are always quarantined as unknown through this generic writer.
  "recordClass",
  "consentEmail", "consentSms", "consentTier",
  "doNotContact", "doNotAutoContact",
  "emailStatus", "smsStatus", "phoneStatus",
  "optOutStatus", "optOutDate", "optOutChannel",
  "unsubscribeStatus", "unsubscribeAt",
  "dncReason", "dncDate", "dncSource",
  "suppressionReason", "suppressionHistory",
  "bounceStatus", "bouncedAt", "emailOptInAt", "smsOptInAt",
] as const;

export function stripContactAuthorityFields<T extends Record<string, unknown>>(obj: T): Omit<T, typeof CONTACT_AUTHORITY_OWNED_FIELDS[number]> {
  const result = { ...obj };
  for (const field of CONTACT_AUTHORITY_OWNED_FIELDS) {
    delete (result as Record<string, unknown>)[field];
  }
  return result as Omit<T, typeof CONTACT_AUTHORITY_OWNED_FIELDS[number]>;
}

/**
 * Strip provenance fields from any object (defense-in-depth for PUT/PATCH routes).
 */
export function stripProvenanceFields<T extends Record<string, unknown>>(obj: T): Omit<T, typeof PROVENANCE_FIELDS[number]> {
  const result = { ...obj };
  for (const field of PROVENANCE_FIELDS) {
    delete (result as Record<string, unknown>)[field];
  }
  return result as Omit<T, typeof PROVENANCE_FIELDS[number]>;
}

// ---------------------------------------------------------------------------
// Canonical writer — all contact creation flows go through here
// ---------------------------------------------------------------------------
/**
 * writeContact — canonical single write path for all new contact creation.
 *
 * Modes:
 *  - ghl_upsert_first: attempt GHL write before local DB (website forms, manual CRM)
 *  - ghl_inbound_no_echo: skip GHL write entirely (GHL sync inbound — avoids echo)
 *  - local_only: skip GHL entirely (CSV bulk imports)
 *
 * In all modes: contact + source event are written in a single DB transaction.
 * Sets sourceCategory AND primarySourceCategory to the same server-controlled value.
 * primarySourceCategory is immutable after first set via this writer.
 */
export async function writeContact(args: {
  mode: WriteMode;
  mutation: Omit<InsertContact, "sourceCategory" | "primarySourceCategory" | "primarySourceType" | "primarySourceEventId"> & Record<string, unknown>;
  provenance: ProvenanceInput;
  actor: ActorCtx;
}): Promise<Contact & { _ghlSyncPending: boolean }> {
  const { mode, provenance, actor } = args;
  const mutation = stripContactAuthorityFields(args.mutation);

  assertValidSourceCombo(provenance.sourceCategory, provenance.sourceType);

  // Normalize ghlContactId in mutation before any DB write — blank strings become null.
  if ((mutation as any).ghlContactId !== undefined) {
    (mutation as any).ghlContactId = normalizeGhlId((mutation as any).ghlContactId);
  }

  let ghlContactId: string | undefined;
  let ghlSyncPending = false;

  // Step 1: GHL pre-write (ghl_upsert_first mode only)
  if (mode === "ghl_upsert_first" && isGhlConfigured()) {
    try {
      ghlContactId = await upsertGhlContact({
        id: 0,
        firstName: (mutation as any).firstName,
        lastName: (mutation as any).lastName ?? "",
        email: (mutation as any).email ?? "",
        phone: (mutation as any).phone ?? "",
        ghlContactId: (mutation as any).ghlContactId ?? null,
        companyName: (mutation as any).companyName ?? undefined,
        tags: (mutation as any).tags ?? [],
        vertical: (mutation as any).vertical ?? undefined,
        monthlyVolume: (mutation as any).monthlyVolume ?? undefined,
        primaryOfferPath: (mutation as any).primaryOfferPath ?? undefined,
        currentProvider: (mutation as any).currentProvider ?? undefined,
        painPoints: (mutation as any).painPoints ?? undefined,
        interestedIn0Percent: (mutation as any).interestedIn0Percent ?? false,
        needTerminal: (mutation as any).needTerminal ?? false,
        utmSource: (mutation as any).utmSource ?? undefined,
        utmMedium: (mutation as any).utmMedium ?? undefined,
        utmCampaign: (mutation as any).utmCampaign ?? undefined,
        promoCode: (mutation as any).promoCode ?? undefined,
        consentSms: false,
        consentEmail: false,
        landingPage: (mutation as any).landingPage ?? undefined,
      });
      if (ghlContactId) {
        console.log(`[ContactWriter] Pre-created contact in GHL: ${ghlContactId}`);
      }
    } catch (ghlErr: unknown) {
      if (ghlErr instanceof GhlIdentityConflictError) {
        // Another local contact owns the GHL ID this contact would map to — safe skip.
        // Do not mark ghlSyncPending; retrying will hit the same conflict indefinitely.
        console.warn(`[ContactWriter] GHL pre-write identity conflict (skip, no retry): GHL ID ${ghlErr.ghlContactId} owned by contact ${ghlErr.owningContactId}`);
      } else if (ghlErr instanceof GhlInvalidContactError) {
        // Terminal data-quality skip — sanitized audit already written by the
        // upsert boundary. Do NOT mark ghlSyncPending: retrying an invalid
        // contact would fail identically and pollute the failed-retry queue.
        console.warn(`[ContactWriter] GHL pre-write terminal skip (${ghlErr.code}) — no retry`);
      } else {
        const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
        console.warn(`[ContactWriter] GHL pre-write failed (will retry): ${msg}`);
        ghlSyncPending = true;
      }
    }
  }

  // Step 2: Transactional contact + source event creation
  // A: insert contact with primarySourceEventId = NULL
  // B: insert contact_source_events row
  // C: UPDATE contact to set primarySourceCategory, primarySourceType, primarySourceEventId, sourceCategory
  // The DEFERRABLE INITIALLY DEFERRED FK on primarySourceEventId allows A before B.
  const { auditChange } = await import("./audit-change");

  const contact = await db.transaction(async (tx) => {
    const contactPayload: ServerInsertContact = {
      ...(mutation as any),
      ...(ghlContactId ? { ghlContactId } : {}),
      sourceCategory: provenance.sourceCategory,
      primarySourceCategory: provenance.sourceCategory,
      primarySourceType: provenance.sourceType,
      primarySourceEventId: null, // will be updated after event insert
      recordClass: "unknown",
      lastMeaningfulContactMutationAt: new Date(),
    };

    // A: Insert contact
    const [newContact] = await tx.insert(contacts).values(contactPayload).returning();
    await recordContactIdentityObservations(tx as any, newContact, "contact_writer", provenance.eventKey);

    // B: Insert source event
    const [sourceEvent] = await tx.insert(contactSourceEvents).values({
      contactId: newContact.id,
      eventKey: provenance.eventKey,
      sourceCategory: provenance.sourceCategory,
      sourceType: provenance.sourceType,
      sourceExternalId: provenance.sourceExternalId ?? null,
      importExecutionId: provenance.importExecutionId ?? null,
      sourceRowNumber: provenance.sourceRowNumber ?? null,
      rowFingerprint: provenance.rowFingerprint ?? null,
      actorType: provenance.actorType,
      actorId: provenance.actorId ?? null,
      metadata: provenance.metadata ?? null,
    }).returning();

    // C: Update contact with sourceEvent FK
    const [updatedContact] = await tx
      .update(contacts)
      .set({ primarySourceEventId: sourceEvent.id })
      .where(eq(contacts.id, newContact.id))
      .returning();

    // Audit log
    await auditChange({
      userId: actor.userId ?? null,
      actorType: (actor.actorType as any) ?? "system",
      actorId: actor.actorId ?? null,
      action: "contact_created",
      entityType: "contact",
      entityId: updatedContact.id,
      before: null,
      after: updatedContact as unknown as Record<string, unknown>,
    }, tx);

    return updatedContact;
  });

  // Step 3: Readiness hook
  try {
    await enqueueReadinessRecalculation(contact.id);
  } catch (err) {
    console.warn(`[ContactWriter] Readiness enqueue failed for new contact ${contact.id}: ${(err as Error).message}`);
  }

  // Step 3b: Per-contact lead scoring hook
  try {
    const scoringStatus = await requestContactLeadScoring(contact.id, "contact_created");
    console.debug(`[ContactWriter] Lead scoring enqueued for contact ${contact.id}: ${scoringStatus}`);
  } catch (err) {
    console.warn(`[ContactWriter] Lead scoring trigger failed for contact ${contact.id}: ${(err as Error).message}`);
  }

  // Step 4: GHL retry if pre-write failed
  if (ghlSyncPending) {
    await storage.createAuditLog({
      action: "ghl_sync_pending",
      entityType: "contact",
      entityId: contact.id,
      details: { trigger: "contact_created", reason: "GHL pre-create failed; auto-sync loop will retry" },
    });
    syncContactToGhl(contact.id).then(result => {
      if (!result.success) {
        console.error(`[ContactWriter] Retry sync failed for contact ${contact.id}: ${result.error}`);
        storage.createAuditLog({
          action: "ghl_sync_failed",
          entityType: "contact",
          entityId: contact.id,
          details: { error: result.error, trigger: "contact_created_retry" },
        }).catch(() => {});
      }
    }).catch((err: Error) => {
      console.error(`[ContactWriter] Retry exception for contact ${contact.id}:`, err.message);
    });
  }

  return { ...contact, _ghlSyncPending: ghlSyncPending };
}

/**
 * Upsert a contact_source_events row — used on GHL inbound updates
 * (existing contacts only). Does NOT touch primarySourceCategory if already set.
 * On duplicate eventKey: updates lastSeenAt only.
 */
export async function upsertContactSourceEvent(args: {
  contactId: number;
  provenance: ProvenanceInput;
}): Promise<void> {
  const { contactId, provenance } = args;
  assertValidSourceCombo(provenance.sourceCategory, provenance.sourceType);

  await db.execute(sql`
    INSERT INTO contact_source_events
      (contact_id, event_key, source_category, source_type, source_external_id,
       import_execution_id, actor_type, actor_id, metadata)
    VALUES
      (${contactId}, ${provenance.eventKey}, ${provenance.sourceCategory},
       ${provenance.sourceType}, ${provenance.sourceExternalId ?? null},
       ${provenance.importExecutionId ?? null},
       ${provenance.actorType}, ${provenance.actorId ?? null},
       ${provenance.metadata ? JSON.stringify(provenance.metadata) : null}::jsonb)
    ON CONFLICT (contact_id, event_key)
    DO UPDATE SET last_seen_at = now()
  `);
}

// ---------------------------------------------------------------------------
// Legacy backward-compat wrappers — delegate to writeContact / storage
// ---------------------------------------------------------------------------

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
 *
 * @deprecated Use writeContact() with explicit provenance instead.
 *   Kept for backward compatibility with routes that have not yet been
 *   migrated to provenance-aware calls. Provenance defaults to legacy_unknown.
 */
export async function createContactGhlFirst(
  input: InsertContact,
  auditCtx?: { userId?: string | null; actorType?: string; actorId?: string | null }
): Promise<Contact & { _ghlSyncPending: boolean }> {
  return writeContact({
    mode: "ghl_upsert_first",
    mutation: input as any,
    provenance: {
      sourceCategory: (input as any).sourceCategory || "legacy_unknown",
      sourceType: "historical_backfill",
      eventKey: `legacy:compat:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      actorType: auditCtx?.actorType ?? "system",
      actorId: auditCtx?.actorId ?? undefined,
    },
    actor: {
      actorType: auditCtx?.actorType ?? "system",
      actorId: auditCtx?.actorId ?? null,
      userId: auditCtx?.userId ?? null,
    },
  });
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
  updates: UpdateContactRequest,
  auditCtx?: { userId?: string | null; actorType?: string; actorId?: string | null }
): Promise<(Contact & { _ghlSyncFailed: boolean }) | null> {
  let ghlSyncFailed = false;

  // Strip provenance fields — updates must never overwrite intake origin
  const safeUpdates = stripProvenanceFields(updates as Record<string, unknown>) as UpdateContactRequest;

  if (isGhlConfigured()) {
    const existing = await storage.getContact(contactId);
    if (existing) {
      const merged: Contact = { ...existing, ...safeUpdates };
      try {
        const ghlId = await upsertGhlContact(merged);
        const normalizedGhlId = normalizeGhlId(ghlId);
        if (normalizedGhlId && !existing.ghlContactId) {
          (safeUpdates as any).ghlContactId = normalizedGhlId;
        }
        console.log(`[ContactWriter] Synced contact ${contactId} to GHL before local update`);
      } catch (ghlErr: unknown) {
        if (ghlErr instanceof GhlIdentityConflictError) {
          // Another local contact owns the GHL ID — safe skip; do not retry.
          console.warn(`[ContactWriter] GHL pre-update identity conflict for contact ${contactId} (skip, no retry): GHL ID ${ghlErr.ghlContactId} owned by contact ${ghlErr.owningContactId}`);
        } else if (ghlErr instanceof GhlInvalidContactError) {
          // Terminal data-quality skip — sanitized audit already written by the
          // upsert boundary. No ghl_sync_failed log (it feeds the retry queue),
          // no ghlSyncFailed flag; the local update still proceeds.
          console.warn(`[ContactWriter] GHL pre-update terminal skip (${ghlErr.code}) for contact ${contactId} — no retry`);
        } else {
          const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
          console.warn(`[ContactWriter] GHL pre-update failed for contact ${contactId}: ${msg}`);
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
  }

  const changedKeys = Object.keys(safeUpdates) as Array<keyof typeof safeUpdates>;
  const hasReadinessChange = changedKeys.some(k => READINESS_DEPENDENT_FIELDS.includes(k as any));

  const updated = await storage.updateContact(contactId, {
    ...safeUpdates,
    ...(hasReadinessChange ? { lastMeaningfulContactMutationAt: new Date() } : {}),
  }, auditCtx);
  if (!updated) return null;

  if (hasReadinessChange) {
    try {
      await enqueueReadinessRecalculation(contactId);
    } catch (err) {
      console.warn(`[ContactWriter] Readiness enqueue failed for contact ${contactId}: ${(err as Error).message}`);
    }
  }

  if (ghlSyncFailed) {
    syncContactToGhl(contactId).then(result => {
      if (!result.success) {
        console.error(`[ContactWriter] Retry sync failed for contact ${contactId}: ${result.error}`);
      } else {
        console.log(`[ContactWriter] Retry sync succeeded for contact ${contactId}`);
      }
    }).catch((err: Error) => {
      console.error(`[ContactWriter] Retry exception for contact ${contactId}:`, err.message);
    });
  }

  return { ...updated, _ghlSyncFailed: ghlSyncFailed };
}
