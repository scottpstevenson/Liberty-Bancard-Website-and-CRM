import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  candidateHash, canonicalCandidateDisplay, normalizeCandidateValue, stableCro03RecipeHash,
  type Cro03CandidateField,
} from "./contracts";
import { CRO03B_UNIFIED_RECIPE } from "./recipe-contract";
import { hashCro03Evidence } from "./source-staging";
import { randomUUID } from "crypto";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
export const CRO03B_RECIPE_KEY = "cro03b_unified_evidence_enrichment";
export const CRO03B_RECIPE_VERSION = CRO03B_UNIFIED_RECIPE.version;
export const CRO03B_RECIPE_HASH = stableCro03RecipeHash(CRO03B_UNIFIED_RECIPE);
export const CRO03B_MAX_HANDOFFS_PER_COMMAND = 250;

async function reconcileCommand(executor: any, commandId: string) {
  await executor.execute(sql`
    WITH counts AS (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE state IN ('completed','failed','cancelled','superseded'))::int AS terminal,
             BOOL_OR(state='failed') AS any_failed,
             BOOL_AND(state='cancelled') AS all_cancelled
        FROM cro03b_recipe_items WHERE command_id=${commandId}::uuid
    )
    UPDATE cro03b_recipe_commands c
       SET terminal_count=counts.terminal,
           state=CASE
             WHEN counts.terminal=counts.total AND c.cancel_requested_at IS NOT NULL THEN 'cancelled'
             WHEN counts.terminal=counts.total AND counts.any_failed THEN 'failed'
             WHEN counts.terminal=counts.total THEN 'completed'
             WHEN c.state='queued' THEN 'running' ELSE c.state END,
           completed_at=CASE WHEN counts.terminal=counts.total THEN COALESCE(c.completed_at,NOW()) ELSE NULL END,
           updated_at=NOW()
      FROM counts WHERE c.id=${commandId}::uuid
  `);
}

async function ensureRecipeDefinition(executor: any) {
  const inserted = rows(await executor.execute(sql`
    INSERT INTO cro03b_recipe_definitions(recipe_key,version,recipe,recipe_hash,status,created_by)
    VALUES (${CRO03B_RECIPE_KEY},${CRO03B_RECIPE_VERSION},
            ${JSON.stringify(CRO03B_UNIFIED_RECIPE)}::jsonb,${CRO03B_RECIPE_HASH},'active','system')
    ON CONFLICT(recipe_key,version) DO NOTHING
    RETURNING *
  `))[0];
  const recipe = inserted ?? rows(await executor.execute(sql`
    SELECT * FROM cro03b_recipe_definitions
     WHERE recipe_key=${CRO03B_RECIPE_KEY} AND version=${CRO03B_RECIPE_VERSION}
  `))[0];
  if (!recipe || recipe.recipe_hash !== CRO03B_RECIPE_HASH || recipe.status !== "active") {
    throw new Error("CRO03B_RECIPE_DEFINITION_CONFLICT");
  }
  return recipe;
}

