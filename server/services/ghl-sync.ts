import { storage } from "../storage";
import { db } from "../db";
import type { Contact, Deal, Company, Task, Ticket, Note, UpdateContactRequest } from "@shared/schema";
import { ghlSyncStatus, GHL_PIPELINE_STAGE_MAP, GHL_PIPELINE_STAGE_REVERSE, ACTIVE_DEAL_STAGES } from "@shared/schema";
import { upsertGhlContact, isGhlConfigured, sendGhlEmail, GhlIdentityConflictError } from "./ghl";
import { normalizeGhlId } from "../utils/normalize";
import { getEmailSignatureHtml } from "./email-signatures";
import { auditChange } from "./audit-change";
import { writeContact, upsertContactSourceEvent, PROVENANCE_FIELDS } from "./contact-writer";
import { enqueuePromotionalEnrollment } from "./promotional-enrollment-eligibility";
import { eq, sql } from "drizzle-orm";

const CONFLICT_FIELDS: Array<{ ghlKey: string; contactKey: keyof Contact }> = [
  { ghlKey: "firstName", contactKey: "firstName" },
  { ghlKey: "lastName", contactKey: "lastName" },
  { ghlKey: "email", contactKey: "email" },
  { ghlKey: "phone", contactKey: "phone" },
  { ghlKey: "companyName", contactKey: "companyName" },
];

// Wave 7: Replit is the system-of-record for these compliance/permission fields.
// GHL webhooks and inbound sync must NEVER overwrite them, even if GHL sends a value.
// KL-4: Provenance fields are also Replit-owned; GHL must never overwrite source attribution.
//
// Lazy-initialized to avoid the circular-import TDZ: contact-writer imports
// syncContactToGhl from this file, so we cannot spread PROVENANCE_FIELDS at
// module-init time. The Set is built on first use (all modules are fully
// initialized by then).
let _replitOwnedFields: Set<string> | null = null;
function getReplitOwnedFields(): Set<string> {
  if (!_replitOwnedFields) {
    _replitOwnedFields = new Set<string>([
      "doNotContact",
      "doNotAutoContact",
      "consentTier",
      "lifecycleStage",
      "consentEmail",
      "consentSms",
      "smsStatus",
      "emailStatus",
      "phoneType",
      ...PROVENANCE_FIELDS,
    ]);
  }
  return _replitOwnedFields;
}

/**
 * Structured error logging for GHL sync failures.
 * Writes to ghlActivityLog with channel="sync_error" so the dashboard
 * can surface field-write errors, 422s, and circuit-breaker trips.
 */
export async function logGhlSyncError(opts: {
  contactId: number | null;
  operation: string;
  httpStatus?: number | null;
  errorMessage: string;
  ghlContactId?: string | null;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    // Always write to ghlActivityLog — contactId may be null for ghlFetch-level errors
    await storage.createGhlActivityLog({
      contactId: opts.contactId ?? (undefined as any),
      dealId: null,
      direction: "outbound",
      channel: "sync_error",
      templateId: null,
      subject: null,
      body: null,
      status: "error",
      ghlMessageId: opts.ghlContactId || null,
      metadata: {
        operation: opts.operation,
        httpStatus: opts.httpStatus ?? null,
        errorBody: opts.errorMessage.slice(0, 500),
        ...(opts.metadata || {}),
      },
    });
    await storage.createAuditLog({
      action: "ghl_sync_error",
      entityType: "contact",
      entityId: opts.contactId ?? undefined,
      details: {
        operation: opts.operation,
        httpStatus: opts.httpStatus ?? null,
        error: opts.errorMessage.slice(0, 300),
        ghlContactId: opts.ghlContactId ?? null,
        ...(opts.metadata || {}),
      },
    });
  } catch {
    // Non-fatal logging helper — never let it propagate
  }
}

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
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
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
    const errMsg = `GHL API error ${response.status}: ${errorBody}`;
    // Centralized structured error capture — contactId is null at this level
    logGhlSyncError({
      contactId: null,
      operation: `ghlFetch:${options.method ?? "GET"}:${path.split("?")[0]}`,
      httpStatus: response.status,
      errorMessage: errMsg,
      metadata: { url: path.split("?")[0] },
    }).catch(() => {});
    throw new Error(errMsg);
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

    let rawGhlId: string;
    try {
      rawGhlId = await upsertGhlContact(contact);
    } catch (upsertErr: any) {
      if (upsertErr instanceof GhlIdentityConflictError) {
        // Ownership conflict — another local contact already holds this GHL ID.
        // This is a safe data-skip, not a GHL API failure; do not log as error.
        console.warn(
          `[GHL Sync] Contact #${contactId} identity conflict — GHL ID ${upsertErr.ghlContactId} owned by contact ${upsertErr.owningContactId} — skipping (not a failure)`
        );
        // Record to syncConflicts queue for staff review. Dedup: skip if a pending
        // conflict already exists for this contactId + ghl_contact_id field.
        try {
          const pendingConflicts = await storage.getSyncConflicts("pending");
          const alreadyQueued = pendingConflicts.some(
            c => c.contactId === contactId && c.fieldName === "ghl_contact_id"
          );
          if (!alreadyQueued) {
            await storage.createSyncConflict({
              contactId,
              fieldName: "ghl_contact_id",
              internalValue: upsertErr.ghlContactId,
              ghlValue: String(upsertErr.owningContactId),
              resolution: "pending",
            });
          }
        } catch (conflictLogErr: any) {
          console.warn(`[GHL Sync] Could not record identity conflict to queue: ${conflictLogErr.message}`);
        }
        return { success: false, error: "ghl_identity_conflict" };
      }
      throw upsertErr;
    }
    const ghlId = normalizeGhlId(rawGhlId) ?? undefined;
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
    const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || String(contactId);
    await auditChange({
      entityType: "ghl_sync",
      entityId: contactId,
      entityKey: displayName,
      action: "ghl_sync_success",
      actorType: "system",
      details: { ghlContactId: ghlId },
    }).catch(() => {});
    return { success: true, ghlContactId: ghlId };
  } catch (err: any) {
    console.error(`[GHL Sync] Failed to sync contact ${contactId}:`, err.message);
    await updateSyncStatusRecord("contacts", "outbound", 0, 1, err.message);
    await auditChange({
      entityType: "ghl_sync",
      entityId: contactId,
      action: "ghl_sync_failed",
      actorType: "system",
      details: { error: err.message },
    }).catch(() => {});
    // Wire logGhlSyncError for structured activity-log coverage
    const httpStatus = err.message?.match(/GHL API error (\d+)/)?.[1];
    await logGhlSyncError({
      contactId,
      operation: "syncContactToGhl",
      httpStatus: httpStatus ? Number(httpStatus) : null,
      errorMessage: err.message,
      metadata: { stage: "contact_upsert" },
    }).catch(() => {});
    return { success: false, error: err.message };
  }
}

