/**
 * Outbound Send Log — durable per-touch record and idempotency gate.
 *
 * Every sequence step send is recorded here BEFORE and AFTER the network call:
 *   1. hasSentStep()      → idempotency check (was this step already sent?)
 *   2. openSendAttempt()  → write a 'pending' row (reserve the slot)
 *   3. markSendSent()     → update to 'sent' + provider_message_id
 *   4. markSendFailed()   → update to 'failed' + failure_reason
 *
 * Idempotency key format: seq-{enrollmentId}-s{stepOrder}
 * This makes each step permanently idempotent per enrollment regardless of day.
 *
 * All DB calls use raw SQL (db.execute) to avoid circular import issues with schema.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type SendChannel = "email_gmail" | "email_ghl" | "email_smtp" | "sms_ghl";
export type SendStatus  = "pending" | "sent" | "failed" | "skipped" | "bounced" | "delivered" | "complained";

export interface SendLogRecord {
  id: number;
  idempotencyKey: string;
  sequenceId: number | null;
  sequenceEnrollmentId: number | null;
  contactId: number | null;
  stepOrder: number | null;
  channel: string;
  fromAddress: string | null;
  toAddress: string;
  subject: string | null;
  providerMessageId: string | null;
  status: string;
  failureReason: string | null;
  sentAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
}

/** Format: seq-{enrollmentId}-s{stepOrder} */
export function buildIdempotencyKey(enrollmentId: number, stepOrder: number): string {
  return `seq-${enrollmentId}-s${stepOrder}`;
}

/** Returns true if this step was already successfully sent (status='sent'). */
export async function hasSentStep(idempotencyKey: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT id FROM outbound_send_log
      WHERE idempotency_key = ${idempotencyKey} AND status = 'sent'
      LIMIT 1
    `);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/** Get any existing log row for this key (regardless of status). */
export async function getSendLogByKey(idempotencyKey: string): Promise<SendLogRecord | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, idempotency_key, sequence_id, sequence_enrollment_id, contact_id,
             step_order, channel, from_address, to_address, subject,
             provider_message_id, status, failure_reason, sent_at, failed_at, created_at
      FROM outbound_send_log
      WHERE idempotency_key = ${idempotencyKey}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id:                   r.id,
      idempotencyKey:       r.idempotency_key,
      sequenceId:           r.sequence_id,
      sequenceEnrollmentId: r.sequence_enrollment_id,
      contactId:            r.contact_id,
      stepOrder:            r.step_order,
      channel:              r.channel,
      fromAddress:          r.from_address,
      toAddress:            r.to_address,
      subject:              r.subject,
      providerMessageId:    r.provider_message_id,
      status:               r.status,
      failureReason:        r.failure_reason,
      sentAt:               r.sent_at ? new Date(r.sent_at) : null,
      failedAt:             r.failed_at ? new Date(r.failed_at) : null,
      createdAt:            new Date(r.created_at),
    };
  } catch {
    return null;
  }
}

/**
 * Open a pending send attempt row.
 * Uses INSERT ... ON CONFLICT DO NOTHING so concurrent workers don't race.
 * Returns the row id (or null if the insert was blocked by a conflict, meaning
 * another worker already claimed this slot).
 */
export async function openSendAttempt(params: {
  idempotencyKey: string;
  sequenceId?: number;
  sequenceEnrollmentId?: number;
  contactId?: number;
  stepOrder?: number;
  channel: SendChannel;
  fromAddress?: string;
  toAddress: string;
  subject?: string;
}): Promise<number | null> {
  try {
    const result = await db.execute(sql`
      INSERT INTO outbound_send_log
        (idempotency_key, sequence_id, sequence_enrollment_id, contact_id,
         step_order, channel, from_address, to_address, subject,
         status, created_at, updated_at)
      VALUES
        (${params.idempotencyKey},
         ${params.sequenceId ?? null},
         ${params.sequenceEnrollmentId ?? null},
         ${params.contactId ?? null},
         ${params.stepOrder ?? null},
         ${params.channel},
         ${params.fromAddress ?? null},
         ${params.toAddress},
         ${params.subject ?? null},
         'pending', NOW(), NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    return (result.rows[0] as any).id as number;
  } catch (err) {
    console.warn("[SendLog] openSendAttempt error (non-fatal):", err);
    return null;
  }
}

