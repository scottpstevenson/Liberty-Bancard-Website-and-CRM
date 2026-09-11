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

// ── MI-03: Business-only projection ───────────────────────────────────────────
// Writes a businesses row + canonical_source_links + business_locations row
// WITHOUT touching contacts, email validation, outreach, or GHL.
// Called in the authorized-projection step of the CRO-03B admission flow.
//
// Transaction model (three independent steps):
//   Step 1: Read-only check of canonical_source_links for idempotency (no tx)
//   Step 2: resolveOrganization() — owns its own db.transaction() internally.
//           MUST NOT be called inside an outer db.transaction(): Drizzle nested
//           transactions share the same PG connection via savepoints, so an outer
//           rollback would attempt to undo the business creation committed by
//           resolveOrganization, causing connection-state corruption.
//   Step 3: Small write tx — inserts canonical_source_links (ON CONFLICT for
//           concurrent-race detection), upserts business_locations via partial
//           unique index (migration 0248), advances recipe item to 'completed',
//           writes audit log.
//
// Any orphan business created by a losing concurrent resolveOrganization() call
// is harmless — it is discoverable via businesses.id and can be merged by MI-07.

export async function projectBusinessOnly(input: {
  itemId: string;
  sourceSystem: string;
  sourceType: string;
  stableKey: string;
  organization: {
    canonicalName: string;
    websiteDomain?: string | null;
    googlePlaceId?: string | null;
    mainPhone?: string | null;
    city?: string | null;
    state?: string | null;
  };
  location?: {
    countyFips?: string | null;
    licenseSourceKey?: string | null;
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    isPrimary?: boolean;
  };
  rawEvidence?: Record<string, unknown> | null;
}): Promise<
  | { outcome: "created" | "matched"; businessId: number; sourceLinkId: string }
  | { outcome: "conflict"; candidateIds: number[]; conflictEvidenceId: string }
