/**
 * CRO-08A Scheduler Worker (MI-09)
 *
 * BullMQ-registered worker that ticks on a repeatable schedule and calls
 * ensureCro08aScheduleOccurrence() for each active CRO-08A schedule definition.
 *
 * Fail-closed design:
 *   - If no active definitions exist, this worker does nothing.
 *   - If the frozen cursor snapshot cannot be read, this worker throws so
 *     BullMQ retries rather than creating an occurrence with a null snapshot.
 *   - This worker NEVER reads live cursors on behalf of an existing occurrence
 *     (that would violate occurrence-service.ts immutability contract).
 *
 * Cadence calculation:
 *   Each active definition row has cadence_cron and window_seconds. The window
 *   for each tick is [now - window_seconds, now]. For the initial occurrence,
 *   window_start = earliest possible due time; subsequent windows are driven by
 *   cron cadence. The scheduler uses a simple "is any occurrence for this
 *   definition in [now-window_seconds, now] still pending?" guard to avoid
 *   creating duplicate windows.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assertCro08aSourceScope } from "../services/cro08a/source-scope";
import {
  ensureCro08aScheduleOccurrence,
} from "../services/cro08a/occurrence-service";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseExpression: parseCronExpression } = require("cron-parser") as {
  parseExpression: (expression: string, opts?: { currentDate?: Date; tz?: string }) => { next: () => { toDate: () => Date } };
};

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const CRO08A_SCHEDULER_JOB_NAME = "cro08a-scheduler-tick";

/**
 * Process one scheduler tick: read all active CRO-08A schedule definitions,
 * determine if a new occurrence is due for each, and call
 * ensureCro08aScheduleOccurrence() when it is.
 *
 * Returns a summary of what was done.
 */