/** Mark a send as successfully sent and record the provider message ID. */
export async function markSendSent(params: {
  idempotencyKey: string;
  providerMessageId?: string;
  fromAddress?: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE outbound_send_log
      SET status = 'sent',
          sent_at = NOW(),
          updated_at = NOW(),
          provider_message_id = COALESCE(${params.providerMessageId ?? null}, provider_message_id),
          from_address = COALESCE(${params.fromAddress ?? null}, from_address)
      WHERE idempotency_key = ${params.idempotencyKey}
    `);
  } catch (err) {
    console.warn("[SendLog] markSendSent error (non-fatal):", err);
  }
}

/** Mark a send as failed. */
export async function markSendFailed(params: {
  idempotencyKey: string;
  failureReason: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE outbound_send_log
      SET status = 'failed',
          failed_at = NOW(),
          updated_at = NOW(),
          failure_reason = ${params.failureReason}
      WHERE idempotency_key = ${params.idempotencyKey}
    `);
  } catch (err) {
    console.warn("[SendLog] markSendFailed error (non-fatal):", err);
  }
}

/**
 * Update status to 'bounced' or 'complained' when GHL webhook reports it.
 * providerMessageId is used to look up the row if the idempotency key is unknown.
 */
export async function updateSendStatusByProvider(params: {
  providerMessageId: string;
  status: "bounced" | "complained" | "delivered";
  failureReason?: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE outbound_send_log
      SET status = ${params.status},
          failure_reason = ${params.failureReason ?? null},
          updated_at = NOW(),
          delivered_at = CASE WHEN ${params.status} = 'delivered' THEN NOW() ELSE delivered_at END,
          failed_at   = CASE WHEN ${params.status} IN ('bounced','complained') THEN NOW() ELSE failed_at END
      WHERE provider_message_id = ${params.providerMessageId}
    `);
  } catch (err) {
    console.warn("[SendLog] updateSendStatusByProvider error (non-fatal):", err);
  }
}

/** Recent send log rows for a contact (descending). */
export async function getRecentSendsForContact(contactId: number, limit = 20): Promise<SendLogRecord[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, idempotency_key, sequence_id, sequence_enrollment_id, contact_id,
             step_order, channel, from_address, to_address, subject,
             provider_message_id, status, failure_reason, sent_at, failed_at, created_at
      FROM outbound_send_log
      WHERE contact_id = ${contactId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return (result.rows as any[]).map(r => ({
      id:                   r.id,
      idempotencyKey:       r.idempotency_key,
      sequenceId:           r.sequence_id,
      sequenceEnrollmentId: r.sequence_enrollment_id,
      contactId:            r.contact_id,
      stepOrder:            r.step_order,
      channel:              r.channel,
      fromAddress:          r.from_address,
      toAddress:            r.to_address,
      subject:              r.subject,
      providerMessageId:    r.provider_message_id,
      status:               r.status,
      failureReason:        r.failure_reason,
      sentAt:               r.sent_at ? new Date(r.sent_at) : null,
      failedAt:             r.failed_at ? new Date(r.failed_at) : null,
      createdAt:            new Date(r.created_at),
    }));
  } catch {
    return [];
  }
}

/** Summary counts for the readiness dashboard. */
export async function getSendLogSummary(): Promise<{
  totalSent: number;
  totalFailed: number;
  totalBounced: number;
  totalPending: number;
  last24hSent: number;
}> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent')    AS total_sent,
        COUNT(*) FILTER (WHERE status = 'failed')  AS total_failed,
        COUNT(*) FILTER (WHERE status = 'bounced') AS total_bounced,
        COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
        COUNT(*) FILTER (WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours') AS last24h_sent
      FROM outbound_send_log
    `);
    const r = (result.rows[0] as any) ?? {};
    return {
      totalSent:    Number(r.total_sent    ?? 0),
      totalFailed:  Number(r.total_failed  ?? 0),
      totalBounced: Number(r.total_bounced ?? 0),
      totalPending: Number(r.total_pending ?? 0),
      last24hSent:  Number(r.last24h_sent  ?? 0),
    };
  } catch {
    return { totalSent: 0, totalFailed: 0, totalBounced: 0, totalPending: 0, last24hSent: 0 };
  }
}