export async function admitCro03bHandoffs(input: {
  handoffIds: string[];
  actorId: string;
  actorRole: "admin" | "manager";
  reason?: string;
}) {
  const handoffIds = [...new Set(input.handoffIds)].sort();
  if (!handoffIds.length || handoffIds.length > CRO03B_MAX_HANDOFFS_PER_COMMAND) {
    throw new Error("CRO03B_COMMAND_SCOPE_INVALID");
  }
  if (input.reason && input.reason.trim().length > 500) throw new Error("CRO03B_REASON_INVALID");
  const payloadHash = hashCro03Evidence({
    handoffIds, recipeVersion: CRO03B_RECIPE_VERSION, reason: input.reason?.trim() || null,
  });
  const commandKey = `cro03b:${hashCro03Evidence({
    actorId: input.actorId, handoffIds, recipeHash: CRO03B_RECIPE_HASH,
  })}`;

  return db.transaction(async (tx) => {
    const recipe = await ensureRecipeDefinition(tx);
    const handoffs = rows(await tx.execute(sql`
      SELECT h.*,d.run_id,r.actor_id AS owner_actor_id,r.actor_role
        FROM cro03a_handoffs h
        JOIN cro03a_qualification_decisions d ON d.id=h.decision_id
        JOIN cro03a_qualification_runs r ON r.id=d.run_id
       WHERE h.id IN (${sql.join(handoffIds.map((id) => sql`${id}::uuid`), sql`,`)})
       ORDER BY h.id
       FOR UPDATE OF h
    `));
    if (handoffs.length !== handoffIds.length) throw new Error("CRO03B_HANDOFF_NOT_FOUND");
    if (handoffs.some((row) => row.effect_authorized !== false)) throw new Error("CRO03B_HANDOFF_NOT_ADMISSIBLE");
    if (input.actorRole !== "admin" && handoffs.some((row) => String(row.owner_actor_id) !== input.actorId)) {
      throw new Error("CRO03B_HANDOFF_NOT_FOUND");
    }

    const prior = rows(await tx.execute(sql`
      SELECT * FROM cro03b_recipe_commands WHERE command_key=${commandKey} FOR UPDATE
    `))[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.recipe_hash !== CRO03B_RECIPE_HASH) {
        throw new Error("CRO03B_COMMAND_PAYLOAD_CONFLICT");
      }
      const items = rows(await tx.execute(sql`
        SELECT id,handoff_id,state,terminal_code FROM cro03b_recipe_items
         WHERE command_id=${prior.id}::uuid ORDER BY handoff_id
      `));
      return { id: prior.id, state: prior.state, replayed: true, recipeVersion: prior.recipe_version, recipeHash: prior.recipe_hash, items };
    }

    const command = rows(await tx.execute(sql`
      INSERT INTO cro03b_recipe_commands
        (command_key,actor_id,actor_role,recipe_definition_id,recipe_version,recipe_hash,payload_hash,reason,total_count)
      VALUES (${commandKey},${input.actorId},${input.actorRole},${recipe.id}::uuid,
              ${CRO03B_RECIPE_VERSION},${CRO03B_RECIPE_HASH},${payloadHash},${input.reason?.trim() || null},${handoffs.length})
      RETURNING *
    `))[0];
    const items: any[] = [];
    for (const handoff of handoffs) {
      const frozenHandoffHash = hashCro03Evidence({
        handoffId: handoff.id, decisionId: handoff.decision_id, sourceType: handoff.source_type,
        sourceSystem: handoff.source_system, sourceKey: handoff.source_key,
        policyId: handoff.policy_id, policyHash: handoff.policy_hash,
        occurrenceIds: handoff.frozen_occurrence_ids, selectionHash: handoff.selection_hash,
      });
      const itemPayloadHash = hashCro03Evidence({
        commandPayloadHash: payloadHash, handoffId: handoff.id, frozenHandoffHash,
      });
      const item = rows(await tx.execute(sql`
        INSERT INTO cro03b_recipe_items
          (command_id,handoff_id,originating_run_id,owner_actor_id,recipe_version,
           frozen_handoff_hash,frozen_recipe_hash,payload_hash)
        VALUES (${command.id}::uuid,${handoff.id}::uuid,${handoff.run_id}::uuid,${handoff.owner_actor_id},
                ${CRO03B_RECIPE_VERSION},${frozenHandoffHash},${CRO03B_RECIPE_HASH},${itemPayloadHash})
        ON CONFLICT(handoff_id,recipe_version) DO NOTHING
        RETURNING *
      `))[0];
      if (!item) throw new Error("CRO03B_HANDOFF_ALREADY_ADMITTED");
      for (const [index, step] of CRO03B_UNIFIED_RECIPE.steps.entries()) {
        await tx.execute(sql`
          INSERT INTO cro03b_step_executions
            (item_id,step_key,step_index,contract_hash,execution_owner,accounting_owner)
          VALUES (${item.id}::uuid,${step.id},${index},${stableCro03RecipeHash(step)},
                  ${step.executionOwner},${step.accountingOwner})
        `);
      }
      const receiptKey = `cro03b:admission:${handoff.id}:v${CRO03B_RECIPE_VERSION}`;
      await tx.execute(sql`
        INSERT INTO cro03b_recipe_receipts
          (command_id,item_id,handoff_id,receipt_type,receipt_key,payload_hash,metadata)
        VALUES (${command.id}::uuid,${item.id}::uuid,${handoff.id}::uuid,'admission',
                ${receiptKey},${itemPayloadHash},
                ${JSON.stringify({ recipeVersion: CRO03B_RECIPE_VERSION, recipeHash: CRO03B_RECIPE_HASH })}::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO cro03a_consumption_receipts(handoff_id,consumer_key,consumer_name,receipt_metadata)
        VALUES (${handoff.id}::uuid,${receiptKey},'cro03b',
                ${JSON.stringify({ commandId: command.id, itemId: item.id, recipeVersion: CRO03B_RECIPE_VERSION })}::jsonb)
      `);
      items.push(item);
    }
    return { id: command.id, state: command.state, replayed: false, recipeVersion: command.recipe_version, recipeHash: command.recipe_hash, items };
  });
}

