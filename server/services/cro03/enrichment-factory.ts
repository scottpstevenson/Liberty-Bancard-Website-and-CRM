import { createHash, randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resolveCommercialGraph } from "../commercial-resolution";
import { ContactWriteConflictError, updateContactLocalFirst } from "../contact-writer";
import {
  CRO03_CANDIDATE_FIELDS, CRO03_PROVIDERS, CRO03_ROUTING_POLICY_VERSION,
  CRO03_SELECTION_POLICY_VERSION, candidateHash, normalizeCandidateValue,
  stableSelectionHash, type Cro03CandidateField, type Cro03Provider,
} from "./contracts";
import { sealCandidate, openCandidate } from "./candidate-vault";
import { selectCro03Route } from "./routing-policy";
import {
  assertCurrentWorkerContext, contextHash, isCro03Provider, reserveCro03ProviderOperation,
  type Cro03WorkerProviderContext,
} from "./provider-context";

type Row = Record<string, any>;
const rows = (result: any): Row[] => result?.rows ?? result ?? [];
export const CRO03_PROVIDER_TRANSPORT_ENABLED = false as const;

export interface CreateCro03BatchInput {
  idempotencyKey: string;
  contactIds: number[];
  actorType: "user" | "system";
  actorId?: string | null;
  purpose?: "provider_pre_spend" | "internal_test";
}

export interface ProviderTransportResult {
  outcome: string;
  candidates?: Array<{
    field: Cro03CandidateField;
    value: string;
    confidence?: number;
    sourceRank?: number;
  }>;
  requestHash?: string;
  receiptReference?: string;
}

export interface Cro03FactoryDependencies {
  allowCertificationTransport?: boolean;
  beforeProviderTransport?: () => Promise<void>;
  afterProviderDispatch?: () => Promise<void>;
  resolveFence?: typeof resolveCommercialGraph;
  apollo?: (input: {
    vertical: string;
    metro: string;
    state: string;
    limit: number;
    context: Cro03WorkerProviderContext;
  }) => Promise<ProviderTransportResult>;
  outscraper?: (input: {
    query: string;
    limit: number;
    context: Cro03WorkerProviderContext;
  }) => Promise<ProviderTransportResult>;
}

function safeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function routeForContact(contact: Row) {
  return selectCro03Route({
    hasWebsite: Boolean(contact.website),
    hasPhone: Boolean(contact.phone),
    hasEmail: Boolean(contact.email && !String(contact.email).includes("no-email-")),
    needsBusinessDiscovery: !contact.business_id && Boolean(contact.company_name),
    needsContactEnrichment: Boolean(contact.company_name && !contact.title),
    needsEmailValidation: Boolean(
      contact.email && !["valid", "invalid", "risky"].includes(String(contact.email_status)),
    ),
  });
}

async function nextProviderForItem(
  itemId: string,
  contact: Row,
): Promise<Cro03Provider | undefined> {
  const terminalRuns = rows(await db.execute(sql`
    SELECT provider FROM cro03_provider_runs
     WHERE item_id = ${itemId}::uuid
       AND state IN ('completed','deferred','failed','cancelled','superseded')
  `));
  const finished = new Set(terminalRuns.map((run) => String(run.provider)));
  return routeForContact(contact).providers.find((provider) => !finished.has(provider));
}

async function advanceAfterProviderStep(input: {
  item: Row;
  contactId: number;
  pendingMutations: number;
  terminalCode: string;
}): Promise<void> {
  const freshContact = await contactRow(input.contactId);
  const nextProvider = freshContact
    ? await nextProviderForItem(String(input.item.id), freshContact)
    : undefined;
  const state = input.pendingMutations > 0 ? "waiting" : nextProvider ? "queued" : "completed";
  const terminalCode = input.pendingMutations > 0
    ? "projection_pending"
    : nextProvider
      ? "provider_step_complete"
      : input.terminalCode;
  await db.execute(sql`
    UPDATE cro03_enrichment_items
       SET state = ${state}, terminal_code = ${terminalCode},
           next_attempt_at = CASE WHEN ${state} = 'queued' THEN NOW() ELSE next_attempt_at END,
           lease_expires_at = NULL, claim_token = NULL,
           completed_at = CASE WHEN ${state} = 'completed' THEN NOW() ELSE NULL END,
           updated_at = NOW()
     WHERE id = ${input.item.id}::uuid
       AND claim_token = ${input.item.claim_token}::uuid
       AND execution_fence = ${input.item.execution_fence}
  `);
  await refreshBatchState(String(input.item.batch_id));
}

async function contactRow(contactId: number): Promise<Row | null> {
  const result = await db.execute(sql`
    SELECT id, email, phone, company_name, title, website, address, city, state,
           email_status, email_mutation_generation, business_id
      FROM contacts WHERE id = ${contactId} LIMIT 1
  `);
  return rows(result)[0] ?? null;
}

