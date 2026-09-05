import { Queue, Worker, DelayedError, type ConnectionOptions, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import { getBackgroundProfile, CORE_QUEUE_ALLOWLIST } from "./background-profile";
import { createHash } from "node:crypto";
import {
  diagnoseRedisCapacity,
  getBullMqTestPrefix,
  getRedisConnection,
  getSharedRedisClientIfReady,
  type QueueMode,
  type RedisCapacityDiagnosis,
} from "./queue-connection";
import { storage } from "../storage";
import { decideCr06PromotionalLifecycle } from "./cr06-promotional-lifecycle-decision";
import { sanitizeDeadLetterEvent } from "./audit-sanitizer";
import { QUEUE_NAMES, type QueueName } from "./queue-names";
export { QUEUE_NAMES, type QueueName } from "./queue-names";
let seqNoOpAlertCooldown = 0;

interface QueueConfig {
  name: QueueName;
  concurrency: number;
  attempts: number;
  backoffDelay: number;
  repeatEveryMs: number;
  cronPattern?: string;
  jobName: string;
}

/**
 * Named schedule entry: an additional repeatable job attached to an existing
 * physical queue under a distinct job name. Used when an event-driven queue
 * (repeatEveryMs=0 in QUEUE_CONFIGS) also needs a periodic recovery sweep.
 *
 * Crucially, installing a named schedule ONLY removes repeatable jobs whose
 * BullMQ key contains this entry's jobId prefix — it never removes jobs
 * belonging to other named entries or the base queue config.
 */
interface NamedQueueSchedule {
  /** Physical queue name — must exist in QUEUE_CONFIGS */
  queueName: QueueName;
  /** Job name dispatched by worker on job.name */
  jobName: string;
  /** Repeat interval in milliseconds (used when cronPattern is absent) */
  repeatEveryMs: number;
  /**
   * Optional cron expression (e.g. "0 6 * * *" for 6 AM UTC daily).
   * When set, BullMQ uses cron scheduling instead of a fixed interval.
   * repeatEveryMs is kept as documentation/fallback but is not used.
   */
  cronPattern?: string;
  /** Stable BullMQ jobId used to identify + deduplicate this schedule */
  jobId: string;
}

// Alert threshold: how many consecutive failures before an operator alert is written.
const WORKER_FAILURE_ALERT_THRESHOLD =
  parseInt(process.env.WORKER_FAILURE_ALERT_THRESHOLD ?? "10", 10) || 10;

// In development the high-frequency workers (ghl-sync, sequences) run at reduced
// cadence to prevent Node.js heap exhaustion in the single-process dev server.
// Production intervals are unchanged.
const IS_DEV = process.env.NODE_ENV !== "production";

// Sequences repeat interval: operators can tune this via SEQUENCES_REPEAT_EVERY_MS
// without a redeploy. A 5-minute floor is enforced to prevent the runaway pile-up
// that the original 30-second interval caused (jobs accumulated 16x faster than
// they finished). In dev the IS_DEV short-circuit (5 min) always wins.
const SEQUENCES_REPEAT_FLOOR_MS = 5 * 60 * 1000; // 5 min hard floor
const SEQUENCES_REPEAT_DEFAULT_MS = 10 * 60 * 1000; // 10 min production default
const _seqEnvMs = parseInt(process.env.SEQUENCES_REPEAT_EVERY_MS ?? "", 10);
const SEQUENCES_REPEAT_EVERY_MS = IS_DEV
  ? 5 * 60 * 1000
  : Number.isFinite(_seqEnvMs) && _seqEnvMs > 0
    ? Math.max(_seqEnvMs, SEQUENCES_REPEAT_FLOOR_MS)
    : SEQUENCES_REPEAT_DEFAULT_MS;

// #1329 — GHL sync interval: operators can tune via GHL_SYNC_REPEAT_EVERY_MS without a redeploy.
// Floor: 30 s (prevent circuit-trip storms). Dev short-circuit always wins.
const GHL_SYNC_REPEAT_FLOOR_MS = 30 * 1000; // 30 s hard floor
const GHL_SYNC_REPEAT_DEFAULT_MS = 45000;    // 45 s production default
const _ghlSyncEnvMs = parseInt(process.env.GHL_SYNC_REPEAT_EVERY_MS ?? "", 10);
const GHL_SYNC_REPEAT_EVERY_MS = IS_DEV
  ? 5 * 60 * 1000
  : Number.isFinite(_ghlSyncEnvMs) && _ghlSyncEnvMs > 0
    ? Math.max(_ghlSyncEnvMs, GHL_SYNC_REPEAT_FLOOR_MS)
    : GHL_SYNC_REPEAT_DEFAULT_MS;

// #1329 — SLA check interval: operators can tune via SLA_CHECKS_REPEAT_EVERY_MS without a redeploy.
// Floor: 2 min. Dev short-circuit always wins.
const SLA_CHECKS_REPEAT_FLOOR_MS = 2 * 60 * 1000; // 2 min hard floor
const SLA_CHECKS_REPEAT_DEFAULT_MS = 5 * 60 * 1000; // 5 min production default
const _slaChecksEnvMs = parseInt(process.env.SLA_CHECKS_REPEAT_EVERY_MS ?? "", 10);
const SLA_CHECKS_REPEAT_EVERY_MS = IS_DEV
  ? 15 * 60 * 1000
  : Number.isFinite(_slaChecksEnvMs) && _slaChecksEnvMs > 0
    ? Math.max(_slaChecksEnvMs, SLA_CHECKS_REPEAT_FLOOR_MS)
    : SLA_CHECKS_REPEAT_DEFAULT_MS;

export const QUEUE_CONFIGS: QueueConfig[] = [
  {
    // Event-owned dispatcher. Recovery is a separate bounded named schedule,
    // never a repeatable successor batch.
    name: QUEUE_NAMES.CRO03C_LIVE,
    concurrency: 1, attempts: 3, backoffDelay: 10_000,
    repeatEveryMs: 0, jobName: "dispatch",
  },
  {
    name: QUEUE_NAMES.CRO03A_QUALIFICATION,
    concurrency: 1, attempts: 3, backoffDelay: 10_000,
    repeatEveryMs: 60_000, jobName: "recover",
  },
  {
    name: QUEUE_NAMES.DEAL_STAGE_EFFECTS,
    concurrency: 1, attempts: 3, backoffDelay: 10_000,
    repeatEveryMs: 60_000, jobName: "dispatch",
  },
  {
    name: QUEUE_NAMES.CHARGEBACK_COMMANDS,
    concurrency: 1, attempts: 3, backoffDelay: 10_000,
    repeatEveryMs: 60_000, jobName: "dispatch",
  },
  {
    name: QUEUE_NAMES.STATEMENT_UPLOAD,
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: 5 * 60 * 1000,
    jobName: "recover",
  },
  {
    name: QUEUE_NAMES.GHL_SYNC,
    // concurrency=3: each tick is a GHL API call; 3 lets slow timeouts drain in parallel
    // without saturating GHL's rate limit (100 req/10s per location).
    concurrency: 3,
    attempts: 3,
    backoffDelay: 5000,
    repeatEveryMs: GHL_SYNC_REPEAT_EVERY_MS,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.SLA_CHECKS,
    // concurrency=1: correctness-sensitive; concurrent SLA passes could double-fire alerts.
    concurrency: 1,
    attempts: 3,
    backoffDelay: 10000,
    repeatEveryMs: SLA_CHECKS_REPEAT_EVERY_MS,
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
    repeatEveryMs: SEQUENCES_REPEAT_EVERY_MS,
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
    name: QUEUE_NAMES.ACTIVATION_MONITOR,
    // concurrency=1: daily check for MIDs assigned but not yet activated (#1405).
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.MERCHANT_SUCCESS,
    // concurrency=1: daily 30/60/90-day merchant success program enrollments (#1406).
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.WINBACK_OUTREACH,
    // concurrency=1: nightly win-back engine — emails automationEligible WINBACK_OUTREACH NBAs (#1407).
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 24 * 60 * 60 * 1000,
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
  {
    name: QUEUE_NAMES.PARTNER_MONTHLY_DIGEST,
    // concurrency=1: runs on the 1st of each month at 9 AM UTC (4 AM ET).
    // Sends each active partner a monthly residuals + earnings summary email.
    // Override with PARTNER_MONTHLY_DIGEST_CRON env var.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60000,
    repeatEveryMs: 30 * 24 * 60 * 60 * 1000, // fallback ~30 days
    cronPattern: process.env.PARTNER_MONTHLY_DIGEST_CRON ?? "0 9 1 * *", // 1st of month 9 AM UTC
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.VOICEMAIL_SYNC,
    // Polls GHL Conversations API for inbound voicemail messages every 15 min.
    // Only active when VOICEMAIL_SYNC_ENABLED=true env var is set.
    concurrency: 1,
    attempts: 2,
    backoffDelay: 30000,
    repeatEveryMs: 15 * 60 * 1000, // 15 minutes
    jobName: "run",
  },
  {
    name: QUEUE_NAMES.POST_ENRICHMENT,
    // Event-driven: jobs are enqueued one at a time by writebackEnrichmentToLinkedRecords
    // whenever enrichment writes the first real email/phone to a contactless lead.
    // repeatEveryMs is unused (no repeatable job); the queue only processes ad-hoc items.
    // A named recovery schedule is installed separately via NAMED_QUEUE_SCHEDULES.
    concurrency: 3,
    attempts: 3,
    backoffDelay: 15000,
    repeatEveryMs: 0, // no repeatable job — driven by enrichment events
    jobName: "post-enrichment-automation",
  },
  {
    name: QUEUE_NAMES.ZEROBOUNCE_BATCH,
    // Event-driven (#1541): jobs are enqueued by POST /api/contacts/validate-emails-batch
    // with a { runId } payload. concurrency=1: the zerobounce_attempts unique
    // claim makes concurrent runs safe, but serial processing keeps daily-cap
    // consumption deterministic. attempts=1: a crashed run is recovered via
    // stale-heartbeat detection + a new operator-initiated run, not a blind
    // BullMQ retry (which could double-report a terminal state).
    concurrency: 1,
    attempts: 1,
    backoffDelay: 10000,
    repeatEveryMs: 0, // no repeatable job — driven by batch-start requests
    jobName: "run",
  },
];

/**
 * Additional named schedules for event-driven queues (repeatEveryMs=0 in
 * QUEUE_CONFIGS). Each entry installs exactly one repeatable job on an
 * existing physical queue under a distinct job name.
 *
 * setupRepeatableJobs() processes these AFTER the main QUEUE_CONFIGS loop.
 * It removes only the repeatable job whose BullMQ key matches this entry's
 * jobId — never all jobs for the queue — so multiple named schedules on the
 * same queue coexist safely.
 */
const NAMED_QUEUE_SCHEDULES: NamedQueueSchedule[] = [
  {
    queueName: QUEUE_NAMES.CRO03C_LIVE,
    jobName: "recover",
    repeatEveryMs: parseInt(process.env.CRO03C_LIVE_RECOVERY_INTERVAL_MS ?? "", 10) > 0
      ? parseInt(process.env.CRO03C_LIVE_RECOVERY_INTERVAL_MS!, 10)
      : (IS_DEV ? 5 * 60 * 1000 : 15 * 60 * 1000),
    jobId: "cro03c-live-recovery-repeatable",
  },
  {
    queueName:    QUEUE_NAMES.POST_ENRICHMENT,
    jobName:      "post-enrichment-intent-recovery",
    repeatEveryMs: parseInt(process.env.PE_INTENT_RECOVERY_INTERVAL_MS ?? "", 10) > 0
      ? parseInt(process.env.PE_INTENT_RECOVERY_INTERVAL_MS!, 10)
      : (IS_DEV ? 5 * 60 * 1000 : 15 * 60 * 1000), // 15 min prod, 5 min dev
    jobId: "pe-intent-recovery-repeatable",
  },
  {
    // Daily automated ZeroBounce validation run (#1616).
    // Fires each morning (default 6 AM UTC; override with ZEROBOUNCE_AUTO_RUN_CRON).
    // The handler checks zerobounce_auto_run_enabled in system_settings before doing
    // any work, so this schedule is safe to install unconditionally — no run starts
    // unless an admin explicitly enables it.
    queueName:    QUEUE_NAMES.ZEROBOUNCE_BATCH,
    jobName:      "zerobounce-auto-run",
    repeatEveryMs: 24 * 60 * 60 * 1000, // documentation only when cronPattern is set
    cronPattern:  process.env.ZEROBOUNCE_AUTO_RUN_CRON ?? "0 6 * * *", // 6 AM UTC daily
    jobId:        "zb-auto-run-repeatable",
  },
];

export interface QueueMetric {
  name: string;
  waiting: number | null;
  active: number | null;
  completed: number | null;
  failed: number | null;
  delayed: number | null;
  paused: boolean | null;
  repeatEveryMs: number;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  avgDurationMs: number | null;
  throughputPerHour: number | null;
  /** A failed probe is not an empty queue. */
  probeStatus: "ok" | "error";
  errorCode?: "QUEUE_METRICS_READ_FAILED";
}

export interface DlqItem {
  id: string;
  queueName: string;
  jobName: string;
  failureCode: string;
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}

export interface DlqReadResult {
  items: DlqItem[];
  queueStatus: Array<{ source: string; status: "sampled" | "failed" | "not_initialized"; sampleLimitPerQueue?: number; errorCode?: string }>;
}

export interface QueueTopologySnapshot {
  manifestConfigCount: number;
  activeConfigCount: number;
  instantiatedQueueCount: number;
  instantiatedWorkerCount: number;
  logicalJobCount: number;
  legacyGhlClaimed: boolean;
  /** BullMQ is only active when backed by a real Redis connection. */
  queueMode: QueueMode;
  processId: number;
  processIdentity: string | null;
  releaseSha: string | null;
  capturedAt: string;
}

export interface QueueFleetEvidence {
  status: "reconciled" | "unknown" | "degraded";
  scope: "cro03c_worker_inventory";
  authoritativeComplete: boolean;
  expectedProcessCount: number | null;
  observedProcessCount: number | null;
  observedBootCount: number | null;
  errorCode?: string;
}

export interface QueueHistoryEvidence {
  observationStartedAt: string;
  requestedWindowHours: number;
  availableWindowHours: number;
  partial: boolean;
  processIdentity: string;
  releaseSha: string | null;
  points: Record<string, Array<{
    startedAt: string;
    completed: number;
    failed: number;
  }>>;
}

export interface QueueTelemetryEvidence {
  status: "ok" | "degraded";
  scope: "local_process_with_reconciled_cro03c_worker_fleet";
  freshness: { capturedAt: string; observationStartedAt: string };
  topology: QueueTopologySnapshot;
  fleet: QueueFleetEvidence;
  queues: QueueMetric[];
  backlog: {
    probeStatus: "ok" | "error";
    dueEnrollmentCount: number | null;
    oldestDueMs: number | null;
    lastSequenceRunMs: number | null;
    errorCode?: string;
  };
  redis: {
    infoProbeStatus: "ok" | "error" | "not_initialized";
    observedAccountConnectedClients: number | null;
    capacity: RedisCapacityDiagnosis;
    errorCode?: string;
  };
  dlq: {
    sampleCount: number;
    complete: false;
    resultScope: "sampled_per_queue";
    queueStatus: DlqReadResult["queueStatus"];
  };
  history: QueueHistoryEvidence;
  degradations: string[];
}

type WorkerFailureClass =
  | "provider:connection-rejected"
  | "network:timeout"
  | "redis:command-timeout"
  | "redis:auth-failure"
  | "bullmq:stall"
  | "db:timeout"
  | "app:handler-error"
  | "unknown";

/** Classify a Worker error into a structured category without silently collapsing unknowns. */
function classifyWorkerError(err: Error): WorkerFailureClass {
  const msg = (err.message ?? "").toLowerCase();
  const code = ((err as any).code ?? "").toLowerCase();

  if (
    msg.includes("max number of clients") ||
    msg.includes("max clients reached") ||
    msg.includes("err max") ||
    msg.includes("connection limit")
  ) {
    return "provider:connection-rejected";
  }
  if (
    msg.includes("stalled") ||
    msg.includes("lock renewal") ||
    msg.includes("lock expired") ||
    msg.includes("could not renew")
  ) {
    return "bullmq:stall";
  }
  if (msg.includes("command timed out") || msg.includes("command timeout")) {
    return "redis:command-timeout";
  }
  if (
    msg.includes("wrongpass") ||
    msg.includes("noauth") ||
    msg.includes("err auth") ||
    msg.includes("invalid password") ||
    msg.includes("authentication failed") ||
    msg.includes("auth required")
  ) {
    return "redis:auth-failure";
  }
  if (
    msg.includes("statement timeout") ||
    msg.includes("query_canceled") ||
    msg.includes("canceling statement") ||
    (msg.includes("timeout") && (code === "57014" || msg.includes("db") || msg.includes("postgres") || msg.includes("database")))
  ) {
    return "db:timeout";
  }
  if (
    code === "etimedout" ||
    code === "econnrefused" ||
    code === "enotfound" ||
    code === "econnreset" ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("dns") ||
    msg.includes("tls") ||
    msg.includes("ssl") ||
    msg.includes("network")
  ) {
    return "network:timeout";
  }
  // "unknown" — do not silently collapse; explicit fallthrough required
  return "unknown";
}

/** Redact URLs, IPs, tokens, and email addresses from an error message for safe logging. */
function redactWorkerErrorMessage(message: string): string {
  return message
    .replace(/rediss?:\/\/[^\s"']+/gi, "redis://[REDACTED]")
    .replace(/https?:\/\/[^\s"']+/gi, "[URL-REDACTED]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, "[IP-REDACTED]")
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL-REDACTED]")
    .replace(/password[=:]\S+/gi, "password=[REDACTED]")
    .slice(0, 500);
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
  if (_queueManager?.getQueue(QUEUE_NAMES.GHL_SYNC)) {
    throw new Error("Cannot claim legacy GHL sync after the BullMQ GHL_SYNC worker is initialized.");
  }
  _legacyGhlSyncClaimed = true;
}

export function isLegacyGhlSyncClaimed(): boolean {
  return _legacyGhlSyncClaimed;
}

export function deriveQueueMode(queueManagerReady: boolean, legacyGhlSyncClaimed: boolean): QueueMode {
  if (legacyGhlSyncClaimed) return "legacy_interval_partial";
  return queueManagerReady ? "bullmq_redis" : "unavailable";
}

/** The sole queue-mode authority for API and operator surfaces. */
export function getQueueMode(): QueueMode {
  return deriveQueueMode(_queueManager !== null, _legacyGhlSyncClaimed);
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
    const { recoverStatementUploadCommands } = await import("./statement-command-worker");
    await recoverStatementUploadCommands();

    // (#1532) Inject coordinator reference so physical reconciliation can call
    // queue.pause()/queue.resume()/queue.isPaused() for Phase 4 pilot queues.
    try {
      const { outboundQueueCoordinator } = await import("./outbound-queue-coordinator");
      outboundQueueCoordinator.setQueueManager(qm);
    } catch (coordinatorErr: any) {
      console.warn("[QueueManager] Coordinator injection failed (non-fatal):", coordinatorErr.message);
    }

    return qm;
  })();

  return _initPromise;
}

/**
 * (#1532) Returns the initialized QueueManager if fully initialized; throws otherwise.
 * Route handlers and health probes MUST use this instead of getQueueManager() so they
 * report 'not_initialized' rather than lazily starting the full worker fleet.
 *
 * G-02 gate: no route, probe, or producer may create/start Workers.
 */
export function requireQueueManagerReady(): QueueManager {
  if (!_queueManager) {
    throw new Error(
      "QueueManager not yet initialized — use getQueueManager() from server/index.ts startup, " +
      "not from route handlers or health probes. This prevents lazy worker initialization from HTTP requests.",
    );
  }
  return _queueManager;
}

/**
 * (#1532) Returns the BullMQ Queue instance for producer-only operations (enqueue jobs).
 * Does NOT initialize workers or schedulers. Returns null if QueueManager is not yet ready.
 * Producers (enrichment triggers, promotional enrollment triggers, etc.) use this to enqueue
 * without accidentally spawning the full worker fleet.
 */
export function getQueueManagerProducers(): QueueManager | null {
  return _queueManager;
}

/**
 * (#1532) Returns true if the QueueManager is fully initialized (queues + workers + schedules).
 */
export function isQueueManagerReady(): boolean {
  return _queueManager !== null;
}

export async function shutdownQueueManager(): Promise<void> {
  if (_queueManager) {
    await _queueManager.shutdown();
    _queueManager = null;
  }
  _initPromise = null;
}

/**
 * Live-update a queue's repeat interval without a process restart.
 * Delegates to QueueManager.updateQueueRepeatInterval().
 * Safe to call when QueueManager is not yet initialized — returns { updated: false }
 * without throwing.
 */
export async function updateQueueIntervalLive(
  queueName: string,
  newIntervalMs: number
): Promise<{ updated: boolean; effectiveMs: number }> {
  if (!_queueManager) return { updated: false, effectiveMs: newIntervalMs };
  return _queueManager.updateQueueRepeatInterval(queueName, newIntervalMs);
}

/**
 * Returns the currently-running repeat intervals for all queues as reported by
 * the live QueueManager instance. Returns an empty object when the manager is
 * not yet initialized.
 */
export function getEffectiveQueueIntervals(): Record<string, number> {
  if (!_queueManager) return {};
  return _queueManager.getEffectiveIntervals();
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
  private redisKeyPrefix: string | undefined;
  private cro03cHeartbeatTimer: NodeJS.Timeout | null = null;
  private cro03cHeartbeatKey: string | null = null;

  private throughputBaseline: Map<string, ThroughputEntry> = new Map();

  private jobHistory: Map<string, HistoryBucket[]> = new Map();
  private readonly observationStartedAt = new Date();

  /** Runtime-effective repeat intervals. Populated from QUEUE_CONFIGS at startup
   * and updated by updateQueueRepeatInterval() when an admin changes a setting. */
  private effectiveIntervals: Map<string, number> = new Map();

  /** Configs to actually manage. Gated by BACKGROUND_JOB_PROFILE:
   *   "off"  → [] (no workers constructed)
   *   "core" → only queues in CORE_QUEUE_ALLOWLIST (starts empty, populated operationally)
   *   "full" → all queues except GHL_SYNC when legacy fallback is claimed
   */
  private activeConfigs(): QueueConfig[] {
    const profile = getBackgroundProfile();
    if (profile === "off") return [];
    if (profile === "core") {
      const base = _legacyGhlSyncClaimed
        ? QUEUE_CONFIGS.filter(c => c.name !== QUEUE_NAMES.GHL_SYNC)
        : QUEUE_CONFIGS;
      return base.filter(c => CORE_QUEUE_ALLOWLIST.includes(c.name));
    }
    // "full" — existing behavior
    if (!_legacyGhlSyncClaimed) return QUEUE_CONFIGS;
    console.warn("[QueueManager] Legacy GHL sync already active for this process — excluding GHL_SYNC from BullMQ setup.");
    return QUEUE_CONFIGS.filter(c => c.name !== QUEUE_NAMES.GHL_SYNC);
  }

  async initialize(): Promise<void> {
    this.redisKeyPrefix = getBullMqTestPrefix();
    this.connection = await getRedisConnection();
    await this.setupQueues();

    // Prime kill-switch cache: one batched DB read for all active queue names
    // before any worker starts, so the first job execution never hits a cache miss.
    const activeNames = this.activeConfigs().map(c => c.name);
    if (activeNames.length > 0) {
      try {
        const { primeKillSwitchCache } = await import("./automation-kill-switch");
        const { db: dbInst } = await import("../db");
        const { automationRegistry: regTable } = await import("@shared/schema");
        const { inArray } = await import("drizzle-orm");
        const rows = await dbInst
          .select({ key: regTable.key, killSwitchEnabled: regTable.killSwitchEnabled })
          .from(regTable)
          .where(inArray(regTable.key, activeNames));
        primeKillSwitchCache(rows);
      } catch (primeErr) {
        console.warn("[QueueManager] Kill-switch cache prime failed — workers will query individually:", (primeErr as Error).message);
      }
    }

    await this.setupWorkers();
    await this.setupRepeatableJobs();
    await this.cleanupStaleActiveJobs();
    await this.startCro03cWorkerHeartbeat();

    // Emit structured startup topology log — no credentials, no PII, no Redis URLs.
    // Connection math (BullMQ v5 shared-client architecture):
    //   • 1 shared IORedis instance for ALL Queue non-blocking ops + Worker non-blocking ops
    //   • 1 blocking connection per instantiated Worker (internal .duplicate() — unavoidable)
    //   estimatedProcessConnections = 1 (shared) + instantiatedWorkerCount
    const { diagnoseRedisCapacity } = await import("./queue-connection");
    const snapshot = this.getTopologySnapshot();
    const capacity = diagnoseRedisCapacity({
      physicalWorkerCount: snapshot.instantiatedWorkerCount,
    });
    const REDIS_CONNECTION_WARN_THRESHOLD =
      parseInt(process.env.REDIS_CONNECTION_WARN_THRESHOLD ?? "18", 10) || 18;
    console.log(JSON.stringify({
      event: "queue-manager:initialized",
      manifestConfigCount: snapshot.manifestConfigCount,
      activeConfigCount: snapshot.activeConfigCount,
      instantiatedQueueCount: snapshot.instantiatedQueueCount,
      instantiatedWorkerCount: snapshot.instantiatedWorkerCount,
      estimatedProcessConnections: capacity.estimatedProcessConnections,
      capacityStatus: capacity.status,
      legacyGhlClaimed: snapshot.legacyGhlClaimed,
      queueMode: snapshot.queueMode,
      processIdentity: snapshot.processIdentity,
      releaseSha: snapshot.releaseSha,
      sequencesRepeatEveryMs: SEQUENCES_REPEAT_EVERY_MS,
      ghlSyncRepeatEveryMs: GHL_SYNC_REPEAT_EVERY_MS,
      slaChecksRepeatEveryMs: SLA_CHECKS_REPEAT_EVERY_MS,
      capturedAt: snapshot.capturedAt,
    }));
    if (capacity.estimatedProcessConnections >= REDIS_CONNECTION_WARN_THRESHOLD) {
      console.warn(
        `[QueueManager] ⚠️  Redis connection headroom warning: ~${capacity.estimatedProcessConnections} estimated process connections ` +
        `(threshold=${REDIS_CONNECTION_WARN_THRESHOLD}). ` +
        `Set REDIS_CONNECTION_LIMIT env var to enable capacity status monitoring. ` +
        `Set REDIS_CONNECTION_WARN_THRESHOLD env var to adjust this threshold.`
      );
    }

    // Certification uses route-level readiness plus local fakes. The operational
    // sweep intentionally probes providers and must not run in zero-egress mode.
    if (process.env.VG_PROVIDER_DENY_MODE !== "1") {
      import("./health-monitor").then(m => m.runHealthChecks()).catch(e =>
        console.warn("[HealthMonitor] Startup check failed:", e)
      );
    } else {
      console.log("[HealthMonitor] Startup provider sweep skipped in certification deny mode.");
    }
  }

  private async startCro03cWorkerHeartbeat(): Promise<void> {
    const {
      CRO03C_WORKER_HEARTBEAT_INTERVAL_MS,
      createCro03cWorkerHeartbeat,
      cro03cHeartbeatKey,
      publishCro03cWorkerHeartbeat,
    } = await import("./cro03/runtime-heartbeat");
    const redis = this.connection as any;
    const heartbeat = createCro03cWorkerHeartbeat({
      releaseSha: process.env.RELEASE_SHA ?? "",
      processIdentity: process.env.PROCESS_IDENTITY,
      queueTopologyHash: getCro03cQueueTopologyHash(),
    });
    const publish = async () => {
      await publishCro03cWorkerHeartbeat(redis, this.redisKeyPrefix, {
        ...heartbeat,
        timestamp: new Date().toISOString(),
      });
    };
    await publish();
    this.cro03cHeartbeatKey = cro03cHeartbeatKey(this.redisKeyPrefix, heartbeat.bootIdentity);
    this.cro03cHeartbeatTimer = setInterval(() => {
      publish().catch((error: Error) =>
        console.error("[QueueManager] CRO03C worker heartbeat publish failed:", error.message));
    }, CRO03C_WORKER_HEARTBEAT_INTERVAL_MS);
    this.cro03cHeartbeatTimer.unref?.();
  }

  /**
   * On startup, remove any BullMQ jobs that are stuck in the "active" state
   * from a previous process that crashed mid-job. Jobs older than 2× lockDuration
   * (240 s) can never renew their lock and will generate an endless stream of
   * "could not renew lock" errors that block new work from being processed.
   */
  private async cleanupStaleActiveJobs(): Promise<void> {
    const STALE_THRESHOLD_MS = 2 * 120_000; // 2× lockDuration
    const now = Date.now();
    let totalCleaned = 0;

    for (const [name, queue] of this.queues) {
      try {
        const activeJobs = await queue.getActive();
        for (const job of activeJobs) {
          const startedAt = job.processedOn ?? 0;
          if (startedAt > 0 && now - startedAt > STALE_THRESHOLD_MS) {
            try {
              await job.moveToFailed(
                new Error(`Stale active job cleaned up on startup (active for ${Math.round((now - startedAt) / 1000)}s)`),
                job.token ?? "startup-cleanup",
                true, // remove from active list
              );
              console.log(`[QueueManager] Cleaned stale active job ${job.id} from queue:${name} (${Math.round((now - startedAt) / 1000)}s old)`);
              totalCleaned++;
            } catch (moveErr) {
              // moveToFailed can fail if another worker already claimed it — safe to ignore
              console.warn(`[QueueManager] Could not move stale job ${job.id} in queue:${name} to failed:`, (moveErr as Error).message);
            }
          }
        }
      } catch (err) {
        // Non-fatal: if Redis is unreachable at startup we still want to continue
        console.warn(`[QueueManager] Stale job cleanup failed for queue:${name}:`, (err as Error).message);
      }
    }

    if (totalCleaned > 0) {
      console.log(`[QueueManager] Startup cleanup: moved/removed ${totalCleaned} stale active job(s)`);
    }
  }

  private async setupQueues(): Promise<void> {
    for (const config of this.activeConfigs()) {
      const queue = new Queue(config.name, {
        connection: this.connection,
        prefix: this.redisKeyPrefix,
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
        prefix: this.redisKeyPrefix,
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
        // Update automation_registry last_run_at
        const returnValue = job.returnvalue as { checked?: number; resendsSent?: number; processed?: number; reminded?: number; errors?: number } | null | undefined;
        const recordsAffected = returnValue
          ? (returnValue.resendsSent ?? returnValue.reminded ?? returnValue.processed ?? null)
          : null;
        const runErrors = returnValue?.errors ?? null;
        import("../db").then(({ db: dbInst }) =>
          import("@shared/schema").then(({ automationRegistry: reg }) =>
            import("drizzle-orm").then(({ eq: eqOp }) =>
              dbInst
                .update(reg)
                .set({
                  lastRunAt: new Date(),
                  lastRunRecordsAffected: recordsAffected ?? 0,
                  lastRunErrors: runErrors ?? 0,
                  updatedAt: new Date(),
                })
                .where(eqOp(reg.key, config.name))
                .catch(e => console.error(`[QueueManager] registry update failed for ${config.name}:`, e))
            )
          )
        );
      });

      worker.on("failed", async (job: Job | undefined, err: Error) => {
        if (!job) return;
        const attemptsRemaining = (job.opts.attempts ?? 1) - job.attemptsMade;
        const failureCode = classifyWorkerError(err);
        console.error(JSON.stringify({
          event: "queue:job-failed",
          queueName: config.name,
          jobName: job.name,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
          failureCode,
        }));
        this.recordHistoryEvent(config.name, "failed");

        // Persist the failure to background_jobs and get the durable consecutive count.
        // This keeps health monitoring accurate across restarts and surfaced on the
        // Operator Dashboard (which reads background_jobs via getJobStatuses()).
        const { recordWorkerFailure } = await import("./job-registry");
        const consecutiveCount = await recordWorkerFailure(config.name, failureCode).catch(() => 0);

        if (consecutiveCount >= WORKER_FAILURE_ALERT_THRESHOLD) {
          const event = sanitizeDeadLetterEvent({
            queueName: config.name,
            jobName: job.name,
            failureCode,
            attempts: job.attemptsMade,
            maxAttempts: job.opts.attempts ?? 1,
            occurredAt: new Date().toISOString(),
            source: "consecutive_failure_threshold",
            retryable: attemptsRemaining > 0,
          });
          console.error(JSON.stringify({
            event: "queue:consecutive-failure-threshold",
            queueName: event.queueName,
            jobName: event.jobName,
            failureCode: event.failureCode,
            consecutiveFailures: consecutiveCount,
            threshold: WORKER_FAILURE_ALERT_THRESHOLD,
          }));
          storage.createReviewQueueItem({
            sourceType: "dead_letter_job" as any,
            sourceId: 0,
            status: "pending",
            notes: "Queue crossed the consecutive-failure review threshold. See canonical BullMQ retention for operational details.",
            metadata: event,
          }).catch(() => console.error(JSON.stringify({
            event: "queue:threshold-review-persist-failed",
            queueName: event.queueName,
            failureCode: event.failureCode,
          })));
        }

        if (attemptsRemaining <= 0) {
          await this.createReviewQueueItem(config.name, job, err).catch(e =>
            console.error("[QueueManager] Failed to create review queue item:", e)
          );
        }
      });

      // ── Worker lifecycle telemetry ───────────────────────────────────────────
      // Structured logs for ready / error / closed events.
      // Never logs: Redis URLs, credentials, job payloads, contact PII, merchant data.

      worker.on("ready", () => {
        console.log(JSON.stringify({
          event: "worker:ready",
          queue: config.name,
          processId: process.pid,
          processIdentity: process.env.PROCESS_IDENTITY ?? null,
          releaseSha: process.env.RELEASE_SHA ?? null,
          timestamp: new Date().toISOString(),
        }));
      });

      // Extend existing error listener with structured classification + redaction.
      worker.on("error", (err: Error) => {
        const failureClass = classifyWorkerError(err);
        const redactedMessage = redactWorkerErrorMessage(err.message ?? "");
        console.error(JSON.stringify({
          event: "worker:error",
          queue: config.name,
          errorClass: err.constructor?.name ?? "Error",
          errorCode: (err as any).code ?? null,
          redactedMessage,
          failureClass,
          processId: process.pid,
          processIdentity: process.env.PROCESS_IDENTITY ?? null,
          releaseSha: process.env.RELEASE_SHA ?? null,
          timestamp: new Date().toISOString(),
        }));
      });

      worker.on("closed", () => {
        console.log(JSON.stringify({
          event: "worker:closed",
          queue: config.name,
          processId: process.pid,
          processIdentity: process.env.PROCESS_IDENTITY ?? null,
          releaseSha: process.env.RELEASE_SHA ?? null,
          timestamp: new Date().toISOString(),
        }));
      });

      this.workers.set(config.name, worker);
    }
  }

  private buildProcessor(queueName: QueueName, featureFlags: any) {
    return async (_job: Job): Promise<void> => {
      // ── Per-job pool instrumentation ─────────────────────────────────────
      const jobStartMs = Date.now();
      const { pool: _pool } = await import("../db");
      console.log(JSON.stringify({
        event: "job:start",
        queue: queueName,
        jobId: _job.id,
        poolWaiting: _pool.waitingCount,
        poolTotal: _pool.totalCount,
        ts: new Date().toISOString(),
      }));

      try {

      // ── Automation kill-switch gate ──────────────────────────────────────
      // Check registry before executing. If kill_switch_enabled = true, skip.
      try {
        const { isAutomationEnabled } = await import("./automation-kill-switch");
        if (!(await isAutomationEnabled(queueName))) {
          console.info(`[AutomationRegistry] Queue ${queueName} is kill-switched, skipping job ${_job.id}`);
          return;
        }
      } catch (ksErr) {
        // C-05 (#1626): kill-switch check failed — FAIL CLOSED. If we cannot
        // read the registry, we cannot prove the queue is enabled; skip the
        // job rather than proceeding blind.
        console.warn(`[AutomationRegistry] Kill-switch check failed for ${queueName} — failing closed, skipping job ${_job.id}:`, (ksErr as Error).message);
        return;
      }

      // ── Worker heartbeat ─────────────────────────────────────────────────────
      // Write a timestamp so the operator dashboard can detect stale workers.
      try {
        const { storage: hbStorage } = await import("../storage");
        await hbStorage.setSystemSetting(`worker_heartbeat_${queueName}`, Date.now());
      } catch (_hbErr) {
        // Non-fatal — heartbeat write should never block the actual job.
      }

      switch (queueName) {
        case QUEUE_NAMES.CRO03C_LIVE: {
          const { dispatchCro03cLive, recoverCro03cLiveDispatches } = await import("./cro03/live-worker");
          if (_job.name === "recover") await recoverCro03cLiveDispatches();
          else await dispatchCro03cLive(typeof _job.data?.commandId === "string" ? _job.data.commandId : undefined);
          break;
        }
        case QUEUE_NAMES.CRO03A_QUALIFICATION: {
          const { processCro03aQualificationRunQueueSafe, recoverCro03aQualificationRunsQueueSafe } =
            await import("./cro03a/qualification-service");
          if (_job.name === "run" && typeof _job.data?.runId === "string") {
            await processCro03aQualificationRunQueueSafe(_job.data.runId);
          } else {
            await recoverCro03aQualificationRunsQueueSafe();
          }
          break;
        }
        case QUEUE_NAMES.DEAL_STAGE_EFFECTS: {
          const { dispatchDealStageEffectIntents } = await import("./deal-stage-effect-worker");
          await dispatchDealStageEffectIntents();
          break;
        }
        case QUEUE_NAMES.CHARGEBACK_COMMANDS: {
          const { recoverChargebackSubmissionCommands } = await import("./chargeback-submission-service");
          await recoverChargebackSubmissionCommands();
          break;
        }
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

          // Sequence rows are purpose-classified at their claim boundary; this
          // runner must remain available for explicitly transactional/human
          // response rows rather than globally treating that mixed queue as
          // promotional.
          decideCr06PromotionalLifecycle({ boundary: "queue_runner", purpose: "transactional" });
          if (featureFlags.LEGACY_OUTREACH_ENABLED) {
            await runSequencesTick();
          }
          break;
        }
        case QUEUE_NAMES.ENRICHMENT: {
          if (_job.name === "validation-intent" && typeof _job.data?.intentId === "string") {
            const { processValidationIntent } = await import("./provider-readiness-control");
            await processValidationIntent(_job.data.intentId);
          } else if (_job.name === "campaign-queue-run" && typeof _job.data?.runId === "string") {
            if (decideCr06PromotionalLifecycle({ boundary: "queue_runner", purpose: "promotional" }).allowed) {
              const { processCampaignQueueRun } = await import("./campaign-engine");
              await processCampaignQueueRun(_job.data.runId);
            }
          } else if (_job.name === "statement-blueprint" && typeof _job.data?.dealId === "number") {
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

            let contactId: number = _job.data.contactId;
            const { resolveLiveContactId } = await import("./contact-identity");
            contactId = await resolveLiveContactId(contactId);
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
            if (!decideCr06PromotionalLifecycle({ boundary: "queue_runner", purpose: "promotional" }).allowed) {
              await dbInst
                .update(promotionalEnrollmentJobs)
                .set({ status: "blocked", reasonCodes: ["no_usable_channel"], processedAt: new Date() })
                .where(eq(promotionalEnrollmentJobs.id, jobRowId));
              return;
            }
            let contactId: number = _job.data.contactId;
            const {
              CONTACT_MERGE_EFFECT_HOLD_REASON,
              resolveLiveContactRedirect,
            } = await import("./contact-identity");
            const redirect = await resolveLiveContactRedirect(contactId);
            contactId = redirect.effectiveContactId;
            const triggerType: string = _job.data.triggerType;
            const formType: string | null = _job.data.formType ?? null;
            const isResubmission: boolean = _job.data.isResubmission ?? false;

            // Top-level try/catch ensures the row never gets stranded in "processing"
            // regardless of where an error originates (eligibility eval, enroll, DB write).
            try {
              if (redirect.effectHold) {
                await dbInst.execute(sql`
                  UPDATE promotional_enrollment_jobs
                  SET status='deferred_queue_unavailable',
                      reason_codes=ARRAY(
                        SELECT DISTINCT unnest(
                          COALESCE(reason_codes,ARRAY[]::text[])
                          || ARRAY[${CONTACT_MERGE_EFFECT_HOLD_REASON}]::text[]
                        )
                      ),
                      attempts=attempts+1,
                      processed_at=NULL
                  WHERE id=${jobRowId}
                `);
                return;
              }
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
                  {
                    preEvaluated: { contactabilityByChannel: eligibility.contactabilityByChannel },
                    promotionalIntent: {
                      idempotencyKey: `promotional-job:${jobRowId}`,
                      actorId: "promotional-enrollment-worker",
                      source: "promotional_enrollment_job",
                    },
                  }
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
                    reasonCodes: null,
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
            const { recoverValidationIntents } = await import("./provider-readiness-control");
            await recoverValidationIntents();
            const { recoverCampaignQueueRuns } = await import("./campaign-engine");
            await recoverCampaignQueueRuns();
            const { recoverDeferredPromotionalEnrollments } = await import("./promotional-enrollment-eligibility");
            await recoverDeferredPromotionalEnrollments();
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
        case QUEUE_NAMES.ACTIVATION_MONITOR: {
          await runActivationMonitorTick();
          break;
        }
        case QUEUE_NAMES.MERCHANT_SUCCESS: {
          await runMerchantSuccessTick();
          break;
        }
        case QUEUE_NAMES.WINBACK_OUTREACH: {
          await runWinbackOutreachTick();
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
          const lease = await acquireJobLock("executive-snapshot");
          if (lease.status !== "acquired") break;
          const lockToken = lease.lockToken;
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
            await releaseJobLock("executive-snapshot", true, undefined, lockToken).catch(() => {});
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
        case QUEUE_NAMES.PARTNER_MONTHLY_DIGEST: {
          const { sendMonthlyPartnerResidualsSummary } = await import("./partner-notifications");
          await sendMonthlyPartnerResidualsSummary();
          break;
        }
        case QUEUE_NAMES.VOICEMAIL_SYNC: {
          // Gate: only run when VOICEMAIL_SYNC_ENABLED is set (checked inside the tick as well)
          if (process.env.VOICEMAIL_SYNC_ENABLED === "true") {
            const { runVoicemailSyncTick } = await import("./ghl-voicemail-sync");
            await runVoicemailSyncTick();
          }
          break;
        }
        case QUEUE_NAMES.ZEROBOUNCE_BATCH: {
          if (_job.name === "zerobounce-auto-run") {
            // Scheduled daily auto-run (#1616): checks system_settings gate before
            // creating a campaign/run; safe to no-op if disabled or budget exhausted.
            const { runZeroBounceAutoRun } = await import("./zerobounce-campaign-worker");
            const result = await runZeroBounceAutoRun();
            console.log(`[Queue:zerobounce-batch-validate] auto-run outcome: ${result.outcome}`);
          } else {
            // Event-driven run enqueued by POST /api/contacts/validate-emails-batch
            const { processZeroBounceRun } = await import("./zerobounce-campaign-worker");
            const runId = (_job.data as { runId?: string })?.runId;
            if (!runId) throw new Error("zerobounce-batch-validate job missing runId");
            await processZeroBounceRun(runId);
          }
          break;
        }
        case QUEUE_NAMES.STATEMENT_UPLOAD: {
          const { executeStatementUploadCommand, recoverStatementUploadCommands } = await import("./statement-command-worker");
          if (_job.name === "recover") {
            await recoverStatementUploadCommands();
            break;
          }
          const commandId = _job.data?.commandId;
          if (typeof commandId !== "string") throw new Error("statement command id required");
          await executeStatementUploadCommand(commandId);
          await recoverStatementUploadCommands();
          break;
        }
        case QUEUE_NAMES.POST_ENRICHMENT: {
          if (_job.name === "post-enrichment-intent-recovery") {
            // Recovery path: dispatch to the dedicated recovery worker function.
            // This MUST NOT go through processPostEnrichmentJob() to keep the two
            // paths cleanly separated (kill line from 1548C spec).
            const { recoverPendingEnrollmentIntents } = await import("./post-enrichment-worker");
            const workerId = `pe-recovery-${process.pid}-${_job.id ?? "noid"}`;
            await recoverPendingEnrollmentIntents(workerId);
          } else {
            // Event-driven path: standard post-enrichment automation
            const { processPostEnrichmentJob } = await import("./post-enrichment-worker");
            await processPostEnrichmentJob(_job.data as import("./post-enrichment-worker").PostEnrichmentJobData);
          }
          break;
        }
        default:
          throw new Error(`Unknown queue: ${queueName}`);
      }

      } catch (err) {
        // ── Transient DB-exhaustion deferral ──────────────────────────────
        // If the job failed because the pool was saturated (connection-acquisition
        // timeout or unexpected connection termination), move it to the delayed
        // set rather than consuming a retry attempt. This avoids a thundering
        // herd of retries making pool pressure worse.
        if (err instanceof Error && (
          err.message.includes("timeout exceeded when trying to connect") ||
          err.message.includes("Connection terminated unexpectedly")
        )) {
          const DEFER_MS = 30_000;
          let _deferred = false;
          try {
            await _job.moveToDelayed(Date.now() + DEFER_MS, _job.token ?? "db-defer");
            _deferred = true;
            console.warn(JSON.stringify({
              event: "job:db_deferred",
              queue: queueName,
              jobId: _job.id,
              deferMs: DEFER_MS,
              ts: new Date().toISOString(),
            }));
          } catch {
            // moveToDelayed itself failed — fall through and let normal retry handle it
          }
          // Throw DelayedError OUTSIDE the inner catch so it cannot be swallowed.
          // BullMQ workers detect DelayedError and preserve the delayed state
          // without attempting moveToCompleted or consuming a retry attempt.
          if (_deferred) throw new DelayedError();
        }
        throw err;
      } finally {
        const { pool: _poolFinal } = await import("../db");
        console.log(JSON.stringify({
          event: "job:end",
          queue: queueName,
          jobId: _job.id,
          durationMs: Date.now() - jobStartMs,
          poolWaiting: _poolFinal.waitingCount,
          poolTotal: _poolFinal.totalCount,
          ts: new Date().toISOString(),
        }));
      }
    };
  }

  private async setupRepeatableJobs(): Promise<void> {
    // Load operator-persisted interval overrides from system_settings so that an
    // admin change made via PUT /api/admin/settings/worker-intervals survives a
    // process restart.  Floor guards are re-applied here to be safe.
    let ghlOverrideMs: number | null = null;
    let slaOverrideMs: number | null = null;
    try {
      const [ghlRaw, slaRaw] = await Promise.all([
        storage.getSystemSetting("ghl_sync_interval_ms"),
        storage.getSystemSetting("sla_check_interval_ms"),
      ]);
      if (typeof ghlRaw === "number" && Number.isFinite(ghlRaw) && ghlRaw >= GHL_SYNC_REPEAT_FLOOR_MS) {
        ghlOverrideMs = ghlRaw;
      }
      if (typeof slaRaw === "number" && Number.isFinite(slaRaw) && slaRaw >= SLA_CHECKS_REPEAT_FLOOR_MS) {
        slaOverrideMs = slaRaw;
      }
    } catch (overrideErr) {
      // Non-fatal: if system_settings is unavailable at startup, fall back to env/defaults
      console.warn("[QueueManager] Could not load interval overrides from system_settings:", (overrideErr as Error).message);
    }

    // Stagger the initial fire of every-N-ms repeatable jobs so queues with
    // identical intervals (e.g. the three 60s queues: cro03a, deal-stage-effects,
    // chargeback-commands) don't burst simultaneously and saturate the DB pool.
    // Each queue's repeatable schedule is offset by STAGGER_MS * its position
    // in the config list. Cron-pattern queues are calendar-driven and unaffected.
    const STAGGER_MS = 15_000; // 15 s between each non-cron queue's first fire
    let staggerIdx = 0;

    for (const config of this.activeConfigs()) {
      // Skip event-driven queues that have no repeatable schedule (repeatEveryMs === 0).
      // These queues are populated by ad-hoc queue.add() calls (e.g. post-enrichment
      // jobs fired inline by the enrichment pipeline) and must not get a repeatable job.
      if (!config.cronPattern && config.repeatEveryMs === 0) continue;

      const queue = this.queues.get(config.name);
      if (!queue) continue;

      const baseScheduleId = `${config.name}-repeatable`;
      const existing = await queue.getRepeatableJobs();
      // Do not delete schedules that merely share this physical queue.
      for (const job of existing.filter((job) => job.id === baseScheduleId)) {
        await queue.removeRepeatableByKey(job.key);
      }

      // Resolve effective interval: persisted override > config default.
      let effectiveMs = config.repeatEveryMs;
      if (!config.cronPattern) {
        if (config.name === QUEUE_NAMES.GHL_SYNC && ghlOverrideMs !== null) effectiveMs = ghlOverrideMs;
        if (config.name === QUEUE_NAMES.SLA_CHECKS && slaOverrideMs !== null) effectiveMs = slaOverrideMs;
        this.effectiveIntervals.set(config.name, effectiveMs);
      }

      const scheduleOffset = config.cronPattern ? 0 : staggerIdx * STAGGER_MS;
      staggerIdx++;

      await queue.add(config.jobName, {}, {
        repeat: config.cronPattern
          ? { pattern: config.cronPattern }
          : {
              every: effectiveMs,
              // startDate offsets when BullMQ computes the first "next run".
              // Because the schedule key includes the startDate, every process
              // restart with the same stagger order gets the same offset, giving
              // stable, predictable distribution across the repeat interval.
              startDate: new Date(Date.now() + scheduleOffset),
            },
        jobId: baseScheduleId,
      });

      // Immediate startup job intentionally removed (F-07).
      // Previously: queue.add(config.jobName, {}, { delay: scheduleOffset + random })
      // Rationale: all 29 queues firing simultaneously at startup compresses
      // kill-switch + heartbeat DB load into a narrow window, contributing to
      // pool saturation. Repeatable schedule is sufficient — the first run fires
      // at scheduleOffset (staggered), not immediately.
    }
    if (ghlOverrideMs !== null) console.log(`[QueueManager] GHL sync interval loaded from system_settings: ${ghlOverrideMs}ms`);
    if (slaOverrideMs !== null) console.log(`[QueueManager] SLA checks interval loaded from system_settings: ${slaOverrideMs}ms`);

    // ── Named queue schedules ─────────────────────────────────────────────────
    // Install additional repeatable jobs on event-driven queues (repeatEveryMs=0
    // in QUEUE_CONFIGS). Each named schedule is installed independently — only its
    // own matching repeatable job is replaced, never jobs from other named entries
    // or from the base queue config. This satisfies P1-1: a second schedule entry
    // on the same physical queue does NOT delete any other queue's jobs.
    for (const sched of NAMED_QUEUE_SCHEDULES) {
      const queue = this.queues.get(sched.queueName);
      if (!queue) continue;

      // Remove only the repeatable job(s) whose BullMQ key matches this entry's jobId.
      // BullMQ encodes the jobId into the repeatable key as part of the key string.
      const existingJobs = await queue.getRepeatableJobs();
      for (const job of existingJobs) {
        // Exact identity only: substrings can match an unrelated future schedule.
        if (job.id === sched.jobId) {
          await queue.removeRepeatableByKey(job.key);
        }
      }

      await queue.add(sched.jobName, {}, {
        repeat: sched.cronPattern
          ? { pattern: sched.cronPattern }
          : { every: sched.repeatEveryMs },
        jobId: sched.jobId,
      });

      const schedDesc = sched.cronPattern
        ? `cron="${sched.cronPattern}"`
        : `every ${sched.repeatEveryMs}ms`;
      console.log(`[QueueManager] Named schedule installed: ${sched.jobName} on ${sched.queueName} ${schedDesc} (jobId=${sched.jobId})`);
    }
  }

  /**
   * Live-update the repeat interval for a queue without restarting the process.
   * Removes all existing repeatable jobs for the queue and re-adds with the new
   * interval. The effectiveIntervals map is updated so callers can read back the
   * current value. Cron-pattern queues are not supported (returns false).
   */
  async updateQueueRepeatInterval(queueName: string, newIntervalMs: number): Promise<{ updated: boolean; effectiveMs: number }> {
    const queue = this.queues.get(queueName);
    if (!queue) return { updated: false, effectiveMs: newIntervalMs };

    const config = QUEUE_CONFIGS.find(c => c.name === queueName);
    if (!config) return { updated: false, effectiveMs: newIntervalMs };
    if (config.cronPattern) return { updated: false, effectiveMs: newIntervalMs };

    const baseScheduleId = `${queueName}-repeatable`;
    const existing = await queue.getRepeatableJobs();
    for (const job of existing.filter((job) => job.id === baseScheduleId)) {
      await queue.removeRepeatableByKey(job.key);
    }

    // Add a new repeatable job with the updated interval
    await queue.add(config.jobName, {}, {
      repeat: { every: newIntervalMs },
      jobId: baseScheduleId,
    });

    // Track runtime override
    this.effectiveIntervals.set(queueName, newIntervalMs);
    console.log(`[QueueManager] updateQueueRepeatInterval: ${queueName} → ${newIntervalMs}ms`);
    return { updated: true, effectiveMs: newIntervalMs };
  }

  /** Returns the currently-running repeat interval for a queue, or null if unknown. */
  getEffectiveInterval(queueName: string): number | null {
    return this.effectiveIntervals.get(queueName) ?? null;
  }

  /** Returns all currently-running repeat intervals keyed by queue name. */
  getEffectiveIntervals(): Record<string, number> {
    return Object.fromEntries(this.effectiveIntervals);
  }

  /**
   * Returns a structured, PII-free snapshot of the current queue topology.
   * Safe to include in operator dashboards and structured logs.
   * No Redis URLs, credentials, job payloads, contact/merchant data.
   */
  getTopologySnapshot(): QueueTopologySnapshot {
    return {
      manifestConfigCount: QUEUE_CONFIGS.length,
      activeConfigCount: this.activeConfigs().length,
      instantiatedQueueCount: this.queues.size,
      instantiatedWorkerCount: this.workers.size,
      logicalJobCount: QUEUE_CONFIGS.length + NAMED_QUEUE_SCHEDULES.length,
      legacyGhlClaimed: isLegacyGhlSyncClaimed(),
      queueMode: getQueueMode(),
      processId: process.pid,
      processIdentity: process.env.PROCESS_IDENTITY?.trim() || `process:${process.pid}`,
      releaseSha: process.env.RELEASE_SHA ?? null,
      capturedAt: new Date().toISOString(),
    };
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

  getJobHistory(): QueueHistoryEvidence {
    const result: QueueHistoryEvidence["points"] = {};
    const nowHour = Math.floor(Date.now() / (1000 * 60 * 60));

    for (const [name, buckets] of this.jobHistory.entries()) {
      result[name] = buckets
        .filter((bucket) => bucket.hour <= nowHour)
        .sort((a, b) => a.hour - b.hour)
        .map((bucket) => ({
          startedAt: new Date(bucket.hour * 60 * 60 * 1000).toISOString(),
          completed: bucket.completed,
          failed: bucket.failed,
        }));
    }
    const availableWindowHours = Math.min(
      HISTORY_HOURS,
      Math.max(1, Math.ceil((Date.now() - this.observationStartedAt.getTime()) / (60 * 60 * 1000))),
    );
    return {
      observationStartedAt: this.observationStartedAt.toISOString(),
      requestedWindowHours: HISTORY_HOURS,
      availableWindowHours,
      partial: availableWindowHours < HISTORY_HOURS,
      processIdentity: process.env.PROCESS_IDENTITY?.trim() || `process:${process.pid}`,
      releaseSha: process.env.RELEASE_SHA?.trim() || null,
      points: result,
    };
  }

  private async createReviewQueueItem(queueName: string, job: Job, err: Error): Promise<void> {
    const failureCode = classifyWorkerError(err);
    const event = sanitizeDeadLetterEvent({
      queueName,
      jobName: job.name,
      failureCode,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      occurredAt: new Date().toISOString(),
      source: "bullmq",
      retryable: false,
    });
    try {
      await storage.createReviewQueueItem({
        sourceType: "dead_letter_job" as any,
        sourceId: 0,
        status: "pending",
        notes: "BullMQ job exhausted all configured attempts. See canonical BullMQ retention for operational details.",
        metadata: event,
      });
      console.warn(JSON.stringify({
        event: "queue:terminal-exhaustion",
        queueName: event.queueName,
        jobName: event.jobName,
        attempts: event.attempts,
        failureCode: event.failureCode,
      }));
      const { sendCriticalAlert } = await import("./system-audit/slack-notifier");
      const alertResult = await sendCriticalAlert({
        subsystem: "queues",
        status: "error",
        summary: `Queue terminal exhaustion: ${event.queueName ?? "unknown"}/${event.jobName ?? "unknown"}`,
        details: event,
      });
      if (alertResult.feedStatus === "failed" || alertResult.transportStatus === "failed") {
        console.error(JSON.stringify({
          event: "queue:terminal-exhaustion-alert-degraded",
          claimStatus: alertResult.claimStatus,
          feedStatus: alertResult.feedStatus,
          transportStatus: alertResult.transportStatus,
          incidentFingerprint: alertResult.incidentFingerprint,
        }));
      }
    } catch (storageErr: any) {
      console.error(JSON.stringify({
        event: "queue:dead-letter-review-persist-failed",
        queueName: event.queueName,
        jobName: event.jobName,
        failureCode: event.failureCode,
      }));
      await storage.createAuditLog({
        action: "dead_letter_job",
        entityType: "system",
        details: event,
      });
    }
  }

  async getAllQueueMetrics(): Promise<{ queues: QueueMetric[]; queueMode: QueueMode; status: "ok" | "degraded" }> {
    const metrics: QueueMetric[] = [];

    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) {
        metrics.push({
          name: config.name,
          waiting: null,
          active: null,
          completed: null,
          failed: null,
          delayed: null,
          paused: null,
          repeatEveryMs: this.effectiveIntervals.get(config.name) ?? config.repeatEveryMs,
          lastCompletedAt: null,
          lastFailedAt: null,
          avgDurationMs: null,
          throughputPerHour: null,
          probeStatus: "error",
          errorCode: "QUEUE_METRICS_READ_FAILED",
        });
        continue;
      }

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
            repeatEveryMs: this.effectiveIntervals.get(config.name) ?? config.repeatEveryMs,
          lastCompletedAt,
          lastFailedAt,
          avgDurationMs,
          throughputPerHour,
          probeStatus: "ok",
        });
      } catch (err: any) {
        metrics.push({
          name: config.name,
          waiting: null,
          active: null,
          completed: null,
          failed: null,
          delayed: null,
          paused: null,
          repeatEveryMs: config.repeatEveryMs,
          lastCompletedAt: null,
          lastFailedAt: null,
          avgDurationMs: null,
          throughputPerHour: null,
          probeStatus: "error",
          errorCode: "QUEUE_METRICS_READ_FAILED",
        });
      }
    }

    return {
      queues: metrics,
      queueMode: getQueueMode(),
      status: metrics.some((metric) => metric.probeStatus === "error") ? "degraded" : "ok",
    };
  }

  private async getFleetEvidence(topology: QueueTopologySnapshot): Promise<QueueFleetEvidence> {
    const releaseSha = topology.releaseSha ?? "";
    const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
    const environmentIdentity = process.env.NODE_ENV ?? "";
    const redis = getSharedRedisClientIfReady();
    if (!/^[a-f0-9]{40}$/i.test(releaseSha) || !deploymentIdentity || !environmentIdentity || !redis) {
      return {
        status: "unknown",
        scope: "cro03c_worker_inventory",
        authoritativeComplete: false,
        expectedProcessCount: null,
        observedProcessCount: null,
        observedBootCount: null,
        errorCode: "FLEET_AUTHORITY_UNAVAILABLE",
      };
    }
    try {
      const [{ currentCro03cDeploymentInventory }, { readCro03cWorkerFleet }] = await Promise.all([
        import("./cro03/deployment-inventory"),
        import("./cro03/runtime-heartbeat"),
      ]);
      const inventory = await currentCro03cDeploymentInventory({
        deploymentIdentity,
        environmentIdentity,
        releaseSha,
        queueTopologyHash: getCro03cQueueTopologyHash(),
      });
      const fleet = await readCro03cWorkerFleet({
        redis,
        prefix: this.redisKeyPrefix,
        expectedReleaseSha: releaseSha,
        expectedQueueTopologyHash: getCro03cQueueTopologyHash(),
        expectedProcessIdentities: inventory.workerIdentities,
      });
      return {
        status: fleet.complete ? "reconciled" : "degraded",
        scope: "cro03c_worker_inventory",
        authoritativeComplete: fleet.complete,
        expectedProcessCount: inventory.workerIdentities.length,
        observedProcessCount: fleet.heartbeats.length,
        observedBootCount: new Set(fleet.heartbeats.map((heartbeat) => heartbeat.bootIdentity)).size,
        ...(fleet.complete ? {} : { errorCode: "FLEET_SCAN_INCOMPLETE" }),
      };
    } catch (error) {
      return {
        status: "degraded",
        scope: "cro03c_worker_inventory",
        authoritativeComplete: false,
        expectedProcessCount: null,
        observedProcessCount: null,
        observedBootCount: null,
        errorCode: error instanceof Error ? error.message.slice(0, 100) : "FLEET_RECONCILIATION_FAILED",
      };
    }
  }

  async getTelemetryEvidence(): Promise<QueueTelemetryEvidence> {
    const capturedAt = new Date().toISOString();
    const topology = this.getTopologySnapshot();
    const [metrics, dlqRead, fleet] = await Promise.all([
      this.getAllQueueMetrics(),
      this.getDeadLetterItemsWithStatus(),
      this.getFleetEvidence(topology),
    ]);
    const degradations: string[] = [];

    let dueEnrollmentCount: number | null = null;
    let oldestDueMs: number | null = null;
    let lastSequenceRunMs: number | null = null;
    let backlogStatus: QueueTelemetryEvidence["backlog"]["probeStatus"] = "ok";
    let backlogErrorCode: string | undefined;
    try {
      const { db } = await import("../db");
      const backlogResult = await db.execute(sql`
        SELECT COUNT(*)::int AS backlog, MIN(next_action_at) AS oldest_due_at
        FROM sequence_enrollments
        WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= NOW()
      `);
      const row = backlogResult.rows[0] as any;
      dueEnrollmentCount = Number(row?.backlog ?? 0);
      oldestDueMs = row?.oldest_due_at ? Date.now() - new Date(row.oldest_due_at).getTime() : null;
      const lastRunRaw = await storage.getSystemSetting("sequence_worker_last_run");
      lastSequenceRunMs =
        lastRunRaw && typeof lastRunRaw === "object" && (lastRunRaw as any).duration_ms !== undefined
          ? Number((lastRunRaw as any).duration_ms)
          : null;
    } catch {
      backlogStatus = "error";
      backlogErrorCode = "SEQUENCE_BACKLOG_READ_FAILED";
      degradations.push(backlogErrorCode);
    }

    let observedAccountConnectedClients: number | null = null;
    let infoProbeStatus: QueueTelemetryEvidence["redis"]["infoProbeStatus"] = "not_initialized";
    let redisErrorCode: string | undefined;
    const redis = getSharedRedisClientIfReady();
    if (redis) {
      try {
        const infoRaw = await redis.info("clients");
        const match = infoRaw.match(/(?:^|\r?\n)connected_clients:(\d+)/);
        if (!match) throw new Error("CONNECTED_CLIENTS_MISSING");
        observedAccountConnectedClients = Number(match[1]);
        infoProbeStatus = "ok";
      } catch {
        infoProbeStatus = "error";
        redisErrorCode = "REDIS_CLIENT_INFO_READ_FAILED";
        degradations.push(redisErrorCode);
      }
    } else {
      redisErrorCode = "REDIS_CLIENT_NOT_INITIALIZED";
      degradations.push(redisErrorCode);
    }
    const capacity = diagnoseRedisCapacity({
      physicalWorkerCount: topology.instantiatedWorkerCount,
      observedAccountConnectedClients,
      deploymentProcessCount: fleet.authoritativeComplete ? fleet.observedProcessCount : null,
    });

    if (metrics.status === "degraded") degradations.push("QUEUE_METRICS_DEGRADED");
    if (dlqRead.queueStatus.some((source) => source.status !== "sampled")) {
      degradations.push("DLQ_SAMPLE_INCOMPLETE");
    }
    if (fleet.status !== "reconciled") degradations.push("FLEET_NOT_RECONCILED");
    if (capacity.status !== "safe") degradations.push(`REDIS_CAPACITY_${capacity.status.toUpperCase()}`);

    return {
      status: degradations.length ? "degraded" : "ok",
      scope: "local_process_with_reconciled_cro03c_worker_fleet",
      freshness: {
        capturedAt,
        observationStartedAt: this.observationStartedAt.toISOString(),
      },
      topology,
      fleet,
      queues: metrics.queues,
      backlog: {
        probeStatus: backlogStatus,
        dueEnrollmentCount,
        oldestDueMs,
        lastSequenceRunMs,
        ...(backlogErrorCode ? { errorCode: backlogErrorCode } : {}),
      },
      redis: {
        infoProbeStatus,
        observedAccountConnectedClients,
        capacity,
        ...(redisErrorCode ? { errorCode: redisErrorCode } : {}),
      },
      dlq: {
        sampleCount: dlqRead.items.length,
        complete: false,
        resultScope: "sampled_per_queue",
        queueStatus: dlqRead.queueStatus,
      },
      history: this.getJobHistory(),
      degradations: [...new Set(degradations)],
    };
  }

  async getDeadLetterItemsWithStatus(): Promise<DlqReadResult> {
    const items: DlqItem[] = [];
    const queueStatus: DlqReadResult["queueStatus"] = [];

    for (const config of QUEUE_CONFIGS) {
      const queue = this.queues.get(config.name);
      if (!queue) {
        queueStatus.push({ source: config.name, status: "not_initialized" });
        continue;
      }

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
              failureCode: "terminal_exhaustion",
              attemptsMade: job.attemptsMade,
              timestamp: job.timestamp,
              processedOn: job.processedOn ?? null,
              finishedOn: job.finishedOn ?? null,
            });
          }
        }
        queueStatus.push({ source: config.name, status: "sampled", sampleLimitPerQueue: 50 });
      } catch {
        queueStatus.push({ source: config.name, status: "failed", errorCode: "QUEUE_READ_FAILED" });
      }
    }

    return { items: items.sort((a, b) => b.timestamp - a.timestamp), queueStatus };
  }

  async getDeadLetterItems(): Promise<DlqItem[]> {
    return (await this.getDeadLetterItemsWithStatus()).items;
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

    if (this.cro03cHeartbeatTimer) clearInterval(this.cro03cHeartbeatTimer);
    this.cro03cHeartbeatTimer = null;
    if (this.cro03cHeartbeatKey) {
      await (this.connection as any).del(this.cro03cHeartbeatKey).catch(() => undefined);
      this.cro03cHeartbeatKey = null;
    }

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

export function getCro03cQueueTopologyHash(): string {
  const topology = {
    queues: QUEUE_CONFIGS.map(({ name, concurrency, attempts, backoffDelay, repeatEveryMs, cronPattern, jobName }) => ({
      name, concurrency, attempts, backoffDelay, repeatEveryMs, cronPattern: cronPattern ?? null, jobName,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    namedSchedules: NAMED_QUEUE_SCHEDULES.map(({ queueName, jobName, repeatEveryMs, cronPattern, jobId }) => ({
      queueName, jobName, repeatEveryMs, cronPattern: cronPattern ?? null, jobId,
    })).sort((a, b) => a.jobId.localeCompare(b.jobId)),
  };
  return createHash("sha256").update(JSON.stringify(topology)).digest("hex");
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
    }).catch((err: Error) => console.error("[Queue:sequences] heartbeat write failed (setSystemSetting):", err.message));
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
    }).catch((err: Error) => console.error("[Queue:sequences] heartbeat write failed (createAuditLog):", err.message));
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
  const { processNextCro03Item, processNextCro03Mutation } = await import("./cro03/enrichment-factory");
  const { processNextCro03bRecipeItem } = await import("./cro03/admission-service");
  try {
    for (let processed = 0; processed < 5; processed++) {
      if (await processNextCro03Item() === "idle") break;
    }
    for (let processed = 0; processed < 10; processed++) {
      if (await processNextCro03Mutation() === "idle") break;
    }
    for (let processed = 0; processed < 10; processed++) {
      if (await processNextCro03bRecipeItem() === "idle") break;
    }
    const { recordWorkerSuccess, JOB_NAMES } = await import("./job-registry");
    await recordWorkerSuccess(JOB_NAMES.ENRICHMENT_QUEUE_PROCESSOR);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[Queue:enrichment] CRO-03 durable factory error:", e.message);
    const { recordWorkerFailure, JOB_NAMES } = await import("./job-registry");
    await recordWorkerFailure(JOB_NAMES.ENRICHMENT_QUEUE_PROCESSOR, e.message);
  }
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

  const qm = requireQueueManagerReady();
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

      // Advance contact lifecycle to STATEMENT_ANALYZED and trigger NBA recompute
      const deal = await storage.getDeal(dealId);
      if (deal?.contactId) {
        const { onStatementAnalyzed } = await import("./statement-acquisition");
        onStatementAnalyzed(deal.contactId, dealId).catch(err =>
          console.warn(`[Queue:enrichment] onStatementAnalyzed failed for deal #${dealId}:`, err.message),
        );
      }
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
          await advanceDealStage(dealId, "Proposal Sent", "underwriting_auto_approve");
          console.log(`[Underwriting] Deal #${dealId} auto-approved — advanced to Proposal Sent`);
        } else {
          // Hold or review: explicitly lock deal into Review In Progress
          const { advanceDealStage } = await import("./deal-stage-service");
          await advanceDealStage(dealId, "Review In Progress", "underwriting_flag");
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
    const qm = requireQueueManagerReady();
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

/**
 * Enqueue a one-off zerobounce-batch-validate job for a run (#1541).
 * Returns the BullMQ job ID, or null if the queue is unavailable
 * (Redis down / QueueManager not initialised) — callers must treat null as
 * a hard failure and mark the run interrupted; there is NO in-process fallback.
 */
export async function enqueueZeroBounceRun(runId: string): Promise<string | null> {
  try {
    const qm = requireQueueManagerReady();
    const queue = qm.getQueue(QUEUE_NAMES.ZEROBOUNCE_BATCH);
    if (!queue) return null;
    const job = await queue.add("run", { runId }, {
      attempts: 1,
      jobId: `zb-run-${runId}`,
    });
    console.log(`[Queue:zerobounce-batch-validate] Enqueued run ${runId} → job ${job.id}`);
    return job.id ?? null;
  } catch (err: any) {
    console.error(`[Queue:zerobounce-batch-validate] Failed to enqueue run ${runId}:`, err?.message ?? err);
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

async function runActivationMonitorTick(): Promise<void> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  // JOB_NAMES may not have ACTIVATION_MONITOR yet — use string directly as fallback
  const jobKey = (JOB_NAMES as any).ACTIVATION_MONITOR ?? "activation-monitor";
  const lease = await acquireJobLock(jobKey);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;

  try {
    const { runActivationMonitor } = await import("./merchant-activation-monitor");
    const result = await runActivationMonitor();
    if (result.alerts > 0) {
      console.log(`[Queue:activation-monitor] ${result.alerts} unactivated MID alert(s) sent (${result.checked} checked)`);
    }
    await releaseJobLock(jobKey, true, undefined, lockToken);
  } catch (err: any) {
    await releaseJobLock(jobKey, false, err.message, lockToken);
    throw err;
  }
}

async function runMerchantSuccessTick(): Promise<void> {
  const { acquireJobLock, releaseJobLock } = await import("./job-registry");
  const jobKey = "merchant-success";
  const lease = await acquireJobLock(jobKey);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;

  try {
    const { runMerchantSuccessSequences } = await import("./merchant-success-sequences");
    const result = await runMerchantSuccessSequences();
    if (result.enrolled > 0) {
      console.log(`[Queue:merchant-success] ${result.enrolled} enrollment(s) created across ${result.checked} activated MIDs`);
    }
    await releaseJobLock(jobKey, true, undefined, lockToken);
  } catch (err: any) {
    await releaseJobLock(jobKey, false, err.message, lockToken);
    throw err;
  }
}

async function runWinbackOutreachTick(): Promise<void> {
  const { acquireJobLock, releaseJobLock } = await import("./job-registry");
  const jobKey = "winback-outreach";
  const lease = await acquireJobLock(jobKey);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;

  try {
    const { runWinbackOutreachEngine } = await import("./winback-outreach-engine");
    const result = await runWinbackOutreachEngine();
    if (result.sent > 0) {
      console.log(`[Queue:winback-outreach] sent=${result.sent} suppressed=${result.suppressed} errors=${result.errors}`);
    }
    await releaseJobLock(jobKey, true, undefined, lockToken);
  } catch (err: any) {
    await releaseJobLock(jobKey, false, err.message, lockToken);
    throw err;
  }
}

async function runMidIngestionTick(): Promise<void> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const lease = await acquireJobLock(JOB_NAMES.MID_INGESTION);
  if (lease.status !== "acquired") return;
  const lockToken = lease.lockToken;

  try {
    // REV-05A: import from registry (not processor-api) — registry holds
    // #1737-domain functions and returns {held:true} until REV-06A certifies them.
    const { ingestMidDataForActiveMids } = await import("./processors/registry");
    const result = await ingestMidDataForActiveMids();
    if (result.held) {
      console.log("[Queue:mid-ingestion] held pending task #1737 (REV-06A) — skipped");
    } else if (result.processed > 0 || result.errors > 0) {
      console.log(`[Queue:mid-ingestion] ${result.processed} processed, ${result.errors} errors`);
    }
    await releaseJobLock(JOB_NAMES.MID_INGESTION, true, undefined, lockToken);
  } catch (err: any) {
    await releaseJobLock(JOB_NAMES.MID_INGESTION, false, err.message, lockToken);
    throw err;
  }

  // After ingestion succeeds: run attrition analysis to flag at-risk merchants.
  // Fire-and-forget — a failure here must never surface as a job failure that
  // triggers queue retries or blocks the next ingestion cycle.
  import("./merchant-attrition-monitor").then(({ runAttritionAnalysis }) =>
    runAttritionAnalysis()
  ).catch(e =>
    console.error("[Queue:mid-ingestion] Attrition analysis error (non-fatal):", e)
  );
}
