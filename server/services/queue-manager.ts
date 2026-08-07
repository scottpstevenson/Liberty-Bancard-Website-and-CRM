import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { getRedisConnection, isUsingMockRedis } from "./queue-connection";
import { storage } from "../storage";

const dlqAlertCooldown = new Map<string, number>();
const DLQ_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
let seqNoOpAlertCooldown = 0;

export const QUEUE_NAMES = {
  GHL_SYNC: "ghl-sync",
  SLA_CHECKS: "sla-checks",
  SEQUENCES: "sequences",
  ENRICHMENT: "enrichment",
  DISCOVERY: "discovery",
  DIGESTS: "digests",
  MID_INGESTION: "mid-ingestion",
  ONBOARDING_REMINDER: "onboarding-reminder",
  ABANDONED_STATEMENT: "abandoned-statement",
  SYSTEM_AUDIT: "system-audit",
  DB_BACKUP: "db-backup",
  ENROLLMENT_RECOVERY: "enrollment-recovery",
  GHL_ENROLLMENT_RECOVERY: "ghl-enrollment-recovery",
  HEALTH_MONITOR: "health-monitor",
  EXECUTIVE_SNAPSHOT: "executive-snapshot",
  PIPELINE_SILENCE_CHECK: "pipeline-silence-check",
  PROPOSAL_FOLLOWUP: "proposal-followup",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

interface QueueConfig {
  name: QueueName;
  concurrency: number;
  attempts: number;
  backoffDelay: number;
  repeatEveryMs: number;
  cronPattern?: string;
  jobName: string;
}

// Alert threshold: how many consecutive failures before an operator alert is written.
const WORKER_FAILURE_ALERT_THRESHOLD =
  parseInt(process.env.WORKER_FAILURE_ALERT_THRESHOLD ?? "10", 10) || 10;

// In development the high-frequency workers (ghl-sync, sequences) run at reduced
// cadence to prevent Node.js heap exhaustion in the single-process dev server.
// Production intervals are unchanged.
const IS_DEV = process.env.NODE_ENV !== "production";

const QUEUE_CONFIGS: QueueConfig[] = [
  {
    name: QUEUE_NAMES.GHL_SYNC,
    // concurrency=3: each tick is a GHL API call; 3 lets slow timeouts drain in parallel
    // without saturating GHL's rate limit (100 req/10s per location).
    concurrency: 3,
    attempts: 3,
    backoffDelay: 5000,
    repeatEveryMs: IS_DEV ? 5 * 60 * 1000 : 45000, // dev: 5 min, prod: 45 s
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SLA_CHECKS,
    // concurrency=1: correctness-sensitive; concurrent SLA passes could double-fire alerts.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: IS_DEV ? 15 * 60 * 1000 : 5 * 60 * 1000, // dev: 15 min, prod: 5 min
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SEQUENCES,
    // concurrency=1: processSequenceEnrollments() holds a DB-based acquireJobLock
    // (singleton per-process) so a second concurrent slot would always no-op and
    // waste a DB pool connection. A single slot is the correct model here.
    //
    // repeatEveryMs prod=10 min: a full run against 155 K+ contacts takes ~8 min.
    // The previous 30 s interval caused runaway queue depth — new jobs piled up
    // 16x faster than they finished. 10 min gives a ~2-min recovery buffer after
    // each run, keeping queue depth at or near zero.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: IS_DEV ? 5 * 60 * 1000 : 10 * 60 * 1000, // dev: 5 min, prod: 10 min
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.ENRICHMENT,
    // concurrency=2: reduced from 5 to ease DB pool pressure in production.
    // Each enrichment job runs several storage queries; 5 concurrent jobs
    // consumed ~10 pool slots simultaneously alongside HTTP handlers and other
    // workers, pushing total near the pool max=20 and triggering ETIMEDOUT.
    // 2 concurrent enrichment jobs = ~4 pool slots, safe headroom restored.
    concurrency: 2,
    attempts: 3,
    backoffDelay: 15000,
    repeatEveryMs: 10 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.DISCOVERY,
    // concurrency=1: runs once daily; a single sequential pass is sufficient.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 30000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.DIGESTS,
    // concurrency=1: low-frequency (hourly); correctness requires a single pass.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.MID_INGESTION,
    // concurrency=1: nightly batch; single-pass DB write avoids row-level conflicts.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.ONBOARDING_REMINDER,
    // concurrency=1: runs every 4h to catch abandoned apps within the 24h stale window.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 60000,
    repeatEveryMs: 4 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.ABANDONED_STATEMENT,
    // concurrency=1: nightly; checks for statement requests that haven't been uploaded in 3+ days.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.EXECUTIVE_SNAPSHOT,
    // concurrency=1: Monday 12 PM UTC (7 AM ET) weekly KPI snapshot + AI briefings.
    // Override with EXEC_SNAPSHOT_CRON env var.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 7 * 24 * 60 * 60 * 1000,
    cronPattern: process.env.EXEC_SNAPSHOT_CRON ?? "0 12 * * 1",
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SYSTEM_AUDIT,
    // concurrency=1: weekly audit; single sequential run is correct.
    // Cron: Monday 8 AM UTC by default; override with SYSTEM_AUDIT_CRON env var.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 30000,
    repeatEveryMs: 7 * 24 * 60 * 60 * 1000,
    cronPattern: process.env.SYSTEM_AUDIT_CRON ?? "0 11 * * 1", // Monday 11am UTC = 6am ET
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.DB_BACKUP,
    // concurrency=1: nightly pg_dump at 3 AM UTC; single sequential run avoids partial dumps.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    cronPattern: "0 3 * * *",
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.ENROLLMENT_RECOVERY,
    // concurrency=1: runs once daily at 6 AM UTC, after daily cold-outreach caps reset.
    // Recovers enrollments that were deferred because the cap was exhausted the previous day.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    cronPattern: process.env.ENROLLMENT_RECOVERY_CRON ?? "0 6 * * *",
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.GHL_ENROLLMENT_RECOVERY,
    // concurrency=1: processes deferred GHL workflow enrollment retries.
    // Runs every 30 minutes to catch transient failures (network timeout, 5xx, 429).
    // After MAX_RETRIES (3) failures the record is permanently dropped with an audit log.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 30000,
    repeatEveryMs: IS_DEV ? 10 * 60 * 1000 : 30 * 60 * 1000, // dev: 10 min, prod: 30 min
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.HEALTH_MONITOR,
    // concurrency=1: single sequential health check pass; no contention required.
    // Non-critical — skip retry if fails (attempts=1).
    concurrency: 1,
    attempts: 1,
    backoffDelay: 0,
    repeatEveryMs: IS_DEV ? 15 * 60 * 1000 : 5 * 60 * 1000, // dev: 15min, prod: 5min
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.PIPELINE_SILENCE_CHECK,
    // concurrency=1: daily scan for silent pipeline stages; single sequential pass is correct.
    // Non-critical — skip retry if fails (attempts=1).
    concurrency: 1,
    attempts: 1,
    backoffDelay: 0,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    cronPattern: process.env.PIPELINE_SILENCE_CRON ?? "0 9 * * *", // 9 AM UTC daily
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.PROPOSAL_FOLLOWUP,
    // concurrency=1: nightly; checks for proposals sent > 3 days ago with no view.
    // Max 2 re-sends per deal, gated by audit_logs count.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    cronPattern: process.env.PROPOSAL_FOLLOWUP_CRON ?? "0 10 * * *", // 10 AM UTC daily
    jobName: "run",
  },
];

export interface QueueMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  repeatEveryMs: number;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  avgDurationMs: number | null;
  throughputPerHour: number | null;
}

