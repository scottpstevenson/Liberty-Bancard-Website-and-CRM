/**
 * background-profile.ts
 *
 * Controls which background workers and schedulers are active.
 * Read from the BACKGROUND_JOB_PROFILE environment variable.
 *
 * CRITICAL: Absent or invalid → "off" (fail-closed).
 * Enabling "full" always requires an explicit env-var change.
 * Never start any worker unless this is explicitly set to "core", "full",
 * or "selective:<group1>,<group2>".
 *
 * ### Selective mode
 * BACKGROUND_JOB_PROFILE=selective:enrichment,ghl-integration
 *
 * Permitted capability group names (defined in WORKER_CAPABILITY_GROUPS):
 *   critical-commands   — deal-stage-effects, chargeback-commands, statement-upload
 *   ghl-integration     — ghl-sync, ghl-enrollment-recovery, voicemail-sync
 *   enrichment          — enrichment, post-enrichment, cro03a-qualification, discovery
 *   free-enrichment-lane — isolated RDAP/JSON-LD/contact-page/HTML-only enrichment
 *   provider-live       — cro03c-live
 *   email-validation    — zerobounce-batch-validate
 *   outreach            — sequences, enrollment-recovery, winback-outreach,
 *                         abandoned-statement, proposal-followup
 *   operations          — sla-checks, digests, mid-ingestion, onboarding-reminder,
 *                         activation-monitor, merchant-success, executive-snapshot,
 *                         pipeline-silence-check, partner-monthly-digest
 *   health-monitor      — health-monitor (split out from `operations`: this job only
 *                         computes internal health signals, but ALSO sends email/Slack
 *                         alerts on critical status — kept isolated so it can be
 *                         reasoned about and approved separately from the other 9
 *                         `operations` jobs, not because it is side-effect-free)
 *   db-backup           — db-backup (split out from `heavy-maintenance`: no external
 *                         side effects beyond writing/uploading a backup artifact)
 *   system-audit        — system-audit (split out from `heavy-maintenance`: sends a
 *                         Slack narrative on every run — a real external side effect)
 *
 * `heavy-maintenance` and the old 10-job `operations` group names no longer exist.
 * This is a deliberate breaking rename (Task #1955): the prior groupings let an
 * operator turn on `db-backup` only by also turning on `system-audit` (Slack), or
 * turn on `health-monitor`'s internal computation only by also turning on 9 other
 * jobs that send email/Slack/reports. No known selective-profile configuration
 * (dev or prod) currently references the old names, so this rename is safe.
 *
 * Unknown group names are logged and ignored (fail-closed on ALL invalid).
 * Consumer enablement, recurring scheduling, and send authority are independent.
 */

export type BackgroundProfile = "off" | "core" | "full" | "selective";

/**
 * Maps stable capability group names to physical queue names.
 * Queue names must match QUEUE_NAMES values in queue-names.ts exactly.
 * This mapping is the authoritative source for selective-mode queue selection.
 */
