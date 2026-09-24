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
): Promise<{ id: string; wasNew: boolean }> {
  const { ciphertext, nonce, tag, normalizedValueHash, maskedValue } = seal(input.field, input.value);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence ?? 0)));
  const inserted = rows(await db.execute(sql`
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
    ON CONFLICT (provider, business_id, field, normalized_value_hash) DO UPDATE
      SET candidate_metadata = COALESCE(sfp_paid_candidate_evidence.candidate_metadata, EXCLUDED.candidate_metadata)
    RETURNING id, (xmax = 0) AS was_inserted
  `));
  if (inserted.length > 0) {
    const row = inserted[0];
    const wasNew = row.was_inserted === true || row.was_inserted === "true" || row.was_inserted === "t";
    return { id: String(row.id), wasNew };
  }
  const existing = rows(await db.execute(sql`
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

export async function getUnifiedSfpCandidates(businessIds: number[]): Promise<UnifiedSfpCandidateView[]> {
  if (businessIds.length === 0) return [];
  const idList = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
  const freeRows = rows(await db.execute(sql`
    SELECT id, business_id, field, disposition, confidence, masked_value, normalized_value_hash, created_at
      FROM free_discovery_candidates
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
  `));
  const paidRows = rows(await db.execute(sql`
    SELECT id, business_id, provider, field, subject_type, disposition, confidence,
           masked_value, normalized_value_hash, person_name_evidence, person_title_evidence, created_at
      FROM sfp_paid_candidate_evidence
     WHERE business_id = ANY(ARRAY[${idList}]::integer[])
     ORDER BY created_at DESC
  `));
  type Internal = UnifiedSfpCandidateView & { _hashKey: string };
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
      _hashKey: `${p.business_id}:${p.field}:${p.normalized_value_hash}`,
    })),
  ];
  // Rank deterministically: paid evidence (higher marginal cost, often more
  // corroborated) before free, then by confidence desc, then createdAt desc.
  unified.sort((a, b) => {
    if (a.sourceKind !== b.sourceKind) return a.sourceKind === "paid" ? -1 : 1;
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