export interface DlqItem {
  id: string;
  queueName: string;
  jobName: string;
  failedReason: string;
  attemptsMade: number;
  stacktrace: string[];
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  data: any;
}

let _queueManager: QueueManager | null = null;
// In-flight initialization promise. Guards against a race where two concurrent
// first-time callers (e.g. index.ts's startup call and a request-triggered
// enqueueStatementAnalysis()/free-contact-enrichment call landing in the same
// tick) could each see `_queueManager === null` and spin up two separate
// QueueManager instances — which would create duplicate GHL_SYNC queues/workers.
let _initPromise: Promise<QueueManager> | null = null;

// Process-lifetime GHL sync mode gate. Once the legacy setInterval fallback
// claims GHL sync duty (see claimLegacyGhlSync()), BullMQ must never create
// the GHL_SYNC queue/worker/repeatable-job again in this process — even if a
// later, unrelated call to getQueueManager() (e.g. to enqueue an enrichment
// job) succeeds in bringing up BullMQ for other queues. This is the single
// source of truth for "which mechanism owns GHL sync", independent of
// whether BullMQ itself is up or down.
let _legacyGhlSyncClaimed = false;

/** Called once by server/index.ts when it falls back to the legacy setInterval
 * GHL sync loop, so BullMQ (now or later) permanently excludes GHL_SYNC from
 * the queues/workers/repeatable-jobs it manages for the rest of this process. */
export function claimLegacyGhlSync(): void {
  _legacyGhlSyncClaimed = true;
}

export function isLegacyGhlSyncClaimed(): boolean {
  return _legacyGhlSyncClaimed;
}

export async function getQueueManager(): Promise<QueueManager> {
  if (_queueManager) return _queueManager;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const qm = new QueueManager();
    try {
      await qm.initialize();
    } catch (err) {
      // initialize() can throw partway through setupQueues/setupWorkers/setupRepeatableJobs,
      // meaning some BullMQ queues/workers (e.g. GHL_SYNC) may already be created and
      // actively consuming repeatable jobs. Tear those down before propagating the error so
      // callers that fall back to the legacy setInterval mechanism never run both at once.
      console.error("[QueueManager] Initialization failed — shutting down partially-initialized queues/workers to prevent duplicate sync execution:", (err as Error).message);
      await qm.shutdown().catch(shutdownErr =>
        console.error("[QueueManager] Failed to tear down partially-initialized queue manager:", (shutdownErr as Error).message)
      );
      _initPromise = null;
      throw err;
    }
    _queueManager = qm;
    _initPromise = null;
    return qm;
  })();

  return _initPromise;
}

export async function shutdownQueueManager(): Promise<void> {
  if (_queueManager) {
    await _queueManager.shutdown();
    _queueManager = null;
  }
  _initPromise = null;
}

interface ThroughputEntry {
  count: number;
  recordedAt: number;
}

interface HistoryBucket {
  hour: number;
  completed: number;
  failed: number;
}

const HISTORY_HOURS = 24;

class QueueManager {
  private queues: Map<string, Queue> = new Map();

  private workers: Map<string, Worker> = new Map();

  /** Expose underlying BullMQ Queue for one-off job enqueuing. */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  private connection!: ConnectionOptions;

  private throughputBaseline: Map<string, ThroughputEntry> = new Map();

  private jobHistory: Map<string, HistoryBucket[]> = new Map();

  /** Configs to actually manage. Excludes GHL_SYNC whenever the legacy
   * setInterval fallback has already claimed GHL sync duty for this process,
   * so BullMQ can never stand up a second, competing GHL sync mechanism. */
  private activeConfigs(): QueueConfig[] {
    if (!_legacyGhlSyncClaimed) return QUEUE_CONFIGS;
    console.warn("[QueueManager] Legacy GHL sync already active for this process — excluding GHL_SYNC from BullMQ setup.");
    return QUEUE_CONFIGS.filter(c => c.name !== QUEUE_NAMES.GHL_SYNC);
  }

  async initialize(): Promise<void> {
    this.connection = await getRedisConnection();
    await this.setupQueues();
    await this.setupWorkers();
    await this.setupRepeatableJobs();
    console.log("[QueueManager] All queues and workers initialized");

    // Fire an initial health check on startup (fire-and-forget)
    import("./health-monitor").then(m => m.runHealthChecks()).catch(e =>
      console.warn("[HealthMonitor] Startup check failed:", e)
    );
  }

