/**
 * Deferred Enrollment Recovery
 *
 * Runs once daily (at 6 AM, after daily caps reset) to re-process enrollments
 * that were deferred because the cold-outreach daily send cap was hit.
 *
 * Metadata contract (set by sequence-worker.ts):
 *   _capDeferStep  — stepOrder that was deferred (number)
 *   _capDeferDate  — ISO date string (YYYY-MM-DD) of the day the cap was hit
 *   _capDeferRetries (optional) — how many recovery attempts have been made
 *
 * Recovery logic:
 *   1. Query sequence_enrollments WHERE status='paused'
 *      AND metadata->>'_capDeferStep' IS NOT NULL
 *      AND metadata->>'_capDeferDate' < today   (strictly less — yesterday or older)
 *   2. For each, attempt an atomic counter reservation (same INSERT … ON CONFLICT pattern
 *      as the main worker).  If the slot is claimed, clear the defer metadata and set
 *      status = 'active' so the sequence worker picks it up on the next tick.
 *   3. If the cap is still exhausted:
 *        retries < 3  → re-defer: bump _capDeferRetries, update _capDeferDate to today
 *        retries >= 3 → mark enrollment 'failed' with reason 'cap_defer_max_retries'
 *   4. Write audit logs for every outcome.
 *
 * Re-entrant safety: uses acquireJobLock / releaseJobLock from job-registry.
 */

import { storage } from "../storage";

const JOB_NAME = "sequence-enrollment-recovery";
const MAX_RETRIES = 3;

