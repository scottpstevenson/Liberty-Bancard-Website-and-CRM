/**
 * MI-05: Candidate pre-projection filter — placeholder rejection.
 *
 * Enforces the split rule:
 *  - Always reject (synthetic/invalid): noreply@, bounce@, postmaster@, mailer-daemon@,
 *    donotreply@, test@, example@, and disposable domains.
 *  - Accept as org-level email (subject_type='business'): info@, support@, contact@,
 *    hello@, sales@, admin@, billing@ — valid organization inboxes.
 *  - Reject as person-level Apollo email (subject_type='person'): any role-based
 *    address — Apollo person reveals returning generic inboxes indicate a
 *    failed reveal, not a valid owner email.
 *
 * MI-06: selectEmailWinner() — full winner-selection algorithm.
 * Ranks staged candidates by tier, performs MX pre-filter, writes
 * cro03c_email_winner_selections and business_validation_intents atomically.
 */

import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { unseal, type CandidateEvidenceEnvelope } from "./candidate-evidence-service";

// ── Synthetic/invalid addresses — rejected for ALL subject types ───────────────

// Invalid technical addresses (not placeholders — these are real system roles
// that no real user owns). → "synthetic_address" rejection.
const SYNTHETIC_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "bounce", "mailer-daemon", "postmaster", "abuse",
]);

// Placeholder/dummy addresses (evidence of a test or template value —
// not an actual email for any business or person). → "placeholder" rejection.
const PLACEHOLDER_LOCAL_PARTS = new Set([
  "test", "example", "nobody", "null", "devnull", "spam", "fake", "dummy",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com",
  "throwam.com", "trashmail.com", "yopmail.com", "tempmail.com",
  "dispostable.com", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "guerrillamail.info", "spam4.me", "fakeinbox.com",
]);

// ── Role-based addresses — valid for businesses, NOT for person reveals ────────

const ROLE_LOCAL_PARTS = new Set([
  "info", "support", "contact", "hello", "sales", "admin",
  "billing", "help", "enquiries", "enquiry", "general",
  "office", "team", "care", "service", "services",
]);

// ── Free-mail domains — valid but deprioritized in tiebreakers ─────────────────

const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "live.com", "msn.com", "me.com", "mac.com",
  "yahoo.co.uk", "hotmail.co.uk", "btinternet.com",
]);

// ── Apollo owner-title ranking (lower = higher priority) ──────────────────────

const APOLLO_OWNER_TITLES = new Set(["owner", "president", "ceo", "founder"]);
const APOLLO_REVEAL_TITLE_RANK: Record<string, number> = {
  owner: 0, president: 1, ceo: 2, founder: 3,
};

// ── Public API ─────────────────────────────────────────────────────────────────

export type EmailRejectionReason =
  | "synthetic_address"
  | "placeholder"
  | "disposable_domain"
  | "role_address_rejected_for_person"
  | null;

/**
 * Returns null if the email passes, or a rejection reason string if it fails.
 * Call before writing candidate evidence or before projection.
 *
 * @param email      Normalized (lowercase, trimmed) email address.
 * @param subjectType 'business' or 'person' (Apollo reveal).
 */
export function rejectEmailCandidate(
  email: string,
  subjectType: "business" | "person",
): EmailRejectionReason {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx <= 0) return "synthetic_address";
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Always reject: placeholder/dummy local parts (test@, example@, nobody@, etc.).
  if (PLACEHOLDER_LOCAL_PARTS.has(local)) return "placeholder";

  // Always reject: synthetic/invalid local parts (noreply@, bounce@, postmaster@, etc.).
  if (SYNTHETIC_LOCAL_PARTS.has(local)) return "synthetic_address";

  // Always reject: disposable domains.
  if (DISPOSABLE_DOMAINS.has(domain)) return "disposable_domain";

  // Always reject: non-FQDN domains.
  if (!domain.includes(".")) return "synthetic_address";

  // Role-based split:
  if (ROLE_LOCAL_PARTS.has(local)) {
    // Accept for business-level candidates (valid org inbox).
    if (subjectType === "business") return null;
    // Reject for person-level reveals — indicates a failed Apollo reveal.
    return "role_address_rejected_for_person";
  }

  return null;
}