> {
  // ── Step 1: Source-link-first idempotency check (no transaction) ──────────
  const existingLink = rows(await db.execute(sql`
    SELECT id, business_id FROM canonical_source_links
     WHERE source_system = ${input.sourceSystem}
       AND source_type   = ${input.sourceType}
       AND stable_key    = ${input.stableKey}
     LIMIT 1
  `))[0];

  if (existingLink) {
    const businessId = Number(existingLink.business_id);
    const sourceLinkId = String(existingLink.id);
    await db.execute(sql`
      UPDATE canonical_source_links
         SET last_confirmed_at = NOW(),
             raw_evidence = COALESCE(${input.rawEvidence ? JSON.stringify(input.rawEvidence) : null}::jsonb, raw_evidence),
             updated_at = NOW()
       WHERE id = ${sourceLinkId}::uuid
    `);
    // Upsert business_locations so records linked before countyFips became available
    // can gain location data on replay (e.g. after the MI-06 import-runner field fix).
    const replayCountyFips = input.location?.countyFips ?? null;
    if (replayCountyFips !== null) {
      await db.execute(sql`
        INSERT INTO business_locations
          (business_id, street_address, city, state, postal_code, is_primary, county_fips, license_source_key)
        VALUES
          (${businessId},
           ${input.location?.streetAddress ?? null},
           ${input.location?.city ?? input.organization.city ?? null},
           ${input.location?.state ?? input.organization.state ?? null},
           ${input.location?.postalCode ?? null},
           ${input.location?.isPrimary ?? true},
           ${replayCountyFips},
           ${input.location?.licenseSourceKey ?? null})
        ON CONFLICT (business_id, county_fips) WHERE county_fips IS NOT NULL
        DO UPDATE SET
          license_source_key = COALESCE(EXCLUDED.license_source_key, business_locations.license_source_key),
          updated_at = NOW()
      `);
    }
    // Advance the recipe item to completed (idempotent — WHERE state <> 'completed' guard).
    // When a source link already existed, the recipe item was never advanced in the prior run.
    await db.execute(sql`
      UPDATE cro03b_recipe_items
         SET business_id=${businessId}, state='completed',
             terminal_code='business_only_projection_completed',
             completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
       WHERE id=${input.itemId}::uuid AND state<>'completed'
    `);
    await db.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed', attempt_count=attempt_count+1,
             outcome_code='business_only_projection_completed',
             completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
       WHERE item_id=${input.itemId}::uuid AND step_key='canonical-projection' AND state<>'completed'
    `);
    return { outcome: "matched" as const, businessId, sourceLinkId };
  }

  // ── Step 2: Resolve or create the businesses row (resolveOrganization tx) ─
  const organization = await resolveOrganization(input.organization);

  // ── Step 3: Write source link + location + recipe item in one small tx ────
  return db.transaction(async (tx) => {
    if (organization.kind === "deferred") {
      const conflictRow = rows(await tx.execute(sql`
        INSERT INTO canonical_conflict_evidence
          (business_id_a, business_id_b, conflict_type, field, evidence_payload)
        VALUES (
          ${organization.candidateIds[0] ?? null},
          ${organization.candidateIds[1] ?? null},
          ${organization.reasonCode},
          NULL,
          ${JSON.stringify({
            sourceSystem: input.sourceSystem,
            sourceType: input.sourceType,
            stableKey: input.stableKey,
            itemId: input.itemId,
            candidateIds: organization.candidateIds,
          })}::jsonb
        )
        RETURNING id
      `))[0];
      const conflictEvidenceId = String(conflictRow.id);
      await tx.execute(sql`
        INSERT INTO audit_logs(user_id, action, entity_type, entity_key, details, actor_type, actor_id)
        VALUES ('system','canonical_conflict_evidence_written','canonical_conflict_evidence',${conflictEvidenceId},
                ${JSON.stringify({ itemId: input.itemId, reasonCode: organization.reasonCode, candidateIds: organization.candidateIds })}::jsonb,
                'system','cro03b')
      `);
      await tx.execute(sql`
        UPDATE cro03b_recipe_items
           SET state='review_required', terminal_code=${organization.reasonCode}, updated_at=NOW()
         WHERE id=${input.itemId}::uuid
      `);
      return { outcome: "conflict" as const, candidateIds: organization.candidateIds, conflictEvidenceId };
    }

    const resolvedBusinessId = organization.business.id;
    const isNew = organization.kind === "created";

    // ON CONFLICT returns the winning row. Re-read RETURNING business_id to
    // detect a concurrent-projection race where another tx won first.
    const linkRow = rows(await tx.execute(sql`
      INSERT INTO canonical_source_links
        (business_id, source_system, source_type, stable_key, raw_evidence, first_seen_at, last_confirmed_at)
      VALUES
        (${resolvedBusinessId}, ${input.sourceSystem}, ${input.sourceType}, ${input.stableKey},
         ${input.rawEvidence ? JSON.stringify(input.rawEvidence) : null}::jsonb,
         NOW(), NOW())
      ON CONFLICT (source_system, source_type, stable_key) DO UPDATE
        SET last_confirmed_at = NOW(),
            raw_evidence = COALESCE(EXCLUDED.raw_evidence, canonical_source_links.raw_evidence),
            updated_at = NOW()
      RETURNING id, business_id
    `))[0];
    const sourceLinkId = String(linkRow.id);
    const storedBusinessId = Number(linkRow.business_id);

    if (storedBusinessId !== resolvedBusinessId) {
      // Concurrent race — a different business won this source link.
      const conflictRow = rows(await tx.execute(sql`
        INSERT INTO canonical_conflict_evidence
          (business_id_a, business_id_b, conflict_type, field, evidence_payload)
        VALUES (${storedBusinessId}, ${resolvedBusinessId}, 'concurrent_projection_race', 'business_id',
                ${JSON.stringify({
                  sourceSystem: input.sourceSystem, sourceType: input.sourceType,
                  stableKey: input.stableKey, itemId: input.itemId,
                  resolvedBusinessId, storedBusinessId,
                })}::jsonb)
        RETURNING id
      `))[0];
      const conflictEvidenceId = String(conflictRow.id);
      await tx.execute(sql`
        INSERT INTO audit_logs(user_id, action, entity_type, entity_key, details, actor_type, actor_id)
        VALUES ('system','canonical_conflict_evidence_written','canonical_conflict_evidence',${conflictEvidenceId},
                ${JSON.stringify({ itemId: input.itemId, reasonCode: 'concurrent_projection_race', candidateIds: [storedBusinessId, resolvedBusinessId] })}::jsonb,
                'system','cro03b')
      `);
      await tx.execute(sql`
        UPDATE cro03b_recipe_items
           SET state='review_required', terminal_code='concurrent_projection_race', updated_at=NOW()
         WHERE id=${input.itemId}::uuid
      `);
      return { outcome: "conflict" as const, candidateIds: [storedBusinessId, resolvedBusinessId], conflictEvidenceId };
    }

    // Authoritative business_id confirmed. Upsert business_locations.
    // Migration 0248 adds a partial unique index on (business_id, county_fips)
    // WHERE county_fips IS NOT NULL — use ON CONFLICT for atomic upsert.
    // When county_fips is null, no location row is written (MI-09 enriches later).
    const countyFips = input.location?.countyFips ?? null;
    if (countyFips !== null) {
      await tx.execute(sql`
        INSERT INTO business_locations
          (business_id, street_address, city, state, postal_code, is_primary, county_fips, license_source_key)
        VALUES
          (${storedBusinessId},
           ${input.location?.streetAddress ?? null},
           ${input.location?.city ?? input.organization.city ?? null},
           ${input.location?.state ?? input.organization.state ?? null},
           ${input.location?.postalCode ?? null},
           ${input.location?.isPrimary ?? true},
           ${countyFips},
           ${input.location?.licenseSourceKey ?? null})
        ON CONFLICT (business_id, county_fips) WHERE county_fips IS NOT NULL
        DO UPDATE SET
          license_source_key = COALESCE(EXCLUDED.license_source_key, business_locations.license_source_key),
          updated_at = NOW()
      `);
    }

    await tx.execute(sql`
      UPDATE cro03b_recipe_items
         SET business_id=${storedBusinessId}, state='completed', terminal_code='business_only_projection_completed',
             completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
       WHERE id=${input.itemId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03b_step_executions
         SET state='completed', attempt_count=attempt_count+1, outcome_code='business_only_projection_completed',
             completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
       WHERE item_id=${input.itemId}::uuid AND step_key='canonical-projection' AND state<>'completed'
    `);
    const auditAction = isNew ? "canonical_business_created" : "canonical_business_updated";
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id, action, entity_type, entity_key, details, actor_type, actor_id)
      VALUES ('system',${auditAction},'business',${String(storedBusinessId)},
              ${JSON.stringify({
                itemId: input.itemId,
                sourceSystem: input.sourceSystem,
                sourceType: input.sourceType,
                stableKey: input.stableKey,
                sourceLinkId,
                countyFips,
              })}::jsonb,
              'system','cro03b')
    `);

    return { outcome: (isNew ? "created" : "matched") as "created" | "matched", businessId: storedBusinessId, sourceLinkId };
  });
}


