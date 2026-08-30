import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { prospects, sunbizEntities, sdrMerchants, leadDiscoveryResults, masterLeads } from "@shared/schema";
import { hashCro03Evidence } from "../cro03/source-staging";
import { createCro03SourceBatch } from "../cro03/source-staging";
import { stableCro03aSelectionHash } from "../cro03/contracts";
import { evaluateCro03aCandidate, type Cro03aEvaluation } from "./fit";
import {
  CRO03A_SOURCE_CENSUS,
  leadDiscoverySourceSubject,
  linkedDiscoveryEvidence,
  masterLeadSourceSubject,
  prospectSourceSubject,
  sdrMerchantSourceSubject,
  sunbizSourceSubject,
  type Cro03aSourceDraft,
} from "./adapters";

const resultRows = (result: any): any[] => result?.rows ?? result ?? [];
const json = <T>(value: T | string): T => typeof value === "string" ? JSON.parse(value) as T : value;
const allowedSelectableTypes = new Set(["prospect", "sunbiz_entity", "sdr_merchant", "provider_csv_row", "lead_discovery_result", "master_lead"]);

type FrozenOccurrence = {
  occurrenceId: string; subjectId: string; subjectType: string; sourceSystem: string;
  subjectKey: string; sourceObservedAt: string; payloadHash: string;
  payload: Record<string, unknown>; provenance: Record<string, unknown>;
};
type ActivePolicy = { id: string; version: number; policyHash: string; policy: Record<string, any>; controlVersion: number };

async function getActivePolicy(executor: any = db): Promise<ActivePolicy> {
  const row = resultRows(await executor.execute(sql`
    SELECT p.id,p.version,p.policy_hash,p.policy,c.expected_version
      FROM cro03a_policy_control c
      JOIN cro03a_policy_documents p ON p.id=c.active_policy_id
     WHERE c.id=1
  `))[0];
  if (!row) throw new Error("CRO03A_ACTIVE_POLICY_REQUIRED");
  return {
    id: String(row.id), version: Number(row.version), policyHash: String(row.policy_hash),
    policy: json(row.policy), controlVersion: Number(row.expected_version),
  };
}

async function loadOccurrences(
  ids: readonly string[],
  executor: any = db,
  options: { enrichRelationships?: boolean } = {},
): Promise<FrozenOccurrence[]> {
  const unique = [...new Set(ids)].sort();
  if (!unique.length || unique.length > 500 || unique.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error("CRO03A_INVALID_OCCURRENCE_SCOPE");
  }
  const result = await executor.execute(sql`
    SELECT o.id AS occurrence_id,o.source_subject_id,s.subject_type,s.source_system,s.subject_key,
           o.source_observed_at,o.payload_hash,v.payload,v.provenance
      FROM cro03_source_occurrences o
      JOIN cro03_source_subjects s ON s.id=o.source_subject_id
      JOIN cro03_source_observations v ON v.id=o.source_observation_id
     WHERE o.id = ANY(${unique}::uuid[])
     ORDER BY o.id
  `);
  const loaded = resultRows(result).map((row) => ({
    occurrenceId: String(row.occurrence_id), subjectId: String(row.source_subject_id),
    subjectType: String(row.subject_type), sourceSystem: String(row.source_system),
    subjectKey: String(row.subject_key), sourceObservedAt: new Date(row.source_observed_at).toISOString(),
    payloadHash: String(row.payload_hash), payload: json(row.payload), provenance: json(row.provenance),
  }));
  if (loaded.length !== unique.length) throw new Error("CRO03A_OCCURRENCE_NOT_FOUND");
  if (options.enrichRelationships === false) return loaded;
  for (const occurrence of loaded) {
    const prior = resultRows(await executor.execute(sql`
      SELECT id FROM cro03a_handoffs
       WHERE source_type=${occurrence.subjectType} AND source_system=${occurrence.sourceSystem}
         AND source_key=${occurrence.subjectKey}
       LIMIT 1
    `))[0];
    if (prior) occurrence.provenance.priorSelectedHandoff = true;
    if (occurrence.subjectType === "prospect" && /^\d+$/.test(occurrence.subjectKey)) {
      const relation = resultRows(await executor.execute(sql`
        SELECT p.contact_id,p.conversion_contact_id,p.do_not_contact,p.record_class,
               c.do_not_contact AS contact_dnc,c.opted_out_email,c.business_id,
               EXISTS (
                 SELECT 1 FROM deals d
                  WHERE d.contact_id=COALESCE(p.contact_id,p.conversion_contact_id)
                    AND lower(COALESCE(d.status,'')) NOT LIKE '%closed%'
                    AND lower(COALESCE(d.status,'')) NOT LIKE '%lost%'
               ) AS open_opportunity
          FROM prospects p
          LEFT JOIN contacts c ON c.id=COALESCE(p.contact_id,p.conversion_contact_id)
         WHERE p.id=${Number(occurrence.subjectKey)}
      `))[0];
      if (relation) {
        occurrence.provenance.existingCustomerFlag =
          relation.record_class === "customer" || relation.business_id != null;
        occurrence.provenance.doNotContactFlag =
          relation.do_not_contact === true || relation.contact_dnc === true || relation.opted_out_email === true;
        occurrence.provenance.openOpportunity = relation.open_opportunity === true;
        if (relation.contact_id != null || relation.conversion_contact_id != null) {
          occurrence.provenance.exactStrongIdentityMatches = ["canonical_contact_fk"];
        }
      }
    }
    if (occurrence.subjectType === "sdr_merchant") {
      const match = occurrence.subjectKey.match(/(?:row:)?(\d+)$/);
      if (match) {
        const relation = resultRows(await executor.execute(sql`
          SELECT business_id,existing_customer_flag,do_not_contact_flag,
                 ghl_contact_id,ghl_opportunity_id
            FROM sdr_merchants WHERE id=${Number(match[1])}
        `))[0];
        if (relation) {
          occurrence.provenance.existingCustomerFlag =
            relation.existing_customer_flag === true || relation.business_id != null || relation.ghl_contact_id != null;
          occurrence.provenance.doNotContactFlag = relation.do_not_contact_flag === true;
          occurrence.provenance.openOpportunity = relation.ghl_opportunity_id != null;
          if (relation.business_id != null) occurrence.provenance.exactStrongIdentityMatches = ["canonical_business_fk"];
        }
      }
    }
  }
  return loaded;
}

