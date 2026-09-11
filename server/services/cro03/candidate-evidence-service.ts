/**
 * MI-05: CRO-03C native candidate evidence service.
 *
 * Encrypts and persists per-field candidate evidence produced by live
 * CRO-03C provider executors.  This is the durable bridge between provider
 * transport and canonical projection — no PII is ever written to
 * cro03c_receipts.redacted_metadata.
 *
 * subject_type = 'business' → eligible for businesses.mainEmail projection.
 * subject_type = 'person'   → Apollo reveal; held for MI-06 validation.
 *
 * Kill lines:
 *  - Never writes to contacts or cro03_mutation_commands.
 *  - Never writes person-level candidates to businesses.mainEmail.
 *  - Never uses cro03_provider_ledger.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { candidateHash, maskCandidate, normalizeCandidateValue } from "./contracts";

const AAD_PREFIX = "cro03c-candidate-evidence-v1";
const KEY_VERSION = 1;

// ── Key resolution (same master as candidate-vault.ts) ────────────────────────

function derivedKey(): Buffer {
  const master = process.env.MERCHANT_DATA_ENCRYPTION_KEY;
  if (!master) throw new Error("CRO03C_CANDIDATE_KEY_UNAVAILABLE");
  return createHash("sha256").update(`${AAD_PREFIX}\0${master}`).digest();
}

// ── Envelope types ─────────────────────────────────────────────────────────────

export interface CandidateEvidenceEnvelope {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
}

export interface CandidateEvidenceWriteInput {
  generationId: string;
  stageKey: string;
  field: string;
  value: string;
  subjectType: "business" | "person";
  /** Lifecycle state. 'staged' (default) for accepted candidates; 'quarantined' for medium-confidence reveals. */
  disposition?: "staged" | "quarantined";
  confidence: number;
  sourceRank?: number;
  apolloMatchConfidence?: "high" | "medium" | "low" | "none" | null;
  /** MI-06: business_id for business-scoped candidates (populated at evidence creation). */
  businessId?: number | null;
  /** MI-06: arbitrary per-candidate metadata, e.g. { ownerTitle: "owner" } for Apollo person reveals. */
  candidateMetadata?: Record<string, unknown> | null;
}

export interface CandidateEvidenceRecord {
  id: string;
  generationId: string;
  stageKey: string;
  field: string;
  subjectType: "business" | "person";
  disposition: string;
  confidence: number;
  sourceRank: number;
  normalizedValueHash: string;
  maskedValue: string;
  apolloMatchConfidence: string | null;
  createdAt: string;
}

// ── Encryption helpers ─────────────────────────────────────────────────────────

function seal(field: string, value: string): {
  ciphertext: string; nonce: string; tag: string;
  normalizedValueHash: string; maskedValue: string;
} {
  // For fields not in the legacy Cro03CandidateField enum, use a generic normalizer.
  const normalized = value.toLowerCase().trim();
  const nonce = randomBytes(12);
  const key = derivedKey();
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const aad = `${AAD_PREFIX}:${field}`;
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const masked = field === "email"
    ? maskEmail(normalized)
    : field === "phone"
      ? `***${normalized.replace(/\D/g, "").slice(-4)}`
      : normalized.length <= 4 ? "***" : `${normalized.slice(0, 2)}***`;
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    normalizedValueHash: createHash("sha256").update(`${field}\0${normalized}`).digest("hex"),
    maskedValue: masked,
  };
}

function maskEmail(normalized: string): string {
  const [local, domain = ""] = normalized.split("@");
  return `${(local || "").slice(0, 1)}***@${domain.slice(0, 2)}***`;
}

