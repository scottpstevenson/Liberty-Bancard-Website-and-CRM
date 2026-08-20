import { db } from "../db";
import { storage } from "../storage";
import { contacts, type Contact } from "@shared/schema";
import { eq } from "drizzle-orm";
import { updateContactGhlFirst, upsertContactSourceEvent } from "./contact-writer";
import type { PublicFormType, PublicContactProfilePayload } from "./public-form-payload";
import { applyConsentCommand } from "./consent-authority";

export interface ProcessExistingSubmissionArgs {
  existingContact: Contact;
  permittedProfileUpdates: PublicContactProfilePayload;
  incomingConsent: { consentEmail?: boolean; consentSms?: boolean };
  submissionId: string;
  formType: PublicFormType;
  requestEvidence: {
    ipAddress: string;
    userAgent: string;
    disclosureVersion?: string;
  };
}

/**
 * Canonical existing-contact handler for all public form handlers (except callback_form,
 * which has no email identifier and no consent fields — see callback route for exemption).
 *
 * Order of operations:
 * A) db.transaction(): re-read contact to get fresh state (eliminates race between
 *    route-level lookup and write), re-evaluate mergePersistedConsentState() against
 *    fresh state, update contact, insert blocked audit rows (ON CONFLICT DO NOTHING),
 *    insert permitted opt_in audit rows for channels actually set to true.
 * B) Post-commit: updateContactGhlFirst() with only the permitted merged result
 *    — GHL failure does not roll back local update; retry queue handles it
 * C) upsertContactSourceEvent() to record the resubmission provenance
 * D) Return re-fetched contact
 *
 * Kill lines enforced:
 * - Protected compliance fields (doNotContact, emailStatus, smsStatus, etc.)
 *   are never in permittedProfileUpdates — callers must use buildPublicContactPayload()
 * - doNotAutoContact is NOT treated as consent withdrawal
 * - GHL receives only the post-merge permitted values, never the raw incoming consent
 * - Audit idempotency is enforced by the DB unique index on
 *   (contact_id, form_id, channel) WHERE action = 'consent_reenable_blocked'
 * - opt_in audit rows are written by this service for existing contacts — callers must
 *   NOT also write their own opt_in audit rows for the existing-contact branch
 */
export async function processExistingPublicFormSubmission(
  args: ProcessExistingSubmissionArgs,
): Promise<Contact> {
  const {
    existingContact,
    permittedProfileUpdates,
    incomingConsent,
    submissionId,
    formType,
    requestEvidence,
  } = args;

  let finalUpdate: Record<string, unknown> = {};

  // A: Atomic profile-only transaction. Consent is intentionally excluded: the
  // reducer below is the sole authority for consent and suppression state.
  await db.transaction(async (tx) => {
    // Re-read inside transaction (read committed: sees latest committed state,
    // closing the race window between route-level lookup and this write).
    const [freshContact] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, existingContact.id));

    if (!freshContact) {
      throw new Error(`Contact #${existingContact.id} disappeared before update`);
    }

    finalUpdate = { ...permittedProfileUpdates };

    if (Object.keys(finalUpdate).length > 0) {
      await tx
        .update(contacts)
        .set(finalUpdate as any)
        .where(eq(contacts.id, existingContact.id));
    }

  });

  // B: Consent facts and their compatibility projections are atomically
  // reduced by the authority service. Public input never supplies ordering or
  // canonical identity; the server supplies both.
  for (const [channel, value] of [
    ["email", incomingConsent.consentEmail],
    ["sms", incomingConsent.consentSms],
  ] as const) {
    if (value === undefined) continue;
    await applyConsentCommand({
      subject: { type: "contact", id: existingContact.id },
      kind: value ? "opt_in" : "opt_out",
      channel,
      purpose: "outreach",
      eventNamespace: "public_form",
      eventKey: `${formType}:${submissionId}:${channel}`,
      source: "website_form",
      ipAddress: requestEvidence.ipAddress,
      userAgent: requestEvidence.userAgent,
      evidence: {
        submissionId,
        formType,
        disclosureVersion: requestEvidence.disclosureVersion ?? null,
      },
      details: { submissionId, formType },
    });
  }

  // C: Post-commit GHL sync — GHL failure must not roll back local update
  if (Object.keys(finalUpdate).length > 0) {
    try {
      await updateContactGhlFirst(
        existingContact.id,
        finalUpdate as any,
        { actorType: "public" },
      );
    } catch (ghlErr: unknown) {
      const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
      console.warn(
        `[PublicFormSubmission] GHL sync failed for contact ${existingContact.id} (local update preserved): ${msg}`,
      );
      try {
        await storage.createAuditLog({
          action: "ghl_sync_failed",
          entityType: "contact",
          entityId: existingContact.id,
          details: { error: msg, trigger: "existing_contact_form_resubmission", formType, submissionId },
        });
      } catch {
        // Non-fatal audit log write — never propagate
      }
    }
  }

  // D: Record resubmission provenance (idempotent on same eventKey)
  upsertContactSourceEvent({
    contactId: existingContact.id,
    provenance: {
      eventKey: `form:${formType}:${submissionId}`,
      sourceCategory: "website_form",
      sourceType: formType,
      actorType: "public",
    },
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[PublicFormSubmission] Source event upsert failed for contact #${existingContact.id}: ${msg}`);
  });

  // E: Re-fetch and return updated contact
  const updated = await storage.getContact(existingContact.id);
  if (!updated) {
    throw new Error(`Contact #${existingContact.id} not found after update`);
  }
  return updated;
}
