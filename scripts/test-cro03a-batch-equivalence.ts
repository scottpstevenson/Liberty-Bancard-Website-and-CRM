/**
 * Phase 2 — Semantic Equivalence Proof
 *
 * Proves that processCro03aQualificationRunBatch produces identical decisions
 * to what the deterministic evaluateOccurrenceSet pure function produces for
 * the same frozen occurrence set.
 *
 * Checks per occurrence:
 *   - disposition
 *   - score
 *   - reason_codes (sorted)
 *   - missing_field_classes (sorted)
 *   - selection_hash
 *   - algorithm_identity_hash
 *   - handoffs exist iff disposition === "selected"
 *   - run counters reconcile
 *
 * No production data touched.  All writes go to the local dev DB.
 * Run: npx tsx scripts/test-cro03a-batch-equivalence.ts
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  stageCro03aSourceCensus,
  createCro03aQualificationRun,
  processCro03aQualificationRunBatch,
} from "../server/services/cro03a/qualification-service";
import { evaluateCro03aCandidate, CRO03A_FIT_V2_POLICY_IDENTITY } from "../server/services/cro03a/fit";
import { hashCro03Evidence } from "../server/services/cro03/source-staging";

const resultRows = (r: any): any[] => r?.rows ?? r ?? [];
const json = <T>(v: T | string): T =>
  typeof v === "string" ? (JSON.parse(v) as T) : v;
const sorted = (arr: unknown) =>
  JSON.stringify(Array.isArray(arr) ? [...arr].sort() : arr);

const ACTOR_ID = "00000000-0000-0000-0000-000000000001";
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`  ✗ ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

// ── Pure re-implementation of evaluateOccurrenceSet (mirrors service logic) ──
type FrozenOcc = {
  occurrenceId: string; subjectId: string; subjectType: string;
  sourceSystem: string; subjectKey: string; sourceObservedAt: string;
  payloadHash: string; payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
};
type ActivePolicy = {
  id: string; version: number; policyHash: string;
  policy: Record<string, any>; controlVersion: number;
};

const ALLOWED_SELECTABLE = new Set([
  "prospect", "sunbiz_entity", "sdr_merchant",
  "provider_csv_row", "lead_discovery_result", "master_lead",
]);

function evaluateOccurrence(occ: FrozenOcc, policy: ActivePolicy, asOf: string) {
  if (!ALLOWED_SELECTABLE.has(occ.subjectType)) {
    const e = evaluateCro03aCandidate({ payload: occ.payload, sourceSystem: occ.sourceSystem, observedAt: occ.sourceObservedAt, now: asOf, policy: policy.policy });
    return { ...e, disposition: "excluded" as const, reasonCodes: [...e.reasonCodes, "EVIDENCE_ONLY_SOURCE"] };
  }
  if (occ.subjectType === "lead_discovery_result" && occ.payload.merchantId != null) {
    const e = evaluateCro03aCandidate({ payload: occ.payload, sourceSystem: occ.sourceSystem, observedAt: occ.sourceObservedAt, now: asOf, policy: policy.policy });
    return { ...e, disposition: "duplicate" as const, reasonCodes: [...e.reasonCodes, "LINKED_DISCOVERY_COLLAPSED_TO_SDR_MERCHANT"] };
  }
  if (occ.provenance.evidenceOnlyLinkedDiscovery === true) {
    const e = evaluateCro03aCandidate({ payload: occ.payload, sourceSystem: occ.sourceSystem, observedAt: occ.sourceObservedAt, now: asOf, policy: policy.policy });
    return { ...e, disposition: "duplicate" as const, reasonCodes: [...e.reasonCodes, "LINKED_DISCOVERY_COLLAPSED_TO_SDR_MERCHANT"] };
  }
  if (occ.provenance.priorSelectedHandoff === true) {
    const e = evaluateCro03aCandidate({ payload: occ.payload, sourceSystem: occ.sourceSystem, observedAt: occ.sourceObservedAt, now: asOf, policy: policy.policy });
    return { ...e, disposition: "duplicate" as const, reasonCodes: [...e.reasonCodes, "PRIOR_SELECTED_SOURCE_SUBJECT"] };
  }
  return evaluateCro03aCandidate({
    payload: occ.payload, sourceSystem: occ.sourceSystem,
    observedAt: occ.sourceObservedAt, now: asOf,
    relationship: {
      existingCustomer: occ.payload.existingCustomerFlag === true || occ.provenance.existingCustomerFlag === true,
      openOpportunity: occ.payload.openOpportunity === true || occ.provenance.openOpportunity === true,
      dnc: occ.payload.doNotContactFlag === true || occ.provenance.doNotContactFlag === true,
      suppressed: occ.payload.suppressed === true || occ.provenance.suppressed === true,
    },
    identity: {
      exactMatches: Array.isArray(occ.provenance.exactStrongIdentityMatches)
        ? occ.provenance.exactStrongIdentityMatches.map(String) : [],
      conflictingExactMatches: Array.isArray(occ.provenance.conflictingStrongIdentityMatches)
        ? occ.provenance.conflictingStrongIdentityMatches.map(String) : [],
      weakMatches: Array.isArray(occ.provenance.weakIdentityMatches)
        ? occ.provenance.weakIdentityMatches.map(String) : [],
    },
    policy: policy.policy,
  });
}

function evaluateOccurrenceSetPure(occs: FrozenOcc[], policy: ActivePolicy, asOf: string) {
  const selectedSubjects = new Set<string>();
  return occs.map((occ) => {
    let evaluation = evaluateOccurrence(occ, policy, asOf);
    if (evaluation.disposition === "selected" && selectedSubjects.has(occ.subjectId)) {
      evaluation = { ...evaluation, disposition: "duplicate" as const, reasonCodes: [...evaluation.reasonCodes, "DUPLICATE_SUBJECT_IN_RUN"] };
    }
    if (evaluation.disposition === "selected") selectedSubjects.add(occ.subjectId);
    return { occurrence: occ, evaluation };
  });
}

function algorithmIdentityFor(policy: Record<string, any>) {
  return policy.fitVersion === "fit-v2"
    ? { ...CRO03A_FIT_V2_POLICY_IDENTITY, policy }
    : { fitVersion: "fit-v1", policy };
}

async function main() {
  console.log("=== Phase 2 — Semantic Equivalence Proof ===\n");

  // ── 1. Verify active policy ────────────────────────────────────────────────
  const policyRow = resultRows(await db.execute(sql`
    SELECT p.id, p.version, p.policy_hash, p.policy
      FROM cro03a_policy_documents p
      JOIN cro03a_policy_control c ON c.active_policy_id = p.id
     WHERE c.id = 1
  `))[0];
  if (!policyRow) throw new Error("No active policy in local DB.");
  const policy: ActivePolicy = {
    id: String(policyRow.id), version: Number(policyRow.version),
    policyHash: String(policyRow.policy_hash),
    policy: json<Record<string, any>>(policyRow.policy),
    controlVersion: 0,
  };
  console.log(`Active policy: ${policy.id} v${policy.version}`);

  // ── 2. Stage fresh occurrences ─────────────────────────────────────────────
  console.log("Staging census page (limitPerSource=50)…");
  const staged = await stageCro03aSourceCensus({ actorId: ACTOR_ID, limitPerSource: 50 });
  console.log(`  created=${staged.created} replayed=${staged.replayed}`);

  const candidateRows = resultRows(await db.execute(sql`
    SELECT DISTINCT ON (s.id) o.id AS occurrence_id
      FROM cro03_source_occurrences o
      JOIN cro03_source_subjects s ON s.id = o.source_subject_id
     WHERE s.subject_type IN ('prospect','sunbiz_entity','sdr_merchant',
                              'provider_csv_row','lead_discovery_result','master_lead')
     ORDER BY s.id, o.source_observed_at DESC, o.ingested_at DESC, o.id DESC
     LIMIT 134
  `));
  const occurrenceIds = candidateRows.map((r: any) => String(r.occurrence_id));
  console.log(`Occurrence candidates: ${occurrenceIds.length}`);
  if (occurrenceIds.length < 10) throw new Error("Too few occurrences.");

  // ── 3. Create run ──────────────────────────────────────────────────────────
  const ikey = `batch-equiv-${Date.now()}`;
  const runResult = await createCro03aQualificationRun({
    idempotencyKey: ikey, occurrenceIds, actorId: ACTOR_ID, actorRole: "admin",
  });
  const runId = runResult.id;
  console.log(`Run: ${runId}  total=${runResult.totalCount}`);

  // ── 4. Run batch processor (timed) ────────────────────────────────────────
  console.log("\nRunning batch processor…");
  const t0 = Date.now();
  await processCro03aQualificationRunBatch(runId);
  const elapsed = Date.now() - t0;
  console.log(`  done in ${elapsed}ms`);

  // ── 5. Load written decisions ──────────────────────────────────────────────
  const writtenRows = resultRows(await db.execute(sql`
    SELECT d.occurrence_id, d.disposition, d.score,
           d.reason_codes, d.missing_field_classes,
           d.selection_hash, d.algorithm_identity_hash,
           i.ordinal
      FROM cro03a_qualification_decisions d
      JOIN cro03a_qualification_items i ON i.id = d.item_id
     WHERE d.run_id = ${runId}::uuid ORDER BY i.ordinal
  `));

  // ── 6. Re-assemble occurrences the same way the batch processor did ────────
  const runRow = resultRows(await db.execute(sql`
    SELECT frozen_occurrence_ids, created_at FROM cro03a_qualification_runs WHERE id = ${runId}::uuid
  `))[0];
  const frozenIds = json<string[]>(runRow.frozen_occurrence_ids);

  const occRows = resultRows(await db.execute(sql`
    SELECT o.id AS occurrence_id, o.source_subject_id, s.subject_type, s.source_system,
           s.subject_key, o.source_observed_at, o.payload_hash, v.payload, v.provenance
      FROM cro03_source_occurrences o
      JOIN cro03_source_subjects s ON s.id = o.source_subject_id
      JOIN cro03_source_observations v ON v.id = o.source_observation_id
     WHERE o.id IN (${sql.join(frozenIds.map((id) => sql`${id}::uuid`), sql`,`)})
     ORDER BY o.id
  `));

  const authRows = resultRows(await db.execute(sql`
    SELECT occurrence_id, authority_evidence, authority_evaluated_at
      FROM cro03a_qualification_items WHERE run_id = ${runId}::uuid
  `));
  const authByOcc = new Map(
    authRows.map((r: any) => [String(r.occurrence_id), {
      evidence: json<Record<string, unknown>>(r.authority_evidence),
      at: new Date(r.authority_evaluated_at).toISOString(),
    }])
  );

  // Build occurrence map and apply authority evidence
  const occMap = new Map<string, FrozenOcc>();
  for (const row of occRows) {
    const occ: FrozenOcc = {
      occurrenceId: String(row.occurrence_id),
      subjectId: String(row.source_subject_id),
      subjectType: String(row.subject_type),
      sourceSystem: String(row.source_system),
      subjectKey: String(row.subject_key),
      sourceObservedAt: new Date(row.source_observed_at).toISOString(),
      payloadHash: String(row.payload_hash),
      payload: json<Record<string, unknown>>(row.payload),
      provenance: json<Record<string, unknown>>(row.provenance),
    };
    const auth = authByOcc.get(occ.occurrenceId);
    if (auth) occ.provenance = { ...occ.provenance, ...auth.evidence, authorityEvaluatedAt: auth.at };
    occMap.set(occ.occurrenceId, occ);
  }

  // Sort in frozen ordinal order
  const orderedOccs = frozenIds.map((id) => occMap.get(id)).filter(Boolean) as FrozenOcc[];
  check("occurrence count", orderedOccs.length, frozenIds.length);

  // ── 7. Re-evaluate with pure function ─────────────────────────────────────
  const evaluatedAsOf = new Date(runRow.created_at).toISOString();
  const freshEvals = evaluateOccurrenceSetPure(orderedOccs, policy, evaluatedAsOf);

  const algIdentity = algorithmIdentityFor(policy.policy);
  const algIdentityHash = hashCro03Evidence(algIdentity);

  // ── 8. Field-by-field comparison ─────────────────────────────────────────
  console.log("\nComparing written decisions to fresh pure-function evaluations…");
  check("decision count", writtenRows.length, runResult.totalCount);

  const writtenByOcc = new Map(writtenRows.map((r: any) => [String(r.occurrence_id), r]));

  for (const { occurrence: occ, evaluation } of freshEvals) {
    const w = writtenByOcc.get(occ.occurrenceId);
    if (!w) { fail++; failures.push(`  ✗ Missing decision for ${occ.occurrenceId}`); continue; }

    check(`[${occ.occurrenceId.slice(0, 8)}] disposition`, String(w.disposition), evaluation.disposition);
    check(`[${occ.occurrenceId.slice(0, 8)}] score`, Number(w.score), evaluation.score);
    check(`[${occ.occurrenceId.slice(0, 8)}] reason_codes`, sorted(json(w.reason_codes)), sorted(evaluation.reasonCodes));
    check(`[${occ.occurrenceId.slice(0, 8)}] missing_field_classes`, sorted(json(w.missing_field_classes)), sorted(evaluation.missingFieldClasses));

    const freshHash = hashCro03Evidence({
      occurrenceIds: [occ.occurrenceId], payloadHash: occ.payloadHash,
      policyId: policy.id, policyHash: policy.policyHash, disposition: evaluation.disposition,
      algorithmIdentityHash: algIdentityHash, score: evaluation.score, components: evaluation.fitComponents,
    });
    check(`[${occ.occurrenceId.slice(0, 8)}] selection_hash`, String(w.selection_hash), freshHash);
    check(`[${occ.occurrenceId.slice(0, 8)}] alg_identity_hash`, String(w.algorithm_identity_hash), algIdentityHash);
  }

  // ── 9. Handoff integrity ──────────────────────────────────────────────────
  const handoffRows = resultRows(await db.execute(sql`
    SELECT id, source_key FROM cro03a_handoffs WHERE run_id = ${runId}::uuid
  `));
  const freshSelected = freshEvals.filter(({ evaluation }) => evaluation.disposition === "selected");
  check("handoff count == selected count", handoffRows.length, freshSelected.length);

  // ── 10. Run-state and counter reconciliation ──────────────────────────────
  const finalRun = resultRows(await db.execute(sql`
    SELECT state, total_count, selected_count, review_count, terminal_count
      FROM cro03a_qualification_runs WHERE id = ${runId}::uuid
  `))[0];
  check("run.state", String(finalRun.state), "completed");
  check("run.terminal_count == total_count", Number(finalRun.terminal_count), Number(finalRun.total_count));
  check("run.selected_count == handoff_count", Number(finalRun.selected_count), handoffRows.length);
  check("run.review_count == fresh review count",
    Number(finalRun.review_count),
    freshEvals.filter(({ evaluation }) => evaluation.disposition === "review_required").length);

  // ── 11. Evaluate-once proof: no extra DB writes ───────────────────────────
  // Every item has exactly one decision (ON CONFLICT ensures this)
  const itemsWithMultipleDecisions = resultRows(await db.execute(sql`
    SELECT item_id, COUNT(*) AS cnt
      FROM cro03a_qualification_decisions WHERE run_id = ${runId}::uuid
     GROUP BY item_id HAVING COUNT(*) > 1
  `));
  check("no duplicate decisions", itemsWithMultipleDecisions.length, 0);

  // ── 12. Performance ───────────────────────────────────────────────────────
  const n = runResult.totalCount;
  console.log(`\nPerformance: ${n} occurrences in ${elapsed}ms (${(elapsed / n).toFixed(0)} ms/occ)`);
  if (elapsed < 30000) { pass++; console.log("  ✓ within 30-second target"); }
  else { fail++; failures.push(`  ✗ exceeded 30-second target (${elapsed}ms)`); }

  // ── Disposition summary ───────────────────────────────────────────────────
  const counts: Record<string, number> = {};
  for (const { evaluation } of freshEvals) counts[evaluation.disposition] = (counts[evaluation.disposition] ?? 0) + 1;
  console.log("\nDisposition breakdown (fresh evaluation):");
  Object.entries(counts).sort(([, a], [, b]) => b - a).forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  // ── Summary ───────────────────────────────────────────────────────────────
  if (failures.length) { console.error("\nFailures:"); failures.forEach((f) => console.error(f)); }
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
