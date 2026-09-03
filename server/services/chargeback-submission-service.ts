import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getDefaultProcessor } from "./processors/registry";

export type ChargebackSubmissionCommand = {
  id: string; chargebackId: number; idempotencyKey: string; state: string;
};

export function isUuidV4(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function enqueueChargebackSubmission(input: {
  chargebackId: number; idempotencyKey: string; mid: string; caseNumber?: string;
  transactionId?: string; evidenceNotes?: string; evidenceManifest: unknown[];
}): Promise<ChargebackSubmissionCommand> {
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    chargebackId: input.chargebackId, mid: input.mid, caseNumber: input.caseNumber ?? null,
    transactionId: input.transactionId ?? null, evidenceNotes: input.evidenceNotes ?? null,
    evidenceManifest: { files: input.evidenceManifest, submission: {
      mid: input.mid, caseNumber: input.caseNumber ?? null,
      transactionId: input.transactionId ?? null, evidenceNotes: input.evidenceNotes ?? null,
    }},
  })).digest("hex");
  const result = await db.execute(sql`
    INSERT INTO chargeback_submission_commands
      (chargeback_id, idempotency_key, request_fingerprint, evidence_manifest, state)
    VALUES (${input.chargebackId}, ${input.idempotencyKey}::uuid, ${fingerprint},
      ${JSON.stringify({ files: input.evidenceManifest, submission: {
        mid: input.mid, caseNumber: input.caseNumber ?? null,
        transactionId: input.transactionId ?? null, evidenceNotes: input.evidenceNotes ?? null,
      }})}::jsonb, 'pending')
    ON CONFLICT (chargeback_id, idempotency_key)
    DO UPDATE SET updated_at = now()
    RETURNING id, chargeback_id, idempotency_key, state
  `);
  const row = (result.rows ?? result)[0] as any;
  return { id: row.id, chargebackId: Number(row.chargeback_id), idempotencyKey: row.idempotency_key, state: row.state };
}

/**
 * Worker-only side effect. Production is fail-closed until a real provider is
 * explicitly enabled; tests inject the mock adapter through the registry.
 */
export async function processChargebackSubmissionCommand(commandId: string): Promise<void> {
  const claim = await db.execute(sql`
    UPDATE chargeback_submission_commands SET state = 'processing', attempts = attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes', updated_at = now()
    WHERE id = ${commandId}::uuid AND state IN ('pending', 'retryable') AND next_attempt_at <= now()
    RETURNING chargeback_id, idempotency_key, request_fingerprint, evidence_manifest, lease_token, attempts
  `);
  const row = (claim.rows ?? claim)[0] as any;
  if (!row) return;
  if (process.env.CHARGEBACK_PROVIDER_MODE !== "live" && process.env.NODE_ENV === "production") {
    await db.execute(sql`UPDATE chargeback_submission_commands SET state='terminal_failed', last_error='provider_not_explicitly_enabled', lease_token=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=${commandId}::uuid AND lease_token=${row.lease_token}::uuid`);
    return;
  }
  const chargeback = await storage.getChargeback(Number(row.chargeback_id));
  if (!chargeback) {
    await db.execute(sql`UPDATE chargeback_submission_commands SET state='terminal_failed', last_error='chargeback_not_found', lease_token=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=${commandId}::uuid AND lease_token=${row.lease_token}::uuid`);
    return;
  }
  try {
    const adapter = getDefaultProcessor();
    const result = await adapter.submitChargeback({
      mid: (row.evidence_manifest as any)?.submission?.mid ?? "",
      transactionId: (row.evidence_manifest as any)?.submission?.transactionId ?? String(chargeback.id), amount: chargeback.amount,
      reason: chargeback.reasonDescription || chargeback.reasonCode, cardBrand: chargeback.cardBrand,
      caseNumber: (row.evidence_manifest as any)?.submission?.caseNumber ?? undefined,
      evidenceNotes: (row.evidence_manifest as any)?.submission?.evidenceNotes ?? undefined,
      responseDeadline: chargeback.responseDeadline?.toISOString(),
      providerIdempotencyKey: String(row.idempotency_key),
    });
    // REV-05A: submitChargeback now returns HeldResult | ChargebackResult.
    // If held, do not attempt canonical state mutation.
    if ("status" in result && (result as any).status === "held") {
      await db.execute(sql`
        UPDATE chargeback_submission_commands
        SET state='retryable', last_error='held_pending_task_1737',
            lease_token=NULL, lease_expires_at=NULL, updated_at=now()
        WHERE id=${commandId}::uuid AND state='processing' AND lease_token=${row.lease_token}::uuid
      `);
      return;
    }
    const cbResult = result as import("./processors/IProcessorAdapter").ChargebackResult;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE chargeback_submission_commands
      SET state=${cbResult.success ? "succeeded" : "retryable"}, provider_case_id=${cbResult.caseId ?? null},
          provider_result=${JSON.stringify({ status: cbResult.status, success: cbResult.success })}::jsonb,
          submitted_at=${cbResult.success ? new Date() : null},
          last_error=${cbResult.success ? null : (cbResult.error ?? cbResult.message ?? "provider_rejected")},
          next_attempt_at=${cbResult.success ? new Date() : sql`now() + (LEAST(3600, 2 ^ LEAST(attempts, 10)) * interval '1 second')`},
          lease_token=NULL, lease_expires_at=NULL, updated_at=now()
        WHERE id=${commandId}::uuid AND state='processing' AND lease_token=${row.lease_token}::uuid
      `);
      if (cbResult.success) {
        await tx.execute(sql`
          UPDATE chargebacks SET status='Responded', responded_at=now(), updated_at=now()
          WHERE id=${chargeback.id} AND status IN ('New', 'In Progress', 'Pending')
        `);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ambiguous = /timeout|timed out|abort|network|socket|ECONN/i.test(message);
    await db.execute(sql`
      UPDATE chargeback_submission_commands
      SET state=${ambiguous ? "reconcile_required" : "retryable"}, last_error=${message.slice(0, 1000)},
          reconcile_required_at=${ambiguous ? new Date() : null},
          next_attempt_at=now() + (LEAST(3600, 2 ^ LEAST(attempts, 10)) * interval '1 second'),
          lease_token=NULL, lease_expires_at=NULL, updated_at=now()
      WHERE id=${commandId}::uuid AND state='processing' AND lease_token=${row.lease_token}::uuid
    `);
    throw error;
  }
}

/** Queue-owned recovery sweep.  Expired provider calls are never blindly resent:
 * they enter reconcile_required for an operator/provider-reference reconciliation. */
export async function recoverChargebackSubmissionCommands(limit = 25): Promise<{ dispatched: number; reconciliations: number }> {
  const expired = await db.execute(sql`
    UPDATE chargeback_submission_commands
    SET state='reconcile_required', reconcile_required_at=now(), last_error='lease_expired_after_provider_boundary',
        lease_token=NULL, lease_expires_at=NULL, updated_at=now()
    WHERE id IN (
      SELECT id FROM chargeback_submission_commands
      WHERE state='processing' AND lease_expires_at < now()
      ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    RETURNING id
  `);
  const ready = await db.execute(sql`
    SELECT id FROM chargeback_submission_commands
    WHERE state IN ('pending','retryable') AND next_attempt_at <= now()
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
  `);
  let dispatched = 0;
  for (const row of (ready.rows ?? ready) as Array<{ id: string }>) {
    await processChargebackSubmissionCommand(row.id);
    dispatched++;
  }
  return { dispatched, reconciliations: (expired.rows ?? expired).length };
}