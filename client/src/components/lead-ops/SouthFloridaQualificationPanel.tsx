import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Play, SearchCheck, XCircle, DatabaseZap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

type Census = {
  policyVersion: number;
  sources: Array<{ source: string; stagedCount: number }>;
  candidates: Array<{
    occurrenceId: string; sourceType: string; sourceSystem: string;
    sourceKeyHash: string; sourceObservedAt: string;
  }>;
};
type Preview = {
  policy: { version: number; hash: string };
  total: number; dispositionCounts: Record<string, number>;
  effectAuthorized: false;
};
type Run = {
  runId: string; state: string; totalCount: number; selectedCount: number;
  reviewCount: number; terminalCount: number;
};
type RunStatus = Omit<Run, "runId"> & { id: string };

export function SouthFloridaQualificationPanel() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const census = useQuery<Census>({
    queryKey: ["/api/cro03a/source-census"],
    queryFn: async () => {
      const response = await fetch("/api/cro03a/source-census", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load source census");
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const runStatus = useQuery<RunStatus>({
    queryKey: ["/api/cro03a/runs", run?.runId],
    enabled: Boolean(run?.runId && (run.state === "queued" || run.state === "running")),
    queryFn: async () => {
      const response = await fetch(`/api/cro03a/runs/${run!.runId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to refresh qualification run");
      return response.json();
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!runStatus.data) return;
    setRun({ ...runStatus.data, runId: runStatus.data.id });
    if (runStatus.data.state === "completed") {
      queryClient.invalidateQueries({ queryKey: ["/api/cro03a/source-census"] });
    }
  }, [runStatus.data]);
  const occurrenceIds = useMemo(() => [...selected].sort(), [selected]);
  const previewMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/cro03a/preview", { occurrenceIds })).json(),
    onSuccess: (data: Preview) => setPreview(data),
    onError: (error: Error) => toast({ title: "Preview failed", description: error.message, variant: "destructive" }),
  });
  const runMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/cro03a/runs", {
      occurrenceIds, idempotencyKey: crypto.randomUUID(),
    })).json(),
    onSuccess: (data: Run) => {
      setRun(data);
      toast({ title: "Qualification queued", description: "Durable processing has started. Progress will update automatically." });
    },
    onError: (error: Error) => toast({ title: "Qualification failed", description: error.message, variant: "destructive" }),
  });
  const stageMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/cro03a/source-census/stage", { limitPerSource: 100 })).json(),
    onSuccess: (data: { created: number; replayed: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cro03a/source-census"] });
      toast({ title: "Source census staged", description: `${data.created} new snapshots; ${data.replayed} replayed safely.` });
    },
    onError: (error: Error) => toast({ title: "Census staging failed", description: error.message, variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cro03a/runs/${run?.runId}/cancel`, {})).json(),
    onSuccess: () => setRun((current) => current ? { ...current, state: "cancelled" } : current),
    onError: (error: Error) => toast({ title: "Cancellation unavailable", description: error.message, variant: "destructive" }),
  });

  return (
    <Card className="border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/10">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">South Florida Candidate Qualification</CardTitle>
              <CardDescription className="text-xs">
                Deterministic, evidence-only qualification. No providers, CRM writes, cohorts, campaigns, messages, or pause changes.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">Policy v{census.data?.policyVersion ?? 1} · effects denied</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {(census.data?.sources ?? []).map((source) => (
            <div key={source.source} className="rounded-md border bg-background/80 p-2">
              <div className="truncate text-[10px] text-muted-foreground">{source.source}</div>
              <div className="text-lg font-semibold">{source.stagedCount.toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div className="max-h-52 overflow-auto rounded-md border bg-background">
          {(census.data?.candidates ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No staged source occurrences are available yet.</p>
          ) : (census.data?.candidates ?? []).map((candidate) => (
            <label key={candidate.occurrenceId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <Checkbox
                checked={selected.has(candidate.occurrenceId)}
                onCheckedChange={() => setSelected((current) => {
                  const next = new Set(current);
                  next.has(candidate.occurrenceId) ? next.delete(candidate.occurrenceId) : next.add(candidate.occurrenceId);
                  return next;
                })}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{candidate.sourceType} · {candidate.sourceSystem}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{candidate.sourceKeyHash.slice(0, 16)}…</span>
              </span>
              <span className="text-[10px] text-muted-foreground">{new Date(candidate.sourceObservedAt).toLocaleDateString()}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={stageMutation.isPending} onClick={() => stageMutation.mutate()}>
            {stageMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="mr-1.5 h-3.5 w-3.5" />}
            Stage source census
          </Button>
          <Button variant="outline" size="sm" disabled={!selected.size || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            {previewMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="mr-1.5 h-3.5 w-3.5" />}
            Preview {selected.size || ""}
          </Button>
          <Button size="sm" disabled={!selected.size || runMutation.isPending} onClick={() => runMutation.mutate()}>
            {runMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Run qualification
          </Button>
          {run && (run.state === "queued" || run.state === "running") && (
            <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          {preview && (
            <span className="text-xs text-muted-foreground">
              Preview: {Object.entries(preview.dispositionCounts).map(([key, count]) => `${key} ${count}`).join(" · ")}
            </span>
          )}
          {run && (
            <span className="text-xs text-muted-foreground">
              Run {run.state}: {run.selectedCount} selected · {run.reviewCount} review · {run.terminalCount}/{run.totalCount} terminal
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}