export async function createCro03Batch(input: CreateCro03BatchInput): Promise<{
  id: string;
  replayed: boolean;
  totalCount: number;
  executableCount: number;
  blockedCount: number;
}> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error("CRO03_INVALID_IDEMPOTENCY_KEY");
  }
  if (input.contactIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("CRO03_INVALID_SUBJECT_ID");
  }
  const selectionHash = stableSelectionHash(input.contactIds);
  const existing = rows(await db.execute(sql`
    SELECT id, selection_hash, total_count, executable_count, blocked_count
      FROM cro03_enrichment_batches WHERE idempotency_key = ${input.idempotencyKey}
  `))[0];
  if (existing) {
    if (existing.selection_hash !== selectionHash) throw new Error("CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH");
    return {
      id: String(existing.id), replayed: true, totalCount: Number(existing.total_count),
      executableCount: Number(existing.executable_count), blockedCount: Number(existing.blocked_count),
    };
  }
  if (new Set(input.contactIds).size !== input.contactIds.length) {
    throw new Error("CRO03_DUPLICATE_MEMBERSHIP");
  }

  const prepared: Array<{
    ordinal: number;
    contactId: number;
    contact: Row | null;
    decision: any;
    executable: boolean;
  }> = [];
  for (const [ordinal, contactId] of input.contactIds.entries()) {
    const contact = await contactRow(contactId);
    const decision = contact
      ? await resolveCommercialGraph({
        subjectType: "contact", subjectId: contactId, effect: input.purpose ?? "provider_pre_spend",
        persist: true,
      })
      : { allowed: false, resolution: "quarantined", reasonCodes: ["SUBJECT_MISSING"],
        dependencyFingerprint: "", policyVersion: 0, snapshotId: undefined };
    prepared.push({
      ordinal, contactId, contact, decision,
      executable: Boolean(contact && decision.allowed && decision.dependencyFingerprint),
    });
  }
  const executableCount = prepared.filter((entry) => entry.executable).length;
  const blockedCount = prepared.length - executableCount;
  const acquired = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${"cro03-batch:" + input.idempotencyKey}, 0))
    `);
    const concurrentExisting = rows(await tx.execute(sql`
      SELECT id, selection_hash, total_count, executable_count, blocked_count
        FROM cro03_enrichment_batches WHERE idempotency_key = ${input.idempotencyKey}
    `))[0];
    if (concurrentExisting) {
      if (concurrentExisting.selection_hash !== selectionHash) {
        throw new Error("CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      return {
        id: String(concurrentExisting.id), replayed: true,
        totalCount: Number(concurrentExisting.total_count),
        executableCount: Number(concurrentExisting.executable_count),
        blockedCount: Number(concurrentExisting.blocked_count),
      };
    }
    const batchResult = rows(await tx.execute(sql`
      INSERT INTO cro03_enrichment_batches
        (idempotency_key, actor_type, actor_id, purpose, selection_policy_version,
         routing_policy_version, state, total_count, executable_count, blocked_count,
         selection_hash, completed_at)
      VALUES (${input.idempotencyKey}, ${input.actorType}, ${input.actorId ?? null},
              ${input.purpose ?? "provider_pre_spend"}, ${CRO03_SELECTION_POLICY_VERSION},
              ${CRO03_ROUTING_POLICY_VERSION}, ${executableCount === 0 ? "completed" : "queued"},
              ${input.contactIds.length}, ${executableCount}, ${blockedCount}, ${selectionHash},
              CASE WHEN ${executableCount} = 0 THEN NOW() ELSE NULL END)
      RETURNING id
    `));
    const id = String(batchResult[0].id);
    for (const entry of prepared) {
      const membershipHash = safeKey([
        id, entry.ordinal, "contact", entry.contactId,
        entry.decision.dependencyFingerprint ?? "",
      ].join(":"));
      const membership = rows(await tx.execute(sql`
        INSERT INTO cro03_batch_memberships
          (batch_id, ordinal, subject_type, subject_id, root_subject_type, root_subject_id,
           contact_id, business_id, selection_policy_version, dependency_fingerprint,
           pre_spend_snapshot_id, pre_spend_decision, disposition, disposition_reason, membership_hash)
        VALUES (${id}::uuid, ${entry.ordinal}, 'contact', ${entry.contactId}, 'contact', ${entry.contactId},
                ${entry.contact?.id ?? null}, ${entry.contact?.business_id ?? null},
                ${CRO03_SELECTION_POLICY_VERSION}, ${entry.decision.dependencyFingerprint ?? ""},
                ${entry.decision.snapshotId ?? null}::uuid,
                ${entry.decision.allowed ? "allowed" : "quarantined"},
                ${entry.executable ? "executable" : "blocked"},
                ${entry.executable ? null : (entry.decision.reasonCodes ?? ["SUBJECT_MISSING"]).join(",")},
                ${membershipHash})
        RETURNING id
      `))[0];
      await tx.execute(sql`
        INSERT INTO cro03_enrichment_items
          (batch_id, membership_id, state, terminal_code)
        VALUES (${id}::uuid, ${membership.id}::uuid,
                ${entry.executable ? "queued" : "blocked"},
                ${entry.executable ? null : "pre_spend_blocked"})
      `);
    }
    return {
      id, replayed: false, totalCount: input.contactIds.length,
      executableCount, blockedCount,
    };
  });
  return acquired;
}

export async function getCro03BatchStatus(batchId: string): Promise<any | null> {
  const result = rows(await db.execute(sql`
    SELECT b.id, b.state, b.total_count AS "totalCount",
           b.executable_count AS "executableCount", b.blocked_count AS "blockedCount",
           b.completed_count AS "completedCount", b.failed_count AS "failedCount",
           b.cancelled_count AS "cancelledCount", b.selection_policy_version AS "selectionPolicyVersion",
           b.routing_policy_version AS "routingPolicyVersion", b.created_at AS "createdAt",
           b.updated_at AS "updatedAt", b.completed_at AS "completedAt",
           COUNT(i.id) FILTER (WHERE i.state IN ('queued','running','waiting'))::int AS outstanding
      FROM cro03_enrichment_batches b
      LEFT JOIN cro03_enrichment_items i ON i.batch_id = b.id
     WHERE b.id = ${batchId}::uuid
     GROUP BY b.id
  `));
  if (!result[0]) return null;
  const economics = rows(await db.execute(sql`
    SELECT provider,
      COALESCE(SUM(amount_micros) FILTER (WHERE disposition = 'consumed'), 0)::bigint AS consumed_micros,
      COALESCE(SUM(amount_micros) FILTER (WHERE disposition = 'outstanding'), 0)::bigint AS outstanding_micros,
      COALESCE(SUM(amount_micros) FILTER (WHERE disposition = 'released'), 0)::bigint AS released_micros,
      COALESCE(SUM(amount_micros) FILTER (WHERE disposition = 'refunded'), 0)::bigint AS refunded_micros,
      COALESCE(SUM(amount_micros) FILTER (WHERE disposition = 'ambiguous'), 0)::bigint AS ambiguous_micros
      FROM cro03_provider_ledger l
      JOIN cro03_provider_runs r ON r.id = l.provider_run_id
     WHERE r.item_id IN (SELECT id FROM cro03_enrichment_items WHERE batch_id = ${batchId}::uuid)
     GROUP BY provider
  `));
  return { ...result[0], asOf: new Date().toISOString(), economics };
}

export async function cancelCro03Batch(batchId: string): Promise<boolean> {
  const cancelled = await db.transaction(async (tx) => {
    const result = rows(await tx.execute(sql`
      UPDATE cro03_enrichment_batches
         SET state = CASE WHEN completed_count + failed_count + blocked_count >= total_count
                          THEN state ELSE 'cancelled' END,
             cancel_requested_at = NOW(), updated_at = NOW()
       WHERE id = ${batchId}::uuid AND state IN ('queued','running')
       RETURNING id
    `));
    if (!result[0]) return false;
    await tx.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = CASE WHEN state IN ('queued','waiting','running') THEN 'cancelled' ELSE state END,
             terminal_code = CASE WHEN state IN ('queued','waiting','running') THEN 'cancelled_by_operator' ELSE terminal_code END,
             claim_token = CASE WHEN state IN ('queued','waiting','running') THEN NULL ELSE claim_token END,
             lease_expires_at = CASE WHEN state IN ('queued','waiting','running') THEN NULL ELSE lease_expires_at END,
             updated_at = NOW()
       WHERE batch_id = ${batchId}::uuid
    `);
    await tx.execute(sql`
      UPDATE cro03_mutation_commands c
         SET state = 'superseded', disposition = 'no_longer_authoritative',
             failure_code = 'BATCH_CANCELLED', claim_token = NULL,
             lease_expires_at = NULL, updated_at = NOW()
        FROM cro03_enrichment_items i
       WHERE c.item_id = i.id AND i.batch_id = ${batchId}::uuid
         AND c.state IN ('pending','claimed')
    `);
    return true;
  });
  if (!cancelled) return false;
  await refreshBatchState(batchId);
  return true;
}

