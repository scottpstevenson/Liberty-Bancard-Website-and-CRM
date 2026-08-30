import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  ContactWriteConflictError,
  updateContactLocalFirst,
  writeContact,
  type ContactWriterHookPolicy,
} from "../contact-writer";
import { resolveOrganization } from "../organization-resolver";
import { decideContactBusinessLink } from "../commercial-link-authority";
import {
  createValidationIntent,
  enqueueValidationIntent,
  hashEmailToken,
} from "../provider-readiness-control";
import { enqueueReadinessRecalculation } from "../contact-readiness";
import { requestContactLeadScoring } from "../contact-lead-scoring-trigger";
import { authorizeCro03cValidation } from "./live-execution";
import { candidateHash, stableCro03RecipeHash } from "./contracts";
import { hashCro03Evidence } from "./source-staging";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export type Cro03cInitialContinuationClaim = {
  command_id: string;
  run_id: string;
  generation_id: string;
  activation_revision: number;
  runtime_attestation_id: string;
  command_type: "initial_batch" | "micro_canary";
  claim_token: string;
  execution_fence: number;
};

const PROJECTABLE: Record<string, string> = {
  email: "email",
  phone: "phone",
  website: "website",
  address: "address",
  city: "city",
  state: "state",
  owner_title: "title",
  category: "industry",
};