export async function syncContactFromGhl(ghlContact: any): Promise<{ contactId: number; created: boolean } | null> {
  try {
    // Branch A: indexed lookup by GHL contact ID.
    // Uses contacts_ghl_contact_id_idx (shared/schema.ts:118) — never falls back to full scan.
    const existingByGhlId = ghlContact.id
      ? await storage.getContactByGhlContactId(ghlContact.id)
      : undefined;

    // Branch B: indexed lookup by normalized email.
    // Uses contacts_email_unique_idx (shared/schema.ts:116) — partial unique index WHERE archived_at IS NULL.
    const normalizedEmail = ghlContact.email ? ghlContact.email.trim().toLowerCase() : "";
    const existingByEmail = normalizedEmail
      ? await storage.getContactByEmail(normalizedEmail)
      : undefined;

    // Identity-conflict guard: both branches matched but to *different* local contacts.
    // Writing to either row would silently merge two distinct merchants — stop and log.
    if (existingByGhlId && existingByEmail && existingByGhlId.id !== existingByEmail.id) {
      await storage.createAuditLog({
        action: "ghl_sync_identity_conflict",
        entityType: "contact",
        entityId: existingByGhlId.id,
        details: {
          ghlContactId: ghlContact.id,
          byGhlIdContactId: existingByGhlId.id,
          byEmailContactId: existingByEmail.id,
          email: normalizedEmail,
        },
      });
      console.warn(`[GHL Sync] Identity conflict: GHL ID ${ghlContact.id} maps to contact #${existingByGhlId.id} but email ${normalizedEmail} maps to contact #${existingByEmail.id} — sync aborted`);
      return null;
    }

    // Resolve the winning row: GHL ID takes precedence over email match.
    const existingContact = existingByGhlId ?? existingByEmail;

    if (existingContact) {
      // ghlContactId ownership enforcement on email-match path (Step 5).
      // If we landed here via email only, check whether this row already belongs to a different GHL contact.
      if (!existingByGhlId && existingByEmail) {
        if (
          existingByEmail.ghlContactId !== null &&
          existingByEmail.ghlContactId !== undefined &&
          existingByEmail.ghlContactId !== ghlContact.id
        ) {
          await storage.createAuditLog({
            action: "ghl_sync_ghlid_ownership_conflict",
            entityType: "contact",
            entityId: existingByEmail.id,
            details: {
              incomingGhlContactId: ghlContact.id,
              existingGhlContactId: existingByEmail.ghlContactId,
              email: normalizedEmail,
            },
          });
          console.warn(`[GHL Sync] ghlContactId ownership conflict for contact #${existingByEmail.id}: already owned by ${existingByEmail.ghlContactId}, incoming ${ghlContact.id} — sync aborted`);
          return null;
        }
      }

      const { conflictFields, cleanPayload } = await detectAndWriteConflicts(existingContact, ghlContact);

      // Wave 7: Strip Replit-owned compliance/permission fields from any GHL-sourced payload.
      // Replit is the system-of-record; GHL must never overwrite these — even if GHL sends them.
      for (const field of getReplitOwnedFields()) {
        delete (cleanPayload as any)[field];
      }

      // Tags are always applied (no conflict model for array fields)
      if (Array.isArray(ghlContact.tags)) {
        cleanPayload.tags = ghlContact.tags;
      }

      // On email-match path: attach the incoming ghlContactId when the row has none.
      // If it already matches, this is a no-op; if it differed, we returned null above.
      if (!existingByGhlId && existingByEmail) {
        (cleanPayload as any).ghlContactId = normalizeGhlId(ghlContact.id);
      }

      if (conflictFields.length === 0) {
        // Fully clean sync — apply field changes and advance the baseline.
        // syncUpdateContact does NOT bump updatedAt, so updatedAt stays as the last
        // genuine user-edit timestamp and future conflict detection stays accurate.
        cleanPayload.lastSyncedAt = new Date();
        await storage.syncUpdateContact(existingContact.id, cleanPayload);
      } else if (Object.keys(cleanPayload).length > 0) {
        // Some fields were clean, some conflicted — apply only the clean ones, preserve baseline.
        await storage.syncUpdateContact(existingContact.id, cleanPayload);
        console.log(`[GHL Sync] ${conflictFields.length} conflict(s) logged for contact #${existingContact.id}: ${conflictFields.join(", ")}`);
      } else {
        // All changed fields were conflicted — don't touch anything; preserve lastSyncedAt.
        console.log(`[GHL Sync] ${conflictFields.length} conflict(s) logged for contact #${existingContact.id}: ${conflictFields.join(", ")} — no DB write`);
      }

      // Record/refresh a source event so provenance stays current on every inbound sync tick.
      // eventKey is stable per GHL contact ID — upsertContactSourceEvent is idempotent.
      upsertContactSourceEvent({
        contactId: existingContact.id,
        provenance: {
          eventKey: `ghl:${ghlContact.id}:inbound`,
          sourceCategory: "ghl_sync",
          sourceType: "inbound",
          sourceExternalId: ghlContact.id,
          actorType: "system",
        },
      }).catch((e: any) => console.warn(`[GHL Sync] source event upsert failed for contact #${existingContact.id}:`, e?.message || e));

      await updateSyncStatusRecord("contacts", "inbound", 1, 0);
      return { contactId: existingContact.id, created: false };
    }

    // No existing row found — create a new contact.
    // Use ghl_inbound_no_echo mode to avoid echoing inbound data back to GHL.
    // Wrap in try/catch to recover from 23505 unique-violation races (concurrent create).
    const stableEventKey = `ghl:${ghlContact.id}:created`;
    try {
      const contact = await writeContact({
        mode: "ghl_inbound_no_echo",
        mutation: {
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
        },
        provenance: {
          sourceCategory: "ghl_sync",
          sourceType: "inbound",
          eventKey: stableEventKey,
          sourceExternalId: ghlContact.id,
          actorType: "system",
        },
        actor: { actorType: "system" },
      });

      await updateSyncStatusRecord("contacts", "inbound", 1, 0);
      try {
        await enqueuePromotionalEnrollment({
          contactId: contact.id,
          triggerType: "contact_created",
          sourceEventId: stableEventKey,
        });
      } catch (enrollErr: any) {
        console.warn(`[GHL Sync] enqueuePromotionalEnrollment failed for contact ${contact.id}:`, enrollErr?.message);
      }
      return { contactId: contact.id, created: true };
    } catch (createErr: any) {
      // 23505 = Postgres unique_violation — a concurrent create beat us to it.
      // IMPORTANT: Only recover when the violated constraint is contacts_ghl_contact_id_unique.
      // Any other 23505 (e.g. email uniqueness) must be rethrown — swallowing those would
      // silently corrupt unrelated identity constraints.
      const isUniqueViolation = createErr?.code === "23505" || createErr?.message?.includes("23505");
      if (isUniqueViolation) {
        const violatedConstraint: string = createErr?.constraint ?? createErr?.detail ?? "";
        const isGhlIdConstraint =
          violatedConstraint.includes("contacts_ghl_contact_id_unique") ||
          (createErr?.detail ?? "").includes("ghl_contact_id");

        if (isGhlIdConstraint) {
          console.warn(`[GHL Sync] 23505 on contacts_ghl_contact_id_unique for GHL ID ${ghlContact.id} — re-querying`);
          const recovered = ghlContact.id
            ? await storage.getContactByGhlContactId(ghlContact.id)
            : undefined;

          if (recovered) {
            // Verify identity before stamping lastSyncedAt — guard against phantom race recovery.
            await storage.syncUpdateContact(recovered.id, { lastSyncedAt: new Date() });
            await updateSyncStatusRecord("contacts", "inbound", 1, 0);
            return { contactId: recovered.id, created: false };
          }
          // Re-query returned nothing — do not create a third row; log and bail.
          console.error(`[GHL Sync] 23505 recovery: re-query found no contact for GHL ID ${ghlContact.id} — aborting`);
          await storage.createAuditLog({
            action: "ghl_sync_23505_unrecoverable",
            entityType: "contact",
            details: { ghlContactId: ghlContact.id, email: normalizedEmail },
          });
          return null;
        }
        // Non-GHL-ID unique violation (e.g. email index) — rethrow so the outer catch logs it.
      }
      throw createErr;
    }
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

// DB-backed stage ID overrides (set via admin UI → system_settings).
// Merged with env-var overrides in getGhlStageIdOverrides(); env var takes precedence.
let cachedDbStageMapOverrides: Record<string, string> = {};
async function loadDbStageMapOverrides(): Promise<void> {
  try {
    const raw = await storage.getSystemSetting("ghl_stage_id_map");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      cachedDbStageMapOverrides = raw as Record<string, string>;
    }
  } catch {
    // non-fatal: fall back to empty
  }
}

// ── Auto-alignment helpers ────────────────────────────────────────────────────

/** Normalize a stage name for fuzzy comparison: lowercase, strip non-alphanumeric, collapse spaces. */
function normalizeStage(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Score how well two strings overlap (0–1). Uses word-overlap Jaccard similarity. */
function stageSimilarity(a: string, b: string): number {
  const na = normalizeStage(a);
  const nb = normalizeStage(b);
  if (na === nb) return 1;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  if (union === 0) return 0;
  const jaccard = intersection / union;
  // Bonus: one is a substring of the other
  const subBonus = na.includes(nb) || nb.includes(na) ? 0.15 : 0;
  return Math.min(1, jaccard + subBonus);
}

/** Auto-align local stage names to live GHL stage UUIDs by best-match scoring.
 *  Returns an array of alignment results for each local stage. */
export function autoAlignStages(
  localStages: string[],
  ghlStages: Array<{ name: string; id: string }>,
): Array<{ localName: string; ghlId: string | null; ghlName: string | null; score: number; method: "exact" | "fuzzy" | "none" }> {
  return localStages.map(local => {
    // 1. Exact match (case-insensitive, trimmed)
    const exact = ghlStages.find(s => s.name.toLowerCase().trim() === local.toLowerCase().trim());
    if (exact) return { localName: local, ghlId: exact.id, ghlName: exact.name, score: 1, method: "exact" as const };

    // 2. Normalized exact match
    const normLocal = normalizeStage(local);
    const normExact = ghlStages.find(s => normalizeStage(s.name) === normLocal);
    if (normExact) return { localName: local, ghlId: normExact.id, ghlName: normExact.name, score: 0.95, method: "exact" as const };

    // 3. Best fuzzy match above threshold
    let best = { score: 0, stage: null as { name: string; id: string } | null };
    for (const gs of ghlStages) {
      const score = stageSimilarity(local, gs.name);
      if (score > best.score) best = { score, stage: gs };
    }
    const THRESHOLD = 0.5;
    if (best.stage && best.score >= THRESHOLD) {
      return { localName: local, ghlId: best.stage.id, ghlName: best.stage.name, score: best.score, method: "fuzzy" as const };
    }

    return { localName: local, ghlId: null, ghlName: null, score: 0, method: "none" as const };
  });
}

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
      const stages: Array<{ name: string; id: string }> = (chosenPipeline.stages || []).filter(
        (s: any) => s.name && s.id,
      );
      // Store raw GHL stages by their own name first
      for (const stage of stages) {
        cachedStageIdMap[stage.name] = stage.id;
      }
      // Auto-align: map every local stage name → best-match GHL UUID
      const localNames = Object.keys(GHL_PIPELINE_STAGE_MAP);
      const aligned = autoAlignStages(localNames, stages);
      let matchCount = 0;
      for (const r of aligned) {
        if (r.ghlId) {
          cachedStageIdMap[r.localName] = r.ghlId;
          matchCount++;
        }
      }
      cachedPipelineAt = Date.now();
      console.log(
        `[GHL Sync] Using pipeline: "${chosenPipeline.name}" (${chosenPipeline.id}) — ` +
        `${stages.length} GHL stages, ${matchCount}/${localNames.length} local stages auto-aligned`,
      );
      // Warm DB overrides in background so mapDealStageToGhl has them available
      loadDbStageMapOverrides().catch(() => {});
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
  // Start with DB-backed overrides (lower priority)
  const overrides: Record<string, string> = { ...cachedDbStageMapOverrides };

  // Env var overrides take precedence over DB setting
  const raw = process.env.GHL_STAGE_ID_MAP;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(overrides, parsed);
      } else {
        console.warn(`[GHL Sync] GHL_STAGE_ID_MAP parsed but is not a plain object (got ${Array.isArray(parsed) ? "array" : typeof parsed}): ${raw}`);
      }
    } catch {
      console.warn(`[GHL Sync] GHL_STAGE_ID_MAP failed to parse as JSON — env override disabled. Bad value: ${raw}`);
    }
  }
  return overrides;
}

