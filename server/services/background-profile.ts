/**
 * background-profile.ts
 *
 * Controls which background workers and schedulers are active.
 * Read from the BACKGROUND_JOB_PROFILE environment variable.
 *
 * CRITICAL: Absent or invalid → "off" (fail-closed).
 * Enabling "full" always requires an explicit env-var change.
 * Never start any worker unless this is explicitly set to "core" or "full".
 */

export type BackgroundProfile = "off" | "core" | "full";

const VALID = new Set<string>(["off", "core", "full"]);

export function getBackgroundProfile(): BackgroundProfile {
  const raw = process.env.BACKGROUND_JOB_PROFILE;
  if (!raw || !VALID.has(raw)) {
    console.error(
      JSON.stringify({
        event: "background_profile:fail_closed",
        reason: raw ? "invalid" : "missing",
        value: raw ?? null,
        resolvedTo: "off",
        ts: new Date().toISOString(),
      }),
    );
    return "off";
  }
  return raw as BackgroundProfile;
}

/**
 * Queues allowed to run in "core" profile.
 * Starts empty — populated operationally during controlled soak,
 * one worker at a time, with pool metrics captured before and after each addition.
 * Do NOT populate this in code without runtime evidence.
 */
export const CORE_QUEUE_ALLOWLIST: string[] = [];
