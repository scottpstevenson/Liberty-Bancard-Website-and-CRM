/**
 * MI-08: Program Health Panel
 * Displays per-named-worker heartbeats, pipeline counts, and enrichment queue
 * depth with per-metric { value, available, stale, staleSince?, error? } signals.
 * Polls /api/lead-ops/health every 30 seconds.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, CheckCircle, AlertTriangle, Clock, XCircle, RefreshCw, PlayCircle, Info } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { PaidProviderControlsPanel } from "./PaidProviderControlsPanel";
import { TechnicalDetails } from "@/components/crm/TechnicalDetails";
import { CountTile, NamedDisclosure, PopulationStagesGuide } from "@/components/crm/CountContractCard";
import { asOfLabel, readCount, type CountContract } from "@/lib/count-contract";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetricCell {
  value: number | string | null;
  available: boolean;
  stale: boolean;
  staleSince?: string;
  error?: string;
}

interface WorkerHeartbeat {
  available: boolean;
  stale: boolean;
  staleSince?: string | null;
  lastFinishedAt?: string | null;
  status?: string | null;
  consecutiveFailures?: number | null;
  minutesSince?: number | null;
  error?: string;
  /** Server-derived reading that already accounts for selection and owner control. */
  interpretation?: "active" | "stale" | "failed" | "unavailable" | "not_selected_expected_idle" | "paused_by_control";
  selectedInThisProcess?: boolean;
  selectionScope?: string;
  control?: { outgoingEnabled: boolean; epoch: number } | null;
  meaning?: string;
}

interface PipelineCountsMetric {
  value: { staged: number; readyToPromote: number; promoted: number; suppressed: number; duplicates: number } | null;
  available: boolean;
  stale: boolean;
  error?: string;
}

/** Each depth carries its own availability; a failed read has value null and available false, never 0. */
interface QueueDepthCell {
  value: number | null;
  available: boolean;
  error?: string;
}

interface FreeEnrichQueueDepth {
  free: QueueDepthCell;
  paid: QueueDepthCell;
}

interface CandidateFunnel {
  staged: number;
  validationAdmitted: number;
  suppressed: number;
  stalled: number;
}

interface SchedulerStatus {
  singleProducer: string;
  legacyFenceRemoved: boolean;
  schedulerEnabled: boolean;
}

interface LeadOpsHealth {
  /** When the served snapshot was computed. The server may serve a snapshot while a refresh runs. */
  asOf?: string | null;
  // Existing fields
  enrichedToday: MetricCell;
  emailsToday: MetricCell;
  phonesToday: MetricCell;
  queueDepth: MetricCell;
  totalEnriched: MetricCell;
  totalFailed: MetricCell;
  successRate: MetricCell;
  lastEnrichedAt: string | null;
  minutesSinceLastJob: number | null;
  workerActive: boolean;
  isStale?: boolean;
  // MI-08
  workerStalenessThresholdMs?: number;
  /** Server-derived: true when the enrichment worker has exceeded the staleness threshold */
  enrichmentWorkerStaleAlert?: boolean;
  heldEnrollmentExpiry?: { heldPending: number; expiredAwaitingSweep: number; expiredTerminal: number; otherPending: number; availability: string };
  workerHeartbeats?: Record<string, WorkerHeartbeat>;
  pipelineCounts?: PipelineCountsMetric;
  freeEnrichQueueDepth?: FreeEnrichQueueDepth;
  // Correction #7: scheduler status + stuck count + candidate funnel
  freeEnrichmentSchedulerStatus?: SchedulerStatus;
  businessStuckProcessingCount?: { value: number | null; available: boolean; error?: string };
  candidateFunnel?: CandidateFunnel | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKER_LABELS: Record<string, string> = {
  enrichment:     "Enrichment Queue",
  stager:         "Stager Worker (BullMQ)",
  ghlSync:        "GHL Sync Monitor",
  sequenceWorker: "Sequence Enrollment",
  slaWorker:      "SLA Checks",
};

function WorkerStatusBadge({ hb }: { hb: WorkerHeartbeat }) {
  if (hb.interpretation === "paused_by_control") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700" aria-label="Outgoing sync paused by owner control">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        Paused by control{hb.control ? ` (outgoing off, epoch ${hb.control.epoch})` : ""}
      </span>
    );
  }
  if (hb.interpretation === "not_selected_expected_idle") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label="Not selected in this deployment; expected idle">
        <XCircle className="h-3.5 w-3.5 text-gray-400" />
        Not selected here (expected idle)
      </span>
    );
  }
  if (!hb.available) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`Worker unavailable: ${hb.error ?? "not registered"}`}>
        <XCircle className="h-3.5 w-3.5 text-gray-400" />
        {hb.error === "bullmq_only"
          ? "BullMQ-only (not monitorable here)"
          : hb.error === "audit_query_failed"
            ? "Audit unavailable"
            : "Not registered"
        }
      </span>
    );
  }
  // A failed status OR consecutive_failures > 0 means the worker's last run failed.
  // Display degraded (red) even when the heartbeat timestamp is recent — a recently
  // failed worker is NOT the same as an active worker.
  const hasFailed = hb.status === "failed" || (hb.consecutiveFailures ?? 0) > 0;
  if (hasFailed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700" aria-label={`Worker failed: ${hb.consecutiveFailures ?? "?"} consecutive failures`}>
        <XCircle className="h-3.5 w-3.5 text-red-500" />
        Failed {(hb.consecutiveFailures ?? 0) > 0 ? `(${hb.consecutiveFailures}×)` : ""}{" "}
        {hb.minutesSince !== null ? `${hb.minutesSince}m ago` : ""}
      </span>
    );
  }
  if (hb.stale) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700" aria-label={`Worker stale since ${hb.staleSince ?? "unknown"}`}>
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        Stale {hb.minutesSince !== null ? `(${hb.minutesSince}m ago)` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700" aria-label="Worker active">
      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
      Active {hb.minutesSince !== null ? `(${hb.minutesSince}m ago)` : ""}
    </span>
  );
}

