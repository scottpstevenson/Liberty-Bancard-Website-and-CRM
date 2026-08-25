/**
 * contact-lead-scoring-trigger.ts
 *
 * Durable per-contact lead scoring request system.
 *
 * Exports:
 *  - requestContactLeadScoring()       — enqueue a scoring job with coalescing + deferred fallback
 *  - runLeadScoringDeferredRecovery()  — bounded recovery worker for Redis-unavailable deferrals
 *
 * Kill-line invariants:
 *  - Redis unavailability writes DB row with status="deferred_queue_unavailable" — no exception to caller.
 *  - Two concurrent recovery workers cannot double-claim the same row (SELECT FOR UPDATE SKIP LOCKED).
 *  - scoreContact() is never called from this module or the queue handler.
 *  - Partial unique index on contact_id (WHERE active status) enforces at most one active row per contact.
 *  - Generation counter coalesces rapid duplicate requests into one job.
 */

import { db } from "../db";
import { contacts, contactLeadScoringJobs } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { requireQueueManagerReady } from "./queue-manager";

const BULLMQ_JOB_ATTEMPTS = 3;
const BULLMQ_BACKOFF_DELAY_MS = 15_000;
const RECOVERY_BATCH = 10;
const MAX_ENQUEUE_ATTEMPTS = 5;

function computeNextAttemptAt(enqueueAttempts: number): Date {
  const baseDelayMs = Math.min(
    60_000 * Math.pow(2, enqueueAttempts),
    30 * 60_000,
  );
  return new Date(Date.now() + baseDelayMs);
}

/**
 * Request per-contact lead scoring with durable coalescing.
 *
 * Returns:
 *  "queued"            — new row created and BullMQ job enqueued
 *  "coalesced"         — existing active row incremented; BullMQ deduplicates by stable jobId
 *  "deferred"          — BullMQ unavailable; DB row persisted with deferred status
 *  "already_current"   — contact is already scored and no active job needed
 *  "contact_not_found" — contact does not exist
 */
export async function requestContactLeadScoring(
  contactId: number,
  triggerSource: string,
): Promise<"queued" | "coalesced" | "deferred" | "already_current" | "contact_not_found"> {
  try {
    const [contact] = await db
      .select({ id: contacts.id, lastScoredAt: contacts.lastScoredAt, lastMeaningfulContactMutationAt: contacts.lastMeaningfulContactMutationAt })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) return "contact_not_found";

    const bullJobId = `lead-scoring-${contactId}`;

    let wasInserted = false;

    const result = await db.execute(sql`
      INSERT INTO contact_lead_scoring_jobs
        (contact_id, requested_generation, processed_generation, status, trigger_sources,
         input_version_snapshot, enqueue_attempts, execution_attempts, created_at, updated_at)
      VALUES
        (${contactId}, 1, 0, 'pending_enqueue', ARRAY[${triggerSource}::text],
         ${contact.lastMeaningfulContactMutationAt ?? null}, 0, 0, NOW(), NOW())
      ON CONFLICT (contact_id) WHERE status NOT IN ('completed', 'contact_not_found', 'failed_terminal')
      DO UPDATE SET
        requested_generation = contact_lead_scoring_jobs.requested_generation + 1,
        trigger_sources      = array_append(contact_lead_scoring_jobs.trigger_sources, ${triggerSource}::text),
        status               = 'pending_enqueue',
        updated_at           = NOW()
      RETURNING id, (xmax = 0) AS was_inserted
    `);

    const row = result.rows[0] as { id: number; was_inserted: boolean } | undefined;
    wasInserted = row?.was_inserted === true;

    if (!row) {
      console.error(`[LeadScoringTrigger] Upsert returned no row for contact ${contactId}`);
      return "deferred";
    }

    const dbRowId: number = row.id;

    try {
      const { requireQueueManagerReady } = await import("./queue-manager");
      const qm = requireQueueManagerReady();
      const queue = qm.getQueue("enrichment");

      if (!queue) {
        await db.execute(sql`
          UPDATE contact_lead_scoring_jobs
          SET status = 'deferred_queue_unavailable',
              enqueue_attempts = enqueue_attempts + 1,
              next_attempt_at  = ${computeNextAttemptAt(0).toISOString()}::timestamptz,
              updated_at       = NOW()
          WHERE id = ${dbRowId}
        `);
        return "deferred";
      }

      await queue.add(
        "contact_lead_scoring",
        { contactId, dbRowId },
        {
          jobId: bullJobId,
          attempts: BULLMQ_JOB_ATTEMPTS,
          backoff: { type: "exponential", delay: BULLMQ_BACKOFF_DELAY_MS },
          removeOnComplete: { count: 0 },
          removeOnFail: { count: 200 },
        },
      );

      await db.execute(sql`
        UPDATE contact_lead_scoring_jobs
        SET status     = 'queued',
            updated_at = NOW()
        WHERE id = ${dbRowId}
      `);

      return wasInserted ? "queued" : "coalesced";
    } catch (queueErr) {
      const attempts = 1;
      await db.execute(sql`
        UPDATE contact_lead_scoring_jobs
        SET status           = 'deferred_queue_unavailable',
            enqueue_attempts = enqueue_attempts + 1,
            next_attempt_at  = ${computeNextAttemptAt(attempts).toISOString()}::timestamptz,
            updated_at       = NOW()
        WHERE id = ${dbRowId}
      `).catch((dbErr) => {
        console.error(`[LeadScoringTrigger] Failed to mark deferred for contact ${contactId}:`, dbErr);
      });
      console.warn(
        `[LeadScoringTrigger] Queue unavailable — deferred scoring for contact ${contactId}:`,
        (queueErr as Error).message,
      );
      return "deferred";
    }
  } catch (err) {
    console.error(`[LeadScoringTrigger] Unexpected error for contact ${contactId}:`, (err as Error).message);
    return "deferred";
  }
}