export async function getCro03bCommand(commandId: string, actorId: string, actorRole: string) {
  const command = rows(await db.execute(sql`
    SELECT * FROM cro03b_recipe_commands
     WHERE id=${commandId}::uuid
       AND (${actorRole === "admin"} OR actor_id=${actorId})
  `))[0];
  if (!command) return null;
  const items = rows(await db.execute(sql`
    SELECT id,handoff_id,state,terminal_code,created_at,completed_at
      FROM cro03b_recipe_items WHERE command_id=${commandId}::uuid ORDER BY created_at,id
  `));
  return { ...command, items };
}

export async function cancelCro03bCommand(commandId: string, actorId: string, actorRole: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const command = rows(await tx.execute(sql`
      UPDATE cro03b_recipe_commands
         SET cancel_requested_at=COALESCE(cancel_requested_at,NOW()),updated_at=NOW()
       WHERE id=${commandId}::uuid AND state IN ('queued','running')
         AND (${actorRole === "admin"} OR actor_id=${actorId})
       RETURNING id
    `))[0];
    if (!command) return false;
    await tx.execute(sql`
      UPDATE cro03b_recipe_items
         SET state='cancelled',terminal_code='cancel_requested',completed_at=NOW(),updated_at=NOW()
       WHERE command_id=${commandId}::uuid AND state='queued' AND claim_token IS NULL
    `);
    await reconcileCommand(tx, commandId);
    return true;
  });
}

export async function isCro03bRecipeSubjectActive(subjectType: string, subjectKey: string): Promise<boolean> {
  return Boolean(rows(await db.execute(sql`
    SELECT 1
      FROM cro03b_recipe_items i
      JOIN cro03a_handoffs h ON h.id=i.handoff_id
     WHERE h.source_type=${subjectType} AND h.source_key=${subjectKey}
       AND i.state IN ('queued','running','waiting','review_required')
     LIMIT 1
  `))[0]);
}

export async function recordCro03bLegacyWriterDisposition(input: {
  itemId: string; subjectType: string; subjectKey: string; writerKey: string;
  disposition: "evidence_submitted" | "skipped"; reasonCode: string; evidenceRef?: string;
}) {
  await db.execute(sql`
    INSERT INTO cro03b_legacy_writer_fences
      (item_id,subject_type,subject_key,writer_key,disposition,evidence_ref,reason_code)
    VALUES (${input.itemId}::uuid,${input.subjectType},${input.subjectKey},${input.writerKey},
            ${input.disposition},${input.evidenceRef ?? null},${input.reasonCode})
    ON CONFLICT(item_id,writer_key,subject_type,subject_key) DO NOTHING
  `);
}