function evaluateOccurrence(occurrence: FrozenOccurrence, policy: ActivePolicy, asOf: string): Cro03aEvaluation {
  if (!allowedSelectableTypes.has(occurrence.subjectType)) {
    const evaluation = evaluateCro03aCandidate({
      payload: occurrence.payload, sourceSystem: occurrence.sourceSystem,
      observedAt: occurrence.sourceObservedAt, now: asOf, policy: policy.policy,
    });
    return { ...evaluation, disposition: "excluded", reasonCodes: [...evaluation.reasonCodes, "EVIDENCE_ONLY_SOURCE"] };
  }
  if (occurrence.subjectType === "lead_discovery_result" && occurrence.payload.merchantId != null) {
    const evaluation = evaluateCro03aCandidate({
      payload: occurrence.payload, sourceSystem: occurrence.sourceSystem,
      observedAt: occurrence.sourceObservedAt, now: asOf, policy: policy.policy,
    });
    return { ...evaluation, disposition: "duplicate", reasonCodes: [...evaluation.reasonCodes, "LINKED_DISCOVERY_COLLAPSED_TO_SDR_MERCHANT"] };
  }
  if (occurrence.provenance.evidenceOnlyLinkedDiscovery === true) {
    const evaluation = evaluateCro03aCandidate({
      payload: occurrence.payload, sourceSystem: occurrence.sourceSystem,
      observedAt: occurrence.sourceObservedAt, now: asOf, policy: policy.policy,
    });
    return { ...evaluation, disposition: "duplicate", reasonCodes: [...evaluation.reasonCodes, "LINKED_DISCOVERY_COLLAPSED_TO_SDR_MERCHANT"] };
  }
  if (occurrence.provenance.priorSelectedHandoff === true) {
    const evaluation = evaluateCro03aCandidate({
      payload: occurrence.payload, sourceSystem: occurrence.sourceSystem,
      observedAt: occurrence.sourceObservedAt, now: asOf, policy: policy.policy,
    });
    return { ...evaluation, disposition: "duplicate", reasonCodes: [...evaluation.reasonCodes, "PRIOR_SELECTED_SOURCE_SUBJECT"] };
  }
  return evaluateCro03aCandidate({
    payload: occurrence.payload, sourceSystem: occurrence.sourceSystem,
    observedAt: occurrence.sourceObservedAt, now: asOf,
    relationship: {
      existingCustomer: occurrence.payload.existingCustomerFlag === true || occurrence.provenance.existingCustomerFlag === true,
      openOpportunity: occurrence.payload.openOpportunity === true || occurrence.provenance.openOpportunity === true,
      dnc: occurrence.payload.doNotContactFlag === true || occurrence.provenance.doNotContactFlag === true,
      suppressed: occurrence.payload.suppressed === true || occurrence.provenance.suppressed === true,
    },
    identity: {
      exactMatches: Array.isArray(occurrence.provenance.exactStrongIdentityMatches) ? occurrence.provenance.exactStrongIdentityMatches.map(String) : [],
      conflictingExactMatches: Array.isArray(occurrence.provenance.conflictingStrongIdentityMatches) ? occurrence.provenance.conflictingStrongIdentityMatches.map(String) : [],
      weakMatches: Array.isArray(occurrence.provenance.weakIdentityMatches) ? occurrence.provenance.weakIdentityMatches.map(String) : [],
    },
    policy: policy.policy,
  });
}

