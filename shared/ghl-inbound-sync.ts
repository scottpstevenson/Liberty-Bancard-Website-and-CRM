/** One-way contact reconciliation. These contracts authorize no provider writes. */
export type GhlInboundSyncState = "previewing" | "ready" | "running" | "complete" | "blocked" | "failed";
export interface GhlInboundSyncCounts {
  scanned: number;
  matched: number;
  wouldUpdate: number;
  wouldCreate: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  updated: number;
  created: number;
}
export interface GhlInboundSyncRun {
  runId: string;
  state: GhlInboundSyncState;
  createdAt: string;
  updatedAt: string;
  counts: GhlInboundSyncCounts;
  previewHash: string | null;
  nextAction: "scan" | "apply" | null;
  lastError: string | null;
  /** Non-sensitive operational reasons; never raw provider contact payloads. */
  issues: Array<{ ghlContactId: string | null; reason: string }>;
}
export interface GhlInboundSyncStatus {
  runtime?: {
    asOf: string; mode: "manual_request" | "webhook" | "not_observed";
    owner: "lease_observed" | "lease_expired" | "not_observed";
    checkpoint: { phase: "read" | "plan"; pages: number; planned: number; applied: number } | null;
    lastUpdatedAt: string | null;
    backlog: "unavailable";
    heartbeat: "not_observed";
    connectionProbe: "not_observed";
    freshness: "not_observed" | "current" | "stale";
    freshnessThresholdMs: number;
  };
  environment: "production" | "development";
  configured: boolean;
  inboundEnabled: boolean;
  outboundPaused: boolean | null;
  run: GhlInboundSyncRun | null;
}