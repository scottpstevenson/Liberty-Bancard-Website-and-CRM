export type Observation = "not_observed" | "unavailable" | "error";
export interface SequenceRuntimeStatus {
  version: 1; asOf: string; status: "observed" | "unavailable" | "error";
  globalPause: { state: "paused" | "activating" | "unpaused" | "unavailable"; reason: string | null };
  smtp: { configured: boolean | null; enabled: Observation };
  ghl: { configured: boolean | null; enabled: Observation };
  connectivityProbe: Observation;
  verifiedDelivery: Observation;
  sequencePauseReason: "not_recorded";
}

export function runtimeConfigurationLabel(value: boolean | null | undefined): string {
  return value === true ? "configured" : value === false ? "not configured" : "unavailable";
}