function evaluateOccurrenceSet(occurrences: FrozenOccurrence[], policy: ActivePolicy, asOf: string) {
  const selectedSubjects = new Set<string>();
  return occurrences.map((occurrence) => {
    let evaluation = evaluateOccurrence(occurrence, policy, asOf);
    if (evaluation.disposition === "selected" && selectedSubjects.has(occurrence.subjectId)) {
      evaluation = { ...evaluation, disposition: "duplicate", reasonCodes: [...evaluation.reasonCodes, "DUPLICATE_SUBJECT_IN_RUN"] };
    }
    if (evaluation.disposition === "selected") selectedSubjects.add(occurrence.subjectId);
    return { occurrence, evaluation };
  });
}

export async function previewCro03aQualification(occurrenceIds: readonly string[]) {
  const policy = await getActivePolicy();
  const occurrences = await loadOccurrences(occurrenceIds);
  const asOf = new Date().toISOString();
  const items = evaluateOccurrenceSet(occurrences, policy, asOf).map(({ occurrence, evaluation }) => ({
    occurrenceId: occurrence.occurrenceId,
    source: { type: occurrence.subjectType, system: occurrence.sourceSystem, keyHash: hashCro03Evidence(occurrence.subjectKey) },
    evaluation,
  }));
  return {
    policy: { id: policy.id, version: policy.version, hash: policy.policyHash },
    selectionHash: stableCro03aSelectionHash(occurrences.map((row) => row.occurrenceId)),
    total: items.length,
    evaluatedAsOf: asOf,
    dispositionCounts: items.reduce<Record<string, number>>((counts, item) => {
      counts[item.evaluation.disposition] = (counts[item.evaluation.disposition] ?? 0) + 1;
      return counts;
    }, {}),
    items,
    effectAuthorized: false,
  };
}

