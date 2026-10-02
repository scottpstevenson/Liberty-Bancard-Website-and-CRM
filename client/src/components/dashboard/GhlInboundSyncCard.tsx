import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Database, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { GhlInboundSyncRun, GhlInboundSyncStatus } from "@shared/ghl-inbound-sync";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiErrorMessage } from "@/lib/ghlTruth";
import { useToast } from "@/hooks/use-toast";

const ENDPOINT = "/api/admin/ghl/inbound-contact-sync";
const QUERY_KEY = [ENDPOINT];
const STATE_LABELS: Record<GhlInboundSyncRun["state"], string> = {
  previewing: "Preparing incoming contact preview",
  ready: "Preview ready — not imported",
  running: "Applying to this database",
  complete: "Import completed",
  blocked: "Import blocked",
  failed: "Import failed",
};
function Count({ title, value }: { title: string; value: number | undefined }) {
  return <div><dt className="text-xs text-muted-foreground">{title}</dt>
    <dd className="text-lg font-semibold tabular-nums">{typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "Unknown"}</dd></div>;
}

export function GhlInboundSyncCard({ canControl }: { canControl: boolean }) {
  const { toast } = useToast();
  const [stepError, setStepError] = useState<string | null>(null);
  const stepInFlight = useRef(false);
  const mounted = useRef(true);
  const previewKey = useRef<string | null>(null);
  const executeKey = useRef<{ runId: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const statusQuery = useQuery<GhlInboundSyncStatus>({
    queryKey: QUERY_KEY, enabled: canControl, retry: false, refetchInterval: 3_000,
  });
  const status = statusQuery.data;
  const run = status?.run;
  const safeToApply = status?.configured === true && status.outboundPaused === true;
  const acceptRun = (newRun: GhlInboundSyncRun) => {
    queryClient.setQueryData<GhlInboundSyncStatus>(QUERY_KEY, old => old ? { ...old, run: newRun } : old);
  };
  const preview = useMutation({
    mutationFn: async () => {
      previewKey.current ??= crypto.randomUUID();
      const response = await apiRequest("POST", `${ENDPOINT}/preview`, {}, { "Idempotency-Key": previewKey.current });
      return response.json() as Promise<{ run: GhlInboundSyncRun }>;
    },
    onSuccess: ({ run: newRun }) => {
      previewKey.current = null;
      setStepError(null);
      acceptRun(newRun);
      void statusQuery.refetch();
    },
    onError: error => toast({ title: "Could not preview incoming contacts", description: getApiErrorMessage(error, "Preview failed."), variant: "destructive" }),
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (!run?.previewHash || !safeToApply) throw new Error("A completed preview and verified outbound pause are required.");
      if (executeKey.current?.runId !== run.runId) executeKey.current = { runId: run.runId, key: crypto.randomUUID() };
      const response = await apiRequest("POST", `${ENDPOINT}/${run.runId}/execute`, { previewHash: run.previewHash }, { "Idempotency-Key": executeKey.current.key });
      return response.json() as Promise<{ run: GhlInboundSyncRun }>;
    },
    onSuccess: ({ run: newRun }) => { setStepError(null); acceptRun(newRun); void statusQuery.refetch(); },
    onError: error => toast({ title: "Incoming import was not started", description: getApiErrorMessage(error, "The server rejected execution."), variant: "destructive" }),
  });
  const control = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest("PATCH", `${ENDPOINT}/control`, { enabled });
      return response.json();
    },
    onSuccess: () => {
      void statusQuery.refetch();
      toast({ title: "Incoming contact-update control saved", description: "This controls GHL contact webhooks only. It does not enable messaging or writes back to GHL." });
    },
    onError: error => toast({ title: "Incoming-update control unchanged", description: getApiErrorMessage(error, "The update failed."), variant: "destructive" }),
  });

  // One bounded page at a time. Durable server progress is authoritative; a
  // closed tab can resume without replaying already committed contact writes.
  useEffect(() => {
    if (!canControl || !run?.nextAction || stepError || stepInFlight.current
        || !["previewing", "running"].includes(run.state)) return;
    if (run.nextAction === "apply" && !safeToApply) return;
    const timer = setTimeout(async () => {
      if (stepInFlight.current) return;
      stepInFlight.current = true;
      try {
        const response = await apiRequest("POST", `${ENDPOINT}/${run.runId}/step`, {});
        const result = await response.json() as { run: GhlInboundSyncRun };
        if (mounted.current) acceptRun(result.run);
      } catch (error) {
        if (mounted.current) {
          const message = getApiErrorMessage(error, "Processing stopped. Committed progress is retained.");
          // A concurrent tab/process may own the page lease. Poll instead of
          // assuming failure or starting a competing command.
          if (!/lease|busy|in.progress|already.running/i.test(message)) setStepError(message);
        }
      } finally {
        stepInFlight.current = false;
        if (mounted.current) void statusQuery.refetch();
      }
    }, 350);
    return () => { clearTimeout(timer); };
  }, [canControl, run?.runId, run?.state, run?.nextAction, run?.updatedAt, statusQuery.dataUpdatedAt, safeToApply, stepError]);

  const processing = run?.state === "previewing" || run?.state === "running";
  return <Card data-testid="card-ghl-inbound-sync">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4" />GHL → database contact sync</CardTitle>
        <Badge variant="outline">{status ? `${status.environment} database` : "Database state unknown"}</Badge>
      </div>
      <CardDescription>Keep your existing values, fill missing contact details, and add identifiable GHL-only contacts. Nothing is sent back to GHL.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {!canControl ? <Alert><AlertDescription>An administrator must preview and run incoming contact synchronization.</AlertDescription></Alert> : <>
        {statusQuery.isError && <Alert variant="destructive"><AlertDescription>Incoming sync status is unavailable. No active sync or database state is assumed.</AlertDescription></Alert>}
        {!status && !statusQuery.isError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading incoming sync status…</p>}
        {status?.environment === "development" && <Alert data-testid="alert-ghl-inbound-development"><AlertDescription><strong>This is the development database.</strong> Applying here does not update production. Use the published app to import into the production database.</AlertDescription></Alert>}
        {status && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>GHL credentials: {status.configured ? "Configured" : "Not configured"}</span>
          <span>Outbound: {status.outboundPaused === true ? "Paused" : status.outboundPaused === false ? "Not paused — import blocked" : "Unknown — import blocked"}</span>
        </div>}
        <div className="rounded-md border p-3 text-sm">
          <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div>
            <p className="font-medium">One-way, fill-missing-only policy</p>
            <p className="text-muted-foreground">Match by GHL ID or normalized email. Preserve non-empty production values, consent, opt-outs, tags, ownership and status. Conflicting identities are reported, not merged. No enrollment or paid validation is queued by this import.</p>
          </div></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => preview.mutate()} disabled={!status?.configured || processing || preview.isPending || execute.isPending} data-testid="button-ghl-inbound-preview">
            {preview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Preview incoming contacts
          </Button>
          {run?.state === "ready" && <Button onClick={() => execute.mutate()} disabled={!safeToApply || !run.previewHash || execute.isPending} data-testid="button-ghl-inbound-execute">
            {execute.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}Apply to {status?.environment ?? "this"} database
          </Button>}
          {stepError && processing && <Button variant="outline" onClick={() => { setStepError(null); void statusQuery.refetch(); }} data-testid="button-ghl-inbound-resume">Resume processing</Button>}
          <Button variant="ghost" onClick={() => { void statusQuery.refetch(); }} disabled={statusQuery.isFetching}>Refresh status</Button>
        </div>
        <p className="text-xs text-muted-foreground">Preview does not modify contacts. Processing advances in resumable pages while this page is open; return here to continue. Applying does not automatically enable ongoing webhook updates.</p>
        {run && <section aria-label="Incoming reconciliation results" className="space-y-3 rounded-md border p-4" data-testid="section-ghl-inbound-results">
          <div className="flex items-center gap-2" aria-live="polite">{processing && !stepError && <Loader2 className="h-4 w-4 animate-spin" />}<strong className="text-sm">{stepError ? "Processing paused after an error" : STATE_LABELS[run.state]}</strong></div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Count title="Read from GHL" value={run.counts.scanned} />
            <Count title="Matched existing" value={run.counts.matched} />
            <Count title="Would fill gaps" value={run.counts.wouldUpdate} />
            <Count title="Would add contacts" value={run.counts.wouldCreate} />
            <Count title="Actually updated" value={run.counts.updated} />
            <Count title="Actually added" value={run.counts.created} />
            <Count title="Identity / value conflicts" value={run.counts.conflicts} />
            <Count title="Skipped" value={run.counts.skipped} />
          </dl>
          {(stepError || run.lastError) && <Alert variant="destructive"><AlertDescription>{stepError ?? run.lastError}</AlertDescription></Alert>}
          {run.issues.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Reported issues ({run.issues.length} shown)</summary>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">{run.issues.map((issue, index) => <li key={`${issue.ghlContactId ?? "unknown"}-${index}`}><code>{issue.ghlContactId ?? "No provider ID"}</code>: {issue.reason}</li>)}</ul>
          </details>}
          <p className="text-xs text-muted-foreground">Run {run.runId} · Last progress: {new Date(run.updatedAt).toLocaleString()}</p>
        </section>}
        {status && <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div><p className="text-sm font-medium">Ongoing incoming contact updates</p><p className="text-xs text-muted-foreground">GHL contact webhooks only. {status.inboundEnabled ? "Enabled; receipt depends on GHL delivering signed events." : "Disabled; bulk imports can still be run."}</p></div>
          <Switch aria-label="Enable incoming GHL contact updates" checked={status.inboundEnabled} disabled={control.isPending || (!status.inboundEnabled && !safeToApply)} onCheckedChange={enabled => control.mutate(enabled)} data-testid="switch-ghl-inbound-updates" />
        </div>}
      </>}
    </CardContent>
  </Card>;
}