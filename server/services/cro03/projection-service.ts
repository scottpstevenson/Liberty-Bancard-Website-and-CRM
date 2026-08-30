import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resolveOrganization } from "../organization-resolver";
import { decideContactBusinessLink } from "../commercial-link-authority";
import {
  ContactWriteConflictError, updateContactLocalFirst, writeContact, type ContactWriterHookPolicy,
} from "../contact-writer";
import { createValidationIntent, enqueueValidationIntent, hashEmailToken } from "../provider-readiness-control";
import { enqueueReadinessRecalculation } from "../contact-readiness";
import { requestContactLeadScoring } from "../contact-lead-scoring-trigger";
import { candidateHash, stableCro03RecipeHash, type Cro03CandidateField } from "./contracts";
import { randomUUID } from "crypto";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const CRO03_HOOK_POLICY: ContactWriterHookPolicy = {
  source: "cro03", deferValidation: true, deferReadiness: true,
  deferLeadScoring: true, suppressProviderProjection: true,
};
const PROJECTABLE: Partial<Record<Cro03CandidateField, string>> = {
  email: "email", phone: "phone", website: "website", address: "address",
  city: "city", state: "state", owner_title: "title", category: "industry",
};

export async function projectCro03bCanonical(input: {
  itemId: string;
  reviewerId: string;
  contact: { email: string; phone: string; firstName?: string; lastName?: string; companyName: string };
  organization: { canonicalName: string; websiteDomain?: string; googlePlaceId?: string; mainPhone?: string; city?: string; state?: string };
  winners: Partial<Record<Cro03CandidateField, { value: string; candidateSetHash: string }>>;
}) {
  const item = rows(await db.execute(sql`
    SELECT i.*,h.source_type,h.source_system,h.source_key
      FROM cro03b_recipe_items i JOIN cro03a_handoffs h ON h.id=i.handoff_id
     WHERE i.id=${input.itemId}::uuid
  `))[0];
  if (!item) throw new Error("CRO03B_ITEM_NOT_FOUND");
  const organization = await resolveOrganization(input.organization);
  if (organization.kind === "deferred") {
    await db.execute(sql`
      UPDATE cro03b_recipe_items SET state='review_required',terminal_code=${organization.reasonCode},updated_at=NOW()
       WHERE id=${input.itemId}::uuid
    `);
    return { state: "review_required" as const, reasonCode: organization.reasonCode, candidateIds: organization.candidateIds };
  }

  const contact = await writeContact({
    mode: "local_only",
    mutation: {
      email: input.contact.email, phone: input.contact.phone, firstName: input.contact.firstName ?? "",
      lastName: input.contact.lastName ?? "", companyName: input.contact.companyName,
    } as any,
    provenance: {
      sourceCategory: "discovery", sourceType: "cro03",
      eventKey: `cro03b:${input.itemId}:canonical-contact`,
      sourceExternalId: String(item.source_key), actorType: "system", actorId: "cro03b",
      metadata: { itemId: input.itemId, sourceType: item.source_type, sourceSystem: item.source_system },
    },
    actor: { actorType: "system", actorId: "cro03b" },
    hookPolicy: CRO03_HOOK_POLICY,
  });
  if (contact._intakeOutcome === "created" && contact.businessId) {
    throw new Error("CRO03B_CONTACT_MUST_BEGIN_UNLINKED");
  }
  const sourceEventId = Number(contact._sourceEventId);
  await db.execute(sql`
    UPDATE cro03b_recipe_items
       SET contact_id=${contact.id},business_id=${organization.business.id},reviewed_by=${input.reviewerId},updated_at=NOW()
     WHERE id=${input.itemId}::uuid
  `);
  const link = await decideContactBusinessLink({
    contactId: contact.id, businessId: organization.business.id, decision: "verified",
    decisionKey: `cro03b:${input.itemId}:business-link`, reviewerId: input.reviewerId,
    evidenceSourceEventId: sourceEventId,
  });

  for (const [field, winner] of Object.entries(input.winners) as Array<[Cro03CandidateField, { value: string; candidateSetHash: string }]>) {
    const column = PROJECTABLE[field];
    if (!column || !winner?.value) continue;
    const current = rows(await db.execute(sql`SELECT * FROM contacts WHERE id=${contact.id}`))[0];
    const before = String(current?.[column] ?? "");
    try {
      const updated = await updateContactLocalFirst(
        contact.id, { [column]: winner.value } as any,
        { actorType: "system", actorId: "cro03b" },
        { field: column as any, expectedValue: before },
        CRO03_HOOK_POLICY,
      );
      if (!updated) throw new Error("CRO03B_CONTACT_NOT_FOUND");
      await db.execute(sql`
        INSERT INTO cro03b_projection_receipts
          (item_id,contact_id,business_id,contact_source_event_id,link_decision_id,field,
           candidate_set_hash,before_value_hash,after_value_hash,subject_generation,disposition,receipt_key)
        VALUES (${input.itemId}::uuid,${contact.id},${organization.business.id},${sourceEventId},${link.id}::uuid,${field},
                ${winner.candidateSetHash},${candidateHash(field,before)},${candidateHash(field,winner.value)},
                ${updated.emailMutationGeneration},${before === winner.value ? "noop" : "applied"},
                ${`cro03b:${input.itemId}:projection:${field}:${winner.candidateSetHash}`})
        ON CONFLICT(receipt_key) DO NOTHING
      `);
    } catch (error) {
      if (!(error instanceof ContactWriteConflictError)) throw error;
      await db.execute(sql`
        UPDATE cro03b_recipe_items SET state='review_required',terminal_code='projection_cas_conflict',updated_at=NOW()
         WHERE id=${input.itemId}::uuid
      `);
      return { state: "review_required" as const, reasonCode: "projection_cas_conflict", contactId: contact.id };
    }
  }
  await db.execute(sql`
    UPDATE cro03b_step_executions
       SET state='completed',attempt_count=attempt_count+1,outcome_code='local_only_projection_completed',
           completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
     WHERE item_id=${input.itemId}::uuid AND step_key='canonical-projection' AND state<>'completed'
  `);
  return finalizeCro03bWinningEmail({
    itemId: input.itemId, contactId: contact.id, linkDisposition: "verified",
  });
}

