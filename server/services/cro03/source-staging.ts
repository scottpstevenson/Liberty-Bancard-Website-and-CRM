import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  CRO03_CANDIDATE_DISPOSITIONS,
  CRO03_HASH_ALGORITHM_VERSION,
  CRO03_SOURCE_STAGING_RECIPE_VERSION,
  CRO03_SOURCE_SUBJECT_TYPES,
  type Cro03CandidateDisposition,
  type Cro03CandidateField,
  type Cro03SourceSubjectType,
  canonicalCandidateDisplay,
  candidateHash,
  normalizeCandidateValue,
} from "./contracts";

export interface Cro03SourceSubject {
  subjectType: Cro03SourceSubjectType;
  subjectKey: string;
  sourceSystem: string;
}

export interface Cro03SourceObservationDraft {
  subject: Cro03SourceSubject;
  observedAt: string;
  sourceEventKey?: string;
  timestampProvenance?: "source" | "import" | "ingestion_only";
  actorType: string;
  actorId?: string;
  provenance: Readonly<Record<string, unknown>>;
  payload: Readonly<Record<string, unknown>>;
  payloadHash: string;
  hashAlgorithmVersion: typeof CRO03_HASH_ALGORITHM_VERSION;
}

export interface Cro03NormalizedCandidateDraft {
  field: Cro03CandidateField;
  normalizedValue: string;
  displayValue: string;
  valueHash: string;
  hashAlgorithmVersion: typeof CRO03_HASH_ALGORITHM_VERSION;
  normalizationVersion: 1;
}

export const SOUTH_FLORIDA_STAGING_RECIPE = Object.freeze({
  recipeKey: "south_florida_staging",
  version: CRO03_SOURCE_STAGING_RECIPE_VERSION,
  status: "disabled" as const,
  geography: { states: ["FL"], counties: ["Miami-Dade", "Broward", "Palm Beach"], mode: "allowlist" },
  fit: { mode: "evidence_only", minimumEvidence: 1 },
  provenance: { requireObservation: true, allowedSubjectTypes: [...CRO03_SOURCE_SUBJECT_TYPES] },
  exclusions: { excludeDoNotContact: true, excludeExistingCustomer: true },
  duplicate: { strategy: "hash_then_review", fields: ["email", "phone", "website", "registry_id"] },
  quarantine: { default: "quarantined", releaseRequires: "reviewed_disposition" },
  purpose: { allowed: ["provider_pre_spend", "staging_review"], default: "staging_review" },
  actor: { requireActor: true, allowedActorTypes: ["user", "system", "import"] },
  route: { providers: [] as string[], execution: "disabled", requiresFrozenEvidence: true },
  cost: { currency: "USD", maxAmountMicros: 0, providerSpendAllowed: false },
  hashAlgorithmVersion: CRO03_HASH_ALGORITHM_VERSION,
});

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