  private async setupQueues(): Promise<void> {
    for (const config of this.activeConfigs()) {
      const queue = new Queue(config.name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: config.attempts,
          backoff: {
            type: "exponential",
            delay: config.backoffDelay,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 200 },
        },
      });
      this.queues.set(config.name, queue);
    }
  }

  private async setupWorkers(): Promise<void> {
    const { featureFlags } = await import("./feature-flags");

    for (const config of this.activeConfigs()) {
      const processor = this.buildProcessor(config.name, featureFlags);
      const worker = new Worker(config.name, processor, {
        connection: this.connection,
        concurrency: config.concurrency,
        // Give each job 2 minutes to complete before BullMQ considers the lock
        // expired. The previous default of 30 s was too short for Serper/GHL
        // network calls and AI scoring jobs, causing "could not renew lock".
        lockDuration: 120_000,
        // Check for stalled jobs every 30 s (job grabbed by worker but lock
        // renewal stopped — e.g. worker process crashed).
        stalledInterval: 30_000,
        // Allow a job to be recovered from stalled state up to 2 times before
        // marking it failed. Prevents infinite stall loops on a consistently
        // slow job while still tolerating a single transient network hiccup.
        maxStalledCount: 2,
      });

      worker.on("completed", (job: Job) => {
        const duration = Date.now() - (job.processedOn ?? Date.now());
        if (process.env.NODE_ENV !== "production" || job.opts.repeat) {
          console.log(`[Queue:${config.name}] Job ${job.id} completed in ${duration}ms`);
        }
        this.recordHistoryEvent(config.name, "completed");
        // Reset consecutive failure count in background_jobs so the health dashboard
        // reflects a clean run without needing to wait for a separate read.
        import("./job-registry").then(({ recordWorkerSuccess }) =>
          recordWorkerSuccess(config.name).catch(e =>
            console.error(`[QueueManager] recordWorkerSuccess failed for ${config.name}:`, e)
          )
        );
      });

      worker.on("failed", async (job: Job | undefined, err: Error) => {
        if (!job) return;
        const attemptsRemaining = (job.opts.attempts ?? 1) - job.attemptsMade;
        console.error(`[Queue:${config.name}] Job ${job.id} failed (${job.attemptsMade}/${job.opts.attempts ?? 1} attempts): ${err.message}`);
        this.recordHistoryEvent(config.name, "failed");

        // Persist the failure to background_jobs and get the durable consecutive count.
        // This keeps health monitoring accurate across restarts and surfaced on the
        // Operator Dashboard (which reads background_jobs via getJobStatuses()).
        const { recordWorkerFailure } = await import("./job-registry");
        const consecutiveCount = await recordWorkerFailure(config.name, err.message).catch(() => 0);

        if (consecutiveCount >= WORKER_FAILURE_ALERT_THRESHOLD) {
          const alertMsg = `Worker alert: queue="${config.name}" has ${consecutiveCount} consecutive failures. Last error: ${err.message}`;
          console.error(`[QueueManager] ${alertMsg}`);
          storage.createReviewQueueItem({
            sourceType: "dead_letter_job" as any,
            sourceId: 0,
            status: "pending",
            notes: alertMsg,
            metadata: {
              alertType: "consecutive_failure_threshold",
              queueName: config.name,
              consecutiveFailures: consecutiveCount,
              threshold: WORKER_FAILURE_ALERT_THRESHOLD,
              lastError: err.message,
            },
          }).catch(e => console.error("[QueueManager] Failed to write consecutive-failure alert:", e));
        }

        if (attemptsRemaining <= 0) {
          await this.createReviewQueueItem(config.name, job, err).catch(e =>
            console.error("[QueueManager] Failed to create review queue item:", e)
          );
        }
      });

      worker.on("error", (err: Error) => {
        console.error(`[Queue:${config.name}] Worker error:`, err.message);
      });

      this.workers.set(config.name, worker);
    }
  }

  private buildProcessor(queueName: QueueName, featureFlags: any) {
    return async (_job: Job): Promise<void> => {
      switch (queueName) {
        case QUEUE_NAMES.GHL_SYNC: {
          await runGhlSyncTick();
          break;
        }
        case QUEUE_NAMES.SLA_CHECKS: {
          await runSlaCheckTick();
          break;
        }
        case QUEUE_NAMES.SEQUENCES: {
          // Queue-depth guard: warn when jobs are piling up faster than they finish.
          // With concurrency=1 and a 10-min repeat interval a healthy queue should
          // have 0–1 waiting jobs. >2 means the repeat interval is too short for the
          // actual run duration, or a prior run is still holding the acquireJobLock.
          try {
            const seqQueue = this.queues.get(QUEUE_NAMES.SEQUENCES);
            if (seqQueue) {
              const counts = await seqQueue.getJobCounts("waiting", "active", "delayed");
              const waiting = counts.waiting ?? 0;
              const active  = counts.active  ?? 0;
              if (waiting > 2) {
                console.warn(
                  `[Queue:sequences] depth warning — waiting=${waiting} active=${active}. ` +
                  `The repeat interval may be shorter than the actual run duration. ` +
                  `Consider increasing SEQUENCES repeatEveryMs or the run is stalled.`
                );
              } else {
                console.log(`[Queue:sequences] depth ok — waiting=${waiting} active=${active}`);
              }
            }
          } catch (_depthErr) {
            // Non-fatal: depth check should never block the actual tick
          }

          if (featureFlags.LEGACY_OUTREACH_ENABLED) {
            await runSequencesTick();
          }
          break;
        }
        case QUEUE_NAMES.ENRICHMENT: {
          if (_job.name === "statement-blueprint" && typeof _job.data?.dealId === "number") {
            await runStatementBlueprintJob(_job.data.dealId);
          } else if (_job.name === "free-contact-enrichment" && typeof _job.data?.merchantId === "number") {
            await runFreeContactEnrichmentForMerchant(_job.data.merchantId);
          } else if (_job.name === "inbound-confirmation-followup") {
            const { runInboundConfirmationFollowupJob } = await import("./ghl-workflow-enrollment");
            await runInboundConfirmationFollowupJob(_job.data);
          } else if (_job.name === "readiness_recalculation" && typeof _job.data?.contactId === "number") {
            const { computeDataReadinessScore, READINESS_MODEL_VERSION } = await import("./contact-readiness");
            const contact = await storage.getContact(_job.data.contactId);
            if (contact) {
              const r = computeDataReadinessScore(contact);
              await storage.updateContactReadiness(
                contact.id, r.score, r.grade, r.breakdown as Record<string, unknown>, READINESS_MODEL_VERSION,
              );
            }
          } else if (_job.name === "contact_lead_scoring" && typeof _job.data?.contactId === "number") {
            const { db: dbInst } = await import("../db");
            const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
            const { contactLeadScoringJobs } = await import("@shared/schema");
            const { scoreContactBatchSafe } = await import("./lead-scoring");

            const contactId: number = _job.data.contactId;
            const dbRowId: number | undefined = _job.data.dbRowId;

            try {
              let activeRow: { id: number; requestedGeneration: number; processedGeneration: number } | undefined;

              if (dbRowId !== undefined) {
                const rows = await dbInst
                  .select({
                    id: contactLeadScoringJobs.id,
                    requestedGeneration: contactLeadScoringJobs.requestedGeneration,
                    processedGeneration: contactLeadScoringJobs.processedGeneration,
                  })
                  .from(contactLeadScoringJobs)
                  .where(eqOp(contactLeadScoringJobs.id, dbRowId))
                  .limit(1);
                activeRow = rows[0];
              }

              if (!activeRow) {
                const rows = await dbInst
                  .select({
                    id: contactLeadScoringJobs.id,
                    requestedGeneration: contactLeadScoringJobs.requestedGeneration,
                    processedGeneration: contactLeadScoringJobs.processedGeneration,
                  })
                  .from(contactLeadScoringJobs)
                  .where(eqOp(contactLeadScoringJobs.contactId, contactId))
                  .limit(1);
                activeRow = rows[0];
              }

              if (!activeRow) {
                return;
              }

              const { requestedGeneration: reqGen, processedGeneration: procGen } = activeRow;

              if (reqGen <= procGen) {
                await dbInst.execute(sqlTag`
                  UPDATE contact_lead_scoring_jobs
                  SET status       = 'completed',
                      completed_at = NOW(),
                      updated_at   = NOW()
                  WHERE id = ${activeRow.id}
                `);
                return;
              }

              await dbInst.execute(sqlTag`
                UPDATE contact_lead_scoring_jobs
                SET status             = 'processing',
                    execution_attempts = execution_attempts + 1,
                    updated_at         = NOW()
                WHERE id = ${activeRow.id}
              `);

              const scoringContact = await storage.getContact(contactId);
              if (!scoringContact) {
                await dbInst.execute(sqlTag`
                  UPDATE contact_lead_scoring_jobs
                  SET status       = 'contact_not_found',
                      updated_at   = NOW()
                  WHERE id = ${activeRow.id}
                `);
                return;
              }

              const inputVersionSnapshot = scoringContact.lastMeaningfulContactMutationAt ?? null;

              await scoreContactBatchSafe(contactId, { inputVersionSnapshot });

              const afterRows = await dbInst
                .select({ requestedGeneration: contactLeadScoringJobs.requestedGeneration })
                .from(contactLeadScoringJobs)
                .where(eqOp(contactLeadScoringJobs.id, activeRow.id))
                .limit(1);
              const latestReqGen = afterRows[0]?.requestedGeneration ?? reqGen;

              if (latestReqGen > reqGen) {
                // More work arrived while we were processing this generation.
                // We CANNOT safely re-enqueue from within an active BullMQ job
                // because the current job's stable jobId is still active in Redis
                // and queue.add() with the same jobId will be a no-op (dedup).
                // Instead, set status = pending_enqueue so the recovery worker
                // picks this up on the very next enrichment tick (by which time
                // this job will have completed and the jobId freed).
                await dbInst.execute(sqlTag`
                  UPDATE contact_lead_scoring_jobs
                  SET processed_generation = ${reqGen},
                      status               = 'pending_enqueue',
                      next_attempt_at      = NOW() + INTERVAL '5 seconds',
                      updated_at           = NOW()
                  WHERE id = ${activeRow.id}
                `);
              } else {
                await dbInst.execute(sqlTag`
                  UPDATE contact_lead_scoring_jobs
                  SET processed_generation = ${reqGen},
                      status               = 'completed',
                      completed_at         = NOW(),
                      updated_at           = NOW()
                  WHERE id = ${activeRow.id}
                `);
              }
            } catch (workerErr) {
              const isTerminalAttempt = (_job.attemptsMade ?? 0) >= (_job.opts?.attempts ?? 3) - 1;
              if (isTerminalAttempt) {
                await dbInst.execute(sqlTag`
                  UPDATE contact_lead_scoring_jobs
                  SET status         = 'failed_terminal',
                      last_error_code = ${(workerErr as Error).message?.slice(0, 200) ?? "error"},
                      updated_at      = NOW()
                  WHERE contact_id = ${contactId}
                    AND status NOT IN ('completed', 'contact_not_found', 'failed_terminal')
                `).catch((e) => console.error("[LeadScoring] Failed to mark failed_terminal:", e));
              }
              throw workerErr;
            }
          } else if (_job.name === "promotional-enrollment-eval" && typeof _job.data?.promotionalEnrollmentJobId === "number") {
            const { db: dbInst } = await import("../db");
            const { promotionalEnrollmentJobs } = await import("@shared/schema");
            const { eq } = await import("drizzle-orm");
            const { evaluatePromotionalEnrollmentEligibility } = await import("./promotional-enrollment-eligibility");
            const { autoEnrollFromTrigger } = await import("./sequence-worker");

            const jobRowId: number = _job.data.promotionalEnrollmentJobId;
            const contactId: number = _job.data.contactId;
            const triggerType: string = _job.data.triggerType;
            const formType: string | null = _job.data.formType ?? null;
            const isResubmission: boolean = _job.data.isResubmission ?? false;

            // Top-level try/catch ensures the row never gets stranded in "processing"
            // regardless of where an error originates (eligibility eval, enroll, DB write).
            try {
              await dbInst
                .update(promotionalEnrollmentJobs)
                .set({ status: "processing", attempts: (_job.attemptsMade ?? 0) + 1 })
                .where(eq(promotionalEnrollmentJobs.id, jobRowId));

              const eligibility = await evaluatePromotionalEnrollmentEligibility(
                contactId,
                triggerType,
                { isResubmission }
              );

              if (!eligibility.eligible) {
                await dbInst
                  .update(promotionalEnrollmentJobs)
                  .set({
                    status: "blocked",
                    reasonCodes: eligibility.reasonCodes,
                    processedAt: new Date(),
                  })
                  .where(eq(promotionalEnrollmentJobs.id, jobRowId));
              } else {
                let enrollResult: { count: number; enrollmentIds: number[]; alreadyEnrolledCount: number } = {
                  count: 0,
                  enrollmentIds: [],
                  alreadyEnrolledCount: 0,
                };
                enrollResult = await autoEnrollFromTrigger(
                  triggerType,
                  { contactId, formType: formType ?? undefined },
                  { preEvaluated: { contactabilityByChannel: eligibility.contactabilityByChannel } }
                );

                // Determine terminal status:
                // - "enrolled"            → at least one new enrollment created
                // - "already_enrolled"    → sequences matched but contact already in all of them (none new)
                // - "no_matching_sequence"→ no active sequences matched the trigger at all
                const terminalStatus: string =
                  enrollResult.count > 0
                    ? "enrolled"
                    : enrollResult.alreadyEnrolledCount > 0
                      ? "already_enrolled"
                      : "no_matching_sequence";

                await dbInst
                  .update(promotionalEnrollmentJobs)
                  .set({
                    status: terminalStatus,
                    enrollmentIds: enrollResult.enrollmentIds.length > 0 ? enrollResult.enrollmentIds : null,
                    processedAt: new Date(),
                  })
                  .where(eq(promotionalEnrollmentJobs.id, jobRowId));
              }
            } catch (workerErr) {
              // Durably mark failed so the row exits "processing" even if BullMQ retries are exhausted.
              try {
                await dbInst
                  .update(promotionalEnrollmentJobs)
                  .set({
                    status: "failed",
                    reasonCodes: [(workerErr as Error).message?.slice(0, 200) ?? "error"],
                    processedAt: new Date(),
                  })
                  .where(eq(promotionalEnrollmentJobs.id, jobRowId));
              } catch (updateErr) {
                console.error("[PromotionalEnrollment] Failed to mark row as failed:", updateErr);
              }
              throw workerErr;
            }
          } else {
            await runEnrichmentTick();
          }
          break;
        }
        case QUEUE_NAMES.DISCOVERY: {
          if (featureFlags.LEGACY_OUTREACH_ENABLED) {
            await runDiscoveryTick();
          }
          break;
        }
        case QUEUE_NAMES.DIGESTS: {
          await runDigestsTick();
          break;
        }
        case QUEUE_NAMES.MID_INGESTION: {
          await runMidIngestionTick();
          break;
        }
        case QUEUE_NAMES.ONBOARDING_REMINDER: {
          await runOnboardingReminderTick();
          break;
        }
        case QUEUE_NAMES.ABANDONED_STATEMENT: {
          // Not gated by SDR_ENABLED — statement follow-up is a core ops task,
          // independent of whether the full SDR pipeline is active.
          const { runAbandonedStatementCheck } = await import("./abandoned-statement-worker");
          await runAbandonedStatementCheck();
          break;
        }
        case QUEUE_NAMES.EXECUTIVE_SNAPSHOT: {
          const { acquireJobLock, releaseJobLock } = await import("./job-registry");
          const acquired = await acquireJobLock("executive-snapshot");
          if (!acquired) break;
          try {
            const { buildExecutiveSnapshot } = await import("./executive-kpi");
            const { generateExecutiveAi } = await import("./executive-ai");
            const { db: dbInst } = await import("../db");
            const { executiveWeeklySnapshots } = await import("@shared/schema");
            const snap = await buildExecutiveSnapshot(new Date());
            const aiResult = await generateExecutiveAi(snap);
            await dbInst
              .insert(executiveWeeklySnapshots)
              .values({
                weekStart: snap.weekStart,
                closedWonRevenue: snap.closedWonRevenue.toString(),
                grossProfit: snap.grossProfit.toString(),
                netProfit: snap.netProfit.toString(),
                grossMarginPct: snap.grossMarginPct.toString(),
                netMarginPct: snap.netMarginPct.toString(),
                pipelineValue: snap.pipelineValue.toString(),
                newDealsClosed: snap.newDealsClosed,
                proposalsSent: snap.proposalsSent,
                statementsReceived: snap.statementsReceived,
                meetingsBooked: snap.meetingsBooked,
                outreachAttempts: snap.outreachAttempts,
                perRepBreakdown: snap.perRepBreakdown as any,
                goalsVsActuals: snap.goalsVsActuals as any,
                gptBriefing: aiResult.gptBriefing,
                claudeCoaching: aiResult.claudeCoaching as any,
                generatedAt: new Date(),
                trigger: "schedule",
              })
              .onConflictDoUpdate({
                target: executiveWeeklySnapshots.weekStart,
                set: {
                  closedWonRevenue: snap.closedWonRevenue.toString(),
                  grossProfit: snap.grossProfit.toString(),
                  netProfit: snap.netProfit.toString(),
                  grossMarginPct: snap.grossMarginPct.toString(),
                  netMarginPct: snap.netMarginPct.toString(),
                  pipelineValue: snap.pipelineValue.toString(),
                  newDealsClosed: snap.newDealsClosed,
                  proposalsSent: snap.proposalsSent,
                  statementsReceived: snap.statementsReceived,
                  meetingsBooked: snap.meetingsBooked,
                  outreachAttempts: snap.outreachAttempts,
                  perRepBreakdown: snap.perRepBreakdown as any,
                  goalsVsActuals: snap.goalsVsActuals as any,
                  gptBriefing: aiResult.gptBriefing,
                  claudeCoaching: aiResult.claudeCoaching as any,
                  generatedAt: new Date(),
                  trigger: "schedule",
                  createdAt: new Date(),
                },
              });
            console.log(`[ExecutiveSnapshot] Weekly snapshot written for week ${snap.weekStart}`);
          } finally {
            await releaseJobLock("executive-snapshot", true).catch(() => {});
          }
          break;
        }
        case QUEUE_NAMES.SYSTEM_AUDIT: {
          const { runSystemAudit } = await import("./system-audit/runner");
          await runSystemAudit("schedule");
          break;
        }
        case QUEUE_NAMES.DB_BACKUP: {
          const { runDatabaseBackup } = await import("./db-backup");
          await runDatabaseBackup("scheduled");
          break;
        }
        case QUEUE_NAMES.ENROLLMENT_RECOVERY: {
          const { recoverDeferredEnrollments } = await import("./sequence-enrollment-recovery");
          await recoverDeferredEnrollments();
          break;
        }
        case QUEUE_NAMES.GHL_ENROLLMENT_RECOVERY: {
          const { retryDeferredEnrollments } = await import("./ghl-enrollment-recovery");
          await retryDeferredEnrollments();
          break;
        }
        case QUEUE_NAMES.HEALTH_MONITOR: {
          const { runHealthChecks } = await import("./health-monitor");
          await runHealthChecks();
          break;
        }
        case QUEUE_NAMES.PIPELINE_SILENCE_CHECK: {
          const { runPipelineSilenceCheck } = await import("./pipeline-silence-check");
          await runPipelineSilenceCheck();
          break;
        }
        case QUEUE_NAMES.PROPOSAL_FOLLOWUP: {
          // Not gated by SDR_ENABLED — proposal follow-up is a core sales ops task.
          const { runProposalFollowUpCheck } = await import("./proposal-followup-worker");
          await runProposalFollowUpCheck();
          break;
        }
        default:
          throw new Error(`Unknown queue: ${queueName}`);
      }
    };
  }

  private async setupRepeatableJobs(): Promise<void> {
    for (const config of this.activeConfigs()) {
      const queue = this.queues.get(config.name);
      if (!queue) continue;

      const existing = await queue.getRepeatableJobs();
      for (const job of existing) {
        await queue.removeRepeatableByKey(job.key);
      }

      await queue.add(config.jobName, {}, {
        repeat: config.cronPattern
          ? { pattern: config.cronPattern }
          : { every: config.repeatEveryMs },
        jobId: `${config.name}-repeatable`,
      });

      // No jobId here — letting BullMQ assign a unique ID prevents the stale
      // "{name}-startup" job that may be sitting in Redis (completed/failed from
      // a previous run) from deduplicating and silently swallowing this request.
      await queue.add(config.jobName, {}, {
        delay: Math.floor(Math.random() * 10000) + 2000,
      });
    }
  }

  private recordHistoryEvent(queueName: string, type: "completed" | "failed"): void {
    if (!this.jobHistory.has(queueName)) {
      this.jobHistory.set(queueName, []);
    }
    const buckets = this.jobHistory.get(queueName)!;
    const hourKey = Math.floor(Date.now() / (1000 * 60 * 60));
    let bucket = buckets.find(b => b.hour === hourKey);
    if (!bucket) {
      bucket = { hour: hourKey, completed: 0, failed: 0 };
      buckets.push(bucket);
      if (buckets.length > HISTORY_HOURS) buckets.splice(0, buckets.length - HISTORY_HOURS);
    }
    if (type === "completed") bucket.completed++;
    else bucket.failed++;
  }

  getJobHistory(): Record<string, Array<{ label: string; completed: number; failed: number }>> {
    const result: Record<string, Array<{ label: string; completed: number; failed: number }>> = {};
    const nowHour = Math.floor(Date.now() / (1000 * 60 * 60));

    for (const [name, buckets] of this.jobHistory.entries()) {
      result[name] = Array.from({ length: HISTORY_HOURS }, (_, i) => {
        const hour = nowHour - (HISTORY_HOURS - 1 - i);
        const bucket = buckets.find(b => b.hour === hour);
        const date = new Date(hour * 60 * 60 * 1000);
        const label = `${date.getUTCHours()}:00`;
        return { label, completed: bucket?.completed ?? 0, failed: bucket?.failed ?? 0 };
      });
    }
    return result;
  }

  private async createReviewQueueItem(queueName: string, job: Job, err: Error): Promise<void> {
    try {
      await storage.createReviewQueueItem({
        sourceType: "dead_letter_job" as any,
        sourceId: 0,
        status: "pending",
        notes: `Queue: ${queueName}\nJob: ${job.id} (${job.name})\nAttempts: ${job.attemptsMade}\nError: ${err.message}`,
        metadata: {
          queueName,
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
          failedReason: err.message,
          stacktrace: err.stack?.slice(0, 2000),
          jobData: job.data,
        },
      });
      console.warn(`[QueueManager] Dead-letter review item created: queue=${queueName} job=${job.id} after ${job.attemptsMade} attempts — ${err.message}`);
      const nowMs = Date.now();
      const lastDlqAlert = dlqAlertCooldown.get(queueName) ?? 0;
      if (nowMs - lastDlqAlert > DLQ_ALERT_COOLDOWN_MS) {
        dlqAlertCooldown.set(queueName, nowMs);
        import("./system-audit/slack-notifier").then(({ sendCriticalAlert }) => {
          sendCriticalAlert({
            subsystem: "queues",
            status: "error",
            summary: `DLQ overflow — queue "${queueName}": job ${job.name} exhausted all retries after ${job.attemptsMade} attempts.`,
            details: { queueName, jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade, failedReason: err.message },
          });
        }).catch(() => {});
      }
    } catch (storageErr: any) {
      console.error("[QueueManager] Could not create review queue item for dead-letter job:", storageErr.message);
      await storage.createAuditLog({
        action: "dead_letter_job",
        entityType: "system",
        details: {
          queueName,
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
          failedReason: err.message,
        },
      }).catch(() => {});
    }
  }

  async getAllQueueMetrics(): Promise<{ queues: QueueMetric[]; usingMock: boolean }> {
    const metrics: QueueMetric[] = [];

    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) continue;

      try {
        const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
          queue.isPaused(),
        ]);

        const recentCompleted = await queue.getCompleted(0, 4);
        const recentFailed = await queue.getFailed(0, 0);

        const lastCompletedAt = recentCompleted[0]?.finishedOn
          ? new Date(recentCompleted[0].finishedOn).toISOString()
          : null;
        const lastFailedAt = recentFailed[0]?.finishedOn
          ? new Date(recentFailed[0].finishedOn).toISOString()
          : null;

        let avgDurationMs: number | null = null;
        if (recentCompleted.length > 0) {
          const durations = recentCompleted
            .filter(j => j.processedOn && j.finishedOn)
            .map(j => j.finishedOn! - j.processedOn!);
          if (durations.length > 0) {
            avgDurationMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
          }
        }

        const now = Date.now();
        let throughputPerHour: number | null = null;
        const baseline = this.throughputBaseline.get(config.name);
        if (baseline) {
          const elapsedHours = (now - baseline.recordedAt) / (1000 * 60 * 60);
          if (elapsedHours > 0) {
            const delta = completed - baseline.count;
            throughputPerHour = delta >= 0 ? Math.round(delta / elapsedHours) : null;
          }
        }
        this.throughputBaseline.set(config.name, { count: completed, recordedAt: now });

        metrics.push({
          name: config.name,
          waiting,
          active,
          completed,
          failed,
          delayed,
          paused: isPaused,
          repeatEveryMs: config.repeatEveryMs,
          lastCompletedAt,
          lastFailedAt,
          avgDurationMs,
          throughputPerHour,
        });
      } catch (err: any) {
        metrics.push({
          name: config.name,
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: false,
          repeatEveryMs: config.repeatEveryMs,
          lastCompletedAt: null,
          lastFailedAt: null,
          avgDurationMs: null,
          throughputPerHour: null,
        });
      }
    }

    return { queues: metrics, usingMock: isUsingMockRedis() };
  }

  async getDeadLetterItems(): Promise<DlqItem[]> {
    const items: DlqItem[] = [];

    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) continue;

      try {
        const failedJobs = await queue.getFailed(0, 49);
        for (const job of failedJobs) {
          if (!job.id) continue;
          const attemptsAllowed = job.opts.attempts ?? 1;
          if (job.attemptsMade >= attemptsAllowed) {
            items.push({
              id: `${config.name}::${job.id}`,
              queueName: config.name,
              jobName: job.name,
              failedReason: job.failedReason || "Unknown",
              attemptsMade: job.attemptsMade,
              stacktrace: job.stacktrace || [],
              timestamp: job.timestamp,
              processedOn: job.processedOn ?? null,
              finishedOn: job.finishedOn ?? null,
              data: job.data,
            });
          }
        }
      } catch {
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }

  async retryDeadLetterJob(compositeId: string): Promise<void> {
    const [queueName, jobId] = compositeId.split("::");
    const queue = this.queues.get(queueName as QueueName);
    if (!queue) throw new Error(`Queue not found: ${queueName}`);

    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await job.retry();
    console.log(`[QueueManager] Retried dead-letter job ${jobId} in ${queueName}`);
  }

  async discardDeadLetterJob(compositeId: string): Promise<void> {
    const [queueName, jobId] = compositeId.split("::");
    if (!queueName || !jobId) throw new Error(`Invalid compositeId: ${compositeId}`);
    const queue = this.queues.get(queueName as QueueName);
    if (!queue) throw new Error(`Queue not found: ${queueName}`);

    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    // Guard: only allow removing jobs that are in the failed state AND have
    // exhausted all retry attempts. This prevents the endpoint from being used
    // to delete waiting, delayed, or still-retrying operational work.
    const state = await job.getState();
    if (state !== "failed") {
      throw new Error(`Job ${jobId} is in state "${state}", not "failed" — refusing to discard`);
    }
    const attemptsAllowed = job.opts.attempts ?? 1;
    if (job.attemptsMade < attemptsAllowed) {
      throw new Error(
        `Job ${jobId} has only made ${job.attemptsMade}/${attemptsAllowed} attempts — it may still be retried; refusing to discard`,
      );
    }

    await job.remove();
    console.log(`[QueueManager] Discarded dead-letter job ${jobId} from ${queueName}`);
  }

  /**
   * Fetch ALL exhausted failed jobs from a single queue, paginating until
   * the result set is fully drained.  BullMQ's getFailed(start, end) uses
   * zero-based inclusive indexes, so we step through in PAGE_SIZE batches.
   */
  private async getAllExhaustedFailedJobs(queue: Queue): Promise<Job[]> {
    const PAGE_SIZE = 500;
    const exhausted: Job[] = [];
    let start = 0;

    while (true) {
      const page = await queue.getFailed(start, start + PAGE_SIZE - 1);
      for (const job of page) {
        if (!job.id) continue;
        const attemptsAllowed = job.opts.attempts ?? 1;
        if (job.attemptsMade >= attemptsAllowed) {
          exhausted.push(job);
        }
      }
      if (page.length < PAGE_SIZE) break; // last page — we've seen everything
      start += PAGE_SIZE;
    }

    return exhausted;
  }

  /**
   * Bulk-purge dead-letter jobs from all queues.
   * @param olderThanDays  Only remove jobs whose timestamp is older than this many days.
   *                       Pass 0 (or omit) to remove ALL exhausted failed jobs.
   * @returns Number of jobs removed.
   */
  async purgeDeadLetterItems(olderThanDays = 0): Promise<number> {
    const cutoffMs = olderThanDays > 0 ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : Infinity;
    let removed = 0;

    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) continue;

      try {
        const exhaustedJobs = await this.getAllExhaustedFailedJobs(queue);
        for (const job of exhaustedJobs) {
          if (olderThanDays > 0 && job.timestamp >= cutoffMs) continue; // too recent
          try {
            await job.remove();
            removed++;
          } catch {
            // best-effort; job may already be gone
          }
        }
      } catch {
        // queue unavailable — skip
      }
    }

    console.log(`[QueueManager] Purged ${removed} dead-letter job(s) (olderThanDays=${olderThanDays})`);
    return removed;
  }

  async pauseQueue(name: string): Promise<void> {
    const queue = this.queues.get(name as QueueName);
    if (!queue) throw new Error(`Queue not found: ${name}`);
    await queue.pause();
  }

  async resumeQueue(name: string): Promise<void> {
    const queue = this.queues.get(name as QueueName);
    if (!queue) throw new Error(`Queue not found: ${name}`);
    await queue.resume();
  }

  async shutdown(timeoutMs = parseInt(process.env.QUEUE_SHUTDOWN_TIMEOUT_MS ?? "7000")): Promise<void> {
    console.log("[QueueManager] Graceful shutdown — waiting for in-flight jobs...");

    const workerCloses = Array.from(this.workers.values()).map(w =>
      Promise.race([
        w.close(),
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
      ])
    );

    await Promise.all(workerCloses);

    const queueCloses = Array.from(this.queues.values()).map(q => q.close());
    await Promise.all(queueCloses);

    console.log("[QueueManager] All queues and workers shut down");
  }
}

