import { storage } from "../storage";
import { markScoringInterrupted } from "./scoring-progress-helpers";
import { db } from "../db";
import { automationRegistry } from "@shared/schema";

export async function reconcileScoringState(): Promise<void> {
  try {
    await markScoringInterrupted();
  } catch (err) {
    console.error("[StartupReconcile] Scoring reconciliation failed — continuing startup:", err);
  }
}

// ---------------------------------------------------------------------------
// Automation registry seed definitions
// ---------------------------------------------------------------------------
const AUTOMATION_SEEDS: Array<{
  key: string;
  title: string;
  triggerDescription: string;
  owner?: string;
}> = [
  { key: "ghl-sync", title: "GHL Sync", triggerDescription: "Every 45s (prod) / 5min (dev) — syncs contacts with GoHighLevel", owner: "integrations" },
  { key: "sla-checks", title: "SLA Checks", triggerDescription: "Every 5min (prod) / 15min (dev) — fires SLA breach alerts", owner: "ops" },
  { key: "sequences", title: "Sequence Worker", triggerDescription: "Every 10min — processes active follow-up sequence enrollments", owner: "outreach" },
  { key: "enrichment", title: "Enrichment Worker", triggerDescription: "Every 10min — runs contact enrichment jobs and lead scoring", owner: "data" },
  { key: "discovery", title: "Lead Discovery", triggerDescription: "Daily — discovers new leads via SDR orchestrator", owner: "sdr" },
  { key: "digests", title: "Digests", triggerDescription: "Hourly — sends team digest notifications", owner: "ops" },
  { key: "mid-ingestion", title: "MID Ingestion", triggerDescription: "Daily — ingests merchant residual MID data", owner: "finance" },
  { key: "onboarding-reminder", title: "Onboarding Reminder", triggerDescription: "Every 4h — reminds merchants of outstanding onboarding docs; recovers abandoned applications", owner: "onboarding" },
  { key: "abandoned-statement", title: "Abandoned Statement", triggerDescription: "Daily — follows up on statement requests with no upload after 3+ days", owner: "sales" },
  { key: "system-audit", title: "System Audit", triggerDescription: "Weekly (Mon 11am UTC) — runs full system health audit", owner: "ops" },
  { key: "db-backup", title: "Database Backup", triggerDescription: "Daily at 3am UTC — pg_dump snapshot to storage", owner: "infra" },
  { key: "enrollment-recovery", title: "Enrollment Recovery", triggerDescription: "Daily at 6am UTC — recovers deferred enrollments after daily cap resets", owner: "outreach" },
  { key: "ghl-enrollment-recovery", title: "GHL Enrollment Recovery", triggerDescription: "Every 30min — retries failed GHL workflow enrollments", owner: "integrations" },
  { key: "health-monitor", title: "Health Monitor", triggerDescription: "Every 5min (prod) / 15min (dev) — checks system component health", owner: "ops" },
  { key: "executive-snapshot", title: "Executive Snapshot", triggerDescription: "Weekly (Mon 12pm UTC) — generates KPI briefings for leadership", owner: "leadership" },
  { key: "pipeline-silence-check", title: "Pipeline Silence Check", triggerDescription: "Daily at 9am UTC — alerts on pipeline stages with no activity", owner: "sales" },
  { key: "proposal-followup", title: "Proposal Follow-Up", triggerDescription: "Daily at 10am UTC — resends proposals not viewed within 3 days (max 2 resends)", owner: "sales" },
  { key: "partner-monthly-digest", title: "Partner Monthly Digest", triggerDescription: "1st of month at 9am UTC — sends earnings summary to active partners", owner: "partnerships" },
  { key: "sdr-orchestrator", title: "SDR Orchestrator", triggerDescription: "On-demand / scheduled — AI-driven prospect discovery and outreach orchestration", owner: "sdr" },
];

/**
 * Upserts all known automations into the registry.
 * Only inserts missing rows or updates title/trigger_description.
 * Never overwrites kill_switch_enabled or status.
 */
export async function seedAutomationRegistry(): Promise<void> {
  try {
    for (const seed of AUTOMATION_SEEDS) {
      await db
        .insert(automationRegistry)
        .values({
          key: seed.key,
          title: seed.title,
          triggerDescription: seed.triggerDescription,
          owner: seed.owner ?? null,
          killSwitchEnabled: false,
          status: "active",
        })
        .onConflictDoUpdate({
          target: automationRegistry.key,
          set: {
            title: seed.title,
            triggerDescription: seed.triggerDescription,
            owner: seed.owner ?? null,
            updatedAt: new Date(),
          },
        });
    }
    console.log(`[StartupReconcile] Automation registry seeded with ${AUTOMATION_SEEDS.length} entries`);
  } catch (err) {
    console.error("[StartupReconcile] Automation registry seed failed — continuing startup:", err);
  }
}

export async function reconcileEnrichmentState(
  storageImpl: Pick<typeof storage, "getSystemSetting" | "setSystemSetting"> = storage
): Promise<void> {
  try {
    const raw = await storageImpl.getSystemSetting("enrichment_progress");

    if (raw === null || raw === undefined) return;

    if (typeof raw !== "object" || Array.isArray(raw) || !("status" in raw)) {
      console.warn("[StartupReconcile] enrichment_progress has unexpected shape — skipping");
      return;
    }

    const value = raw as Record<string, unknown>;

    if (value.status !== "running") return;

    await storageImpl.setSystemSetting("enrichment_progress", {
      ...value,
      status: "interrupted",
      interruptedAt: new Date().toISOString(),
      interruptionReason: "server_restart",
      failedAt: undefined,
      error: undefined,
    });

    console.log(`[StartupReconcile] enrichment_progress marked interrupted (was running since ${value.startedAt ?? "unknown"})`);
  } catch (err) {
    console.error("[StartupReconcile] Reconciliation failed — continuing startup:", err);
  }
}
