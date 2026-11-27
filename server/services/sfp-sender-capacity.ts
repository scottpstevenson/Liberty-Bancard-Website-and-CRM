/**
 * One definition of launch-sequence sending capacity, shared by release preview, release execution,
 * the launch readiness view and the sequence worker's dispatch reservation.
 *
 * The SFP launch sends through exactly one fixed sender: the cold-outreach address from the sender
 * policy. Its effective capacity is bounded by the global cold ceiling and, when configured, the
 * remaining daily allowance for that identity. An account-cap-only sender still needs an eligible
 * identity and reserves against both counters, with the sender counter recording usage.
 *
 * First touches and follow-ups reserve against the same counters. A reservation is released only when
 * the transport proves the message was not accepted; an uncertain outcome keeps the reservation.
 * Days roll over on the UTC date, so a new day is a new counter row.
 */
import { pool } from "../db";
import { isSfpSalesAddress, resolveSfpColdSenderPolicy } from "./sender-policy";
import { effectiveSenderDailyLimit, isUsableSenderIdentity } from "./sdr/sender-identity-state";

export const SENDER_COUNTER_CHANNEL = "email";
export const GLOBAL_COLD_SCOPE = "cold_outreach";
export const senderScope = (identityId: number) => `sender:${identityId}`;
export const capacityDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

export interface SelectedSender {
  id: number; emailAddress: string; isActive: boolean | null; warmupStatus: string | null;
  warmupStartedAt: Date | null;
  dailyLimit: number; sentToday: number; usable: boolean;
}

export async function readSelectedSender(executor: Pick<typeof pool, "query"> = pool, lock = false): Promise<SelectedSender | null> {
  const r = await executor.query(
    `SELECT id, email_address AS "emailAddress", is_active AS "isActive", warmup_status AS "warmupStatus",
            COALESCE(warmup_started_at, created_at) AS "warmupStartedAt",
            COALESCE(daily_limit,0)::int AS "dailyLimit", (CASE WHEN counter_date < (now() AT TIME ZONE 'America/New_York')::date THEN 0 ELSE COALESCE(sent_today,0) END)::int AS "sentToday"
       FROM sending_identities WHERE lower(email_address)=lower($1) ORDER BY id LIMIT 1
       ${lock ? "FOR UPDATE" : ""}`, [resolveSfpColdSenderPolicy().from]);
  const row = r.rows[0];
  if (!row) return null;
  return { ...row, usable: isUsableSenderIdentity(row) };
}

function identityDailyLimit(sender: SelectedSender, now: Date): number | null {
  const address = sender.emailAddress.trim().toLowerCase();
  if (isSfpSalesAddress(address) && address === process.env.SFP_COLD_ACCOUNT_CAP_ONLY_FOR?.trim().toLowerCase()) return null;
  // Preserve an explicit zero ceiling rather than falling back to the native default.
  return Math.max(0, Math.min(sender.dailyLimit, effectiveSenderDailyLimit(sender, now)));
}

async function counter(scope: string, day: string): Promise<number> {
  const r = await pool.query(
    `SELECT count FROM outbound_send_counters WHERE date=$1 AND channel=$2 AND scope=$3`,
    [day, SENDER_COUNTER_CHANNEL, scope]);
  return Number(r.rows[0]?.count ?? 0);
}

export interface SenderCapacity {
  day: string;
  sender: { id: number; emailAddress: string; usable: boolean } | null;
  /** Null when the selected sender is governed by the account ceiling alone. */
  identityLimit: number | null;
  identityUsedElsewhere: number;
  identityUsedByLaunch: number;
  identityRemaining: number | null;
  globalCeiling: number;
  globalUsed: number;
  globalRemaining: number;
  /** Released messages that will be due within 24 hours and are not yet sent. */
  committedNext24h: number;
  /** Messages that may still be admitted today. */
  remaining: number;
  limitedBy: "no_selected_sender" | "sender_unusable" | "sender_limit" | "global_ceiling" | "committed_messages" | "none";
}