async function runGhlSyncTick(): Promise<void> {
  const { runGhlFullSyncTick } = await import("./ghl-sync");
  await runGhlFullSyncTick();
}

async function runSlaCheckTick(): Promise<void> {
  const { runFullSlaLoop } = await import("./sla-worker");
  await runFullSlaLoop();
}

async function runSequencesTick(): Promise<void> {
  const { processSequenceEnrollments } = await import("./sequence-worker");
  const { processSendQueue } = await import("./campaign-engine");
  const { runSunbizAutoConvert } = await import("./sunbiz-cron");
  const { storage } = await import("../storage");

  // Isolate processSequenceEnrollments so a thrown error still (a) gets structured
  // job/tick-context logging, (b) does not block sibling sub-tasks in this tick,
  // and (c) does not skip the post-tick "sequence_runner_last_tick" health bookkeeping.
  let result: { processed?: number; sent?: number } = {};
  let sequenceError: Error | null = null;
  try {
    result = await processSequenceEnrollments();
    const { recordWorkerSuccess, JOB_NAMES } = await import("./job-registry");
    await recordWorkerSuccess(JOB_NAMES.SEQUENCE_ENROLLMENT_PROCESSOR);
  } catch (err) {
    sequenceError = err instanceof Error ? err : new Error(String(err));
    console.error(`[Queue:sequences] processSequenceEnrollments error (tick=sequences, job=processSequenceEnrollments):`, sequenceError.message);
    const { recordWorkerFailure, JOB_NAMES } = await import("./job-registry");
    await recordWorkerFailure(JOB_NAMES.SEQUENCE_ENROLLMENT_PROCESSOR, sequenceError.message);
  } finally {
    const tickAt = new Date().toISOString();
    await storage.setSystemSetting("sequence_runner_last_tick", {
      at: tickAt,
      processed: (result as any).processed ?? 0,
      sent: (result as any).sent ?? 0,
      enabled: true,
      ...(sequenceError ? { lastError: sequenceError.message } : {}),
    }).catch(() => {});
    // Emit audit-log heartbeat so go-live-check.ts and monitoring can verify the
    // worker ran without relying on system_settings alone.
    await storage.createAuditLog({
      action: "sequence_worker_tick",
      entityType: "system",
      actorType: "system",
      details: {
        at: tickAt,
        processed: (result as any).processed ?? 0,
        sent: (result as any).sent ?? 0,
        ...(sequenceError ? { error: sequenceError.message } : {}),
      },
    }).catch(() => {});
  }

  if (!sequenceError && ((result as any).processed ?? 0) === 0) {
    (async () => {
      try {
        const { db: _db } = await import("../db");
        const { sql: _sql } = await import("drizzle-orm");
        const enrollCheck = await _db.execute(_sql`
          SELECT COUNT(*) AS c FROM sequence_enrollments WHERE status = 'active' LIMIT 1
        `);
        const hasActive = Number((enrollCheck.rows[0] as any)?.c ?? 0) > 0;
        if (hasActive) {
          const nowMs = Date.now();
          if (nowMs - seqNoOpAlertCooldown > 4 * 60 * 60 * 1000) {
            seqNoOpAlertCooldown = nowMs;
            const { sendCriticalAlert } = await import("./system-audit/slack-notifier");
            await sendCriticalAlert({
              subsystem: "sequences",
              status: "error",
              summary: "Sequence engine unexpected no-op — processSequenceEnrollments returned 0 processed with active enrollments in DB.",
              details: { hasActiveEnrollments: true, processed: 0, note: "Worker may be stalled, gated, or blocked by a lock." },
            });
          }
        }
      } catch (_e) {}
    })().catch(() => {});
  }

  await processSendQueue().catch(err => console.error("[Queue:sequences] Campaign send queue error:", err));
  await runSunbizAutoConvert().catch(err => console.error("[Queue:sequences] Sunbiz auto-convert error:", err));
}

