import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Play, SearchCheck, XCircle, DatabaseZap, CheckCircle2, Clock, Filter, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

type Census = {
  policyVersion: number;
  policyHash?: string;
  algorithm?: { id: string; version: number; hash: string };
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

type StagingRunState = {
  runId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  stalledAt?: string;
  stallReason?: string;
  timedOut?: boolean;
  created?: number;
  replayed?: number;
  total?: number;
  skippedUnattested?: number;
  sourceResults?: Record<string, number | string>;
  error?: string;
  // Heartbeat fields written by the onProgress microbatch callback
  lastHeartbeat?: string;
  currentStage?: string;
  completedItems?: number;
  totalItems?: number;
};

type PilotCohortFunnel = {
  pilotDefinition: {
    id: string | null;
    level: number;
    countyScope: string[];
    verticalScope: string[];
    maxCohortSize: number;
  };
  funnel: {
    totalSourceRecordsStaged: number;
    totalDecided: number;
    undecided: number;
    outsideGeography: number;
    existingRelationship: number;
    insufficientEvidence: number;
    inactiveEntity: number;
    excluded: number;
    duplicate: number;
    reviewRequired: number;
    automaticallyEligible: number;
    handoffsCreated: number;
    terminalWithoutHandoff: number;
  };
  eligibleSummary: string | null;
  lastQualificationRun: {
    runId: string;
    completedAt: string;
    policyId: string;
    policyHash: string;
    handoffCount: number;
    actorId: string;
  } | null;
};

export function SouthFloridaQualificationPanel() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stagingRun, setStagingRun] = useState<StagingRunState | null>(null);
  const [showCohortFunnel, setShowCohortFunnel] = useState(false);
  // Operator-controlled cohort size (1–50).  Default 10 for the pre-pilot proof.
  const [limitPerSource, setLimitPerSource] = useState(10);
  // Track whether we've already fired the completion toast for this run.
  const stagingCompletedRef = useRef<string | null>(null);

  // Pilot cohort funnel query — loaded on demand
  const pilotCohortQuery = useQuery<PilotCohortFunnel>({
    queryKey: ["/api/cro03a/pilot-cohort/eligible"],
    queryFn: async () => {
      const response = await fetch("/api/cro03a/pilot-cohort/eligible", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load pilot cohort funnel");
      return response.json();
    },
    enabled: showCohortFunnel,
    staleTime: 30_000,
  });

  // On mount: check if there's an in-progress staging run from before the
  // last page refresh. Restores the runId into state so polling resumes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cro03a/source-census/latest-run", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data: StagingRunState = await res.json();
        if (cancelled) return;
        // Only restore if the run is still active (queued or running).
        // Terminal states don't need polling but we surface a one-time note.
        if (data.status === "queued" || data.status === "running") {
          setStagingRun(data);
        }
      } catch { /* best-effort — silently ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
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
    const updated = { ...runStatus.data, runId: runStatus.data.id };
    setRun(updated);
    if (runStatus.data.state === "completed") {
      queryClient.invalidateQueries({ queryKey: ["/api/cro03a/source-census"] });
      // Zero-handoff completion: treat as a successful terminal result.
      // Do NOT invoke any downstream admission/enrichment command — the handoffs
      // array would be empty and the admission endpoint would reject it.
      // Show an informational toast and return without calling cro03b/commands.
      if (Number(runStatus.data.selectedCount ?? 0) === 0) {
        toast({
          title: "Qualification complete — no handoffs selected",
          description: `${runStatus.data.terminalCount ?? 0}/${runStatus.data.totalCount ?? 0} occurrences reached a terminal decision; 0 qualified. No admission command sent.`,
        });
        return;
      }
      // selectedCount > 0: handoffs exist; downstream admission may proceed when
      // the operator explicitly initiates it. No automatic call is made here.
    }
  }, [runStatus.data]);

  // ── Census staging run polling ──────────────────────────────────────────────
  // stageMutation only fires the POST and captures the initial runId.
  // A separate useQuery polls the status endpoint every 3 s while in progress.
  const stagingActive = stagingRun !== null &&
    (stagingRun.status === "queued" || stagingRun.status === "running");

  const stagingPollQuery = useQuery<StagingRunState>({
    queryKey: ["/api/cro03a/source-census/stage", stagingRun?.runId],
    enabled: stagingActive,
    queryFn: async () => {
      const response = await fetch(
        `/api/cro03a/source-census/stage/${encodeURIComponent(stagingRun!.runId)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Unable to poll census staging run");
      return response.json();
    },
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!stagingPollQuery.data) return;
    const data = stagingPollQuery.data;
    setStagingRun(data);
    const alreadyFired = stagingCompletedRef.current === data.runId;
    if (alreadyFired) return;
    if (data.status === "completed") {
      stagingCompletedRef.current = data.runId;
      queryClient.invalidateQueries({ queryKey: ["/api/cro03a/source-census"] });
      // Build a per-source breakdown for the toast.
      const sourceLines = data.sourceResults
        ? Object.entries(data.sourceResults)
            .filter(([, v]) => typeof v === "number")
            .map(([src, count]) => `${src}: ${count}`)
            .join(", ")
        : "";
      toast({
        title: "Source census staged",
        description: [
          `${data.created ?? 0} new · ${data.replayed ?? 0} replayed · ${data.skippedUnattested ?? 0} skipped`,
          sourceLines ? `Sources — ${sourceLines}` : "",
        ].filter(Boolean).join(". "),
      });
    } else if (data.status === "failed") {
      stagingCompletedRef.current = data.runId;
      toast({ title: "Census staging failed", description: data.error ?? "Unknown error", variant: "destructive" });
    } else if (data.status === "stalled") {
      stagingCompletedRef.current = data.runId;
      toast({
        title: "Census staging stalled",
        description: data.stallReason ?? "The background run stopped without completing. Retry with a new staging request.",
        variant: "destructive",
      });
    }
  }, [stagingPollQuery.data]);


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
    mutationFn: async () => {
      const idempotencyKey = `census-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const res = await apiRequest("POST", "/api/cro03a/source-census/stage", {
        limitPerSource,
        idempotencyKey,
      });
      const initial: StagingRunState = await res.json();
      return initial;
    },
    onSuccess: (data: StagingRunState) => {
      stagingCompletedRef.current = null;
      setStagingRun(data);
      // If the server returned an already-terminal state (e.g. replayed completed run),
      // surface the result immediately without waiting for polling.
      if (data.status === "completed") {
        stagingCompletedRef.current = data.runId;
        queryClient.invalidateQueries({ queryKey: ["/api/cro03a/source-census"] });
        toast({
          title: "Source census staged",
          description: `${data.created ?? 0} new · ${data.replayed ?? 0} replayed (replayed from cache).`,
        });
      } else if (data.status === "failed") {
        stagingCompletedRef.current = data.runId;
        toast({ title: "Census staging failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
      // queued/running → polling takes over via stagingPollQuery
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
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge variant="outline">Policy v{census.data?.policyVersion ?? 1} · effects denied</Badge>
            <Badge variant="secondary">CRO-03B local-only · providers denied</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Qualified handoffs enter a governed evidence recipe. Ambiguous matches require review; canonical projection is local-only, creates no GHL work, and validation remains pending until the winning email is checked.
        </div>
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
        {/* ── Pilot cohort funnel ───────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm"
              className="h-7 gap-1.5 text-xs px-2"
              onClick={() => setShowCohortFunnel((v) => !v)}
            >
              <Filter className="h-3.5 w-3.5" />
              {showCohortFunnel ? "Hide" : "Find eligible pilot cohort"}
            </Button>
            {pilotCohortQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {showCohortFunnel && (
            <div className="rounded-md border bg-muted/20 px-3 py-3 space-y-2">
              {pilotCohortQuery.isLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse">Loading pilot cohort funnel…</div>
              ) : pilotCohortQuery.isError ? (
                <div className="flex items-center gap-1.5 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Failed to load cohort funnel.
                </div>
              ) : pilotCohortQuery.data ? (() => {
                const { pilotDefinition, funnel, eligibleSummary, lastQualificationRun } = pilotCohortQuery.data;
                const funnelRows = [
                  { label: "Total source records staged", value: funnel.totalSourceRecordsStaged, color: "text-foreground" },
                  { label: "Total decided", value: funnel.totalDecided, color: "text-foreground" },
                  { label: "Undecided (potential)", value: funnel.undecided, color: "text-blue-700" },
                  { label: "Outside geography", value: funnel.outsideGeography, color: "text-muted-foreground" },
                  { label: "Existing relationship", value: funnel.existingRelationship, color: "text-muted-foreground" },
                  { label: "Insufficient evidence", value: funnel.insufficientEvidence, color: "text-amber-700" },
                  { label: "Inactive entity", value: funnel.inactiveEntity, color: "text-muted-foreground" },
                  { label: "Excluded / duplicate", value: funnel.excluded + funnel.duplicate, color: "text-muted-foreground" },
                  { label: "Review required", value: funnel.reviewRequired, color: "text-yellow-700" },
                  { label: "Automatically eligible", value: funnel.automaticallyEligible, color: "text-green-700" },
                  { label: "Handoffs created", value: funnel.handoffsCreated, color: funnel.handoffsCreated > 0 ? "text-emerald-700 font-semibold" : "text-muted-foreground" },
                  { label: "Terminal without handoff", value: funnel.terminalWithoutHandoff, color: "text-muted-foreground" },
                ];
                return (
                  <div className="space-y-2">
                    {/* Pilot definition */}
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      <div><span className="font-medium">Level {pilotDefinition.level} pilot</span> · county: {pilotDefinition.countyScope.join(", ")} · vertical: {pilotDefinition.verticalScope.join(", ")} · max cohort: {pilotDefinition.maxCohortSize}</div>
                    </div>
                    {/* Eligible summary */}
                    {eligibleSummary && (
                      <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${funnel.automaticallyEligible === 0 ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                        {funnel.automaticallyEligible === 0
                          ? <AlertCircle className="h-3 w-3 shrink-0" />
                          : <CheckCircle2 className="h-3 w-3 shrink-0" />}
                        {eligibleSummary}
                      </div>
                    )}
                    {/* Funnel grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {funnelRows.map(({ label, value, color }) => (
                        <div key={label} className="flex items-center justify-between gap-2 rounded border bg-background/80 px-2 py-1">
                          <span className="text-[10px] text-muted-foreground truncate">{label}</span>
                          <span className={`text-xs font-mono shrink-0 ${color}`}>{value.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    {/* Last qualification run summary */}
                    {lastQualificationRun && (
                      <div className="rounded border bg-background/80 px-3 py-2 text-[10px] text-muted-foreground space-y-0.5">
                        <div className="font-medium text-xs text-foreground">Last qualification run</div>
                        <div>Run ID: <span className="font-mono">{lastQualificationRun.runId.slice(0, 16)}…</span></div>
                        <div>Completed: {new Date(lastQualificationRun.completedAt).toLocaleString()}</div>
                        <div>Policy hash: <span className="font-mono">{lastQualificationRun.policyHash.slice(0, 12)}…</span></div>
                        <div>Handoffs: <span className={lastQualificationRun.handoffCount > 0 ? "text-green-700 font-semibold" : ""}>{lastQualificationRun.handoffCount}</span></div>
                        <div>Provider-free: <span className="text-green-700">yes</span></div>
                      </div>
                    )}
                    {!lastQualificationRun && (
                      <div className="text-[10px] text-muted-foreground">No completed qualification runs yet.</div>
                    )}
                  </div>
                );
              })() : null}
            </div>
          )}
        </div>

        {/* ── Census staging progress row ────────────────────────────────── */}
        {stagingRun && stagingActive && (
          <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600 dark:text-emerald-400" />
              <span className="text-muted-foreground">
                {stagingRun.currentStage ?? `Census staging ${stagingRun.status}…`}
              </span>
              {stagingRun.completedItems !== undefined && stagingRun.totalItems !== undefined && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {stagingRun.completedItems}/{stagingRun.totalItems} items
                </span>
              )}
            </div>
            {stagingRun.lastHeartbeat && (
              <div className="font-mono text-[10px] text-muted-foreground pl-5">
                Last heartbeat: {Math.round((Date.now() - new Date(stagingRun.lastHeartbeat).getTime()) / 1000)}s ago
              </div>
            )}
            {stagingPollQuery.data?.sourceResults && (
              <div className="font-mono text-[10px] text-muted-foreground pl-5">
                {Object.entries(stagingPollQuery.data.sourceResults)
                  .filter(([, v]) => typeof v === "number")
                  .map(([src, count]) => `${src.replace(/_/g, " ")}: ${count}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* Cohort size control — allows bounded pre-pilot runs */}
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Per source:</span>
            <input
              type="number" min={1} max={50} value={limitPerSource}
              disabled={stageMutation.isPending || stagingActive}
              onChange={(e) => setLimitPerSource(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
              className="w-12 bg-transparent text-xs text-center focus:outline-none disabled:opacity-50"
            />
          </div>
          <Button
            variant="outline" size="sm"
            disabled={stageMutation.isPending || stagingActive}
            onClick={() => stageMutation.mutate()}
          >
            {(stageMutation.isPending || stagingActive) ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <DatabaseZap className="mr-1.5 h-3.5 w-3.5" />
            )}
            {stagingActive ? "Staging…" : "Stage source census"}
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
          {run && run.state === "completed" && Number(run.selectedCount ?? 0) === 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Qualification complete — 0 of {run.totalCount} qualified (
              {run.terminalCount}/{run.totalCount} terminal). No admission command sent.
            </span>
          )}
          {run && !(run.state === "completed" && Number(run.selectedCount ?? 0) === 0) && (
            <span className="text-xs text-muted-foreground">
              Run {run.state}: {run.selectedCount} selected · {run.reviewCount} review · {run.terminalCount}/{run.totalCount} terminal
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}