export async function recoverDeferredEnrollments(): Promise<{
  recovered: number;
  reDeferred: number;
  failed: number;
  skipped: number;
}> {
  // ── Re-entrant guard ────────────────────────────────────────────────────────
  const { acquireJobLock, releaseJobLock } = await import("./job-registry");
  const lease = await acquireJobLock(JOB_NAME);
  if (lease.status !== "acquired") {
    console.log("[EnrollmentRecovery] Another recovery job is already running — skipping");
    return { recovered: 0, reDeferred: 0, failed: 0, skipped: 0 };
  }
  const lockToken = lease.lockToken;

  let recovered = 0;
  let reDeferred = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    // ── Coordinator gate (#1532): check before capacity reservation + reactivation ──
    {
      const { authorize } = await import("./outbound-pause-authority");
      const { canExecute } = await import("./outbound-queue-coordinator");
      const decision = await authorize({});
      if (!decision.allowed) {
        console.log(`[EnrollmentRecovery] Blocked by OutboundPauseAuthority (reason=${decision.reasonCode}) — skipping recovery run`);
        await releaseJobLock(JOB_NAME, true, undefined, lockToken);
        return { recovered: 0, reDeferred: 0, failed: 0, skipped: 0 };
      }
      const coordOk = await canExecute("enrollment-recovery");
      if (!coordOk) {
        console.log("[EnrollmentRecovery] Coordinator hold on 'enrollment-recovery' — skipping recovery run");
        await releaseJobLock(JOB_NAME, true, undefined, lockToken);
        return { recovered: 0, reDeferred: 0, failed: 0, skipped: 0 };
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    // ── 1. Find all paused enrollments with an outstanding cap-defer ────────
    // _capDeferDate strictly < today (< not <=) so we only pick up defers from
    // a previous day — today's fresh defers should stay paused until tomorrow.
    const rows = await db.execute(sql`
      SELECT id, contact_id, sequence_id, current_step, metadata
      FROM sequence_enrollments
      WHERE status = 'paused'
        AND metadata->>'_capDeferStep'  IS NOT NULL
        AND metadata->>'_capDeferDate'  IS NOT NULL
        AND metadata->>'_capDeferDate'  < ${todayStr}
    `);

    if (rows.rows.length === 0) {
      console.log("[EnrollmentRecovery] No deferred enrollments to recover");
      await releaseJobLock(JOB_NAME, true, undefined, lockToken);
      return { recovered: 0, reDeferred: 0, failed: 0, skipped: 0 };
    }

    console.log(`[EnrollmentRecovery] Found ${rows.rows.length} deferred enrollment(s) to process`);

    // ── Resolve today's effective daily cap (including warmup schedule) ──────
    const capRaw = await storage.getSystemSetting("outboundDailyEmailCap");
    let dailyCap = typeof capRaw === "number" ? capRaw : parseInt(String(capRaw ?? "200"), 10) || 200;

    const warmupEnabledRaw = await storage.getSystemSetting("deliveryWarmupEnabled");
    if (warmupEnabledRaw === true || warmupEnabledRaw === "true") {
      const warmupStartDateRaw = await storage.getSystemSetting("deliveryWarmupStartDate");
      if (typeof warmupStartDateRaw === "string" && warmupStartDateRaw) {
        const daysSince = Math.max(
          1,
          Math.floor((Date.now() - new Date(warmupStartDateRaw).getTime()) / 86400000) + 1,
        );
        let warmupCap: number;
        if (daysSince >= 30) warmupCap = 250;
        else if (daysSince >= 14) warmupCap = 100;
        else if (daysSince >= 7) warmupCap = 50;
        else warmupCap = 20;
        dailyCap = Math.min(dailyCap, warmupCap);
      }
    }

    // ── 2. Process each deferred enrollment ──────────────────────────────────
    for (const row of rows.rows) {
      const enrollmentId = row.id as number;
      const contactId = (row.contact_id as number | null) ?? 0;
      const sequenceId = (row.sequence_id as number | null) ?? 0;
      const currentStep = (row.current_step as number | null) ?? 0;
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};

      const deferStep = meta._capDeferStep as number | string | null;
      const retriesSoFar = typeof meta._capDeferRetries === "number" ? meta._capDeferRetries : 0;

      try {
        // ── Audit: recovery attempted ───────────────────────────────────────
        await storage.createAuditLog({
          action: "sequence_deferred_recovery_attempted",
          entityType: "contact",
          entityId: contactId,
          actorType: "system",
          details: {
            enrollmentId,
            sequenceId,
            currentStep,
            deferStep,
            retriesSoFar,
            todayStr,
            dailyCap,
          },
        });

        // ── Atomic counter reservation ─────────────────────────────────────
        // Mirrors the same INSERT … ON CONFLICT pattern from sequence-worker.ts
        // (lines 1051-1059).  Returns a row only when the cap has headroom.
        const rsvResult = await db.execute(sql`
          INSERT INTO outbound_send_counters (date, channel, scope, count, updated_at)
          VALUES (${todayStr}, 'email', 'cold_outreach', 1, now())
          ON CONFLICT (date, channel, scope) DO UPDATE
            SET count = outbound_send_counters.count + 1, updated_at = now()
            WHERE outbound_send_counters.count < ${dailyCap}
          RETURNING count
        `);

        if (rsvResult.rows && rsvResult.rows.length > 0) {
          // ── Slot claimed — unblock the enrollment ───────────────────────
          // Clear defer metadata and reactivate so the sequence worker processes
          // it on the next tick.
          const cleanMeta: Record<string, unknown> = { ...meta };
          delete cleanMeta._capDeferStep;
          delete cleanMeta._capDeferDate;
          delete cleanMeta._capDeferRetries;

          await storage.updateSequenceEnrollment(enrollmentId, {
            status: "active",
            metadata: cleanMeta,
          });

          await storage.createAuditLog({
            action: "sequence_deferred_recovery_succeeded",
            entityType: "contact",
            entityId: contactId,
            actorType: "system",
            details: {
              enrollmentId,
              sequenceId,
              currentStep,
              deferStep,
              retriesSoFar,
              todayStr,
              newCounterValue: rsvResult.rows[0]?.count,
            },
          });

          recovered++;
        } else {
          // ── Cap still exhausted ─────────────────────────────────────────
          if (retriesSoFar >= MAX_RETRIES - 1) {
            // Max retries reached — permanently fail the enrollment
            await storage.updateSequenceEnrollment(enrollmentId, {
              status: "failed",
              metadata: {
                ...meta,
                _capDeferFailedReason: "cap_defer_max_retries",
                _capDeferFailedAt: todayStr,
              },
            });

            await storage.createAuditLog({
              action: "sequence_deferred_recovery_failed",
              entityType: "contact",
              entityId: contactId,
              actorType: "system",
              details: {
                enrollmentId,
                sequenceId,
                currentStep,
                deferStep,
                retriesSoFar,
                reason: "cap_defer_max_retries",
                todayStr,
                dailyCap,
              },
            });

            failed++;
          } else {
            // Re-defer: bump retry count and update the defer date to today
            // so tomorrow's recovery job will try again.
            await storage.updateSequenceEnrollment(enrollmentId, {
              status: "paused",
              metadata: {
                ...meta,
                _capDeferDate: todayStr,
                _capDeferRetries: retriesSoFar + 1,
              },
            });

            await storage.createAuditLog({
              action: "sequence_deferred_recovery_failed",
              entityType: "contact",
              entityId: contactId,
              actorType: "system",
              details: {
                enrollmentId,
                sequenceId,
                currentStep,
                deferStep,
                retriesSoFar: retriesSoFar + 1,
                reason: "cap_still_exhausted_redeferred",
                todayStr,
                dailyCap,
              },
            });

            reDeferred++;
          }
        }
      } catch (enrollErr) {
        console.error(
          `[EnrollmentRecovery] Error processing enrollment ${enrollmentId}:`,
          (enrollErr as Error).message,
        );
        skipped++;

        // Best-effort audit
        try {
          await storage.createAuditLog({
            action: "sequence_deferred_recovery_failed",
            entityType: "contact",
            entityId: contactId,
            actorType: "system",
            details: {
              enrollmentId,
              sequenceId,
              currentStep,
              deferStep,
              reason: "recovery_error",
              error: (enrollErr as Error).message,
              todayStr,
            },
          });
        } catch (_) {
          // swallow nested audit errors
        }
      }
    }

    console.log(
      `[EnrollmentRecovery] Done — recovered: ${recovered}, re-deferred: ${reDeferred}, failed: ${failed}, skipped: ${skipped}`,
    );

    await releaseJobLock(JOB_NAME, true, undefined, lockToken);
    return { recovered, reDeferred, failed, skipped };
  } catch (err) {
    console.error("[EnrollmentRecovery] Fatal error:", (err as Error).message);
    await releaseJobLock(JOB_NAME, false, (err as Error).message, lockToken).catch(() => {});
    throw err;
  }
}