/**
 * Returns true if the email should be accepted for the given subject type.
 */
export function isEmailCandidateAccepted(
  email: string,
  subjectType: "business" | "person",
): boolean {
  return rejectEmailCandidate(email, subjectType) === null;
}

// ── MI-06: MX check ────────────────────────────────────────────────────────────

type MxCheckResult = "ok" | "no_mx" | "dns_indeterminate";

async function checkMxRecord(domain: string): Promise<MxCheckResult> {
  try {
    const timeout = new Promise<MxCheckResult>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000),
    );
    const lookup = dns.resolveMx(domain).then((records) =>
      records && records.length > 0 ? "ok" as const : "no_mx" as const,
    );
    return await Promise.race([lookup, timeout]);
  } catch (err: any) {
    // ENODATA / ENOTFOUND → authoritative no-MX (hard reject for this candidate).
    // ESERVFAIL → transient server-side failure; treat as indeterminate (retryable).
    // Timeout / other → indeterminate.
    const code = err?.code ?? "";
    if (code === "ENODATA" || code === "ENOTFOUND") {
      return "no_mx";
    }
    return "dns_indeterminate";
  }
}

// ── MI-06: Winner selection tier ranking ───────────────────────────────────────
// Lower tier value = higher priority.
function candidateTier(row: {
  subject_type: string;
  stage_key: string;
  apollo_match_confidence: string | null;
  candidate_metadata: Record<string, unknown> | null;
}): number {
  const { subject_type, stage_key, apollo_match_confidence, candidate_metadata } = row;
  if (subject_type === "person" && apollo_match_confidence === "high") {
    const ownerTitle = (candidate_metadata?.ownerTitle as string | undefined)?.toLowerCase() ?? "";
    if (APOLLO_OWNER_TITLES.has(ownerTitle) || ownerTitle in APOLLO_REVEAL_TITLE_RANK) {
      // Tier 1: Apollo person, high confidence, owner/president/ceo/founder title
      if (APOLLO_OWNER_TITLES.has(ownerTitle)) return 1;
      // Tier 2: Apollo person, high confidence, other title
      return 2;
    }
    // Any other title — Tier 2
    return 2;
  }
  // Tier 3: Serper/Outscraper org email
  if (subject_type === "business" && (stage_key.includes("serper") || stage_key.includes("outscraper"))) {
    return 3;
  }
  // Tier 4: JSON-LD subject_type='business' from free enrichment
  if (subject_type === "business" && stage_key.includes("jsonld")) return 4;
  // Tier 5: RDAP subject_type='business'
  if (subject_type === "business" && stage_key.includes("rdap")) return 5;
  // All others: deprioritized
  return 10;
}

function isFreemail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return FREEMAIL_DOMAINS.has(domain);
}

export interface SelectEmailWinnerResult {
  outcome: "selected" | "no_valid_candidate";
  winnerSelectionId?: string;
  businessValidationIntentId?: string;
  emailDiscoveryStatus: string;
}

/**
 * MI-06 Step 4: Select the best email candidate for a business and write
 * the immutable winner record. Transaction-safe, concurrency-safe, idempotent.
 *
 * @param businessId   The canonical businesses.id.
 * @param generationId The CRO-03C generation scoping the candidate evidence.
 * @returns Selection outcome and the written record IDs.
 */
