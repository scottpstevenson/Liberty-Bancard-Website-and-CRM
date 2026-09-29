/**
 * sfp-enrollment-bridge.ts
 *
 * The missing `ready_held` -> paused-enrollment bridge. `sfp_campaign_staging_intents`
 * pins a business + package version and may pin an exact verified-linked
 * contact source; `sequence_enrollments` requires a contact. This module resolves a contact
 * identity-safely (match an existing contact, or create a new one through
 * the canonical writeContact() writer — never a raw INSERT) and creates a
 * `sequence_enrollments` row with status='paused'.
 *
 * Explicitly out of scope, by design: unpausing, dispatch, sending, or any
 * GHL/email/SMS/voice action. Every enrollment this module creates lands
 * paused and stays paused until a later, separately authorized task acts on
 * it.
 *
 * Identity/eligibility rules (see review that flagged the earlier version):
 *  - No synthetic-email contact is ever created here. An intent with no
 *    corroborated real-email identity is left `ready_held` and reported as
 *    `left_held`, not silently force-matched or force-created.
 *  - An email match alone is not enough to attach an existing contact: the
 *    match must be corroborated by phone or company-name agreement with the
 *    business record, or it is treated as ambiguous and left held.
 *  - Before creating a paused enrollment, evaluateContactDecisions()'s
 *    `promotion` dimension (DBPR lineage / existing-customer / suppression)
 *    must be eligible; a blocked dimension leaves the intent held.
 *  - A pre-existing ACTIVE sequence_enrollments row for the same
 *    (contact, sequence) is a hard rejection, never a reused "success" —
 *    this bridge must never touch or claim credit for a live enrollment.
 *  - Concurrent calls that would resolve to the same email are serialized
 *    with a transaction-level advisory lock keyed on the email. The contact
 *    writer, enrollment, and ledger use that same transaction; an error at
 *    any point rolls back every write and releases the lock.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { writeContact } from "../contact-writer";
import { evaluateContactDecisions, evaluateBusinessPromotionEligibility } from "../contactability";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export type BridgeStatus = "created" | "already_bridged" | "left_held";

export interface ReadyHeldEnrollmentResult {
  stagingIntentId: string;
  status: BridgeStatus;
  contactId: number | null;
  contactResolution: "matched_existing" | "created_new" | null;
  sequenceEnrollmentId: number | null;
  enrollmentStatus: string | null;
  heldReason?: string;
}

function normalizeCompanyToken(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves and enrolls a single `ready_held` staging intent. Idempotent: a
 * second call for the same intent returns the existing bridge row rather
 * than creating a duplicate contact or enrollment. Never creates or accepts
 * an ACTIVE enrollment — that is always a hard rejection (thrown error).
 */
