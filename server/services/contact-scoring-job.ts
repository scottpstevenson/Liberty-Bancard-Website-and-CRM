/**
 * contact-scoring-job.ts
 *
 * Admin-triggered batch scoring job. Processes contacts where last_scored_at IS NULL
 * (or all contacts if rescore=true) using scoreContactBatchSafe() — which writes
 * scores via syncUpdateContact() with NO GHL sync, NO notifications, NO deal updates.
 *
 * Kill-line guards (enforced at service level):
 *  - No deals created.
 *  - No sequence enrollment, no autoEnrollFromTrigger.
 *  - No GHL sync (uses scoreContactBatchSafe → syncUpdateContact).
 *  - No paid AI (scoring is deterministic).
 *  - Only one job runs at a time (in-memory flag + system_settings state).
 *  - Job can be cancelled between batches.
 */

import { db } from "../db";
import { contacts } from "@shared/schema";
import { isNull, not, isNotNull, sql } from "drizzle-orm";
import { storage } from "../storage";
import { scoreContactBatchSafe } from "./lead-scoring";

const PROGRESS_KEY = "contact_scoring_job_progress";
const CANCEL_KEY = "contact_scoring_job_cancel_requested";
const DEFAULT_BATCH_SIZE = 50;

export interface ScoringProgress {
  status: "idle" | "running" | "complete" | "cancelled" | "failed";
  total: number;
  processed: number;
  hot: number;
  warm: number;
  cold: number;
  unqualified: number;
  errors: number;
  lastProcessedContactId: number | null;
  rescore: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  error?: string | null;
}

let _scoringJobRunning = false;

export function isScoringJobRunning(): boolean {
  return _scoringJobRunning;
}

export async function getScoringProgress(): Promise<ScoringProgress> {
  const saved = await storage.getSystemSetting(PROGRESS_KEY);
  return (saved as ScoringProgress | null) ?? {
    status: "idle",
    total: 0,
    processed: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    unqualified: 0,
    errors: 0,
    lastProcessedContactId: null,
    rescore: false,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    error: null,
  };
}

export async function previewScoringJob(rescore = false): Promise<{
  totalUnscored: number;
  wouldProcess: number;
  estimatedBatches: number;
  paidAiRequired: boolean;
}> {
  let totalUnscored: number;
  if (rescore) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(isNull(contacts.archivedAt));
    totalUnscored = row?.count ?? 0;
  } else {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL`
      );
    totalUnscored = row?.count ?? 0;
  }
  return {
    totalUnscored,
    wouldProcess: totalUnscored,
    estimatedBatches: Math.ceil(totalUnscored / DEFAULT_BATCH_SIZE),
    paidAiRequired: false,
  };
}

export async function cancelScoringJob(): Promise<void> {
  await storage.setSystemSetting(CANCEL_KEY, true);
}

export async function startScoringJob(opts: {
  rescore?: boolean;
  batchSize?: number;
  adminUserId?: string | null;
}): Promise<void> {
  if (_scoringJobRunning) {
    throw new Error("A scoring job is already running.");
  }
  const { rescore = false, batchSize = DEFAULT_BATCH_SIZE } = opts;
  const safeSize = Math.min(Math.max(Number(batchSize) || DEFAULT_BATCH_SIZE, 10), 200);

  await storage.setSystemSetting(CANCEL_KEY, false);

  let baseCount: number;
  if (rescore) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(isNull(contacts.archivedAt));
    baseCount = row?.count ?? 0;
  } else {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL`);
    baseCount = row?.count ?? 0;
  }

  const initProgress: ScoringProgress = {
    status: "running",
    total: baseCount,
    processed: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    unqualified: 0,
    errors: 0,
    lastProcessedContactId: null,
    rescore,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  await storage.setSystemSetting(PROGRESS_KEY, initProgress);
  _scoringJobRunning = true;

  setImmediate(() => {
    runScoringAsync({ rescore, batchSize: safeSize, initProgress }).catch(async (err) => {
      console.error("[ContactScoringJob] Unhandled error in scoring runner:", err);
      const progress = await getScoringProgress();
      await storage.setSystemSetting(PROGRESS_KEY, {
        ...progress,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      _scoringJobRunning = false;
    });
  });
}

async function runScoringAsync(opts: {
  rescore: boolean;
  batchSize: number;
  initProgress: ScoringProgress;
}): Promise<void> {
  const { rescore, batchSize } = opts;
  let progress = { ...opts.initProgress };

  try {
    let lastId = 0;
    let keepGoing = true;

    while (keepGoing) {
      const cancelRequested = await storage.getSystemSetting(CANCEL_KEY);
      if (cancelRequested === true) {
        progress = {
          ...progress,
          status: "cancelled",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.setSystemSetting(PROGRESS_KEY, progress);
        break;
      }

      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          rescore
            ? sql`${contacts.archivedAt} IS NULL AND ${contacts.id} > ${lastId}`
            : sql`${contacts.archivedAt} IS NULL AND ${contacts.lastScoredAt} IS NULL AND ${contacts.id} > ${lastId}`
        )
        .orderBy(contacts.id)
        .limit(batchSize);

      if (rows.length === 0) {
        keepGoing = false;
        break;
      }

      for (const row of rows) {
        try {
          const result = await scoreContactBatchSafe(row.id);
          if (result) {
            progress.processed++;
            if (result.tier === "hot") progress.hot++;
            else if (result.tier === "warm") progress.warm++;
            else if (result.tier === "cold") progress.cold++;
            else progress.unqualified++;
          } else {
            progress.errors++;
          }
        } catch (err) {
          console.error(`[ContactScoringJob] Failed to score contact ${row.id}:`, err);
          progress.errors++;
        }
        lastId = row.id;
      }

      progress.lastProcessedContactId = lastId;
      progress.updatedAt = new Date().toISOString();
      await storage.setSystemSetting(PROGRESS_KEY, progress);

      if (rows.length < batchSize) {
        keepGoing = false;
      }
    }

    const finalStatus = progress.status === "cancelled" ? "cancelled" : "complete";
    if (finalStatus === "complete") {
      progress = {
        ...progress,
        status: "complete",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.setSystemSetting(PROGRESS_KEY, progress);
    }
  } catch (err) {
    console.error("[ContactScoringJob] Runner error:", err);
    progress = {
      ...progress,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.setSystemSetting(PROGRESS_KEY, progress);
    throw err;
  } finally {
    _scoringJobRunning = false;
    await storage.setSystemSetting(CANCEL_KEY, false);
  }
}
