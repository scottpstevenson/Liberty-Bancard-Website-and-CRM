/**
 * Read-only preview for historical prospect→contact conversion linkage gaps
 * (task #1956, Step 3).
 *
 * Some prospects predate the atomic claim-based conversion path in
 * prospect-conversion.ts (and the legacy sunbiz-cron.ts call sites this task
 * just hardened — see finalizeLegacyProspectContactLink). Those rows can be
 * left with contact_id NULL even though a contact for the same person
 * already exists, or with a leftover conversion_contact_id from a crashed
 * mid-conversion attempt that never got promoted to contact_id.
 *
 * This module NEVER writes. It only classifies each unlinked-but-suspect
 * prospect into:
 *   - a "deterministic" proposal, when durable evidence (a leftover claim
 *     field, or an exact case-insensitive email match to exactly one
 *     non-archived contact) proves a single correct contactId, or
 *   - "legacy_divergence" (ambiguous / no evidence), which must NOT be
 *     auto-relinked and is only reported for human review.
 *
 * No production backfill/relink is authorized to run from this module during
 * BUILD — it is a preview only. An operator-triggered apply step (writing
 * through finalizeLegacyProspectContactLink) is future post-publish work.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export type RelinkEvidence = "leftover_claim_contact_id" | "exact_email_match";

export interface DeterministicRelinkProposal {
  prospectId: number;
  proposedContactId: number;
  evidence: RelinkEvidence;
}

export interface LegacyDivergenceRow {
  prospectId: number;
  reason: "ambiguous_multiple_email_matches" | "no_evidence" | "leftover_claim_contact_missing";
}

export interface ProspectConversionRelinkPreview {
  scannedCount: number;
  deterministic: DeterministicRelinkProposal[];
  legacyDivergence: LegacyDivergenceRow[];
}

/**
 * Scans unconverted/unlinked prospects and classifies each one. Read-only —
 * safe to call repeatedly; deterministic and idempotent against unchanged
 * data (same input rows always produce the same classification).
 */
export async function previewProspectConversionRelinks(limit = 5000): Promise<ProspectConversionRelinkPreview> {
  const candidateRows = (await db.execute(sql`
    SELECT p.id, p.conversion_contact_id, p.email, p.owner_email
    FROM prospects p
    WHERE p.contact_id IS NULL
      AND (
        p.conversion_contact_id IS NOT NULL
        OR p.status = 'converted'
        OR COALESCE(p.email, p.owner_email) IS NOT NULL
      )
    ORDER BY p.id ASC
    LIMIT ${limit}
  `)).rows as any[];

  const deterministic: DeterministicRelinkProposal[] = [];
  const legacyDivergence: LegacyDivergenceRow[] = [];

  for (const row of candidateRows) {
    const prospectId = Number(row.id);
    const leftoverContactId = row.conversion_contact_id != null ? Number(row.conversion_contact_id) : null;

    // Strongest evidence: a durable leftover from a crashed mid-conversion
    // attempt (persistConversionContactId succeeded, completeConversionTransaction
    // never did). If the referenced contact still exists, it is provably correct.
    if (leftoverContactId != null) {
      const contactRows = (await db.execute(sql`
        SELECT id FROM contacts WHERE id = ${leftoverContactId} AND archived_at IS NULL
      `)).rows as any[];
      if (contactRows.length === 1) {
        deterministic.push({ prospectId, proposedContactId: leftoverContactId, evidence: "leftover_claim_contact_id" });
      } else {
        legacyDivergence.push({ prospectId, reason: "leftover_claim_contact_missing" });
      }
      continue;
    }

    const email = (row.email || row.owner_email || "").trim().toLowerCase();
    if (!email) {
      legacyDivergence.push({ prospectId, reason: "no_evidence" });
      continue;
    }

    const matchRows = (await db.execute(sql`
      SELECT id FROM contacts WHERE lower(email) = ${email} AND archived_at IS NULL
    `)).rows as any[];

    if (matchRows.length === 1) {
      deterministic.push({ prospectId, proposedContactId: Number(matchRows[0].id), evidence: "exact_email_match" });
    } else if (matchRows.length > 1) {
      legacyDivergence.push({ prospectId, reason: "ambiguous_multiple_email_matches" });
    } else {
      legacyDivergence.push({ prospectId, reason: "no_evidence" });
    }
  }

  return { scannedCount: candidateRows.length, deterministic, legacyDivergence };
}
