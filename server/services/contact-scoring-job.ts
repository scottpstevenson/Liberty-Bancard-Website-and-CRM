/**
 * contact-scoring-job.ts
 *
 * Admin-triggered batch scoring job. Processes contacts where last_scored_at IS NULL
 * (backfill mode) or all active contacts (rescore mode).
 *
 * Kill-line guards (enforced at service level):
 *  - No deals created.
 *  - No sequence enrollment, no autoEnrollFromTrigger.
 *  - No GHL sync (bulk write via INSERT ON CONFLICT DO UPDATE only).
 *  - No paid AI (scoring is deterministic).
 *  - Only one job runs at a time (atomic INSERT ON CONFLICT guard in system_settings).
 *  - Job can be cancelled between pages.
 *  - runId fencing: old/stale workers detect ownership loss and stop immediately.
 *  - Each page is a transaction: score writes + cursor advance are atomic.
 */

import { db } from "../db";
import { contacts } from "@shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { scoreContactPageBulk } from "./lead-scoring";
import { sanitizeScoringError } from "./scoring-progress-helpers";
import { randomUUID } from "crypto";

const PROGRESS_KEY = "contact_scoring_job_progress";
const CANCEL_KEY = "contact_scoring_job_cancel_requested";
const PREFLIGHT_KEY = "contact_scoring_rescore_preflight";
const PREFLIGHT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_BATCH_SIZE = 500;

export interface ScoringProgress {
  status: "idle" | "running" | "complete" | "cancelled" | "failed" | "interrupted";
  runId: string | null;
  actorId: string | null;
  mode: "backfill" | "rescore";
  eligibilityCutoff: string | null;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  hot: number;
  warm: number;
  cold: number;
  unqualified: number;
  errors: number;
  lastProcessedContactId: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  interruptedAt?: string | null;
  interruptionReason?: string | null;
  error?: string | null;
}

class OwnershipLostError extends Error {
  constructor() {
    super("ownership_lost");
    this.name = "OwnershipLostError";
  }
}

const IDLE_DEFAULTS: ScoringProgress = {
  status: "idle",
  runId: null,
  actorId: null,
  mode: "backfill",
  eligibilityCutoff: null,
  total: 0,
  processed: 0,
  updated: 0,
  skipped: 0,
  hot: 0,
  warm: 0,
  cold: 0,
  unqualified: 0,
  errors: 0,
  lastProcessedContactId: null,
  startedAt: null,
  updatedAt: null,
  completedAt: null,
  lastHeartbeatAt: null,
  error: null,
};

// ── Rescore preflight token ─────────────────────────────────────────────────

interface RescorePreflightToken {
  token: string;
  eligibilityCutoff: string;
  issuedAt: number;
}

/**
 * Issue a preflight token for a rescore operation.
 * Stored in system_settings with a TTL. Must be presented to startScoringJob.
 */
export async function issueRescorePreflightToken(eligibilityCutoff: string): Promise<string> {
  const token = randomUUID();
  const payload: RescorePreflightToken = { token, eligibilityCutoff, issuedAt: Date.now() };
  await storage.setSystemSetting(PREFLIGHT_KEY, payload);
  return token;
}

/**
 * Validate a rescore preflight token. Returns the persisted eligibilityCutoff if valid.
 * Throws if token is missing, expired, or mismatched.
 */
async function validateRescorePreflightToken(providedToken: string): Promise<string> {
  const payload = await storage.getSystemSetting(PREFLIGHT_KEY) as RescorePreflightToken | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("Rescore preflight not found. Run Preview first.");
  }
  if (Date.now() - payload.issuedAt > PREFLIGHT_TTL_MS) {
    throw new Error("Rescore preflight token expired (10 min). Run Preview again.");
  }
  if (payload.token !== providedToken) {
    throw new Error("Rescore preflight token mismatch. Run Preview again.");
  }
  // Consume token so it can't be replayed
  await storage.setSystemSetting(PREFLIGHT_KEY, null);
  return payload.eligibilityCutoff;
}