export async function createCro03aQualificationRun(input: {
  idempotencyKey: string; occurrenceIds: readonly string[]; actorId: string; actorRole: "admin" | "manager";
}) {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) throw new Error("CRO03A_INVALID_IDEMPOTENCY_KEY");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"cro03a:" + input.idempotencyKey},0))`);
    const requestedOccurrenceIds = [...new Set(input.occurrenceIds)].sort();
    const existing = resultRows(await tx.execute(sql`
      SELECT id,scope_hash,state,total_count,selected_count,review_count,terminal_count,
             frozen_occurrence_ids
        FROM cro03a_qualification_runs WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (existing) {
      const frozen = json<string[]>(existing.frozen_occurrence_ids).map(String).sort();
      if (stableCro03aSelectionHash(frozen) !== stableCro03aSelectionHash(requestedOccurrenceIds)) {
        throw new Error("CRO03A_IDEMPOTENCY_SCOPE_CONFLICT");
      }
      return {
        id: String(existing.id), replayed: true, state: String(existing.state),
        totalCount: Number(existing.total_count), selectedCount: Number(existing.selected_count),
        reviewCount: Number(existing.review_count), terminalCount: Number(existing.terminal_count),
      };
    }
    const policy = await getActivePolicy(tx);
    const occurrences = await loadOccurrences(requestedOccurrenceIds, tx);
    const authorityEvaluatedAt = new Date().toISOString();
    const frozenOccurrenceIds = occurrences.map((row) => row.occurrenceId).sort();
    const selectionHash = stableCro03aSelectionHash(frozenOccurrenceIds);
    const scopeHash = hashCro03Evidence({ frozenOccurrenceIds, policyId: policy.id, policyHash: policy.policyHash });
    const run = resultRows(await tx.execute(sql`
      INSERT INTO cro03a_qualification_runs
        (idempotency_key,actor_id,actor_role,policy_id,policy_hash,scope_hash,frozen_occurrence_ids,
          state,total_count)
      VALUES (${input.idempotencyKey},${input.actorId},${input.actorRole},${policy.id}::uuid,
              ${policy.policyHash},${scopeHash},${JSON.stringify(frozenOccurrenceIds)}::jsonb,
               'queued',${occurrences.length})
      RETURNING id
    `))[0];
    for (const [ordinal, occurrence] of occurrences.entries()) {
      await tx.execute(sql`
        INSERT INTO cro03a_qualification_items
          (run_id,occurrence_id,ordinal,state,authority_evidence,authority_evaluated_at)
        VALUES (${run.id}::uuid,${occurrence.occurrenceId}::uuid,${ordinal},'queued',
                ${JSON.stringify(occurrence.provenance)}::jsonb,${authorityEvaluatedAt}::timestamptz)
      `);
    }
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03a_qualification_run_queued','cro03a_qualification_run',
              ${String(run.id)},${JSON.stringify({ total: occurrences.length, selectionHash })}::jsonb,
              'user',${input.actorId})
    `);
    return { id: String(run.id), replayed: false, state: "queued", totalCount: occurrences.length, selectedCount: 0, reviewCount: 0, terminalCount: 0 };
  });
  if (!result.replayed) {
    void processCro03aQualificationRun(result.id).catch((error) => {
      console.error("CRO03A_QUALIFICATION_WORKER_FAILED", { runId: result.id, error });
    });
  }
  return result;
}

type ClaimedQualificationItem = {
  id: string; occurrenceId: string; claimToken: string; executionFence: number;
  runId: string; policyId: string; policyHash: string; actorId: string; evaluatedAsOf: string;
  authorityEvidence: Record<string, unknown>; authorityEvaluatedAt: string;
};

async function claimNextCro03aItem(runId: string): Promise<ClaimedQualificationItem | null> {
  return db.transaction(async (tx) => {
    const run = resultRows(await tx.execute(sql`
      SELECT id,policy_id,policy_hash,actor_id,state,created_at
        FROM cro03a_qualification_runs WHERE id=${runId}::uuid FOR UPDATE
    `))[0];
    if (!run || !["queued", "running"].includes(String(run.state))) return null;
    const activeClaim = resultRows(await tx.execute(sql`
      SELECT 1 FROM cro03a_qualification_items
       WHERE run_id=${runId}::uuid AND state='claimed' AND lease_expires_at > NOW()
       LIMIT 1
    `))[0];
    if (activeClaim) return null;
    const item = resultRows(await tx.execute(sql`
      UPDATE cro03a_qualification_items
         SET state='claimed',claim_token=gen_random_uuid(),
             lease_expires_at=NOW()+INTERVAL '2 minutes',
             execution_fence=execution_fence+1,updated_at=NOW()
       WHERE id=(
         SELECT id FROM cro03a_qualification_items
          WHERE run_id=${runId}::uuid
            AND (state='queued' OR (state='claimed' AND lease_expires_at <= NOW()))
          ORDER BY ordinal
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id,occurrence_id,claim_token,execution_fence,authority_evidence,authority_evaluated_at
    `))[0];
    if (!item) return null;
    await tx.execute(sql`
      UPDATE cro03a_qualification_runs
         SET state='running',started_at=COALESCE(started_at,NOW()),updated_at=NOW()
       WHERE id=${runId}::uuid AND state IN ('queued','running')
    `);
    return {
      id: String(item.id), occurrenceId: String(item.occurrence_id),
      claimToken: String(item.claim_token), executionFence: Number(item.execution_fence),
      runId, policyId: String(run.policy_id), policyHash: String(run.policy_hash), actorId: String(run.actor_id),
      evaluatedAsOf: new Date(run.created_at).toISOString(),
      authorityEvidence: json(item.authority_evidence),
      authorityEvaluatedAt: new Date(item.authority_evaluated_at).toISOString(),
    };
  });
}

async function reconcileCro03aRun(executor: any, runId: string) {
  const totals = resultRows(await executor.execute(sql`
    SELECT COUNT(*) FILTER (WHERE i.state IN ('completed','cancelled'))::int AS terminal_count,
           COUNT(*) FILTER (WHERE i.state='completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE d.disposition='selected')::int AS selected_count,
           COUNT(*) FILTER (WHERE d.disposition='review_required')::int AS review_count,
           COUNT(*)::int AS total_count
      FROM cro03a_qualification_items i
      LEFT JOIN cro03a_qualification_decisions d ON d.item_id=i.id
     WHERE i.run_id=${runId}::uuid
  `))[0];
  const completed = Number(totals.completed_count) === Number(totals.total_count);
  const updated = resultRows(await executor.execute(sql`
    UPDATE cro03a_qualification_runs
       SET total_count=${Number(totals.total_count)},
           selected_count=${Number(totals.selected_count)},
           review_count=${Number(totals.review_count)},
           terminal_count=${Number(totals.terminal_count)},
           cursor_position=${Number(totals.terminal_count)},
           state=CASE WHEN state IN ('queued','running') AND ${completed} THEN 'completed' ELSE state END,
           completed_at=CASE WHEN state IN ('queued','running') AND ${completed} THEN COALESCE(completed_at,NOW()) ELSE completed_at END,
           updated_at=NOW()
     WHERE id=${runId}::uuid
     RETURNING state
  `))[0];
  return String(updated?.state ?? "");
}

async function completeClaimedCro03aItem(claim: ClaimedQualificationItem): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = resultRows(await tx.execute(sql`
      SELECT i.id
        FROM cro03a_qualification_items i
        JOIN cro03a_qualification_runs r ON r.id=i.run_id
       WHERE i.id=${claim.id}::uuid AND i.state='claimed'
         AND i.claim_token=${claim.claimToken}::uuid AND i.execution_fence=${claim.executionFence}
         AND i.lease_expires_at > NOW() AND r.state='running'
       FOR UPDATE
    `))[0];
    if (!locked) return false;
    const runRow = resultRows(await tx.execute(sql`
      SELECT frozen_occurrence_ids FROM cro03a_qualification_runs WHERE id=${claim.runId}::uuid
    `))[0];
    const policyRow = resultRows(await tx.execute(sql`
      SELECT id,version,policy_hash,policy FROM cro03a_policy_documents WHERE id=${claim.policyId}::uuid
    `))[0];
    if (!runRow || !policyRow || String(policyRow.policy_hash) !== claim.policyHash) {
      throw new Error("CRO03A_FROZEN_POLICY_INVALID");
    }
    const frozenIds = json<string[]>(runRow.frozen_occurrence_ids);
    let occurrences = await loadOccurrences(frozenIds, tx, { enrichRelationships: false });
    const occurrence = occurrences.find((row) => row.occurrenceId === claim.occurrenceId);
    if (!occurrence) throw new Error("CRO03A_OCCURRENCE_NOT_FOUND");
    occurrence.provenance = { ...occurrence.provenance, ...claim.authorityEvidence, authorityEvaluatedAt: claim.authorityEvaluatedAt };
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"cro03a-subject:" + occurrence.subjectId},0))`);
    occurrences = await loadOccurrences(frozenIds, tx, { enrichRelationships: false });
    const authorityRows = resultRows(await tx.execute(sql`
      SELECT occurrence_id,authority_evidence,authority_evaluated_at
        FROM cro03a_qualification_items WHERE run_id=${claim.runId}::uuid
    `));
    const authorityByOccurrence = new Map(authorityRows.map((row) => [
      String(row.occurrence_id),
      { evidence: json<Record<string, unknown>>(row.authority_evidence), at: new Date(row.authority_evaluated_at).toISOString() },
    ]));
    for (const frozenOccurrence of occurrences) {
      const authority = authorityByOccurrence.get(frozenOccurrence.occurrenceId);
      if (authority) frozenOccurrence.provenance = {
        ...frozenOccurrence.provenance, ...authority.evidence, authorityEvaluatedAt: authority.at,
      };
    }
    const priorHandoff = resultRows(await tx.execute(sql`
      SELECT id FROM cro03a_handoffs
       WHERE source_type=${occurrence.subjectType} AND source_system=${occurrence.sourceSystem}
         AND source_key=${occurrence.subjectKey} LIMIT 1
    `))[0];
    if (priorHandoff) {
      const currentOccurrence = occurrences.find((row) => row.occurrenceId === claim.occurrenceId);
      if (currentOccurrence) currentOccurrence.provenance.priorSelectedHandoff = true;
    }
    const policy: ActivePolicy = {
      id: String(policyRow.id), version: Number(policyRow.version),
      policyHash: String(policyRow.policy_hash), policy: json(policyRow.policy), controlVersion: 0,
    };
    const frozen = evaluateOccurrenceSet(occurrences, policy, claim.evaluatedAsOf)
      .find((row) => row.occurrence.occurrenceId === claim.occurrenceId);
    if (!frozen) throw new Error("CRO03A_OCCURRENCE_NOT_FOUND");
    const { evaluation } = frozen;
    const decisionSelectionHash = hashCro03Evidence({
      occurrenceIds: [occurrence.occurrenceId], payloadHash: occurrence.payloadHash,
      policyId: policy.id, policyHash: policy.policyHash, disposition: evaluation.disposition,
      score: evaluation.score, components: evaluation.fitComponents,
    });
    const decision = resultRows(await tx.execute(sql`
      INSERT INTO cro03a_qualification_decisions
        (item_id,run_id,occurrence_id,disposition,score,geography_result,vertical_result,
         active_state_evidence,identity_relationship_evidence,fit_components,reason_codes,
         missing_field_classes,frozen_occurrence_ids,policy_id,policy_version,policy_hash,selection_hash)
      VALUES (${claim.id}::uuid,${claim.runId}::uuid,${occurrence.occurrenceId}::uuid,
              ${evaluation.disposition},${evaluation.score},${JSON.stringify(evaluation.geography)}::jsonb,
              ${JSON.stringify(evaluation.vertical)}::jsonb,${JSON.stringify(evaluation.activeStateEvidence)}::jsonb,
              ${JSON.stringify(evaluation.identityRelationshipEvidence)}::jsonb,
              ${JSON.stringify(evaluation.fitComponents)}::jsonb,${JSON.stringify(evaluation.reasonCodes)}::jsonb,
              ${JSON.stringify(evaluation.missingFieldClasses)}::jsonb,
              ${JSON.stringify([occurrence.occurrenceId])}::jsonb,${policy.id}::uuid,${policy.version},
              ${policy.policyHash},${decisionSelectionHash})
      ON CONFLICT(item_id) DO NOTHING
      RETURNING id
    `))[0];
    if (!decision) return false;
    if (evaluation.disposition === "selected") {
      await tx.execute(sql`
        INSERT INTO cro03a_handoffs
          (run_id,decision_id,source_type,source_system,source_key,occurrence_ids,
           policy_id,policy_version,policy_hash,reason_codes,missing_field_classes,
           selection_hash,effect_authorized)
        VALUES (${claim.runId}::uuid,${decision.id}::uuid,${occurrence.subjectType},${occurrence.sourceSystem},
                ${occurrence.subjectKey},${JSON.stringify([occurrence.occurrenceId])}::jsonb,
                ${policy.id}::uuid,${policy.version},${policy.policyHash},
                ${JSON.stringify(evaluation.reasonCodes)}::jsonb,${JSON.stringify(evaluation.missingFieldClasses)}::jsonb,
                ${decisionSelectionHash},FALSE)
      `);
    }
    const completed = resultRows(await tx.execute(sql`
      UPDATE cro03a_qualification_items
         SET state='completed',claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${claim.id}::uuid AND state='claimed'
         AND claim_token=${claim.claimToken}::uuid AND execution_fence=${claim.executionFence}
       RETURNING id
    `))[0];
    if (!completed) throw new Error("CRO03A_ITEM_FENCE_LOST");
    const state = await reconcileCro03aRun(tx, claim.runId);
    if (state === "completed") {
      await tx.execute(sql`
        INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
        SELECT ${claim.actorId},'cro03a_qualification_run_completed','cro03a_qualification_run',
               ${claim.runId},jsonb_build_object('reconciled',TRUE),'user',${claim.actorId}
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_logs
            WHERE action='cro03a_qualification_run_completed' AND entity_key=${claim.runId}
         )
      `);
    }
    return true;
  });
}