async function refreshBatchState(batchId: string): Promise<void> {
  await db.execute(sql`
    WITH counts AS (
      SELECT batch_id,
        COUNT(*) FILTER (WHERE state = 'completed')::int AS completed_count,
        COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE state = 'cancelled')::int AS cancelled_count,
        COUNT(*) FILTER (WHERE state IN ('queued','running','waiting'))::int AS outstanding_count
      FROM cro03_enrichment_items WHERE batch_id = ${batchId}::uuid GROUP BY batch_id
    )
    UPDATE cro03_enrichment_batches b
       SET completed_count = c.completed_count,
           failed_count = c.failed_count,
           cancelled_count = c.cancelled_count,
           state = CASE
             WHEN b.cancel_requested_at IS NOT NULL AND c.outstanding_count = 0 THEN 'cancelled'
             WHEN c.outstanding_count = 0 THEN 'completed'
             WHEN c.completed_count + c.failed_count > 0 THEN 'running'
             ELSE b.state END,
           completed_at = CASE WHEN c.outstanding_count = 0 THEN COALESCE(b.completed_at, NOW()) ELSE NULL END,
           updated_at = NOW()
      FROM counts c WHERE b.id = c.batch_id
  `);
}

export async function claimNextCro03Item(): Promise<Row | null> {
  const token = randomUUID();
  const result = rows(await db.execute(sql`
    WITH candidate AS (
      SELECT id FROM cro03_enrichment_items
       WHERE (
         state IN ('queued','waiting')
         OR (state = 'running' AND lease_expires_at < NOW())
       )
         AND NOT EXISTS (
           SELECT 1 FROM cro03_mutation_commands c
            WHERE c.item_id = cro03_enrichment_items.id
              AND c.state IN ('pending','claimed')
         )
         AND NOT EXISTS (
           SELECT 1 FROM cro03_provider_runs r
            WHERE r.item_id = cro03_enrichment_items.id
              AND r.state = 'running'
         )
         AND next_attempt_at <= NOW()
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
         AND batch_id IN (SELECT id FROM cro03_enrichment_batches WHERE state IN ('queued','running'))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE cro03_enrichment_items i
       SET state = 'running', claim_token = ${token}::uuid,
           lease_expires_at = NOW() + INTERVAL '5 minutes',
           attempt_count = attempt_count + 1, execution_fence = execution_fence + 1,
           started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      FROM candidate c
     WHERE i.id = c.id
     RETURNING i.*
  `));
  return result[0] ? { ...result[0], claimToken: token } : null;
}

async function authorizeCro03TransportDispatch(input: {
  itemId: string;
  itemClaimToken: string;
  executionFence: number;
  batchId: string;
  providerRunId: string;
  operationId: string;
  providerClaimToken: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const authority = rows(await tx.execute(sql`
      SELECT i.id
        FROM cro03_enrichment_batches b
        JOIN cro03_enrichment_items i ON i.batch_id = b.id
        JOIN cro03_provider_runs r ON r.item_id = i.id
        JOIN provider_operations o ON o.id = r.operation_id
       WHERE b.id = ${input.batchId}::uuid
         AND b.state IN ('queued','running')
         AND i.id = ${input.itemId}::uuid
         AND i.state = 'running'
         AND i.claim_token = ${input.itemClaimToken}::uuid
         AND i.execution_fence = ${input.executionFence}
         AND i.lease_expires_at > NOW()
         AND r.id = ${input.providerRunId}::uuid
         AND r.state = 'reserved'
         AND o.id = ${input.operationId}::uuid
         AND o.state = 'running'
         AND o.claim_token = ${input.providerClaimToken}::uuid
         AND o.lease_expires_at > NOW()
       FOR UPDATE OF b, i, r, o
    `))[0];
    if (!authority) return false;
    await tx.execute(sql`
      UPDATE cro03_provider_runs
         SET state = 'running'
       WHERE id = ${input.providerRunId}::uuid AND state = 'reserved'
    `);
    return true;
  });
}

export async function reserveCro03ProviderLedger(
  runId: string,
  operationId: string,
  provider: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO cro03_provider_ledger
      (provider_run_id, provider_operation_id, provider, entry_key, disposition, units)
    VALUES (${runId}::uuid, ${operationId}::uuid, ${provider},
            ${`reserve:${runId}`}, 'outstanding', 1)
    ON CONFLICT (entry_key) DO NOTHING
  `);
}

export async function completeCro03ProviderAccounting(
  runId: string,
  operationId: string,
  provider: string,
  disposition: "consumed" | "released" | "ambiguous",
  receipt?: { requestHash?: string; receiptReference?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${"cro03-accounting:" + operationId}, 0)
      )
    `);
    const transitioned = rows(await tx.execute(sql`
      UPDATE cro03_provider_ledger
         SET disposition = ${disposition}, receipt_reference = ${receipt?.receiptReference ?? null}
       WHERE entry_key = ${`reserve:${runId}`} AND disposition = 'outstanding'
       RETURNING id
    `))[0];
    if (!transitioned) return;
    await tx.execute(sql`
      UPDATE provider_operations
         SET state = ${disposition === "consumed" ? "completed" : "failed"},
             billing_state = ${disposition === "consumed" ? "committed" : disposition},
             reserved_units = 0, claim_token = NULL, lease_expires_at = NULL,
             completed_at = NOW(), updated_at = NOW(),
             failure_code = ${disposition === "ambiguous" ? "ambiguous_billing" : null}
       WHERE id = ${operationId}::uuid
    `);
    await tx.execute(sql`
      UPDATE provider_controls
         SET reserved_units = GREATEST(0, reserved_units - 1),
             consumed_units = consumed_units + ${disposition === "consumed" ? 1 : 0},
             last_completed_at = NOW(), last_outcome = ${disposition},
             observed_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE provider = ${provider}
    `);
    await tx.execute(sql`
      INSERT INTO cro03_receipts
        (provider_run_id, provider_operation_id, receipt_key, provider_request_hash,
         billing_disposition, units, receipt_reference, redacted_metadata)
      VALUES (${runId}::uuid, ${operationId}::uuid, ${`receipt:${runId}:${disposition}`},
              ${receipt?.requestHash ?? null}, ${disposition}, 1,
              ${receipt?.receiptReference ?? null}, '{}'::jsonb)
      ON CONFLICT (receipt_key) DO NOTHING
    `);
  });
}