export async function selectEmailWinner(
  businessId: number,
  generationId: string,
): Promise<SelectEmailWinnerResult> {
  const rows = (result: any): any[] => result?.rows ?? result ?? [];

  return await db.transaction(async (tx) => {
    // Step 1: Lock the businesses row (prevents concurrent winner writes).
    const bizLock = rows(await tx.execute(sql`
      SELECT id, email_discovery_status, email_selected_candidate_hash
        FROM businesses WHERE id = ${businessId} FOR UPDATE
    `))[0];
    if (!bizLock) throw new Error("MI06_BUSINESS_NOT_FOUND");

    // Step 1b: Verify generation belongs to this business.
    // Joining through cro03c_generations → cro03a_handoffs → canonical_source_links
    // gives us the authoritative business_id for this generation's observation.
    // This prevents cross-business misassociation even when called via the admin route.
    const genBizLink = rows(await tx.execute(sql`
      SELECT csl.business_id
        FROM cro03c_generations g
        JOIN cro03a_handoffs h ON h.id = g.handoff_id
        JOIN canonical_source_links csl
          ON csl.source_system = h.source_system
         AND csl.source_type   = h.source_type
         AND csl.stable_key    = h.source_key
       WHERE g.id = ${generationId}::uuid
       LIMIT 1
    `))[0];
    if (!genBizLink || Number(genBizLink.business_id) !== businessId) {
      throw new Error("MI06_GENERATION_BUSINESS_MISMATCH");
    }

    // Step 2: Idempotency check — has this generation already produced a winner?
    const existingSelection = rows(await tx.execute(sql`
      SELECT id, normalized_value_hash, state
        FROM cro03c_email_winner_selections
       WHERE business_id = ${businessId} AND generation_id = ${generationId}::uuid
       FOR UPDATE
    `))[0];
    if (existingSelection) {
      // Idempotent: return existing result.
      const intentRow = rows(await tx.execute(sql`
        SELECT id FROM business_validation_intents
         WHERE winner_selection_id = ${String(existingSelection.id)}::uuid
         LIMIT 1
      `))[0];
      return {
        outcome: "selected",
        winnerSelectionId: String(existingSelection.id),
        businessValidationIntentId: intentRow ? String(intentRow.id) : undefined,
        emailDiscoveryStatus: String(bizLock.email_discovery_status ?? "discovered"),
      };
    }

    // Step 3: Load and lock staged AND quarantined candidates for this business.
    // 'staged' = high-confidence candidates eligible for auto-selection.
    // 'quarantined' = medium-confidence Apollo reveals; selectable as winner but
    //   require operator approval before ZeroBounce proceeds.
    const candidateRows = rows(await tx.execute(sql`
      SELECT c.id, c.stage_key, c.field, c.subject_type, c.disposition,
             c.confidence, c.source_rank, c.normalized_value_hash, c.masked_value,
             c.apollo_match_confidence, c.candidate_metadata,
             c.envelope_ciphertext, c.envelope_nonce, c.envelope_tag, c.envelope_key_version
        FROM cro03c_candidate_evidence c
       WHERE c.generation_id = ${generationId}::uuid
         AND c.field = 'email'
         AND c.disposition IN ('staged', 'quarantined')
         AND c.business_id = ${businessId}
       ORDER BY c.source_rank ASC, c.confidence DESC
       FOR UPDATE OF c
    `));

    if (candidateRows.length === 0) {
      // No staged candidates — clear main_email and mark no valid candidate.
      // Kill line: a previously validated email must not remain after all candidates
      // are gone (e.g. evidence purged, generation reset).
      await tx.execute(sql`
        UPDATE businesses
           SET email_discovery_status = 'no_valid_candidate',
               main_email = NULL,
               updated_at = NOW()
         WHERE id = ${businessId}
      `);
      return { outcome: "no_valid_candidate", emailDiscoveryStatus: "no_valid_candidate" };
    }

    // Step 4: Apply pre-filter and MX check to each candidate.
    type ScoredCandidate = {
      id: string;
      stageKey: string;
      subjectType: "business" | "person";
      apolloMatchConfidence: string | null;
      candidateMetadata: Record<string, unknown> | null;
      normalizedValueHash: string;
      email: string;
      tier: number;
      freemail: boolean;
      mxResult: MxCheckResult;
    };

    const scored: ScoredCandidate[] = [];
    let hasDnsIndeterminate = false;
    // Track specific rejection reasons so we can persist a meaningful status when all candidates fail.
    const rejectionReasons: Array<"syntax_invalid" | "placeholder" | "disposable" | "no_mx" | "other"> = [];

    for (const row of candidateRows) {
      const subjectType = String(row.subject_type) as "business" | "person";
      let email: string;
      try {
        email = unseal("email", {
          ciphertext: String(row.envelope_ciphertext),
          nonce: String(row.envelope_nonce),
          tag: String(row.envelope_tag),
          keyVersion: Number(row.envelope_key_version),
        } as CandidateEvidenceEnvelope);
      } catch {
        // Decryption failure — skip this candidate (treat as rejected).
        continue;
      }

      // Syntactic pre-filter — track specific rejection reason.
      const rejectReason = rejectEmailCandidate(email, subjectType);
      if (rejectReason !== null) {
        rejectionReasons.push(
          rejectReason === "disposable_domain" ? "disposable"
          : rejectReason === "placeholder" ? "placeholder"
          : rejectReason === "role_address_rejected_for_person" ? "syntax_invalid"
          : "syntax_invalid", // synthetic_address → syntax_invalid
        );
        continue;
      }

      // MX check (3s timeout).
      const domain = email.split("@")[1]?.toLowerCase() ?? "";
      const mxResult = await checkMxRecord(domain);
      if (mxResult === "no_mx") {
        rejectionReasons.push("no_mx");
        continue; // Hard reject for this candidate.
      }
      if (mxResult === "dns_indeterminate") {
        hasDnsIndeterminate = true;
        // Keep as indeterminate — do not filter out permanently.
        continue;
      }

      const candidateMetadata = row.candidate_metadata
        ? (typeof row.candidate_metadata === "object" ? row.candidate_metadata : JSON.parse(String(row.candidate_metadata))) as Record<string, unknown>
        : null;

      scored.push({
        id: String(row.id),
        stageKey: String(row.stage_key),
        subjectType,
        apolloMatchConfidence: row.apollo_match_confidence ? String(row.apollo_match_confidence) : null,
        candidateMetadata,
        normalizedValueHash: String(row.normalized_value_hash),
        email,
        tier: candidateTier({
          subject_type: String(row.subject_type),
          stage_key: String(row.stage_key),
          apollo_match_confidence: row.apollo_match_confidence ? String(row.apollo_match_confidence) : null,
          candidate_metadata: candidateMetadata,
        }),
        freemail: isFreemail(email),
        mxResult,
      });
    }

    // If no valid candidate (all failed pre-filter):
    if (scored.length === 0) {
      if (hasDnsIndeterminate) {
        // At least one candidate hit a transient DNS failure — leave staged for retry
        // and record dns_indeterminate so the dispatcher can schedule a retry.
        // Clear main_email: the transient DNS failure means we cannot confirm the
        // current winner's validity — downstream must not use a potentially stale address.
        await tx.execute(sql`
          UPDATE businesses
             SET email_discovery_status = 'dns_indeterminate',
                 main_email = NULL,
                 updated_at = NOW()
           WHERE id = ${businessId}
        `);
        return { outcome: "no_valid_candidate", emailDiscoveryStatus: "dns_indeterminate" };
      }
      // All candidates failed authoritative checks (no_mx, syntax, disposable, etc.).
      // Mark them as 'rejected' so dispatchPendingWinnerSelections() does not
      // re-process them on every tick (only 'staged' and 'quarantined' are retryable).
      if (candidateRows.length > 0) {
        const rejectedIds = candidateRows.map((r: any) => String(r.id));
        await tx.execute(sql`
          UPDATE cro03c_candidate_evidence
             SET disposition = 'rejected'
           WHERE id = ANY(${rejectedIds}::uuid[])
             AND disposition IN ('staged', 'quarantined')
        `);
      }
      // Persist the most specific status when all rejections share the same cause.
      const uniqueReasons = new Set(rejectionReasons);
      const specificStatus: string =
        uniqueReasons.size === 1 && rejectionReasons[0] === "no_mx" ? "no_mx"
        : uniqueReasons.size === 1 && rejectionReasons[0] === "syntax_invalid" ? "syntax_invalid"
        : uniqueReasons.size === 1 && rejectionReasons[0] === "disposable" ? "disposable"
        : uniqueReasons.size === 1 && rejectionReasons[0] === "placeholder" ? "placeholder"
        : "no_valid_candidate";
      // Clear main_email: all candidates failed authoritative checks — any previously
      // validated address is now invalid and must not be used for outreach.
      await tx.execute(sql`
        UPDATE businesses
           SET email_discovery_status = ${specificStatus},
               main_email = NULL,
               updated_at = NOW()
         WHERE id = ${businessId}
      `);
      return { outcome: "no_valid_candidate", emailDiscoveryStatus: specificStatus };
    }

    // Step 5: Rank candidates — lower tier first; tiebreak by freemail penalization.
    scored.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Tiebreak: non-freemail preferred.
      if (a.freemail !== b.freemail) return a.freemail ? 1 : -1;
      return 0;
    });

    const winner = scored[0];
    const losers = scored.slice(1);

    // Apollo medium-confidence: special handling.
    // A quarantined (medium-confidence) candidate can be selected as winner,
    // but requires operator approval before ZeroBounce proceeds.
    const isMediumConfidence =
      winner.subjectType === "person" && winner.apolloMatchConfidence === "medium";

    // Low/none confidence Apollo (quarantined or staged): no winner.
    // Clear main_email: low/none-confidence Apollo evidence is not sufficient to
    // authorize outreach — clear any previously validated address.
    if (
      winner.subjectType === "person" &&
      (winner.apolloMatchConfidence === "low" || winner.apolloMatchConfidence === "none")
    ) {
      await tx.execute(sql`
        UPDATE businesses
           SET email_discovery_status = 'no_valid_candidate',
               main_email = NULL,
               updated_at = NOW()
         WHERE id = ${businessId}
      `);
      return { outcome: "no_valid_candidate", emailDiscoveryStatus: "no_valid_candidate" };
    }

    // Step 6a: Supersede any existing winner selections from prior generations.
    // Ensures the authority chain always reflects the latest generation.
    const priorSelectionIds = rows(await tx.execute(sql`
      UPDATE cro03c_email_winner_selections
         SET state = 'superseded'
       WHERE business_id = ${businessId}
         AND generation_id != ${generationId}::uuid
         AND state = 'selected'
       RETURNING id
    `)).map((r: any) => String(r.id));

    // Supersede any pending/claimed intents bound to the prior selections.
    if (priorSelectionIds.length > 0) {
      // Supersede ALL non-revoked intents from prior selections — including
      // terminal states (completed, failed) — so the same email hash can be
      // re-selected and revalidated in a new generation (e.g. stale revalidation).
      await tx.execute(sql`
        UPDATE business_validation_intents
           SET state = 'superseded', updated_at = NOW()
         WHERE winner_selection_id = ANY(${priorSelectionIds}::uuid[])
           AND state != 'revoked'
      `);
    }

    // Step 6b: Write cro03c_email_winner_selections row (immutable).
    const selectionRows = rows(await tx.execute(sql`
      INSERT INTO cro03c_email_winner_selections
        (business_id, generation_id, candidate_evidence_id, policy_version,
         source, subject_type, confidence, normalized_value_hash, state)
      VALUES
        (${businessId}, ${generationId}::uuid, ${winner.id}::uuid, 1,
         ${winner.stageKey}, ${winner.subjectType}, ${winner.tier * -10 + 100},
         ${winner.normalizedValueHash}, 'selected')
      ON CONFLICT (business_id, generation_id) DO NOTHING
      RETURNING id
    `));

    let selectionId: string;
    if (selectionRows.length > 0) {
      selectionId = String(selectionRows[0].id);
    } else {
      // Concurrent insert won — fetch the existing row.
      const existing2 = rows(await tx.execute(sql`
        SELECT id FROM cro03c_email_winner_selections
         WHERE business_id = ${businessId} AND generation_id = ${generationId}::uuid
      `))[0];
      selectionId = String(existing2?.id ?? "");
    }

    // Step 7: Update dispositions.
    // Winner → 'accepted'; all other staged candidates for this business → 'superseded'.
    await tx.execute(sql`
      UPDATE cro03c_candidate_evidence
         SET disposition = 'accepted'
       WHERE id = ${winner.id}::uuid
    `);
    if (losers.length > 0) {
      const loserIds = losers.map((l) => l.id);
      await tx.execute(sql`
        UPDATE cro03c_candidate_evidence
           SET disposition = 'superseded'
         WHERE id = ANY(${loserIds}::uuid[])
      `);
    }

    // Step 8: Write businesses.email_discovery_status and email_selected_candidate_hash.
    // Clear any prior catch-all approval — the approval is bound to the winning candidate hash.
    // If a new generation selects a different candidate, the old approval is invalid.
    // Clear catch-all approval when winner candidate hash changes.
    // Approval is bound to the specific winning candidate, not the business.
    // If a new generation selects a different hash, the old approval is invalid.
    // When winner hash changes: clear main_email (now refers to an old candidate),
    // clear catch-all approval (bound to the old candidate hash), and reset discovery
    // status to 'discovered' so the new candidate goes through ZeroBounce again.
    // Kill line: businesses.mainEmail ONLY written after provider_valid ZeroBounce result.
    await tx.execute(sql`
      UPDATE businesses
         SET email_discovery_status = 'discovered',
             email_selected_candidate_hash = ${winner.normalizedValueHash},
             main_email = NULL,
             email_outreach_catch_all_approved_at = NULL,
             email_outreach_approved_by = NULL,
             email_outreach_approved_candidate_hash = NULL,
             updated_at = NOW()
       WHERE id = ${businessId}
         AND (email_selected_candidate_hash IS NULL
              OR email_selected_candidate_hash != ${winner.normalizedValueHash})
    `);
    // If hash is already the same (idempotent re-run), only update status if the current
    // status is not a terminal validated state. Do NOT overwrite provider_valid/provider_invalid/
    // provider_catch_all — the previously completed ZeroBounce result is still authoritative.
    // This prevents same-hash reselection from causing an unvalidated status while main_email
    // is still set, which would allow SDR outreach to a "discovered" (unvalidated) address.
    await tx.execute(sql`
      UPDATE businesses
         SET email_discovery_status = 'discovered',
             updated_at = NOW()
       WHERE id = ${businessId}
         AND email_selected_candidate_hash = ${winner.normalizedValueHash}
         AND email_discovery_status NOT IN (
           'provider_valid', 'provider_invalid', 'provider_catch_all',
           'provider_unknown', 'provider_spamtrap', 'provider_bounce',
           'stale', 'bounced', 'suppressed'
         )
    `);

    // Step 9: Write business_validation_intents row.
    // Medium-confidence: approval_required=TRUE (operator must approve before claim).
    const intentRows = rows(await tx.execute(sql`
      INSERT INTO business_validation_intents
        (business_id, winner_selection_id, candidate_evidence_id,
         normalized_email_token_hash, purpose, state, approval_required,
         apollo_match_confidence)
      VALUES
        (${businessId}, ${selectionId}::uuid, ${winner.id}::uuid,
         ${winner.normalizedValueHash}, 'cro03c_business_email', 'pending',
         ${isMediumConfidence},
         ${winner.apolloMatchConfidence ?? null})
      ON CONFLICT (business_id, normalized_email_token_hash, purpose)
        WHERE state NOT IN ('superseded','revoked','completed','failed')
      DO NOTHING
      RETURNING id
    `));

    let intentId: string | undefined;
    if (intentRows.length > 0) {
      intentId = String(intentRows[0].id);
    } else {
      const existing3 = rows(await tx.execute(sql`
        SELECT id FROM business_validation_intents
         WHERE business_id = ${businessId}
           AND normalized_email_token_hash = ${winner.normalizedValueHash}
           AND purpose = 'cro03c_business_email'
           AND state NOT IN ('superseded','revoked','completed','failed')
         LIMIT 1
      `))[0];
      intentId = existing3 ? String(existing3.id) : undefined;
    }

    return {
      outcome: "selected",
      winnerSelectionId: selectionId,
      businessValidationIntentId: intentId,
      emailDiscoveryStatus: "discovered",
    };
  });
}
