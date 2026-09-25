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
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { seal, unseal } from "./candidate-evidence-service";
import { candidateTier } from "./candidate-selector";

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
  sourceKind: "free" | "paid";
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
  /** Persisted subject_type from the source row ('business' | 'person') — the
   *  authoritative classification for role-inbox vs named-contact decisions.
   *  Never inferred from whether person-name evidence happens to be present. */
  subjectType: string;
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
}

export type SfpCandidateReference =
  | { sourceKind: "free"; freeDiscoveryCandidateId: string }
  | { sourceKind: "paid"; paidCandidateEvidenceId: string };

export interface ResolvedSfpCandidateReference {
  sourceKind: "free" | "paid";
  evidenceId: string;
  businessId: number;
  field: string;
  provider: string | null;
  subjectType: string;
  maskedValue: string;
  confidence: number;
  disposition: string;
  createdAt: string;
}

/** Read-only lineage resolver for the Task #2000 handoff; no eligibility writes. */
export async function resolveSfpCandidateReference(
  reference: SfpCandidateReference,
): Promise<ResolvedSfpCandidateReference | null> {
  if (reference.sourceKind === "free") {
    const row = rows(await db.execute(sql`
      SELECT id,business_id,field,source,subject_type,masked_value,confidence,disposition,created_at
        FROM free_discovery_candidates WHERE id=${reference.freeDiscoveryCandidateId}::uuid LIMIT 1
    `))[0];
    return row ? {
      sourceKind: "free", evidenceId: String(row.id), businessId: Number(row.business_id),
       field: String(row.field), provider: String(row.source ?? "free"), subjectType: String(row.subject_type ?? "business"),
      maskedValue: String(row.masked_value), confidence: Number(row.confidence), disposition: String(row.disposition),
      createdAt: String(row.created_at),
    } : null;
  }
  const row = rows(await db.execute(sql`
    SELECT id,business_id,provider,field,subject_type,masked_value,confidence,disposition,created_at
      FROM sfp_paid_candidate_evidence WHERE id=${reference.paidCandidateEvidenceId}::uuid LIMIT 1
  `))[0];
  return row ? {
    sourceKind: "paid", evidenceId: String(row.id), businessId: Number(row.business_id),
    field: String(row.field), provider: String(row.provider), subjectType: String(row.subject_type),
    maskedValue: String(row.masked_value), confidence: Number(row.confidence), disposition: String(row.disposition),
    createdAt: String(row.created_at),
  } : null;
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
        SELECT id,business_id,field,source,subject_type,masked_value,confidence,disposition,created_at
          FROM free_discovery_candidates WHERE id=${input.reference.freeDiscoveryCandidateId}::uuid LIMIT 1
      `)))[0]
    : (await rows(await executor.execute(sql`
        SELECT id,business_id,provider,field,subject_type,masked_value,confidence,disposition,created_at
          FROM sfp_paid_candidate_evidence WHERE id=${input.reference.paidCandidateEvidenceId}::uuid LIMIT 1
      `)))[0];
  const resolvedRef: ResolvedSfpCandidateReference | null = !resolvedRow ? null : input.reference.sourceKind === "free"
    ? {
        sourceKind: "free", evidenceId: String(resolvedRow.id), businessId: Number(resolvedRow.business_id),
        field: String(resolvedRow.field), provider: String(resolvedRow.source ?? "free"), subjectType: String(resolvedRow.subject_type ?? "business"),
        maskedValue: String(resolvedRow.masked_value), confidence: Number(resolvedRow.confidence), disposition: String(resolvedRow.disposition),
        createdAt: String(resolvedRow.created_at),
      }
    : {
        sourceKind: "paid", evidenceId: String(resolvedRow.id), businessId: Number(resolvedRow.business_id),
        field: String(resolvedRow.field), provider: String(resolvedRow.provider), subjectType: String(resolvedRow.subject_type),
        maskedValue: String(resolvedRow.masked_value), confidence: Number(resolvedRow.confidence), disposition: String(resolvedRow.disposition),
        createdAt: String(resolvedRow.created_at),
      };
  if (!resolvedRef) throw new Error("SFP_CANDIDATE_REFERENCE_NOT_FOUND");
  const resolved = resolvedRef;
  if (resolved.disposition === "suppressed" || resolved.disposition === "rejected") {
    throw new Error(`SFP_CANDIDATE_NOT_OPENABLE:disposition=${resolved.disposition}`);
  }
  // Frozen-cohort membership: the candidate's business must actually be a
  // member of the cohort run this decision belongs to.
  const memberRow = rows(await executor.execute(sql`
    SELECT 1 FROM sfp_cohort_members WHERE cohort_run_id=${input.cohortRunId}::uuid AND business_id=${resolved.businessId} LIMIT 1
  `))[0];
  if (!memberRow) throw new Error("SFP_CANDIDATE_BUSINESS_NOT_IN_COHORT");

  const envelopeRow = resolved.sourceKind === "free"
    ? rows(await executor.execute(sql`
        SELECT envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version
          FROM free_discovery_candidates WHERE id=${resolved.evidenceId}::uuid LIMIT 1
      `))[0]
    : rows(await executor.execute(sql`
        SELECT envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version
          FROM sfp_paid_candidate_evidence WHERE id=${resolved.evidenceId}::uuid LIMIT 1
      `))[0];
  if (!envelopeRow) throw new Error("SFP_CANDIDATE_ENVELOPE_NOT_FOUND");

  const plaintext = unseal("email", {
    ciphertext: String(envelopeRow.envelope_ciphertext),
    nonce: String(envelopeRow.envelope_nonce),
    tag: String(envelopeRow.envelope_tag),
    keyVersion: Number(envelopeRow.envelope_key_version ?? 1),
  });

  await executor.execute(sql`
    INSERT INTO audit_logs (action, entity_type, entity_key, actor_type, actor_id, details)
    VALUES ('sfp_candidate_plaintext_opened', 'sfp_candidate_evidence', ${resolved.evidenceId}, 'user', ${input.actorId},
            ${JSON.stringify({ sourceKind: resolved.sourceKind, evidenceId: resolved.evidenceId, businessId: resolved.businessId, purpose: input.purpose, cohortRunId: input.cohortRunId })}::jsonb)
  `);

  // The result of `use()` is trusted to be sanitized by the caller (see the
  // corrective-patch note above); this function itself never inspects or
  // forwards `plaintext` beyond this call.
  return use(plaintext, resolved);
}

export async function getUnifiedSfpCandidates(businessIds: number[]): Promise<UnifiedSfpCandidateView[]> {
  if (businessIds.length === 0) return [];
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const freeRows = rows(await db.execute(sql`
     SELECT id, business_id, field, source, subject_type,
            disposition, confidence, masked_value, normalized_value_hash, created_at
      FROM free_discovery_candidates
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
  `));
  const paidRows = rows(await db.execute(sql`
     SELECT id, business_id, provider, field, subject_type, disposition, confidence, candidate_metadata,
           masked_value, normalized_value_hash, person_name_evidence, person_title_evidence, created_at
      FROM sfp_paid_candidate_evidence
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
     ORDER BY created_at DESC
  `));
  type Internal = UnifiedSfpCandidateView & {
    _hashKey: string;
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
    })),
  ];
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
  unified.sort((a, b) => {
    const tierDelta = tier(a) - tier(b);
    if (tierDelta !== 0) return tierDelta;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.createdAt.localeCompare(a.createdAt);
  });
  // First occurrence per hash key (in the ranked order above) is canonical;
  // every later occurrence of the same value is marked as a duplicate of it,
  // while remaining a distinct row with its own source/provenance.
  const canonicalByHash = new Map<string, string>();
  for (const entry of unified) {
    const canonical = canonicalByHash.get(entry._hashKey);
    if (canonical === undefined) {
      canonicalByHash.set(entry._hashKey, entry.evidenceId);
    } else {
      entry.duplicateOfEvidenceId = canonical;
    }
  }
  return unified.map(({ _hashKey, ...rest }) => rest);
}