export function cro03bArbitrationCandidateSetHash(candidates: ReadonlyArray<{
  id: string; valueHash: string; authority: number; confidence: number; observedAt: string;
}>) {
  return stableCro03RecipeHash([...candidates].sort((a, b) =>
    b.authority - a.authority || b.confidence - a.confidence ||
    a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)));
}
// ── MI-05: Business enrichment projection ────────────────────────────────────
// Sibling of projectBusinessOnly(). Writes provider-sourced enrichment fields
// to the businesses table with CAS and idempotency guards.
//
// Kill lines:
//  - Does NOT write person-level candidates to businesses (subjectType check).
//  - Does NOT call writeContact(), updateContactLocalFirst(), or any contact path.
//  - Does NOT use cro03_mutation_commands (no generation_id there).
//  - Idempotent: second call with same generationId + field → no additional write.

/**
 * Candidate input for projectBusinessEnrichmentFields().
 * Produced by candidate-evidence-service.readCandidateEvidence() after decryption.
 */
export interface BusinessEnrichmentCandidate {
  field: string;
  value: string;
  subjectType: "business" | "person";
  confidence: number;
  stageKey: string;
}

export interface ProjectBusinessEnrichmentResult {
  businessId: number;
  generationId: string;
  fieldsWritten: string[];
  fieldsSkipped: string[];
  fieldsIdempotent: string[];
}

/**
 * Projects business-level enrichment candidates onto the businesses row.
 * Only subject_type='business' candidates are eligible; person-level candidates
 * are ignored here (held for MI-06 contact promotion).
 *
 * CAS: only overwrites if incoming confidence > currently stored confidence.
 * Idempotent: a second call with the same generationId + field is a no-op.
 */
