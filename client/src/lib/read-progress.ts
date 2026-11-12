import type { LaunchInventoryProgress } from "@shared/sfp-launch-inventory";

/** Whole seconds elapsed, never negative, never fractional ("12 s", "1 min 5 s"). */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

const PHASE_LABELS: Record<NonNullable<LaunchInventoryProgress["phase"]>, string> = {
  policy_read: "Reading the active program policy",
  recorded_facts: "Reading recorded recipient facts",
  contact_policy: "Re-checking each contact against current rules",
  sender_and_pause: "Reading sender capacity and pause state",
  done: "Finishing",
};

/**
 * Operator wording for what the server reports it is doing. It only restates reported facts: no percentage is invented,
 * and an idle or absent report says nothing about the count.
 */
export function describeInventoryProgress(progress: LaunchInventoryProgress | undefined): string | null {
  if (!progress || progress.state !== "running" || !progress.phase) return null;
  const label = PHASE_LABELS[progress.phase];
  return progress.phase === "contact_policy" && progress.total
    ? `${label}: ${(progress.evaluated ?? 0).toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")} done.`
    : `${label}.`;
}
