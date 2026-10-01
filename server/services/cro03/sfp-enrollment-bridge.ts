/**
 * sfp-enrollment-bridge.ts
 *
 * The `ready_held` -> paused-enrollment bridge. Contact-source intents retain
 * the exact validated contact/link/email pins; this module row-locks and
 * rechecks those pins before using that contact. Non-contact intents resolve
 * a contact identity-safely (match an existing contact, or create one through
 * the canonical writeContact() writer — never a raw INSERT). Every enrollment
 * created here has status='paused'.
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
 *    with a transaction-level advisory lock keyed on its normalized token
 *    hash. The contact writer, enrollment, and ledger use that same
 *    transaction; an error at any point rolls back every write and releases
 *    the lock.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { decideCr06SequenceLifecycle } from "../cr06-promotional-lifecycle-decision";
import { writeContact } from "../contact-writer";
import { evaluateContactDecisions, evaluateBusinessPromotionEligibility } from "../contactability";
import { isCanonicallySuppressed, lockCurrentSfpOutreachPolicy } from "./sfp-outreach-policy";
import { hashEmailToken } from "../provider-readiness-decision";
import { openSfpCandidatePlaintext } from "./sfp-paid-evidence-writer";
import { lockSfpContactAddress } from "./sfp-contact-address-lock";
import { OUTBOUND_PAUSE_CONTROL_ADVISORY_LOCK_KEY } from "../outbound-pause-authority";
import {
  assertSfpRuntimeJobLease,
  type SfpRuntimeJobLeaseBinding,
} from "./sfp-provider-operations";
import {
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
  type CommercialGraphNode,
} from "../commercial-graph-locks";
import {
  assertSfpPipelineDatabaseGuard,
  decideSfpContactBusinessLink,
} from "../commercial-link-authority";
import {
  checkCurrentSfpEligibilityAndPackage,
  isCurrentSfpValidationReceiptFresh,
  normalizedSfpEmailHash,
  sfpRecipientIdentityHash,
  SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY,
} from "./sfp-recipient-link-predicates";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

async function lockCanonicalOutboundPause(tx: { execute: (query: any) => Promise<any> }): Promise<string | null> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock_shared(${Number(OUTBOUND_PAUSE_CONTROL_ADVISORY_LOCK_KEY)})
  `);
  const control = rows(await tx.execute(sql`
    SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1 FOR SHARE
  `))[0];
  return control ? String(control.state) : null;
}

export type BridgeStatus = "created" | "already_bridged" | "left_held";

export interface ReadyHeldEnrollmentResult {
  stagingIntentId: string;
  status: BridgeStatus;
  contactId: number | null;
  contactResolution: "matched_existing" | "created_new" | null;
  sequenceEnrollmentId: number | null;
  enrollmentStatus: string | null;
  heldReason?: string;
  currentHoldReason?: string;
}

function normalizeCompanyToken(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedContactIdentityHash(email: unknown, version: unknown): string | null {
  return normalizedSfpEmailHash(email, version);
}

function sourceReference(intent: any): string {
  if (intent.source_kind === "free") return String(intent.candidate_id ?? "");
  if (intent.source_kind === "paid") return String(intent.paid_candidate_evidence_id ?? "");
  return String(intent.contact_id ?? "");
}

async function openTypedSourceAddressPins(
  tx: any,
  intent: any,
  actorId: string,
  additionalContactIds: number[] = [],
): Promise<{
  normalizedValueHash: string | null;
  emailTokenHash: string | null;
  recipientIdentityHash: string | null;
} | null> {
  const sourceReferenceId = sourceReference(intent);
  const reference = intent.source_kind === "free"
    ? { sourceKind: "free" as const, freeDiscoveryCandidateId: sourceReferenceId }
    : intent.source_kind === "paid"
      ? { sourceKind: "paid" as const, paidCandidateEvidenceId: sourceReferenceId }
      : {
          sourceKind: "contact" as const,
          contactId: sourceReferenceId,
          contactBusinessLinkDecisionId: String(intent.contact_business_link_decision_id ?? ""),
          contactBusinessLinkRevision: Number(intent.contact_business_link_revision),
        };
  try {
    return await openSfpCandidatePlaintext({
      reference,
      cohortRunId: String(intent.cohort_run_id),
      actorId,
      purpose: "sfp_ready_held_bridge_source_revalidation",
    }, async (sourceEmail, resolved) => {
      if (resolved.businessId !== Number(intent.business_id) || resolved.evidenceId !== sourceReferenceId) return null;
      const emailTokenHash = hashEmailToken(sourceEmail);
      const matchingContactIds = emailTokenHash
        ? rows(await tx.execute(sql`
            SELECT id FROM contacts
             WHERE email_token_hash=${emailTokenHash} OR lower(email)=${sourceEmail.trim().toLowerCase()}
             ORDER BY id
          `)).map((row: any) => Number(row.id))
        : [];
      await lockCurrentSfpOutreachPolicy(tx);
      await lockContactBusinessGraph(tx, Number(intent.business_id), [
        ...additionalContactIds,
        ...(intent.contact_id ? [Number(intent.contact_id)] : []),
        ...matchingContactIds,
      ]);
      const graphOrderedGate = await checkCurrentSfpEligibilityAndPackage(tx, {
        eligibilityId: String(intent.eligibility_id),
        businessId: Number(intent.business_id),
        cohortRunId: String(intent.cohort_run_id),
        packageKey: String(intent.package_key ?? ""),
        packageVersionId: intent.package_version_id ? String(intent.package_version_id) : null,
        expectedSourceKind: intent.source_kind,
        emailTokenHash,
        emailAddress: sourceEmail,
        projectionWrite: true,
      });
      if (!graphOrderedGate.eligible) {
        throw new SfpBridgeHoldError(`CURRENT_GATE:${graphOrderedGate.reason}`);
      }
      const normalizedValueHash = normalizedContactIdentityHash(sourceEmail, intent.normalized_value_hash_version);
      const recipientIdentityHash = sfpRecipientIdentityHash(sourceEmail);
      if (!normalizedValueHash || normalizedValueHash !== String(intent.normalized_value_hash ?? "")
          || !emailTokenHash || !recipientIdentityHash) return null;
      return { normalizedValueHash, emailTokenHash, recipientIdentityHash };
    }, tx);
  } catch (error: any) {
    const code = String(error?.message ?? error).split("\n")[0];
    if ([
      "SFP_CANDIDATE_REFERENCE_NOT_FOUND",
      "SFP_CONTACT_SOURCE_PIN_STALE",
      "SFP_CANDIDATE_SOURCE_PIN_STALE",
      "SFP_CANDIDATE_IDENTITY_QUARANTINED",
    ].some((prefix) => code === prefix || code.startsWith(`${prefix}:`))
        || code.startsWith("SFP_CANDIDATE_NOT_OPENABLE:")) {
      return null;
    }
    throw error;
  }
}

async function currentTypedSourceAddressMatches(
  tx: any,
  intent: any,
  actorId: string,
  candidateEmail: string,
  expectedHash: string,
): Promise<boolean> {
  const pins = await openTypedSourceAddressPins(tx, intent, actorId);
  return Boolean(pins
    && pins.normalizedValueHash === expectedHash
    && pins.emailTokenHash === (hashEmailToken(candidateEmail) ?? "")
    && candidateEmail.trim().toLowerCase() === candidateEmail
    && pins.recipientIdentityHash === sfpRecipientIdentityHash(candidateEmail));
}

async function lockContactBusinessGraph(
  tx: any,
  businessId: number,
  contactIds: number[],
): Promise<void> {
  const uniqueContactIds = [...new Set(contactIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const nodes: CommercialGraphNode[] = [
    ...uniqueContactIds.map((id) => ({ type: "contact" as const, id })),
    { type: "business", id: businessId },
  ];
  await lockCommercialGraphNodes(tx, nodes);
  await lockCommercialGraphMembershipSets(tx, nodes, ["contact_business"]);
}

async function recordBridgeHold(tx: any, intent: any, reason: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO sfp_enrollment_bridge_holds (staging_intent_id,eligibility_id,hold_code,safe_detail)
    VALUES (${String(intent.id)}::uuid,${String(intent.eligibility_id)}::uuid,
            ${reason.slice(0,120)},${reason.slice(0,500)})
  `);
}

class SfpBridgeHoldError extends Error {
  constructor(readonly holdCode: string) { super(holdCode); }
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
  _testFaultInjector?: (stage: "after_source_contact_locked" | "after_contact_before_enrollment" | "after_enrollment_before_ledger") => void | Promise<void>,
  jobLease?: SfpRuntimeJobLeaseBinding,
): Promise<ReadyHeldEnrollmentResult> {
  if (!jobLease) {
    const { bridgeReadyHeldIntentAsOperator } = await import("./sfp-ready-held-consumer");
    return bridgeReadyHeldIntentAsOperator(stagingIntentId, actorId, _testFaultInjector);
  }
  try {
    return await db.transaction(async (tx) => {
  await assertSfpRuntimeJobLease(tx, jobLease);
  await assertSfpPipelineDatabaseGuard(tx);
  let intent = rows(await tx.execute(sql`
    SELECT id, eligibility_id, cohort_run_id, business_id, master_lead_id,
           package_version_id, package_key, source_kind, candidate_id, paid_candidate_evidence_id, contact_id,
           contact_business_link_decision_id, contact_business_link_revision,
            normalized_value_hash, normalized_value_hash_version,recipient_commitment_id,
           validation_snapshot, state
       FROM sfp_campaign_staging_intents WHERE id=${stagingIntentId}::uuid
  `))[0];
  if (!intent) throw new Error("SFP_STAGING_INTENT_NOT_FOUND");
  const hold = async (reason: string): Promise<ReadyHeldEnrollmentResult> => {
    await recordBridgeHold(tx, intent, reason);
    await assertSfpRuntimeJobLease(tx, jobLease);
    return {
      stagingIntentId, status: "left_held", contactId: null, contactResolution: null,
      sequenceEnrollmentId: null, enrollmentStatus: null, heldReason: reason,
    };
  };
  const outboundPauseState = await lockCanonicalOutboundPause(tx);
  if (outboundPauseState !== "paused") {
    return hold(outboundPauseState
      ? `outbound_global_${outboundPauseState}`
      : "outbound_global_pause_control_missing");
  }
  const masterLead = intent.master_lead_id
    ? rows(await tx.execute(sql`
        SELECT email, email_token_hash, phone, contact_name FROM master_leads WHERE id=${intent.master_lead_id}::uuid
      `))[0]
    : null;
  let existing: any = null;
  let commitmentHint: any = null;
  let sourceAddressPins: Awaited<ReturnType<typeof openTypedSourceAddressPins>> = null;
  existing = rows(await tx.execute(sql`
    SELECT contact_id, sequence_enrollment_id, contact_resolution,
           contact_business_link_decision_id,contact_business_link_revision,
           recipient_commitment_id
      FROM sfp_ready_held_enrollments WHERE staging_intent_id=${stagingIntentId}::uuid
  `))[0];
  commitmentHint = intent.recipient_commitment_id
    ? rows(await tx.execute(sql`
        SELECT contact_id FROM sfp_recipient_address_commitments
         WHERE id=${String(intent.recipient_commitment_id)}::uuid
      `))[0]
    : null;
  let hintedEmailTokenHash = String(masterLead?.email_token_hash ?? "");
  if (intent.contact_id) {
    const sourceContact = rows(await tx.execute(sql`
      SELECT email,email_token_hash FROM contacts WHERE id=${Number(intent.contact_id)}
    `))[0];
    if (!hintedEmailTokenHash) {
      hintedEmailTokenHash = String(sourceContact?.email_token_hash ?? hashEmailToken(sourceContact?.email) ?? "");
    }
  }
  sourceAddressPins = await openTypedSourceAddressPins(tx, intent, actorId, [
    Number(intent.contact_id ?? 0),
    Number(commitmentHint?.contact_id ?? 0),
    Number(existing?.contact_id ?? 0),
  ]);
  if (!hintedEmailTokenHash) hintedEmailTokenHash = String(sourceAddressPins?.emailTokenHash ?? "");
  if (masterLead?.email) await lockSfpContactAddress(tx, masterLead.email);
  if (hintedEmailTokenHash) {
    // Identity serialization above is the trigger-compatible address lock;
    // retain the token-hash lock for recipient-claim writers/replayers.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`sfp-bridge-recipient:${hintedEmailTokenHash}`}))
    `);
  }
  const lockedIntent = rows(await tx.execute(sql`
    SELECT id, eligibility_id, cohort_run_id, business_id, master_lead_id,
           package_version_id, package_key, source_kind, candidate_id, paid_candidate_evidence_id, contact_id,
           contact_business_link_decision_id, contact_business_link_revision,
           normalized_value_hash, normalized_value_hash_version,recipient_commitment_id,
           validation_snapshot, state
      FROM sfp_campaign_staging_intents
     WHERE id=${stagingIntentId}::uuid
     FOR UPDATE
  `))[0];
  if (!lockedIntent ||
      String(lockedIntent.eligibility_id) !== String(intent.eligibility_id) ||
      String(lockedIntent.cohort_run_id) !== String(intent.cohort_run_id) ||
      Number(lockedIntent.business_id) !== Number(intent.business_id) ||
      String(lockedIntent.source_kind) !== String(intent.source_kind) ||
      sourceReference(lockedIntent) !== sourceReference(intent) ||
      String(lockedIntent.normalized_value_hash ?? "") !== String(intent.normalized_value_hash ?? "")) {
    throw new Error("SFP_STAGING_INTENT_SOURCE_PIN_DRIFTED");
  }
  intent = lockedIntent;
  existing = rows(await tx.execute(sql`
    SELECT contact_id,sequence_enrollment_id,contact_resolution,
           contact_business_link_decision_id,contact_business_link_revision,recipient_commitment_id
      FROM sfp_ready_held_enrollments
     WHERE staging_intent_id=${stagingIntentId}::uuid
     FOR SHARE
  `))[0];
  if (existing) {
    if (intent.contact_id && Number(existing.contact_id) !== Number(intent.contact_id)) {
      throw new Error("SFP_PINNED_SOURCE_CONTACT_BRIDGE_MISMATCH");
    }
    const enrollment = rows(await tx.execute(sql`
       SELECT status FROM sequence_enrollments WHERE id=${Number(existing.sequence_enrollment_id)} FOR SHARE
    `))[0];
    if (enrollment?.status !== "paused") throw new Error("SFP_BRIDGED_ENROLLMENT_NOT_PAUSED");
     const pinnedCommitment = existing.recipient_commitment_id
       ? rows(await tx.execute(sql`
           SELECT id,program_id,objective_key,business_id,package_version_id,state,contact_id,
                  contact_business_link_decision_id
             FROM sfp_recipient_address_commitments
            WHERE id=${String(existing.recipient_commitment_id)}::uuid
            FOR SHARE
         `))[0]
       : null;
     const commitmentCurrent = Boolean(pinnedCommitment
       && pinnedCommitment.state === "committed"
       && String(pinnedCommitment.objective_key) === SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY
       && Number(pinnedCommitment.business_id) === Number(intent.business_id)
       && String(pinnedCommitment.package_version_id) === String(intent.package_version_id)
       && Number(pinnedCommitment.contact_id) === Number(existing.contact_id)
       && String(pinnedCommitment.contact_business_link_decision_id) ===
         String(existing.contact_business_link_decision_id));
     const currentContact = rows(await tx.execute(sql`
       SELECT id,business_id,email_token_hash,archived_at,existing_merchant_customer,
              do_not_contact,do_not_auto_contact,opted_out_email,opt_out_status,
              unsubscribe_status,complaint_status,bounce_status,email_status,suppression_reason
          FROM contacts WHERE id=${Number(existing.contact_id)}
     `))[0];
     const expectedContactAddressHash = String(masterLead?.email_token_hash ?? sourceAddressPins?.emailTokenHash ?? "");
     const contactCurrent = Boolean(currentContact
       && Number(currentContact.business_id) === Number(intent.business_id)
       && String(currentContact.email_token_hash ?? "") === expectedContactAddressHash
       && currentContact.archived_at == null
       && currentContact.existing_merchant_customer !== true
       && currentContact.do_not_contact !== true
       && currentContact.do_not_auto_contact !== true
       && currentContact.opted_out_email !== true
       && currentContact.opt_out_status !== "opted_out"
       && currentContact.unsubscribe_status !== "unsubscribed"
       && currentContact.complaint_status !== "reported"
       && currentContact.bounce_status !== "hard"
       && !["bounced", "invalid"].includes(String(currentContact.email_status ?? ""))
       && currentContact.suppression_reason == null);
     const currentLink = commitmentCurrent && existing.contact_business_link_decision_id
      ? rows(await tx.execute(sql`
           SELECT d.id,d.revision,c.business_id AS contact_business_id
             FROM contact_business_link_decisions d
             JOIN contacts c ON c.id=d.contact_id
            WHERE d.id=${String(existing.contact_business_link_decision_id)}::uuid
              AND d.contact_id=${Number(existing.contact_id)}
              AND d.business_id=${Number(intent.business_id)}
              AND d.decision='verified' AND d.revision=${Number(existing.contact_business_link_revision)}
              AND d.superseded_at IS NULL
              AND c.business_id=d.business_id
             FOR SHARE OF d
        `))[0]
      : null;
     let currentHoldReason = !commitmentCurrent
       ? "historical_recipient_commitment_no_longer_current"
       : !currentLink
         ? "historical_contact_business_link_no_longer_current"
         : !contactCurrent ? "historical_contact_identity_no_longer_current" : undefined;
    if (!currentHoldReason) {
      const currentGate = await checkCurrentSfpEligibilityAndPackage(tx, {
        eligibilityId: String(intent.eligibility_id),
        businessId: Number(intent.business_id),
        cohortRunId: String(intent.cohort_run_id),
        packageKey: String(intent.package_key ?? ""),
        packageVersionId: intent.package_version_id ? String(intent.package_version_id) : null,
        expectedSourceKind: intent.source_kind,
         emailTokenHash: String(masterLead?.email_token_hash ?? sourceAddressPins?.emailTokenHash ?? ""),
         emailAddress: masterLead?.email ? String(masterLead.email) : null,
         projectionWrite: true,
      });
      if (!currentGate.eligible) {
        currentHoldReason = currentGate.reason;
        await recordBridgeHold(tx, intent, `historical_replay_current_drift:${currentGate.reason}`);
       } else if (String(pinnedCommitment?.program_id ?? "") !== String(currentGate.row.program_id)) {
         currentHoldReason = "historical_recipient_commitment_program_changed";
         await recordBridgeHold(tx, intent, currentHoldReason);
       } else if (masterLead?.email) {
        const historicalEmail = String(masterLead.email).trim().toLowerCase();
        const historicalAddressHash = normalizedContactIdentityHash(
          historicalEmail,
          intent.normalized_value_hash_version,
        );
        if (!historicalAddressHash || historicalAddressHash !== String(intent.normalized_value_hash ?? "")
            || String(masterLead.email_token_hash ?? "") !== (hashEmailToken(historicalEmail) ?? "")
            || !(await currentTypedSourceAddressMatches(
              tx, intent, actorId, historicalEmail, String(intent.normalized_value_hash),
            ))) {
          currentHoldReason = "historical_source_address_changed";
          await recordBridgeHold(tx, intent, currentHoldReason);
        }
      }
    } else {
      await recordBridgeHold(tx, intent, currentHoldReason);
    }
      await assertSfpRuntimeJobLease(tx, jobLease);
      if (await lockCanonicalOutboundPause(tx) !== "paused") {
        currentHoldReason = "outbound_global_pause_changed";
        await recordBridgeHold(tx, intent, currentHoldReason);
      }
      if (!currentHoldReason && !(await isCurrentSfpValidationReceiptFresh(tx, {
        eligibilityId: String(intent.eligibility_id),
        businessId: Number(intent.business_id),
        emailTokenHash: String(masterLead?.email_token_hash ?? sourceAddressPins?.emailTokenHash ?? ""),
      }))) {
        currentHoldReason = "validation_receipt_expired_at_commit";
        await recordBridgeHold(tx, intent, currentHoldReason);
      }
     return {
      stagingIntentId, status: "already_bridged", contactId: Number(existing.contact_id),
      contactResolution: existing.contact_resolution, sequenceEnrollmentId: Number(existing.sequence_enrollment_id),
      enrollmentStatus: "paused", currentHoldReason,
    };
  }
  if (intent.state !== "ready_held") throw new Error(`SFP_STAGING_INTENT_NOT_READY_HELD:${intent.state}`);
  if (!intent.package_version_id) throw new Error("SFP_STAGING_INTENT_NO_PACKAGE_VERSION");

   let sequenceId = 0;
   let packageVersion: any = null;
   let cr06LifecycleDecision: ReturnType<typeof decideCr06SequenceLifecycle>;

  const business = rows(await tx.execute(sql`
    SELECT id, canonical_name, main_email, main_phone, vertical FROM businesses WHERE id=${Number(intent.business_id)}
  `))[0];
  if (!business) throw new Error("SFP_BUSINESS_NOT_FOUND");

  // A duplicate staging intent deliberately has no master-lead projection:
  // staging already found the same program/address claim. Revalidate the
  // source and reuse only the original accepted, still-current assignment.
  if (!intent.master_lead_id || !masterLead || !masterLead.email) {
    const sourcePins = sourceAddressPins;
    if (!sourcePins?.emailTokenHash || !sourcePins.recipientIdentityHash) {
      return hold("NO_PINNED_VALIDATED_EMAIL");
    }
    const duplicateGate = await checkCurrentSfpEligibilityAndPackage(tx, {
      eligibilityId: String(intent.eligibility_id),
      businessId: Number(intent.business_id),
      cohortRunId: String(intent.cohort_run_id),
      packageKey: String(intent.package_key ?? ""),
      packageVersionId: String(intent.package_version_id),
      expectedSourceKind: intent.source_kind,
      emailTokenHash: sourcePins.emailTokenHash,
      emailAddress: masterLead?.email ? String(masterLead.email) : null,
      projectionWrite: true,
    });
    if (!duplicateGate.eligible) return hold(duplicateGate.reason);
    sequenceId = Number(duplicateGate.package.sequence_id);
    const lockedSourcePins = await openTypedSourceAddressPins(tx, intent, actorId);
    if (!lockedSourcePins
        || lockedSourcePins.normalizedValueHash !== sourcePins.normalizedValueHash
        || lockedSourcePins.emailTokenHash !== sourcePins.emailTokenHash
        || lockedSourcePins.recipientIdentityHash !== sourcePins.recipientIdentityHash) {
      return hold("DUPLICATE_SOURCE_ADDRESS_CHANGED");
    }
    if (!intent.recipient_commitment_id) return hold("STAGING_RECIPIENT_COMMITMENT_MISSING");
    const commitment = rows(await tx.execute(sql`
      SELECT id,program_id,objective_key,recipient_identity_hash,recipient_identity_hash_version,
             business_id,package_version_id,staging_intent_id,state,contact_id,
             contact_business_link_decision_id
        FROM sfp_recipient_address_commitments
       WHERE id=${String(intent.recipient_commitment_id)}::uuid
       FOR UPDATE
    `))[0];
    if (!commitment
        || String(commitment.program_id) !== String(duplicateGate.row.program_id)
        || String(commitment.objective_key) !== SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY
        || String(commitment.recipient_identity_hash) !== sourcePins.recipientIdentityHash
        || Number(commitment.recipient_identity_hash_version) !== 1) {
      return hold("RECIPIENT_COMMITMENT_IDENTITY_MISMATCH");
    }
    let aliasDisposition: "reused" | "held" = "held";
    let aliasReason: string | null = null;
    let acceptedAssignment: any = null;
    if (Number(commitment.business_id) !== Number(business.id)
        || String(commitment.package_version_id) !== String(intent.package_version_id)) {
      aliasReason = "recipient_assignment_conflict";
    } else if (commitment.state !== "committed") {
      aliasReason = "recipient_assignment_not_yet_accepted";
    } else {
      acceptedAssignment = rows(await tx.execute(sql`
        SELECT c.contact_id,c.business_id,c.contact_business_link_decision_id,
               d.revision AS current_link_revision,d.decision AS current_link_decision,d.superseded_at,
               co.business_id AS contact_business_id,co.email_token_hash,co.archived_at,
               co.existing_merchant_customer,co.do_not_contact,co.do_not_auto_contact,
               co.opted_out_email,co.opt_out_status,co.unsubscribe_status,co.complaint_status,
               co.bounce_status,co.email_status,co.suppression_reason,
               l.contact_id AS ledger_contact_id,l.sequence_enrollment_id,l.contact_resolution,
               l.contact_business_link_decision_id AS ledger_link_id,
               l.contact_business_link_revision AS ledger_link_revision,se.status AS enrollment_status,
               se.sequence_id
          FROM sfp_recipient_address_commitments c
          JOIN contact_business_link_decisions d
            ON d.id=c.contact_business_link_decision_id AND d.contact_id=c.contact_id
          JOIN contacts co ON co.id=c.contact_id
          JOIN sfp_ready_held_enrollments l ON l.recipient_commitment_id=c.id
          JOIN sequence_enrollments se ON se.id=l.sequence_enrollment_id
         WHERE c.id=${String(commitment.id)}::uuid
          FOR UPDATE OF c,d,l,se
      `))[0];
      const assignmentCurrent = Boolean(acceptedAssignment
        && acceptedAssignment.current_link_decision === "verified"
        && !acceptedAssignment.superseded_at
        && Number(acceptedAssignment.business_id) === Number(business.id)
        && Number(acceptedAssignment.contact_business_id) === Number(business.id)
        && Number(acceptedAssignment.ledger_contact_id) === Number(acceptedAssignment.contact_id)
        && String(acceptedAssignment.ledger_link_id) === String(acceptedAssignment.contact_business_link_decision_id)
        && Number(acceptedAssignment.ledger_link_revision) === Number(acceptedAssignment.current_link_revision)
        && Number(acceptedAssignment.contact_id) === Number(commitment.contact_id)
        && String(acceptedAssignment.email_token_hash ?? "") === sourcePins.emailTokenHash
        && acceptedAssignment.archived_at == null
        && acceptedAssignment.existing_merchant_customer !== true
        && acceptedAssignment.do_not_contact !== true
        && acceptedAssignment.do_not_auto_contact !== true
        && acceptedAssignment.opted_out_email !== true
        && acceptedAssignment.opt_out_status !== "opted_out"
        && acceptedAssignment.unsubscribe_status !== "unsubscribed"
        && acceptedAssignment.complaint_status !== "reported"
        && acceptedAssignment.bounce_status !== "hard"
        && !["bounced", "invalid"].includes(String(acceptedAssignment.email_status ?? ""))
        && acceptedAssignment.suppression_reason == null
        && acceptedAssignment.enrollment_status === "paused"
        && Number(acceptedAssignment.sequence_id) === sequenceId);
      if (assignmentCurrent) aliasDisposition = "reused";
      else aliasReason = "accepted_assignment_no_longer_current";
    }
    await tx.execute(sql`
      INSERT INTO sfp_recipient_commitment_aliases
        (commitment_id,staging_intent_id,source_kind,source_reference_id,
         normalized_value_hash,normalized_value_hash_version,disposition,reason_code)
      VALUES (${String(commitment.id)}::uuid,${stagingIntentId}::uuid,${String(intent.source_kind)},
        ${sourceReference(intent)},${String(intent.normalized_value_hash)},
        ${Number(intent.normalized_value_hash_version)},${aliasDisposition},${aliasReason})
      ON CONFLICT DO NOTHING
    `);
    if (aliasDisposition !== "reused" || !acceptedAssignment) {
      return hold(aliasReason ?? "RECIPIENT_ACCEPTED_ASSIGNMENT_NOT_CURRENT");
    }
     await assertSfpRuntimeJobLease(tx, jobLease);
     if (await lockCanonicalOutboundPause(tx) !== "paused") {
       throw new SfpBridgeHoldError("OUTBOUND_GLOBAL_PAUSE_CHANGED");
     }
     if (!(await isCurrentSfpValidationReceiptFresh(tx, {
       eligibilityId: String(intent.eligibility_id),
       businessId: Number(intent.business_id),
       emailTokenHash: sourcePins.emailTokenHash,
     }))) {
       throw new SfpBridgeHoldError("VALIDATION_RECEIPT_EXPIRED_AT_COMMIT");
     }
    return {
      stagingIntentId, status: "already_bridged", contactId: Number(acceptedAssignment.contact_id),
      contactResolution: acceptedAssignment.contact_resolution ?? "matched_existing",
      sequenceEnrollmentId: Number(acceptedAssignment.sequence_enrollment_id),
      enrollmentStatus: "paused",
    };
  }
  const candidateEmail = String(masterLead.email).trim().toLowerCase();
  const candidateEmailHash = String(masterLead.email_token_hash ?? "");
  const candidatePhone = String(masterLead?.phone ?? business.main_phone ?? "").replace(/[^0-9]/g, "");
  const businessNameToken = normalizeCompanyToken(business.canonical_name);

  // No corroborated real-email identity at all -> leave held. We never
  // fabricate a synthetic-placeholder-email contact here; that would create
  // an unreviewable, effectively unreachable "contact" purely to satisfy the
  // NOT NULL constraint, which is exactly the silent-authority failure mode
  // this bridge exists to avoid.
  if (!candidateEmail || !candidateEmail.includes("@")) {
    return hold("NO_REAL_EMAIL_IDENTITY");
  }
  const expectedAddressHash = normalizedContactIdentityHash(candidateEmail, intent.normalized_value_hash_version);
  if (!expectedAddressHash || expectedAddressHash !== String(intent.normalized_value_hash ?? "")
      || candidateEmailHash !== (hashEmailToken(candidateEmail) ?? "")) {
    return hold("PINNED_SOURCE_ADDRESS_HASH_STALE");
  }
  const currentGate = await checkCurrentSfpEligibilityAndPackage(tx, {
    eligibilityId: String(intent.eligibility_id),
    businessId: Number(intent.business_id),
    cohortRunId: String(intent.cohort_run_id),
    packageKey: String(intent.package_key ?? ""),
    packageVersionId: String(intent.package_version_id),
    expectedSourceKind: intent.source_kind,
    emailTokenHash: candidateEmailHash,
    emailAddress: candidateEmail,
    projectionWrite: true,
  });
  if (!currentGate.eligible) return hold(currentGate.reason);
  sequenceId = Number(currentGate.package.sequence_id);
  packageVersion = currentGate.package;
  // Consult the canonical CR-06 lifecycle authority only after the shared
  // package gate has locked the exact sequence and its current content.
  cr06LifecycleDecision = decideCr06SequenceLifecycle(
    { triggerConfig: currentGate.package.sequence_trigger_config },
    "sequence_enrollment",
  );
  if (!(await currentTypedSourceAddressMatches(tx, intent, actorId, candidateEmail, expectedAddressHash))) {
    return hold("PINNED_SOURCE_CANDIDATE_ADDRESS_CHANGED");
  }
  if (currentGate.row.program_id == null) return hold("PROGRAM_MISSING_FOR_RECIPIENT_COMMITMENT");

  // Staging has already persisted the unique program/address claim before
  // projecting a master lead. The bridge only accepts that exact owner claim;
  // it never creates a late claim after downstream staging side effects.
  const recipientIdentityHash = sfpRecipientIdentityHash(candidateEmail);
  if (!recipientIdentityHash) return hold("RECIPIENT_ADDRESS_IDENTITY_INVALID");
  if (!intent.recipient_commitment_id) return hold("STAGING_RECIPIENT_COMMITMENT_MISSING");
  const recipientCommitmentId = String(intent.recipient_commitment_id);
  const claim = rows(await tx.execute(sql`
    SELECT id,program_id,objective_key,recipient_identity_hash,recipient_identity_hash_version,
           business_id,package_version_id,staging_intent_id,state
      FROM sfp_recipient_address_commitments
     WHERE id=${recipientCommitmentId}::uuid
     FOR UPDATE
  `))[0];
  const initialAlias = rows(await tx.execute(sql`
    SELECT id FROM sfp_recipient_commitment_aliases
     WHERE commitment_id=${recipientCommitmentId}::uuid
       AND staging_intent_id=${stagingIntentId}::uuid
       AND source_kind=${String(intent.source_kind)}
       AND source_reference_id=${sourceReference(intent)}
       AND normalized_value_hash=${String(intent.normalized_value_hash)}
       AND normalized_value_hash_version=${Number(intent.normalized_value_hash_version)}
       AND disposition='initial'
     LIMIT 1 FOR SHARE
  `))[0];
  if (!claim
      || String(claim.program_id) !== String(currentGate.row.program_id)
      || String(claim.objective_key) !== SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY
      || String(claim.recipient_identity_hash) !== recipientIdentityHash
      || Number(claim.recipient_identity_hash_version) !== 1
      || Number(claim.business_id) !== Number(business.id)
      || String(claim.package_version_id) !== String(intent.package_version_id)
      || String(claim.staging_intent_id) !== String(intent.id)
      || claim.state !== "claimed"
      || !initialAlias) {
    return hold("STAGING_RECIPIENT_COMMITMENT_NOT_OWNED_OR_CURRENT");
  }

    const matchCandidates = intent.contact_id
      ? rows(await tx.execute(sql`
           SELECT c.id, c.phone, c.company_name, c.email, c.email_token_hash,
                  c.business_id,d.id AS decision_id,d.business_id AS decision_business_id,
                  d.decision,d.revision,d.superseded_at
            FROM contacts c
            JOIN contact_business_link_decisions d ON d.contact_id=c.id
           WHERE c.id=${Number(intent.contact_id)}
             AND c.business_id=${Number(business.id)}
             AND c.archived_at IS NULL
             AND d.business_id=${Number(business.id)}
              AND d.id=${String(intent.contact_business_link_decision_id ?? "")}::uuid
              AND d.revision=${Number(intent.contact_business_link_revision)}
             AND d.decision='verified' AND d.superseded_at IS NULL
            LIMIT 1
             FOR SHARE OF d
        `))
      : rows(await tx.execute(sql`
      SELECT c.id,c.phone,c.company_name,c.email,c.email_token_hash,c.business_id,
             d.id AS decision_id,d.business_id AS decision_business_id,
             d.decision,d.revision,d.superseded_at
        FROM contacts c
        LEFT JOIN LATERAL (
          SELECT id,business_id,decision,revision,superseded_at
            FROM contact_business_link_decisions
           WHERE contact_id=c.id AND superseded_at IS NULL
           ORDER BY revision DESC LIMIT 1
        ) d ON TRUE
       WHERE lower(c.email)=${candidateEmail} AND c.archived_at IS NULL
       ORDER BY c.id ASC
    `));
    // The pinned contact is only selected from the exact business/contact/link
    // revision query above. Do not fall back to an email-only match for a
    // contact-source staging intent.
    const pinnedContact = intent.contact_id && matchCandidates.length === 1
      ? matchCandidates[0]
      : null;
    if (intent.contact_id) {
      const pinned = pinnedContact;
       const expectedHash = String(intent.normalized_value_hash ?? "");
       const expectedHashVersion = Number(intent.normalized_value_hash_version);
       const expectedDecisionId = String(intent.contact_business_link_decision_id ?? "");
       const expectedRevision = Number(intent.contact_business_link_revision);
      if (!pinned) {
        return hold("PINNED_SOURCE_CONTACT_LINK_REVOKED_OR_AMBIGUOUS");
      }
      const contactHash = String(pinned.email_token_hash ?? "");
       const versionedContactHash = normalizedContactIdentityHash(pinned.email, expectedHashVersion);
      if (!expectedDecisionId || String(pinned.decision_id) !== expectedDecisionId ||
          Number(pinned.revision) !== expectedRevision) {
        return hold("PINNED_SOURCE_CONTACT_LINK_REVISION_CHANGED");
      }
       if (!candidateEmailHash || candidateEmailHash !== contactHash ||
           contactHash !== (hashEmailToken(String(pinned.email ?? "")) ?? "") ||
           !versionedContactHash || versionedContactHash !== expectedHash) {
        return hold("PINNED_SOURCE_CONTACT_EMAIL_STALE");
      }
      await _testFaultInjector?.("after_source_contact_locked");
    }
    // Corroborate an email match with at least one more independent signal
    // (phone or company name) before trusting it as the same real-world
    // entity — a bare email match is not enough to silently attach an
    // unrelated contact record to this business/intent.
    const corroboratedCandidates = intent.contact_id
      ? matchCandidates
      : matchCandidates.filter((c: any) => {
          const phoneMatches = candidatePhone && String(c.phone ?? "").replace(/[^0-9]/g, "") === candidatePhone;
          const companyMatches = businessNameToken && normalizeCompanyToken(c.company_name) === businessNameToken;
          return phoneMatches || companyMatches;
        });
    if (!intent.contact_id && corroboratedCandidates.length > 1) {
      return hold("EMAIL_MATCH_MULTIPLE_CORROBORATED_CONTACTS");
    }
    const corroborated = corroboratedCandidates[0];

    if (!intent.contact_id && matchCandidates.length > 0 && !corroborated) {
      return hold("EMAIL_MATCH_UNCORROBORATED");
    }
    if (!intent.contact_id && corroborated
        && (corroborated.business_id != null || corroborated.decision_id != null)
        && !(Number(corroborated.business_id) === Number(business.id)
          && Number(corroborated.decision_business_id) === Number(business.id)
          && corroborated.decision === "verified" && !corroborated.superseded_at)) {
      return hold("EMAIL_MATCH_CURRENT_BUSINESS_LINK_CONFLICT");
    }

    let contactId: number | null = null;
    let contactResolution: "matched_existing" | "created_new" | null = null;

    if (pinnedContact) {
      contactId = Number(pinnedContact.id);
      contactResolution = "matched_existing";
    } else if (corroborated) {
      contactId = Number(corroborated.id);
      contactResolution = "matched_existing";
    } else if (!intent.contact_id) {
      // Early business-scoped gate avoids unnecessary contact writes. The
      // transaction below remains the real rollback boundary if a later
      // contact-level decision or enrollment/ledger insert rejects the work.
      const businessDecision = await evaluateBusinessPromotionEligibility(Number(business.id), tx);
      if (businessDecision.status === "blocked") {
        return hold(`PROMOTION_BLOCKED:${businessDecision.reasonCodes.join(",")}`);
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
            firstName, lastName, title: masterLead?.contact_title ?? null,
            email: candidateEmail, phone: candidatePhone || "",
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
        if (!phoneMatches && !companyMatches) throw new SfpBridgeHoldError("CONTACT_MATCH_UNCORROBORATED_AT_WRITE");
      }
      contactId = created.id;
      contactResolution = created._intakeOutcome === "created" ? "created_new" : "matched_existing";
    }
    if (contactId == null || contactResolution == null) {
      return hold(intent.contact_id ? "PINNED_SOURCE_CONTACT_LINK_REVOKED_OR_AMBIGUOUS" : "CONTACT_RESOLUTION_FAILED");
    }
    const resolvedContactId = contactId;
    const resolvedContactResolution = contactResolution;

    // Eligibility gate: promotion dimension covers DBPR lineage, existing-
    // customer status, and suppression — the same authority every other
    // enumerated consumer (enrollment included) must call. A blocked
    // dimension leaves the intent held rather than pausing an enrollment
    // for a contact this authority says is not eligible.
    const decisions = await evaluateContactDecisions({ contactId: resolvedContactId, businessId: Number(business.id) }, tx);
    if (decisions.promotion.status === "blocked") {
      // A newly created contact exists only in this transaction. Returning
      // would commit an orphan; throw to roll the canonical write back.
      if (resolvedContactResolution === "created_new") {
        throw new SfpBridgeHoldError(`PROMOTION_BLOCKED:${decisions.promotion.reasonCodes.join(",")}`);
      }
      return hold(`PROMOTION_BLOCKED:${decisions.promotion.reasonCodes.join(",")}`);
    }

    let linkDecision = intent.contact_id ? matchCandidates[0] : corroborated;
    if (!linkDecision || String(linkDecision.decision_id ?? "") === ""
        || Number(linkDecision.revision) <= 0
        || linkDecision.decision !== "verified"
        || Number(linkDecision.decision_business_id ?? linkDecision.business_id) !== Number(business.id)
        || linkDecision.superseded_at) {
      if (intent.contact_id) throw new SfpBridgeHoldError("PINNED_SOURCE_CONTACT_LINK_REVOKED_OR_AMBIGUOUS");
      try {
        linkDecision = await decideSfpContactBusinessLink({
          executor: tx,
          contactId: resolvedContactId,
          businessId: Number(business.id),
          eligibilityId: String(intent.eligibility_id),
          sourceKind: intent.source_kind,
          sourceReferenceId: sourceReference(intent),
          normalizedValueHash: String(intent.normalized_value_hash),
          normalizedValueHashVersion: Number(intent.normalized_value_hash_version),
          contactEmailTokenHash: candidateEmailHash,
          decisionKey: `sfp-typed-link-v1:${resolvedContactId}:${business.id}:${intent.eligibility_id}:${sourceReference(intent)}:${intent.normalized_value_hash}`,
          facts: {
            stagingIntentId,
            packageVersionId: String(intent.package_version_id),
          },
        });
      } catch (error: any) {
        const message = String(error?.message ?? "SFP_TYPED_LINK_WRITE_FAILED").split("\n")[0].slice(0, 400);
        if (message.startsWith("COMMERCIAL_") || message.startsWith("CRM_OBJECT_NOT_FOUND")) {
          throw new SfpBridgeHoldError(`TYPED_LINK_HOLD:${message}`);
        }
        throw error;
      }
    }
    const linkDecisionId = String(linkDecision.id ?? linkDecision.decision_id);
    const linkRevision = Number(linkDecision.revision);
    if (!linkDecisionId || !Number.isSafeInteger(linkRevision) || linkRevision < 1) {
      throw new SfpBridgeHoldError("CONTACT_BUSINESS_LINK_DECISION_INVALID");
    }
    const committedClaim = rows(await tx.execute(sql`
      UPDATE sfp_recipient_address_commitments
         SET contact_id=${resolvedContactId},
             contact_business_link_decision_id=${linkDecisionId}::uuid,
             state='committed',committed_at=now()
       WHERE id=${recipientCommitmentId}::uuid
         AND staging_intent_id=${stagingIntentId}::uuid
         AND state='claimed'
       RETURNING id
    `));
    if (committedClaim.length !== 1) throw new Error("SFP_RECIPIENT_COMMITMENT_COMMIT_FAILED");

    await _testFaultInjector?.("after_contact_before_enrollment");
    const result = await (async () => {
      const activeOrPaused = rows(await tx.execute(sql`
        SELECT id, status FROM sequence_enrollments
         WHERE contact_id=${resolvedContactId} AND sequence_id=${sequenceId} AND status IN ('active','paused')
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
           VALUES (${sequenceId}, ${resolvedContactId}, 0, 'paused', ${JSON.stringify({
             source: "sfp_ready_held_bridge", stagingIntentId, cr06LifecycleDecision,
           })}::jsonb)
          RETURNING id, status
        `))[0];
      }
      await _testFaultInjector?.("after_enrollment_before_ledger");
      const ledger = rows(await tx.execute(sql`
        INSERT INTO sfp_ready_held_enrollments
          (staging_intent_id, contact_id, sequence_enrollment_id, contact_resolution, actor_id,
           contact_business_link_decision_id,contact_business_link_revision,recipient_commitment_id)
         VALUES (${stagingIntentId}::uuid,${resolvedContactId},${Number(enrollmentRow.id)},
           ${resolvedContactResolution},${actorId},${linkDecisionId}::uuid,${linkRevision},
           ${recipientCommitmentId}::uuid)
        RETURNING id
      `));
      if (ledger.length !== 1) throw new Error("SFP_BRIDGE_LEDGER_INSERT_FAILED");
      return enrollmentRow;
    })();

    await assertSfpRuntimeJobLease(tx, jobLease);
    if (await lockCanonicalOutboundPause(tx) !== "paused") {
      throw new SfpBridgeHoldError("OUTBOUND_GLOBAL_PAUSE_CHANGED");
    }
    if (await isCanonicallySuppressed([candidateEmailHash], tx, [candidateEmail])) {
      throw new SfpBridgeHoldError("ADDRESS_SUPPRESSED_AT_COMMIT");
    }
    if (!(await isCurrentSfpValidationReceiptFresh(tx, {
      eligibilityId: String(intent.eligibility_id),
      businessId: Number(intent.business_id),
      emailTokenHash: candidateEmailHash,
    }))) {
      throw new SfpBridgeHoldError("VALIDATION_RECEIPT_EXPIRED_AT_COMMIT");
    }
    return {
      stagingIntentId, status: "created", contactId: resolvedContactId, contactResolution: resolvedContactResolution,
      sequenceEnrollmentId: Number(result.id), enrollmentStatus: String(result.status),
    };
    });
  } catch (error: any) {
    if (!(error instanceof SfpBridgeHoldError)) throw error;
    return db.transaction(async (tx) => {
      await assertSfpRuntimeJobLease(tx, jobLease);
      const intent = rows(await tx.execute(sql`
        SELECT id,eligibility_id FROM sfp_campaign_staging_intents
         WHERE id=${stagingIntentId}::uuid FOR UPDATE
      `))[0];
      if (!intent) throw new Error("SFP_STAGING_INTENT_NOT_FOUND");
      const successful = rows(await tx.execute(sql`
        SELECT l.contact_id,l.sequence_enrollment_id,l.contact_resolution,se.status
          FROM sfp_ready_held_enrollments l
          JOIN sequence_enrollments se ON se.id=l.sequence_enrollment_id
         WHERE l.staging_intent_id=${stagingIntentId}::uuid
      `))[0];
      if (successful) {
        if (successful.status !== "paused") throw new Error("SFP_BRIDGED_ENROLLMENT_NOT_PAUSED");
        await assertSfpRuntimeJobLease(tx, jobLease);
        return {
          stagingIntentId,status:"already_bridged",contactId:Number(successful.contact_id),
          contactResolution:successful.contact_resolution,
          sequenceEnrollmentId:Number(successful.sequence_enrollment_id),enrollmentStatus:"paused",
          currentHoldReason:error.holdCode,
        };
      }
      await recordBridgeHold(tx, intent, error.holdCode);
      await assertSfpRuntimeJobLease(tx, jobLease);
      return {
        stagingIntentId,status:"left_held",contactId:null,contactResolution:null,
        sequenceEnrollmentId:null,enrollmentStatus:null,heldReason:error.holdCode,
      };
    });
  }
}