export async function projectBusinessEnrichmentFields(input: {
  businessId: number;
  generationId: string;
  candidates: BusinessEnrichmentCandidate[];
}): Promise<ProjectBusinessEnrichmentResult> {
  const { businessId, generationId } = input;
  const fieldsWritten: string[] = [];
  const fieldsSkipped: string[] = [];
  const fieldsIdempotent: string[] = [];

  // Only these fields may be projected from business-level candidates.
  // MI-06: email is intentionally excluded — email must go through winner
  // selection and ZeroBounce validation before writing to businesses.mainEmail.
  // businesses.mainEmail is only written after a provider_valid ZeroBounce result.
  const PROJECTABLE_BUSINESS_FIELDS: Record<string, string> = {
    phone: "main_phone",
    website: "website_domain",
  };

  // Filter to business-level candidates only.
  const businessCandidates = input.candidates.filter((c) => c.subjectType === "business");

  for (const candidate of businessCandidates) {
    const dbColumn = PROJECTABLE_BUSINESS_FIELDS[candidate.field];
    if (!dbColumn) {
      fieldsSkipped.push(candidate.field);
      continue;
    }

    await db.transaction(async (tx) => {
      // Idempotency check: has this generationId already written this field?
      const existing = rows(await tx.execute(sql`
        SELECT id, confidence, generation_id FROM businesses_enrichment_provenance
         WHERE business_id = ${businessId} AND field = ${candidate.field}
         FOR UPDATE
      `))[0];

      if (existing && String(existing.generation_id ?? "") === generationId) {
        fieldsIdempotent.push(candidate.field);
        return;
      }

      // CAS: only overwrite if incoming confidence > stored confidence.
      // When no provenance row exists, treat stored confidence as 0 — BUT also
      // check whether the businesses row already has a non-null value for this field.
      // If it does and confidence is equal, we must not overwrite it (protect
      // pre-existing canonical data that was written before MI-05 provenance existed).
      if (existing && Number(existing.confidence) >= candidate.confidence) {
        fieldsSkipped.push(candidate.field);
        return;
      }

      // No provenance row: check if businesses already has a non-null value.
      // Treat the existing value as having confidence=0 but protect it if
      // the candidate is not materially more confident (confidence must be > 0).
      if (!existing && candidate.confidence <= 0) {
        fieldsSkipped.push(candidate.field);
        return;
      }
      if (!existing) {
        const currentRow = rows(await tx.execute(sql`
          SELECT ${sql.raw(dbColumn)} AS val FROM businesses WHERE id = ${businessId}
        `))[0];
        const currentVal = currentRow?.val;
        if (currentVal !== null && currentVal !== undefined && String(currentVal).trim() !== "") {
          // Existing canonical value with no provenance record — treat as pre-existing.
          // Only allow overwrite if incoming confidence clears the minimum threshold (50).
          if (candidate.confidence < 50) {
            fieldsSkipped.push(candidate.field);
            return;
          }
        }
      }

      // Write to businesses.
      await tx.execute(sql`
        UPDATE businesses
           SET ${sql.raw(dbColumn)} = ${candidate.value}, updated_at = NOW()
         WHERE id = ${businessId}
      `);

      // Upsert provenance record.
      await tx.execute(sql`
        INSERT INTO businesses_enrichment_provenance
          (business_id, field, generation_id, stage_key, confidence, written_at)
        VALUES
          (${businessId}, ${candidate.field}, ${generationId}::uuid,
           ${candidate.stageKey}, ${candidate.confidence}, NOW())
        ON CONFLICT (business_id, field)
        DO UPDATE SET
          generation_id = EXCLUDED.generation_id,
          stage_key     = EXCLUDED.stage_key,
          confidence    = EXCLUDED.confidence,
          written_at    = NOW()
      `);

      await tx.execute(sql`
        INSERT INTO audit_logs(user_id, action, entity_type, entity_key, details, actor_type, actor_id)
        VALUES ('system', 'business_enrichment_field_projected', 'business', ${String(businessId)},
                ${JSON.stringify({ field: candidate.field, generationId, stageKey: candidate.stageKey, confidence: candidate.confidence })}::jsonb,
                'system', 'cro03c_projection')
      `);

      fieldsWritten.push(candidate.field);
    });
  }

  return { businessId, generationId, fieldsWritten, fieldsSkipped, fieldsIdempotent };
}