export async function processCro03aQualificationRun(runId: string): Promise<void> {
  for (;;) {
    const claim = await claimNextCro03aItem(runId);
    if (!claim) return;
    if (!await completeClaimedCro03aItem(claim)) return;
  }
}

export async function getCro03aRun(runId: string, actorId: string, role: string) {
  let run = resultRows(await db.execute(sql`
    SELECT id,actor_id,state,total_count,selected_count,review_count,terminal_count,
           cursor_position,created_at,completed_at,cancel_requested_at
      FROM cro03a_qualification_runs WHERE id=${runId}::uuid
  `))[0];
  if (!run || (role !== "admin" && String(run.actor_id) !== actorId)) return null;
  if (["queued", "running"].includes(String(run.state))) {
    await reconcileCro03aRun(db, runId);
    void processCro03aQualificationRun(runId).catch((error) => {
      console.error("CRO03A_QUALIFICATION_WORKER_FAILED", { runId, error });
    });
    run = resultRows(await db.execute(sql`
      SELECT id,actor_id,state,total_count,selected_count,review_count,terminal_count,
             cursor_position,created_at,completed_at,cancel_requested_at
        FROM cro03a_qualification_runs WHERE id=${runId}::uuid
    `))[0];
  }
  const decisions = resultRows(await db.execute(sql`
    SELECT d.id,d.disposition,d.score,d.reason_codes,d.missing_field_classes,d.selection_hash,
           s.subject_type,s.source_system,encode(digest(s.subject_key,'sha256'),'hex') AS source_key_hash,
           h.id AS handoff_id,h.effect_authorized
      FROM cro03a_qualification_decisions d
      JOIN cro03_source_occurrences o ON o.id=d.occurrence_id
      JOIN cro03_source_subjects s ON s.id=o.source_subject_id
      LEFT JOIN cro03a_handoffs h ON h.decision_id=d.id
     WHERE d.run_id=${runId}::uuid ORDER BY d.created_at,d.id
  `));
  return {
    id: String(run.id), state: run.state, totalCount: Number(run.total_count),
    selectedCount: Number(run.selected_count), reviewCount: Number(run.review_count),
    terminalCount: Number(run.terminal_count), cursorPosition: Number(run.cursor_position),
    createdAt: run.created_at, completedAt: run.completed_at, cancelRequestedAt: run.cancel_requested_at,
    decisions: decisions.map((row) => ({
      id: row.id, disposition: row.disposition, score: Number(row.score),
      reasonCodes: json(row.reason_codes), missingFieldClasses: json(row.missing_field_classes),
      selectionHash: row.selection_hash,
      source: { type: row.subject_type, system: row.source_system, keyHash: row.source_key_hash },
      handoff: row.handoff_id ? { id: row.handoff_id, effectAuthorized: false } : null,
    })),
  };
}

