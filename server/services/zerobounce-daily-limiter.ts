/**
 * ZeroBounce daily usage reporting
 *
 * Tracks daily validation usage for reporting. The counter is not an
 * authorization or provider-credit gate.
 *
 * The historic configured limit is retained only for compatibility with
 * existing reporting consumers; it does not gate provider requests.
 */

import { pool } from "../db";
import { storage } from "../storage";

const DEFAULT_DAILY_LIMIT = 5_000;

/** Historic reporting value retained for compatibility; never gates requests. */
export async function getZeroBounceDailyLimit(): Promise<number> {
  const val = await storage.getSystemSetting("zerobounce_validation_daily_limit");
  return typeof val === "number" && val > 0 ? val : DEFAULT_DAILY_LIMIT;
}

/** Returns current usage count for today */
export async function getZeroBounceUsageToday(): Promise<number> {
  const result = await pool.query<{ used: number }>(
    `SELECT COUNT(*)::integer AS used
       FROM provider_operations
      WHERE provider = 'zerobounce'
        AND started_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
  );
  return Number(result.rows[0]?.used ?? 0);
}

/**
 * Compatibility/readiness view for legacy consumers. Validation usage is
 * reported, but local daily limits no longer block requests.
 */
export async function checkZeroBounceBudget(): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const [used, limit] = await Promise.all([getZeroBounceUsageToday(), getZeroBounceDailyLimit()]);
  return { allowed: true, used, limit };
}