export async function finalizeCro03bWinningEmail(input: {
  itemId: string; contactId: number; linkDisposition: "verified" | "review_required" | "unlinked";
}) {
  return db.transaction(async (tx) => {
    const contact = rows(await tx.execute(sql`
      SELECT id,email,email_token_hash,email_mutation_generation FROM contacts
       WHERE id=${input.contactId} FOR UPDATE
    `))[0];
    if (!contact) throw new Error("CRO03B_CONTACT_NOT_FOUND");
    const item = rows(await tx.execute(sql`
      SELECT id,state FROM cro03b_recipe_items WHERE id=${input.itemId}::uuid FOR UPDATE
    `))[0];
    if (!item) throw new Error("CRO03B_ITEM_NOT_FOUND");
    const prior = rows(await tx.execute(sql`
      SELECT * FROM cro03b_finalization_receipts WHERE item_id=${input.itemId}::uuid
    `))[0];
    if (prior) return { state: prior.state, contactId: prior.contact_id, validationIntentId: prior.validation_intent_id, replayed: true };

    await tx.execute(sql`
      UPDATE validation_intents
         SET state='superseded',terminal_code='cro03b_winning_email_authority',completed_at=NOW(),updated_at=NOW()
       WHERE contact_id=${input.contactId}
         AND subject_generation=${Number(contact.email_mutation_generation)}
         AND purpose='marketing_outreach'
         AND state IN ('pending','claimed')
    `);
    await createValidationIntent(tx, {
      contactId: input.contactId, email: contact.email,
      generation: Number(contact.email_mutation_generation), purpose: "cro03_winning_email",
    });
    const intent = rows(await tx.execute(sql`
      SELECT id FROM validation_intents
       WHERE contact_id=${input.contactId}
         AND normalized_email_token_hash=${hashEmailToken(contact.email)}
         AND subject_generation=${Number(contact.email_mutation_generation)}
         AND purpose='cro03_winning_email'
    `))[0];
    const scoringRequestKey = `cro03b:${input.itemId}:score:g${contact.email_mutation_generation}`;
    await tx.execute(sql`
      INSERT INTO cro03b_finalization_receipts
        (item_id,contact_id,validation_intent_id,subject_generation,email_token_hash,link_disposition,scoring_request_key)
      VALUES (${input.itemId}::uuid,${input.contactId},${intent?.id ?? null}::uuid,
              ${Number(contact.email_mutation_generation)},${contact.email_token_hash},${input.linkDisposition},${scoringRequestKey})
    `);
    await tx.execute(sql`
      UPDATE cro03b_recipe_items SET state='waiting',terminal_code='validation_pending',updated_at=NOW()
       WHERE id=${input.itemId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03b_step_executions
         SET state='waiting',attempt_count=attempt_count+1,outcome_code='winning_email_validation_pending',updated_at=NOW()
       WHERE item_id=${input.itemId}::uuid AND step_key='finalization' AND state<>'completed'
    `);
    return { state: "validation_pending", contactId: input.contactId, validationIntentId: intent?.id ?? null, replayed: false };
  }).then(async (result) => {
    if (result.validationIntentId) {
      await enqueueValidationIntent(String(result.validationIntentId)).catch(() => {});
    }
    return result;
  });
}