export async function cancelCro03aRun(runId: string, actorId: string, role: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = resultRows(await tx.execute(sql`
      UPDATE cro03a_qualification_runs
         SET state='cancelled',cancel_requested_at=NOW(),completed_at=NOW(),updated_at=NOW()
       WHERE id=${runId}::uuid AND state IN ('queued','running')
         AND (${role === "admin"} OR actor_id=${actorId})
       RETURNING id
    `))[0];
    if (!result) return false;
    await tx.execute(sql`
      UPDATE cro03a_qualification_items
         SET state='cancelled',claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE run_id=${runId}::uuid AND state IN ('queued','claimed')
    `);
    await reconcileCro03aRun(tx, runId);
    return true;
  });
}

export async function activateCro03aPolicy(input: {
  policyId: string; expectedVersion: number; reason: string; actorId: string;
}) {
  if (input.reason.trim().length < 8) throw new Error("CRO03A_ACTIVATION_REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const policy = resultRows(await tx.execute(sql`
      SELECT id,policy_key,version,policy_hash,policy,status
        FROM cro03a_policy_documents WHERE id=${input.policyId}::uuid
    `))[0];
    if (!policy) throw new Error("CRO03A_POLICY_NOT_FOUND");
    const document = json<Record<string, any>>(policy.policy);
    if (policy.policy_key !== "south_florida_candidate_qualification" ||
        !["draft", "active"].includes(String(policy.status)) ||
        hashCro03Evidence(document) !== String(policy.policy_hash) ||
        document.geographyReferenceVersion !== "south-florida-fips-v1" ||
        document.verticalAlgorithmVersion !== "v1" ||
        document.subverticalMapVersion !== "1" ||
        document.fitVersion !== "v1" ||
        !Array.isArray(document.targetVerticals) ||
        !["Auto", "Healthcare", "Salon/Spa"].every((value) => document.targetVerticals.includes(value))) {
      throw new Error("CRO03A_POLICY_INCOMPATIBLE");
    }
    const changed = resultRows(await tx.execute(sql`
      UPDATE cro03a_policy_control
         SET active_policy_id=${input.policyId}::uuid,expected_version=expected_version+1,
             updated_by=${input.actorId},updated_at=NOW()
       WHERE id=1 AND expected_version=${input.expectedVersion}
       RETURNING expected_version
    `))[0];
    if (!changed) throw new Error("CRO03A_POLICY_VERSION_CONFLICT");
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03a_policy_activated','cro03a_policy',${input.policyId},
              ${JSON.stringify({ reason: input.reason.trim(), policyVersion: Number(policy.version), policyHash: String(policy.policy_hash), previousControlVersion: input.expectedVersion })}::jsonb,
              'user',${input.actorId})
    `);
    return { policyId: input.policyId, controlVersion: Number(changed.expected_version), policyVersion: Number(policy.version), policyHash: String(policy.policy_hash) };
  });
}