function sourceValue(payload: any, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function hasFence(executor: any, claim: Cro03cInitialContinuationClaim): Promise<boolean> {
  const current = rows(await executor.execute(sql`
    SELECT g.id
      FROM cro03c_generations g
      JOIN cro03c_commands c ON c.id=g.command_id
      JOIN cro03c_runs r ON r.id=g.run_id
     WHERE g.id=${claim.generation_id}::uuid
       AND g.command_id=${claim.command_id}::uuid AND g.run_id=${claim.run_id}::uuid
       AND g.state='running' AND g.claim_token=${claim.claim_token}::uuid
       AND g.execution_fence=${claim.execution_fence}
       AND c.command_type='initial_batch' AND c.state='running'
       AND c.cancel_requested_at IS NULL AND c.expires_at>NOW()
       AND r.state='running' AND r.claim_token=${claim.claim_token}::uuid
       AND r.execution_fence=${claim.execution_fence}
  `))[0];
  return Boolean(current);
}

async function requireFence(executor: any, claim: Cro03cInitialContinuationClaim): Promise<void> {
  if (!await hasFence(executor, claim)) throw new Error("CRO03C_INITIAL_CONTINUATION_FENCE_LOST");
}

async function loadFrozenSource(claim: Cro03cInitialContinuationClaim) {
  const source = rows(await db.execute(sql`
    SELECT g.handoff_id,g.frozen_handoff_hash,h.source_type,h.source_system,h.source_key,
           h.decision_id,h.policy_hash,h.selection_hash,h.occurrence_ids,
           o.payload,o.payload_hash
      FROM cro03c_generations g
      JOIN cro03a_handoffs h ON h.id=g.handoff_id
      JOIN cro03_source_occurrences occurrence
        ON occurrence.id=ANY(ARRAY(SELECT jsonb_array_elements_text(h.occurrence_ids)::uuid))
      JOIN cro03_source_observations o ON o.id=occurrence.source_observation_id
     WHERE g.id=${claim.generation_id}::uuid
     ORDER BY occurrence.source_observed_at DESC,occurrence.id DESC LIMIT 1
  `))[0];
  if (!source) throw new Error("CRO03C_INITIAL_SOURCE_EVIDENCE_MISSING");
  return source;
}

/**
 * Advances only the current initial generation.  A terminal result means the
 * caller may complete its generation; waiting leaves that generation running
 * so validation and hook recovery remain truthfully visible.
 */
export async function continueCro03cInitialGeneration(
  claim: Cro03cInitialContinuationClaim,
): Promise<"waiting" | "completed" | "review_required"> {
  if (claim.command_type !== "initial_batch") throw new Error("CRO03C_MICRO_CONTINUATION_DENIED");
  await requireFence(db, claim);
  const source = await loadFrozenSource(claim);
  const payload = source.payload ?? {};
  const lineageState = {
    handoffId: source.handoff_id,
    decisionId: source.decision_id,
    policyHash: source.policy_hash,
    selectionHash: source.selection_hash,
    occurrenceIds: source.occurrence_ids,
  };
  const insertedSubject = rows(await db.execute(sql`
    INSERT INTO cro03c_initial_subjects
      (generation_id,command_id,run_id,handoff_id,frozen_handoff_hash,source_type,source_system,
       source_key_hash,source_payload_hash,lineage_state)
    SELECT ${claim.generation_id}::uuid,${claim.command_id}::uuid,${claim.run_id}::uuid,
           ${source.handoff_id}::uuid,${source.frozen_handoff_hash},${source.source_type},${source.source_system},
           ${hashCro03Evidence({ sourceKey: source.source_key })},${source.payload_hash},
           ${JSON.stringify(lineageState)}::jsonb
     WHERE EXISTS (
       SELECT 1 FROM cro03c_generations g JOIN cro03c_commands c ON c.id=g.command_id
        WHERE g.id=${claim.generation_id}::uuid AND g.claim_token=${claim.claim_token}::uuid
          AND g.execution_fence=${claim.execution_fence} AND g.state='running'
          AND c.command_type='initial_batch' AND c.state='running'
     )
    ON CONFLICT (generation_id) DO NOTHING RETURNING generation_id
  `));
  if (!insertedSubject.length) {
    const prior = rows(await db.execute(sql`
      SELECT * FROM cro03c_initial_subjects WHERE generation_id=${claim.generation_id}::uuid
    `))[0];
    if (!prior) throw new Error("CRO03C_INITIAL_CONTINUATION_FENCE_LOST");
    if (String(prior.source_payload_hash) !== String(source.payload_hash) ||
        String(prior.frozen_handoff_hash) !== String(source.frozen_handoff_hash)) {
      throw new Error("CRO03C_INITIAL_LINEAGE_CONFLICT");
    }
    if (prior.state === "completed") return "completed";
    if (prior.state === "review_required") return "review_required";
  }

  let subject = rows(await db.execute(sql`
    SELECT * FROM cro03c_initial_subjects WHERE generation_id=${claim.generation_id}::uuid
  `))[0];
  const email = sourceValue(payload, "email");
  const companyName = sourceValue(payload, "businessName", "business_name");
  if (!email || !companyName) {
    await db.execute(sql`
      UPDATE cro03c_initial_subjects SET state='review_required',terminal_code='missing_contact_evidence',updated_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid AND state='pending'
    `);
    return "review_required";
  }

  if (!subject.contact_id) {
    const eventKey = `cro03c:${claim.generation_id}:initial-contact`;
    const replay = rows(await db.execute(sql`
      SELECT c.id FROM contact_source_events e JOIN contacts c ON c.id=e.contact_id
       WHERE e.event_key=${eventKey} LIMIT 1
    `))[0];
    const collision = !replay ? rows(await db.execute(sql`
      SELECT id FROM contacts WHERE lower(email)=lower(${email}) AND archived_at IS NULL LIMIT 1
    `))[0] : null;
    if (collision) throw new Error("CRO03C_INITIAL_CONTACT_MUST_BE_NEW_OR_EXACT_REPLAY");
    const hookPolicy: ContactWriterHookPolicy = {
      source: "cro03",
      deferValidation: true,
      deferReadiness: true,
      deferLeadScoring: true,
      suppressProviderProjection: true,
      authorityCheck: (tx) => hasFence(tx, claim),
    };
    const contact = await writeContact({
      mode: "local_only",
      mutation: {
        email,
        phone: sourceValue(payload, "phone"),
        firstName: sourceValue(payload, "firstName", "first_name"),
        lastName: sourceValue(payload, "lastName", "last_name"),
        companyName,
      } as any,
      provenance: {
        sourceCategory: "discovery",
        sourceType: "cro03",
        eventKey,
        sourceExternalId: String(source.source_key),
        actorType: "system",
        actorId: "cro03c",
        metadata: {
          generationId: claim.generation_id,
          sourceType: source.source_type,
          sourceSystem: source.source_system,
          sourcePayloadHash: source.payload_hash,
        },
      },
      actor: { actorType: "system", actorId: "cro03c" },
      hookPolicy,
    });
    if (contact.businessId) throw new Error("CRO03C_INITIAL_CONTACT_MUST_BEGIN_UNLINKED");
    await requireFence(db, claim);
    await db.execute(sql`
      UPDATE cro03c_initial_subjects
         SET contact_id=${contact.id},contact_source_event_id=${Number(contact._sourceEventId)},
             state='projecting',updated_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid AND contact_id IS NULL
    `);
  }

  subject = rows(await db.execute(sql`
    SELECT * FROM cro03c_initial_subjects WHERE generation_id=${claim.generation_id}::uuid
  `))[0];
  if (!subject.business_id) {
    const website = sourceValue(payload, "website");
    let domain: string | undefined;
    try { domain = website ? new URL(website).hostname : undefined; } catch { domain = undefined; }
    const organization = await resolveOrganization({
      canonicalName: companyName,
      websiteDomain: domain,
      googlePlaceId: sourceValue(payload, "googlePlaceId", "google_place_id") || undefined,
      mainPhone: sourceValue(payload, "phone") || undefined,
      city: sourceValue(payload, "city") || undefined,
      state: sourceValue(payload, "state") || undefined,
      authorityCheck: (tx) => hasFence(tx, claim),
    });
    if (organization.kind === "deferred") {
      await db.execute(sql`
        UPDATE cro03c_initial_subjects SET state='review_required',terminal_code=${organization.reasonCode},updated_at=NOW()
         WHERE generation_id=${claim.generation_id}::uuid
      `);
      return "review_required";
    }
    await requireFence(db, claim);
    const command = rows(await db.execute(sql`
      SELECT actor_id FROM cro03c_commands WHERE id=${claim.command_id}::uuid
    `))[0];
    const link = await decideContactBusinessLink({
      contactId: Number(subject.contact_id),
      businessId: Number(organization.business.id),
      decision: "verified",
      decisionKey: `cro03c:${claim.generation_id}:business-link`,
      reviewerId: String(command.actor_id),
      evidenceSourceEventId: Number(subject.contact_source_event_id),
      authorityCheck: (tx) => hasFence(tx, claim),
    });
    await requireFence(db, claim);
    await db.execute(sql`
      UPDATE cro03c_initial_subjects
         SET business_id=${organization.business.id},link_decision_id=${link.id}::uuid,updated_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid AND business_id IS NULL
    `);
  }

  subject = rows(await db.execute(sql`
    SELECT * FROM cro03c_initial_subjects WHERE generation_id=${claim.generation_id}::uuid
  `))[0];
  for (const [field, column] of Object.entries(PROJECTABLE)) {
    const value = sourceValue(payload, field, field === "category" ? "industry" : field);
    if (!value) continue;
    const receipt = rows(await db.execute(sql`
      SELECT id FROM cro03c_projection_receipts
       WHERE generation_id=${claim.generation_id}::uuid AND field=${field}
    `))[0];
    if (receipt) continue;
    const current = rows(await db.execute(sql`SELECT * FROM contacts WHERE id=${Number(subject.contact_id)}`))[0];
    const before = String(current?.[column] ?? "");
    try {
      const updated = await updateContactLocalFirst(
        Number(subject.contact_id),
        { [column]: value } as any,
        { actorType: "system", actorId: "cro03c" },
        {
          field: column as any,
          expectedValue: before,
          expectedEmailGeneration: Number(current.email_mutation_generation),
          authorityCheck: (tx) => hasFence(tx, claim),
        },
        {
          source: "cro03",
          deferValidation: true,
          deferReadiness: true,
          deferLeadScoring: true,
          suppressProviderProjection: true,
        },
      );
      if (!updated) throw new Error("CRO03C_INITIAL_CONTACT_NOT_FOUND");
      const setHash = stableCro03RecipeHash({
        generationId: claim.generation_id,
        field,
        valueHash: candidateHash(field as any, value),
        sourcePayloadHash: source.payload_hash,
      });
      await db.execute(sql`
        INSERT INTO cro03c_projection_receipts
          (generation_id,contact_id,business_id,contact_source_event_id,link_decision_id,field,
           candidate_set_hash,before_value_hash,after_value_hash,subject_generation,disposition,
           receipt_key,claim_token,execution_fence)
        VALUES (${claim.generation_id}::uuid,${Number(subject.contact_id)},${Number(subject.business_id)},
                ${Number(subject.contact_source_event_id)},${subject.link_decision_id}::uuid,${field},
                ${setHash},${candidateHash(field as any,before)},${candidateHash(field as any,value)},
                ${Number(updated.emailMutationGeneration)},${before === value ? "noop" : "applied"},
                ${`cro03c:${claim.generation_id}:projection:${field}`},
                ${claim.claim_token}::uuid,${claim.execution_fence})
        ON CONFLICT (generation_id,field) DO NOTHING
      `);
    } catch (error) {
      if (!(error instanceof ContactWriteConflictError)) throw error;
      await db.execute(sql`
        UPDATE cro03c_initial_subjects SET state='review_required',terminal_code='projection_cas_conflict',updated_at=NOW()
         WHERE generation_id=${claim.generation_id}::uuid
      `);
      return "review_required";
    }
  }

  let finalization = rows(await db.execute(sql`
    SELECT * FROM cro03c_finalization_receipts WHERE generation_id=${claim.generation_id}::uuid
  `))[0];
  if (!finalization) {
    await requireFence(db, claim);
    finalization = await db.transaction(async (tx) => {
      await requireFence(tx, claim);
      const contact = rows(await tx.execute(sql`
        SELECT id,email,email_token_hash,email_mutation_generation FROM contacts
         WHERE id=${Number(subject.contact_id)} FOR UPDATE
      `))[0];
      const tokenHash = hashEmailToken(contact?.email);
      if (!contact || !tokenHash || tokenHash !== contact.email_token_hash) {
        throw new Error("CRO03C_WINNING_EMAIL_INVALID");
      }
      await tx.execute(sql`
        UPDATE validation_intents
           SET state='superseded',terminal_code='cro03c_winning_email_authority',
               completed_at=NOW(),updated_at=NOW()
         WHERE contact_id=${contact.id} AND subject_generation=${contact.email_mutation_generation}
           AND purpose='marketing_outreach' AND state IN ('pending','claimed','processing')
      `);
      await createValidationIntent(tx, {
        contactId: Number(contact.id),
        email: contact.email,
        generation: Number(contact.email_mutation_generation),
        purpose: "cro03_winning_email",
      });
      const intent = rows(await tx.execute(sql`
        SELECT id FROM validation_intents
         WHERE contact_id=${contact.id} AND normalized_email_token_hash=${tokenHash}
           AND subject_generation=${contact.email_mutation_generation} AND purpose='cro03_winning_email'
      `))[0];
      const authority = rows(await tx.execute(sql`
        SELECT LEAST(c.expires_at,t.expires_at) AS expires_at
          FROM cro03c_commands c JOIN cro03c_runtime_attestations t ON t.id=c.runtime_attestation_id
         WHERE c.id=${claim.command_id}::uuid
      `))[0];
      const inserted = rows(await tx.execute(sql`
        INSERT INTO cro03c_finalization_receipts
          (generation_id,contact_id,validation_intent_id,subject_generation,email_token_hash,
           scoring_request_key,authorization_expires_at)
        VALUES (${claim.generation_id}::uuid,${contact.id},${intent.id}::uuid,
                ${contact.email_mutation_generation},${tokenHash},
                ${`cro03c:${claim.generation_id}:score:g${contact.email_mutation_generation}`},
                ${authority.expires_at}::timestamptz)
        RETURNING *
      `))[0];
      await tx.execute(sql`
        UPDATE cro03c_initial_subjects SET state='validation_pending',updated_at=NOW()
         WHERE generation_id=${claim.generation_id}::uuid
      `);
      return inserted;
    });
  }

  const authorization = rows(await db.execute(sql`
    SELECT id FROM cro03c_validation_authorizations
     WHERE validation_intent_id=${finalization.validation_intent_id}::uuid
  `))[0];
  if (!authorization) {
    await authorizeCro03cValidation({
      intentId: String(finalization.validation_intent_id),
      commandId: claim.command_id,
      runId: claim.run_id,
      generationId: claim.generation_id,
      activationRevision: claim.activation_revision,
      contactId: Number(finalization.contact_id),
      normalizedEmailHash: String(finalization.email_token_hash),
      subjectGeneration: Number(finalization.subject_generation),
      runtimeAttestationId: claim.runtime_attestation_id,
      expiresAt: finalization.authorization_expires_at,
    });
  }
  await enqueueValidationIntent(String(finalization.validation_intent_id));

  const terminal = rows(await db.execute(sql`
    SELECT f.*,v.state AS validation_state,c.email_mutation_generation,c.email_token_hash AS current_email_hash
      FROM cro03c_finalization_receipts f
      JOIN validation_intents v ON v.id=f.validation_intent_id
      JOIN contacts c ON c.id=f.contact_id
     WHERE f.generation_id=${claim.generation_id}::uuid
  `))[0];
  if (!terminal ||
      Number(terminal.subject_generation) !== Number(terminal.email_mutation_generation) ||
      terminal.email_token_hash !== terminal.current_email_hash ||
      !["completed","failed","blocked","superseded"].includes(String(terminal.validation_state))) {
    return "waiting";
  }
  await db.transaction(async (tx) => {
    await requireFence(tx, claim);
    await tx.execute(sql`
      UPDATE cro03c_finalization_receipts SET state='hooks_pending'
       WHERE generation_id=${claim.generation_id}::uuid AND state IN ('validation_pending','validation_terminal')
    `);
    await tx.execute(sql`
      INSERT INTO cro03c_terminal_hooks(generation_id,contact_id,subject_generation,request_key)
      VALUES (${claim.generation_id}::uuid,${Number(terminal.contact_id)},${Number(terminal.subject_generation)},
              ${String(terminal.scoring_request_key)})
      ON CONFLICT (generation_id) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE cro03c_initial_subjects SET state='hooks_pending',updated_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid
    `);
  });
  return await processCro03cInitialTerminalHook(claim) ? "completed" : "waiting";
}

export async function processCro03cInitialTerminalHook(
  claim: Cro03cInitialContinuationClaim,
): Promise<boolean> {
  if (claim.command_type !== "initial_batch") throw new Error("CRO03C_MICRO_CONTINUATION_DENIED");
  const hookToken = randomUUID();
  const hook = rows(await db.execute(sql`
    UPDATE cro03c_terminal_hooks
       SET state='claimed',claim_token=${hookToken}::uuid,execution_fence=execution_fence+1,
           lease_expires_at=NOW()+INTERVAL '2 minutes',attempt_count=attempt_count+1,updated_at=NOW()
     WHERE generation_id=${claim.generation_id}::uuid
       AND (state='pending' OR (state='claimed' AND lease_expires_at<NOW()))
       AND EXISTS (
         SELECT 1 FROM cro03c_generations g
          WHERE g.id=${claim.generation_id}::uuid AND g.claim_token=${claim.claim_token}::uuid
            AND g.execution_fence=${claim.execution_fence} AND g.state='running'
       )
     RETURNING *
  `))[0];
  if (!hook) {
    const completed = rows(await db.execute(sql`
      SELECT id FROM cro03c_terminal_hooks
       WHERE generation_id=${claim.generation_id}::uuid AND state='completed'
    `))[0];
    return Boolean(completed);
  }
  const live = rows(await db.execute(sql`
    SELECT h.*,c.email_mutation_generation,v.state AS validation_state
      FROM cro03c_terminal_hooks h
      JOIN cro03c_finalization_receipts f ON f.generation_id=h.generation_id
      JOIN validation_intents v ON v.id=f.validation_intent_id
      JOIN contacts c ON c.id=h.contact_id
     WHERE h.id=${hook.id}::uuid AND h.claim_token=${hookToken}::uuid
  `))[0];
  if (!live || Number(live.subject_generation) !== Number(live.email_mutation_generation) ||
      !["completed","failed","blocked","superseded"].includes(String(live.validation_state))) {
    await db.execute(sql`
      UPDATE cro03c_terminal_hooks SET state='pending',claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${hook.id}::uuid AND claim_token=${hookToken}::uuid AND execution_fence=${hook.execution_fence}
    `);
    return false;
  }
  if (!live.readiness_enqueued_at) {
    await requireFence(db, claim);
    await enqueueReadinessRecalculation(Number(live.contact_id));
    await db.execute(sql`
      UPDATE cro03c_terminal_hooks SET readiness_enqueued_at=NOW(),updated_at=NOW()
       WHERE id=${hook.id}::uuid AND claim_token=${hookToken}::uuid AND execution_fence=${hook.execution_fence}
    `);
  }
  if (!live.scoring_enqueued_at) {
    await requireFence(db, claim);
    await requestContactLeadScoring(Number(live.contact_id), String(live.request_key));
    await db.execute(sql`
      UPDATE cro03c_terminal_hooks SET scoring_enqueued_at=NOW(),updated_at=NOW()
       WHERE id=${hook.id}::uuid AND claim_token=${hookToken}::uuid AND execution_fence=${hook.execution_fence}
    `);
  }
  await db.transaction(async (tx) => {
    await requireFence(tx, claim);
    const done = rows(await tx.execute(sql`
      UPDATE cro03c_terminal_hooks
         SET state='completed',claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
       WHERE id=${hook.id}::uuid AND claim_token=${hookToken}::uuid
         AND execution_fence=${hook.execution_fence}
         AND readiness_enqueued_at IS NOT NULL AND scoring_enqueued_at IS NOT NULL
       RETURNING generation_id
    `))[0];
    if (!done) throw new Error("CRO03C_TERMINAL_HOOK_FENCE_LOST");
    await tx.execute(sql`
      UPDATE cro03c_finalization_receipts SET state='completed',completed_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03c_initial_subjects SET state='completed',updated_at=NOW()
       WHERE generation_id=${claim.generation_id}::uuid
    `);
  });
  return true;
}