async function runEnrichmentTick(): Promise<void> {
  const { processEnrichmentQueue } = await import("./enrichment");
  const { featureFlags } = await import("./feature-flags");

  // Isolate processEnrichmentQueue so a thrown error still gets structured
  // job/tick-context logging and does not prevent sibling enrichment sub-tasks
  // (Sunbiz enrichment, free contact enrichment) from running, and does not skip
  // the worker-level "completed" bookkeeping (recordWorkerSuccess) for this tick.
  try {
    await processEnrichmentQueue();
    const { recordWorkerSuccess, JOB_NAMES } = await import("./job-registry");
    await recordWorkerSuccess(JOB_NAMES.ENRICHMENT_QUEUE_PROCESSOR);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[Queue:enrichment] processEnrichmentQueue error (tick=enrichment, job=processEnrichmentQueue):`, e.message);
    const { recordWorkerFailure, JOB_NAMES } = await import("./job-registry");
    await recordWorkerFailure(JOB_NAMES.ENRICHMENT_QUEUE_PROCESSOR, e.message);
  }

  if (featureFlags.SUNBIZ_ENRICHMENT_ENABLED) {
    const { processSunbizEnrichmentQueue } = await import("./sunbiz-enrichment");
    await processSunbizEnrichmentQueue(5).catch(err => console.error("[Queue:enrichment] Sunbiz enrichment error (best-effort):", err));
  }
  await runFreeContactEnrichmentTick().catch(err => console.error("[Queue:enrichment] Free contact enrichment error (best-effort):", err));
  const { runLeadScoringDeferredRecovery } = await import("./contact-lead-scoring-trigger");
  await runLeadScoringDeferredRecovery().catch(err => console.error("[Queue:enrichment] Lead scoring deferred recovery error (best-effort):", err));
}

async function runFreeContactEnrichmentTick(): Promise<void> {
  const BATCH = 20;
  const { db } = await import("../db");
  const { sdrMerchants } = await import("@shared/schema");
  const { sql, and } = await import("drizzle-orm");

  const pending = await db
    .select({ id: sdrMerchants.id })
    .from(sdrMerchants)
    .where(
      and(
        sql`(${sdrMerchants.domain} IS NOT NULL OR ${sdrMerchants.website} IS NOT NULL)`,
        sql`${sdrMerchants.ownerEnrichmentStatus} = 'pending'`,
        sql`${sdrMerchants.doNotContactFlag} IS NOT TRUE`,
        sql`NOT EXISTS (SELECT 1 FROM sdr_merchant_contacts mc WHERE mc.merchant_id = ${sdrMerchants.id} AND mc.email IS NOT NULL)`,
      )
    )
    .limit(BATCH);

  if (pending.length === 0) return;

  const qm = await getQueueManager();
  const enrichmentQueue = qm.getQueue(QUEUE_NAMES.ENRICHMENT);
  if (!enrichmentQueue) {
    console.warn("[FreeEnrich] Enrichment queue not found — skipping job enqueue");
    return;
  }

  for (const m of pending) {
    await enrichmentQueue.add(
      "free-contact-enrichment",
      { merchantId: m.id },
      {
        jobId: `free-contact-enrichment-${m.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      }
    ).catch(err => console.error(`[FreeEnrich] Failed to enqueue merchant ${m.id}:`, err));
  }

  console.log(`[FreeEnrich] Enqueued ${pending.length} per-merchant enrichment jobs`);
}