export async function recoverExpiredCro03Dispatches(): Promise<number> {
  const stale = rows(await db.execute(sql`
    SELECT r.id AS provider_run_id, r.operation_id, r.provider, r.item_id, i.batch_id
      FROM cro03_provider_runs r
      JOIN cro03_enrichment_items i ON i.id = r.item_id
      JOIN provider_operations o ON o.id = r.operation_id
     WHERE r.state = 'running'
       AND (
         (i.state = 'running' AND i.lease_expires_at < NOW())
         OR i.state = 'cancelled'
       )
       AND o.lease_expires_at < NOW()
     ORDER BY r.created_at
  `));
  const refreshedBatchIds = new Set<string>();
  let recovered = 0;
  for (const candidate of stale) {
    const didRecover = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${"cro03-accounting:" + candidate.operation_id}, 0)
        )
      `);
      const ledger = rows(await tx.execute(sql`
        UPDATE cro03_provider_ledger
           SET disposition = 'ambiguous'
         WHERE provider_run_id = ${candidate.provider_run_id}::uuid
           AND disposition = 'outstanding'
         RETURNING units
      `))[0];
      if (!ledger) return false;
      await tx.execute(sql`
        UPDATE cro03_provider_runs
           SET state = 'failed', provider_outcome = 'ambiguous_billing',
               billing_disposition = 'ambiguous', completed_at = NOW()
         WHERE id = ${candidate.provider_run_id}::uuid AND state = 'running'
      `);
      await tx.execute(sql`
        UPDATE provider_operations
           SET state = 'failed', billing_state = 'ambiguous',
               failure_code = 'ambiguous_billing_after_dispatch_timeout',
               reserved_units = 0, claim_token = NULL, lease_expires_at = NULL,
               completed_at = NOW(), updated_at = NOW()
         WHERE id = ${candidate.operation_id}::uuid
      `);
      await tx.execute(sql`
        UPDATE provider_controls
           SET reserved_units = GREATEST(0, reserved_units - ${Number(ledger.units)}),
               last_completed_at = NOW(), last_outcome = 'ambiguous',
               observed_at = NOW(), version = version + 1, updated_at = NOW()
         WHERE provider = ${candidate.provider}
      `);
      await tx.execute(sql`
        INSERT INTO cro03_receipts
          (provider_run_id, provider_operation_id, receipt_key, billing_disposition,
           units, redacted_metadata)
        VALUES (${candidate.provider_run_id}::uuid, ${candidate.operation_id}::uuid,
                ${`receipt:${candidate.provider_run_id}:ambiguous`}, 'ambiguous',
                ${Number(ledger.units)}, '{"reason":"dispatch_timeout"}'::jsonb)
        ON CONFLICT (receipt_key) DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE cro03_enrichment_items
           SET state = CASE WHEN state = 'cancelled' THEN state ELSE 'failed' END,
               terminal_code = CASE WHEN state = 'cancelled'
                                    THEN 'cancelled_after_provider_dispatch'
                                    ELSE 'ambiguous_billing_after_dispatch_timeout' END,
               claim_token = NULL, lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW()
         WHERE id = ${candidate.item_id}::uuid AND state IN ('running','cancelled')
      `);
      return true;
    });
    if (didRecover) {
      recovered++;
      refreshedBatchIds.add(String(candidate.batch_id));
    }
  }
  for (const batchId of refreshedBatchIds) await refreshBatchState(batchId);
  return recovered;
}

async function executeDefaultApollo(input: {
  vertical: string; metro: string; state: string; limit: number;
  context: Cro03WorkerProviderContext;
}): Promise<ProviderTransportResult> {
  const { searchApolloForDiscovery } = await import("../sdr/apollo");
  const results = await searchApolloForDiscovery(
    input.vertical, input.metro, input.state, input.limit, input.context,
  );
  const first = results[0];
  if (!first) return { outcome: "no_result", candidates: [] };
  const values: Array<[Cro03CandidateField, string | null, number]> = [
    ["business_name", first.name, 80], ["website", first.website, 80],
    ["email", first.ownerEmail ?? first.email, 75], ["phone", first.ownerPhone ?? first.phone, 75],
    ["address", first.address, 70], ["city", first.city, 70], ["state", first.state, 70],
    ["postal_code", first.zip, 70], ["category", first.category, 60],
    ["owner_name", [first.ownerFirstName, first.ownerLastName].filter(Boolean).join(" ") || null, 75],
    ["owner_title", first.ownerTitle, 70],
  ];
  return {
    outcome: "success",
    candidates: values.filter((entry): entry is [Cro03CandidateField, string, number] => Boolean(entry[1]))
      .map(([field, value, confidence]) => ({ field, value, confidence, sourceRank: 20 })),
  };
}

async function executeDefaultOutscraper(input: {
  query: string; limit: number; context: Cro03WorkerProviderContext;
}): Promise<ProviderTransportResult> {
  const { searchOutscraper } = await import("../sdr/outscraper");
  const results = await searchOutscraper(input.query, input.limit, "US", input.context);
  const first = results[0];
  if (!first) return { outcome: "no_result", candidates: [] };
  const values: Array<[Cro03CandidateField, string | null, number]> = [
    ["business_name", first.name, 75], ["website", first.website, 75],
    ["email", first.email, 65], ["phone", first.phone, 70], ["address", first.address, 70],
    ["city", first.city, 70], ["state", first.state, 70], ["postal_code", first.zip, 70],
    ["category", first.category, 60],
  ];
  return {
    outcome: "success",
    candidates: values.filter((entry): entry is [Cro03CandidateField, string, number] => Boolean(entry[1]))
      .map(([field, value, confidence]) => ({ field, value, confidence, sourceRank: 30 })),
  };
}

async function recordCandidate(input: {
  itemId: string; providerRunId: string; provider: string; field: Cro03CandidateField;
  value: string; confidence: number; sourceRank: number; subjectId: number; generation?: number | null;
  observationId?: string | null;
}): Promise<void> {
  if (!CRO03_CANDIDATE_FIELDS.includes(input.field)) return;
  const envelope = sealCandidate({
    field: input.field, value: input.value, subjectId: input.subjectId,
    subjectGeneration: input.generation,
  });
  await db.execute(sql`
    INSERT INTO cro03_candidates
      (item_id, provider_run_id, observation_id, field, normalized_value_hash, masked_value,
       envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
       subject_generation, confidence, source_rank)
    VALUES (${input.itemId}::uuid, ${input.providerRunId}::uuid, ${input.observationId ?? null}::uuid, ${input.field},
            ${envelope.normalizedValueHash}, ${envelope.maskedValue},
            ${envelope.ciphertext}, ${envelope.nonce}, ${envelope.tag}, ${envelope.keyVersion},
            ${input.generation ?? null}, ${input.confidence}, ${input.sourceRank})
    ON CONFLICT (item_id, field, normalized_value_hash, provider_run_id) DO NOTHING
  `);
}

async function arbitrateField(itemId: string, field: Cro03CandidateField): Promise<Row | null> {
  const candidates = rows(await db.execute(sql`
    SELECT id, normalized_value_hash, confidence, source_rank, created_at
      FROM cro03_candidates
     WHERE item_id = ${itemId}::uuid AND field = ${field}
     ORDER BY confidence DESC, source_rank ASC, created_at ASC, id ASC
  `));
  if (!candidates.length) return null;
  const distinct = new Set(candidates.map((c) => c.normalized_value_hash));
  const conflict = distinct.size > 1;
  const winner = conflict ? null : candidates[0];
  const decisionKey = `arbitrate:${itemId}:${field}`;
  const result = rows(await db.execute(sql`
    INSERT INTO cro03_arbitration_decisions
      (item_id, field, state, winning_candidate_id, decision_key, reason_code, candidate_count, decided_at)
    VALUES (${itemId}::uuid, ${field}, ${conflict ? "conflict" : "winner"},
            ${winner?.id ?? null}::uuid, ${decisionKey}, ${conflict ? "conflicting_values" : "highest_ranked"},
            ${candidates.length}, NOW())
    ON CONFLICT (item_id, field) DO UPDATE SET
      state = EXCLUDED.state,
      winning_candidate_id = EXCLUDED.winning_candidate_id,
      reason_code = EXCLUDED.reason_code,
      candidate_count = EXCLUDED.candidate_count,
      decided_at = EXCLUDED.decided_at
    RETURNING *
  `));
  return result[0] ?? null;
}

const updateFieldByCandidate: Partial<Record<Cro03CandidateField, string>> = {
  email: "email", phone: "phone", website: "website", address: "address",
  city: "city", state: "state", owner_title: "title", category: "industry",
};

async function reconcileMutationItem(itemId: string): Promise<void> {
  const state = rows(await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE state IN ('pending','claimed'))::int AS pending,
           COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE state = 'superseded')::int AS superseded
      FROM cro03_mutation_commands WHERE item_id = ${itemId}::uuid
  `))[0];
  const pending = Number(state?.pending ?? 0);
  const failed = Number(state?.failed ?? 0);
  const superseded = Number(state?.superseded ?? 0);
  const item = rows(await db.execute(sql`
    SELECT i.batch_id, m.contact_id
      FROM cro03_enrichment_items i
      JOIN cro03_batch_memberships m ON m.id = i.membership_id
     WHERE i.id = ${itemId}::uuid
  `))[0];
  const contact = item?.contact_id ? await contactRow(Number(item.contact_id)) : null;
  const nextProvider = failed === 0 && pending === 0 && contact
    ? await nextProviderForItem(itemId, contact)
    : undefined;
  await db.execute(sql`
    UPDATE cro03_enrichment_items
       SET state = ${failed > 0 ? "failed" : pending > 0 ? "waiting" : nextProvider ? "queued" : "completed"},
           terminal_code = ${failed > 0 ? "projection_failed" : pending > 0 ? "projection_pending" : nextProvider ? "provider_step_complete" : superseded > 0 ? "projection_superseded" : "projection_complete"},
           next_attempt_at = CASE WHEN ${Boolean(nextProvider)} THEN NOW() ELSE next_attempt_at END,
           completed_at = CASE WHEN ${pending} = 0 AND ${Boolean(nextProvider)} = FALSE THEN NOW() ELSE NULL END,
           updated_at = NOW()
     WHERE id = ${itemId}::uuid AND state <> 'cancelled'
  `);
  if (item?.batch_id) await refreshBatchState(String(item.batch_id));
}

