import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  // Note: Select components retained for run filter controls below
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Play, Pause, Download, BarChart3, Eye, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface CensusRun {
  id: string;
  environment_label: string;
  rules_version: string;
  release_sha: string;
  db_identity_token: string;
  requested_by: string;
  status: string;
  pause_reason: string | null;
  denominator_at_start: number | null;
  total_processed: number | null;
  total_excluded: number | null;
  provider_call_count: number;
  completed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  lane_counts: Record<string, number> | null;
  dimension_counts: Record<string, Record<string, number>> | null;
  is_active: boolean;
  pool_metrics_before: { totalCount: number; idleCount: number; waitingCount: number; at: string } | null;
  pool_metrics_during: { totalCount: number; idleCount: number; waitingCount: number; at: string } | null;
  pool_metrics_after: { totalCount: number; idleCount: number; waitingCount: number; at: string } | null;
}

interface Preview {
  totalActive: number;
  totalArchived: number;
  byRecordClass: Record<string, number>;
  byContactability: Record<string, number>;
  byEmailStatus: Record<string, number>;
  sharedPhoneContactCount: number;
  sharedPhoneDistinctValues: number;
  businessRows: number;
  poolMetrics: { totalCount: number; idleCount: number; waitingCount: number };
}

// ──────────────────────────────────────────────────────────────────────────────
// Environment badge
// ──────────────────────────────────────────────────────────────────────────────
function EnvBadge({ label }: { label: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    development_preview: { label: "Development Preview", variant: "secondary" },
    production_readonly_preview: { label: "Production Read-Only Preview", variant: "default" },
    frozen_production_snapshot: { label: "Frozen Production Snapshot", variant: "default" },
  };
  const info = map[label] ?? { label: label, variant: "secondary" as const };
  return (
    <Badge
      variant={info.variant}
      className={
        label === "frozen_production_snapshot"
          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
          : label === "production_readonly_preview"
          ? "bg-blue-100 text-blue-800 border-blue-300"
          : "bg-gray-100 text-gray-700 border-gray-300"
      }
    >
      {info.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    running: "bg-blue-100 text-blue-800 animate-pulse",
    paused: "bg-yellow-100 text-yellow-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-600",
    pending: "bg-gray-100 text-gray-600",
  };
  return <Badge className={map[status] ?? "bg-gray-100 text-gray-600"}>{status}</Badge>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Preview card
// ──────────────────────────────────────────────────────────────────────────────
function PreviewCard() {
  const { data, isLoading, refetch } = useQuery<Preview>({
    queryKey: ["/api/admin/census/preview"],
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Contact Inventory Preview</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {!data && isLoading ? (
          <p className="text-sm text-muted-foreground">Loading preview...</p>
        ) : data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile label="Active Contacts" value={data.totalActive.toLocaleString()} />
            <Tile label="Archived" value={data.totalArchived.toLocaleString()} />
            <Tile label="Shared-Phone Contacts" value={data.sharedPhoneContactCount.toLocaleString()} />
            <Tile label="Business Rows" value={data.businessRows.toLocaleString()} />
            <Tile label="Email + Phone" value={(data.byContactability.email_and_phone ?? 0).toLocaleString()} />
            <Tile label="Email Only" value={(data.byContactability.email_only ?? 0).toLocaleString()} />
            <Tile label="Phone Only" value={(data.byContactability.phone_only ?? 0).toLocaleString()} />
            <Tile label="No Channel" value={(data.byContactability.no_usable_channel ?? 0).toLocaleString()} />
            <Tile
              label="Pool (idle/total/waiting)"
              value={`${data.poolMetrics.idleCount}/${data.poolMetrics.totalCount}/${data.poolMetrics.waitingCount}`}
              warn={data.poolMetrics.waitingCount > 0}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${warn ? "text-red-700" : ""}`}>{value}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Start-run form
// ──────────────────────────────────────────────────────────────────────────────
function StartRunPanel({ onStarted }: { onStarted: (runId: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Environment label is derived server-side — the server reads NODE_ENV + RELEASE_SHA.
  // We fetch it here only to display it; the client never sends it.
  const { data: envData } = useQuery<{ environmentLabel: string }>({
    queryKey: ["/api/admin/census/environment"],
    staleTime: 60_000,
  });

  const startMutation = useMutation({
    // No body needed — server derives environment label from runtime config
    mutationFn: () => apiRequest("POST", "/api/admin/census/runs", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Census run started", description: `Run ID: ${data.runId.slice(0, 8)}…` });
      qc.invalidateQueries({ queryKey: ["/api/admin/census/runs"] });
      onStarted(data.runId);
    },
    onError: (err: any) => {
      toast({ title: "Failed to start run", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Play className="h-4 w-4" /> Start Census Run
        </CardTitle>
        <CardDescription>
          Admin-triggered only. BACKGROUND_JOB_PROFILE must be <code>off</code>.
          No canonical records are mutated. Environment label is determined by
          server configuration (NODE_ENV + RELEASE_SHA).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3 items-center">
        {envData && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium">Environment:</span>
            <EnvBadge label={envData.environmentLabel} />
          </div>
        )}
        <Button
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          className="gap-2 ml-auto"
        >
          <Play className="h-4 w-4" />
          {startMutation.isPending ? "Starting…" : "Start Census"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Runs list
// ──────────────────────────────────────────────────────────────────────────────
function RunsList({ selectedRunId, onSelect }: { selectedRunId: string | null; onSelect: (id: string) => void }) {
  const { data, isLoading } = useQuery<{ runs: CensusRun[]; total: number }>({
    queryKey: ["/api/admin/census/runs"],
    refetchInterval: 5_000, // poll while runs are active
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">Loading runs…</p>;
  if (!data?.runs.length) return <p className="text-sm text-muted-foreground py-4">No census runs yet.</p>;

  return (
    <div className="space-y-2">
      {data.runs.map((run) => (
        <div
          key={run.id}
          className={`rounded-lg border p-3 cursor-pointer transition-colors ${
            selectedRunId === run.id ? "border-primary bg-primary/5" : "border-gray-200 hover:bg-gray-50"
          }`}
          onClick={() => onSelect(run.id)}
        >
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={run.status} />
                <EnvBadge label={run.environment_label} />
                <span className="text-xs text-muted-foreground">v{run.rules_version}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(run.created_at).toLocaleString()} · {run.requested_by}
              </p>
              {run.denominator_at_start && (
                <p className="text-xs mt-0.5">
                  {run.total_processed?.toLocaleString() ?? "—"} / {run.denominator_at_start.toLocaleString()} contacts
                </p>
              )}
            </div>
            <code className="text-xs text-muted-foreground shrink-0">{run.id.slice(0, 8)}…</code>
          </div>
          {run.failure_reason && (
            <p className="text-xs text-red-600 mt-1">{run.failure_reason}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Run detail panel
// ──────────────────────────────────────────────────────────────────────────────
function RunDetail({ runId }: { runId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: run, isLoading } = useQuery<CensusRun>({
    queryKey: [`/api/admin/census/runs/${runId}`],
    refetchInterval: (query) => query.state.data?.status === "running" ? 3_000 : false,
  });

  const { data: dimensions } = useQuery({
    queryKey: [`/api/admin/census/runs/${runId}/dimensions`],
    enabled: !!run && ["completed", "paused", "failed"].includes(run.status),
  });

  const { data: reconciliation } = useQuery({
    queryKey: [`/api/admin/census/runs/${runId}/reconciliation`],
    enabled: !!run && run.status !== "pending",
  });

  const { data: laneData } = useQuery<{ primary_lane: string; count: string }[]>({
    queryKey: [`/api/admin/census/runs/${runId}/lanes`],
    enabled: !!run && run.status !== "pending",
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/census/runs/${runId}/pause`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/admin/census/runs/${runId}`] }); },
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/census/runs/${runId}/resume`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/admin/census/runs/${runId}`] }); },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/census/runs/${runId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/census/runs"] });
      qc.invalidateQueries({ queryKey: [`/api/admin/census/runs/${runId}`] });
      toast({ title: "Run cancelled" });
    },
  });

  if (isLoading || !run) return <p className="text-sm text-muted-foreground py-4">Loading run details…</p>;

  const recon = reconciliation as any;
  const dimData = dimensions as any;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={run.status} />
            <EnvBadge label={run.environment_label} />
          </div>
          <p className="text-xs text-muted-foreground">
            Run {run.id.slice(0, 8)}… · v{run.rules_version} · SHA {run.release_sha.slice(0, 8)} · DB token {run.db_identity_token}
          </p>
          <p className="text-xs text-muted-foreground">
            Started {new Date(run.created_at).toLocaleString()} by {run.requested_by}
          </p>
          {run.pause_reason && (
            <p className="text-xs text-yellow-700 bg-yellow-50 px-2 py-1 rounded">{run.pause_reason}</p>
          )}
          {run.failure_reason && (
            <p className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded">{run.failure_reason}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {run.status === "running" && (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
              <Pause className="h-3 w-3 mr-1" /> Pause
            </Button>
          )}
          {run.status === "paused" && (
            <Button size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
              <Play className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
          {["running", "paused", "pending"].includes(run.status) && (
            <Button size="sm" variant="destructive" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              <XCircle className="h-3 w-3 mr-1" /> Cancel
            </Button>
          )}
          {run.status === "completed" && (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/census/runs/${runId}/export`} download>
                <Download className="h-3 w-3 mr-1" /> Export CSV
              </a>
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="lanes">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="lanes">Lane Breakdown</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensions</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="pool">Pool Health</TabsTrigger>
        </TabsList>

        {/* Lane breakdown */}
        <TabsContent value="lanes" className="mt-4">
          {laneData && laneData.length > 0 ? (
            <div className="space-y-2">
              {laneData.map((row) => {
                const count = parseInt(row.count as any, 10);
                const total = run.total_processed ?? 1;
                const pct = ((count / total) * 100).toFixed(1);
                const isAlert = row.primary_lane === "UNCLASSIFIED_REVIEW";
                return (
                  <div key={row.primary_lane} className={`flex items-center gap-3 p-2 rounded ${isAlert ? "bg-red-50 border border-red-200" : ""}`}>
                    {isAlert && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <code className="text-xs font-medium truncate">{row.primary_lane}</code>
                        <span className="text-xs text-muted-foreground ml-2 shrink-0">{count.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isAlert ? "bg-red-500" : "bg-primary"}`}
                          style={{ width: `${Math.max(0.5, parseFloat(pct))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No lane data yet.</p>
          )}
        </TabsContent>

        {/* Dimensions */}
        <TabsContent value="dimensions" className="mt-4">
          {dimData ? (
            <div className="grid md:grid-cols-2 gap-4">
              {Object.entries(dimData as Record<string, { value: string; count: string }[]>).map(([dim, rows]) => (
                <Card key={dim} className="border-gray-100">
                  <CardHeader className="pb-1 pt-3 px-4">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dim.replace(/_/g, " ")}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <table className="w-full text-xs">
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.value}>
                            <td className="py-0.5 font-mono">{r.value}</td>
                            <td className="py-0.5 text-right text-muted-foreground">{parseInt(r.count as any).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Dimensions available after run completes.</p>
          )}
        </TabsContent>

        {/* Reconciliation */}
        <TabsContent value="reconciliation" className="mt-4">
          {recon ? (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 p-3 rounded-lg border ${recon.reconciles ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                {recon.reconciles ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-medium ${recon.reconciles ? "text-green-800" : "text-red-800"}`}>
                    {recon.reconciles ? "Reconciliation PASS" : "Reconciliation FAIL"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    processed({recon.totalProcessed}) + excluded({recon.totalExcluded}) ={" "}
                    {(recon.totalProcessed ?? 0) + (recon.totalExcluded ?? 0)} / denominator({recon.denominator})
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Tile label="Denominator" value={(recon.denominator ?? 0).toLocaleString()} />
                <Tile label="Processed" value={(recon.totalProcessed ?? 0).toLocaleString()} />
                <Tile label="Excluded" value={(recon.totalExcluded ?? 0).toLocaleString()} />
                <Tile label="Provider Calls" value={(recon.providerCallCount ?? 0).toString()} warn={(recon.providerCallCount ?? 0) > 0} />
              </div>
              {recon.mutationProofBefore && (
                <div className="text-xs font-mono bg-gray-50 rounded border p-3 overflow-x-auto">
                  <p className="font-semibold mb-1 font-sans">Mutation Proof (before → after)</p>
                  {Object.entries(recon.mutationProofBefore as Record<string, number>).map(([table, before]) => {
                    const after = (recon.mutationProofAfter as Record<string, number> | null)?.[table] ?? before;
                    const changed = after !== before;
                    return (
                      <p key={table} className={changed ? "text-red-600" : ""}>
                        {table}: {before} → {after} {changed ? "⚠" : "✓"}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Reconciliation available after processing starts.</p>
          )}
        </TabsContent>

        {/* Pool health */}
        <TabsContent value="pool" className="mt-4">
          <div className="space-y-3">
            {run.pool_metrics_before && (
              <PoolSnapshot label="Before Run" metrics={run.pool_metrics_before} />
            )}
            {run.pool_metrics_during && (
              <PoolSnapshot label="During Run (last checkpoint)" metrics={run.pool_metrics_during} />
            )}
            {run.pool_metrics_after && (
              <PoolSnapshot label="After Run" metrics={run.pool_metrics_after} />
            )}
            {!run.pool_metrics_before && <p className="text-sm text-muted-foreground">Pool metrics collected at run start.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PoolSnapshot({ label, metrics }: { label: string; metrics: { totalCount: number; idleCount: number; waitingCount: number; at: string } }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold mb-2">{label} <span className="text-muted-foreground font-normal">— {new Date(metrics.at).toLocaleTimeString()}</span></p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Tile label="Total" value={String(metrics.totalCount)} />
        <Tile label="Idle" value={String(metrics.idleCount)} />
        <Tile label="Waiting" value={String(metrics.waitingCount)} warn={metrics.waitingCount > 0} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────
export default function ContactCensus() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <BarChart3 className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-xl font-bold">Contact Census</h1>
          <p className="text-sm text-muted-foreground">
            Admin-triggered, read-only census of all active contacts. No canonical records are mutated.
            No external provider calls are made.
          </p>
        </div>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <Eye className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Census runs are <strong>read-only</strong>. Lane assignments and dimension counts are stored in{" "}
          <code>contact_census_members</code>. No changes are made to <code>contacts</code>, <code>businesses</code>,
          or any other canonical table. No enrichment or outreach is triggered.
        </p>
      </div>

      <PreviewCard />
      <StartRunPanel onStarted={(id) => setSelectedRunId(id)} />

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Runs list */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Census Runs</h2>
          <RunsList selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
        </div>

        {/* Run detail */}
        <div className="lg:col-span-3">
          {selectedRunId ? (
            <>
              <h2 className="text-sm font-semibold mb-3">Run Detail</h2>
              <RunDetail runId={selectedRunId} />
            </>
          ) : (
            <div className="h-48 flex items-center justify-center rounded-lg border border-dashed border-gray-200">
              <p className="text-sm text-muted-foreground">Select a run to see details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