async function runFreeContactEnrichmentForMerchant(merchantId: number): Promise<void> {
  const { db } = await import("../db");
  const { sdrMerchants } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { runRdapEnrichment } = await import("./sdr/rdap-enrichment");
  const { runJsonLdEnrichment } = await import("./sdr/jsonld-enrichment");
  const { runContactPageEnrichment } = await import("./sdr/contactpage-enrichment");

  let emailFound = false;
  let transientError: Error | null = null;

  try {
    const rdap = await runRdapEnrichment(merchantId);
    if (rdap.emailFound) { emailFound = true; }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[FreeEnrich] RDAP transient failure for merchant ${merchantId}:`, e.message);
    transientError = e;
  }

  if (!emailFound) {
    try {
      const jld = await runJsonLdEnrichment(merchantId);
      if (jld.emailFound) { emailFound = true; }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[FreeEnrich] JSON-LD transient failure for merchant ${merchantId}:`, e.message);
      if (!transientError) transientError = e;
    }
  }

  if (!emailFound) {
    try {
      const cp = await runContactPageEnrichment(merchantId);
      if (cp.enriched) { emailFound = true; }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[FreeEnrich] ContactPage transient failure for merchant ${merchantId}:`, e.message);
      if (!transientError) transientError = e;
    }
  }

  // Processor detection: merge into sdrLeadState.enrichmentData (non-fatal)
  try {
    const { detectProcessorsForDomain } = await import("./sdr/processor-detector");
    const { storage: stg } = await import("../storage");
    const [merchantRow] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
    const domain = merchantRow?.domain || merchantRow?.website;
    if (domain) {
      const results = await detectProcessorsForDomain(
        domain,
        merchantRow.businessName,
        merchantRow.city ?? undefined,
        merchantRow.state ?? undefined
      );
      const detectionSource = results.length > 0 && results[0].detectionMethod === "serper" ? "serper" : "html";
      const leadState = await stg.getSdrLeadStateByMerchant(merchantId);
      if (leadState) {
        const existingEnrichment = (leadState.enrichmentData as Record<string, unknown>) ?? {};
        await stg.updateSdrLeadState(leadState.id, {
          enrichmentData: {
            ...existingEnrichment,
            processorSignals: results,
            processorDetectionAt: new Date().toISOString(),
            processorDetectionSource: detectionSource,
          },
        });
        console.log(`[FreeEnrich] Merchant ${merchantId}: processor detection merged (${results.length} signals via ${detectionSource})`);
      }
    }
  } catch (err) {
    console.error(`[FreeEnrich] Processor detection failed for merchant ${merchantId}:`, err);
  }

  if (emailFound) {
    await db.update(sdrMerchants)
      .set({ ownerEnrichmentStatus: "enriched", updatedAt: new Date() })
      .where(eq(sdrMerchants.id, merchantId))
      .catch(e => console.error(`[FreeEnrich] Status update failed for merchant ${merchantId}:`, e));
    console.log(`[FreeEnrich] Merchant ${merchantId}: enriched`);
  } else if (transientError) {
    throw new Error(`[FreeEnrich] Transient enrichment failure for merchant ${merchantId}: ${transientError.message}`);
  } else {
    await db.update(sdrMerchants)
      .set({ ownerEnrichmentStatus: "failed", updatedAt: new Date() })
      .where(eq(sdrMerchants.id, merchantId))
      .catch(e => console.error(`[FreeEnrich] Status update failed for merchant ${merchantId}:`, e));
    console.log(`[FreeEnrich] Merchant ${merchantId}: failed (no email found by any source)`);
  }
}

/**
 * One-off BullMQ job processor for statement blueprint/analysis.
 * Transitions deal analysisStatus: pending → processing → complete/failed.
 * Re-throws on error so BullMQ can retry up to the configured attempt limit.
 */
async function runStatementBlueprintJob(dealId: number): Promise<void> {
  await storage.updateDeal(dealId, { analysisStatus: "processing" }).catch(() => {});
  try {
    const { generateDealBlueprint } = await import("./deal-blueprint");
    await generateDealBlueprint(dealId);
    await storage.updateDeal(dealId, { analysisStatus: "complete" }).catch(() => {});
    console.log(`[Queue:enrichment] Statement blueprint complete for deal #${dealId}`);

    // NEW: structured analyzer runs after blueprint — non-fatal
    try {
      const { analyzeStatement } = await import("./statement-analyzer");
      await analyzeStatement(dealId);
    } catch (analyzeErr: any) {
      console.error(`[Queue:enrichment] Structured analysis failed for deal #${dealId} (non-fatal):`, analyzeErr.message);
      storage.createAuditLog({
        action: "statement_analysis_failed",
        entityType: "deal",
        entityId: dealId,
        actorType: "system",
        details: { error: analyzeErr.message, timestamp: new Date().toISOString() },
      }).catch(() => {});
    }

    // Run underwriting engine after analysis completes (non-fatal)
    try {
      const { runUnderwritingEngine } = await import("./underwriting-engine");
      const deal = await storage.getDeal(dealId);
      if (deal) {
        const result = await runUnderwritingEngine({ deal });
        await storage.createUnderwritingDecision({
          dealId,
          decision: result.decision,
          score: result.score,
          reasons: result.reasons,
          rulesSnapshot: result.rulesSnapshot,
          decidedAt: new Date(),
        });

        await storage.createAuditLog({
          action: "underwriting_auto_decision",
          entityType: "deal",
          entityId: dealId,
          actorType: "system",
          details: {
            decision: result.decision,
            score: result.score,
            reasons: result.reasons,
            rulesSnapshot: result.rulesSnapshot,
            timestamp: new Date().toISOString(),
          },
        });

        if (result.decision === "approve") {
          const { advanceDealStage } = await import("./deal-stage-service");
          await advanceDealStage(dealId, "Proposal Sent", "underwriting_auto_approve").catch(() => {});
          console.log(`[Underwriting] Deal #${dealId} auto-approved — advanced to Proposal Sent`);
        } else {
          // Hold or review: explicitly lock deal into Review In Progress
          const { advanceDealStage } = await import("./deal-stage-service");
          await advanceDealStage(dealId, "Review In Progress", "underwriting_flag").catch(() => {});
          const title = result.decision === "hold"
            ? `Underwriting HOLD — Deal #${dealId} requires immediate review`
            : `Underwriting Review Required — Deal #${dealId}`;
          await storage.createNotification({
            channel: "internal",
            title,
            message: result.reasons[0] ?? "Deal flagged for manual review",
            type: "alert",
            metadata: {
              dealId,
              decision: result.decision,
              score: result.score,
              link: `/dashboard/underwriting`,
              eventType: "underwriting_flagged",
            },
          });
          console.log(`[Underwriting] Deal #${dealId} decision=${result.decision} score=${result.score}`);
        }
      }
    } catch (uwErr: any) {
      console.error(`[Underwriting] Engine failed for deal #${dealId} (non-fatal):`, uwErr.message);
    }
  } catch (err: any) {
    await storage.updateDeal(dealId, { analysisStatus: "failed" }).catch(() => {});
    throw err; // re-throw → BullMQ retries + dead-letter on exhaustion
  }
}

