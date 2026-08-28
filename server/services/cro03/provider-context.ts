import { createHash, randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { assertProviderActivation, type ProviderSourceId } from "../provider-manifest";

export interface Cro03WorkerProviderContext {
  kind: "cro03_worker";
  provider: "apollo" | "outscraper";
  operationId: string;
  claimToken: string;
  caller: "server/services/cro03/enrichment-factory.ts";
  explicitPaidApproval: true;
  itemId: string;
  itemClaimToken: string;
  executionFence: number;
}

function rows(result: any): any[] {
  return result?.rows ?? result ?? [];
}

/**
 * The adapter context is issued only after the provider operation and budget
 * reservation are committed.  Credentials and application role are not
 * sufficient to construct an authorized context.
 */
export async function reserveCro03ProviderOperation(input: {
  provider: "apollo" | "outscraper";
  operationIdempotencyKey: string;
  targetFingerprint: string;
  purpose: string;
  actorId?: string | null;
  requestedUnits?: number;
  itemId: string;
  itemClaimToken: string;
  executionFence: number;
}): Promise<{ operationId: string; context: Cro03WorkerProviderContext } | null> {
  assertProviderActivation({
    sourceId: input.provider,
    caller: "server/services/cro03/enrichment-factory.ts",
    explicitPaidApproval: true,
  });
  const units = input.requestedUnits ?? 1;
  return db.transaction(async (tx) => {
    const lockKey = `${input.provider}:${input.operationIdempotencyKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existing = rows(await tx.execute(sql`
      SELECT id, state, claim_token, lease_expires_at
        FROM provider_operations
       WHERE provider = ${input.provider} AND idempotency_key = ${input.operationIdempotencyKey}
       LIMIT 1
    `))[0];
    if (existing) {
      if (!["running", "reserved"].includes(String(existing.state))) return null;
      let persistedClaimToken = existing.claim_token;
      if (!persistedClaimToken || !existing.lease_expires_at || new Date(existing.lease_expires_at) <= new Date()) {
        persistedClaimToken = randomUUID();
        await tx.execute(sql`
          UPDATE provider_operations
             SET state = 'running', claim_token = ${persistedClaimToken}::uuid,
                 lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
           WHERE id = ${existing.id}::uuid
        `);
      }
      return providerContext(
        input.provider,
        String(existing.id),
        String(persistedClaimToken),
        input.itemId,
        input.itemClaimToken,
        input.executionFence,
      );
    }
    const reservation = rows(await tx.execute(sql`
      UPDATE provider_controls
         SET reserved_units = reserved_units + ${units}, version = version + 1, updated_at = NOW()
       WHERE provider = ${input.provider}
         AND enabled = TRUE AND circuit_state = 'closed'
         AND local_budget_units IS NOT NULL
         AND reserved_units + consumed_units + ${units} <= local_budget_units
       RETURNING provider
    `))[0];
    if (!reservation) return null;
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider, operation_type, purpose, idempotency_key, actor_type, actor_id,
         target_fingerprint, state, requested_units, reserved_units, billing_state,
         claim_token, lease_expires_at, started_at)
      VALUES (${input.provider}, 'cro03_enrichment', ${input.purpose}, ${input.operationIdempotencyKey},
              'cro03_worker', ${input.actorId ?? null}, ${input.targetFingerprint},
              'running', ${units}, ${units}, 'reserved', ${claimToken}::uuid,
              NOW() + INTERVAL '5 minutes', NOW())
      RETURNING id
    `))[0];
    return providerContext(
      input.provider,
      String(operation.id),
      claimToken,
      input.itemId,
      input.itemClaimToken,
      input.executionFence,
    );
  });
}

function providerContext(
  provider: "apollo" | "outscraper",
  operationId: string,
  claimToken: string,
  itemId: string,
  itemClaimToken: string,
  executionFence: number,
): { operationId: string; context: Cro03WorkerProviderContext } {
  return {
    operationId,
    context: {
      kind: "cro03_worker", provider, operationId, claimToken,
      caller: "server/services/cro03/enrichment-factory.ts",
      explicitPaidApproval: true, itemId, itemClaimToken, executionFence,
    },
  };
}

export function contextHash(context: Cro03WorkerProviderContext): string {
  return createHash("sha256").update(
    `${context.kind}:${context.provider}:${context.operationId}:${context.claimToken}:` +
    `${context.itemId}:${context.itemClaimToken}:${context.executionFence}`,
  ).digest("hex");
}

export async function assertCurrentWorkerContext(context: Cro03WorkerProviderContext): Promise<void> {
  const authorizationHash = contextHash(context);
  const result = await db.execute(sql`
    SELECT o.id
      FROM provider_operations o
      JOIN cro03_enrichment_items i ON i.id = ${context.itemId}::uuid
      JOIN cro03_enrichment_batches b ON b.id = i.batch_id
      JOIN cro03_provider_runs r ON r.item_id = i.id AND r.operation_id = o.id
     WHERE o.id = ${context.operationId}::uuid
       AND o.provider = ${context.provider}
       AND o.claim_token = ${context.claimToken}::uuid
       AND o.state = 'running'
       AND o.lease_expires_at > NOW()
       AND r.state = 'running'
       AND r.authorization_context_hash = ${authorizationHash}
        AND i.claim_token = ${context.itemClaimToken}::uuid
        AND i.execution_fence = ${context.executionFence}
        AND i.state = 'running'
        AND i.lease_expires_at > NOW()
        AND b.state IN ('queued','running')
     LIMIT 1
  `);
  if (!rows(result)[0]) throw new Error("CRO03_PROVIDER_CONTEXT_INVALID");
}

export function isCro03Provider(provider: ProviderSourceId): provider is "apollo" | "outscraper" {
  return provider === "apollo" || provider === "outscraper";
}
