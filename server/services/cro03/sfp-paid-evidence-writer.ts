/**
 * sfp-paid-evidence-writer.ts
 *
 * Task #1999 (C3): the ONLY writer of server/schema `sfp_paid_candidate_evidence`
 * rows. Paid-provider (Outscraper/Apollo/paid-Serper) candidate values must never
 * be written into `free_discovery_candidates` (free-only) or
 * `cro03c_candidate_evidence` (whose `generation_id` FK is NOT NULL and must not
 * be weakened or fabricated for SFP — see shared/schema.ts and the Task #1999
 * architecture notes). This module reuses the SAME AES-256-GCM envelope
 * seal()/unseal() helpers already used by free-discovery and CRO-03C candidate
 * evidence, so encrypted-at-rest candidate values follow one consistent pattern
 * across the codebase rather than a second bespoke encryption scheme.
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { seal, unseal } from "./candidate-evidence-service";
import { candidateTier, rejectEmailCandidate } from "./candidate-selector";
import { maskCandidate } from "./contracts";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export type SfpPaidProviderName = "outscraper" | "apollo" | "serper";

export interface WriteSfpPaidCandidateEvidenceInput {
  businessId: number;
  provider: SfpPaidProviderName;
  field: string; // 'email' | 'phone' | ...
  value: string; // plaintext candidate value — never persisted or logged raw
  subjectType: "business" | "person";
  providerOperationId?: string | null;
  /** 0-100 integer scale, matching free_discovery_candidates.confidence and every existing live-provider-executors confidence literal (e.g. 70, 85) — NOT a 0-1 fraction. */
  confidence?: number;
  personNameEvidence?: string | null;
  personTitleEvidence?: string | null;
  candidateMetadata?: Record<string, unknown> | null;
}

/**
 * Idempotent on (provider, business_id, field, normalized_value_hash) — a
 * repeat write of the exact same candidate value from the same provider for
 * the same business/field is a no-op (returns the existing row), matching the
 * same idempotency discipline free_discovery_candidates already uses.
 */
export async function writeSfpPaidCandidateEvidence(
  input: WriteSfpPaidCandidateEvidenceInput,
  executor: { execute: (query: any) => Promise<any> } = db,
): Promise<{ id: string; wasNew: boolean }> {
  const { ciphertext, nonce, tag, normalizedValueHash, maskedValue } = seal(input.field, input.value);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence ?? 0)));
  const inserted = rows(await executor.execute(sql`
    INSERT INTO sfp_paid_candidate_evidence
      (business_id, provider, field, subject_type, provider_operation_id, disposition,
       confidence, envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, person_name_evidence, person_title_evidence,
       candidate_metadata)
    VALUES
      (${input.businessId}, ${input.provider}, ${input.field}, ${input.subjectType},
       ${input.providerOperationId ?? null}::uuid, 'staged',
       ${confidence}, ${ciphertext}, ${nonce}, ${tag}, 1,
       ${normalizedValueHash}, ${maskedValue}, ${input.personNameEvidence ?? null},
       ${input.personTitleEvidence ?? null},
       ${input.candidateMetadata ? JSON.stringify(input.candidateMetadata) : null}::jsonb)
     ON CONFLICT (provider, business_id, field, normalized_value_hash) DO NOTHING
    RETURNING id, (xmax = 0) AS was_inserted
  `));
  if (inserted.length > 0) {
    const row = inserted[0];
    const wasNew = row.was_inserted === true || row.was_inserted === "true" || row.was_inserted === "t";
    return { id: String(row.id), wasNew };
  }
  const existing = rows(await executor.execute(sql`
    SELECT id FROM sfp_paid_candidate_evidence
     WHERE provider = ${input.provider} AND business_id = ${input.businessId}
       AND field = ${input.field} AND normalized_value_hash = ${normalizedValueHash}
  `));
  return { id: String(existing[0]?.id ?? ""), wasNew: false };
}

export interface SfpPaidCandidateEvidenceView {
  id: string;
  businessId: number;
  provider: SfpPaidProviderName;
  field: string;
  subjectType: string;
  disposition: string;
  confidence: number;
  maskedValue: string;
  personNameEvidence: string | null;
  personTitleEvidence: string | null;
  createdAt: string;
}