export async function assertCro03bLegacySourceWriteAllowed(input: {
  subjectType: string; subjectKey: string; writerKey: string;
}) {
  const active = rows(await db.execute(sql`
    SELECT i.id
      FROM cro03b_recipe_items i
      JOIN cro03a_handoffs h ON h.id=i.handoff_id
     WHERE h.source_type=${input.subjectType} AND h.source_key=${input.subjectKey}
       AND i.state IN ('queued','running','waiting','review_required')
     ORDER BY i.created_at,i.id LIMIT 1
  `))[0];
  if (!active) return;
  await recordCro03bLegacyWriterDisposition({
    itemId: active.id, subjectType: input.subjectType, subjectKey: input.subjectKey,
    writerKey: input.writerKey, disposition: "skipped", reasonCode: "active_cro03b_recipe",
  });
  throw new Error("CRO03B_ACTIVE_RECIPE_WRITE_FENCED");
}

export async function assertCro03bLegacyContactWriteAllowed(contactId: number, writerKey: string) {
  const active = rows(await db.execute(sql`
    SELECT i.id,h.source_type,h.source_key
      FROM cro03b_recipe_items i
      JOIN cro03a_handoffs h ON h.id=i.handoff_id
     WHERE (i.contact_id=${contactId}
        OR EXISTS (
          SELECT 1 FROM contact_source_events e
           WHERE e.contact_id=${contactId} AND e.source_external_id=h.source_key
        ))
       AND i.state IN ('queued','running','waiting','review_required')
     ORDER BY i.created_at,i.id LIMIT 1
  `))[0];
  if (!active) return;
  await recordCro03bLegacyWriterDisposition({
    itemId: active.id, subjectType: active.source_type, subjectKey: active.source_key,
    writerKey, disposition: "skipped", reasonCode: "active_cro03b_recipe_contact",
  });
  throw new Error("CRO03B_ACTIVE_RECIPE_WRITE_FENCED");
}

const ARBITRATION_POLICY = Object.freeze({
  version: 1, threshold: 70, minimumMargin: 10,
  protectedManualPrecedence: true, highAuthorityConflict: "review_required",
});
const ARBITRATION_POLICY_HASH = stableCro03RecipeHash(ARBITRATION_POLICY);

