import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, RefreshCw, RotateCcw, XCircle, CheckCircle2,
  Clock, Activity, Zap, Database, Wifi, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DlqItem {
  id: string;
  queueName: string;
  jobName: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
  data: Record<string, unknown>;
}

interface GhlFailure {
  id: number;
  action: string;
  entityKey: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface IncidentsData {
  dlqItems: DlqItem[];
  dlqCount: number;
  ghlFailures: GhlFailure[];
  ghlFailureCount: number;
  queueSummary: {
    name: string;
    failed: number;
    waiting: number;
    active: number;
  }[];
  checkedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number | string) {
  const ms = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function isStale(timestamp: number, days = 7) {
  return Date.now() - timestamp > days * 24 * 60 * 60 * 1000;
}

// ─── DLQ Panel ────────────────────────────────────────────────────────────────

function DlqPanel({ items }: { items: DlqItem[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const retryJob = useMutation({
    mutationFn: (compositeId: string) =>
      apiRequest("POST", `/api/admin/system-health/jobs/${encodeURIComponent(compositeId)}/retry`),
    onSuccess: () => {
      toast({ title: "Job re-queued" });
      qc.invalidateQueries({ queryKey: ["/api/admin/system-health/incidents"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  const discardJob = useMutation({
    mutationFn: (compositeId: string) =>
      apiRequest("DELETE", `/api/admin/system-health/jobs/${encodeURIComponent(compositeId)}`),
    onSuccess: () => {
      toast({ title: "Job discarded" });
      qc.invalidateQueries({ queryKey: ["/api/admin/system-health/incidents"] });
    },
    onError: (e: any) => toast({ title: "Discard failed", description: e.message, variant: "destructive" }),
  });

  const purgeAll = useMutation({
    mutationFn: (olderThanDays: number) =>
      apiRequest("DELETE", `/api/admin/system-health/jobs/dlq/purge?olderThanDays=${olderThanDays}`),
    onSuccess: (data: any) => {
      toast({ title: `Purged ${data.removed ?? 0} job(s) from the DLQ` });
      qc.invalidateQueries({ queryKey: ["/api/admin/system-health/incidents"] });
    },
    onError: (e: any) => toast({ title: "Purge failed", description: e.message, variant: "destructive" }),
  });

  const staleCount = items.filter((i) => isStale(i.timestamp, 7)).length;

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
        <CheckCircle2 className="w-4 h-4 text-green-500" /> No dead-letter jobs — all queues clean.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk-action toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {items.length} exhausted job{items.length !== 1 ? "s" : ""}
          {staleCount > 0 && (
            <span className="ml-1 text-amber-600 dark:text-amber-400">
              · {staleCount} older than 7 days
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {staleCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2 border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                  disabled={purgeAll.isPending}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Purge stale ({staleCount})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Purge stale dead-letter jobs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {staleCount} job{staleCount !== 1 ? "s" : ""} older
                    than 7 days that have already exhausted all retry attempts. These jobs failed due
                    to past infrastructure issues (e.g. Redis timeouts) and cannot be retried
                    successfully. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90"
                    onClick={() => purgeAll.mutate(7)}
                  >
                    Purge {staleCount} job{staleCount !== 1 ? "s" : ""}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 border-destructive text-destructive hover:bg-destructive/10"
                disabled={purgeAll.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Purge all ({items.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Purge all dead-letter jobs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {items.length} exhausted job{items.length !== 1 ? "s" : ""} from
                  every queue. Use this to clear the backlog after a confirmed infrastructure outage.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => purgeAll.mutate(0)}
                >
                  Purge all {items.length} job{items.length !== 1 ? "s" : ""}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Per-item list */}
      {items.map((item) => (
        <Collapsible key={item.id} open={open[item.id]} onOpenChange={(v) => setOpen(s => ({ ...s, [item.id]: v }))}>
          <div className={`flex items-start gap-3 p-3 border rounded-lg ${isStale(item.timestamp, 7) ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900" : "bg-red-50 dark:bg-red-950/30"}`}>
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="destructive" className="text-xs font-mono">{item.queueName}</Badge>
                <span className="text-sm font-medium">{item.jobName}</span>
                <span className="text-xs text-muted-foreground">
                  <Clock className="inline w-3 h-3 mr-0.5" />{relativeTime(item.timestamp)}
                </span>
                <Badge variant="secondary" className="text-xs">{item.attemptsMade} attempts</Badge>
                {isStale(item.timestamp, 7) && (
                  <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300">stale</Badge>
                )}
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1 truncate">{item.failedReason}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="text-xs h-7 px-2">Details</Button>
              </CollapsibleTrigger>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2"
                disabled={retryJob.isPending || discardJob.isPending}
                onClick={() => retryJob.mutate(item.id)}
                data-testid={`button-retry-job-${item.id}`}
              >
                <RotateCcw className="w-3 h-3 mr-1" /> Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive"
                disabled={retryJob.isPending || discardJob.isPending}
                onClick={() => discardJob.mutate(item.id)}
                title="Permanently delete this job"
                data-testid={`button-discard-job-${item.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <CollapsibleContent>
            <div className="mt-1 p-3 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-40">
              <pre>{JSON.stringify(item.data, null, 2)}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

// ─── GHL Failure Panel ────────────────────────────────────────────────────────

function GhlFailurePanel({ failures }: { failures: GhlFailure[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const retrySync = useMutation({
    mutationFn: (entityKey: string) =>
      apiRequest("POST", `/api/admin/ghl-failures/retry`, { entityKey }),
    onSuccess: () => {
      toast({ title: "GHL sync re-queued" });
      qc.invalidateQueries({ queryKey: ["/api/admin/system-health/incidents"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  if (failures.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
        <CheckCircle2 className="w-4 h-4 text-green-500" /> No GHL sync failures in the last 24h.
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact / Entity</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Error</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {failures.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-mono text-xs max-w-[160px] truncate">{f.entityKey ?? "—"}</TableCell>
              <TableCell className="text-xs">{f.action}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{relativeTime(f.createdAt)}</TableCell>
              <TableCell className="text-xs text-red-600 max-w-[200px] truncate">
                {(f.details as any)?.error ?? (f.details as any)?.message ?? "—"}
              </TableCell>
              <TableCell>
                {f.entityKey && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-6 px-2"
                    disabled={retrySync.isPending}
                    onClick={() => retrySync.mutate(f.entityKey!)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Retry
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Queue Summary ────────────────────────────────────────────────────────────

function QueueSummaryPanel({ queues }: { queues: IncidentsData["queueSummary"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {queues.map((q) => (
        <div key={q.name} className="flex items-center justify-between p-2 border rounded-lg text-sm">
          <span className="font-mono text-xs truncate max-w-[140px]">{q.name}</span>
          <div className="flex gap-2 text-xs">
            {q.failed > 0 && <span className="text-red-600 font-semibold">{q.failed} failed</span>}
            <span className="text-muted-foreground">{q.active} active</span>
            <span className="text-muted-foreground">{q.waiting} waiting</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IncidentsDashboard() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<IncidentsData>({
    queryKey: ["/api/admin/system-health/incidents"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading incident data…
      </div>
    );
  }

  if (!data) {
    return <div className="py-8 text-center text-destructive">Failed to load incident data.</div>;
  }

  const totalIssues = data.dlqCount + data.ghlFailureCount;
  const staleCount = (data.dlqItems ?? []).filter((i) => isStale(i.timestamp, 7)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Incident Feed</h2>
          {totalIssues > 0 && (
            <Badge variant="destructive">{totalIssues} issue{totalIssues !== 1 ? "s" : ""}</Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* Stale DLQ alert banner */}
      {staleCount > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-amber-800 dark:text-amber-300">
              {staleCount} stale DLQ job{staleCount !== 1 ? "s" : ""} may be masking new failures.
            </span>{" "}
            <span className="text-amber-700 dark:text-amber-400">
              These jobs are older than 7 days and exhausted all retry attempts. Use "Purge stale" below to clear them so real new failures become visible immediately.
            </span>
          </div>
        </div>
      )}

      {/* Queue Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4" /> Queue Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueueSummaryPanel queues={data.queueSummary} />
        </CardContent>
      </Card>

      {/* DLQ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-red-500" />
            Dead-Letter Queue
            {data.dlqCount > 0 && <Badge variant="destructive">{data.dlqCount}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DlqPanel items={data.dlqItems} />
        </CardContent>
      </Card>

      {/* GHL Sync Failures */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="w-4 h-4 text-orange-500" />
            GHL Sync Failures — Last 24h
            {data.ghlFailureCount > 0 && <Badge variant="secondary">{data.ghlFailureCount}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GhlFailurePanel failures={data.ghlFailures} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Last checked: {new Date(data.checkedAt).toLocaleString()} · Auto-refreshes every 60s
      </p>
    </div>
  );
}
