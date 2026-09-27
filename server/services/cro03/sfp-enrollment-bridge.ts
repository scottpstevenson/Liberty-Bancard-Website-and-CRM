/**
 * sfp-enrollment-bridge.ts
 *
 * The missing `ready_held` -> paused-enrollment bridge. `sfp_campaign_staging_intents`
 * pins a business + package version but has no `contact_id`, while
 * `sequence_enrollments` requires one. This module resolves a contact
 * identity-safely (match an existing contact, or create a new one through
 * the canonical writeContact() writer — never a raw INSERT) and creates a
 * `sequence_enrollments` row with status='paused'.
 *
 * Explicitly out of scope, by design: unpausing, dispatch, sending, or any
 * GHL/email/SMS/voice action. Every enrollment this module creates lands
 * paused and stays paused until a later, separately authorized task acts on
 * it.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { writeContact } from "../contact-writer";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export interface ReadyHeldEnrollmentResult {
  stagingIntentId: string;
  status: "created" | "already_bridged";
  contactId: number;
  contactResolution: "matched_existing" | "created_new";
  sequenceEnrollmentId: number;
  enrollmentStatus: string;
}

/**
 * Resolves and enrolls a single `ready_held` staging intent. Idempotent: a
 * second call for the same intent returns the existing bridge row rather
 * than creating a duplicate contact or enrollment.
 */
export async function bridgeReadyHeldIntentToPausedEnrollment(
  stagingIntentId: string,
  actorId: string,
): Promise<ReadyHeldEnrollmentResult> {
  const existing = rows(await db.execute(sql`
    SELECT contact_id, sequence_enrollment_id, contact_resolution
      FROM sfp_ready_held_enrollments WHERE staging_intent_id=${stagingIntentId}::uuid
  `))[0];
  if (existing) {
    const enrollment = rows(await db.execute(sql`
      SELECT status FROM sequence_enrollments WHERE id=${Number(existing.sequence_enrollment_id)}
    `))[0];
    return {
      stagingIntentId, status: "already_bridged", contactId: Number(existing.contact_id),
      contactResolution: existing.contact_resolution, sequenceEnrollmentId: Number(existing.sequence_enrollment_id),
      enrollmentStatus: enrollment ? String(enrollment.status) : "unknown",
    };
  }

  const intent = rows(await db.execute(sql`
    SELECT id, business_id, master_lead_id, package_version_id, state
      FROM sfp_campaign_staging_intents WHERE id=${stagingIntentId}::uuid
  `))[0];
  if (!intent) throw new Error("SFP_STAGING_INTENT_NOT_FOUND");
  if (intent.state !== "ready_held") throw new Error(`SFP_STAGING_INTENT_NOT_READY_HELD:${intent.state}`);
  if (!intent.package_version_id) throw new Error("SFP_STAGING_INTENT_NO_PACKAGE_VERSION");

  const packageVersion = rows(await db.execute(sql`
    SELECT sequence_id, vertical FROM sfp_campaign_package_versions WHERE id=${intent.package_version_id}::uuid
  `))[0];
  if (!packageVersion) throw new Error("SFP_PACKAGE_VERSION_NOT_FOUND");
  const sequenceId = Number(packageVersion.sequence_id);

  const business = rows(await db.execute(sql`
    SELECT id, canonical_name, main_email, main_phone, vertical FROM businesses WHERE id=${Number(intent.business_id)}
  `))[0];
  if (!business) throw new Error("SFP_BUSINESS_NOT_FOUND");

  const masterLead = intent.master_lead_id
    ? rows(await db.execute(sql`
        SELECT email, phone, contact_name FROM master_leads WHERE id=${intent.master_lead_id}::uuid
      `))[0]
    : null;

  const candidateEmail = String(masterLead?.email ?? business.main_email ?? "").trim().toLowerCase();
  const candidatePhone = String(masterLead?.phone ?? business.main_phone ?? "").trim();

  let contactId: number;
  let contactResolution: "matched_existing" | "created_new";

  // Identity-safe match: only ever match by a real, non-placeholder email —
  // never guess a contact from a name/phone fuzzy match, and never silently
  // merge into an unrelated existing record.
  const matched = candidateEmail
    ? rows(await db.execute(sql`
        SELECT id FROM contacts
         WHERE lower(email) = ${candidateEmail} AND archived_at IS NULL
         ORDER BY id ASC LIMIT 1
      `))[0]
    : null;

  if (matched) {
    contactId = Number(matched.id);
    contactResolution = "matched_existing";
  } else {
    const nameParts = String(masterLead?.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || String(business.canonical_name ?? "Business").slice(0, 60);
    const lastName = nameParts.slice(1).join(" ") || "Contact";
    const email = candidateEmail || `no-email-${stagingIntentId}@no-email.libertybancard.internal`;
    const created = await writeContact({
      mode: "local_only",
      mutation: {
        firstName, lastName, email, phone: candidatePhone,
        companyName: business.canonical_name ?? null,
        vertical: packageVersion.vertical ?? business.vertical ?? null,
        status: "New",
      } as any,
      provenance: {
        sourceCategory: "discovery", sourceType: "cro03",
        eventKey: `sfp_ready_held_bridge:${stagingIntentId}`,
        actorType: "system", actorId,
        metadata: { stagingIntentId, businessId: Number(business.id) },
      },
      actor: { actorType: "system", actorId },
    });
    contactId = created.id;
    contactResolution = "created_new";
  }

  // Insert the paused enrollment and the bridge ledger row in one
  // transaction; if the contact is already actively/paused-enrolled in this
  // exact sequence via some other route, the partial unique index on
  // sequence_enrollments rejects the insert and that existing enrollment is
  // reused instead of creating a duplicate.
  const result = await db.transaction(async (tx) => {
    let enrollmentRow = rows(await tx.execute(sql`
      SELECT id, status FROM sequence_enrollments
       WHERE contact_id=${contactId} AND sequence_id=${sequenceId} AND status IN ('active','paused')
       LIMIT 1
    `))[0];
    if (!enrollmentRow) {
      enrollmentRow = rows(await tx.execute(sql`
        INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, metadata)
        VALUES (${sequenceId}, ${contactId}, 0, 'paused', ${JSON.stringify({ source: "sfp_ready_held_bridge", stagingIntentId })}::jsonb)
        RETURNING id, status
      `))[0];
    }
    await tx.execute(sql`
      INSERT INTO sfp_ready_held_enrollments
        (staging_intent_id, contact_id, sequence_enrollment_id, contact_resolution, actor_id)
      VALUES (${stagingIntentId}::uuid, ${contactId}, ${Number(enrollmentRow.id)}, ${contactResolution}, ${actorId})
      ON CONFLICT (staging_intent_id) DO NOTHING
    `);
    return enrollmentRow;
  });

  return {
    stagingIntentId, status: "created", contactId, contactResolution,
    sequenceEnrollmentId: Number(result.id), enrollmentStatus: String(result.status),
  };
}