export async function getScoringProgress(): Promise<ScoringProgress> {
  const saved = await storage.getSystemSetting(PROGRESS_KEY);
  if (!saved || typeof saved !== "object") return { ...IDLE_DEFAULTS };
  return saved as ScoringProgress;
}

export function isScoringJobRunning(): boolean {
  return _scoringJobRunning;
}

/**
 * Atomically acquire the job slot.
 * Returns the runId on success.
 * Throws if a job is already running.
 */
async function atomicAcquireJob(payload: ScoringProgress): Promise<string> {
  const jsonPayload = JSON.stringify(payload);
  const result = await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${PROGRESS_KEY}, ${jsonPayload}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = ${jsonPayload}::jsonb, updated_at = NOW()
      WHERE system_settings.value->>'status' NOT IN ('running')
    RETURNING id
  `);
  if (!result.rows || result.rows.length === 0) {
    throw new Error("A scoring job is already running.");
  }
  return payload.runId!;
}

/**
 * Conditionally advance cursor/heartbeat only if this runId still owns the job slot.
 * Returns true if the update succeeded (still owner), false if ownership was lost.
 */
async function conditionalProgressUpdate(runId: string, blob: ScoringProgress): Promise<boolean> {
  const jsonBlob = JSON.stringify(blob);
  const result = await db.execute(sql`
    UPDATE system_settings
      SET value = ${jsonBlob}::jsonb, updated_at = NOW()
      WHERE key = ${PROGRESS_KEY}
        AND value->>'runId' = ${runId}
        AND value->>'status' = 'running'
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function previewScoringJob(mode: "backfill" | "rescore" = "backfill"): Promise<{
  totalEligible: number;
  estimatedBatches: number;
  sampleIds: number[];
  breakdown: { nullLastScoredAt: number; staleLastScoredAt: number };
  paidAiRequired: boolean;
  preflightToken?: string;
}> {
  if (mode === "rescore") {
    // Freeze the cutoff at preview time so the count and the run predicate are identical
    const cutoff = new Date().toISOString();
    const nullResult = await db.execute(sql`
      SELECT count(*)::int AS cnt FROM contacts
      WHERE archived_at IS NULL AND last_scored_at IS NULL
    `);
    const staleResult = await db.execute(sql`
      SELECT count(*)::int AS cnt FROM contacts
      WHERE archived_at IS NULL AND last_scored_at IS NOT NULL AND last_scored_at < ${cutoff}::timestamptz
    `);
    const nullCount = Number((nullResult.rows?.[0] as any)?.cnt ?? 0);
    const staleCount = Number((staleResult.rows?.[0] as any)?.cnt ?? 0);
    const totalCount = nullCount + staleCount;
    // Sample from the ELIGIBLE population (null or stale), not all active
    const sampleRows = await db.select({ id: contacts.id }).from(contacts)
      .where(sql`${contacts.archivedAt} IS NULL AND (${contacts.lastScoredAt} IS NULL OR ${contacts.lastScoredAt} < ${cutoff}::timestamptz)`)
      .orderBy(contacts.id).limit(5);
    // Issue a preflight token scoped to this cutoff (consumed by startScoringJob)
    const preflightToken = await issueRescorePreflightToken(cutoff);
    return {
      totalEligible: totalCount,
      estimatedBatches: Math.ceil(totalCount / DEFAULT_BATCH_SIZE),
      sampleIds: sampleRows.map(r => r.id),
      breakdown: { nullLastScoredAt: nullCount, staleLastScoredAt: staleCount },
      paidAiRequired: false,
      preflightToken,
    };
  }

  const nullResult = await db.execute(sql`
    SELECT count(*)::int AS cnt FROM contacts
    WHERE archived_at IS NULL AND last_scored_at IS NULL
  `);
  const nullCount = Number((nullResult.rows?.[0] as any)?.cnt ?? 0);
  const sampleRows = await db.select({ id: contacts.id }).from(contacts)
    .where(sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL`)
    .orderBy(contacts.id).limit(5);

  return {
    totalEligible: nullCount,
    estimatedBatches: Math.ceil(nullCount / DEFAULT_BATCH_SIZE),
    sampleIds: sampleRows.map(r => r.id),
    breakdown: { nullLastScoredAt: nullCount, staleLastScoredAt: 0 },
    paidAiRequired: false,
  };
}

export async function cancelScoringJob(): Promise<void> {
  await storage.setSystemSetting(CANCEL_KEY, true);
}

let _scoringJobRunning = false;

export async function startScoringJob(opts: {
  mode?: "backfill" | "rescore";
  batchSize?: number;
  adminUserId?: string | null;
  /** Required for rescore mode: the preflight token issued by previewScoringJob("rescore") */
  preflightToken?: string | null;
}): Promise<void> {
  const { mode = "backfill", batchSize = DEFAULT_BATCH_SIZE, adminUserId = null } = opts;
  const safeSize = Math.min(Math.max(Number(batchSize) || DEFAULT_BATCH_SIZE, 10), 500);

  // For rescore: validate preflight token and recover the frozen cutoff from it
  let eligibilityCutoff: string | null = null;
  if (mode === "rescore") {
    if (!opts.preflightToken) {
      throw new Error("Rescore requires a preflight token. Run Preview first to obtain one.");
    }
    eligibilityCutoff = await validateRescorePreflightToken(opts.preflightToken);
  }

  await storage.setSystemSetting(CANCEL_KEY, false);

  // Compute total using the SAME predicate the runner will use, keyed to the frozen cutoff
  let baseCount = 0;
  if (mode === "rescore" && eligibilityCutoff) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS cnt FROM contacts
      WHERE archived_at IS NULL
        AND (last_scored_at IS NULL OR last_scored_at < ${eligibilityCutoff}::timestamptz)
    `);
    baseCount = Number((result.rows?.[0] as any)?.cnt ?? 0);
  } else {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts)
      .where(sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL`);
    baseCount = row?.count ?? 0;
  }

  const runId = randomUUID();
  const now = new Date().toISOString();
  const initProgress: ScoringProgress = {
    status: "running",
    runId,
    actorId: adminUserId,
    mode,
    eligibilityCutoff,
    total: baseCount,
    processed: 0,
    updated: 0,
    skipped: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    unqualified: 0,
    errors: 0,
    lastProcessedContactId: null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    lastHeartbeatAt: now,
    error: null,
  };

  await atomicAcquireJob(initProgress);
  _scoringJobRunning = true;

  try {
    await storage.createAuditLog({
      action: "contact_mass_score_started",
      entityType: "system",
      entityId: 0,
      actorType: "user",
      userId: adminUserId,
      details: { runId, actorId: adminUserId, mode, eligibilityCutoff, totalEligible: baseCount },
    });
  } catch (auditErr) {
    console.error("[ContactScoringJob] Failed to write start audit log:", auditErr);
  }

  setImmediate(() => {
    runScoringAsync({ mode, batchSize: safeSize, runId, initProgress, eligibilityCutoff }).catch(async (err) => {
      console.error("[ContactScoringJob] Unhandled error in scoring runner:", err);
      try {
        const progress = await getScoringProgress();
        const failedBlob: ScoringProgress = {
          ...progress,
          status: "failed",
          error: sanitizeScoringError(err),
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.setSystemSetting(PROGRESS_KEY, failedBlob);
        await storage.createAuditLog({
          action: "contact_mass_score_failed",
          entityType: "system",
          entityId: 0,
          actorType: "system",
          userId: null,
          details: {
            runId,
            processed: progress.processed,
            updated: progress.updated,
            skipped: progress.skipped,
            errors: progress.errors,
            error: sanitizeScoringError(err),
          },
        });
      } catch (inner) {
        console.error("[ContactScoringJob] Failed to write failure state:", inner);
      }
      _scoringJobRunning = false;
    });
  });
}

async function runScoringAsync(opts: {
  mode: "backfill" | "rescore";
  batchSize: number;
  runId: string;
  initProgress: ScoringProgress;
  eligibilityCutoff: string | null;
}): Promise<void> {
  const { mode, batchSize, runId, eligibilityCutoff } = opts;
  let progress = { ...opts.initProgress };

  try {
    // Resume from persisted cursor if available
    const persisted = await getScoringProgress();
    let lastId = (persisted.runId === runId && persisted.lastProcessedContactId != null)
      ? persisted.lastProcessedContactId
      : 0;
    progress = { ...persisted.runId === runId ? persisted : opts.initProgress, status: "running" };

    let keepGoing = true;

    while (keepGoing) {
      const cancelRequested = await storage.getSystemSetting(CANCEL_KEY);
      if (cancelRequested === true) {
        progress = {
          ...progress,
          status: "cancelled",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        };
        await storage.setSystemSetting(PROGRESS_KEY, progress);
        break;
      }

      // Fetch next page of eligible contact IDs
      let whereClause: ReturnType<typeof sql>;
      if (mode === "rescore" && eligibilityCutoff) {
        whereClause = sql`${contacts.archivedAt} IS NULL AND (${contacts.lastScoredAt} IS NULL OR ${contacts.lastScoredAt} < ${eligibilityCutoff}::timestamptz) AND ${contacts.id} > ${lastId}`;
      } else {
        whereClause = sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL AND ${contacts.id} > ${lastId}`;
      }

      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(whereClause)
        .orderBy(contacts.id)
        .limit(batchSize);

      if (rows.length === 0) {
        keepGoing = false;
        break;
      }

      const pageIds = rows.map(r => r.id);
      const pageLastId = pageIds[pageIds.length - 1];

      // Score all contacts in this page in bulk (5 batch reads, no writes yet)
      let pageResult;
      try {
        pageResult = await scoreContactPageBulk(pageIds);
      } catch (pageErr) {
        console.error("[ContactScoringJob] Page bulk scoring failed:", pageErr);
        progress = {
          ...progress,
          errors: progress.errors + pageIds.length,
          processed: progress.processed + pageIds.length,
          lastProcessedContactId: pageLastId,
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        };
        const owned = await conditionalProgressUpdate(runId, progress);
        if (!owned) throw new OwnershipLostError();
        lastId = pageLastId;
        if (rows.length < batchSize) keepGoing = false;
        continue;
      }

      // Transaction: bulk score write + conditional cursor advance
      const newProgress: ScoringProgress = {
        ...progress,
        processed: progress.processed + pageResult.updated + pageResult.skipped,
        updated: progress.updated + pageResult.updated,
        skipped: progress.skipped + pageResult.skipped,
        lastProcessedContactId: pageLastId,
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      };

      // Tally tier distribution
      for (const s of pageResult.scores) {
        if (s.tier === "hot") newProgress.hot++;
        else if (s.tier === "warm") newProgress.warm++;
        else if (s.tier === "cold") newProgress.cold++;
        else newProgress.unqualified++;
      }

      let txSuccess = false;
      try {
        await db.transaction(async (tx) => {
          // Bulk score write: UPDATE contacts FROM (VALUES ...) — never inserts, only updates existing rows
          if (pageResult.scores.length > 0) {
            // Build multi-row VALUES clause: (id, scores...) typed literals joined with commas
            const valueFragments = pageResult.scores.map(s =>
              sql`(
                ${s.id}::int,
                ${s.leadScore}::int,
                ${s.revPotentialScore}::int,
                ${s.switchabilityScore}::int,
                ${s.uwConfidenceScore}::int,
                ${s.engagementScore}::int,
                ${JSON.stringify(s.scoreBreakdown)}::jsonb,
                ${s.lastScoredAt.toISOString()}::timestamptz
              )`
            );
            const valuesClause = valueFragments.reduce((acc, frag, i) =>
              i === 0 ? frag : sql`${acc}, ${frag}`
            );
            await tx.execute(sql`
              UPDATE contacts SET
                lead_score          = v.lead_score,
                rev_potential_score = v.rev_potential_score,
                switchability_score = v.switchability_score,
                uw_confidence_score = v.uw_confidence_score,
                engagement_score    = v.engagement_score,
                score_breakdown     = v.score_breakdown,
                last_scored_at      = v.last_scored_at
              FROM (VALUES ${valuesClause}) AS v(
                id, lead_score, rev_potential_score, switchability_score,
                uw_confidence_score, engagement_score, score_breakdown, last_scored_at
              )
              WHERE contacts.id = v.id
            `);
          }

          const progressJson = JSON.stringify({ ...newProgress, status: "running" });
          const updateResult = await tx.execute(sql`
            UPDATE system_settings
              SET value = ${progressJson}::jsonb, updated_at = NOW()
              WHERE key = ${PROGRESS_KEY}
                AND value->>'runId' = ${runId}
                AND value->>'status' = 'running'
          `);
          if ((updateResult.rowCount ?? 0) === 0) {
            throw new OwnershipLostError();
          }
        });
        txSuccess = true;
      } catch (txErr) {
        if (txErr instanceof OwnershipLostError) throw txErr;
        // Write failure: classify entire page as errors and advance cursor so we don't retry
        console.error("[ContactScoringJob] Transaction write failed for page ending at", pageLastId, "— counting as errors:", txErr);
        const errProgress: ScoringProgress = {
          ...progress,
          errors: progress.errors + pageIds.length,
          processed: progress.processed + pageIds.length,
          lastProcessedContactId: pageLastId,
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        };
        const owned = await conditionalProgressUpdate(runId, errProgress);
        if (!owned) throw new OwnershipLostError();
        progress = { ...errProgress, status: "running" };
        lastId = pageLastId;
        if (rows.length < batchSize) keepGoing = false;
        continue;
      }

      progress = { ...newProgress, status: "running" };
      lastId = pageLastId;

      if (rows.length < batchSize) {
        keepGoing = false;
      }
    }

    // Terminal state
    if (progress.status === "cancelled") {
      // already written above
    } else {
      const finalProgress: ScoringProgress = {
        ...progress,
        status: "complete",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.setSystemSetting(PROGRESS_KEY, finalProgress);
      try {
        await storage.createAuditLog({
          action: "contact_mass_score_completed",
          entityType: "system",
          entityId: 0,
          actorType: "system",
          userId: null,
          details: {
            runId,
            processed: finalProgress.processed,
            updated: finalProgress.updated,
            skipped: finalProgress.skipped,
            errors: finalProgress.errors,
            distribution: { hot: finalProgress.hot, warm: finalProgress.warm, cold: finalProgress.cold, unqualified: finalProgress.unqualified },
          },
        });
      } catch (auditErr) {
        console.error("[ContactScoringJob] Failed to write completion audit log:", auditErr);
      }
    }
  } catch (err) {
    if (err instanceof OwnershipLostError) {
      console.warn("[ContactScoringJob] Ownership lost — another run has taken over. Stopping.");
      try {
        await storage.createAuditLog({
          action: "contact_mass_score_interrupted",
          entityType: "system",
          entityId: 0,
          actorType: "system",
          userId: null,
          details: {
            runId,
            reason: "ownership_lost",
            processed: progress.processed,
            updated: progress.updated,
            skipped: progress.skipped,
            errors: progress.errors,
          },
        });
      } catch { /* swallow */ }
      _scoringJobRunning = false;
      return;
    }

    console.error("[ContactScoringJob] Runner error:", err);
    const failedProgress: ScoringProgress = {
      ...progress,
      status: "failed",
      error: sanitizeScoringError(err),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.setSystemSetting(PROGRESS_KEY, failedProgress);
    try {
      await storage.createAuditLog({
        action: "contact_mass_score_failed",
        entityType: "system",
        entityId: 0,
        actorType: "system",
        userId: null,
        details: {
          runId,
          processed: progress.processed,
          updated: progress.updated,
          skipped: progress.skipped,
          errors: progress.errors,
          error: sanitizeScoringError(err),
        },
      });
    } catch { /* swallow */ }
    throw err;
  } finally {
    _scoringJobRunning = false;
    await storage.setSystemSetting(CANCEL_KEY, false);
  }
}