/** Masked, non-secret read projection — never exposes plaintext or the envelope. */
export async function listSfpPaidCandidateEvidence(businessIds: number[]): Promise<SfpPaidCandidateEvidenceView[]> {
  if (businessIds.length === 0) return [];
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const result = rows(await db.execute(sql`
    SELECT id, business_id, provider, field, subject_type, disposition, confidence,
           masked_value, person_name_evidence, person_title_evidence, created_at
      FROM sfp_paid_candidate_evidence
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
       AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                        WHERE q.business_id=sfp_paid_candidate_evidence.business_id AND q.cleared_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM sfp_discredited_paid_evidence d
                        WHERE d.evidence_id=sfp_paid_candidate_evidence.id)
     ORDER BY created_at DESC
  `));
  return result.map((r: any) => ({
    id: String(r.id),
    businessId: Number(r.business_id),
    provider: r.provider,
    field: r.field,
    subjectType: r.subject_type,
    disposition: r.disposition,
    confidence: Number(r.confidence),
    maskedValue: r.masked_value,
    personNameEvidence: r.person_name_evidence ?? null,
    personTitleEvidence: r.person_title_evidence ?? null,
    createdAt: String(r.created_at),
  }));
}

/**
 * Unified free+paid candidate read contract for Task #2000 (C3). Reads across
 * BOTH free_discovery_candidates and sfp_paid_candidate_evidence WITHOUT
 * merging their schemas — each source keeps its own physical row and lineage;
 * this function returns a typed source kind ('free'|'paid') and a stable
 * evidence id (the row id in whichever physical table produced it) so a
 * consumer can always trace back to the exact source row.
 */
export interface UnifiedSfpCandidateView {
  sourceKind: "free" | "paid" | "contact";
  evidenceId: string;
  businessId: number;
  field: string;
  provider: string | null; // null for free-lane candidates without a paid provider
  maskedValue: string;
  confidence: number;
  disposition: string;
  personNameEvidence: string | null;
  personTitleEvidence: string | null;
  createdAt: string;
  /** Conservative effective type shared across equal business/address
   *  observations. Any person observation makes every row person-classified. */
  subjectType: string;
  /** Original source-row classification; subjectType is the restrictive
   * cross-observation policy classification used by validation. */
  sourceSubjectType: string;
  /**
   * Cross-source dedupe (C3/proof matrix "cross-source email-hash dedupe"):
   * both free_discovery_candidates and sfp_paid_candidate_evidence hash
   * normalized values the same way (see seal() in candidate-evidence-service.ts),
   * so equal hashes for the same business+field ARE the same underlying value
   * observed by two sources. Both rows are always kept (never discarded) —
   * this collapses only in the sense of pointing every non-canonical
   * duplicate at the one canonical evidenceId a consumer should act on,
   * while every row's own sourceKind/evidenceId/provider stays intact for
   * lineage and subject attribution. The raw hash itself is never returned.
   */
  duplicateOfEvidenceId: string | null;
  normalizedValueHash: string | null;
  normalizedValueHashVersion: number | null;
  contactBusinessLinkDecisionId: string | null;
  contactBusinessLinkRevision: number | null;
  candidateReference: SfpCandidateReference;
}

/** Preserve source rows while applying the strictest person classification to
 * every observation of an identical business/address. */
export function propagateRestrictiveSfpSubjectType<
  T extends { _hashKey: string; subjectType: string },
>(entries: T[]): Array<T & { sourceSubjectType: string }> {
  const personKeys = new Set(entries.filter((entry) => entry.subjectType === "person").map((entry) => entry._hashKey));
  return entries.map((entry) => ({
    ...entry,
    sourceSubjectType: String(entry.subjectType ?? "business"),
    subjectType: personKeys.has(entry._hashKey) ? "person" : entry.subjectType,
  }));
}

export type SfpCandidateReference =
  | { sourceKind: "free"; freeDiscoveryCandidateId: string; normalizedValueHash?: string; normalizedValueHashVersion?: number }
  | { sourceKind: "paid"; paidCandidateEvidenceId: string; normalizedValueHash?: string; normalizedValueHashVersion?: number }
  | {
      sourceKind: "contact";
      contactId: string;
      contactBusinessLinkDecisionId?: string;
      contactBusinessLinkRevision?: number;
      normalizedValueHash?: string;
      normalizedValueHashVersion?: number;
    };

export interface ResolvedSfpCandidateReference {
  sourceKind: "free" | "paid" | "contact";
  evidenceId: string;
  businessId: number;
  field: string;
  provider: string | null;
  subjectType: string;
  maskedValue: string;
  confidence: number;
  disposition: string;
  createdAt: string;
  normalizedValueHash: string | null;
  normalizedValueHashVersion: number | null;
  contactBusinessLinkDecisionId: string | null;
  contactBusinessLinkRevision: number | null;
}