export const WORKER_CAPABILITY_GROUPS = {
  /** Durable command dispatch: deal stage effects, chargebacks, statement upload */
  "critical-commands": [
    "deal-stage-effects",
    "chargeback-commands",
    "statement-upload",
  ],
  /** GHL API integration: sync, enrollment recovery, voicemail */
  "ghl-integration": [
    "ghl-sync",
    "ghl-enrollment-recovery",
    "voicemail-sync",
  ],
  /** Contact data enrichment pipeline: enrichment, post-enrichment, CRO03A qualification */
  "enrichment": [
    "enrichment",
    "post-enrichment",
    "cro03a-qualification",
  ],
  /**
   * MI-09 Level 1 free-only lane. This is deliberately a distinct capability
   * from `enrichment`: selecting it must never imply paid discovery, AI, GHL,
   * or outreach capability.
   */
  "free-enrichment-lane": [
    "free-enrichment-lane",
  ],
  /**
   * Explicit free-only activation alias. It contains no paid, GHL, sequence,
   * outreach, or recurring schedule queue.
   */
  "free-only-workers": [
    "free-enrichment-lane",
  ],
  /** Live provider execution gate: CRO03C dispatch and recovery */
  "provider-live": [
    "cro03c-live",
    "master-lead-stager", // MI-07: terminal step of cro03c pipeline — stages validated leads
  ],
  /** Email validation via ZeroBounce */
  "email-validation": [
    "zerobounce-batch-validate",
  ],
  /**
   * Bounded paid-pilot lane. Selecting this group never implies GHL,
   * sequences, outreach, or recurring CRO08A schedules.
   */
  "bounded-pilot-workers": [
    "cro03c-live",
    "master-lead-stager",
    "zerobounce-batch-validate",
  ],
  /** Outreach pipelines: sequences, discovery (daily outreach), enrollment recovery, win-back, abandoned statement, proposal follow-up */
  "outreach": [
    "sequences",
    "discovery",
    "enrollment-recovery",
    "winback-outreach",
    "abandoned-statement",
    "proposal-followup",
  ],
  /**
   * Operational health and reporting workers, EXCLUDING health-monitor.
   * Every job here sends email, Slack, or a report to a human — none are
   * internal-computation-only. `health-monitor` is deliberately isolated
   * into its own group below so it can be evaluated independently.
   */
  "operations": [
    "sla-checks",
    "digests",
    "mid-ingestion",
    "onboarding-reminder",
    "activation-monitor",
    "merchant-success",
    "executive-snapshot",
    "pipeline-silence-check",
    "partner-monthly-digest",
  ],
  /**
   * Isolated from `operations` (Task #1955): computes internal health
   * signals AND sends email/Slack alerts on critical status. Kept separate
   * so an operator can reason about and approve it on its own, not lumped
   * in with the other 9 `operations` jobs.
   */
  "health-monitor": [
    "health-monitor",
  ],
  /**
   * Isolated from the old `heavy-maintenance` group (Task #1955): writes/
   * uploads a database backup artifact. No external notification side
   * effect of its own.
   */
  "db-backup": [
    "db-backup",
  ],
  /**
   * Isolated from the old `heavy-maintenance` group (Task #1955): runs the
   * weekly subsystem probe and posts a generated narrative to Slack — a
   * real external side effect, kept separate from `db-backup`.
   */
  "system-audit": [
    "system-audit",
  ],
  /**
   * CRO08A continuous enrichment factory: scheduler tick + processor tick.
   * Deliberately separate from `enrichment` and `provider-live` — those groups
   * cover the request-driven/live-dispatch queues, not CRO08A's recurring
   * schedule-definition scheduler/processor. Without this group, no selective
   * profile combination can start the CRO08A continuous factory.
   */
  "continuous-enrichment": [
    "cro08a-scheduler",
    "cro08a-processor",
  ],
  /** CRO08A recurring enrichment activation, kept distinct from pilot work. */
  "cro08a-recurring-enrichment": [
    "cro08a-scheduler",
    "cro08a-processor",
  ],
  /**
   * Task #2001: isolated SFP campaign/sequence staging worker. Reuses
   * sfp_stage_runs/sfp_stage_items (stage='campaign_staging'). Writes only
   * to sfp_campaign_staging_intents/master_leads at the `ready_held`
   * boundary — never sequence_enrollments, campaign_queue_*, or any
   * GHL/outbound write. Deliberately NOT included in `outreach` or any
   * other group so enabling it never starts sequence/GHL/paid-provider
   * workers.
   */
  "sfp-campaign-staging": [
    "sfp-campaign-staging",
  ],
} as const satisfies Record<string, readonly string[]>;

export type WorkerCapabilityGroup = keyof typeof WORKER_CAPABILITY_GROUPS;

/**
 * Per-job logical capability overrides.
 *
 * Some physical queues host jobs whose logical capability belongs to a DIFFERENT
 * group than the queue itself. For example, the `enrichment` physical queue also
 * processes `campaign-queue-run` (outreach) and `inbound-confirmation-followup`
 * (ghl-integration). Without per-job overrides, `selective:enrichment` would
 * silently execute outreach and GHL jobs — defeating the bounded-execution goal.
 *
 * Key format: `"<physicalQueueName>:<jobName>"`.
 * Value: the WorkerCapabilityGroup that governs whether this job may run.
 *
 * Jobs not listed here inherit the capability group of their physical queue.
 */
export const JOB_LOGICAL_CAPABILITY_OVERRIDES: Readonly<Record<string, WorkerCapabilityGroup>> = {
  // Outreach jobs co-located on the enrichment physical queue
  "enrichment:campaign-queue-run":            "outreach",
  "enrichment:promotional-enrollment-eval":   "outreach",
  // GHL follow-up job co-located on the enrichment physical queue
  "enrichment:inbound-confirmation-followup": "ghl-integration",
};

