export interface LifecycleStageEntry {
  stage: string;
  label: string;
  count: number;
  stuckCount: number | null;
  stuckThresholdDays: number;
  percentOfPipeline: number;
  filterUrl: string;
}

export interface LifecycleStageCountsResponse {
  generatedAt: string;
  stages: LifecycleStageEntry[];
  totalActivePipeline: number;
  warning: string | null;
}

export interface SenderUtilizationEntry {
  senderName: string;
  sentToday: number;
  dailyLimit: number;
  utilizationPct: number;
  healthScore: number | null;
  status: string;
}

export interface OperatorSdrStatsResponse {
  generatedAt: string;
  enrolledLeads: number;
  activeSequencesByFamily: Array<{ family: string; count: number }>;
  sequencesByStatus: Array<{ status: string; count: number }>;
  sentTodayByChannel: Array<{ channel: string; count: number }>;
  senderUtilization: SenderUtilizationEntry[];
  bounceRate: number | null;
  optOutRate: number | null;
  manualCallsDueToday: number;
  blockedStepsLast24h: number;
  intentBreakdown: Array<{ intent: string; count: number }>;
  warnings: string[];
}

export interface ReadinessItem {
  key: string;
  label: string;
  status: "green" | "yellow" | "red";
  value: string;
  description: string;
  remediation: string | null;
  source: string;
}

export interface ActivationReadinessResponse {
  generatedAt: string;
  overallStatus: "green" | "yellow" | "red";
  items: ReadinessItem[];
  warnings: string[];
}