/**
 * Recovery worker for deferred_queue_unavailable and pending_enqueue rows.
 *
 * Uses SELECT FOR UPDATE SKIP LOCKED *inside a transaction* to ensure two
 * concurrent workers cannot double-claim the same row — locks are held until
 * the transaction commits. Caps at MAX_ENQUEUE_ATTEMPTS before marking terminal.
 *
 * Wire into the ENRICHMENT queue tick (same pattern as runFreeContactEnrichmentTick).
 */
export async function runLeadScoringDeferredRecovery(): Promise<void> {
  let qm: ReturnType<typeof requireQueueManagerReady> | null = null;
  let queue: any | null = null;

  try {
    qm = requireQueueManagerReady();
    queue = qm!.getQueue("enrichment");
  } catch {
    console.warn("[LeadScoringRecovery] Queue manager unavailable — skipping recovery tick");
    return;
  }

  if (!queue) {
    console.warn("[LeadScoringRecovery] Enrichment queue not found — skipping recovery tick");
    return;
  }

  const capturedQueue = queue;

  await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id, contact_id, enqueue_attempts
      FROM contact_lead_scoring_jobs
      WHERE status IN ('deferred_queue_unavailable', 'pending_enqueue')
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY next_attempt_at ASC NULLS FIRST
      LIMIT ${RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    `);

    const rows = (result.rows as Array<{ id: number; contact_id: number; enqueue_attempts: number }>).map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      enqueueAttempts: r.enqueue_attempts,
    }));

    if (rows.length === 0) return;

    for (const row of rows) {
      const bullJobId = `lead-scoring-${row.contactId}`;
      try {
        await capturedQueue.add(
          "contact_lead_scoring",
          { contactId: row.contactId, dbRowId: row.id },
          {
            jobId: bullJobId,
            attempts: BULLMQ_JOB_ATTEMPTS,
            backoff: { type: "exponential", delay: BULLMQ_BACKOFF_DELAY_MS },
            removeOnComplete: { count: 0 },
            removeOnFail: { count: 200 },
          },
        );

        await tx.execute(sql`
          UPDATE contact_lead_scoring_jobs
          SET status     = 'queued',
              updated_at = NOW()
          WHERE id = ${row.id}
        `);
      } catch (enqueueErr) {
        const newAttempts = row.enqueueAttempts + 1;
        const isTerminal = newAttempts >= MAX_ENQUEUE_ATTEMPTS;
        await tx.execute(sql`
          UPDATE contact_lead_scoring_jobs
          SET enqueue_attempts = ${newAttempts},
              next_attempt_at  = ${isTerminal ? null : computeNextAttemptAt(newAttempts).toISOString()}::timestamptz,
              status           = ${isTerminal ? "failed_terminal" : "deferred_queue_unavailable"},
              last_error_code  = ${(enqueueErr as Error).message?.slice(0, 200) ?? "enqueue_failed"},
              updated_at       = NOW()
          WHERE id = ${row.id}
        `);
        console.warn(
          `[LeadScoringRecovery] Re-enqueue failed for contact ${row.contactId} (attempt ${newAttempts}/${MAX_ENQUEUE_ATTEMPTS}):`,
          (enqueueErr as Error).message,
        );
      }
    }
  }).catch((err) => {
    console.warn("[LeadScoringRecovery] Transaction failed:", (err as Error).message);
  });
}