/**
 * Enqueue a one-off statement-blueprint job to the enrichment queue.
 * Returns the BullMQ job ID on success, or null if the queue is unavailable
 * (e.g. Redis not configured or QueueManager not yet initialised).
 */
export async function enqueueStatementAnalysis(dealId: number): Promise<string | null> {
  try {
    const qm = await getQueueManager();
    const queue = qm.getQueue(QUEUE_NAMES.ENRICHMENT);
    if (!queue) return null;
    const job = await queue.add("statement-blueprint", { dealId }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      jobId: `statement-blueprint-${dealId}-${Date.now()}`,
    });
    console.log(`[Queue:enrichment] Enqueued statement-blueprint for deal #${dealId} → job ${job.id}`);
    return job.id ?? null;
  } catch {
    return null;
  }
}

async function runDiscoveryTick(): Promise<void> {
  const { runDailyOutreach } = await import("./daily-outreach");
  await runDailyOutreach();
}

async function runDigestsTick(): Promise<void> {
  const { checkAndSendDigests } = await import("./digest-service");
  await checkAndSendDigests();
}

async function runOnboardingReminderTick(): Promise<void> {
  const { runOnboardingReminderTick: tick } = await import("./onboarding-reminder");
  await tick();
}

async function runMidIngestionTick(): Promise<void> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.MID_INGESTION);
  if (!acquired) return;

  try {
    const { ingestMidDataForActiveMids } = await import("./processor-api");
    const result = await ingestMidDataForActiveMids();
    if (result.processed > 0 || result.errors > 0) {
      console.log(`[Queue:mid-ingestion] ${result.processed} processed, ${result.errors} errors`);
    }
    await releaseJobLock(JOB_NAMES.MID_INGESTION, true);
  } catch (err: any) {
    await releaseJobLock(JOB_NAMES.MID_INGESTION, false, err.message);
    throw err;
  }
}