/** Read-only lineage resolver for the Task #2000 handoff; no eligibility writes. */
export async function resolveSfpCandidateReference(
  reference: SfpCandidateReference,
): Promise<ResolvedSfpCandidateReference | null> {
  if (reference.sourceKind === "free") {
    const row = rows(await db.execute(sql`
      SELECT id,business_id,field,source,subject_type,masked_value,confidence,disposition,normalized_value_hash,created_at
        FROM free_discovery_candidates WHERE id=${reference.freeDiscoveryCandidateId}::uuid
          AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                           WHERE q.business_id=free_discovery_candidates.business_id AND q.cleared_at IS NULL)
      LIMIT 1
    `))[0];
    if (row && ((reference.normalizedValueHash && String(row.normalized_value_hash) !== reference.normalizedValueHash)
        || (reference.normalizedValueHashVersion !== undefined && reference.normalizedValueHashVersion !== 1))) return null;
    return row ? {
      sourceKind: "free", evidenceId: String(row.id), businessId: Number(row.business_id),
       field: String(row.field), provider: String(row.source ?? "free"), subjectType: String(row.subject_type ?? "business"),
      maskedValue: String(row.masked_value), confidence: Number(row.confidence), disposition: String(row.disposition),
      createdAt: String(row.created_at),
       normalizedValueHash: String(row.normalized_value_hash), normalizedValueHashVersion: 1,
      contactBusinessLinkDecisionId: null, contactBusinessLinkRevision: null,
    } : null;
  }
  if (reference.sourceKind === "paid") {
    const row = rows(await db.execute(sql`
      SELECT id,business_id,provider,field,subject_type,masked_value,confidence,disposition,normalized_value_hash,created_at
        FROM sfp_paid_candidate_evidence
       WHERE id=${reference.paidCandidateEvidenceId}::uuid
         AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                          WHERE q.business_id=sfp_paid_candidate_evidence.business_id AND q.cleared_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM sfp_discredited_paid_evidence d
                          WHERE d.evidence_id=sfp_paid_candidate_evidence.id) LIMIT 1
    `))[0];
    if (row && ((reference.normalizedValueHash && String(row.normalized_value_hash) !== reference.normalizedValueHash)
        || (reference.normalizedValueHashVersion !== undefined && reference.normalizedValueHashVersion !== 1))) return null;
    return row ? {
      sourceKind: "paid", evidenceId: String(row.id), businessId: Number(row.business_id),
      field: String(row.field), provider: String(row.provider), subjectType: String(row.subject_type),
      maskedValue: String(row.masked_value), confidence: Number(row.confidence), disposition: String(row.disposition),
      createdAt: String(row.created_at),
       normalizedValueHash: String(row.normalized_value_hash), normalizedValueHashVersion: 1,
      contactBusinessLinkDecisionId: null, contactBusinessLinkRevision: null,
    } : null;
  }
  const row = rows(await db.execute(sql`
    SELECT c.id,c.business_id,c.email,c.email_status,c.created_at,
           d.id AS link_decision_id,d.revision
      FROM contacts c
      JOIN businesses b ON b.id = c.business_id AND b.record_class = 'canonical'
      JOIN contact_business_link_decisions d
        ON d.contact_id=c.id AND d.business_id=c.business_id
       AND d.decision='verified' AND d.superseded_at IS NULL
     WHERE c.id=${reference.contactId}::int
       AND c.archived_at IS NULL
       AND c.record_class NOT IN ('test','demo','synthetic')
       AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
       AND COALESCE(c.do_not_contact,FALSE)=FALSE
       AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
       AND COALESCE(c.opted_out_email,FALSE)=FALSE
       AND c.opt_out_status IS DISTINCT FROM 'opted_out'
       AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
       AND c.complaint_status IS DISTINCT FROM 'reported'
       AND c.bounce_status IS DISTINCT FROM 'hard'
       AND c.email_status NOT IN ('bounced','invalid')
       AND c.suppression_reason IS NULL
       AND c.email IS NOT NULL AND BTRIM(c.email) <> ''
       AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                        WHERE q.business_id=c.business_id AND q.cleared_at IS NULL)
          LIMIT 1
          FOR SHARE OF c,b,d
  `))[0];
  if (row && (
    (reference.contactBusinessLinkDecisionId && String(row.link_decision_id) !== reference.contactBusinessLinkDecisionId)
    || (reference.contactBusinessLinkRevision !== undefined && Number(row.revision) !== reference.contactBusinessLinkRevision)
    || (reference.normalizedValueHash && emailNormalizedValueHash(String(row.email)) !== reference.normalizedValueHash)
    || (reference.normalizedValueHashVersion !== undefined && reference.normalizedValueHashVersion !== 1)
  )) return null;
  return row ? {
    sourceKind: "contact", evidenceId: String(row.id), businessId: Number(row.business_id),
    field: "email", provider: null, subjectType: "person",
    maskedValue: maskCandidate("email", String(row.email)), confidence: 60,
    disposition: row.email_status === "valid" ? "validation_admitted" : "staged",
    createdAt: String(row.created_at),
    normalizedValueHash: emailNormalizedValueHash(String(row.email)),
    normalizedValueHashVersion: 1,
    contactBusinessLinkDecisionId: String(row.link_decision_id),
    contactBusinessLinkRevision: Number(row.revision),
  } : null;
}