async function materializeAndArbitrateInternalEvidence(executor: any, itemId: string) {
  const sourceRows = rows(await executor.execute(sql`
    SELECT o.id AS observation_id,o.observed_at,o.payload_hash,n.field,n.normalized_value,n.display_value,n.value_hash
      FROM cro03b_recipe_items i
      JOIN cro03a_handoffs h ON h.id=i.handoff_id
      CROSS JOIN LATERAL jsonb_array_elements_text(h.occurrence_ids) occurrence(id)
      JOIN cro03_source_occurrences so ON so.id=occurrence.id::uuid
      JOIN cro03_source_observations o ON o.id=so.source_observation_id
      JOIN cro03_normalized_candidates n ON n.source_observation_id=o.id
     WHERE i.id=${itemId}::uuid
     ORDER BY o.observed_at DESC,o.id,n.field,n.value_hash
  `));
  for (const source of sourceRows) {
    const observation = rows(await executor.execute(sql`
      INSERT INTO cro03b_evidence_observations
        (item_id,step_key,source_observation_id,evidence_hash,observed_at,expires_at,outcome,provenance)
      VALUES (${itemId}::uuid,'internal-source',${source.observation_id}::uuid,${source.payload_hash},
              ${source.observed_at}::timestamptz,${source.observed_at}::timestamptz+INTERVAL '90 days',
              'success','{"owner":"scheduler","accounting":"none"}'::jsonb)
      ON CONFLICT(item_id,step_key,evidence_hash) DO NOTHING
      RETURNING id
    `))[0] ?? rows(await executor.execute(sql`
      SELECT id FROM cro03b_evidence_observations
       WHERE item_id=${itemId}::uuid AND step_key='internal-source' AND evidence_hash=${source.payload_hash}
    `))[0];
    await executor.execute(sql`
      INSERT INTO cro03b_field_candidates
        (item_id,observation_id,field,normalized_value,display_value,value_hash,authority_rank,confidence,expires_at)
      VALUES (${itemId}::uuid,${observation.id}::uuid,${source.field},
              ${source.normalized_value},${source.display_value},${source.value_hash},800,85,
              ${source.observed_at}::timestamptz+INTERVAL '90 days')
      ON CONFLICT(item_id,observation_id,field,value_hash) DO NOTHING
    `);
  }
  const fields = rows(await executor.execute(sql`
    SELECT DISTINCT field FROM cro03b_field_candidates WHERE item_id=${itemId}::uuid ORDER BY field
  `));
  for (const { field } of fields) {
    const candidates = rows(await executor.execute(sql`
      SELECT c.*,o.observed_at
        FROM cro03b_field_candidates c JOIN cro03b_evidence_observations o ON o.id=c.observation_id
       WHERE c.item_id=${itemId}::uuid AND c.field=${field} AND (c.expires_at IS NULL OR c.expires_at>NOW())
       ORDER BY c.protected_manual DESC,c.authority_rank DESC,c.confidence DESC,o.observed_at DESC,c.id
    `));
    const candidateSetHash = stableCro03RecipeHash(candidates.map((candidate) => ({
      id: candidate.id, valueHash: candidate.value_hash, authority: candidate.authority_rank,
      confidence: candidate.confidence, observedAt: candidate.observed_at,
    })));
    const first = candidates[0];
    const second = candidates.find((candidate) => candidate.value_hash !== first?.value_hash);
    const highAuthorityConflict = Boolean(second && Number(first.authority_rank) >= 800 && Number(second.authority_rank) >= 800);
    const margin = Number(first?.confidence ?? 0) - Number(second?.confidence ?? 0);
    const outcome = !first ? "no_winner"
      : highAuthorityConflict || Number(first.confidence) < ARBITRATION_POLICY.threshold || margin < ARBITRATION_POLICY.minimumMargin
        ? "review_required" : "winner";
    const reason = !first ? "no_candidate" : highAuthorityConflict ? "high_authority_conflict"
      : Number(first.confidence) < ARBITRATION_POLICY.threshold ? "below_threshold"
        : margin < ARBITRATION_POLICY.minimumMargin ? "insufficient_margin" : "threshold_and_margin_met";
    await executor.execute(sql`
      INSERT INTO cro03b_field_decisions
        (item_id,field,policy_version,policy_hash,candidate_set_hash,threshold,minimum_margin,
         winner_candidate_id,outcome,reason_code,top_confidence,runner_up_confidence)
      VALUES (${itemId}::uuid,${field},${ARBITRATION_POLICY.version},${ARBITRATION_POLICY_HASH},
              ${candidateSetHash},${ARBITRATION_POLICY.threshold},${ARBITRATION_POLICY.minimumMargin},
              ${outcome === "winner" ? first?.id : null}::uuid,${outcome},${reason},
              ${first?.confidence ?? null},${second?.confidence ?? null})
      ON CONFLICT(item_id,field) DO NOTHING
    `);
  }
}

const DENIED_STAGE_KEYS = new Set(["public-web", "rdap", "jsonld", "serper", "outscraper", "openai", "apollo"]);