export async function appendCro03bConsumptionReceipt(input: {
  handoffId: string; consumerKey: string; metadata?: Record<string, unknown>;
}) {
  const row = resultRows(await db.execute(sql`
    INSERT INTO cro03a_consumption_receipts(handoff_id,consumer_key,consumer_name,receipt_metadata)
    SELECT h.id,${input.consumerKey},'cro03b',${JSON.stringify(input.metadata ?? {})}::jsonb
      FROM cro03a_handoffs h
     WHERE h.id=${input.handoffId}::uuid AND h.effect_authorized=FALSE
    ON CONFLICT(consumer_key) DO NOTHING
    RETURNING id,handoff_id,consumer_key,created_at
  `))[0];
  const receipt = row ?? resultRows(await db.execute(sql`
    SELECT id,handoff_id,consumer_key,created_at
      FROM cro03a_consumption_receipts
     WHERE consumer_key=${input.consumerKey} AND handoff_id=${input.handoffId}::uuid
  `))[0];
  if (!receipt) throw new Error("CRO03A_HANDOFF_OR_CONSUMER_CONFLICT");
  return { id: receipt.id, handoffId: receipt.handoff_id, consumerKey: receipt.consumer_key, createdAt: receipt.created_at };
}

export async function getCro03aSourceCensus() {
  const staged = resultRows(await db.execute(sql`
    SELECT source_system,subject_type,COUNT(*)::int AS count
      FROM cro03_source_subjects GROUP BY source_system,subject_type ORDER BY source_system,subject_type
  `));
  const candidates = resultRows(await db.execute(sql`
    SELECT DISTINCT ON (s.id)
           o.id AS occurrence_id,s.subject_type,s.source_system,
           encode(digest(s.subject_key,'sha256'),'hex') AS source_key_hash,
           o.source_observed_at
      FROM cro03_source_occurrences o
      JOIN cro03_source_subjects s ON s.id=o.source_subject_id
     WHERE s.subject_type IN ('prospect','sunbiz_entity','sdr_merchant','provider_csv_row','lead_discovery_result','master_lead')
     ORDER BY s.id,o.source_observed_at DESC,o.ingested_at DESC
     LIMIT 100
  `));
  return {
    policyVersion: 1,
    sources: CRO03A_SOURCE_CENSUS.map((source) => ({
      source, stagedCount: staged.filter((row) => String(row.source_system) === source).reduce((sum, row) => sum + Number(row.count), 0),
    })),
    candidates: candidates.map((row) => ({
      occurrenceId: row.occurrence_id, sourceType: row.subject_type, sourceSystem: row.source_system,
      sourceKeyHash: row.source_key_hash, sourceObservedAt: row.source_observed_at,
    })),
    excludedSourceTypes: ["contacts", "businesses", "companies", "deals", "opportunities", "cr04", "cr06", "ghl"],
  };
}