function emailNormalizedValueHash(value: string): string {
  return createHash("sha256").update(`email\u0000${value.trim().toLowerCase()}`).digest("hex");
}

/**
 * Task #2000: the ONE audited, source-aware plaintext-open boundary for SFP
 * candidates. Validates business/field/disposition/duplicate/frozen-membership
 * before ever touching ciphertext, exposes the decrypted value only inside
 * `use()` (never returned or persisted), and writes one audit_logs row
 * naming actor/purpose/source-kind/evidence-id. No consumer of this
 * function ever sees plaintext outside its own callback's stack frame.
 */
export interface OpenSfpCandidatePlaintextInput {
  reference: SfpCandidateReference;
  cohortRunId: string;
  actorId: string;
  purpose: string;
}

export interface SfpExecutor {
  execute: (query: any) => Promise<any>;
}

/**
 * PM-03 corrective note (Task #2001 post-merge audit): this function's `use`
 * callback is the ONLY place plaintext may exist. Every consumer MUST do all
 * of its plaintext-dependent work (hashing, precheck, transport calls,
 * writes) *inside* `use()` and resolve it to a sanitized value (a hash, an
 * id, a boolean outcome) — never `return plaintext` or an object containing
 * it. `resolveSfpCandidateReference` and this function's own bookkeeping
 * (membership check, envelope read, audit insert) now accept an `executor`
 * so a caller can bind them to its own transaction — needed so a
 * transaction-bound consumer (e.g. campaign staging) can write its
 * plaintext-derived row inside the *same* transaction as its evidence read,
 * rather than observing a different DB snapshot through the global `db`
 * handle.
 */
