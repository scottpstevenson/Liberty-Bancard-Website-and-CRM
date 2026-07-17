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

export const featureFlags = {
  get SDR_ENABLED() { return dbFallbackBool("SDR_ENABLED", true); },
  get ORCHESTRATOR_ENABLED() { return dbFallbackBool("ORCHESTRATOR_ENABLED", false); },
  get LEGACY_OUTREACH_ENABLED() { return dbFallbackBool("LEGACY_OUTREACH_ENABLED", false); },
  get SUNBIZ_ENRICHMENT_ENABLED() { return envBool("SUNBIZ_ENRICHMENT_ENABLED", process.env.NODE_ENV === "production"); },
  get VOICE_AI_ENABLED() { return dbFallbackBool("VOICE_AI_ENABLED", false); },
  get SMS_ENABLED() { return dbFallbackBool("SMS_ENABLED", false); },
  get RINGLESS_VM_ENABLED() { return dbFallbackBool("RINGLESS_VM_ENABLED", false); },
  get NIGHTLY_DISCOVERY_ENABLED() { return dbFallbackBool("NIGHTLY_DISCOVERY_ENABLED", false); },
  get ORCHESTRATOR_BATCH_SIZE() { return Math.min(500, Math.max(1, envInt("ORCHESTRATOR_BATCH_SIZE", 25))); },
  get ORCHESTRATOR_REVIEW_MODE() { return envBool("ORCHESTRATOR_REVIEW_MODE", false); },
};

export function getAllFlags(): Record<string, boolean | number> {
  return {
    SDR_ENABLED: featureFlags.SDR_ENABLED,
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
