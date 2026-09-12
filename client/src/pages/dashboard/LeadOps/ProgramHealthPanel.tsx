/**
 * MI-08: Program Health Panel
 * Displays per-named-worker heartbeats, pipeline counts, and enrichment queue
 * depth with per-metric { value, available, stale, staleSince?, error? } signals.
 * Polls /api/lead-ops/health every 30 seconds.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, CheckCircle, AlertTriangle, Clock, XCircle, RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

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
}

interface PipelineCountsMetric {
  value: { staged: number; readyToPromote: number; promoted: number; suppressed: number; duplicates: number } | null;
  available: boolean;
  stale: boolean;
  error?: string;
}

interface FreeEnrichQueueDepth {
  free: number;
  paid: number;
}

interface LeadOpsHealth {
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
  workerHeartbeats?: Record<string, WorkerHeartbeat>;
  pipelineCounts?: PipelineCountsMetric;
  freeEnrichQueueDepth?: FreeEnrichQueueDepth;
  apolloDailySpend?: MetricCell;
  outscraperDailySpend?: MetricCell;
  serperDailySpend?: MetricCell;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKER_LABELS: Record<string, string> = {
  enrichment:     "Enrichment Queue",
  stager:         "Stager Worker (BullMQ)",
  ghlSync:        "GHL Sync",
  sequenceWorker: "Sequence Enrollment",
  slaWorker:      "SLA Checks",
};

function WorkerStatusBadge({ hb }: { hb: WorkerHeartbeat }) {
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

export function ProgramHealthPanel() {
  const healthQuery = useQuery<LeadOpsHealth>({
    queryKey: ["/api/lead-ops/health"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/health", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const h = healthQuery.data;

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
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Failed to load health data. {healthQuery.error instanceof Error ? healthQuery.error.message : ""}
        </CardContent>
      </Card>
    );
  }

  const workerKeys = Object.keys(h?.workerHeartbeats ?? {});

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold">Program Health</h2>
            <p className="text-xs text-muted-foreground">Live counters — refreshes every 30 s</p>
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

      {/* ── Per-named-worker heartbeats ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Worker Heartbeats</CardTitle>
          <CardDescription className="text-xs">
            Per-named-worker last completion time. Stale = no completion in last 30 minutes.
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
        </CardContent>
      </Card>

      {/* ── Pipeline counts ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pipeline Counts</CardTitle>
          <CardDescription className="text-xs">
            Live counts from master_leads staging table.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {h?.pipelineCounts?.available && h.pipelineCounts.value ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Staged", value: h.pipelineCounts.value.staged, color: "text-blue-700" },
                { label: "Ready", value: h.pipelineCounts.value.readyToPromote, color: "text-green-700" },
                { label: "Promoted", value: h.pipelineCounts.value.promoted, color: "text-emerald-700" },
                { label: "Suppressed", value: h.pipelineCounts.value.suppressed, color: "text-red-700" },
                { label: "Duplicates", value: h.pipelineCounts.value.duplicates, color: "text-amber-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-md border bg-muted/10 px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                  <div className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <XCircle className="h-4 w-4" />
              {h?.pipelineCounts?.error ?? "Pipeline counts unavailable"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Enrichment queue depth ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Enrichment Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <MetricDisplay
               label="Free Enrich Queue"
               cell={h?.freeEnrichQueueDepth?.free != null
                 ? { ...(h.freeEnrichQueueDepth.free as any), stale: false }
                 : null}
              unit=" pending"
            />
            <MetricDisplay
               label="Paid Enrich Queue"
               cell={h?.freeEnrichQueueDepth?.paid != null
                 ? { ...(h.freeEnrichQueueDepth.paid as any), stale: false }
                 : null}
              unit=" pending"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Enrichment throughput ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Enrichment Throughput (24 h)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Enriched Today", cell: h?.enrichedToday },
              { label: "Emails Found", cell: h?.emailsToday },
              { label: "Phones Found", cell: h?.phonesToday },
              { label: "Total Enriched", cell: h?.totalEnriched },
              { label: "Total Failed", cell: h?.totalFailed },
              { label: "Success Rate", cell: h?.successRate },
            ].map(({ label, cell }) => (
              <MetricDisplay key={label} label={label} cell={cell} unit={label === "Success Rate" ? "%" : ""} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Provider spend ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Provider Spend (24 h)</CardTitle>
          <CardDescription className="text-xs">
            From cro03c_stage_operations. Shows unknown when pricing data is unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
             {[
               { label: "Apollo", cell: h?.apolloDailySpend },
               { label: "Outscraper", cell: h?.outscraperDailySpend },
               { label: "Serper", cell: h?.serperDailySpend },
             ].map(({ label, cell }) => (
               <div key={label} className="rounded-md border bg-muted/10 px-3 py-2">
                 <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                 <div className="text-sm font-medium">
                   {/* available:true + value:0 → "$0.0000" (no spend today, not failed)
                       available:false or null → "unknown" (query failed) */}
                   {cell?.available && typeof cell.value === "number"
                     ? `$${(cell.value / 1_000_000).toFixed(4)}`
                     : "unknown"}
                 </div>
               </div>
             ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