/** Returns the live GHL pipeline stages and auto-alignment status for the admin UI. */
export async function getGhlPipelineStages(): Promise<{
  pipelineId: string | null;
  /** Raw GHL stages returned from the API */
  ghlStages: Array<{ name: string; id: string }>;
  /** Auto-alignment result for each local stage */
  alignment: Array<{
    localName: string;
    ghlId: string | null;
    ghlName: string | null;
    score: number;
    method: "exact" | "fuzzy" | "none";
    /** If a DB or env override is active, this overrides the auto-match */
    override?: string;
  }>;
  dbOverrides: Record<string, string>;
  envOverrides: Record<string, string>;
}> {
  // Warm the cache
  try {
    await ensurePipeline();
  } catch {
    // non-fatal if GHL is unconfigured
  }
  await loadDbStageMapOverrides();

  const envRaw = process.env.GHL_STAGE_ID_MAP;
  let envOverrides: Record<string, string> = {};
  if (envRaw) {
    try { envOverrides = JSON.parse(envRaw); } catch { /* ignore */ }
  }

  // Reconstruct raw GHL stages (entries where both key and value look non-local)
  // We stored GHL stage names → IDs AND local stage names → IDs in cachedStageIdMap.
  // Pull only entries whose key matches a known local stage to build the raw GHL list separately.
  const localNameSet = new Set(Object.keys(GHL_PIPELINE_STAGE_MAP));
  const ghlStages = Object.entries(cachedStageIdMap)
    .filter(([name]) => !localNameSet.has(name))
    .map(([name, id]) => ({ name, id }));

  // Compute fresh alignment from whatever GHL stages we have
  const localNames = Object.keys(GHL_PIPELINE_STAGE_MAP);
  const baseAlignment = autoAlignStages(localNames, ghlStages.length > 0 ? ghlStages : []);

  // Annotate with overrides
  const mergedOverrides = { ...cachedDbStageMapOverrides, ...envOverrides };
  const alignment = baseAlignment.map(r => ({
    ...r,
    override: mergedOverrides[r.localName] || undefined,
  }));

  return {
    pipelineId: cachedPipelineId,
    ghlStages,
    alignment,
    dbOverrides: { ...cachedDbStageMapOverrides },
    envOverrides,
  };
}