export async function processCro08aSchedulerTick(): Promise<{
  activeDefinitions: number;
  occurrencesEnsured: number;
  occurrencesSkipped: number;
  errors: Array<{ definitionId: string; error: string }>;
}> {
  // Read all active schedule definitions.
  const activeDefinitions = rows(await db.execute(sql`
    SELECT id, definition_hash, logical_key, cadence_cron, timezone, window_seconds,
           overlap_seconds, cursor_semantics, created_at
    FROM cro08a_schedule_definitions
    WHERE active = true
    ORDER BY logical_key
  `));

  if (activeDefinitions.length === 0) {
    // Fail-closed: no active definitions → do nothing.
    return { activeDefinitions: 0, occurrencesEnsured: 0, occurrencesSkipped: 0, errors: [] };
  }

  const now = new Date();
  let occurrencesEnsured = 0;
  let occurrencesSkipped = 0;
  const errors: Array<{ definitionId: string; error: string }> = [];

  for (const def of activeDefinitions) {
    try {
      const windowSeconds = Number(def.window_seconds ?? 3600);
      const windowEnd = now;
      let windowStart = new Date(now.getTime() - windowSeconds * 1000);

      // Cadence-aware due-window check: compare last completed occurrence's window_end
      // to now. If now < last_window_end + cadence_seconds, the next window is not due.
      // For the very first occurrence (no completed prior), it is always due.
      const lastCompleted = rows(await db.execute(sql`
        SELECT window_end
        FROM cro08a_schedule_occurrences
        WHERE schedule_definition_id = ${String(def.id)}::uuid
          AND state = 'reconciled'
        ORDER BY window_end DESC
        LIMIT 1
      `))[0];

      if (lastCompleted?.window_end) {
        // Cadence-aware due-window check using cadence_cron (authoritative) or
        // window_seconds as a fallback. Using cadence_cron is required because
        // definitions may have a cron-based schedule that differs from their
        // processing window length (e.g. daily cron cadence with a 2-hour window).
        // Using window_seconds alone would cause incorrect frequency for such definitions.
        const lastWindowEnd = new Date(String(lastCompleted.window_end));
        let nextDueAt: Date;

        const cadenceCron = def.cadence_cron ? String(def.cadence_cron) : null;
        const timezone = def.timezone ? String(def.timezone) : "UTC";

        if (cadenceCron && cadenceCron !== "" && cadenceCron !== "@window") {
          // Parse the cron expression with cron-parser to find the next scheduled
          // occurrence after the last completed window_end.
          try {
            const interval = parseCronExpression(cadenceCron, {
              currentDate: lastWindowEnd,
              tz: timezone,
            });
            nextDueAt = interval.next().toDate();
          } catch (cronErr: any) {
            // Cron parsing failed: fall back to window_seconds-based cadence.
            console.warn(
              `[CRO08A-Scheduler] Definition ${def.logical_key}: cadence_cron parse failed ` +
              `("${cadenceCron}") — falling back to window_seconds cadence: ${cronErr?.message}`,
            );
            nextDueAt = new Date(lastWindowEnd.getTime() + windowSeconds * 1000);
          }
        } else {
          // No cadence_cron (or placeholder value): use window_seconds as the interval.
          nextDueAt = new Date(lastWindowEnd.getTime() + windowSeconds * 1000);
        }

        if (now < nextDueAt) {
          occurrencesSkipped++;
          continue;
        }
        // The next window starts exactly where the last one ended.
        windowStart = lastWindowEnd;
      }

      // Overlap guard: if any active (not terminal, not cancelled) occurrence exists for
      // this definition, do not create another. Active states: open, claimed, enumerating,
      // enumerated, reconciling. (pending and failed are NOT valid occurrence states.)
      const activeOccurrence = rows(await db.execute(sql`
        SELECT id, state FROM cro08a_schedule_occurrences
        WHERE schedule_definition_id = ${String(def.id)}::uuid
          AND state IN ('open', 'claimed', 'enumerating', 'enumerated', 'reconciling')
        LIMIT 1
      `))[0];

      if (activeOccurrence) {
        console.log(
          `[CRO08A-Scheduler] Skipping definition ${def.logical_key}: ` +
          `active occurrence ${activeOccurrence.id} in state '${activeOccurrence.state}'`,
        );
        occurrencesSkipped++;
        continue;
      }

      // Read the frozen cursor snapshot from cro03a_census_cursors.
      // This is the caller's responsibility per occurrence-service.ts contract:
      // we read the live cursor here and freeze it into the occurrence row.
      // Read census cursors: cro03a_census_cursors keyed by source_system.
      // Columns: source_system (PK), cursor_value, snapshot_high_water, updated_at.
      // Read census cursors: select both numeric and UUID-text cursor columns.
      // Migration 0189 added snapshot_high_water_text and cursor_value_text for
      // UUID-backed source systems (e.g. DBPR-HR). Numeric sources use snapshot_high_water;
      // UUID sources use snapshot_high_water_text. We snapshot both so the processor
      // can apply the correct comparison per source.
      const cursorRows = rows(await db.execute(sql`
        SELECT source_system, cursor_value, snapshot_high_water,
               cursor_value_text, snapshot_high_water_text, updated_at
        FROM cro03a_census_cursors
        ORDER BY source_system
      `));

      if (cursorRows.length === 0) {
        // No census cursors exist yet. This is a critical scheduler failure:
        // without cursor data the occurrence cannot bound its enumeration window.
        // Throw so BullMQ retries the entire tick rather than silently skipping.
        throw new Error(
          `CRO08A_SCHEDULER_NO_CENSUS_CURSORS:definition=${def.logical_key} — ` +
          `cro03a_census_cursors is empty; the CRO-03A qualification pipeline must ` +
          `run at least one census pass before the CRO-08A scheduler can create occurrences`,
        );
      }

      // CRO-08A source-scope contract: reject (never silently skip) any DBPR or
      // non-allowlisted source system before it can ever be frozen into an
      // occurrence snapshot. See server/services/cro08a/source-scope.ts.
      assertCro08aSourceScope(cursorRows.map((cr) => String(cr.source_system)));

      const frozenCursorSnapshot: Record<string, unknown> = {};
      for (const cr of cursorRows) {
        frozenCursorSnapshot[String(cr.source_system)] = {
          cursorValue: String(cr.cursor_value ?? "0"),
          snapshotHighWater: String(cr.snapshot_high_water ?? "0"),
          // UUID-cursor fields (null for numeric sources).
          cursorValueText: cr.cursor_value_text ? String(cr.cursor_value_text) : null,
          snapshotHighWaterText: cr.snapshot_high_water_text ? String(cr.snapshot_high_water_text) : null,
          updatedAt: cr.updated_at,
        };
      }

      const result = await ensureCro08aScheduleOccurrence({
        scheduleDefinitionId: String(def.id),
        definitionHash: String(def.definition_hash),
        windowStart,
        windowEnd,
        frozenCursorSnapshot,
        reason: `scheduler_tick:${CRO08A_SCHEDULER_JOB_NAME}`,
      });

      if (result.created) {
        occurrencesEnsured++;
        console.log(
          `[CRO08A-Scheduler] Created occurrence ${result.id} for definition ${def.logical_key}`,
        );
      } else {
        occurrencesSkipped++;
      }
    } catch (err: any) {
      // Any exception inside a definition's processing block is critical:
      // it means either cursor data is missing, the occurrence could not be created,
      // or a transient DB error occurred. Accumulate for logging, then re-throw
      // so BullMQ marks the entire tick as failed and retries. This is the
      // fail-closed contract: a partial or uncertain state is never silently swallowed.
      const errMsg = String(err?.message ?? "unknown");
      console.error(
        `[CRO08A-Scheduler] Critical error for definition ${def.id} (${def.logical_key}): ${errMsg}`,
      );
      errors.push({ definitionId: String(def.id), error: errMsg });
    }
  }

  // If any definition had a critical error, re-throw so BullMQ retries the tick.
  // BullMQ considers a job successful only when the handler returns without throwing.
  // Returning an error array without throwing would mark the tick successful and
  // suppress all retries — the opposite of the fail-closed contract.
  if (errors.length > 0) {
    throw new Error(
      `CRO08A_SCHEDULER_TICK_FAILED:${errors.length}_definition(s)_errored — ` +
      errors.map((e) => `definition=${e.definitionId}:${e.error}`).join("; "),
    );
  }

  return {
    activeDefinitions: activeDefinitions.length,
    occurrencesEnsured,
    occurrencesSkipped,
    errors,
  };
}