export function unseal(field: string, envelope: CandidateEvidenceEnvelope): string {
  if (envelope.keyVersion !== KEY_VERSION) throw new Error("CRO03C_CANDIDATE_KEY_VERSION_UNSUPPORTED");
  const key = derivedKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
  const aad = `${AAD_PREFIX}:${field}`;
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ── Write path ─────────────────────────────────────────────────────────────────

/**
 * Write a single candidate evidence record for one field from one provider stage.
 * Idempotent: UNIQUE(generation_id, stage_key, field, normalized_value_hash).
 * Including the value hash in the unique key allows multiple email candidates
 * per (generation, stage, field) while preventing exact-value duplicates on retry.
 * Returns the persisted record id and whether this was a new insert.
 */
export async function writeCandidateEvidence(
  input: CandidateEvidenceWriteInput,
): Promise<{ id: string; wasNew: boolean }> {
  const { ciphertext, nonce, tag, normalizedValueHash, maskedValue } = seal(input.field, input.value);
  const rows = (result: any): any[] => result?.rows ?? result ?? [];
  const disposition = input.disposition ?? "staged";
  // Try idempotent insert — conflict means the exact same value was already written.
  const inserted = rows(await db.execute(sql`
    INSERT INTO cro03c_candidate_evidence
      (generation_id, stage_key, field, source_rank, subject_type, disposition,
       confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value,
       apollo_match_confidence, business_id, candidate_metadata)
    VALUES
      (${input.generationId}::uuid, ${input.stageKey}, ${input.field},
       ${input.sourceRank ?? 100}, ${input.subjectType}, ${disposition},
       ${input.confidence},
       ${ciphertext}, ${nonce}, ${tag}, ${KEY_VERSION},
       ${normalizedValueHash}, ${maskedValue},
       ${input.apolloMatchConfidence ?? null},
       ${input.businessId ?? null},
       ${input.candidateMetadata ? JSON.stringify(input.candidateMetadata) : null}::jsonb)
    ON CONFLICT (generation_id, stage_key, field, normalized_value_hash) DO UPDATE
      -- MI-06: repair NULL business_id on retry once canonical linking resolves.
      -- Only update; never downgrade a non-null binding to NULL.
      SET business_id = COALESCE(cro03c_candidate_evidence.business_id, EXCLUDED.business_id),
          candidate_metadata = COALESCE(cro03c_candidate_evidence.candidate_metadata, EXCLUDED.candidate_metadata)
    RETURNING id, (xmax = 0) AS was_inserted
  `));
  if (inserted.length > 0) {
    const row = inserted[0];
    // was_inserted is true for new rows; false for DO UPDATE (conflict repair).
    const wasNew = row.was_inserted === true || row.was_inserted === "true" || row.was_inserted === "t";
    return { id: String(row.id), wasNew };
  }
  // Fallback: no row returned (should not happen with DO UPDATE, but guard defensively).
  const existing = rows(await db.execute(sql`
    SELECT id FROM cro03c_candidate_evidence
     WHERE generation_id = ${input.generationId}::uuid
       AND stage_key = ${input.stageKey}
       AND field = ${input.field}
       AND normalized_value_hash = ${normalizedValueHash}
  `));
  return { id: String(existing[0]?.id ?? ""), wasNew: false };
}

/**
 * Read all candidate evidence records for a generation, decrypted.
 * Returns only 'staged' and 'accepted' records by default.
 */
export async function readCandidateEvidence(
  generationId: string,
  opts?: { subjectType?: "business" | "person"; dispositions?: string[] },
): Promise<Array<CandidateEvidenceRecord & { value: string }>> {
  const rows = (result: any): any[] => result?.rows ?? result ?? [];
  const dispositions = opts?.dispositions ?? ["staged", "accepted"];
  const records = rows(await db.execute(sql`
    SELECT id, generation_id, stage_key, field, subject_type, disposition,
           confidence, source_rank, normalized_value_hash, masked_value,
           apollo_match_confidence, envelope_ciphertext, envelope_nonce,
           envelope_tag, envelope_key_version, created_at
      FROM cro03c_candidate_evidence
     WHERE generation_id = ${generationId}::uuid
       AND disposition = ANY(${dispositions}::text[])
       ${opts?.subjectType ? sql`AND subject_type = ${opts.subjectType}` : sql``}
     ORDER BY source_rank ASC, confidence DESC
  `));
  return records.map((row: any) => ({
    id: String(row.id),
    generationId: String(row.generation_id),
    stageKey: String(row.stage_key),
    field: String(row.field),
    subjectType: row.subject_type as "business" | "person",
    disposition: String(row.disposition),
    confidence: Number(row.confidence),
    sourceRank: Number(row.source_rank),
    normalizedValueHash: String(row.normalized_value_hash),
    maskedValue: String(row.masked_value),
    apolloMatchConfidence: row.apollo_match_confidence ?? null,
    createdAt: String(row.created_at),
    value: unseal(String(row.field), {
      ciphertext: String(row.envelope_ciphertext),
      nonce: String(row.envelope_nonce),
      tag: String(row.envelope_tag),
      keyVersion: Number(row.envelope_key_version),
    }),
  }));
}