function MetricDisplay({ label, cell, unit = "" }: { label: string; cell?: MetricCell | null; unit?: string }) {
  if (!cell) {
    return (
      <div className="rounded-md border bg-muted/10 px-3 py-2">
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className="text-sm font-medium text-muted-foreground">—</div>
      </div>
    );
  }
  if (!cell.available) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50/30 px-3 py-2" aria-label={`${label}: unavailable`}>
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className="text-sm font-medium text-red-500 flex items-center gap-1">
          <XCircle className="h-3 w-3" /> Unavailable
        </div>
        {cell.error && <div className="text-[10px] text-red-400 mt-0.5">{cell.error}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2">
      <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
        {label}
        {cell.stale && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-amber-600 border-amber-300" aria-label="Stale data">
            stale
          </Badge>
        )}
      </div>
      <div className="text-sm font-medium">
        {cell.value !== null && cell.value !== undefined
          ? `${typeof cell.value === "number" ? cell.value.toLocaleString() : cell.value}${unit}`
          : "—"}
      </div>
      {cell.stale && cell.staleSince && (
        <div className="text-[10px] text-amber-500 mt-0.5">
          Since {new Date(cell.staleSince).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PromotionState {
  promotionEnabled: boolean;
  runtimeOwnerReady: boolean;
  runtimeOwnerReason: string | null;
  gateOpen: boolean;
  staged: number;
  scopedStaged: number;
  unscopedStaged: number;
  validationAdmitted: number;
  note: string;
}

interface GateDiagnostics {
  deployedReleaseSha: string | null;
  deploymentIdentity: string | null;
  environmentIdentity: string | null;
  queueTopologyHash: string;
  inventory: {
    present: boolean;
    ambiguous?: boolean;
    inventoryId?: string;
    releaseShaMatch?: boolean;
    environmentMatch?: boolean;
    deploymentMatch?: boolean;
    topologyMatch?: boolean;
    workerIdentitiesInInventory?: string[];
    expectedCount?: number;
    issuedAt?: string;
    expiresAt?: string;
    expired?: boolean;
  };
  workerFleet: {
    present: boolean;
    count: number;
    identities?: string[];
    oldestHeartbeatAgeMs?: number;
    complete?: boolean;
    errorCode?: string;
    /** Unique release SHAs seen in live heartbeats */
    workerReleaseShas?: string[];
    /** true when any worker SHA differs from the API SHA — warning only, not a gate failure */
    shaWarning?: boolean;
    shaWarnings?: Array<{ apiSha: string; workerSha: string; processIdentity: string }>;
    /** Heartbeats skipped because they belong to a different generation (old topology/env/deploy/stale) */
    generationalSkips?: Array<{ reason: string; processIdentity: string; observed: string; expected: string }>;
    generationalSkipCount?: number;
  };
  attestation: {
    present: boolean;
    attestationId?: string;
    capturedAt?: string;
    expiresAt?: string;
    reason: string;
  };
  closedGateReason: string | null;
  /** Non-null when a SHA difference exists — shown as yellow warning, not a red failure */
  shaReleaseWarning?: string | null;
}

interface BackfillResult {
  examined: number;
  promoted: number;
  skipped: number;
  failed: number;
  errors: string[];
  reasons?: Record<string, number>;
}

const LEGACY_STAGING_UNITS: Record<string, string> = {
  staged: "Rows staged and not yet decided",
  readyToPromote: "Rows marked ready to promote",
  promoted: "Rows already promoted",
  suppressed: "Rows suppressed",
  duplicates: "Rows marked as duplicates",
};

/** Legacy master_leads staging totals are history: a different table and unit from the current population. */
function legacyStagingContract(key: string, asOf: string | null = null): CountContract {
  return {
    unit: "legacy master-lead staging rows",
    scope: `${LEGACY_STAGING_UNITS[key] ?? "Rows"} in the legacy master_leads staging table, all time`,
    exclusions: "Free-discovery candidates, current recipient preparation, businesses and contacts",
    asOf, completeness: "complete", authority: "Legacy master_leads staging table (lead-ops health)", temporal: "historical",
  };
}

function legacyThroughputContract(unit: string, scope: string, asOf: string | null = null): CountContract {
  return {
    unit, scope,
    exclusions: "Canonical South Florida Prospecting results, and anything outside the raw Sunbiz source",
    asOf, completeness: "complete", authority: "Legacy Sunbiz enrichment (lead-ops health)", temporal: "historical",
  };
}

export function ProgramHealthPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [backfillLimit, setBackfillLimit] = useState<number>(50);

  const healthQuery = useQuery<LeadOpsHealth>({
    queryKey: ["/api/lead-ops/health"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/health", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const promotionStateQuery = useQuery<PromotionState>({
    queryKey: ["/api/lead-ops/candidates/promotion-state"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/candidates/promotion-state", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const gateDiagnosticsQuery = useQuery<GateDiagnostics>({
    queryKey: ["/api/admin/cro03c/gate-diagnostics"],
    queryFn: async () => {
      const r = await fetch("/api/admin/cro03c/gate-diagnostics", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const backfillMutation = useMutation<BackfillResult, Error, number>({
    mutationFn: async (limit: number) => {
      const res = await apiRequest("POST", "/api/lead-ops/candidates/routine-promotion", { limit });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Backfill complete",
        description: `Examined ${data.examined} — promoted ${data.promoted}, skipped ${data.skipped}${data.failed > 0 ? `, failed ${data.failed}` : ""}.${data.reasons && Object.keys(data.reasons).length ? ` Reasons: ${Object.entries(data.reasons).map(([reason, count]) => `${reason}: ${count}`).join("; ")}` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/candidates/promotion-state"] });
    },
    onError: (err) => {
      toast({
        title: "Backfill failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const h = healthQuery.data;
  const ps = promotionStateQuery.data;

  if (healthQuery.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (healthQuery.isError) {
    return (
      <Card data-testid="program-health-unavailable">
        <CardContent className="space-y-3 pt-6 text-sm">
          <p role="alert" className="text-destructive">Program Health could not be read right now. No figures are shown, and none is treated as zero.</p>
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => void healthQuery.refetch()} disabled={healthQuery.isFetching} data-testid="program-health-retry">
            {healthQuery.isFetching ? "Retrying…" : "Retry"}
          </Button>
          <TechnicalDetails testId="program-health-technical-details" text={healthQuery.error instanceof Error ? healthQuery.error.message : null} />
        </CardContent>
      </Card>
    );
  }

  const workerKeys = Object.keys(h?.workerHeartbeats ?? {});

  // The server derives enrichmentWorkerStaleAlert with exact ms precision so the
  // client never re-implements the threshold comparison. Only the enrichment
  // worker is in scope — other workers have independent cadences.
  const alertThresholdMs = h?.workerStalenessThresholdMs ?? 10 * 60 * 1000;
  const alertThresholdMin = Math.round(alertThresholdMs / 60000);
  const enrichmentHb = h?.workerHeartbeats?.enrichment;
  const showEnrichmentStaleAlert = h?.enrichmentWorkerStaleAlert === true;

  const asOf = typeof h?.asOf === "string" ? h.asOf : null;
  const current = (unit: string, scope: string, exclusions: string, authority: string): CountContract => ({
    unit, scope, exclusions, asOf, completeness: "complete", authority, temporal: "current",
  });
  const funnel = h?.candidateFunnel ?? null;
  const CANDIDATES = "free-discovery candidates";
  const CANDIDATE_EXCLUSIONS = "Candidates in any other state; not businesses, not linked contacts and not recipients";
  const CANDIDATE_AUTHORITY = "Free-discovery candidate dispositions (lead-ops health)";
  const stuck = h?.businessStuckProcessingCount;
  const freeQueue = h?.freeEnrichQueueDepth?.free;
  const paidQueue = h?.freeEnrichQueueDepth?.paid;
  const summaryReadings = [
    { key: "staged", label: "Staged candidates",
      reading: readCount(funnel?.staged, !!funnel, current(CANDIDATES, "Candidates currently staged and not yet validated", CANDIDATE_EXCLUSIONS, CANDIDATE_AUTHORITY)) },
    { key: "admitted", label: "Admitted to validation",
      reading: readCount(funnel?.validationAdmitted, !!funnel, current(CANDIDATES, "Candidates admitted to email validation and pending the provider", `${CANDIDATE_EXCLUSIONS}; admitted to validation is not admitted to send`, CANDIDATE_AUTHORITY)) },
    { key: "suppressed", label: "Suppressed candidates",
      reading: readCount(funnel?.suppressed, !!funnel, current(CANDIDATES, "Candidates suppressed and kept out of the pipeline", CANDIDATE_EXCLUSIONS, CANDIDATE_AUTHORITY)) },
    { key: "stalled", label: "Stalled candidates",
      reading: readCount(funnel?.stalled, !!funnel, current(CANDIDATES, "Candidates whose generation crashed before finishing", CANDIDATE_EXCLUSIONS, CANDIDATE_AUTHORITY)) },
    { key: "stuck", label: "Businesses stuck in processing",
      reading: readCount(stuck?.value, stuck?.available, current("businesses", "Businesses locked in free-enrichment 'processing' right now; the reaper recovers them every 15 minutes", "Businesses that finished, failed or are waiting", "Business free-enrichment status (lead-ops health)")) },
    { key: "free-queue", label: "Free enrichment queue",
      reading: readCount(freeQueue?.value, freeQueue?.available, current("queued jobs", "Canonical free-enrichment jobs waiting right now", "Paid-provider jobs and jobs already running", "Enrichment queue depth (lead-ops health)")) },
    { key: "paid-queue", label: "Paid enrichment queue",
      reading: readCount(paidQueue?.value, paidQueue?.available, current("queued jobs", "Paid-provider enrichment jobs waiting right now", "Free jobs and jobs already running", "Enrichment queue depth (lead-ops health)")) },
  ] as const;
  const unavailableSources = [
    ...summaryReadings.filter(r => r.reading.availability === "unavailable").map(r => r.label.toLowerCase()),
    ...(h?.pipelineCounts?.available ? [] : ["legacy master-lead staging counts"]),
    ...(["enrichedToday", "emailsToday", "phonesToday", "totalEnriched", "totalFailed", "successRate"] as const)
      .some(k => !h?.[k]?.available) ? ["legacy Sunbiz throughput"] : [],
  ];
  const legacyThroughput = [
    { label: "Source entities enriched today (raw Sunbiz)", cell: h?.enrichedToday, unit: "raw Sunbiz source entities", scope: "Enriched in the last 24 hours", suffix: undefined },
    { label: "Emails Found", cell: h?.emailsToday, unit: "emails found on raw Sunbiz entities", scope: "Found in the last 24 hours", suffix: undefined },
    { label: "Phones Found", cell: h?.phonesToday, unit: "phones found on raw Sunbiz entities", scope: "Found in the last 24 hours", suffix: undefined },
    { label: "Total Enriched", cell: h?.totalEnriched, unit: "raw Sunbiz source entities", scope: "Enriched, all time", suffix: undefined },
    { label: "Total Failed", cell: h?.totalFailed, unit: "raw Sunbiz source entities", scope: "Failed, all time", suffix: undefined },
    { label: "Success Rate", cell: h?.successRate, unit: "percent of finished entities", scope: "Enriched divided by enriched plus failed, all time", suffix: "%" },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold">Program Health</h2>
            <p className="text-xs text-muted-foreground" data-testid="program-health-asof">Refreshes every 30 s · {asOfLabel(asOf)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {h?.isStale && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs" aria-label="Showing stale cached data">
              <Clock className="h-3 w-3 mr-1" /> Stale cache
            </Badge>
          )}
          <Button
            size="sm" variant="outline" className="h-7 gap-1.5"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/health"] })}
            disabled={healthQuery.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${healthQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Enrichment worker stale alert banner ─────────────────────────── */}
      {showEnrichmentStaleAlert && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">
              Enrichment worker silent for over {alertThresholdMin} minutes
            </p>
            {enrichmentHb?.minutesSince !== null && enrichmentHb?.minutesSince !== undefined && (
              <p className="mt-0.5 text-xs text-amber-700">
                Last heartbeat {enrichmentHb.minutesSince}m ago — the enrichment queue may have stalled.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Current operator summary: the one place to start ─────────────── */}
      <Card data-testid="program-health-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Current summary</CardTitle>
          <CardDescription className="text-xs">
            Each figure opens to its unit, scope, exclusions, read time and authority. These are different populations, so they are not added together and are not expected to match. {asOfLabel(asOf)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unavailableSources.length > 0 ? (
            <p role="status" className="text-xs text-red-700" data-testid="summary-unavailable-sources">
              Not read, so nothing is shown for them and none is treated as zero: {unavailableSources.join(", ")}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="summary-sources-ok">Every count source on this page answered.</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="summary-counts">
            {summaryReadings.map(({ key, label, reading }) => <CountTile key={key} label={label} reading={reading} testId={`summary-${key}`} />)}
          </div>
          <details className="rounded-md border p-3 text-sm" data-testid="summary-populations">
            <summary className="cursor-pointer select-none font-medium">
              Eight populations: discovered, linked, classified, selected, validated, prepared-held, admitted, sent
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              Each word has its own unit and its own screen. A card opens the exact population that owns the number.
            </p>
            <PopulationStagesGuide />
          </details>
        </CardContent>
      </Card>
      {/* ── Promotion gate and admin backfill ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Routine SFP Candidate Promotion</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                The promotion gate and the admin backfill. The candidate counts (staged, admitted, suppressed, stalled) and businesses stuck in processing are in the Current summary above, each with its own unit and scope.
              </CardDescription>
            </div>
            {/* Gate status badge reflects the feature flag and durable runtime owner. */}
            {ps && (
              ps.gateOpen ? (
                <Badge className="shrink-0 bg-green-100 text-green-800 border-green-300 hover:bg-green-100" variant="outline">
                  <CheckCircle className="h-3 w-3 mr-1" /> Gate open
                </Badge>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge
                    className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100 cursor-help"
                    variant="outline"
                    title={ps.note}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    {ps.promotionEnabled && !ps.runtimeOwnerReady ? "Owner unavailable" : "Gate closed"}
                  </Badge>
                </div>
              )
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Promotion state note (a separate read from the candidate counts) */}
          {ps && <p className="text-xs text-muted-foreground">
            {ps.note} Scoped staged: {ps.scopedStaged?.toLocaleString() ?? "Unknown"}; outside current scope: {ps.unscopedStaged?.toLocaleString() ?? "Unknown"}.
          </p>}
          {(
            <div className="grid grid-cols-1 gap-3">
              {/* Staged tile — includes backfill controls */}
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-0.5">Promote staged candidates</div>
                <div className="text-xs text-muted-foreground">Admin only; limited by the gate. The staged count is in the Current summary.</div>
                {/* Backfill controls — admin only */}
                {isAdmin && (
                  <>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        value={backfillLimit}
                        onChange={(e) => setBackfillLimit(Math.min(200, Math.max(1, Math.floor(Number(e.target.value)) || 50)))}
                        className="h-6 w-16 text-xs px-1.5 py-0"
                        aria-label="Backfill limit"
                        disabled={backfillMutation.isPending}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2 gap-1"
                        disabled={backfillMutation.isPending || !ps?.gateOpen}
                        title={!ps?.gateOpen ? (ps?.promotionEnabled ? `Durable runtime owner unavailable: ${ps.runtimeOwnerReason ?? "identity not ready"}` : "Gate is closed — enable FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED first") : `Promote up to ${backfillLimit} staged candidates`}
                        onClick={() => backfillMutation.mutate(backfillLimit)}
                      >
                        {backfillMutation.isPending
                          ? <><RefreshCw className="h-3 w-3 animate-spin" /> Running…</>
                          : <><PlayCircle className="h-3 w-3" /> Promote</>
                        }
                      </Button>
                    </div>
                    {!ps?.gateOpen && (
                      <p className="mt-1 text-[10px] text-red-500">
                        {ps?.promotionEnabled && !ps?.runtimeOwnerReady
                          ? "Runtime owner unavailable"
                          : "Gate closed"}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* ── Per-named-worker heartbeats ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Worker Heartbeats</CardTitle>
          <CardDescription className="text-xs">
            Per-named-worker last completion time (30-minute freshness) read with this deployment's worker selection and the owner's sync control. A GHL monitor tick is not evidence of sync writes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workerKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No worker heartbeat data available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {workerKeys.map((key) => {
                const hb = h!.workerHeartbeats![key];
                return (
                  <div key={key} className="rounded-md border bg-muted/10 px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      {WORKER_LABELS[key] ?? key}
                    </div>
                    <WorkerStatusBadge hb={hb} />
                    {hb.available && hb.lastFinishedAt && (
                      <div className="text-[10px] text-muted-foreground mt-1 truncate">
                        Last: {new Date(hb.lastFinishedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {h?.heldEnrollmentExpiry && (
            <div className="mt-3 rounded-md border bg-muted/10 px-3 py-2 text-xs text-muted-foreground" data-testid="text-held-enrollment-expiry">
              {h.heldEnrollmentExpiry.availability === "available"
                ? `Held GHL enrollments: ${h.heldEnrollmentExpiry.heldPending} waiting for configuration, ${h.heldEnrollmentExpiry.expiredAwaitingSweep} expired and awaiting the next non-sending sweep, ${h.heldEnrollmentExpiry.expiredTerminal} closed as expired.`
                : "Held GHL enrollment expiry could not be read."}
            </div>
          )}
        </CardContent>
      </Card>

      <NamedDisclosure testId="disclosure-historical-counts" title="Historical and raw counts"
        summary="Legacy master-lead staging and raw Sunbiz throughput. Reference only; not the current population.">
      {/* ── Legacy master-lead staging counts (historical) ─────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Legacy Master-Lead Staging Counts</CardTitle>
          <CardDescription className="text-xs">
            Historical totals from the legacy master_leads staging table. They are not the current South Florida population and are not expected to match it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="legacy-pipeline-counts">
            {([
              ["Staged", "staged", "text-blue-700"], ["Ready", "readyToPromote", "text-green-700"], ["Promoted", "promoted", "text-emerald-700"],
              ["Suppressed", "suppressed", "text-red-700"], ["Duplicates", "duplicates", "text-amber-700"],
            ] as const).map(([label, key, color]) => (
              <CountTile key={key} label={label} testId={`legacy-pipeline-${key}`} tone={color}
                reading={readCount(h?.pipelineCounts?.value?.[key], h?.pipelineCounts?.available, legacyStagingContract(key, asOf))} />
            ))}
          </div>
          {!h?.pipelineCounts?.available && (
            <div role="status" className="mt-2 space-y-1 text-xs text-red-600" data-testid="legacy-pipeline-unavailable">
              <p>Pipeline counts unavailable: not read, so no figure is shown.</p>
              <TechnicalDetails testId="legacy-pipeline-technical-details" text={h?.pipelineCounts?.error ?? null} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Legacy Sunbiz enrichment throughput (reference) ───────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Legacy Sunbiz Enrichment Throughput (24 h, reference)</CardTitle>
          <CardDescription className="text-xs">
            Unit: raw Sunbiz source entities and their contacts, last 24 hours. This is supplemental legacy evidence, not the current
            South Florida Prospecting count; current canonical status and backlog are on the Canonical Enrichment page. An unavailable
            value means the query could not be read, not zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="legacy-throughput-counts">
            {legacyThroughput.map(({ label, cell, unit, scope, suffix }) => (
              <CountTile key={label} label={label} suffix={suffix} testId={`legacy-throughput-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                reading={readCount(typeof cell?.value === "number" ? cell.value : null, cell?.available, legacyThroughputContract(unit, scope, asOf))} />
            ))}
          </div>
        </CardContent>
      </Card>
      </NamedDisclosure>
      <NamedDisclosure testId="disclosure-provider-diagnostics" title="Scheduler and provider-gate diagnostics"
        summary="Producer and scheduler status, plus the administrator provider-gate checks. Diagnostics, not counts.">
      {/* ── Scheduler status (Correction #3) ────────────────────────────── */}
      {h?.freeEnrichmentSchedulerStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Free Enrichment Scheduler</CardTitle>
            <CardDescription className="text-xs">
              Single-producer design — only the BullMQ repeatable lane enqueues businesses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-0.5">Producer</div>
                <div className="text-xs font-mono font-medium truncate">
                  {h.freeEnrichmentSchedulerStatus.singleProducer}
                </div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-0.5">Legacy fence</div>
                <span className={`inline-flex items-center gap-1 text-xs ${h.freeEnrichmentSchedulerStatus.legacyFenceRemoved ? "text-green-700" : "text-amber-700"}`}>
                  {h.freeEnrichmentSchedulerStatus.legacyFenceRemoved
                    ? <><CheckCircle className="h-3 w-3 text-green-500" /> Removed</>
                    : <><AlertTriangle className="h-3 w-3 text-amber-500" /> Active (dual-producer risk)</>
                  }
                </span>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-0.5">Scheduler</div>
                <span className={`inline-flex items-center gap-1 text-xs ${h.freeEnrichmentSchedulerStatus.schedulerEnabled ? "text-green-700" : "text-muted-foreground"}`}>
                  {h.freeEnrichmentSchedulerStatus.schedulerEnabled
                    ? <><CheckCircle className="h-3 w-3 text-green-500" /> Enabled</>
                    : "Disabled"
                  }
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}


      {/* ── CRO-03C Readiness diagnostics (admin only) ───────────────────── */}
      {isAdmin && (() => {
        const diag = gateDiagnosticsQuery.data;
        if (!diag && gateDiagnosticsQuery.isLoading) {
          return (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">CRO-03C Readiness</CardTitle></CardHeader>
              <CardContent><Skeleton className="h-16 w-full" /></CardContent>
            </Card>
          );
        }
        if (!diag) return null;

        const apiShaOk = !!diag.deployedReleaseSha && /^[0-9a-f]{40}$/i.test(diag.deployedReleaseSha);
        const workerReleaseSha = diag.workerFleet.workerReleaseShas?.[0] ?? null;
        const shasDiffer = diag.workerFleet.shaWarning === true;

        // Hard-gate checks (red = blocked)
        const checks: Array<{ label: string; pass: boolean; warn?: boolean; detail?: string }> = [
          {
            label: "Live worker heartbeat",
            pass: diag.workerFleet.present && (diag.workerFleet.complete ?? false),
            detail: diag.workerFleet.present
              ? `${diag.workerFleet.count} worker(s)${diag.workerFleet.oldestHeartbeatAgeMs !== undefined ? `, ${Math.round(diag.workerFleet.oldestHeartbeatAgeMs / 1000)}s ago` : ""}`
              : (diag.workerFleet.errorCode ?? "none found — start worker process"),
          },
          {
            label: "Environment identity",
            pass: !!diag.environmentIdentity,
            detail: diag.environmentIdentity ?? "unknown",
          },
          {
            label: "Worker fleet complete",
            pass: diag.workerFleet.present && (diag.workerFleet.complete ?? false),
            detail: diag.workerFleet.complete ? `${diag.workerFleet.count} worker(s) confirmed` : "scan incomplete",
          },
          {
            label: "Queue topology compat.",
            pass: diag.inventory.topologyMatch !== false,
            detail: diag.inventory.topologyMatch === false ? "topology hash mismatch" : (diag.queueTopologyHash.slice(0, 12) + "…"),
          },
          {
            label: "Capability manifest",
            pass: diag.inventory.present && !diag.inventory.expired,
            detail: diag.inventory.present ? (diag.inventory.expired ? "expired" : "present") : "missing",
          },
          {
            label: "API release SHA",
            pass: apiShaOk,
            detail: diag.deployedReleaseSha ? diag.deployedReleaseSha.slice(0, 12) + "…" : "missing",
          },
          {
            label: "Worker release SHA",
            // SHA equality is diagnostic — mark as pass, use warn=shasDiffer for yellow
            pass: diag.workerFleet.present,
            warn: shasDiffer,
            detail: workerReleaseSha
              ? (shasDiffer ? `${workerReleaseSha.slice(0, 12)}… (differs from API)` : `${workerReleaseSha.slice(0, 12)}… (matches)`)
              : (diag.workerFleet.present ? "checking…" : "no heartbeat"),
          },
          {
            label: "SHA equality",
            pass: true,  // never a hard gate
            warn: shasDiffer,
            detail: shasDiffer ? "SHA differs — diagnostic only" : "matches",
          },
          {
            label: "Deployment inventory",
            pass: diag.inventory.present && !diag.inventory.ambiguous && !diag.inventory.expired,
            detail: diag.inventory.ambiguous ? "ambiguous — run convergence" : diag.inventory.present ? (diag.inventory.expired ? "expired" : `issued ${diag.inventory.issuedAt ? new Date(diag.inventory.issuedAt).toLocaleTimeString() : "?"}`) : "missing — issue attestation",
          },
          {
            label: "Runtime attestation",
            pass: diag.attestation.present,
            detail: diag.attestation.present
              ? `expires ${new Date(diag.attestation.expiresAt!).toLocaleTimeString()}`
              : diag.closedGateReason ?? "missing",
          },
          {
            label: "Provider admission",
            pass: diag.attestation.present && diag.inventory.present && diag.workerFleet.present,
            detail: diag.closedGateReason ? `Blocked: ${diag.closedGateReason}` : "Gate open",
          },
        ];

        const hardFails = checks.filter((c) => !c.pass && !c.warn);
        const warnings = checks.filter((c) => c.warn);
        const allPass = hardFails.length === 0;

        return (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">CRO-03C Readiness</CardTitle>
                  <CardDescription className="text-xs mt-0.5">Separate certificate-governed CRO-03C lane. These checks do not authorize or block routine SFP. SHA equality is diagnostic.</CardDescription>
                </div>
                {allPass ? (
                  warnings.length > 0 ? (
                    <Badge className="shrink-0 bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100" variant="outline">
                      <AlertTriangle className="h-3 w-3 mr-1" /> SHA differs (warning)
                    </Badge>
                  ) : (
                    <Badge className="shrink-0 bg-green-100 text-green-800 border-green-300 hover:bg-green-100" variant="outline">
                      <CheckCircle className="h-3 w-3 mr-1" /> All checks pass
                    </Badge>
                  )
                ) : (
                  <Badge className="shrink-0 bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100" variant="outline">
                    <AlertTriangle className="h-3 w-3 mr-1" /> {diag.closedGateReason ?? "Checks failing"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {diag.shaReleaseWarning && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50/60 px-3 py-2 text-xs text-yellow-800">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-600" />
                  <span>{diag.shaReleaseWarning} — This is expected after a new publish. Workers adopt the new SHA on restart.</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {checks.map((c) => {
                  const isWarnOnly = c.warn && c.pass;
                  const isFail = !c.pass;
                  const bg = isWarnOnly ? "bg-yellow-50/60 border-yellow-200" : isFail ? "bg-amber-50/60 border-amber-200" : "bg-muted/10";
                  const textColor = isWarnOnly ? "text-yellow-700" : isFail ? "text-amber-700" : "text-green-700";
                  const Icon = isWarnOnly ? AlertTriangle : isFail ? AlertTriangle : CheckCircle;
                  const iconColor = isWarnOnly ? "text-yellow-500" : isFail ? "text-amber-500" : "text-green-500";
                  return (
                    <div key={c.label} className={`rounded-md border px-3 py-2 ${bg}`}>
                      <div className="text-xs text-muted-foreground mb-0.5">{c.label}</div>
                      <span className={`inline-flex items-center gap-1 text-xs ${textColor}`}>
                        <Icon className={`h-3 w-3 ${iconColor}`} />
                        {isWarnOnly ? "Warn" : c.pass ? "OK" : "Fail"}
                      </span>
                      {c.detail && <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={c.detail}>{c.detail}</div>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      </NamedDisclosure>
      {/* Paid provider controls and emergency stop (relocated from the retired pilot panel) */}
      <PaidProviderControlsPanel />
    </div>
  );
}