export async function openSfpCandidatePlaintext<T>(
  input: OpenSfpCandidatePlaintextInput,
  use: (plaintext: string, resolved: ResolvedSfpCandidateReference) => Promise<T>,
  executor: SfpExecutor = db,
): Promise<T> {
  // Resolve via the executor-bound query directly (rather than delegating to
  // resolveSfpCandidateReference(), which always uses the global `db`) so a
  // transaction-bound caller reads the SAME snapshot it will write into.
  const resolvedRow = input.reference.sourceKind === "free"
    ? (await rows(await executor.execute(sql`
        SELECT id,business_id,field,source,subject_type,masked_value,confidence,disposition,normalized_value_hash,created_at
          FROM free_discovery_candidates WHERE id=${input.reference.freeDiscoveryCandidateId}::uuid LIMIT 1
      `)))[0]
    : input.reference.sourceKind === "paid"
    ? (await rows(await executor.execute(sql`
        SELECT id,business_id,provider,field,subject_type,masked_value,confidence,disposition,normalized_value_hash,created_at
          FROM sfp_paid_candidate_evidence WHERE id=${input.reference.paidCandidateEvidenceId}::uuid LIMIT 1
      `)))[0]
    : (await rows(await executor.execute(sql`
        SELECT c.id,c.business_id,c.email,c.email_status,c.created_at,
               d.id AS link_decision_id,d.revision
          FROM contacts c
          JOIN businesses b ON b.id=c.business_id AND b.record_class='canonical'
          JOIN contact_business_link_decisions d
            ON d.contact_id=c.id AND d.business_id=c.business_id
           AND d.decision='verified' AND d.superseded_at IS NULL
         WHERE c.id=${input.reference.contactId}::int
           AND c.archived_at IS NULL
           AND c.record_class NOT IN ('test','demo','synthetic')
           AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
           AND COALESCE(c.do_not_contact,FALSE)=FALSE
           AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
           AND COALESCE(c.opted_out_email,FALSE)=FALSE
           AND c.opt_out_status IS DISTINCT FROM 'opted_out'
           AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
           AND c.complaint_status IS DISTINCT FROM 'reported'
           AND c.bounce_status IS DISTINCT FROM 'hard'
           AND c.email_status NOT IN ('bounced','invalid')
           AND c.suppression_reason IS NULL
           AND c.email IS NOT NULL AND BTRIM(c.email) <> ''
           AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                            WHERE q.business_id=c.business_id AND q.cleared_at IS NULL)
          LIMIT 1
          FOR SHARE OF c,b,d
      `)))[0];
  const resolvedRef: ResolvedSfpCandidateReference | null = !resolvedRow ? null : input.reference.sourceKind === "free"
    ? {
        sourceKind: "free", evidenceId: String(resolvedRow.id), businessId: Number(resolvedRow.business_id),
        field: String(resolvedRow.field), provider: String(resolvedRow.source ?? "free"), subjectType: String(resolvedRow.subject_type ?? "business"),
        maskedValue: String(resolvedRow.masked_value), confidence: Number(resolvedRow.confidence), disposition: String(resolvedRow.disposition),
        createdAt: String(resolvedRow.created_at),
        normalizedValueHash: String(resolvedRow.normalized_value_hash),
        normalizedValueHashVersion: 1,
        contactBusinessLinkDecisionId: null,
        contactBusinessLinkRevision: null,
      }
    : input.reference.sourceKind === "paid"
    ? {
        sourceKind: "paid", evidenceId: String(resolvedRow.id), businessId: Number(resolvedRow.business_id),
        field: String(resolvedRow.field), provider: String(resolvedRow.provider), subjectType: String(resolvedRow.subject_type),
        maskedValue: String(resolvedRow.masked_value), confidence: Number(resolvedRow.confidence), disposition: String(resolvedRow.disposition),
        createdAt: String(resolvedRow.created_at),
        normalizedValueHash: String(resolvedRow.normalized_value_hash),
        normalizedValueHashVersion: 1,
        contactBusinessLinkDecisionId: null,
        contactBusinessLinkRevision: null,
      }
    : {
        sourceKind: "contact", evidenceId: String(resolvedRow.id), businessId: Number(resolvedRow.business_id),
        field: "email", provider: null, subjectType: "person",
        maskedValue: maskCandidate("email", String(resolvedRow.email)),
        confidence: 60, disposition: resolvedRow.email_status === "valid" ? "validation_admitted" : "staged",
        createdAt: String(resolvedRow.created_at),
         normalizedValueHash: emailNormalizedValueHash(String(resolvedRow.email)),
         normalizedValueHashVersion: 1,
         contactBusinessLinkDecisionId: String(resolvedRow.link_decision_id),
         contactBusinessLinkRevision: Number(resolvedRow.revision),
      };
  if (!resolvedRef) throw new Error("SFP_CANDIDATE_REFERENCE_NOT_FOUND");
  const resolved = resolvedRef;
  const sourceReference = input.reference;
  if ((sourceReference.normalizedValueHash
        && sourceReference.normalizedValueHash !== resolved.normalizedValueHash)
      || (sourceReference.normalizedValueHashVersion !== undefined
        && sourceReference.normalizedValueHashVersion !== resolved.normalizedValueHashVersion)
      || (sourceReference.sourceKind === "contact"
        && ((sourceReference.contactBusinessLinkDecisionId
              && sourceReference.contactBusinessLinkDecisionId !== resolved.contactBusinessLinkDecisionId)
          || (sourceReference.contactBusinessLinkRevision !== undefined
              && sourceReference.contactBusinessLinkRevision !== resolved.contactBusinessLinkRevision)))) {
    throw new Error(sourceReference.sourceKind === "contact" ? "SFP_CONTACT_SOURCE_PIN_STALE" : "SFP_CANDIDATE_SOURCE_PIN_STALE");
  }
  if (rows(await executor.execute(sql`
    SELECT 1 FROM sfp_identity_quarantines
     WHERE business_id=${resolved.businessId} AND cleared_at IS NULL LIMIT 1
  `))[0]) throw new Error("SFP_CANDIDATE_IDENTITY_QUARANTINED");
  if (resolved.sourceKind === "paid" && rows(await executor.execute(sql`
    SELECT 1 FROM sfp_discredited_paid_evidence
     WHERE evidence_id=${resolved.evidenceId}::uuid LIMIT 1
  `))[0]) throw new Error("SFP_CANDIDATE_EVIDENCE_DISCREDITED");
  if (resolved.disposition === "suppressed" || resolved.disposition === "rejected") {
    throw new Error(`SFP_CANDIDATE_NOT_OPENABLE:disposition=${resolved.disposition}`);
  }
  // Frozen-cohort membership: the candidate's business must actually be a
  // member of the cohort run this decision belongs to.
  const memberRow = rows(await executor.execute(sql`
    SELECT 1 FROM sfp_cohort_members WHERE cohort_run_id=${input.cohortRunId}::uuid AND business_id=${resolved.businessId} LIMIT 1
  `))[0];
  if (!memberRow) throw new Error("SFP_CANDIDATE_BUSINESS_NOT_IN_COHORT");

  const envelopeRow = resolved.sourceKind === "contact" ? null : resolved.sourceKind === "free"
    ? rows(await executor.execute(sql`
        SELECT envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version
          FROM free_discovery_candidates WHERE id=${resolved.evidenceId}::uuid LIMIT 1
      `))[0]
    : rows(await executor.execute(sql`
        SELECT envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version
          FROM sfp_paid_candidate_evidence WHERE id=${resolved.evidenceId}::uuid LIMIT 1
      `))[0];
  if (resolved.sourceKind !== "contact" && !envelopeRow) throw new Error("SFP_CANDIDATE_ENVELOPE_NOT_FOUND");

  const plaintext = resolved.sourceKind === "contact"
    ? String(resolvedRow.email)
    : unseal("email", {
        ciphertext: String(envelopeRow!.envelope_ciphertext),
        nonce: String(envelopeRow!.envelope_nonce),
        tag: String(envelopeRow!.envelope_tag),
        keyVersion: Number(envelopeRow!.envelope_key_version ?? 1),
      });

  await executor.execute(sql`
    INSERT INTO audit_logs (action, entity_type, entity_key, actor_type, actor_id, details)
    VALUES ('sfp_candidate_plaintext_opened', 'sfp_candidate_evidence', ${resolved.evidenceId}, 'user', ${input.actorId},
            ${JSON.stringify({ sourceKind: resolved.sourceKind, evidenceId: resolved.evidenceId, businessId: resolved.businessId, purpose: input.purpose, cohortRunId: input.cohortRunId })}::jsonb)
  `);

  const result = await use(plaintext, resolved);

  // Structural guard: the callback must never hand the decrypted plaintext
  // (or a value that trivially contains it) back across this boundary. A
  // callback that does `async (plaintext) => plaintext` — or builds an
  // object/array with the plaintext embedded in it — is caught here and
  // fails loudly instead of silently letting the address escape into the
  // caller's own scope, where it could be used for spend-incurring work
  // (MX/ZeroBounce/etc.) outside this function's audit log.
  assertNoPlaintextEscape(result, plaintext);
  return result;
}

