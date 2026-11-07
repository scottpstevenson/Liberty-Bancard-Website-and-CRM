/**
 * Warm Gmail daily capacity. Separate from the fixed cold-outreach sender capacity: the unit is the real connected
 * mailbox (all aliases share it), the limit comes from the current lane configuration revision, and a unit is
 * reserved in the SAME transaction that writes the pre-I/O send receipt, so a reservation can never leak without a
 * receipt. It is released exactly once, only when the provider proved the message was not accepted.
 */
import { sql } from "drizzle-orm";
import { warmCapacityScope } from "./website-email-contracts";

type Exec = { execute: (query: any) => Promise<any> };

export const WARM_COUNTER_CHANNEL = "email";
export const warmCapacityDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

export type WarmReservation = { day: string; scope: string };
export type WarmReserveResult =
  | { ok: true; reservation: WarmReservation }
  | { ok: false; reason: "WARM_NO_CAPACITY" | "WARM_DAILY_LIMIT" };

export async function reserveWarmCapacity(
  tx: Exec,
  input: { account: string; dailyLimit: number; now?: Date },
): Promise<WarmReserveResult> {
  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit <= 0) return { ok: false, reason: "WARM_NO_CAPACITY" };
  const day = warmCapacityDay(input.now);
  const scope = warmCapacityScope(input.account);
  const result = await tx.execute(sql`
    INSERT INTO outbound_send_counters (date, channel, scope, count, updated_at)
    VALUES (${day}, ${WARM_COUNTER_CHANNEL}, ${scope}, 1, now())
    ON CONFLICT (date, channel, scope) DO UPDATE
      SET count = outbound_send_counters.count + 1, updated_at = now()
      WHERE outbound_send_counters.count < ${input.dailyLimit}
    RETURNING count
  `);
  const rows = (result?.rows ?? result ?? []) as unknown[];
  return rows.length === 0 ? { ok: false, reason: "WARM_DAILY_LIMIT" } : { ok: true, reservation: { day, scope } };
}

/** Call only from the transaction that moves a pending receipt to `unsent` (the release is then exactly once). */
export async function releaseWarmCapacity(tx: Exec, reservation: WarmReservation): Promise<void> {
  await tx.execute(sql`
    UPDATE outbound_send_counters SET count = GREATEST(0, count - 1), updated_at = now()
    WHERE date = ${reservation.day} AND channel = ${WARM_COUNTER_CHANNEL} AND scope = ${reservation.scope}
  `);
}

export async function readWarmCapacityUsed(tx: Exec, account: string, now: Date = new Date()): Promise<number> {
  const result = await tx.execute(sql`
    SELECT count FROM outbound_send_counters
    WHERE date = ${warmCapacityDay(now)} AND channel = ${WARM_COUNTER_CHANNEL} AND scope = ${warmCapacityScope(account)}
  `);
  const rows = (result?.rows ?? result ?? []) as Array<{ count: number }>;
  return rows[0] ? Number(rows[0].count) : 0;
}