/**
 * Returns the capability group that governs whether a given job should run.
 *
 * For selective profiles this is the gate: if the returned group is not in the
 * active groups list, the job must be suppressed (default deny).
 *
 * Returns `null` for queues not assigned to any known group (these are always
 * allowed — they have no capability-group owner to enforce).
 */
export function getJobCapabilityGroup(
  queueName: string,
  jobName: string,
): WorkerCapabilityGroup | null {
  const overrideKey = `${queueName}:${jobName}`;
  if (overrideKey in JOB_LOGICAL_CAPABILITY_OVERRIDES) {
    return JOB_LOGICAL_CAPABILITY_OVERRIDES[overrideKey];
  }
  // Fall back to the physical queue's own group
  for (const [group, queues] of Object.entries(WORKER_CAPABILITY_GROUPS)) {
    if ((queues as readonly string[]).includes(queueName)) {
      return group as WorkerCapabilityGroup;
    }
  }
  return null;
}

const VALID_GROUPS = new Set<string>(Object.keys(WORKER_CAPABILITY_GROUPS));
const VALID_PROFILES = new Set<string>(["off", "core", "full"]);

export function getBackgroundProfile(): BackgroundProfile {
  const raw = process.env.BACKGROUND_JOB_PROFILE;
  if (!raw) {
    console.error(
      JSON.stringify({
        event: "background_profile:fail_closed",
        reason: "missing",
        value: null,
        resolvedTo: "off",
        ts: new Date().toISOString(),
      }),
    );
    return "off";
  }

  if (VALID_PROFILES.has(raw)) return raw as BackgroundProfile;

  if (raw.startsWith("selective:")) {
    const { groups, invalidGroups } = _parseSelectiveRaw(raw);
    if (invalidGroups.length > 0) {
      console.error(
        JSON.stringify({
          event: "background_profile:unknown_capability_groups",
          invalidGroups,
          validGroups: [...VALID_GROUPS],
          note: "Unknown groups are ignored. If ALL groups were invalid the profile resolves to off.",
          ts: new Date().toISOString(),
        }),
      );
    }
    if (groups.length === 0) {
      console.error(
        JSON.stringify({
          event: "background_profile:fail_closed",
          reason: "selective_no_valid_groups",
          value: raw,
          resolvedTo: "off",
          ts: new Date().toISOString(),
        }),
      );
      return "off";
    }
    return "selective";
  }

  console.error(
    JSON.stringify({
      event: "background_profile:fail_closed",
      reason: "invalid",
      value: raw,
      resolvedTo: "off",
      ts: new Date().toISOString(),
    }),
  );
  return "off";
}

function _parseSelectiveRaw(raw: string): {
  groups: WorkerCapabilityGroup[];
  invalidGroups: string[];
} {
  const parts = raw
    .slice("selective:".length)
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

  const groups: WorkerCapabilityGroup[] = [];
  const invalidGroups: string[] = [];
  for (const p of parts) {
    if (VALID_GROUPS.has(p)) {
      groups.push(p as WorkerCapabilityGroup);
    } else {
      invalidGroups.push(p);
    }
  }
  return { groups, invalidGroups };
}

/**
 * Returns the capability groups selected when profile=selective.
 * Returns [] for any other profile.
 */
export function getSelectiveGroups(): WorkerCapabilityGroup[] {
  const raw = process.env.BACKGROUND_JOB_PROFILE ?? "";
  if (!raw.startsWith("selective:")) return [];
  return _parseSelectiveRaw(raw).groups;
}

/**
 * Resolves the set of physical queue names permitted by the selected
 * capability groups. Used by QueueManager.activeConfigs() in selective mode.
 * Deduplicates across groups.
 */
export function getQueuesForCapabilityGroups(groups: WorkerCapabilityGroup[]): readonly string[] {
  const seen = new Set<string>();
  for (const g of groups) {
    for (const q of WORKER_CAPABILITY_GROUPS[g]) {
      seen.add(q);
    }
  }
  return [...seen];
}

/**
 * Queues allowed to run in "core" profile.
 * Starts empty — populated operationally during controlled soak,
 * one worker at a time, with pool metrics captured before and after each addition.
 * Do NOT populate this in code without runtime evidence.
 */
export const CORE_QUEUE_ALLOWLIST: string[] = [];