async function recordProviderDeniedStages(executor: any, itemId: string) {
  for (const step of CRO03B_UNIFIED_RECIPE.steps.filter((candidate) => DENIED_STAGE_KEYS.has(candidate.id))) {
    const operationKey = `cro03b:${itemId}:stage:${step.id}:v${CRO03B_RECIPE_VERSION}`;
    const evidenceHash = hashCro03Evidence({
      itemId, stepKey: step.id, recipeHash: CRO03B_RECIPE_HASH,
      executionOwner: step.executionOwner, accountingOwner: step.accountingOwner,
      outcome: "transport_denied", requestedUnits: 0, settledUnits: 0,
    });
    const operation = rows(await executor.execute(sql`
      INSERT INTO cro03b_stage_operations
        (item_id,step_key,execution_owner,accounting_owner,operation_key,state,
         requested_units,settled_units,outcome_code,completed_at)
      VALUES (${itemId}::uuid,${step.id},${step.executionOwner},${step.accountingOwner},
              ${operationKey},'completed',0,0,'certification_transport_denied',NOW())
      ON CONFLICT(item_id,step_key) DO NOTHING
      RETURNING id
    `))[0] ?? rows(await executor.execute(sql`
      SELECT id FROM cro03b_stage_operations WHERE item_id=${itemId}::uuid AND step_key=${step.id}
    `))[0];
    await executor.execute(sql`
      INSERT INTO cro03b_stage_attempts
        (operation_id,attempt_number,outcome,transport_invoked,error_code,started_at,completed_at)
      VALUES (${operation.id}::uuid,1,'transport_denied',FALSE,'CRO03_EGRESS_TRANSPORT_DENIED',NOW(),NOW())
      ON CONFLICT(operation_id,attempt_number) DO NOTHING
    `);
    await executor.execute(sql`
      INSERT INTO cro03b_stage_receipts
        (operation_id,receipt_key,outcome,requested_units,settled_units,evidence_hash)
      VALUES (${operation.id}::uuid,${`${operationKey}:receipt`},'transport_denied',0,0,${evidenceHash})
      ON CONFLICT(operation_id) DO NOTHING
    `);
    await executor.execute(sql`
      INSERT INTO cro03b_evidence_observations
        (item_id,step_key,stage_operation_id,evidence_hash,observed_at,outcome,provenance)
      VALUES (${itemId}::uuid,${step.id},${operation.id}::uuid,${evidenceHash},NOW(),'disabled',
              ${JSON.stringify({
                executionOwner: step.executionOwner, accountingOwner: step.accountingOwner,
                transportInvoked: false, requestedUnits: 0, settledUnits: 0,
              })}::jsonb)
      ON CONFLICT(item_id,step_key,evidence_hash) DO NOTHING
    `);
    await executor.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed',attempt_count=attempt_count+1,
             outcome_code='certification_transport_denied',
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE item_id=${itemId}::uuid AND step_key=${step.id} AND state IN ('queued','waiting')
    `);
  }
}

export async function reviewAndProjectCro03bItem(
  itemId: string,
  reviewerId: string,
) {
  const item = rows(await db.execute(sql`
    SELECT i.id FROM cro03b_recipe_items i
     WHERE i.id=${itemId}::uuid AND i.state='review_required'
  `))[0];
  if (!item) throw new Error("CRO03B_ITEM_NOT_REVIEWABLE");
  const decisions = rows(await db.execute(sql`
    SELECT d.field,d.candidate_set_hash,c.display_value
      FROM cro03b_field_decisions d
      JOIN cro03b_field_candidates c ON c.id=d.winner_candidate_id
     WHERE d.item_id=${itemId}::uuid AND d.outcome='winner'
  `));
  const winners = Object.fromEntries(decisions.map((decision) => [
    decision.field, { value: canonicalCandidateDisplay(decision.field, decision.display_value), candidateSetHash: decision.candidate_set_hash },
  ])) as Partial<Record<Cro03CandidateField, { value: string; candidateSetHash: string }>>;
  const companyName = winners.business_name?.value;
  const strongAnchor = winners.website?.value || winners.phone?.value ||
    (winners.address?.value && winners.city?.value && winners.state?.value);
  if (!companyName || !strongAnchor) throw new Error("CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED");
  const owner = (winners.owner_name?.value ?? "").trim().split(/\s+/);
  const email = winners.email?.value;
  if (!email) throw new Error("CRO03B_WINNING_EMAIL_REQUIRED");
  const phone = winners.phone?.value;
  if (!phone) throw new Error("CRO03B_WINNING_PHONE_REQUIRED");
  const { projectCro03bCanonical } = await import("./projection-service");
  return projectCro03bCanonical({
    itemId, reviewerId,
    contact: { email, phone, firstName: owner[0] ?? "", lastName: owner.slice(1).join(" "), companyName },
    organization: {
      canonicalName: companyName,
      websiteDomain: winners.website?.value
        ? normalizeCandidateValue("website", winners.website.value).split("/")[0] : undefined,
      mainPhone: winners.phone?.value, city: winners.city?.value, state: winners.state?.value,
    },
    winners,
  });
}

/**
 * Queue-owned provider-denied processor. It records internal evidence ownership
 * and stops before public/provider transport until CRO-03C activates a stage.
 */
export async function processNextCro03bRecipeItem(): Promise<"idle" | "waiting" | "completed"> {
  const { processNextCro03bTerminalHookRequest } = await import("./projection-service");
  if (await processNextCro03bTerminalHookRequest()) return "completed";
  const recoverable = rows(await db.execute(sql`
    SELECT f.item_id
      FROM cro03b_finalization_receipts f
      JOIN validation_intents v ON v.id=f.validation_intent_id
     WHERE f.state<>'completed' AND v.state IN ('completed','failed','superseded')
     ORDER BY f.created_at,f.id LIMIT 1
  `))[0];
  if (recoverable) {
    const { resumeCro03bAfterValidation } = await import("./projection-service");
    const result = await resumeCro03bAfterValidation(String(recoverable.item_id));
    return result.state === "completed" ? "completed" : "waiting";
  }
  const claimToken = randomUUID();
  const item = rows(await db.execute(sql`
    WITH candidate AS (
      SELECT i.id
        FROM cro03b_recipe_items i
        JOIN cro03b_recipe_commands c ON c.id=i.command_id
       WHERE (i.state='queued' AND c.cancel_requested_at IS NULL)
          OR (i.state='running' AND i.lease_expires_at<NOW())
       ORDER BY i.created_at,i.id
       FOR UPDATE OF i SKIP LOCKED
       LIMIT 1
    )
    UPDATE cro03b_recipe_items i
       SET state='running',claim_token=${claimToken}::uuid,lease_expires_at=NOW()+INTERVAL '2 minutes',
           execution_fence=execution_fence+1,updated_at=NOW()
      FROM candidate
     WHERE i.id=candidate.id
    RETURNING i.*
  `))[0];
  if (!item) return "idle";
  await db.transaction(async (tx) => {
    const live = rows(await tx.execute(sql`
      SELECT i.id,h.selection_hash,h.policy_hash,c.cancel_requested_at
        FROM cro03b_recipe_items i
        JOIN cro03a_handoffs h ON h.id=i.handoff_id
        JOIN cro03b_recipe_commands c ON c.id=i.command_id
       WHERE i.id=${item.id}::uuid AND i.claim_token=${claimToken}::uuid AND i.state='running'
       FOR UPDATE OF i
    `))[0];
    if (!live) throw new Error("CRO03B_ITEM_FENCE_LOST");
    if (live.cancel_requested_at) {
      await tx.execute(sql`
        UPDATE cro03b_recipe_items
           SET state='cancelled',terminal_code='cancel_requested_after_claim',
               claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
         WHERE id=${item.id}::uuid AND claim_token=${claimToken}::uuid
      `);
      await reconcileCommand(tx, item.command_id);
      return;
    }
    await tx.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed',attempt_count=attempt_count+1,outcome_code='frozen_handoff_consumed',
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE item_id=${item.id}::uuid AND step_key='internal-source' AND state='queued'
    `);
    await materializeAndArbitrateInternalEvidence(tx, String(item.id));
    await recordProviderDeniedStages(tx, String(item.id));
    await tx.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed',attempt_count=attempt_count+1,
             outcome_code='deterministic_arbitration_completed',
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE item_id=${item.id}::uuid
         AND step_key='arbitration'
         AND state IN ('queued','waiting')
    `);
    await tx.execute(sql`
      UPDATE cro03b_recipe_items
         SET state='review_required',terminal_code='admin_projection_review_required',
             review_requested_at=COALESCE(review_requested_at,NOW()),
             claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${item.id}::uuid AND claim_token=${claimToken}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03b_recipe_commands
         SET state=CASE WHEN state='queued' THEN 'running' ELSE state END,updated_at=NOW()
       WHERE id=${item.command_id}::uuid
    `);
  });
  return "waiting";
}