export async function projectCro03Mutation(commandId: string): Promise<string> {
  const claimToken = randomUUID();
  const claimed = rows(await db.execute(sql`
    UPDATE cro03_mutation_commands
       SET state = 'claimed', claim_token = ${claimToken}::uuid,
           lease_expires_at = NOW() + INTERVAL '5 minutes',
           attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = ${commandId}::uuid
       AND state IN ('pending','claimed')
       AND (state = 'pending' OR lease_expires_at IS NULL OR lease_expires_at < NOW())
       AND item_id IN (
         SELECT i.id FROM cro03_enrichment_items i
         JOIN cro03_enrichment_batches b ON b.id = i.batch_id
          WHERE i.state <> 'cancelled' AND b.state IN ('queued','running')
       )
     RETURNING *
  `))[0];
  if (!claimed) return "not_found";
  const candidate = rows(await db.execute(sql`
    SELECT c.*, m.dependency_fingerprint
      FROM cro03_candidates c
      JOIN cro03_batch_memberships m ON m.id = (
        SELECT membership_id FROM cro03_enrichment_items WHERE id = c.item_id
      )
     WHERE c.id = ${claimed.candidate_id}::uuid
  `))[0];
  if (!candidate) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands SET state = 'failed', disposition = 'failed',
             failure_code = 'CANDIDATE_MISSING', claim_token = NULL, lease_expires_at = NULL,
             updated_at = NOW() WHERE id = ${commandId}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "failed";
  }
  const fence = await resolveCommercialGraph({
    subjectType: claimed.subject_type, subjectId: Number(claimed.subject_id),
    effect: "provider_pre_spend", expectedFingerprint: candidate.dependency_fingerprint,
  });
  if (!fence.allowed) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'superseded', disposition = 'no_longer_authoritative',
             failure_code = 'STALE_GRAPH', applied_at = NOW(), updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "superseded";
  }
  const field = candidate.field as Cro03CandidateField;
  const column = updateFieldByCandidate[field];
  if (!column || claimed.subject_type !== "contact") {
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'superseded', disposition = 'protected_field',
             failure_code = 'FIELD_NOT_PROJECTABLE', updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "protected_field";
  }
  const contact = await contactRow(Number(claimed.subject_id));
  if (!contact) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands SET state = 'failed', disposition = 'failed',
             failure_code = 'SUBJECT_MISSING', claim_token = NULL, lease_expires_at = NULL,
             updated_at = NOW() WHERE id = ${commandId}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "failed";
  }
  if (field === "email" && claimed.expected_generation != null &&
      Number(contact.email_mutation_generation) !== Number(claimed.expected_generation)) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'superseded', disposition = 'stale_generation',
             failure_code = 'STALE_GENERATION', updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "stale_generation";
  }
  const envelope = {
    normalizedValueHash: candidate.normalized_value_hash,
    maskedValue: candidate.masked_value,
    ciphertext: candidate.envelope_ciphertext,
    nonce: candidate.envelope_nonce,
    tag: candidate.envelope_tag,
    keyVersion: Number(candidate.envelope_key_version),
  };
  const value = openCandidate({
    field, subjectId: Number(claimed.subject_id),
    subjectGeneration: candidate.subject_generation, envelope,
  });
  const current = String(contact[column] ?? "");
  const currentValueHash = candidateHash(field, current);
  if (currentValueHash === candidate.normalized_value_hash) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'applied', disposition = 'already_applied', applied_at = NOW(),
             lease_expires_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "already_applied";
  }
  if (currentValueHash !== claimed.expected_value_hash) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'superseded', disposition = 'stale_generation',
             failure_code = 'CURRENT_VALUE_CHANGED', updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "stale_generation";
  }
  let updated;
  try {
    updated = await updateContactLocalFirst(
      Number(claimed.subject_id),
      { [column]: value } as any,
      { actorType: "system", actorId: `cro03:${commandId}` },
      {
        field: column as any,
        expectedValue: contact[column],
        expectedEmailGeneration: field === "email" ? Number(claimed.expected_generation) : undefined,
        authorityCheck: async (tx) => Boolean(rows(await tx.execute(sql`
          SELECT 1
            FROM cro03_mutation_commands c
            JOIN cro03_enrichment_items i ON i.id = c.item_id
            JOIN cro03_enrichment_batches b ON b.id = i.batch_id
           WHERE c.id = ${commandId}::uuid AND c.claim_token = ${claimToken}::uuid
             AND c.state = 'claimed' AND i.state <> 'cancelled'
             AND b.state IN ('queued','running')
           FOR UPDATE OF b, i, c
        `))[0]),
      },
    );
  } catch (error) {
    if (!(error instanceof ContactWriteConflictError)) throw error;
    await db.execute(sql`
      UPDATE cro03_mutation_commands
         SET state = 'superseded', disposition = 'stale_generation',
             failure_code = 'CURRENT_VALUE_CHANGED_DURING_WRITE', updated_at = NOW()
       WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "stale_generation";
  }
  if (!updated) {
    await db.execute(sql`
      UPDATE cro03_mutation_commands SET state = 'failed', disposition = 'failed',
             failure_code = 'WRITE_RETURNED_EMPTY', claim_token = NULL, lease_expires_at = NULL,
             updated_at = NOW() WHERE id = ${commandId}::uuid
    `);
    await reconcileMutationItem(String(claimed.item_id));
    return "failed";
  }
  await db.execute(sql`
    UPDATE cro03_mutation_commands
       SET state = 'applied', disposition = 'applied', applied_at = NOW(),
           lease_expires_at = NULL, claim_token = NULL, updated_at = NOW()
     WHERE id = ${commandId}::uuid AND claim_token = ${claimToken}::uuid
  `);
  await reconcileMutationItem(String(claimed.item_id));
  return "applied";
}

export async function processNextCro03Mutation(): Promise<"idle" | string> {
  const row = rows(await db.execute(sql`
    SELECT id FROM cro03_mutation_commands
     WHERE state = 'pending' OR (state = 'claimed' AND lease_expires_at < NOW())
     ORDER BY created_at LIMIT 1
  `))[0];
  if (!row) return "idle";
  return projectCro03Mutation(String(row.id));
}

async function createMutationForWinner(item: Row, membership: Row, candidate: Row): Promise<void> {
  const field = candidate.field as Cro03CandidateField;
  const column = updateFieldByCandidate[field];
  if (!column || membership.subject_type !== "contact") return;
  const contact = await contactRow(Number(membership.subject_id));
  if (!contact) return;
  const currentValueHash = candidateHash(field, String(contact[column] ?? ""));
  const key = `mutation:${item.id}:${field}:${candidate.normalized_value_hash}`;
  await db.execute(sql`
    INSERT INTO cro03_mutation_commands
      (item_id, candidate_id, mutation_key, subject_type, subject_id, field,
       expected_generation, expected_value_hash)
    VALUES (${item.id}::uuid, ${candidate.id}::uuid, ${key},
            ${membership.subject_type}, ${membership.subject_id}, ${field},
            ${candidate.subject_generation ?? null}, ${currentValueHash})
    ON CONFLICT (mutation_key) DO NOTHING
  `);
}

export async function processNextCro03Item(
  deps: Cro03FactoryDependencies = {},
): Promise<"idle" | "deferred" | "completed" | "failed" | "superseded"> {
  await recoverExpiredCro03Dispatches();
  const item = await claimNextCro03Item();
  if (!item) return "idle";
  const resolveFence = deps.resolveFence ?? resolveCommercialGraph;
  const membership = rows(await db.execute(sql`
    SELECT * FROM cro03_batch_memberships WHERE id = ${item.membership_id}::uuid
  `))[0];
  const active = rows(await db.execute(sql`
    SELECT 1 FROM cro03_enrichment_items i
    JOIN cro03_enrichment_batches b ON b.id = i.batch_id
     WHERE i.id = ${item.id}::uuid AND i.claim_token = ${item.claim_token}::uuid
       AND i.state = 'running' AND b.state IN ('queued','running')
  `))[0];
  if (!active) {
    await db.execute(sql`
      UPDATE cro03_enrichment_items SET state = 'cancelled', terminal_code = 'batch_cancelled',
             claim_token = NULL, lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "superseded";
  }
  const contact = membership?.contact_id ? await contactRow(Number(membership.contact_id)) : null;
  if (!membership || !contact) {
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = 'superseded', terminal_code = 'subject_missing',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "superseded";
  }
  const fence = await resolveFence({
    subjectType: "contact", subjectId: Number(membership.subject_id),
    effect: "provider_pre_spend", expectedFingerprint: membership.dependency_fingerprint,
  });
  if (!fence.allowed) {
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = 'superseded', terminal_code = 'stale_graph',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "superseded";
  }
  const provider = await nextProviderForItem(String(item.id), contact);
  if (!provider) {
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = 'completed', terminal_code = 'no_provider_needed',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "completed";
  }
  const providerRun = rows(await db.execute(sql`
    INSERT INTO cro03_provider_runs
      (item_id, provider, route_policy_version, purpose, state, target_fingerprint)
    VALUES (${item.id}::uuid, ${provider}, ${CRO03_ROUTING_POLICY_VERSION},
            'provider_pre_spend', 'planned', ${membership.dependency_fingerprint})
    ON CONFLICT (item_id, provider) DO UPDATE SET target_fingerprint = EXCLUDED.target_fingerprint
    RETURNING *
  `))[0];
  await db.execute(sql`
    UPDATE cro03_enrichment_items SET current_provider = ${provider},
           current_provider_run_id = ${providerRun.id}::uuid, updated_at = NOW()
     WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
  `);
  const certificationTransportAllowed =
    process.env.NODE_ENV === "test" &&
    deps.allowCertificationTransport === true &&
    ((provider === "apollo" && Boolean(deps.apollo)) ||
      (provider === "outscraper" && Boolean(deps.outscraper)));
  if (
    provider !== "zerobounce" &&
    !CRO03_PROVIDER_TRANSPORT_ENABLED &&
    !certificationTransportAllowed
  ) {
    await db.execute(sql`
      UPDATE cro03_provider_runs SET state = 'completed', provider_outcome = 'disabled',
             billing_disposition = 'none', completed_at = NOW() WHERE id = ${providerRun.id}::uuid
    `);
    await advanceAfterProviderStep({
      item,
      contactId: Number(contact.id),
      pendingMutations: 0,
      terminalCode: "certification_transport_denied",
    });
    return "completed";
  }
  if (provider === "zerobounce") {
    const { createValidationIntent } = await import("../provider-readiness-control");
    await db.transaction(async (tx) => {
      await createValidationIntent(tx, {
        contactId: Number(contact.id), email: contact.email,
        generation: Number(contact.email_mutation_generation), purpose: "cro03_winning_email",
      });
    });
    await db.execute(sql`
      UPDATE cro03_provider_runs SET state = 'completed', provider_outcome = 'success',
             billing_disposition = 'none', completed_at = NOW() WHERE id = ${providerRun.id}::uuid
    `);
    await advanceAfterProviderStep({
      item,
      contactId: Number(contact.id),
      pendingMutations: 0,
      terminalCode: "validation_pending",
    });
    return "completed";
  }
  if (provider === "serper") {
    const preTransportFence = await resolveFence({
      subjectType: "contact", subjectId: Number(membership.subject_id),
      effect: "provider_pre_spend", expectedFingerprint: membership.dependency_fingerprint,
    });
    if (!preTransportFence.allowed) {
      await db.execute(sql`
        UPDATE cro03_enrichment_items SET state = 'superseded', terminal_code = 'stale_before_transport',
               lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
         WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
      `);
      await refreshBatchState(String(item.batch_id));
      return "superseded";
    }
    const { serperGateway } = await import("../serper-gateway");
    const response = await serperGateway.executeSearch(
      "/search",
      { q: `${contact.company_name ?? ""} ${contact.city ?? ""} ${contact.state ?? ""}`, num: 5 },
      "server/services/cro03/enrichment-factory.ts",
    );
    const outcome = response.ok ? "success" : response.blocked ? (response.blockReason ?? "disabled") : "provider_error";
    const first = response.data?.organic?.[0];
    if (response.ok && first?.link) {
      await recordCandidate({
        itemId: String(item.id), providerRunId: String(providerRun.id), provider,
        field: "website", value: String(first.link), confidence: 55, sourceRank: 40,
        subjectId: Number(membership.subject_id),
      });
      const decision = await arbitrateField(String(item.id), "website");
      if (decision?.winning_candidate_id) {
        const winner = rows(await db.execute(sql`
          SELECT * FROM cro03_candidates WHERE id = ${decision.winning_candidate_id}::uuid
        `))[0];
        if (winner) await createMutationForWinner(item, membership, winner);
      }
    }
    await db.execute(sql`
      UPDATE cro03_provider_runs SET state = 'completed', provider_outcome = ${outcome},
             billing_disposition = 'none', completed_at = NOW() WHERE id = ${providerRun.id}::uuid
    `);
    const pending = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM cro03_mutation_commands
       WHERE item_id = ${item.id}::uuid AND state IN ('pending','claimed')
    `))[0];
    await advanceAfterProviderStep({
      item,
      contactId: Number(contact.id),
      pendingMutations: Number(pending?.count ?? 0),
      terminalCode: String(outcome),
    });
    return "completed";
  }
  if (!isCro03Provider(provider)) {
    await db.execute(sql`
      UPDATE cro03_provider_runs SET state = 'deferred', provider_outcome = 'disabled',
             completed_at = NOW() WHERE id = ${providerRun.id}::uuid
    `);
    await db.execute(sql`
      UPDATE cro03_enrichment_items SET state = 'waiting', terminal_code = 'existing_authority_required',
             next_attempt_at = NOW() + INTERVAL '15 minutes', lease_expires_at = NULL, claim_token = NULL
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "deferred";
  }
  const reservation = await reserveCro03ProviderOperation({
    provider, operationIdempotencyKey: `cro03:${providerRun.id}`,
    targetFingerprint: membership.dependency_fingerprint, purpose: "provider_pre_spend",
    actorId: "cro03-factory", requestedUnits: 1,
    itemId: String(item.id),
    itemClaimToken: String(item.claim_token),
    executionFence: Number(item.execution_fence),
  });
  if (!reservation) {
    await db.execute(sql`
      UPDATE cro03_provider_runs SET state = 'deferred', provider_outcome = 'disabled',
             billing_disposition = 'none', completed_at = NOW()
       WHERE id = ${providerRun.id}::uuid
    `);
    await db.execute(sql`
      UPDATE cro03_enrichment_items SET state = 'waiting', terminal_code = 'provider_control_unavailable',
             next_attempt_at = NOW() + INTERVAL '15 minutes', lease_expires_at = NULL, claim_token = NULL
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    return "deferred";
  }
  await db.execute(sql`
    UPDATE cro03_provider_runs
       SET operation_id = ${reservation.operationId}::uuid, state = 'reserved',
           billing_disposition = 'outstanding', authorization_context_hash = ${contextHash(reservation.context)}
     WHERE id = ${providerRun.id}::uuid
  `);
  await reserveCro03ProviderLedger(String(providerRun.id), reservation.operationId, provider);
  const preTransportFence = await resolveFence({
    subjectType: "contact", subjectId: Number(membership.subject_id),
    effect: "provider_pre_spend", expectedFingerprint: membership.dependency_fingerprint,
  });
  if (!preTransportFence.allowed) {
    await completeCro03ProviderAccounting(
      String(providerRun.id),
      reservation.operationId,
      provider,
      "released",
    );
    await db.execute(sql`
      UPDATE cro03_enrichment_items SET state = 'superseded', terminal_code = 'stale_before_transport',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    await refreshBatchState(String(item.batch_id));
    return "superseded";
  }
  await deps.beforeProviderTransport?.();
  const dispatchAuthorized = await authorizeCro03TransportDispatch({
    itemId: String(item.id),
    itemClaimToken: String(item.claim_token),
    executionFence: Number(item.execution_fence),
    batchId: String(item.batch_id),
    providerRunId: String(providerRun.id),
    operationId: reservation.operationId,
    providerClaimToken: reservation.context.claimToken,
  });
  if (!dispatchAuthorized) {
    await completeCro03ProviderAccounting(
      String(providerRun.id),
      reservation.operationId,
      provider,
      "released",
    );
    await db.execute(sql`
      UPDATE cro03_provider_runs
         SET state = 'superseded', provider_outcome = 'superseded',
             billing_disposition = 'released', completed_at = NOW()
       WHERE id = ${providerRun.id}::uuid
    `);
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = 'superseded', terminal_code = 'authority_lost_before_transport',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
         AND execution_fence = ${item.execution_fence}
    `);
    await refreshBatchState(String(item.batch_id));
    return "superseded";
  }
  await deps.afterProviderDispatch?.();
  let result: ProviderTransportResult;
  try {
    await assertCurrentWorkerContext(reservation.context);
    if (provider === "apollo") {
      result = await (deps.apollo ?? executeDefaultApollo)({
          vertical: String(contact.industry ?? "business"),
          metro: String(contact.city ?? "Florida"),
          state: String(contact.state ?? "FL"), limit: 25, context: reservation.context,
        });
    } else if (provider === "outscraper") {
      result = await (deps.outscraper ?? executeDefaultOutscraper)({
          query: `${contact.company_name ?? "business"} ${contact.city ?? ""} ${contact.state ?? ""}`,
          limit: 25, context: reservation.context,
        });
    } else {
      result = { outcome: "disabled", candidates: [] };
    }
  } catch {
    result = { outcome: "provider_error", candidates: [] };
  }
  const outcome = result.outcome;
  const billing = outcome === "success" || outcome === "no_result" ? "consumed" : "ambiguous";
  await db.execute(sql`
    UPDATE cro03_provider_runs
       SET state = ${billing === "ambiguous" ? "failed" : "completed"},
           provider_outcome = ${outcome}, billing_disposition = ${billing}, completed_at = NOW()
     WHERE id = ${providerRun.id}::uuid
  `);
  await completeCro03ProviderAccounting(
    String(providerRun.id), reservation.operationId, provider, billing,
    { requestHash: result.requestHash, receiptReference: result.receiptReference },
  );
  const postTransportFence = await resolveFence({
    subjectType: "contact", subjectId: Number(membership.subject_id),
    effect: "provider_pre_spend", expectedFingerprint: membership.dependency_fingerprint,
  });
  if (!postTransportFence.allowed) {
    await db.execute(sql`
      UPDATE cro03_enrichment_items SET state = 'superseded', terminal_code = 'stale_after_transport',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    await refreshBatchState(String(item.batch_id));
    return "superseded";
  }
  if (result.candidates) {
    for (const candidate of result.candidates) {
      if (!candidate.value?.trim()) continue;
      await recordCandidate({
        itemId: String(item.id), providerRunId: String(providerRun.id), provider,
        field: candidate.field, value: candidate.value,
        confidence: Math.max(0, Math.min(100, candidate.confidence ?? 0)),
        sourceRank: candidate.sourceRank ?? 100, subjectId: Number(membership.subject_id),
        generation: contact.email_mutation_generation,
      });
    }
  }
  const candidateFields = rows(await db.execute(sql`
    SELECT DISTINCT field FROM cro03_candidates WHERE item_id = ${item.id}::uuid
  `)).map((row) => row.field as Cro03CandidateField);
  for (const field of candidateFields) {
    const decision = await arbitrateField(String(item.id), field);
    if (decision?.winning_candidate_id) {
      const winner = rows(await db.execute(sql`
        SELECT * FROM cro03_candidates WHERE id = ${decision.winning_candidate_id}::uuid
      `))[0];
      if (winner) await createMutationForWinner(item, membership, winner);
    }
  }
  const pendingMutations = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM cro03_mutation_commands
     WHERE item_id = ${item.id}::uuid AND state IN ('pending','claimed')
  `))[0];
  const hasPendingMutations = Number(pendingMutations?.count ?? 0) > 0;
  if (billing === "ambiguous") {
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = 'failed', terminal_code = 'ambiguous_billing',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${item.id}::uuid AND claim_token = ${item.claim_token}::uuid
    `);
    await refreshBatchState(String(item.batch_id));
  } else {
    await advanceAfterProviderStep({
      item,
      contactId: Number(contact.id),
      pendingMutations: hasPendingMutations ? Number(pendingMutations?.count ?? 0) : 0,
      terminalCode: String(outcome),
    });
  }
  return billing === "ambiguous" ? "failed" : "completed";
}

