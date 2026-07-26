import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, RefreshCw, RotateCcw, XCircle, CheckCircle2,
  Clock, Activity, Zap, Database, Wifi,
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

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
        <CheckCircle2 className="w-4 h-4 text-green-500" /> No dead-letter jobs — all queues clean.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Collapsible key={item.id} open={open[item.id]} onOpenChange={(v) => setOpen(s => ({ ...s, [item.id]: v }))}>
          <div className="flex items-start gap-3 p-3 border rounded-lg bg-red-50 dark:bg-red-950/30">
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="destructive" className="text-xs font-mono">{item.queueName}</Badge>
                <span className="text-sm font-medium">{item.jobName}</span>
                <span className="text-xs text-muted-foreground">
                  <Clock className="inline w-3 h-3 mr-0.5" />{relativeTime(item.timestamp)}
                </span>
                <Badge variant="secondary" className="text-xs">{item.attemptsMade} attempts</Badge>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1 truncate">{item.failedReason}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="text-xs h-7 px-2">Details</Button>
              </CollapsibleTrigger>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2"
                disabled={retryJob.isPending}
                onClick={() => retryJob.mutate(item.id)}
                data-testid={`button-retry-job-${item.id}`}
              >
                <RotateCcw className="w-3 h-3 mr-1" /> Retry
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
