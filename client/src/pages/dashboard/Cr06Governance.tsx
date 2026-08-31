import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, LockKeyhole, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Manifest = {
  manifestVersion: string;
  manifestHash: string;
  counts: { programs: number; sequences: number; contents: number; manualTasks: number };
  dispatchAvailable: boolean;
};

type Cro07Status = {
  codeComplete: boolean;
  productionConnected: boolean;
  sendingEnabled: boolean;
  outreach: string;
  authorized: boolean;
  message: string;
};

type Cro07TaxonomyEntry = {
  version: number;
  canonical_event: string;
  aliases: string[] | null;
};

type Catalog = {
  governed: Array<{
    id: string;
    identityKey: string;
    artifactKind: string;
    governanceState: string;
    preparationState: string;
    contentHash: string;
    document: { name?: string; audience?: string };
  }>;
  legacy: { campaigns: unknown[]; sequences: unknown[] };
};

async function jsonRequest(method: string, url: string, body?: unknown, idempotencyKey?: string) {
  const response = await apiRequest(method, url, body, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined);
  return response.json();
}

function commandKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function Cr06Governance() {
  const queryClient = useQueryClient();
  const [programId, setProgramId] = useState("");
  const [cohortRunId, setCohortRunId] = useState("");
  const [cap, setCap] = useState(250);
  const [preflight, setPreflight] = useState<any>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const manifest = useQuery<Manifest>({
    queryKey: ["/api/admin/cr06/manifest"],
  });
  const catalog = useQuery<Catalog>({
    queryKey: ["/api/admin/cr06/catalog"],
  });
  const cro07Status = useQuery<Cro07Status>({
    queryKey: ["/api/admin/cro07/status"],
  });
  const cro07Taxonomy = useQuery<Cro07TaxonomyEntry[]>({
    queryKey: ["/api/admin/cro07/taxonomy"],
  });
  const programs = useMemo(
    () => catalog.data?.governed.filter((artifact) => artifact.artifactKind === "program") ?? [],
    [catalog.data],
  );

  const rollout = useMutation({
    mutationFn: (dryRun: boolean) => jsonRequest("POST", "/api/admin/cr06/rollout", { dryRun }),
    onSuccess: async (data) => {
      setLastResult(data);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/cr06/catalog"] });
    },
  });
  const approve = useMutation({
    mutationFn: (program: Catalog["governed"][number]) => jsonRequest("POST", `/api/admin/cr06/programs/${program.id}/approve`, {
      expectedHash: program.contentHash,
      confirmation: "CR06_APPROVE_EXACT_IMMUTABLE_PACKAGE",
    }),
    onSuccess: async (data) => {
      setLastResult(data);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/cr06/catalog"] });
    },
  });
  const runPreflight = useMutation({
    mutationFn: () => jsonRequest("GET", `/api/admin/cr06/preflight?programArtifactId=${encodeURIComponent(programId)}&cohortRunId=${encodeURIComponent(cohortRunId)}&cap=${cap}`),
    onSuccess: (data) => {
      setPreflight(data);
      setLastResult(data);
    },
  });
  const gate = useMutation({
    mutationFn: () => jsonRequest("POST", "/api/admin/cr06/gates", {
      programArtifactId: programId,
      cohortRunId,
      preflightHash: preflight.preflightHash,
      cap,
      state: "open",
      confirmation: "CR06_OPEN_EXACT_VERSION_COHORT",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, commandKey("cr06-gate")),
    onSuccess: setLastResult,
  });
  const prepare = useMutation({
    mutationFn: () => jsonRequest("POST", "/api/admin/cr06/prepare", {
      programArtifactId: programId,
      cohortRunId,
      cap,
      confirmation: "CR06_PREPARE_HELD_SENDING_OFF",
    }, commandKey("cr06-prepare")),
    onSuccess: setLastResult,
  });

  const busy = rollout.isPending || approve.isPending || runPreflight.isPending || gate.isPending || prepare.isPending;
  const error = rollout.error || approve.error || runPreflight.error || gate.error || prepare.error;

  return (
    <div className="space-y-4" data-testid="cr06-governance">
      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Final sending is off</AlertTitle>
        <AlertDescription>
          CR-06 can approve, preflight, and prepare immutable held work. It cannot construct a transport or send an external message.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Rollout manifest</CardTitle>
            <CardDescription>Explicit, replay-safe Liberty Bancard premium package.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <div className="font-medium">{manifest.data?.manifestVersion ?? "Loading…"}</div>
              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{manifest.data?.manifestHash}</div>
            </div>
            {manifest.data && (
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary">{manifest.data.counts.programs} programs</Badge>
                <Badge variant="secondary">{manifest.data.counts.sequences} sequences</Badge>
                <Badge variant="secondary">{manifest.data.counts.contents} emails</Badge>
                <Badge variant="secondary">{manifest.data.counts.manualTasks} tasks</Badge>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => rollout.mutate(true)}>Dry run</Button>
              <Button size="sm" disabled={busy} onClick={() => rollout.mutate(false)}>Apply exact manifest</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Governed catalog</CardTitle>
            <CardDescription>Legacy objects remain visible and review-required; no approval history is inferred.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {programs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Apply the rollout manifest to install the three review-ready programs.</p>
            ) : programs.map((program) => (
              <div key={program.id} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">{program.document.name ?? program.identityKey}</div>
                  <div className="text-xs text-muted-foreground">{program.document.audience}</div>
                  <div className="mt-1 flex gap-1">
                    <Badge>{program.governanceState}</Badge>
                    <Badge variant="outline">{program.preparationState}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setProgramId(program.id)}>Bind</Button>
                  {program.governanceState === "review_ready" && (
                    <Button size="sm" disabled={busy} onClick={() => approve.mutate(program)}>Approve exact package</Button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Legacy: {catalog.data?.legacy.campaigns.length ?? 0} campaigns and {catalog.data?.legacy.sequences.length ?? 0} sequences classified as review-required.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="cro07-status-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> CRO-07 controlled delivery, reply & feedback
          </CardTitle>
          <CardDescription>
            Separate release/reconciliation authority layered on immutable CR-06 held intents. Never overwrites CR-06 history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cro07Status.data ? (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">Code complete: {cro07Status.data.codeComplete ? "YES" : "NO"}</Badge>
                <Badge variant={cro07Status.data.productionConnected ? "destructive" : "outline"}>
                  Production connected: {cro07Status.data.productionConnected ? "YES" : "NO"}
                </Badge>
                <Badge variant={cro07Status.data.sendingEnabled ? "destructive" : "outline"}>
                  Sending enabled: {cro07Status.data.sendingEnabled ? "YES" : "NO"}
                </Badge>
                <Badge variant="outline">Outreach: {cro07Status.data.outreach}</Badge>
                <Badge variant={cro07Status.data.authorized ? "destructive" : "outline"}>
                  {cro07Status.data.authorized ? "AUTHORIZED" : "NOT AUTHORIZED"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{cro07Status.data.message}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading CRO-07 status…</p>
          )}
          <div className="text-xs text-muted-foreground">
            Canonical event taxonomy: {cro07Taxonomy.data ? `v${cro07Taxonomy.data[0]?.version ?? 1} · ${cro07Taxonomy.data.length} canonical events registered` : "loading…"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frozen cohort preparation</CardTitle>
          <CardDescription>Bind one approved version to one existing frozen CR-04 email cohort. Maximum 250 recipients.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px]">
            <div className="space-y-1">
              <Label htmlFor="cr06-program">Program artifact ID</Label>
              <Input id="cr06-program" value={programId} onChange={(event) => setProgramId(event.target.value)} placeholder="Approved program UUID" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cr06-cohort">Frozen CR-04 cohort run ID</Label>
              <Input id="cr06-cohort" value={cohortRunId} onChange={(event) => setCohortRunId(event.target.value)} placeholder="Frozen cohort UUID" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cr06-cap">Cap</Label>
              <Input id="cr06-cap" type="number" min={1} max={250} value={cap} onChange={(event) => setCap(Math.min(250, Math.max(1, Number(event.target.value))))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !programId || !cohortRunId} onClick={() => runPreflight.mutate()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Read-only preflight
            </Button>
            <Button variant="outline" disabled={busy || !preflight?.eligible} onClick={() => gate.mutate()}>
              Open exact campaign gate
            </Button>
            <Button disabled={busy || !preflight?.eligible} onClick={() => prepare.mutate()}>
              Prepare held — sending off
            </Button>
          </div>
          {preflight && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{preflight.summary.eligible}</div><div className="text-xs text-muted-foreground">Eligible</div></div>
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{preflight.summary.blocked}</div><div className="text-xs text-muted-foreground">Blocked</div></div>
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{preflight.summary.deferred}</div><div className="text-xs text-muted-foreground">Deferred</div></div>
            </div>
          )}
          {lastResult?.statusLabel && (
            <Alert className="border-emerald-500/50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>{lastResult.statusLabel}</AlertTitle>
              <AlertDescription>{lastResult.preparedCount} recipients prepared; provider attempts: {lastResult.providerAttemptCount}.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Command not applied</AlertTitle>
              <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}