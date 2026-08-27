/**
 * prospect-conversion.ts
 *
 * Atomic claim-based conversion service for prospects.
 *
 * Kill-line invariants:
 *  - prospects.status is NEVER used as an infrastructure lock.
 *  - The DB transaction for deal + prospect linkage is NEVER held open during GHL calls.
 *  - A stale claim (> 5 min old) is reclaimed by a new request — no permanent stuck state.
 *  - Retry after partial contact creation reuses conversionContactId on the claim.
 *  - Enrollment failure never rolls back or blocks conversion completion.
 *  - persistConversionContactId and completeConversionTransaction both THROW if 0 rows
 *    were affected, meaning the claim was lost/expired between steps (ClaimLostError).
 *    Callers must treat ClaimLostError as a 409 and never return "converted" status.
 */

import { db } from "../db";
import { prospects, contacts } from "@shared/schema";
import { isNull, and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getOrCreateConversionSalesDeal } from "../storage/deals";
import { writeContact } from "./contact-writer";

// ---------------------------------------------------------------------------
// ClaimLostError — thrown when a conditional UPDATE affected 0 rows
// ---------------------------------------------------------------------------

export class ClaimLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimLostError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimAcquiredResult = {
  acquired: true;
  claimId: string;
  existingContactId: number | null;
};

export type ClaimDeniedResult = {
  acquired: false;
  reason: "already_converted" | "conversion_in_progress";
  contactId?: number;
};

export type AcquireClaimResult = ClaimAcquiredResult | ClaimDeniedResult;

export type DurableConversionResult =
  | { status: "converted"; contactId: number; dealId: number; claimId: string }
  | { status: "already_converted"; contactId?: number }
  | { status: "conversion_in_progress"; contactId?: number }
  | { status: "conflict_incompatible_identity"; claimId: string }
  | { status: "failed"; claimId: string; reasonCode: "contact_creation_failed" | "conversion_failed" };

/**
 * Execute the durable, local conversion path for one prospect. This service
 * deliberately owns every mutation that must be idempotent across retries;
 * route handlers own authorization, readiness policy, and post-commit work.
 * writeContact is local-first and only records durable projection work—this
 * function performs no provider I/O.
 */