/** Hashes immutable JSON evidence with the explicit SHA-256 algorithm version. */
export function hashCro03Evidence(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function makeCro03SourceObservation(input: Omit<Cro03SourceObservationDraft, "payloadHash" | "hashAlgorithmVersion">): Cro03SourceObservationDraft {
  if (!(CRO03_SOURCE_SUBJECT_TYPES as readonly string[]).includes(input.subject.subjectType)) {
    throw new Error(`CRO03_SOURCE_SUBJECT_TYPE_INVALID:${input.subject.subjectType}`);
  }
  if (!input.subject.subjectKey.trim() || !input.subject.sourceSystem.trim() || !input.actorType.trim()) {
    throw new Error("CRO03_SOURCE_OBSERVATION_IDENTITY_REQUIRED");
  }
  if (Number.isNaN(Date.parse(input.observedAt))) throw new Error("CRO03_SOURCE_OBSERVATION_TIME_INVALID");
  return { ...input, payloadHash: hashCro03Evidence(input.payload), hashAlgorithmVersion: CRO03_HASH_ALGORITHM_VERSION };
}

export function makeCro03NormalizedCandidate(field: Cro03CandidateField, value: string): Cro03NormalizedCandidateDraft {
  const normalizedValue = normalizeCandidateValue(field, value);
  if (!normalizedValue) throw new Error("CRO03_CANDIDATE_VALUE_REQUIRED");
  return {
    field, normalizedValue, displayValue: canonicalCandidateDisplay(field, value),
    valueHash: candidateHash(field, value), hashAlgorithmVersion: CRO03_HASH_ALGORITHM_VERSION,
    normalizationVersion: 1,
  };
}

export function assertCro03CandidateDisposition(value: string): asserts value is Cro03CandidateDisposition {
  if (!(CRO03_CANDIDATE_DISPOSITIONS as readonly string[]).includes(value)) {
    throw new Error(`CRO03_CANDIDATE_DISPOSITION_INVALID:${value}`);
  }
}

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export interface CreateCro03SourceBatchInput {
  idempotencyKey: string;
  actorType: "user" | "system" | "import";
  actorId?: string | null;
  purpose?: "staging_review" | "provider_pre_spend";
  subjects: Array<{
    subjectType: Cro03SourceSubjectType;
    subjectKey: string;
    sourceSystem: string;
    payload: Record<string, unknown>;
    provenance?: Record<string, unknown>;
    candidateValues?: Partial<Record<Cro03CandidateField, string>>;
    sourceEventKey?: string;
    sourceObservedAt?: string;
    timestampProvenance?: "source" | "import" | "ingestion_only";
  }>;
}

/**
 * Canonical evidence-first intake for non-contact sources. It deliberately
 * creates no contact/deal and no executable provider work. A later reviewed
 * promotion command may project accepted evidence.
 */
export async function createCro03SourceBatch(input: CreateCro03SourceBatchInput): Promise<{
  id: string; replayed: boolean; totalCount: number; blockedCount: number;
}> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error("CRO03_INVALID_IDEMPOTENCY_KEY");
  if (!input.subjects.length || input.subjects.length > 1000) throw new Error("CRO03_INVALID_SOURCE_SELECTION");
  if (input.actorId !== "cro03b") {
    const { assertCro03bLegacySourceWriteAllowed } = await import("./admission-service");
    for (const subject of input.subjects) {
      await assertCro03bLegacySourceWriteAllowed({
        subjectType: subject.subjectType,
        subjectKey: subject.subjectKey,
        writerKey: `source-staging:${input.actorType}:${subject.sourceSystem}`,
      });
    }
  }
  const purpose = input.purpose ?? "staging_review";
  const drafts = input.subjects.map((entry) => makeCro03SourceObservation({
    subject: { subjectType: entry.subjectType, subjectKey: entry.subjectKey, sourceSystem: entry.sourceSystem },
    observedAt: entry.sourceObservedAt ?? new Date().toISOString(),
    sourceEventKey: entry.sourceEventKey,
    timestampProvenance: entry.timestampProvenance ?? (entry.sourceObservedAt ? "source" : "ingestion_only"),
    actorType: input.actorType,
    actorId: input.actorId ?? undefined,
    provenance: entry.provenance ?? { sourceSystem: entry.sourceSystem },
    payload: entry.payload,
  }));
  const selectionHash = hashCro03Evidence(drafts.map((draft) => ({
    type: draft.subject.subjectType, system: draft.subject.sourceSystem, key: draft.subject.subjectKey, payloadHash: draft.payloadHash,
  })).sort((a, b) => `${a.type}:${a.key}`.localeCompare(`${b.type}:${b.key}`)));
  const recipeHash = hashCro03Evidence(SOUTH_FLORIDA_STAGING_RECIPE);
  const commandFingerprint = hashCro03Evidence({
    hashAlgorithmVersion: CRO03_HASH_ALGORITHM_VERSION, purpose, recipeHash, selectionHash,
  });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"cro03-source:" + input.idempotencyKey}, 0))`);
    const existing = rows(await tx.execute(sql`
      SELECT id,selection_hash,command_fingerprint,total_count,blocked_count
        FROM cro03_enrichment_batches WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (existing) {
      if (existing.selection_hash !== selectionHash || existing.command_fingerprint !== commandFingerprint) {
        throw new Error("CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      return { id: String(existing.id), replayed: true, totalCount: Number(existing.total_count), blockedCount: Number(existing.blocked_count) };
    }
    const batch = rows(await tx.execute(sql`
      INSERT INTO cro03_enrichment_batches
        (idempotency_key,actor_type,actor_id,purpose,selection_policy_version,routing_policy_version,
         state,total_count,executable_count,blocked_count,selection_hash,command_fingerprint,completed_at)
      VALUES (${input.idempotencyKey},${input.actorType},${input.actorId ?? null},${purpose},
              ${CRO03_SOURCE_STAGING_RECIPE_VERSION},${CRO03_SOURCE_STAGING_RECIPE_VERSION},
              'completed',${drafts.length},0,${drafts.length},${selectionHash},${commandFingerprint},NOW())
      RETURNING id
    `))[0];
    for (const [ordinal, draft] of drafts.entries()) {
      const entry = input.subjects[ordinal];
      let subject = rows(await tx.execute(sql`
        INSERT INTO cro03_source_subjects(subject_type,subject_key,source_system)
        VALUES (${draft.subject.subjectType},${draft.subject.subjectKey},${draft.subject.sourceSystem})
        ON CONFLICT(subject_type,source_system,subject_key) DO NOTHING
        RETURNING id
      `))[0];
      subject ??= rows(await tx.execute(sql`
        SELECT id FROM cro03_source_subjects
         WHERE subject_type=${draft.subject.subjectType} AND source_system=${draft.subject.sourceSystem}
           AND subject_key=${draft.subject.subjectKey}
      `))[0];
      let observation = rows(await tx.execute(sql`
        INSERT INTO cro03_source_observations
          (source_subject_id,observed_at,observed_by_actor_type,observed_by_actor_id,
           provenance,payload,payload_hash,hash_algorithm_version)
        VALUES (${subject.id}::uuid,${draft.observedAt}::timestamptz,${draft.actorType},${draft.actorId ?? null},
                ${JSON.stringify(draft.provenance)}::jsonb,${JSON.stringify(draft.payload)}::jsonb,
                ${draft.payloadHash},${draft.hashAlgorithmVersion})
        ON CONFLICT(source_subject_id,payload_hash) DO NOTHING
        RETURNING id
      `))[0];
      observation ??= rows(await tx.execute(sql`
        SELECT id FROM cro03_source_observations
         WHERE source_subject_id=${subject.id}::uuid AND payload_hash=${draft.payloadHash}
      `))[0];
      const sourceEventKey = entry.sourceEventKey ?? `${input.idempotencyKey}:${ordinal}`;
      const occurrence = rows(await tx.execute(sql`
        INSERT INTO cro03_source_occurrences
          (source_subject_id,source_observation_id,source_observed_at,import_observed_at,ingested_at,
           timestamp_provenance,source_event_key,payload_hash,contract_version,
           normalization_version,hash_algorithm_version)
        VALUES (${subject.id}::uuid,${observation.id}::uuid,${draft.observedAt}::timestamptz,
                ${draft.timestampProvenance === "import" ? draft.observedAt : null}::timestamptz,
                NOW(),${draft.timestampProvenance ?? "ingestion_only"},${sourceEventKey},
                ${draft.payloadHash},'cro03a-source-v1',1,${draft.hashAlgorithmVersion})
        ON CONFLICT(source_subject_id,source_event_key) DO NOTHING
        RETURNING id
      `))[0];
      const occurrenceRow = occurrence ?? rows(await tx.execute(sql`
        SELECT id FROM cro03_source_occurrences
         WHERE source_subject_id=${subject.id}::uuid AND source_event_key=${sourceEventKey}
      `))[0];
      for (const [field, rawValue] of Object.entries(entry.candidateValues ?? {}) as Array<[Cro03CandidateField, string]>) {
        if (!rawValue?.trim()) continue;
        const candidate = makeCro03NormalizedCandidate(field, rawValue);
        let candidateRow = rows(await tx.execute(sql`
          INSERT INTO cro03_normalized_candidates
            (source_observation_id,field,normalized_value,display_value,value_hash,hash_algorithm_version,normalization_version)
          VALUES (${observation.id}::uuid,${field},${candidate.normalizedValue},${candidate.displayValue},
                  ${candidate.valueHash},${candidate.hashAlgorithmVersion},${candidate.normalizationVersion})
          ON CONFLICT(source_observation_id,field,value_hash) DO NOTHING
          RETURNING id
        `))[0];
        candidateRow ??= rows(await tx.execute(sql`
          SELECT id FROM cro03_normalized_candidates
           WHERE source_observation_id=${observation.id}::uuid AND field=${field}
             AND value_hash=${candidate.valueHash}
        `))[0];
        await tx.execute(sql`
          INSERT INTO cro03_candidate_dispositions
            (candidate_id,disposition,reason_code,decided_by_actor_type,decided_by_actor_id)
          SELECT ${candidateRow.id}::uuid,'quarantined','STAGING_RECIPE_DISABLED',${input.actorType},${input.actorId ?? null}
          WHERE NOT EXISTS (
            SELECT 1 FROM cro03_candidate_dispositions
             WHERE candidate_id=${candidateRow.id}::uuid AND disposition='quarantined'
               AND reason_code='STAGING_RECIPE_DISABLED'
          )
        `);
      }
       const membershipHash = hashCro03Evidence({ batchId: batch.id, ordinal, subjectId: subject.id, observationId: observation.id, occurrenceId: occurrenceRow.id });
      const membership = rows(await tx.execute(sql`
        INSERT INTO cro03_batch_memberships
          (batch_id,ordinal,subject_type,subject_id,root_subject_type,root_subject_id,
           selection_policy_version,dependency_fingerprint,pre_spend_decision,disposition,
           disposition_reason,membership_hash,subject_snapshot,subject_snapshot_hash,
           frozen_route_plan,route_plan_hash,discovery_eligible,paid_enrichment_eligible,
            source_subject_id,source_observation_id,source_recipe_key,source_recipe_version)
        VALUES (${batch.id}::uuid,${ordinal},${draft.subject.subjectType},${ordinal + 1},
                ${draft.subject.subjectType},${ordinal + 1},${CRO03_SOURCE_STAGING_RECIPE_VERSION},
                ${recipeHash},'quarantined','blocked','STAGING_RECIPE_DISABLED',${membershipHash},
                ${JSON.stringify(draft.payload)}::jsonb,${draft.payloadHash},
                ${JSON.stringify(SOUTH_FLORIDA_STAGING_RECIPE.route)}::jsonb,
                ${hashCro03Evidence(SOUTH_FLORIDA_STAGING_RECIPE.route)},FALSE,FALSE,
                 ${subject.id}::uuid,${observation.id}::uuid,${SOUTH_FLORIDA_STAGING_RECIPE.recipeKey},
                ${CRO03_SOURCE_STAGING_RECIPE_VERSION})
        RETURNING id
      `))[0];
      await tx.execute(sql`
        INSERT INTO cro03_enrichment_items(batch_id,membership_id,state,terminal_code,subject_snapshot_hash,route_plan_hash,completed_at)
        VALUES (${batch.id}::uuid,${membership.id}::uuid,'blocked','STAGING_RECIPE_DISABLED',
                ${draft.payloadHash},${hashCro03Evidence(SOUTH_FLORIDA_STAGING_RECIPE.route)},NOW())
      `);
    }
    return { id: String(batch.id), replayed: false, totalCount: drafts.length, blockedCount: drafts.length };
  });
}