export async function bridgeReadyHeldIntentToPausedEnrollment(
  stagingIntentId: string,
  actorId: string,
  _testFaultInjector?: (stage: "after_contact_before_enrollment" | "after_enrollment_before_ledger") => void,
): Promise<ReadyHeldEnrollmentResult> {
  return db.transaction(async (tx) => {
  const intent = rows(await tx.execute(sql`
    SELECT id, business_id, master_lead_id, package_version_id, contact_id, state
      FROM sfp_campaign_staging_intents WHERE id=${stagingIntentId}::uuid FOR UPDATE
  `))[0];
  if (!intent) throw new Error("SFP_STAGING_INTENT_NOT_FOUND");
  if (intent.state !== "ready_held") throw new Error(`SFP_STAGING_INTENT_NOT_READY_HELD:${intent.state}`);
  const existing = rows(await tx.execute(sql`
    SELECT contact_id, sequence_enrollment_id, contact_resolution
      FROM sfp_ready_held_enrollments WHERE staging_intent_id=${stagingIntentId}::uuid
  `))[0];
  if (existing) {
    const enrollment = rows(await tx.execute(sql`
      SELECT status FROM sequence_enrollments WHERE id=${Number(existing.sequence_enrollment_id)}
    `))[0];
    if (enrollment?.status !== "paused") throw new Error("SFP_BRIDGED_ENROLLMENT_NOT_PAUSED");
    return {
      stagingIntentId, status: "already_bridged", contactId: Number(existing.contact_id),
      contactResolution: existing.contact_resolution, sequenceEnrollmentId: Number(existing.sequence_enrollment_id),
      enrollmentStatus: "paused",
    };
  }
  if (!intent.package_version_id) throw new Error("SFP_STAGING_INTENT_NO_PACKAGE_VERSION");

  const packageVersion = rows(await tx.execute(sql`
    SELECT sequence_id, vertical FROM sfp_campaign_package_versions WHERE id=${intent.package_version_id}::uuid
  `))[0];
  if (!packageVersion) throw new Error("SFP_PACKAGE_VERSION_NOT_FOUND");
  const sequenceId = Number(packageVersion.sequence_id);

  const business = rows(await tx.execute(sql`
    SELECT id, canonical_name, main_email, main_phone, vertical FROM businesses WHERE id=${Number(intent.business_id)}
  `))[0];
  if (!business) throw new Error("SFP_BUSINESS_NOT_FOUND");

  const masterLead = intent.master_lead_id
    ? rows(await tx.execute(sql`
        SELECT email, phone, contact_name FROM master_leads WHERE id=${intent.master_lead_id}::uuid
      `))[0]
    : null;

  // The enrollment email MUST be the address pinned to this intent by the
  // validated staging write (sfp-campaign-staging-v2.ts projects the
  // validated candidate plaintext into a master_leads row created 1:1 for
  // this intent, inside the same transaction as the intent itself). We
  // never fall back to businesses.main_email here: that field is an
  // unrelated, unvalidated business record and silently substituting it
  // would enroll a different, never-validated address under the cover of
  // this intent's validation.
  if (!intent.master_lead_id || !masterLead || !masterLead.email) {
    return {
      stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
      sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "NO_PINNED_VALIDATED_EMAIL",
    };
  }
  const candidateEmail = String(masterLead.email).trim().toLowerCase();
  const candidatePhone = String(masterLead?.phone ?? business.main_phone ?? "").replace(/[^0-9]/g, "");
  const businessNameToken = normalizeCompanyToken(business.canonical_name);

  // No corroborated real-email identity at all -> leave held. We never
  // fabricate a synthetic-placeholder-email contact here; that would create
  // an unreviewable, effectively unreachable "contact" purely to satisfy the
  // NOT NULL constraint, which is exactly the silent-authority failure mode
  // this bridge exists to avoid.
  if (!candidateEmail || !candidateEmail.includes("@")) {
    return {
      stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
      sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "NO_REAL_EMAIL_IDENTITY",
    };
  }

  // The intent row lock fences same-intent callers; the email lock fences
  // two DIFFERENT intents that resolve to the same contact identity.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sfp-enrollment-bridge-email:${candidateEmail}`}))`);

    // Contact-originated candidates are identity-pinned at validation and
    // staging time. Reuse only that exact contact if its verified link and
    // email still agree; never fall through to a different same-email row or
    // create a duplicate contact when this source reference has gone stale.
    const pinnedContact = intent.contact_id == null ? null : rows(await tx.execute(sql`
      SELECT c.id
        FROM contacts c
        JOIN businesses b ON b.id=${Number(business.id)} AND b.record_class='canonical'
        JOIN contact_business_link_decisions d ON d.contact_id=c.id AND d.business_id=b.id
         AND d.decision='verified' AND d.superseded_at IS NULL
       WHERE c.id=${Number(intent.contact_id)} AND c.business_id=b.id AND c.archived_at IS NULL
         AND LOWER(TRIM(c.email))=${candidateEmail}
       LIMIT 1
    `))[0];

    if (intent.contact_id != null && !pinnedContact) {
      return {
        stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
        sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "PINNED_CONTACT_LINK_OR_EMAIL_CHANGED",
      };
    }

    const matchCandidates = pinnedContact ? [] : rows(await tx.execute(sql`
      SELECT id, phone, company_name FROM contacts
       WHERE lower(email) = ${candidateEmail} AND archived_at IS NULL
       ORDER BY id ASC
    `));
    // Corroborate an email match with at least one more independent signal
    // (phone or company name) before trusting it as the same real-world
    // entity — a bare email match is not enough to silently attach an
    // unrelated contact record to this business/intent.
    const corroborated = matchCandidates.find((c: any) => {
      const phoneMatches = candidatePhone && String(c.phone ?? "").replace(/[^0-9]/g, "") === candidatePhone;
      const companyMatches = businessNameToken && normalizeCompanyToken(c.company_name) === businessNameToken;
      return phoneMatches || companyMatches;
    });

    if (matchCandidates.length > 0 && !corroborated) {
      return {
        stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
        sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "EMAIL_MATCH_UNCORROBORATED",
      };
    }

    let contactId: number;
    let contactResolution: "matched_existing" | "created_new";

    if (pinnedContact) {
      contactId = Number(pinnedContact.id);
      contactResolution = "matched_existing";
    } else if (corroborated) {
      contactId = Number(corroborated.id);
      contactResolution = "matched_existing";
    } else {
      // Early business-scoped gate avoids unnecessary contact writes. The
      // transaction below remains the real rollback boundary if a later
      // contact-level decision or enrollment/ledger insert rejects the work.
      const businessDecision = await evaluateBusinessPromotionEligibility(Number(business.id), tx);
      if (businessDecision.status === "blocked") {
        return {
          stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
          sequenceEnrollmentId: null, enrollmentStatus: null,
          heldReason: `PROMOTION_BLOCKED:${businessDecision.reasonCodes.join(",")}`,
        };
      }
      const nameParts = String(masterLead?.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || String(business.canonical_name ?? "Business").slice(0, 60);
      const lastName = nameParts.slice(1).join(" ") || "Contact";
      const created = await writeContact({
        mode: "local_only",
        transaction: tx,
        hookPolicy: { source:"cro03",deferValidation:true,deferReadiness:true,
          deferLeadScoring:true,suppressProviderProjection:true },
        mutation: {
          firstName, lastName, email: candidateEmail, phone: candidatePhone || "",
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
      if (created._intakeOutcome !== "created") {
        const phoneMatches = candidatePhone && String(created.phone ?? "").replace(/[^0-9]/g, "") === candidatePhone;
        const companyMatches = businessNameToken && normalizeCompanyToken(created.companyName) === businessNameToken;
        if (!phoneMatches && !companyMatches) throw new Error("SFP_CONTACT_MATCH_UNCORROBORATED_AT_WRITE");
      }
      contactId = created.id;
      contactResolution = created._intakeOutcome === "created" ? "created_new" : "matched_existing";
    }

    // Eligibility gate: promotion dimension covers DBPR lineage, existing-
    // customer status, and suppression — the same authority every other
    // enumerated consumer (enrollment included) must call. A blocked
    // dimension leaves the intent held rather than pausing an enrollment
    // for a contact this authority says is not eligible.
    const decisions = await evaluateContactDecisions({ contactId, businessId: Number(business.id) }, tx);
    if (decisions.promotion.status === "blocked") {
      // A newly created contact exists only in this transaction. Returning
      // would commit an orphan; throw to roll the canonical write back.
      if (contactResolution === "created_new") {
        throw new Error(`SFP_PROMOTION_BLOCKED_AFTER_CONTACT_WRITE:${decisions.promotion.reasonCodes.join(",")}`);
      }
      return {
        stagingIntentId, status: "left_held", contactId, contactResolution,
        sequenceEnrollmentId: null, enrollmentStatus: null,
        heldReason: `PROMOTION_BLOCKED:${decisions.promotion.reasonCodes.join(",")}`,
      };
    }

    _testFaultInjector?.("after_contact_before_enrollment");
    const result = await (async () => {
      const activeOrPaused = rows(await tx.execute(sql`
        SELECT id, status FROM sequence_enrollments
         WHERE contact_id=${contactId} AND sequence_id=${sequenceId} AND status IN ('active','paused')
         LIMIT 1
      `))[0];
      if (activeOrPaused && activeOrPaused.status === "active") {
        // Hard rejection: this bridge must never create, touch, or claim
        // credit for an ACTIVE enrollment — only ever a fresh paused one.
        throw new Error(`SFP_EXISTING_ACTIVE_ENROLLMENT_CONFLICT:${activeOrPaused.id}`);
      }
      if (activeOrPaused && activeOrPaused.status === "paused") {
        const metadata = rows(await tx.execute(sql`
          SELECT metadata FROM sequence_enrollments WHERE id=${Number(activeOrPaused.id)}
        `))[0]?.metadata;
        if (metadata?.stagingIntentId !== stagingIntentId) {
          throw new Error(`SFP_EXISTING_PAUSED_ENROLLMENT_CONFLICT:${activeOrPaused.id}`);
        }
      }
      let enrollmentRow = activeOrPaused;
      if (!enrollmentRow) {
        enrollmentRow = rows(await tx.execute(sql`
          INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, metadata)
          VALUES (${sequenceId}, ${contactId}, 0, 'paused', ${JSON.stringify({ source: "sfp_ready_held_bridge", stagingIntentId })}::jsonb)
          RETURNING id, status
        `))[0];
      }
      _testFaultInjector?.("after_enrollment_before_ledger");
      const ledger = rows(await tx.execute(sql`
        INSERT INTO sfp_ready_held_enrollments
          (staging_intent_id, contact_id, sequence_enrollment_id, contact_resolution, actor_id)
        VALUES (${stagingIntentId}::uuid, ${contactId}, ${Number(enrollmentRow.id)}, ${contactResolution}, ${actorId})
        RETURNING id
      `));
      if (ledger.length !== 1) throw new Error("SFP_BRIDGE_LEDGER_INSERT_FAILED");
      return enrollmentRow;
    })();

    return {
      stagingIntentId, status: "created", contactId, contactResolution,
      sequenceEnrollmentId: Number(result.id), enrollmentStatus: String(result.status),
    };
  });
}
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
 *
 * Identity/eligibility rules (see review that flagged the earlier version):
 *  - No synthetic-email contact is ever created here. An intent with no
 *    corroborated real-email identity is left `ready_held` and reported as
 *    `left_held`, not silently force-matched or force-created.
 *  - An email match alone is not enough to attach an existing contact: the
 *    match must be corroborated by phone or company-name agreement with the
 *    business record, or it is treated as ambiguous and left held.
 *  - Before creating a paused enrollment, evaluateContactDecisions()'s
 *    `promotion` dimension (DBPR lineage / existing-customer / suppression)
 *    must be eligible; a blocked dimension leaves the intent held.
 *  - A pre-existing ACTIVE sequence_enrollments row for the same
 *    (contact, sequence) is a hard rejection, never a reused "success" —
 *    this bridge must never touch or claim credit for a live enrollment.
 *  - Concurrent calls that would resolve to the same email are serialized
 *    with a transaction-level advisory lock keyed on the email. The contact
 *    writer, enrollment, and ledger use that same transaction; an error at
 *    any point rolls back every write and releases the lock.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { writeContact } from "../contact-writer";
import { evaluateContactDecisions, evaluateBusinessPromotionEligibility } from "../contactability";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export type BridgeStatus = "created" | "already_bridged" | "left_held";

export interface ReadyHeldEnrollmentResult {
  stagingIntentId: string;
  status: BridgeStatus;
  contactId: number | null;
  contactResolution: "matched_existing" | "created_new" | null;
  sequenceEnrollmentId: number | null;
  enrollmentStatus: string | null;
  heldReason?: string;
}

function normalizeCompanyToken(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves and enrolls a single `ready_held` staging intent. Idempotent: a
 * second call for the same intent returns the existing bridge row rather
 * than creating a duplicate contact or enrollment. Never creates or accepts
 * an ACTIVE enrollment — that is always a hard rejection (thrown error).
 */
export async function bridgeReadyHeldIntentToPausedEnrollment(
  stagingIntentId: string,
  actorId: string,
  _testFaultInjector?: (stage: "after_contact_before_enrollment" | "after_enrollment_before_ledger") => void,
): Promise<ReadyHeldEnrollmentResult> {
  return db.transaction(async (tx) => {
  const intent = rows(await tx.execute(sql`
    SELECT id, business_id, master_lead_id, package_version_id, state
      FROM sfp_campaign_staging_intents WHERE id=${stagingIntentId}::uuid FOR UPDATE
  `))[0];
  if (!intent) throw new Error("SFP_STAGING_INTENT_NOT_FOUND");
  if (intent.state !== "ready_held") throw new Error(`SFP_STAGING_INTENT_NOT_READY_HELD:${intent.state}`);
  const existing = rows(await tx.execute(sql`
    SELECT contact_id, sequence_enrollment_id, contact_resolution
      FROM sfp_ready_held_enrollments WHERE staging_intent_id=${stagingIntentId}::uuid
  `))[0];
  if (existing) {
    const enrollment = rows(await tx.execute(sql`
      SELECT status FROM sequence_enrollments WHERE id=${Number(existing.sequence_enrollment_id)}
    `))[0];
    if (enrollment?.status !== "paused") throw new Error("SFP_BRIDGED_ENROLLMENT_NOT_PAUSED");
    return {
      stagingIntentId, status: "already_bridged", contactId: Number(existing.contact_id),
      contactResolution: existing.contact_resolution, sequenceEnrollmentId: Number(existing.sequence_enrollment_id),
      enrollmentStatus: "paused",
    };
  }
  if (!intent.package_version_id) throw new Error("SFP_STAGING_INTENT_NO_PACKAGE_VERSION");

  const packageVersion = rows(await tx.execute(sql`
    SELECT sequence_id, vertical FROM sfp_campaign_package_versions WHERE id=${intent.package_version_id}::uuid
  `))[0];
  if (!packageVersion) throw new Error("SFP_PACKAGE_VERSION_NOT_FOUND");
  const sequenceId = Number(packageVersion.sequence_id);

  const business = rows(await tx.execute(sql`
    SELECT id, canonical_name, main_email, main_phone, vertical FROM businesses WHERE id=${Number(intent.business_id)}
  `))[0];
  if (!business) throw new Error("SFP_BUSINESS_NOT_FOUND");

  const masterLead = intent.master_lead_id
    ? rows(await tx.execute(sql`
        SELECT email, phone, contact_name FROM master_leads WHERE id=${intent.master_lead_id}::uuid
      `))[0]
    : null;

  // The enrollment email MUST be the address pinned to this intent by the
  // validated staging write (sfp-campaign-staging-v2.ts projects the
  // validated candidate plaintext into a master_leads row created 1:1 for
  // this intent, inside the same transaction as the intent itself). We
  // never fall back to businesses.main_email here: that field is an
  // unrelated, unvalidated business record and silently substituting it
  // would enroll a different, never-validated address under the cover of
  // this intent's validation.
  if (!intent.master_lead_id || !masterLead || !masterLead.email) {
    return {
      stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
      sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "NO_PINNED_VALIDATED_EMAIL",
    };
  }
  const candidateEmail = String(masterLead.email).trim().toLowerCase();
  const candidatePhone = String(masterLead?.phone ?? business.main_phone ?? "").replace(/[^0-9]/g, "");
  const businessNameToken = normalizeCompanyToken(business.canonical_name);

  // No corroborated real-email identity at all -> leave held. We never
  // fabricate a synthetic-placeholder-email contact here; that would create
  // an unreviewable, effectively unreachable "contact" purely to satisfy the
  // NOT NULL constraint, which is exactly the silent-authority failure mode
  // this bridge exists to avoid.
  if (!candidateEmail || !candidateEmail.includes("@")) {
    return {
      stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
      sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "NO_REAL_EMAIL_IDENTITY",
    };
  }

  // The intent row lock fences same-intent callers; the email lock fences
  // two DIFFERENT intents that resolve to the same contact identity.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sfp-enrollment-bridge-email:${candidateEmail}`}))`);

    const matchCandidates = rows(await tx.execute(sql`
      SELECT id, phone, company_name FROM contacts
       WHERE lower(email) = ${candidateEmail} AND archived_at IS NULL
       ORDER BY id ASC
    `));
    // Corroborate an email match with at least one more independent signal
    // (phone or company name) before trusting it as the same real-world
    // entity — a bare email match is not enough to silently attach an
    // unrelated contact record to this business/intent.
    const corroborated = matchCandidates.find((c: any) => {
      const phoneMatches = candidatePhone && String(c.phone ?? "").replace(/[^0-9]/g, "") === candidatePhone;
      const companyMatches = businessNameToken && normalizeCompanyToken(c.company_name) === businessNameToken;
      return phoneMatches || companyMatches;
    });

    if (matchCandidates.length > 0 && !corroborated) {
      return {
        stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
        sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: "EMAIL_MATCH_UNCORROBORATED",
      };
    }

    let contactId: number;
    let contactResolution: "matched_existing" | "created_new";

    if (corroborated) {
      contactId = Number(corroborated.id);
      contactResolution = "matched_existing";
    } else {
      // Early business-scoped gate avoids unnecessary contact writes. The
      // transaction below remains the real rollback boundary if a later
      // contact-level decision or enrollment/ledger insert rejects the work.
      const businessDecision = await evaluateBusinessPromotionEligibility(Number(business.id), tx);
      if (businessDecision.status === "blocked") {
        return {
          stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
          sequenceEnrollmentId: null, enrollmentStatus: null,
          heldReason: `PROMOTION_BLOCKED:${businessDecision.reasonCodes.join(",")}`,
        };
      }
      const nameParts = String(masterLead?.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || String(business.canonical_name ?? "Business").slice(0, 60);
      const lastName = nameParts.slice(1).join(" ") || "Contact";
      const created = await writeContact({
        mode: "local_only",
        transaction: tx,
        hookPolicy: { source:"cro03",deferValidation:true,deferReadiness:true,
          deferLeadScoring:true,suppressProviderProjection:true },
        mutation: {
          firstName, lastName, email: candidateEmail, phone: candidatePhone || "",
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
      if (created._intakeOutcome !== "created") {
        const phoneMatches = candidatePhone && String(created.phone ?? "").replace(/[^0-9]/g, "") === candidatePhone;
        const companyMatches = businessNameToken && normalizeCompanyToken(created.companyName) === businessNameToken;
        if (!phoneMatches && !companyMatches) throw new Error("SFP_CONTACT_MATCH_UNCORROBORATED_AT_WRITE");
      }
      contactId = created.id;
      contactResolution = created._intakeOutcome === "created" ? "created_new" : "matched_existing";
    }

    // Eligibility gate: promotion dimension covers DBPR lineage, existing-
    // customer status, and suppression — the same authority every other
    // enumerated consumer (enrollment included) must call. A blocked
    // dimension leaves the intent held rather than pausing an enrollment
    // for a contact this authority says is not eligible.
    const decisions = await evaluateContactDecisions({ contactId, businessId: Number(business.id) }, tx);
    if (decisions.promotion.status === "blocked") {
      // A newly created contact exists only in this transaction. Returning
      // would commit an orphan; throw to roll the canonical write back.
      if (contactResolution === "created_new") {
        throw new Error(`SFP_PROMOTION_BLOCKED_AFTER_CONTACT_WRITE:${decisions.promotion.reasonCodes.join(",")}`);
      }
      return {
        stagingIntentId, status: "left_held", contactId, contactResolution,
        sequenceEnrollmentId: null, enrollmentStatus: null,
        heldReason: `PROMOTION_BLOCKED:${decisions.promotion.reasonCodes.join(",")}`,
      };
    }

    _testFaultInjector?.("after_contact_before_enrollment");
    const result = await (async () => {
      const activeOrPaused = rows(await tx.execute(sql`
        SELECT id, status FROM sequence_enrollments
         WHERE contact_id=${contactId} AND sequence_id=${sequenceId} AND status IN ('active','paused')
         LIMIT 1
      `))[0];
      if (activeOrPaused && activeOrPaused.status === "active") {
        // Hard rejection: this bridge must never create, touch, or claim
        // credit for an ACTIVE enrollment — only ever a fresh paused one.
        throw new Error(`SFP_EXISTING_ACTIVE_ENROLLMENT_CONFLICT:${activeOrPaused.id}`);
      }
      if (activeOrPaused && activeOrPaused.status === "paused") {
        const metadata = rows(await tx.execute(sql`
          SELECT metadata FROM sequence_enrollments WHERE id=${Number(activeOrPaused.id)}
        `))[0]?.metadata;
        if (metadata?.stagingIntentId !== stagingIntentId) {
          throw new Error(`SFP_EXISTING_PAUSED_ENROLLMENT_CONFLICT:${activeOrPaused.id}`);
        }
      }
      let enrollmentRow = activeOrPaused;
      if (!enrollmentRow) {
        enrollmentRow = rows(await tx.execute(sql`
          INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, metadata)
          VALUES (${sequenceId}, ${contactId}, 0, 'paused', ${JSON.stringify({ source: "sfp_ready_held_bridge", stagingIntentId })}::jsonb)
          RETURNING id, status
        `))[0];
      }
      _testFaultInjector?.("after_enrollment_before_ledger");
      const ledger = rows(await tx.execute(sql`
        INSERT INTO sfp_ready_held_enrollments
          (staging_intent_id, contact_id, sequence_enrollment_id, contact_resolution, actor_id)
        VALUES (${stagingIntentId}::uuid, ${contactId}, ${Number(enrollmentRow.id)}, ${contactResolution}, ${actorId})
        RETURNING id
      `));
      if (ledger.length !== 1) throw new Error("SFP_BRIDGE_LEDGER_INSERT_FAILED");
      return enrollmentRow;
    })();

    return {
      stagingIntentId, status: "created", contactId, contactResolution,
      sequenceEnrollmentId: Number(result.id), enrollmentStatus: String(result.status),
    };
  });
}
