import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Play, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { IntegrationReadiness } from "@/components/dashboard/IntegrationReadiness";

interface Gate {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
  ownerAction?: string;
}

interface QueueMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  isPaused: boolean;
  nextRepeatAt?: string;
}

interface Alert {
  id: number;
  severity: string;
  subsystem: string;
  summary: string;
  acknowledged: boolean;
  createdAt: string;
}

interface LaunchData {
  verdict: "GO" | "NO-GO";
  timestamp: string;
  canonicalUrl: { url: string; source: string; warning?: string };
  gates: Gate[];
  p0Failures: Gate[];
  queues: QueueMetric[];
  backups: { filename: string; sizeBytes: number; triggeredBy?: string; timestamp?: string }[];
  recentAlerts: Alert[];
  ownerActions: { gate: string; action?: string }[];
}

function GateRow({ gate }: { gate: Gate }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {gate.pass ? (
        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
      ) : (
        <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{gate.label}</span>
          <Badge variant={gate.pass ? "default" : "destructive"} className="text-xs">
            {gate.pass ? "PASS" : "FAIL"}
          </Badge>
        </div>
        {gate.detail && <p className="text-xs text-muted-foreground mt-0.5">{gate.detail}</p>}
        {!gate.pass && gate.ownerAction && (
          <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Owner action: {gate.ownerAction}</p>
        )}
      </div>
    </div>
  );
}

export default function LaunchReadiness() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<LaunchData>({
    queryKey: ["/api/admin/launch-readiness"],
    refetchInterval: 60_000,
  });

  const runBackup = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/backups/run"),
    onSuccess: () => {
      toast({ title: "Backup triggered", description: "Backup running — refresh in a moment." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/admin/launch-readiness"] }), 4000);
    },
    onError: (e: any) => toast({ title: "Backup failed", description: e.message, variant: "destructive" }),
  });

  const ackAlert = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/alerts/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/launch-readiness"] }),
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading launch readiness…
      </div>
    );
  }

  if (!data) return <div className="p-6 text-destructive">Failed to load readiness data.</div>;

  const isGo = data.verdict === "GO";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Launch Readiness</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Checked at {new Date(data.timestamp).toLocaleString()} ·{" "}
            <button className="underline" onClick={() => refetch()}>Refresh</button>
          </p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-lg border-2 ${isGo ? "bg-green-50 border-green-500 text-green-700" : "bg-red-50 border-red-500 text-red-700"}`}>
          {isGo ? <CheckCircle className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
          {data.verdict}
        </div>
      </div>

      {data.canonicalUrl.warning && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          {data.canonicalUrl.warning}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">P0 Launch Gates</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {data.gates.map((g) => <GateRow key={g.id} gate={g} />)}
        </CardContent>
      </Card>

      {data.ownerActions.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" /> Owner Actions Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.ownerActions.map((a, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{a.gate}:</span>{" "}
                <span className="text-muted-foreground">{a.action}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">BullMQ Queues</CardTitle>
              <Badge variant={data.queues.length >= 8 ? "default" : "destructive"}>
                {data.queues.length} registered
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.queues.map((q) => (
                <div key={q.name} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{q.name}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {q.isPaused && <Badge variant="secondary" className="text-xs">paused</Badge>}
                    <span>{q.active} active</span>
                    <span>{q.waiting} waiting</span>
                    {q.failed > 0 && <span className="text-red-500">{q.failed} failed</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Database Backups</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runBackup.mutate()}
                disabled={runBackup.isPending}
                data-testid="button-run-backup"
              >
                {runBackup.isPending ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Run Now
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {data.backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet. Run one to establish baseline.</p>
            ) : (
              <div className="space-y-2">
                {data.backups.map((b, i) => (
                  <div key={i} className="text-sm">
                    <div className="font-mono text-xs truncate">{b.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {(b.sizeBytes / 1024).toFixed(1)} KB
                      {b.triggeredBy && ` · ${b.triggeredBy}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Critical Alert Feed
            {data.recentAlerts.filter((a) => !a.acknowledged).length > 0 && (
              <Badge variant="destructive">
                {data.recentAlerts.filter((a) => !a.acknowledged).length} unacknowledged
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts recorded.</p>
          ) : (
            <div className="space-y-2">
              {data.recentAlerts.map((a) => (
                <div key={a.id} className={`flex items-start gap-3 p-2 rounded text-sm border ${a.acknowledged ? "opacity-50" : a.severity === "critical" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} className="text-xs">
                        {a.severity}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{a.subsystem}</span>
                      <span className="text-xs text-muted-foreground">
                        <Clock className="inline h-3 w-3 mr-0.5" />
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5">{a.summary}</p>
                  </div>
                  {!a.acknowledged && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-6 px-2"
                      onClick={() => ackAlert.mutate(a.id)}
                      data-testid={`button-ack-alert-${a.id}`}
                    >
                      Ack
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Environment Checks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(data.envChecks ?? {}).map(([k, v]: [string, any]) => (
              <div key={k} className="flex items-center gap-2 text-sm">
                {v.set ? (
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                )}
                <span className="font-mono text-xs">{k}</span>
                {!v.set && <span className="text-xs text-muted-foreground">not set</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-base font-semibold mb-3">Secrets &amp; Integration Readiness</h2>
        <IntegrationReadiness />
      </div>

      <Separator />
      <p className="text-xs text-muted-foreground text-center">
        Canonical URL: <strong>{data.canonicalUrl.url}</strong> · Source: <strong>{data.canonicalUrl.source}</strong>
      </p>
    </div>
  );
}