/**
 * Push any local stage names that don't yet exist in GHL into the pipeline,
 * then re-run auto-alignment so all stages get a real UUID.
 * Returns how many stages were created and the updated alignment.
 */
export async function syncLocalStagesToGhl(): Promise<{
  created: number;
  skipped: number;
  failed: number;
  alignment: Awaited<ReturnType<typeof getGhlPipelineStages>>["alignment"];
}> {
  const pipelineId = await ensurePipeline();
  if (!pipelineId || pipelineId === "default") {
    throw new Error("GHL pipeline not available — check GHL configuration");
  }

  const localNames = Object.keys(GHL_PIPELINE_STAGE_MAP);
  const localNameSet = new Set(localNames);

  // Get current raw GHL stages from cache (entries not in localNameSet)
  const existingGhlStages = Object.entries(cachedStageIdMap)
    .filter(([name]) => !localNameSet.has(name))
    .map(([name, id]) => ({ name, id }));

  // Find local stages that are unmatched (no GHL UUID via auto-align or override)
  const currentAlignment = autoAlignStages(localNames, existingGhlStages);
  const mergedOverrides: Record<string, string> = { ...cachedDbStageMapOverrides };
  const envRaw = process.env.GHL_STAGE_ID_MAP;
  if (envRaw) { try { Object.assign(mergedOverrides, JSON.parse(envRaw)); } catch { /**/ } }

  const unmatched = currentAlignment.filter(r => !r.ghlId && !mergedOverrides[r.localName]);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < unmatched.length; i++) {
    const localStage = unmatched[i].localName;
    try {
      // Try to add the stage to the existing pipeline
      const result = await ghlFetch(`/opportunities/pipelines/${pipelineId}/stages`, {
        method: "POST",
        body: JSON.stringify({
          name: localStage,
          position: existingGhlStages.length + i,
        }),
      });
      const newId = result?.stage?.id || result?.id;
      if (newId) {
        cachedStageIdMap[localStage] = newId;
        // Also store under the GHL name (same in this case)
        cachedStageIdMap[localStage] = newId;
        created++;
        console.log(`[GHL Sync] Created pipeline stage "${localStage}" → ${newId}`);
      } else {
        console.warn(`[GHL Sync] Stage creation for "${localStage}" returned no ID:`, result);
        failed++;
      }
    } catch (err: any) {
      console.warn(`[GHL Sync] Could not create stage "${localStage}":`, err.message);
      failed++;
    }
  }

  skipped = localNames.length - unmatched.length;

  // Invalidate pipeline cache so next ensurePipeline re-fetches fresh stage list
  cachedPipelineAt = null;
  // Re-run alignment with updated map
  const { alignment } = await getGhlPipelineStages();
  return { created, skipped, failed, alignment };
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

    // POST (create) requires locationId; PUT (update) rejects it — keep separate.
    const createPayload: Record<string, any> = {
      pipelineId,
      locationId: config.locationId,
      name: deal.contactId ? `${contact?.companyName || contact?.firstName} - Deal #${deal.id}` : `Deal #${deal.id}`,
      status: stageMapping.status,
      contactId: ghlContactId,
      monetaryValue: deal.totalVolume ? Number(deal.totalVolume) : undefined,
      pipelineStageId: stageMapping.pipelineStageId,
    };
    const updatePayload: Record<string, any> = {
      pipelineId,
      name: createPayload.name,
      status: createPayload.status,
      contactId: ghlContactId,
      monetaryValue: createPayload.monetaryValue,
      pipelineStageId: createPayload.pipelineStageId,
    };

    const existingGhlOpportunityId = deal.ghlOpportunityId;

    let ghlOpportunityId: string | undefined;
    if (existingGhlOpportunityId) {
      await ghlFetch(`/opportunities/${existingGhlOpportunityId}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload),
      });
      ghlOpportunityId = existingGhlOpportunityId;
    } else {
      try {
        const result = await ghlFetch("/opportunities/", {
          method: "POST",
          body: JSON.stringify(createPayload),
        });
        ghlOpportunityId = result?.opportunity?.id || result?.id;
        if (ghlOpportunityId) {
          await db.execute(sql`UPDATE deals SET ghl_opportunity_id = ${ghlOpportunityId}, updated_at = NOW() WHERE id = ${dealId}`);
        }
      } catch (postErr: any) {
        // Auto-recover duplicate opportunity — GHL returns 400 with meta.existingId.
        // Same pattern as the duplicate-contact 400 recovery in upsertGhlContact.
        const dupMatch = postErr.message?.match(/"existingId":"([^"]+)"/);
        if (dupMatch) {
          const recoveredId = dupMatch[1];
          console.log(`[GHL Sync] Recovering duplicate deal ${dealId} → existing GHL opportunity ${recoveredId}`);
          await db.execute(sql`UPDATE deals SET ghl_opportunity_id = ${recoveredId}, updated_at = NOW() WHERE id = ${dealId}`);
          await ghlFetch(`/opportunities/${recoveredId}`, {
            method: "PUT",
            body: JSON.stringify(updatePayload),
          });
          ghlOpportunityId = recoveredId;
        } else {
          throw postErr;
        }
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

export async function syncCompanyToGhl(companyId: number): Promise<{ success: boolean; skip?: boolean; error?: string }> {
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

    await ghlFetch("/companies", {
      method: "POST",
      body: JSON.stringify(companyPayload),
    });

    await updateSyncStatusRecord("companies", "outbound", 1, 0);
    console.log(`[GHL Sync] Company ${companyId} (${company.legalName}) synced to GHL`);
    return { success: true };
  } catch (err: any) {
    // 404 = GHL companies API not available at this integration tier — skip
    // silently rather than counting toward the circuit-breaker threshold.
    const is404 = err.message?.includes("404");
    if (is404) {
      console.warn(`[GHL Sync] Company ${companyId} sync skipped (GHL companies API unavailable)`);
      return { success: false, skip: true, error: err.message };
    }
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

    const taskData: any = await ghlFetch(`/contacts/${ghlContactId}/tasks`, {
      method: "POST",
      body: JSON.stringify(taskPayload),
    });

    try {
      const returnedGhlTaskId = taskData?.task?.id || taskData?.id;
      if (returnedGhlTaskId) {
        await storage.updateTask(taskId, { ghlTaskId: returnedGhlTaskId } as any);
      }
    } catch {
      // non-critical — task was synced, ID capture failed
    }

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
      // When GHL marks a task as not-completed, map to an active status so
      // normalizeTaskCompletionState can clear completedAt (reopening a task).
      const newStatus = ghlTask.completed ? "completed" : "pending";
      const { normalizeTaskCompletionState } = await import("./task-normalization");
      const normalized = normalizeTaskCompletionState(
        { status: newStatus, description: ghlTask.body || existingTask.description },
        existingTask,
      );
      await storage.updateTask(existingTask.id, normalized);
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
      ...(ghlTask.completed ? { completedAt: new Date() } : {}),
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
    await auditChange({
      entityType: "ghl_sync",
      entityId: contactId,
      action: "ghl_tag_sync_failed",
      actorType: "system",
      details: { error: err.message },
    }).catch(() => {});
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
    await auditChange({
      entityType: "ghl_sync",
      action: "ghl_tag_inbound_failed",
      actorType: "system",
      details: { error: err.message },
    }).catch(() => {});
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

  // ── Wave 7: Expanded Sync Authority metrics ────────────────────────────────
  const circuitStatus = getGhlCircuitStatus();

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Audit log based metrics
  let failedSyncsLast24h = 0;
  let optOutEventsLast24h = 0;
  let lastCircuitTripAt: string | null = null;
  try {
    const auditLogs = await storage.getAuditLogs();
    const recent = auditLogs.filter(l => l.createdAt && new Date(l.createdAt) >= twentyFourHoursAgo);
    failedSyncsLast24h = recent.filter(l => l.action === "ghl_sync_error" || l.action === "ghl_sync_failed").length;
    optOutEventsLast24h = recent.filter(l =>
      l.action === "contact_unsubscribed" ||
      l.action === "contact_dnd_set"
    ).length;
    const circuitTrip = auditLogs.find(l => l.action === "GHL_CIRCUIT_OPEN");
    lastCircuitTripAt = circuitTrip?.createdAt ? new Date(circuitTrip.createdAt).toISOString() : null;
  } catch { /* non-fatal */ }

  // GHL activity log based metrics — use global query (no contactId filter)
  let webhookEventsLast24h = 0;
  let permissionCheckCallsLast24h = 0;
  let fieldWriteErrors422 = 0;
  let missingGhlContactId = 0;
  let recent422Errors: Array<{ contactId: number | null; operation: string | null; httpStatus: number | null; createdAt: string | null }> = [];
  try {
    const { data: allContacts } = await storage.getContacts({ limit: 5000 });
    missingGhlContactId = allContacts.filter(c => !c.ghlContactId && c.email).length;

    // Full-scope global query — getGhlActivityLogs() with no contactId returns all logs
    const allActivityLogs = await storage.getGhlActivityLogs();
    for (const log of allActivityLogs) {
      if (!log.createdAt || new Date(log.createdAt) < twentyFourHoursAgo) continue;
      if (log.direction === "inbound") webhookEventsLast24h++;
      if (log.channel === "permission_check") permissionCheckCallsLast24h++;
      if (log.channel === "sync_error") {
        const meta = log.metadata as any;
        if (meta?.httpStatus === 422 || meta?.httpStatus === "422") {
          fieldWriteErrors422++;
          if (recent422Errors.length < 10) {
            recent422Errors.push({
              contactId: log.contactId ?? null,
              operation: meta?.operation ?? null,
              httpStatus: meta?.httpStatus ? Number(meta.httpStatus) : 422,
              createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
            });
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  const hasPermissionFieldGap = fieldWriteErrors422 > 0;

  return {
    ...baseStatus,
    totalDeals: dealStats.total,
    entityStatuses,
    // Wave 7 authority fields
    circuitState: {
      open: circuitStatus.circuitOpen,
      consecutiveFailures: circuitStatus.consecutiveFailures,
      threshold: circuitStatus.threshold,
      lastTripAt: lastCircuitTripAt,
    },
    failedSyncsLast24h,
    missingGhlContactId,
    fieldWriteErrors422,
    recent422Errors,
    webhookEventsLast24h,
    permissionCheckCallsLast24h,
    optOutEventsLast24h,
    hasPermissionFieldGap,
  };
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
const syncedCompanyIds = new Set<number>();
const syncedTaskIds = new Set<number>();

const GHL_CIRCUIT_THRESHOLD = 5;
let consecutiveGhlFailures = 0;
let ghlCircuitOpen = false;
let lastCircuitAlertAt = 0;

function maybeSendCircuitAlert(): void {
  const now = Date.now();
  if (now - lastCircuitAlertAt < 60 * 60 * 1000) return;
  lastCircuitAlertAt = now;
  import("./system-audit/slack-notifier").then(({ sendCriticalAlert }) => {
    sendCriticalAlert({
      subsystem: "ghl-auth",
      status: "error",
      summary: `GHL circuit breaker opened — ${consecutiveGhlFailures} consecutive API failures. Sync halted.`,
      details: { consecutiveFailures: consecutiveGhlFailures, threshold: GHL_CIRCUIT_THRESHOLD },
    }).catch(() => {});
  }).catch(() => {});
}

export function getGhlCircuitState(): { open: boolean; consecutiveFailures: number } {
  return { open: ghlCircuitOpen, consecutiveFailures: consecutiveGhlFailures };
}

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

export function getGhlCircuitStatus(): { circuitOpen: boolean; consecutiveFailures: number; threshold: number } {
  return {
    circuitOpen: consecutiveGhlFailures >= GHL_CIRCUIT_THRESHOLD,
    consecutiveFailures: consecutiveGhlFailures,
    threshold: GHL_CIRCUIT_THRESHOLD,
  };
}

export function resetGhlCircuit(): void {
  consecutiveGhlFailures = 0;
  console.log("[GHL Sync] Circuit breaker manually reset by operator");
}

/**
 * Full GHL sync tick — mirrors the complete body of startAutoSyncLoop's
 * setInterval callback (contacts, failed-contact retry, deals, recent tasks,
 * unsynced companies), sharing the same module-level tracking sets so state
 * is preserved across BullMQ repeatable job invocations within the same process.
 */
export async function runGhlFullSyncTick(): Promise<void> {
  if (!isGhlConfigured()) return;
  if (ghlCircuitOpen) {
    console.log("[Queue:ghl-sync] GHL_CIRCUIT_RESET — new tick detected, resetting circuit breaker to allow recovery");
    storage.createAuditLog({ action: "GHL_CIRCUIT_RESET", entityType: "system", details: "Circuit breaker reset at start of new sync tick — GHL will be retried" }).catch(() => {});
  }
  consecutiveGhlFailures = 0;
  ghlCircuitOpen = false;
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
        maybeSendCircuitAlert();
        ghlCircuitOpen = true;
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncContactToGhl(contact.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          synced++;
        } else if (result.error === "ghl_identity_conflict") {
          // Ownership conflict — safe data-skip; do not trip the circuit breaker.
          console.log(`[Queue:ghl-sync] Contact ${contact.id} identity conflict — skipping, not counted as GHL failure`);
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
      ghlCircuitOpen = true;
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
          } else if (result.error === "ghl_identity_conflict") {
            // Ownership conflict — safe data-skip; do not trip the circuit breaker.
            console.log(`[Queue:ghl-sync] Retry contact ${contactId} identity conflict — skipping, not counted as GHL failure`);
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
      ghlCircuitOpen = true;
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
        ghlCircuitOpen = true;
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncDealToGhl(deal.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          dealsSynced++;
        } else if (result.error === "No GHL contact linked" || result.error === "GHL not configured" || result.error === "Deal not found") {
          // Data-dependency skip — not a GHL API failure; do not trip the circuit.
          console.log(`[Queue:ghl-sync] Deal ${deal.id} skipped (${result.error}) — not counted as GHL failure`);
        } else if (result.error?.includes("OPPORTUNITY_STAGE_ID_INVALID")) {
          // Stage name mismatch — our internal stage names don't match GHL pipeline stage
          // names. This is a one-time config fix (set GHL_STAGE_ID_MAP), not a transient
          // API failure — skip without counting toward the circuit breaker threshold.
          console.warn(`[Queue:ghl-sync] Deal ${deal.id} stage ID rejected by GHL (name mismatch) — skipping. Fix: set GHL_STAGE_ID_MAP env var with a JSON map of stage names → GHL stage UUIDs.`);
        } else {
          consecutiveGhlFailures++;
          console.warn(`[Queue:ghl-sync] Deal ${deal.id} sync failed: ${result.error}`);
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
      ghlCircuitOpen = true;
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
        ghlCircuitOpen = true;
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
      ghlCircuitOpen = true;
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
        ghlCircuitOpen = true;
        await releaseJobLock(JOB_NAMES.GHL_SYNC, false, "GHL_CIRCUIT_OPEN");
        return;
      }
      try {
        const result = await syncCompanyToGhl(company.id);
        if (result.success) {
          consecutiveGhlFailures = 0;
          companiesSynced++;
          syncedCompanyIds.add(company.id);
        } else if (result.skip) {
          // Known API limitation (e.g. 404 on GHL companies endpoint) — don't
          // count toward circuit-breaker threshold; mark as synced so we stop
          // retrying on every tick.
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

    try {
      const { runDeleteDetectionTick } = await import("./ghl-delete-sync");
      const deleteResult = await runDeleteDetectionTick();
      if (deleteResult.contactsDeleted > 0 || deleteResult.dealsDeleted > 0) {
        console.log(`[Queue:ghl-sync] Delete detection: ${deleteResult.contactsDeleted} contacts, ${deleteResult.dealsDeleted} deals soft-deleted`);
      }
    } catch (delErr: any) {
      console.warn("[Queue:ghl-sync] Delete detection tick failed (non-fatal):", delErr.message);
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