/** Planning view: the hard reservation limits, minus messages already committed by live journeys. */
export async function readSenderCapacity(now: Date = new Date()): Promise<SenderCapacity> {
  const day = capacityDay(now);
  const sender = await readSelectedSender();
  const { getEffectiveColdDailyCap } = await import("./outbound-cold-cap");
  const globalCeiling = await getEffectiveColdDailyCap();
  const globalUsed = await counter(GLOBAL_COLD_SCOPE, day);
  const identityUsedByLaunch = sender ? await counter(senderScope(sender.id), day) : 0;
  const identityLimit = sender ? identityDailyLimit(sender, now) : 0;
  const identityUsedElsewhere = sender?.sentToday ?? 0;
  const identityRemaining = identityLimit === null ? null
    : sender?.usable ? Math.max(0, identityLimit - identityUsedElsewhere - identityUsedByLaunch) : 0;
  const globalRemaining = Math.max(0, globalCeiling - globalUsed);
  const committed = await pool.query(
    `SELECT count(*)::int AS n FROM sequence_enrollments e JOIN follow_up_sequences q ON q.id=e.sequence_id
      WHERE e.status='active' AND COALESCE(e.metadata,'{}'::jsonb) ? 'canonicalRelease'
        AND (e.next_action_at IS NULL OR e.next_action_at <= $1::timestamptz + INTERVAL '24 hours')
        AND q.sequence_family LIKE 'sfp-v2-cold-%'`, [now.toISOString()]);
  const committedNext24h = Number(committed.rows[0]?.n ?? 0);
  const hard = sender?.usable ? Math.min(identityRemaining ?? globalRemaining, globalRemaining) : 0;
  const remaining = Math.max(0, hard - committedNext24h);
  const limitedBy: SenderCapacity["limitedBy"] = !sender ? "no_selected_sender" : !sender.usable ? "sender_unusable"
    : hard - committedNext24h <= 0 && hard > 0 ? "committed_messages"
    : identityRemaining !== null && identityRemaining <= globalRemaining ? "sender_limit" : "global_ceiling";
  return {
    day, sender: sender ? { id: sender.id, emailAddress: sender.emailAddress, usable: sender.usable } : null,
    identityLimit, identityUsedElsewhere, identityUsedByLaunch, identityRemaining,
    globalCeiling, globalUsed, globalRemaining, committedNext24h, remaining, limitedBy,
  };
}

export interface CapacityReservation { day: string; identityId: number }
export type ReserveResult =
  | { ok: true; reservation: CapacityReservation }
  | { ok: false; reason: "NO_SELECTED_SENDER" | "SENDER_UNUSABLE" | "SENDER_DAILY_LIMIT" | "GLOBAL_DAILY_CEILING" };

/**
 * Atomically reserves one send against the actual sender and the global ceiling in one transaction.
 * Concurrent workers serialize on the counter rows, so the limits are never overshot.
 */
export async function reserveSenderCapacity(now: Date = new Date()): Promise<ReserveResult> {
  const day = capacityDay(now);
  const { getEffectiveColdDailyCap } = await import("./outbound-cold-cap");
  const globalCeiling = await getEffectiveColdDailyCap();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Hold the identity stable while applying its current warm-up, eligibility and usage.
    const sender = await readSelectedSender(client, true);
    if (!sender || !sender.usable) {
      await client.query("ROLLBACK");
      return { ok: false, reason: sender ? "SENDER_UNUSABLE" : "NO_SELECTED_SENDER" };
    }
    const identityLimit = identityDailyLimit(sender, now);
    const remaining = identityLimit === null ? null : identityLimit - sender.sentToday;
    if (remaining !== null && remaining <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "SENDER_DAILY_LIMIT" };
    }
    if (globalCeiling <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "GLOBAL_DAILY_CEILING" };
    }
    const identity = await client.query(
      `INSERT INTO outbound_send_counters (date, channel, scope, count, updated_at)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (date, channel, scope) DO UPDATE
         SET count = outbound_send_counters.count + 1, updated_at = now()
         WHERE $4::int IS NULL OR outbound_send_counters.count < $4
       RETURNING count`,
      [day, SENDER_COUNTER_CHANNEL, senderScope(sender.id), remaining]);
    if (identity.rows.length === 0) { await client.query("ROLLBACK"); return { ok: false, reason: "SENDER_DAILY_LIMIT" }; }
    const global = await client.query(
      `INSERT INTO outbound_send_counters (date, channel, scope, count, updated_at)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (date, channel, scope) DO UPDATE
         SET count = outbound_send_counters.count + 1, updated_at = now()
         WHERE outbound_send_counters.count < $4
       RETURNING count`,
      [day, SENDER_COUNTER_CHANNEL, GLOBAL_COLD_SCOPE, globalCeiling]);
    if (global.rows.length === 0) { await client.query("ROLLBACK"); return { ok: false, reason: "GLOBAL_DAILY_CEILING" }; }
    await client.query("COMMIT");
    return { ok: true, reservation: { day, identityId: sender.id } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Frees one reservation. Call only when the transport proved the message was not accepted.
 * With `within`, the decrement joins the caller's transaction so the caller can settle the reservation atomically
 * with the state change that makes the release correct (and exactly once).
 */
export async function releaseSenderCapacity(reservation: CapacityReservation, within?: { query: (q: string, p?: unknown[]) => Promise<any> }): Promise<void> {
  if (within) {
    for (const scope of [senderScope(reservation.identityId), GLOBAL_COLD_SCOPE]) {
      await within.query(
        `UPDATE outbound_send_counters SET count=GREATEST(0,count-1), updated_at=now()
          WHERE date=$1 AND channel=$2 AND scope=$3`, [reservation.day, SENDER_COUNTER_CHANNEL, scope]);
    }
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const scope of [senderScope(reservation.identityId), GLOBAL_COLD_SCOPE]) {
      await client.query(
        `UPDATE outbound_send_counters SET count=GREATEST(0,count-1), updated_at=now()
          WHERE date=$1 AND channel=$2 AND scope=$3`, [reservation.day, SENDER_COUNTER_CHANNEL, scope]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
