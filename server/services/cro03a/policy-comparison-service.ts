/**
 * CRO-03A Policy Comparison Service
 *
 * Evaluates a frozen eligible occurrence set against both the active policy and
 * a named draft document using the EXACT same enrichment and evaluation path as
 * production qualification (loadOccurrences → enrichRelationships → evaluateOccurrenceSet).
 * This guarantees that the preview dispositions are production-equivalent — no
 * artificial flips from unenriched relationship/identity evidence.
 *
 * The eligible population is loaded by direct SQL (no stored disposition column)
 * and then passed through loadOccurrences() in batches of ≤500 to respect the
 * production hard cap while preserving full enrichment.
 *
 * No writes, no external effects. activateCro03aPolicy() is never called from
 * this module.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { hashCro03Evidence } from "../cro03/source-staging";
import { stableCro03aSelectionHash } from "../cro03/contracts";
import {
  getActivePolicy,
  loadOccurrences,
  evaluateOccurrenceSet,
  type FrozenOccurrence,
  type ActivePolicy,
} from "./qualification-service";

const resultRows = (result: any): any[] => result?.rows ?? result ?? [];
const json = <T>(value: T | string): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : value;

const LOAD_BATCH_SIZE = 500; // matches loadOccurrences() hard cap

type PolicyDoc = {
  id: string;
  version: number;
  policyKey: string;
  policyHash: string;
  policy: Record<string, any>;
  status: string;
};

async function loadPolicyDoc(executor: any, id: string): Promise<PolicyDoc> {
  const row = resultRows(await executor.execute(sql`
    SELECT id, version, policy_key, policy_hash, policy, status
      FROM cro03a_policy_documents
     WHERE id = ${id}::uuid
  `))[0];
  if (!row) throw new Error(`CRO03A_POLICY_NOT_FOUND:${id}`);
  return {
    id: String(row.id),
    version: Number(row.version),
    policyKey: String(row.policy_key),
    policyHash: String(row.policy_hash),
    policy: json(row.policy),
    status: String(row.status),
  };
}

/**
 * Select the eligible occurrence population without using a stored disposition
 * column — disposition is always an evaluator output, not a stored field.
 *
 * Filters to allowed selectable subject types and observations within the
 * broadest possible freshness window (365 days) to match the widest policy
 * scope. The caller runs both policies against the same frozen set so the
 * comparison is apples-to-apples.
 */
async function selectEligibleOccurrenceIds(executor: any = db): Promise<string[]> {
  const rows = resultRows(await executor.execute(sql`
    SELECT occ.id::text AS occurrence_id
      FROM cro03_source_occurrences occ
      JOIN cro03_source_subjects subj ON subj.id = occ.source_subject_id
     WHERE subj.subject_type IN (
             'prospect', 'sunbiz_entity', 'sdr_merchant',
             'provider_csv_row', 'lead_discovery_result', 'master_lead'
           )
       AND occ.source_observed_at >= NOW() - INTERVAL '365 days'
     ORDER BY occ.id
  `));
  return rows.map((r: any) => String(r.occurrence_id));
}

/**
 * Load occurrences in batches of ≤500 through the production loadOccurrences()
 * path so each batch receives the same prior-handoff, relationship, identity, and
 * MI-03 canonical-source enrichment that production qualification applies.
 * The executor is forwarded to every batch call.
 */
async function loadOccurrencesInBatches(ids: string[], executor: any): Promise<FrozenOccurrence[]> {
  const result: FrozenOccurrence[] = [];
  for (let i = 0; i < ids.length; i += LOAD_BATCH_SIZE) {
    const chunk = ids.slice(i, i + LOAD_BATCH_SIZE);
    const loaded = await loadOccurrences(chunk, executor);
    result.push(...loaded);
  }
  return result;
}

/** Wrap an ActivePolicy-shaped object as the ActivePolicy type required by evaluateOccurrenceSet. */
function toPolicyShape(doc: PolicyDoc, controlVersion: number): ActivePolicy {
  return {
    id: doc.id,
    version: doc.version,
    policyHash: doc.policyHash,
    policy: doc.policy,
    controlVersion,
  };
}

export type OccurrenceFlipResult = {
  occurrenceId: string;
  sourceSystem: string;
  businessName: string | null;
  activePolicyDisposition: string;
  candidatePolicyDisposition: string;
  flipped: boolean;
};

export type PolicyComparisonResult = {
  policies: {
    active:    { id: string; version: number; hash: string };
    candidate: { id: string; version: number; hash: string };
  };
  selectionHash: string;
  evaluatedAsOf: string;
  totalOccurrences: number;
  flipCount: number;
  /** Rows where the active-policy disposition differs from the candidate-policy disposition */
  flipsBySourceAndDisposition: Array<{
    sourceSystem: string;
    activePolicyDisposition: string;
    candidatePolicyDisposition: string;
    count: number;
  }>;
  sampleFlips: Array<OccurrenceFlipResult>;
  /**
   * Per-occurrence results for the occurrence IDs passed in `trackedOccurrenceIds`.
   * Always populated regardless of `maxSample`. Keyed by occurrence ID.
   */
  trackedResults: Map<string, OccurrenceFlipResult>;
};