/**
 * Recursively scans a `use()` return value for the exact decrypted
 * plaintext string (case-insensitively, since email comparisons elsewhere
 * in this codebase are lowercase-normalized). Bounded depth/breadth so a
 * malicious/huge return value cannot be used to stall this check.
 */
function assertNoPlaintextEscape(value: unknown, plaintext: string, depth = 0): void {
  if (depth > 4 || value == null) return;
  const needle = plaintext.trim().toLowerCase();
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === needle || (needle.length > 3 && value.toLowerCase().includes(needle))) {
      throw new Error("SFP_PLAINTEXT_ESCAPE_BLOCKED: openSfpCandidatePlaintext's use() callback returned the decrypted plaintext (or a value containing it) across the audited boundary");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) assertNoPlaintextEscape(item, plaintext, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>).slice(0, 50)) assertNoPlaintextEscape(v, plaintext, depth + 1);
  }
}

export async function getUnifiedSfpCandidates(businessIds: number[]): Promise<UnifiedSfpCandidateView[]> {
  if (businessIds.length === 0) return [];
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const freeRows = rows(await db.execute(sql`
     SELECT id, business_id, field, source, subject_type,
            disposition, confidence, masked_value, normalized_value_hash, created_at
      FROM free_discovery_candidates
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
       AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                        WHERE q.business_id=free_discovery_candidates.business_id AND q.cleared_at IS NULL)
  `));
  const paidRows = rows(await db.execute(sql`
     SELECT id, business_id, provider, field, subject_type, disposition, confidence, candidate_metadata,
           masked_value, normalized_value_hash, person_name_evidence, person_title_evidence, created_at
      FROM sfp_paid_candidate_evidence
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
       AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                        WHERE q.business_id=sfp_paid_candidate_evidence.business_id AND q.cleared_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM sfp_discredited_paid_evidence d
                        WHERE d.evidence_id=sfp_paid_candidate_evidence.id)
     ORDER BY created_at DESC
  `));
   // A populated FK is only a projection, not proof. Contact evidence enters
   // the winner pool only with its live verified decision and consistent FK.
  const contactRows = rows(await db.execute(sql`
      SELECT c.id, c.business_id, c.email, c.email_status, c.created_at,
             d.id AS link_decision_id,d.revision
       FROM contacts c
       JOIN businesses b ON b.id = c.business_id AND b.record_class = 'canonical'
        JOIN contact_business_link_decisions d
          ON d.contact_id=c.id AND d.business_id=c.business_id
         AND d.decision='verified' AND d.superseded_at IS NULL
      WHERE c.business_id = ANY(ARRAY[${idList}]::integer[])
         AND c.archived_at IS NULL
         AND c.record_class NOT IN ('test','demo','synthetic')
         AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
        AND c.email IS NOT NULL AND c.email <> ''
        AND COALESCE(c.do_not_contact, FALSE) = FALSE
        AND COALESCE(c.do_not_auto_contact, FALSE) = FALSE
        AND COALESCE(c.opted_out_email, FALSE) = FALSE
        AND c.opt_out_status IS DISTINCT FROM 'opted_out'
        AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
        AND c.complaint_status IS DISTINCT FROM 'reported'
        AND c.bounce_status IS DISTINCT FROM 'hard'
        AND c.email_status IS DISTINCT FROM 'bounced'
        AND c.email_status IS DISTINCT FROM 'invalid'
        AND c.email_status IS DISTINCT FROM 'opted_out'
        AND c.suppression_reason IS NULL
        AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                         WHERE q.business_id = c.business_id AND q.cleared_at IS NULL)
     ORDER BY c.created_at DESC
  `));
   type Internal = Omit<UnifiedSfpCandidateView,
     "sourceSubjectType" | "normalizedValueHash" | "normalizedValueHashVersion"
     | "contactBusinessLinkDecisionId" | "contactBusinessLinkRevision" | "candidateReference"> & {
     _hashKey: string;
     _normalizedValueHash: string | null;
     _linkDecisionId: string | null;
     _linkRevision: number | null;
     sourceSubjectType?: string;
    stageKey?: string;
    subjectType?: string;
    apolloMatchConfidence?: string | null;
    candidateMetadata?: Record<string, unknown> | string | null;
  };
  const unified: Internal[] = [
    ...freeRows.map((r: any) => ({
      sourceKind: "free" as const,
      evidenceId: String(r.id),
      businessId: Number(r.business_id),
      field: r.field,
      provider: null,
      maskedValue: r.masked_value,
      confidence: Number(r.confidence),
      disposition: r.disposition,
      personNameEvidence: null,
      personTitleEvidence: null,
      createdAt: String(r.created_at),
      duplicateOfEvidenceId: null,
      stageKey: r.source ?? "free",
      subjectType: r.subject_type ?? "business",
      apolloMatchConfidence: null,
      candidateMetadata: null,
      _hashKey: `${r.business_id}:${r.field}:${r.normalized_value_hash}`,
       _normalizedValueHash: String(r.normalized_value_hash),
       _linkDecisionId: null,
       _linkRevision: null,
    })),
    ...paidRows.map((p: any) => ({
      sourceKind: "paid" as const,
      evidenceId: String(p.id),
      businessId: Number(p.business_id),
      field: p.field,
      provider: p.provider,
      maskedValue: p.masked_value,
      confidence: Number(p.confidence),
      disposition: p.disposition,
      personNameEvidence: p.person_name_evidence ?? null,
      personTitleEvidence: p.person_title_evidence ?? null,
      createdAt: String(p.created_at),
      duplicateOfEvidenceId: null,
      stageKey: p.provider,
      subjectType: p.subject_type,
      apolloMatchConfidence: p.candidate_metadata?.apolloMatchConfidence ?? null,
      candidateMetadata: p.candidate_metadata ?? null,
      _hashKey: `${p.business_id}:${p.field}:${p.normalized_value_hash}`,
       _normalizedValueHash: String(p.normalized_value_hash),
       _linkDecisionId: null,
       _linkRevision: null,
    })),
    ...contactRows.map((c: any) => {
      // A contact with no email_status yet ('unvalidated'/'active') has no
      // verification evidence and must still be validated like any other
      // discovered candidate ('staged'). Only a contact whose email_status
      // was already advanced to 'valid' by some other path (never inferred
      // from 'active') is treated as pre-admitted — and even then,
      // sfp-validation.ts's freshness-reuse check (findFreshProviderObservation)
      // is the sole authority that decides whether spend is actually
      // skipped; this disposition alone never bypasses a live re-check.
      const isRoleInbox = rejectEmailCandidate(String(c.email), "person") === "role_address_rejected_for_person";
      const personName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;
      const disposition = c.email_status === "valid" ? "validation_admitted" : "staged";
      return {
        sourceKind: "contact" as const,
        evidenceId: `contact:${c.id}`,
        businessId: Number(c.business_id),
        field: "email",
        provider: null,
        maskedValue: maskCandidate("email", String(c.email)),
        confidence: 60, // existing CRM contact, unranked by any provider signal
        disposition,
        personNameEvidence: isRoleInbox ? null : personName,
        personTitleEvidence: isRoleInbox ? null : c.title ?? null,
        createdAt: String(c.created_at),
        duplicateOfEvidenceId: null,
        stageKey: "contact",
        subjectType: isRoleInbox ? "business" : "person",
        apolloMatchConfidence: null,
        candidateMetadata: null,
        _hashKey: `${c.business_id}:email:${emailNormalizedValueHash(String(c.email))}`,
        _normalizedValueHash: emailNormalizedValueHash(String(c.email)),
        _linkDecisionId: String(c.link_decision_id),
        _linkRevision: Number(c.revision),
      };
    }),
  ];
   // An identical address observed as a verified named person cannot be
   // relabeled as an organization/role inbox by another source that outranks
   // it. Preserve each physical row's sourceSubjectType and provider lineage,
   // but propagate the strictest classification to every observation before
   // choosing a canonical billing/validation representative.
   const classifiedUnified = propagateRestrictiveSfpSubjectType(unified);

   const tier = (entry: Internal): number => {
    const metadata = entry.candidateMetadata
      ? (typeof entry.candidateMetadata === "object" ? entry.candidateMetadata : JSON.parse(String(entry.candidateMetadata)))
      : null;
    return candidateTier({
      subject_type: String(entry.subjectType ?? "business"),
      stage_key: String(entry.stageKey ?? (entry.provider ? String(entry.provider) : "")),
      apollo_match_confidence: entry.apolloMatchConfidence ? String(entry.apolloMatchConfidence) : null,
      candidate_metadata: metadata,
    });
  };
  // Preserve all observations while ordering the likely actionable winner
  // using the same tier model as canonical CRO-03C email selection.
   classifiedUnified.sort((a, b) => {
    const tierDelta = tier(a) - tier(b);
    if (tierDelta !== 0) return tierDelta;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.createdAt.localeCompare(a.createdAt);
  });
  // First occurrence per hash key (in the ranked order above) is canonical;
  // every later occurrence of the same value is marked as a duplicate of it,
  // while remaining a distinct row with its own source/provenance.
  const canonicalByHash = new Map<string, string>();
   for (const entry of classifiedUnified) {
    const canonical = canonicalByHash.get(entry._hashKey);
    if (canonical === undefined) {
      canonicalByHash.set(entry._hashKey, entry.evidenceId);
    } else {
      entry.duplicateOfEvidenceId = canonical;
    }
  }
   return classifiedUnified.map(({ _hashKey, _normalizedValueHash, _linkDecisionId, _linkRevision, ...rest }) => ({
    ...rest,
    sourceSubjectType: rest.sourceSubjectType!,
    normalizedValueHash: _normalizedValueHash,
    normalizedValueHashVersion: _normalizedValueHash ? 1 : null,
    contactBusinessLinkDecisionId: _linkDecisionId,
    contactBusinessLinkRevision: _linkRevision,
    candidateReference: rest.sourceKind === "free"
      ? {
          sourceKind: "free" as const,
          freeDiscoveryCandidateId: rest.evidenceId,
          normalizedValueHash: _normalizedValueHash!,
          normalizedValueHashVersion: 1,
        }
      : rest.sourceKind === "paid"
      ? {
          sourceKind: "paid" as const,
          paidCandidateEvidenceId: rest.evidenceId,
          normalizedValueHash: _normalizedValueHash!,
          normalizedValueHashVersion: 1,
        }
      : {
          sourceKind: "contact" as const,
          contactId: rest.evidenceId.replace(/^contact:/, ""),
          contactBusinessLinkDecisionId: _linkDecisionId!,
          contactBusinessLinkRevision: _linkRevision!,
          normalizedValueHash: _normalizedValueHash!,
          normalizedValueHashVersion: 1,
        },
  }));
}
