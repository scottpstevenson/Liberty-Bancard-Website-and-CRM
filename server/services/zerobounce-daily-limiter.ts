/**
 * ZeroBounce Daily Rate Limiter — atomic implementation
 *
 * Uses a single raw SQL INSERT ... ON CONFLICT DO UPDATE ... WHERE to atomically
 * claim one credit per call, enforcing the cap without a race window.
 *
 * Counter key: "zerobounce_validation_count_YYYY-MM-DD"  (value = jsonb integer)
 * Limit key:   "zerobounce_validation_daily_limit"        (value = jsonb integer)
 *
 * Default cap: 500/day (configurable via system_settings key above).
 */

import { pool } from "../db";
import { storage } from "../storage";

const DEFAULT_DAILY_LIMIT = 500;

function todayKey(): string {
  return `zerobounce_validation_count_${new Date().toISOString().slice(0, 10)}`;
}

/** Returns the configured daily cap */
export async function getZeroBounceDailyLimit(): Promise<number> {
  const val = await storage.getSystemSetting("zerobounce_validation_daily_limit");
  return typeof val === "number" && val > 0 ? val : DEFAULT_DAILY_LIMIT;
}

/** Returns current usage count for today */
export async function getZeroBounceUsageToday(): Promise<number> {
  const val = await storage.getSystemSetting(todayKey());
  return typeof val === "number" ? val : 0;
}

/**
 * Check budget without claiming a credit.
 * Returns { allowed, used, limit }.
 */
export async function checkZeroBounceBudget(): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const [used, limit] = await Promise.all([getZeroBounceUsageToday(), getZeroBounceDailyLimit()]);
  return { allowed: used < limit, used, limit };
}

/**
 * Atomically claim one ZeroBounce credit.
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE ... WHERE so the increment and cap check
 * happen in a single round-trip with no read-write race window.
 *
 * Returns true if a credit was successfully claimed, false if the cap is reached.
 */
export async function claimZeroBounceCredit(): Promise<boolean> {
  const limit = await getZeroBounceDailyLimit();
  const key = todayKey();

  // Atomically increment the counter, but only if current value < limit.
  // If the row doesn't exist yet, insert with value=1 (that's within any sane cap).
  // If the WHERE clause is false (cap reached), ON CONFLICT UPDATE is skipped and
  // RETURNING returns 0 rows — we detect that as "cap reached".
  const result = await pool.query<{ value: number }>(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, '1'::jsonb, now())
     ON CONFLICT (key) DO UPDATE
       SET value       = to_jsonb((COALESCE(system_settings.value::text::integer, 0) + 1)),
           updated_at  = now()
       WHERE COALESCE(system_settings.value::text::integer, 0) < $2
     RETURNING value::text::integer AS value`,
    [key, limit],
  );

  // If RETURNING produced a row the increment succeeded; 0 rows means cap was hit.
  return result.rowCount != null && result.rowCount > 0;
}