export async function convertProspectDurably(
  prospect: {
    id: number;
    contactId: number | null;
    email: string | null;
    ownerEmail: string | null;
    ownerFirstName: string | null;
    ownerLastName: string | null;
    companyName: string | null;
    phone: string | null;
    ownerPhone: string | null;
    vertical: string | null;
    estimatedVolume: string | null;
    estimatedProcessor: string | null;
  },
  actorUserId?: string | null,
): Promise<DurableConversionResult> {
  if (prospect.contactId) return { status: "already_converted", contactId: prospect.contactId };

  const claimResult = await acquireConversionClaim(prospect.id, randomUUID());
  if (!claimResult.acquired) {
    return {
      status: claimResult.reason === "already_converted" ? "already_converted" : "conversion_in_progress",
      contactId: claimResult.contactId,
    };
  }

  const { claimId, existingContactId } = claimResult;
  try {
    let contactId = existingContactId;
    if (!contactId) {
      const email = prospect.email || prospect.ownerEmail || "";
      try {
        const contact = await writeContact({
          mode: "local_first",
          mutation: {
            firstName: prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Unknown",
            lastName: prospect.ownerLastName || "",
            email,
            phone: prospect.phone || prospect.ownerPhone || "",
            companyName: prospect.companyName || "",
            vertical: prospect.vertical || "",
            status: "new",
            notes: "Source: prospect_conversion",
            monthlyVolume: prospect.estimatedVolume || "",
            currentProvider: prospect.estimatedProcessor || "",
          },
          provenance: {
            sourceCategory: "prospect_conversion",
            sourceType: "csv_prospect",
            eventKey: `prospect-convert-${prospect.id}-${claimId}`,
            actorType: "dashboard",
            actorId: actorUserId ?? undefined,
          },
          actor: { actorType: "dashboard", userId: actorUserId ?? null },
        });
        contactId = contact.id;
      } catch (err: any) {
        if (err?.code === "23505" || err?.message?.includes("23505") || err?.message?.includes("unique")) {
          const resolution = await resolveConflictingContact(email, prospect.companyName, prospect.phone || prospect.ownerPhone);
          if (!resolution.resolved) {
            await releaseClaimWithError(prospect.id, claimId, "conflict_incompatible_identity");
            return { status: "conflict_incompatible_identity", claimId };
          }
          contactId = resolution.contactId;
        } else {
          await releaseClaimWithError(prospect.id, claimId, "contact_creation_failed");
          return { status: "failed", claimId, reasonCode: "contact_creation_failed" };
        }
      }
      await persistConversionContactId(prospect.id, claimId, contactId);
    }

    const { dealId } = await completeConversionTransaction(
      prospect.id, claimId, contactId, prospect.estimatedVolume, actorUserId,
    );
    return { status: "converted", contactId, dealId, claimId };
  } catch (err) {
    await releaseClaimWithError(prospect.id, claimId, err instanceof ClaimLostError ? "claim_lost" : "conversion_failed").catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// acquireConversionClaim
// ---------------------------------------------------------------------------

/**
 * Atomically acquire a conversion claim on a prospect.
 *
 * Uses a single conditional UPDATE that only succeeds when:
 *   - contact_id IS NULL (not yet converted)
 *   - AND (conversion_claim_id IS NULL OR conversion_claimed_at < NOW() - 5 minutes)
 *
 * On zero rows updated: reads current state to distinguish "already_converted"
 * from "conversion_in_progress".
 *
 * On success: returns claimId and existingContactId (non-null if a prior
 * attempt created a contact but crashed before completing the transaction).
 */
export async function acquireConversionClaim(
  prospectId: number,
  requestId: string,
): Promise<AcquireClaimResult> {
  const claimId = randomUUID();

  const result = await db.execute(sql`
    UPDATE prospects
    SET
      conversion_claim_id = ${claimId},
      conversion_claimed_at = NOW(),
      conversion_claim_owner_id = ${requestId}
    WHERE
      id = ${prospectId}
      AND contact_id IS NULL
      AND (
        conversion_claim_id IS NULL
        OR conversion_claimed_at < NOW() - INTERVAL '5 minutes'
      )
    RETURNING id, conversion_contact_id
  `);

  if (result.rows.length > 0) {
    const row = result.rows[0] as { id: number; conversion_contact_id: number | null };
    return {
      acquired: true,
      claimId,
      existingContactId: row.conversion_contact_id ?? null,
    };
  }

  // Zero rows: determine why
  const [current] = await db
    .select({
      id: prospects.id,
      contactId: prospects.contactId,
      conversionClaimId: prospects.conversionClaimId,
      conversionClaimedAt: prospects.conversionClaimedAt,
    })
    .from(prospects)
    .where(eq(prospects.id, prospectId))
    .limit(1);

  if (!current) {
    return { acquired: false, reason: "conversion_in_progress" };
  }

  if (current.contactId) {
    return { acquired: false, reason: "already_converted", contactId: current.contactId };
  }

  return { acquired: false, reason: "conversion_in_progress" };
}

// ---------------------------------------------------------------------------
// persistConversionContactId
// ---------------------------------------------------------------------------

/**
 * Persist the contactId on the claim row immediately after contact creation.
 * This lets a crash-recovery retry reuse the existing contact instead of creating a duplicate.
 *
 * STRICT: throws ClaimLostError if zero rows were updated, meaning the claim
 * was reclaimed or expired between acquireConversionClaim and this call.
 * Callers must handle ClaimLostError and return a 409 — NEVER return "converted".
 */
export async function persistConversionContactId(
  prospectId: number,
  claimId: string,
  contactId: number,
): Promise<void> {
  const result = await db.execute(sql`
    UPDATE prospects
    SET conversion_contact_id = ${contactId}
    WHERE id = ${prospectId} AND conversion_claim_id = ${claimId}
    RETURNING id
  `);

  if (result.rows.length === 0) {
    throw new ClaimLostError(
      `[ClaimLost] persistConversionContactId: claim ${claimId} on prospect ${prospectId} was lost before contactId could be persisted`,
    );
  }
}

// ---------------------------------------------------------------------------
// completeConversionTransaction
// ---------------------------------------------------------------------------

export interface CompleteConversionResult {
  dealId: number;
}

/**
 * Finalize the conversion in a single DB transaction (no GHL calls inside).
 *
 * Steps:
 *   A) Find or create the deal (idempotent by contactId + pipeline + stage).
 *   B) Update prospect: set contact_id, clear all claim columns, set status = 'converted'.
 *      Conditional on claim ownership (conversion_claim_id = claimId).
 *
 * STRICT: throws ClaimLostError if the prospect UPDATE affected 0 rows, meaning
 * the claim expired and was reclaimed between contact creation and this transaction.
 * Callers must handle ClaimLostError and return a 409 — NEVER return "converted".
 * The deal that was created is reported in ClaimLostError.dealId for recovery.
 *
 * Route-owned effects run only after this durable transaction commits.
 */
export async function completeConversionTransaction(
  prospectId: number,
  claimId: string,
  contactId: number,
  estimatedVolume: string | null | undefined,
  actorUserId?: string | null,
): Promise<CompleteConversionResult> {
  return await db.transaction(async (tx) => {
     // A) Transaction-only authority locks the canonical contact, then either
     // reuses a qualifying production sales lead or creates and audits one.
     // It deliberately performs no provider or queue work.
     const { deal } = await getOrCreateConversionSalesDeal(tx, {
       contactId,
       estimatedVolume,
       auditCtx: {
         userId: actorUserId ?? null,
         actorType: "user",
         actorId: actorUserId ?? null,
       },
     });
     const dealId = deal.id;

    // B) Atomically finalize prospect — conditional on claim ownership, RETURNING id to verify
    const finalizeResult = await tx.execute(sql`
      UPDATE prospects
      SET
        contact_id = ${contactId},
        conversion_claim_id = NULL,
        conversion_claimed_at = NULL,
        conversion_claim_owner_id = NULL,
        conversion_contact_id = NULL,
        conversion_last_error = NULL,
        status = 'converted',
        updated_at = NOW()
      WHERE id = ${prospectId} AND conversion_claim_id = ${claimId}
      RETURNING id
    `);

    if (finalizeResult.rows.length === 0) {
      // Claim was lost between deal creation and finalization. The transaction
      // rolls back both a newly-created deal/audit and the failed finalization.
      const err = new ClaimLostError(
        "Conversion claim was lost before finalization",
      );
      (err as any).dealId = dealId;
      throw err;
    }

    return { dealId };
  });
}

// ---------------------------------------------------------------------------
// releaseClaimWithError
// ---------------------------------------------------------------------------

/**
 * Release the claim after a non-recoverable error so the prospect is not stuck.
 * Writes the error message to conversion_last_error for observability.
 * Only releases if the caller still owns the claim.
 * Never throws (best-effort release on error paths).
 */
export async function releaseClaimWithError(
  prospectId: number,
  claimId: string,
  errorMessage: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE prospects
    SET
      conversion_claim_id = NULL,
      conversion_claimed_at = NULL,
      conversion_claim_owner_id = NULL,
      conversion_last_error = ${errorMessage.slice(0, 500)},
      updated_at = NOW()
    WHERE id = ${prospectId} AND conversion_claim_id = ${claimId}
  `);
}

// ---------------------------------------------------------------------------
// resolveConflictingContact — duplicate-email reconciliation
// ---------------------------------------------------------------------------

export interface ConflictResolution {
  resolved: true;
  contactId: number;
}

export interface ConflictIncompatible {
  resolved: false;
  reason: "conflict_incompatible_identity";
  existingContactId: number;
  existingCompanyName: string | null;
  existingPhone: string | null;
}

export type DuplicateEmailResolution = ConflictResolution | ConflictIncompatible;

/**
 * When writeContact throws a 23505 unique-email constraint violation, attempt
 * to reconcile by finding the existing contact and checking identity compatibility.
 *
 * Compatible: companyName and phone both match (or are both empty on one side).
 * Incompatible: both fields conflict with non-null values → return typed conflict.
 */
export async function resolveConflictingContact(
  email: string,
  incomingCompanyName: string | null | undefined,
  incomingPhone: string | null | undefined,
): Promise<DuplicateEmailResolution> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.email, normalized), isNull(contacts.archivedAt)))
    .limit(1);

  if (!existing) {
    return {
      resolved: false,
      reason: "conflict_incompatible_identity",
      existingContactId: -1,
      existingCompanyName: null,
      existingPhone: null,
    };
  }

  const normalizeStr = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

  const incomingCo = normalizeStr(incomingCompanyName);
  const existingCo = normalizeStr(existing.companyName);

  const incomingPh = (incomingPhone ?? "").replace(/\D/g, "").slice(-10);
  const existingPh = (existing.phone ?? "").replace(/\D/g, "").slice(-10);

  const coMatches = !incomingCo || !existingCo || incomingCo === existingCo;
  const phMatches = !incomingPh || !existingPh || incomingPh === existingPh;

  if (coMatches && phMatches) {
    return { resolved: true, contactId: existing.id };
  }

  return {
    resolved: false,
    reason: "conflict_incompatible_identity",
    existingContactId: existing.id,
    existingCompanyName: existing.companyName ?? null,
    existingPhone: existing.phone ?? null,
  };
}
