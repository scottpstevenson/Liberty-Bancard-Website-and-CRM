import crypto from "crypto";
import { db } from "../db";
import { storage } from "../storage";
import {
  contacts,
  contactSourceEvents,
  contactProviderProjections,
  importRowDispositions,
  importExecutions,
  type InsertContact,
  type UpdateContactRequest,
  type Contact,
  type ServerInsertContact,
} from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { normalizeGhlId } from "../utils/normalize";
import { READINESS_DEPENDENT_FIELDS, enqueueReadinessRecalculation } from "./contact-readiness";
import { requestContactLeadScoring } from "./contact-lead-scoring-trigger";
import { recordContactIdentityObservations } from "./contact-identity";
import {
  CONTACT_AUTHORITY_OWNED_FIELDS,
  ContactProtectedFieldError,
  assertNoProtectedContactFields,
  stripContactAuthorityFields,
} from "./contact-field-authority";

export {
  CONTACT_AUTHORITY_OWNED_FIELDS,
  ContactProtectedFieldError,
  assertNoProtectedContactFields,
  stripContactAuthorityFields,
} from "./contact-field-authority";

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
  "partner_referral|partner_portal",
  "partner_referral|co_branded_proposal",
  "merchant_application|merchant_application",
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
  | "local_first"         // Commit canonical local state before any provider effect
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
  /** Required for import-owned mutations so a reclaimed worker fences stale owners. */
  importClaimToken?: string;
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
 * The command is deliberately local-first. Contact, source event, BT-07
 * identity observation, audit record, and GHL projection intent commit in one
 * transaction. Provider I/O is performed only by the claimed projection worker.
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
  /** CSV receipt written in the same local transaction as the contact. */
  rowDisposition?: { createdReasonCode: string; matchedReasonCode: string };
}): Promise<Contact & { _ghlSyncPending: boolean; _intakeOutcome: "created" | "matched_existing" }> {
  const { mode, provenance, actor, rowDisposition } = args;
  const mutation = stripContactAuthorityFields(args.mutation);

  assertValidSourceCombo(provenance.sourceCategory, provenance.sourceType);

  // Normalize ghlContactId in mutation before any DB write — blank strings become null.
  if ((mutation as any).ghlContactId !== undefined) {
    (mutation as any).ghlContactId = normalizeGhlId((mutation as any).ghlContactId);
  }

  const shouldProject = mode === "local_first";
  const email = String((mutation as any).email ?? "").trim().toLowerCase();
  const syntheticPlaceholder = /^no-email-[0-9a-f-]+@no-email\.libertybancard\.internal$/i.test(email);

  // Transactional contact + source event + observation + audit + projection.
  // A: insert contact with primarySourceEventId = NULL
  // B: insert contact_source_events row
  // C: UPDATE contact to set primarySourceCategory, primarySourceType, primarySourceEventId, sourceCategory
  // The DEFERRABLE INITIALLY DEFERRED FK on primarySourceEventId allows A before B.
  const { auditChange } = await import("./audit-change");

  const result = await db.transaction(async (tx) => {
    if (provenance.importExecutionId && provenance.importClaimToken) {
      const [owner] = await tx.select({ id: importExecutions.id })
        .from(importExecutions)
        .where(and(
          eq(importExecutions.id, provenance.importExecutionId),
          eq(importExecutions.claimToken, provenance.importClaimToken),
          eq(importExecutions.status, "running"),
        ))
        .limit(1);
      if (!owner) throw new Error(`IMPORT_EXECUTION_LEASE_LOST:${provenance.importExecutionId}`);
    }
    const recordLedger = async (contactId: number, disposition: "created" | "matched_noop", reasonCode: string) => {
      if (!rowDisposition || !provenance.importExecutionId || !provenance.sourceRowNumber || !provenance.rowFingerprint) return;
      await tx.insert(importRowDispositions).values({
        executionId: provenance.importExecutionId,
        sourceRowNumber: provenance.sourceRowNumber,
        rowFingerprint: provenance.rowFingerprint,
        disposition,
        reasonCode,
        contactId,
      }).onConflictDoNothing();
    };
    // A real email is the only generic automatic match. Phone and company are
    // intentionally not used here because BT-07 keeps potential identity
    // conflicts reviewable rather than merging them silently.
    let [existing] = email && !syntheticPlaceholder
      ? await tx.select().from(contacts).where(and(eq(contacts.email, email), isNull(contacts.archivedAt))).limit(1)
      : [];
    // Placeholder addresses never participate in identity matching. They can,
    // however, be resumed safely through the immutable source-event idempotency
    // key after a crash between a local contact commit and ledger disposition.
    if (!existing) {
      const prior = await tx.execute(sql`
        SELECT c.*
        FROM contact_source_events e
        JOIN contacts c ON c.id = e.contact_id
        WHERE e.event_key = ${provenance.eventKey}
        LIMIT 1
      `);
      existing = ((prior as any).rows ?? [])[0];
    }
    if (existing) {
      await tx.execute(sql`
        INSERT INTO contact_source_events
          (contact_id, event_key, source_category, source_type, source_external_id,
           import_execution_id, source_row_number, row_fingerprint, actor_type, actor_id, metadata)
        VALUES
          (${existing.id}, ${provenance.eventKey}, ${provenance.sourceCategory}, ${provenance.sourceType},
           ${provenance.sourceExternalId ?? null}, ${provenance.importExecutionId ?? null},
           ${provenance.sourceRowNumber ?? null}, ${provenance.rowFingerprint ?? null},
           ${provenance.actorType}, ${provenance.actorId ?? null},
           ${provenance.metadata ? JSON.stringify(provenance.metadata) : null}::jsonb)
        ON CONFLICT (contact_id, event_key) DO UPDATE SET last_seen_at = now()
      `);
      await recordContactIdentityObservations(tx as any, existing, "contact_writer", provenance.eventKey);
      await auditChange({
        userId: actor.userId ?? null,
        actorType: (actor.actorType as any) ?? "system",
        actorId: actor.actorId ?? null,
        action: "contact_intake_matched",
        entityType: "contact",
        entityId: existing.id,
        before: null,
        after: { sourceCategory: provenance.sourceCategory, sourceType: provenance.sourceType },
      }, tx);
      await recordLedger(existing.id, "matched_noop", rowDisposition?.matchedReasonCode ?? "EXACT_ELIGIBLE_IDENTITY_MATCH");
      if (shouldProject && !existing.ghlContactId && !syntheticPlaceholder) {
        await tx.insert(contactProviderProjections).values({
          contactId: existing.id,
          provider: "ghl",
          projectionKey: `contact:${existing.id}`,
          state: "pending",
        }).onConflictDoNothing();
      }
      return { contact: existing, outcome: "matched_existing" as const, pending: shouldProject && !existing.ghlContactId && !syntheticPlaceholder };
    }

    const contactPayload: ServerInsertContact = {
      ...(mutation as any),
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
    await recordLedger(updatedContact.id, "created", rowDisposition?.createdReasonCode ?? "LOCAL_CONTACT_CREATED");
    const pending = shouldProject && !updatedContact.ghlContactId && !syntheticPlaceholder;
    if (pending) {
      await tx.insert(contactProviderProjections).values({
        contactId: updatedContact.id,
        provider: "ghl",
        projectionKey: `contact:${updatedContact.id}`,
        state: "pending",
      }).onConflictDoNothing();
    }
    return { contact: updatedContact, outcome: "created" as const, pending };
  });
  const contact = result.contact;

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

  return { ...contact, _ghlSyncPending: result.pending, _intakeOutcome: result.outcome };
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
// Explicit local-first adapters for legacy call sites
// ---------------------------------------------------------------------------
export async function createContactLocalFirst(
  input: InsertContact,
  auditCtx?: { userId?: string | null; actorType?: string; actorId?: string | null },
  source?: Pick<ProvenanceInput, "sourceCategory" | "sourceType" | "eventKey">,
): Promise<Contact & { _ghlSyncPending: boolean; _intakeOutcome: "created" | "matched_existing" }> {
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify({
      email: (input as any).email ?? "",
      phone: (input as any).phone ?? "",
      companyName: (input as any).companyName ?? "",
      source: source?.sourceCategory ?? "manual_crm",
    }))
    .digest("hex")
    .slice(0, 32);
  const contract = source ?? {
    sourceCategory: "manual_crm",
    sourceType: "dashboard",
    eventKey: `internal-contact:${fingerprint}`,
  };
  return writeContact({
    mode: "local_first",
    mutation: input as any,
    provenance: {
      ...contract,
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
 * Generic profile updates commit locally, audit locally, and create durable
 * GHL work before any network attempt. Protected fields must go through their
 * respective authorities instead.
 */
export async function updateContactLocalFirst(
  contactId: number,
  updates: UpdateContactRequest,
  auditCtx?: { userId?: string | null; actorType?: string; actorId?: string | null },
): Promise<(Contact & { _ghlSyncFailed: boolean }) | null> {
  assertNoProtectedContactFields(updates as Record<string, unknown>);
  const safeUpdates = stripProvenanceFields(updates as Record<string, unknown>) as UpdateContactRequest;
  const changedKeys = Object.keys(safeUpdates) as Array<keyof typeof safeUpdates>;
  const hasReadinessChange = changedKeys.some(k => READINESS_DEPENDENT_FIELDS.includes(k as any));
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(safeUpdates)).digest("hex").slice(0, 32);
  const updated = await db.transaction(async (tx) => {
    const [local] = await tx.update(contacts).set({
      ...safeUpdates,
      ...(hasReadinessChange ? { lastMeaningfulContactMutationAt: new Date() } : {}),
    }).where(eq(contacts.id, contactId)).returning();
    if (!local) return null;
    const syntheticPlaceholder = /^no-email-[0-9a-f-]+@no-email\.libertybancard\.internal$/i.test(local.email);
    if (!syntheticPlaceholder) {
      await tx.insert(contactProviderProjections).values({
        contactId,
        provider: "ghl",
        projectionKey: `profile:${contactId}:${fingerprint}`,
        state: "pending",
      }).onConflictDoNothing();
    }
    const { auditChange } = await import("./audit-change");
    await auditChange({
      userId: auditCtx?.userId ?? null, actorType: (auditCtx?.actorType as any) ?? "system",
      actorId: auditCtx?.actorId ?? null, action: "contact_updated", entityType: "contact",
      entityId: contactId, before: null, after: safeUpdates as Record<string, unknown>,
    }, tx);
    return local;
  });
  if (!updated) return null;

  if (hasReadinessChange) {
    try {
      await enqueueReadinessRecalculation(contactId);
    } catch (err) {
      console.warn(`[ContactWriter] Readiness enqueue failed for contact ${contactId}: ${(err as Error).message}`);
    }
  }
  return { ...updated, _ghlSyncFailed: false };
}