export async function resumeCro03bAfterValidation(itemId: string) {
  const row = rows(await db.execute(sql`
    SELECT f.*,i.state AS item_state,v.state AS validation_state,c.email_status,c.email_mutation_generation
      FROM cro03b_finalization_receipts f
      JOIN cro03b_recipe_items i ON i.id=f.item_id
      LEFT JOIN validation_intents v ON v.id=f.validation_intent_id
      JOIN contacts c ON c.id=f.contact_id
     WHERE f.item_id=${itemId}::uuid
  `))[0];
  if (!row) throw new Error("CRO03B_FINALIZATION_NOT_FOUND");
  if (Number(row.subject_generation) !== Number(row.email_mutation_generation) ||
      !["completed", "failed", "superseded"].includes(String(row.validation_state))) {
    return { state: "validation_pending" as const };
  }
  if (row.state === "completed") return { state: "completed" as const, replayed: true };
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE cro03b_finalization_receipts SET state='validation_terminal'
       WHERE item_id=${itemId}::uuid AND state='validation_pending'
    `);
    await tx.execute(sql`
      INSERT INTO cro03b_terminal_hook_requests(item_id,contact_id,subject_generation,request_key)
      VALUES (${itemId}::uuid,${Number(row.contact_id)},${Number(row.subject_generation)},${String(row.scoring_request_key)})
      ON CONFLICT(item_id) DO NOTHING
    `);
  });
  const completed = await processNextCro03bTerminalHookRequest(itemId);
  return completed ? { state: "completed" as const } : { state: "hooks_pending" as const };
}

export async function processNextCro03bTerminalHookRequest(itemId?: string): Promise<boolean> {
  const claimToken = randomUUID();
  const request = rows(await db.execute(sql`
    WITH candidate AS (
      SELECT r.id
        FROM cro03b_terminal_hook_requests r
       WHERE (${itemId ?? null}::uuid IS NULL OR r.item_id=${itemId ?? null}::uuid)
         AND (r.state='pending' OR (r.state='claimed' AND r.lease_expires_at<NOW()))
       ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE cro03b_terminal_hook_requests r
       SET state='claimed',claim_token=${claimToken}::uuid,lease_expires_at=NOW()+INTERVAL '2 minutes',
           attempt_count=attempt_count+1,updated_at=NOW()
      FROM candidate WHERE r.id=candidate.id
    RETURNING r.*
  `))[0];
  if (!request) return false;
  const live = rows(await db.execute(sql`
    SELECT r.*,c.email_mutation_generation,f.state AS finalization_state,v.state AS validation_state
      FROM cro03b_terminal_hook_requests r
      JOIN contacts c ON c.id=r.contact_id
      JOIN cro03b_finalization_receipts f ON f.item_id=r.item_id
      LEFT JOIN validation_intents v ON v.id=f.validation_intent_id
     WHERE r.id=${request.id}::uuid AND r.claim_token=${claimToken}::uuid
  `))[0];
  if (!live || Number(live.subject_generation) !== Number(live.email_mutation_generation) ||
      !["completed", "failed", "superseded"].includes(String(live.validation_state))) {
    await db.execute(sql`
      UPDATE cro03b_terminal_hook_requests SET state='pending',claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${request.id}::uuid AND claim_token=${claimToken}::uuid
    `);
    return false;
  }
  await enqueueReadinessRecalculation(Number(live.contact_id));
  await requestContactLeadScoring(Number(live.contact_id), String(live.request_key));
  await db.transaction(async (tx) => {
    const completedRequest = rows(await tx.execute(sql`
      UPDATE cro03b_terminal_hook_requests
         SET state='completed',claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
       WHERE id=${request.id}::uuid AND claim_token=${claimToken}::uuid AND state='claimed'
       RETURNING item_id
    `))[0];
    if (!completedRequest) throw new Error("CRO03B_TERMINAL_HOOK_FENCE_LOST");
    const completedItemId = String(completedRequest.item_id);
    await tx.execute(sql`
      UPDATE cro03b_finalization_receipts SET state='completed',completed_at=COALESCE(completed_at,NOW())
       WHERE item_id=${completedItemId}::uuid AND state<>'completed'
    `);
    await tx.execute(sql`
      UPDATE cro03b_recipe_items SET state='completed',terminal_code='canonical_projection_completed',
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE id=${completedItemId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed',outcome_code='validation_terminal_hooks_coalesced',
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE item_id=${completedItemId}::uuid AND step_key='finalization'
    `);
    const item = rows(await tx.execute(sql`
      SELECT i.command_id,i.handoff_id,i.payload_hash,v.state AS validation_state,c.email_status
        FROM cro03b_recipe_items i
        JOIN cro03b_finalization_receipts f ON f.item_id=i.id
        LEFT JOIN validation_intents v ON v.id=f.validation_intent_id
        JOIN contacts c ON c.id=f.contact_id
       WHERE i.id=${completedItemId}::uuid
    `))[0];
    await tx.execute(sql`
      INSERT INTO cro03b_recipe_receipts(command_id,item_id,handoff_id,receipt_type,receipt_key,payload_hash,metadata)
      VALUES (${item.command_id}::uuid,${completedItemId}::uuid,${item.handoff_id}::uuid,'completion',
              ${`cro03b:completion:${completedItemId}`},${item.payload_hash},
              ${JSON.stringify({ validationState: item.validation_state, emailStatus: item.email_status })}::jsonb)
      ON CONFLICT(receipt_key) DO NOTHING
    `);
    await tx.execute(sql`
      WITH counts AS (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE state IN ('completed','failed','cancelled','superseded'))::int AS terminal,
               BOOL_OR(state='failed') AS any_failed
          FROM cro03b_recipe_items WHERE command_id=${item.command_id}::uuid
      )
      UPDATE cro03b_recipe_commands c
         SET terminal_count=counts.terminal,
             state=CASE WHEN counts.terminal=counts.total AND counts.any_failed THEN 'failed'
                        WHEN counts.terminal=counts.total THEN 'completed' ELSE c.state END,
             completed_at=CASE WHEN counts.terminal=counts.total THEN COALESCE(c.completed_at,NOW()) ELSE c.completed_at END,
             updated_at=NOW()
        FROM counts WHERE c.id=${item.command_id}::uuid
    `);
  });
  return true;
}

export function cro03bArbitrationCandidateSetHash(candidates: ReadonlyArray<{
  id: string; valueHash: string; authority: number; confidence: number; observedAt: string;
}>) {
  return stableCro03RecipeHash([...candidates].sort((a, b) =>
    b.authority - a.authority || b.confidence - a.confidence ||
    a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)));
}