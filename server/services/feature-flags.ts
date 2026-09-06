import { getCachedWizardFlagOverrideSync } from "./wizard-flag-overrides";

function envBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === "") return defaultVal;
  return val === "true" || val === "1";
}

function envInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

function dbFallbackBool(key: string, defaultVal: boolean): boolean {
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== "") {
    return envVal === "true" || envVal === "1" || envVal === "yes" || envVal === "on";
  }
  const dbOverride = getCachedWizardFlagOverrideSync(key);
  if (dbOverride !== null) return dbOverride;
  return defaultVal;
}

/** Read a tri-value string flag from env, falling back to defaultVal. */
function envEnum<T extends string>(key: string, allowed: readonly T[], defaultVal: T): T {
  const val = process.env[key];
  if (val && (allowed as readonly string[]).includes(val)) return val as T;
  return defaultVal;
}

/** Values for GHL_CRM_SYNC_MODE */
export const GHL_CRM_SYNC_MODES = ["enabled", "shadow", "disabled"] as const;
export type GhlCrmSyncMode = (typeof GHL_CRM_SYNC_MODES)[number];

/**
 * Returns the current GHL CRM write-back mode.
 *
 *   enabled  — GHL inbound sync updates Liberty (current legacy behaviour)
 *   shadow   — sync logic runs but writes go to ghl_shadow_log instead of Liberty tables
 *   disabled — every from-GHL sync function is a no-op; Liberty is the sole source of truth
 *
 * Default: 'shadow' — safe during the migration window; change to 'disabled' after
 * reviewing the shadow log and confirming no critical diffs.
 */
export function getGhlCrmSyncMode(): GhlCrmSyncMode {
  return envEnum("GHL_CRM_SYNC_MODE", GHL_CRM_SYNC_MODES, "shadow");
}

export const featureFlags = {
  get SDR_ENABLED() { return dbFallbackBool("SDR_ENABLED", true); },
  get ORCHESTRATOR_ENABLED() { return dbFallbackBool("ORCHESTRATOR_ENABLED", false); },
  get LEGACY_OUTREACH_ENABLED() { return dbFallbackBool("LEGACY_OUTREACH_ENABLED", false); },
  get SUNBIZ_ENRICHMENT_ENABLED() { return dbFallbackBool("SUNBIZ_ENRICHMENT_ENABLED", false); },
  get VOICE_AI_ENABLED() { return dbFallbackBool("VOICE_AI_ENABLED", false); },
  get SMS_ENABLED() { return dbFallbackBool("SMS_ENABLED", false); },
  get RINGLESS_VM_ENABLED() { return dbFallbackBool("RINGLESS_VM_ENABLED", false); },
  get NIGHTLY_DISCOVERY_ENABLED() { return dbFallbackBool("NIGHTLY_DISCOVERY_ENABLED", false); },
  get ORCHESTRATOR_BATCH_SIZE() { return Math.min(500, Math.max(1, envInt("ORCHESTRATOR_BATCH_SIZE", 25))); },
  get ORCHESTRATOR_REVIEW_MODE() { return envBool("ORCHESTRATOR_REVIEW_MODE", false); },
};

export function getAllFlags(): Record<string, boolean | number | string> {
  return {
    SDR_ENABLED: featureFlags.SDR_ENABLED,
    GHL_CRM_SYNC_MODE: getGhlCrmSyncMode(),
    ORCHESTRATOR_ENABLED: featureFlags.ORCHESTRATOR_ENABLED,
    LEGACY_OUTREACH_ENABLED: featureFlags.LEGACY_OUTREACH_ENABLED,
    SUNBIZ_ENRICHMENT_ENABLED: featureFlags.SUNBIZ_ENRICHMENT_ENABLED,
    VOICE_AI_ENABLED: featureFlags.VOICE_AI_ENABLED,
    SMS_ENABLED: featureFlags.SMS_ENABLED,
    RINGLESS_VM_ENABLED: featureFlags.RINGLESS_VM_ENABLED,
    NIGHTLY_DISCOVERY_ENABLED: featureFlags.NIGHTLY_DISCOVERY_ENABLED,
    ORCHESTRATOR_BATCH_SIZE: featureFlags.ORCHESTRATOR_BATCH_SIZE,
    ORCHESTRATOR_REVIEW_MODE: featureFlags.ORCHESTRATOR_REVIEW_MODE,
  };
}
