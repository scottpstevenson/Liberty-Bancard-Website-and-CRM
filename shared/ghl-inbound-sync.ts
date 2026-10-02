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
  environment: "production" | "development";
  configured: boolean;
  inboundEnabled: boolean;
  outboundPaused: boolean | null;
  run: GhlInboundSyncRun | null;
}