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
 *   provider-live       — cro03c-live
 *   email-validation    — zerobounce-batch-validate
 *   outreach            — sequences, enrollment-recovery, winback-outreach,
 *                         abandoned-statement, proposal-followup
 *   operations          — sla-checks, digests, mid-ingestion, onboarding-reminder,
 *                         activation-monitor, merchant-success, executive-snapshot,
 *                         health-monitor, pipeline-silence-check, partner-monthly-digest
 *   heavy-maintenance   — db-backup, system-audit
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
  /** Live provider execution gate: CRO03C dispatch and recovery */
  "provider-live": [
    "cro03c-live",
  ],
  /** Email validation via ZeroBounce */
  "email-validation": [
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
  /** Operational health and reporting workers */
  "operations": [
    "sla-checks",
    "digests",
    "mid-ingestion",
    "onboarding-reminder",
    "activation-monitor",
    "merchant-success",
    "executive-snapshot",
    "health-monitor",
    "pipeline-silence-check",
    "partner-monthly-digest",
  ],
  /** Heavy maintenance jobs: DB backup, system audit */
  "heavy-maintenance": [
    "db-backup",
    "system-audit",
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
