/**
 * CRO-08A Correction 5: provider_controls has never had a daily/monthly
 * rollover mechanism (consumed_units only ever increments). This module adds
 * an archive-then-reset period-close step: it archives the elapsed window's
 * consumed_units into the immutable provider_budget_period_ledger, then opens
 * a new provider_controls window under the same optimistic version CAS
 * discipline already used elsewhere in provider-readiness-control.ts. It is
 * intentionally the ONLY place, besides normal reservation/settlement, that
 * ever writes to provider_controls' window/consumed/reserved fields.
 *
 * This is bound to CRO-08A's own schedule authority (a 'candidate_backfill'
 * -adjacent internal tick), not an ad hoc setInterval; see
 * schedule-authority.ts. It never runs unless explicitly invoked — no timer
 * is registered by this file.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export type ProviderBudgetPeriodKey = "daily" | "monthly";

export function periodBounds(periodKey: ProviderBudgetPeriodKey, now: Date): { start: Date; end: Date } {
  if (periodKey === "daily") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Close the current provider_controls window and archive its consumed_units
 * into the immutable ledger, then open a fresh window. Idempotent per
 * (provider, periodKey, periodStartedAt): a second concurrent call either
 * loses the CAS race (returns rolledOver:false) or hits the ledger's unique
 * constraint (caught and treated as already-closed).
 *
 * Returns rolledOver:false (no-op) when the current window has not yet
 * reached its boundary, or when a concurrent rollover already advanced the
 * window past this provider's version.
 */
export async function rolloverProviderBudgetPeriod(input: {
  provider: string;
  periodKey: ProviderBudgetPeriodKey;
  now?: Date;
  actor: string;
}): Promise<{ rolledOver: boolean; reason?: string }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const control = rows(await tx.execute(sql`
      SELECT provider, local_budget_units, reserved_units, consumed_units,
             window_started_at, window_ends_at, version
        FROM provider_controls WHERE provider=${input.provider} FOR UPDATE
    `))[0];
    if (!control) return { rolledOver: false, reason: "provider_not_found" };
    const windowEndsAt = control.window_ends_at ? new Date(control.window_ends_at) : null;
    if (windowEndsAt && windowEndsAt.getTime() > now.getTime()) {
      return { rolledOver: false, reason: "window_not_elapsed" };
    }
    // Never reset reserved_units while a reservation is still outstanding: an
    // in-flight (not yet settled/released) provider reservation belongs to
    // the window it was made in. Zeroing reserved_units here would make that
    // spend invisible for the rest of its own lifecycle and let the new
    // window under-account real outstanding commitments. Defer the rollover
    // until every reservation clears (releases back to 0 on settlement, same
    // as today's release path) rather than carrying it forward with rewritten
    // accounting, which would blur period boundaries for economics reporting.
    if (Number(control.reserved_units) > 0) {
      return { rolledOver: false, reason: "reservations_outstanding" };
    }
    const periodStartedAt = control.window_started_at ? new Date(control.window_started_at) : now;
    const { start: nextStart, end: nextEnd } = periodBounds(input.periodKey, now);
    const consumedAtClose = Number(control.consumed_units);
    const versionAtClose = Number(control.version);
    try {
      await tx.execute(sql`
        INSERT INTO provider_budget_period_ledger
          (provider, period_key, period_started_at, period_ended_at, consumed_units,
           local_budget_units, closed_reservation_version, closed_by)
        VALUES (${input.provider}, ${input.periodKey}, ${periodStartedAt.toISOString()}::timestamptz,
                ${now.toISOString()}::timestamptz, ${consumedAtClose},
                ${control.local_budget_units}, ${versionAtClose}, ${input.actor})
      `);
    } catch (error: any) {
      // Unique-violation on (provider, period_key, period_started_at) means a
      // concurrent rollover already archived this exact window; treat as a
      // safe no-op rather than double-archiving or losing evidence.
      if (String(error?.code) === "23505") return { rolledOver: false, reason: "already_archived" };
      throw error;
    }
    const updated = rows(await tx.execute(sql`
      UPDATE provider_controls
         SET consumed_units = 0,
             reserved_units = 0,
             window_started_at = ${nextStart.toISOString()}::timestamptz,
             window_ends_at = ${nextEnd.toISOString()}::timestamptz,
             version = version + 1,
             updated_at = NOW()
       WHERE provider=${input.provider} AND version=${versionAtClose}
       RETURNING provider
    `));
    if (updated.length === 0) {
      // Lost the CAS race after the ledger insert committed in this same
      // transaction — impossible under FOR UPDATE, kept as a defensive check.
      throw new Error("CRO08A_BUDGET_ROLLOVER_CAS_LOST");
    }
    return { rolledOver: true };
  });
}

/** Query immutable historical spend for a provider/period, for economics
 * reporting (section 16/26). Never mutated after insert (DB trigger enforces
 * this independently of application code). */
export async function getProviderBudgetPeriodHistory(provider: string, limit = 90): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT provider, period_key, period_started_at, period_ended_at, consumed_units,
           local_budget_units, closed_by, closed_at
      FROM provider_budget_period_ledger
     WHERE provider=${provider}
     ORDER BY period_started_at DESC
     LIMIT ${limit}
  `));
}