export async function stageCro03aSourceCensus(input: {
  actorId: string; limitPerSource?: number;
}) {
  const limit = Math.max(1, Math.min(input.limitPerSource ?? 100, 500));
  const [prospectRows, sunbizRows, merchantRows, discoveryRows, masterRows] = await Promise.all([
    db.select().from(prospects).limit(limit),
    db.select().from(sunbizEntities).limit(limit),
    db.select().from(sdrMerchants).limit(limit),
    db.select().from(leadDiscoveryResults).limit(limit),
    db.select().from(masterLeads).where(and(
      isNull(masterLeads.canonicalLeadId),
      isNull(masterLeads.duplicateOfId),
      isNull(masterLeads.promotedAt),
      inArray(masterLeads.status, ["staged", "imported", "needs_website_check", "needs_mx_verification", "ready_for_internal_test"]),
    )).limit(limit),
  ]);
  const drafts: Cro03aSourceDraft[] = [
    ...prospectRows.map((row) => prospectSourceSubject(row as any)),
    ...sunbizRows.map((row) => sunbizSourceSubject(row as any)),
    ...merchantRows.map((row) => sdrMerchantSourceSubject(row as any)),
    ...discoveryRows.map((row) => leadDiscoverySourceSubject(row as any) ?? linkedDiscoveryEvidence(row as any)).filter((row): row is Cro03aSourceDraft => !!row),
    ...masterRows.map((row) => masterLeadSourceSubject(row as any)),
  ];
  const attestedAt = new Date().toISOString();
  for (const draft of drafts) {
    if (!draft.sourceObservedAt) {
      draft.sourceObservedAt = attestedAt;
      draft.timestampProvenance = "ingestion_attestation";
      draft.sourceEventKey = `${draft.sourceEventKey}:attested:${attestedAt}`;
    }
  }
  let created = 0;
  let replayed = 0;
  for (const draft of drafts) {
    const result = await createCro03SourceBatch({
      idempotencyKey: `cro03a-census:${draft.subjectType}:${draft.sourceSystem}:${draft.sourceEventKey}`,
      actorType: "user", actorId: input.actorId, purpose: "staging_review",
      subjects: [draft],
    });
    result.replayed ? replayed++ : created++;
  }
  return {
    created, replayed, total: drafts.length,
    sourceResults: {
      prospects: prospectRows.length, sunbiz_entities: sunbizRows.length,
      sdr_merchants: merchantRows.length, lead_discovery_results: discoveryRows.length,
      master_leads: masterRows.length,
      provider_csv_rows: "existing_import_adapter",
      public_web: "existing_persisted_observations_only",
    },
    effectsAuthorized: false,
  };
}