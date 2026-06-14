import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { getRedisConnection, isUsingMockRedis } from "./queue-connection";
import { storage } from "../storage";

export const QUEUE_NAMES = {
  GHL_SYNC: "ghl-sync",
  SLA_CHECKS: "sla-checks",
  SEQUENCES: "sequences",
  ENRICHMENT: "enrichment",
  DISCOVERY: "discovery",
  DIGESTS: "digests",
  MID_INGESTION: "mid-ingestion",
  ONBOARDING_REMINDER: "onboarding-reminder",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

interface QueueConfig {
  name: QueueName;
  concurrency: number;
  attempts: number;
  backoffDelay: number;
  repeatEveryMs: number;
  jobName: string;
}

// Alert threshold: how many consecutive failures before an operator alert is written.
const WORKER_FAILURE_ALERT_THRESHOLD = parseInt(
  process.env.WORKER_FAILURE_ALERT_THRESHOLD ?? "10"
);

const QUEUE_CONFIGS: QueueConfig[] = [
  {
    name: QUEUE_NAMES.GHL_SYNC,
    // concurrency=3: each tick is a GHL API call; 3 lets slow timeouts drain in parallel
    // without saturating GHL's rate limit (100 req/10s per location).
    concurrency: 3,
    attempts: 3,
    backoffDelay: 5000,
    repeatEveryMs: 45000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SLA_CHECKS,
    // concurrency=1: correctness-sensitive; concurrent SLA passes could double-fire alerts.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: 5 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SEQUENCES,
    // concurrency=3: each enrollment step is I/O-bound (DB + GHL email/SMS); 3 lets
    // independent contact sequences advance in parallel without overwhelming GHL.
    concurrency: 3,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: 30 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.ENRICHMENT,
    // concurrency=5: enrichment calls Serper/Apify/Apollo which are independent per
    // contact; higher parallelism is safe and reduces the 10-min backlog window.
    concurrency: 5,
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
    // concurrency=1: nightly scan; single pass to avoid duplicate notifications.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
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

export async function getQueueManager(): Promise<QueueManager> {
  if (!_queueManager) {
    _queueManager = new QueueManager();
    await _queueManager.initialize();
  }
  return _queueManager;
}

export async function shutdownQueueManager(): Promise<void> {
  if (_queueManager) {
    await _queueManager.shutdown();
    _queueManager = null;
  }
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
  private connection!: ConnectionOptions;
  private throughputBaseline: Map<string, ThroughputEntry> = new Map();
  private jobHistory: Map<string, HistoryBucket[]> = new Map();

  async initialize(): Promise<void> {
    this.connection = await getRedisConnection();
    await this.setupQueues();
    await this.setupWorkers();
    await this.setupRepeatableJobs();
    console.log("[QueueManager] All queues and workers initialized");
  }

  private async setupQueues(): Promise<void> {
    for (const config of QUEUE_CONFIGS) {
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

    for (const config of QUEUE_CONFIGS) {
      const processor = this.buildProcessor(config.name, featureFlags);
      const worker = new Worker(config.name, processor, {
        connection: this.connection,
        concurrency: config.concurrency,
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
          if (featureFlags.LEGACY_OUTREACH_ENABLED) {
            await runSequencesTick();
          }
          break;
        }
        case QUEUE_NAMES.ENRICHMENT: {
          await runEnrichmentTick();
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
        default:
          throw new Error(`Unknown queue: ${queueName}`);
      }
    };
  }

  private async setupRepeatableJobs(): Promise<void> {
    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) continue;

      const existing = await queue.getRepeatableJobs();
      for (const job of existing) {
        await queue.removeRepeatableByKey(job.key);
      }

      await queue.add(config.jobName, {}, {
        repeat: { every: config.repeatEveryMs },
        jobId: `${config.name}-repeatable`,
      });

      await queue.add(config.jobName, {}, {
        delay: Math.floor(Math.random() * 10000) + 2000,
        jobId: `${config.name}-startup`,
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
    const queue = this.queues.get(queueName as QueueName);
    if (!queue) throw new Error(`Queue not found: ${queueName}`);

    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await job.remove();
    console.log(`[QueueManager] Discarded dead-letter job ${jobId} from ${queueName}`);
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

  async shutdown(timeoutMs = parseInt(process.env.QUEUE_SHUTDOWN_TIMEOUT_MS ?? "30000")): Promise<void> {
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

  const result = await processSequenceEnrollments();
  const { storage } = await import("../storage");
  await storage.setSystemSetting("sequence_runner_last_tick", {
    at: new Date().toISOString(),
    processed: (result as any).processed ?? 0,
    sent: (result as any).sent ?? 0,
    enabled: true,
  }).catch(() => {});
  await processSendQueue().catch(err => console.error("[Queue:sequences] Campaign send queue error:", err));
  await runSunbizAutoConvert().catch(err => console.error("[Queue:sequences] Sunbiz auto-convert error:", err));
}

async function runEnrichmentTick(): Promise<void> {
  const { processEnrichmentQueue } = await import("./enrichment");
  const { processSunbizEnrichmentQueue } = await import("./sunbiz-enrichment");
  await processEnrichmentQueue();
  await processSunbizEnrichmentQueue(5).catch(err => console.error("[Queue:enrichment] Sunbiz enrichment error (best-effort):", err));
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