/**
 * Compare the active policy against a named draft document.
 * Returns flip counts by sourceSystem × active-policy disposition without writing anything.
 *
 * @param candidateId          UUID of the draft document to compare against.
 * @param executor             Optional DB executor (defaults to global db; useful in tests).
 * @param maxSample            Maximum number of example flips returned in sampleFlips (default 20).
 * @param trackedOccurrenceIds Occurrence IDs whose results are always returned in trackedResults,
 *                             regardless of maxSample. Use this in tests to assert a specific
 *                             occurrence flipped without relying on the bounded sample.
 */
export async function compareCro03aPolicies(
  candidateId: string,
  executor: any = db,
  maxSample = 20,
  trackedOccurrenceIds: readonly string[] = [],
): Promise<PolicyComparisonResult> {
  const [activePolicy, candidateDoc] = await Promise.all([
    getActivePolicy(executor),
    loadPolicyDoc(executor, candidateId),
  ]);

  // Guard: candidate must not be the current active pointer
  if (candidateDoc.id === activePolicy.id) {
    throw new Error("CRO03A_COMPARISON_CANDIDATE_IS_ACTIVE: candidate is already the active policy");
  }
  // Guard: candidate must have the same policy_key as active (same policy family)
  if (candidateDoc.policyKey !== activePolicy.policy.policyKey &&
      candidateDoc.policyKey !== (activePolicy.policy as any).policy_key) {
    // policy_key is stored on the document row, not always inside policy JSON
    const activeRow = resultRows(await executor.execute(sql`
      SELECT policy_key FROM cro03a_policy_documents WHERE id = ${activePolicy.id}::uuid
    `))[0];
    if (!activeRow || String(activeRow.policy_key) !== candidateDoc.policyKey) {
      throw new Error(
        `CRO03A_COMPARISON_POLICY_KEY_MISMATCH: active and candidate share different policy families`,
      );
    }
  }
  // Guard: candidate must be in draft status
  if (candidateDoc.status !== "draft") {
    throw new Error(`CRO03A_COMPARISON_CANDIDATE_NOT_DRAFT: candidate status must be 'draft'; got '${candidateDoc.status}'`);
  }
  // Guard: candidate hash must be valid
  const computedHash = hashCro03Evidence(candidateDoc.policy);
  if (computedHash !== candidateDoc.policyHash) {
    throw new Error(`CRO03A_COMPARISON_HASH_INVALID: stored=${candidateDoc.policyHash} computed=${computedHash}`);
  }

  // Load the eligible occurrence IDs (no stored disposition column)
  const occurrenceIds = await selectEligibleOccurrenceIds(executor);
  const asOf = new Date().toISOString();
  const selectionHash = stableCro03aSelectionHash(occurrenceIds);

  // Load occurrences through the PRODUCTION enrichment path in ≤500-ID batches
  const occurrences = await loadOccurrencesInBatches(occurrenceIds, executor);

  // Build candidate policy shape for evaluateOccurrenceSet
  const candidatePolicy = toPolicyShape(candidateDoc, activePolicy.controlVersion);

  // Run both evaluators over the SAME frozen, enriched occurrence set
  const activeResults   = evaluateOccurrenceSet(occurrences, activePolicy,   asOf);
  const candidateResults = evaluateOccurrenceSet(occurrences, candidatePolicy, asOf);

  // Build disposition maps keyed by occurrenceId
  const activeDisp   = new Map(activeResults  .map(({ occurrence, evaluation }) => [occurrence.occurrenceId, evaluation.disposition]));
  const candidateDisp = new Map(candidateResults.map(({ occurrence, evaluation }) => [occurrence.occurrenceId, evaluation.disposition]));

  const trackedSet = new Set(trackedOccurrenceIds);

  // Group flips
  const flipGroups = new Map<string, { sourceSystem: string; activePolicyDisposition: string; candidatePolicyDisposition: string; count: number }>();
  const allFlips: Array<OccurrenceFlipResult> = [];
  const trackedResults = new Map<string, OccurrenceFlipResult>();

  for (const occ of occurrences) {
    const ad = activeDisp.get(occ.occurrenceId) ?? "excluded";
    const cd = candidateDisp.get(occ.occurrenceId) ?? "excluded";
    const flipped = ad !== cd;
    const flipResult: OccurrenceFlipResult = {
      occurrenceId: occ.occurrenceId,
      sourceSystem: occ.sourceSystem,
      businessName: ((occ.payload as any)?.businessName ?? (occ.payload as any)?.company_name ?? null) as string | null,
      activePolicyDisposition: ad,
      candidatePolicyDisposition: cd,
      flipped,
    };
    if (trackedSet.has(occ.occurrenceId)) {
      trackedResults.set(occ.occurrenceId, flipResult);
    }
    if (!flipped) continue;
    allFlips.push(flipResult);
    const key = `${occ.sourceSystem}|${ad}|${cd}`;
    const existing = flipGroups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      flipGroups.set(key, { sourceSystem: occ.sourceSystem, activePolicyDisposition: ad, candidatePolicyDisposition: cd, count: 1 });
    }
  }

  return {
    policies: {
      active:    { id: activePolicy.id,    version: activePolicy.version,    hash: activePolicy.policyHash },
      candidate: { id: candidateDoc.id,    version: candidateDoc.version,    hash: candidateDoc.policyHash },
    },
    selectionHash,
    evaluatedAsOf: asOf,
    totalOccurrences: occurrences.length,
    flipCount: allFlips.length,
    flipsBySourceAndDisposition: [...flipGroups.values()].sort((a, b) => b.count - a.count),
    sampleFlips: allFlips.slice(0, maxSample),
    trackedResults,
  };
}