export async function getCro03Reconciliation(): Promise<any> {
  const result = rows(await db.execute(sql`
    SELECT provider, disposition, SUM(units)::int AS units, SUM(amount_micros)::bigint AS amount_micros
      FROM cro03_provider_ledger GROUP BY provider, disposition ORDER BY provider, disposition
  `));
  return {
    asOf: new Date().toISOString(),
    providers: CRO03_PROVIDERS,
    rows: result,
    invariant: "cumulative_reserved = consumed + released + refunded + ambiguous + outstanding",
  };
}

/**
 * Converges accepted provider-export rows on the CRO-03 evidence model without
 * making a second provider request or repeating canonical intake projection.
 */
export async function recordCro03ImportEvidence(input: {
  executionId: string;
  provider: "apollo" | "outscraper";
  contactIds: number[];
  actorId?: string | null;
}): Promise<{ batchId: string; recorded: number }> {
  const uniqueContactIds = [...new Set(input.contactIds)].sort((a, b) => a - b);
  const batch = await createCro03Batch({
    idempotencyKey: `csv-cro03:${input.executionId}:${input.provider}`,
    contactIds: uniqueContactIds,
    actorType: "system",
    actorId: input.actorId,
    purpose: "provider_pre_spend",
  });
  const items = rows(await db.execute(sql`
    SELECT i.id, i.batch_id, m.contact_id, m.subject_id
      FROM cro03_enrichment_items i
      JOIN cro03_batch_memberships m ON m.id = i.membership_id
      JOIN cro03_enrichment_batches b ON b.id = i.batch_id
     WHERE i.batch_id = ${batch.id}::uuid
       AND i.state NOT IN ('blocked','cancelled')
       AND b.state IN ('queued','running')
  `));
  let recorded = 0;
  for (const item of items) {
    const contact = await contactRow(Number(item.contact_id));
    if (!contact) continue;
    const run = rows(await db.execute(sql`
      INSERT INTO cro03_provider_runs
        (item_id, provider, route_policy_version, purpose, state, provider_outcome,
         billing_disposition, target_fingerprint, completed_at)
      SELECT ${item.id}::uuid, ${input.provider}, ${CRO03_ROUTING_POLICY_VERSION},
             'import_observation', 'completed', 'success', 'none', m.dependency_fingerprint, NOW()
        FROM cro03_batch_memberships m
        JOIN cro03_enrichment_items i ON i.membership_id = m.id
       WHERE i.id = ${item.id}::uuid
      ON CONFLICT (item_id, provider) DO UPDATE SET completed_at = EXCLUDED.completed_at
      RETURNING id
    `))[0];
    const evidenceHash = safeKey(`${input.executionId}:${input.provider}:${item.subject_id}`);
    let observation = rows(await db.execute(sql`
      SELECT id FROM provider_observations
       WHERE provider = ${input.provider} AND subject_type = 'contact'
         AND subject_id = ${item.subject_id} AND evidence_hash = ${evidenceHash}
       ORDER BY observed_at LIMIT 1
    `))[0];
    if (!observation) observation = rows(await db.execute(sql`
      INSERT INTO provider_observations
        (provider, operation_id, attempt_id, subject_type, subject_id, outcome,
         evidence_hash, retryable, observed_at)
      VALUES (${input.provider}, NULL, NULL, 'contact', ${item.subject_id}, 'success',
              ${evidenceHash}, FALSE, NOW())
      RETURNING id
    `))[0];
    const values: Array<[Cro03CandidateField, unknown, number]> = [
      ["business_name", contact.company_name, 70], ["website", contact.website, 70],
      ["email", String(contact.email).includes("no-email-") ? null : contact.email, 70],
      ["phone", contact.phone, 70], ["address", contact.address, 65],
      ["city", contact.city, 65], ["state", contact.state, 65], ["owner_title", contact.title, 60],
    ];
    for (const [field, value, confidence] of values) {
      if (typeof value !== "string" || !value.trim()) continue;
      await recordCandidate({
        itemId: String(item.id), providerRunId: String(run.id), provider: input.provider,
        field, value, confidence, sourceRank: 60, subjectId: Number(item.subject_id),
        generation: field === "email" ? Number(contact.email_mutation_generation) : null,
        observationId: String(observation.id),
      });
    }
    const candidateFields = rows(await db.execute(sql`
      SELECT DISTINCT field FROM cro03_candidates WHERE item_id = ${item.id}::uuid
    `)).map((row) => row.field as Cro03CandidateField);
    for (const field of candidateFields) {
      const decision = await arbitrateField(String(item.id), field);
      if (!decision?.winning_candidate_id) continue;
      const winner = rows(await db.execute(sql`
        SELECT * FROM cro03_candidates WHERE id = ${decision.winning_candidate_id}::uuid
      `))[0];
      if (winner) {
        await createMutationForWinner(item, {
          subject_type: "contact", subject_id: item.subject_id,
        }, winner);
      }
    }
    const pending = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM cro03_mutation_commands
       WHERE item_id = ${item.id}::uuid AND state IN ('pending','claimed')
    `))[0];
    const projectionPending = Number(pending?.count ?? 0) > 0;
    await db.execute(sql`
      UPDATE cro03_enrichment_items
         SET state = ${projectionPending ? "waiting" : "completed"},
             terminal_code = ${projectionPending ? "projection_pending" : "import_evidence_recorded"},
             completed_at = CASE WHEN ${projectionPending} THEN NULL ELSE NOW() END, updated_at = NOW()
       WHERE id = ${item.id}::uuid AND state <> 'cancelled'
    `);
    recorded++;
  }
  await refreshBatchState(batch.id);
  return { batchId: batch.id, recorded };
}
