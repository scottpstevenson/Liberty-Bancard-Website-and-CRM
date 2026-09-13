import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2, XCircle, Clock, Loader2, RefreshCw, Play,
  Zap, Database, FlaskConical, ShieldCheck, Globe, Mail,
  Settings, BarChart3, AlertTriangle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubsystemStatus {
  key: string;
  label: string;
  status: "active" | "inactive" | "pending";
  detail: string;
}

interface ActivationStatus {
  subsystems: SubsystemStatus[];
  canary: {
    completed: boolean;
    lastCompletedAt: string | null;
  };
}

interface CanaryResult {
  entityId: number;
  entityName: string;
  outcome: "promoted" | "skipped_duplicate" | "error";
  contactId?: number;
  recordClass?: string;
  vertical?: string;
  error?: string;
}

interface CanaryResponse {
  candidateCount: number;
  promoted: number;
  productionClassified: number;
  withVertical: number;
  summary: Record<string, number>;
  results: CanaryResult[];
  recommendation: string;
}

interface ContactEnrichProgress {
  status: "idle" | "running" | "complete" | "blocked" | "failed";
  total?: number;
  processed?: number;
  emailsFound?: number;
  phonesFound?: number;
  websitesFound?: number;
  errors?: number;
  backlogRemaining: number;
  gatewayBlocked?: boolean;
  startedAt?: string;
  completedAt?: string;
  lastUpdate?: string;
  error?: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SUBSYSTEM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sunbiz_enrichment_enabled: Zap,
  orchestrator_enabled: Settings,
  legacy_outreach_enabled: Mail,
  cro03_transport: ShieldCheck,
  serper_gateway: Globe,
  zerobounce: Mail,
  vertical_resolver: BarChart3,
  auto_convert: RefreshCw,
  classification: Database,
};

function StatusBadge({ status }: { status: SubsystemStatus["status"] }) {
  if (status === "active") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 gap-1">
      <XCircle className="h-3 w-3" />
      Inactive
    </Badge>
  );
}

function SubsystemRow({ subsystem }: { subsystem: SubsystemStatus }) {
  const Icon = SUBSYSTEM_ICONS[subsystem.key] ?? Settings;
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium font-mono">{subsystem.label}</span>
          <StatusBadge status={subsystem.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{subsystem.detail}</p>
      </div>
    </div>
  );
}

// Existing-contact backlog enrichment card (task #1943) — surfaces the same
// progress data enrichContactBatch() already writes to system_settings, plus
// a manual "run now" trigger for admins who don't want to wait for the
// recurring queue-manager tick.
function ContactBacklogEnrichmentCard() {
  const { toast } = useToast();

  const { data: progress, refetch } = useQuery<ContactEnrichProgress>({
    queryKey: ["/api/contacts/enrich-progress"],
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5_000 : 30_000),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contacts/enrich-batch", { limit: 100 });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/enrich-progress"] });
      toast({
        title: data.total ? "Enrichment batch started" : "Nothing to enrich",
        description: data.total
          ? `Processing ${data.total} contacts in the background.`
          : "No contacts are currently missing email, phone, or website.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Could not start enrichment batch",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const status = progress?.status ?? "idle";
  const isRunning = status === "running";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Existing-Contact Backlog Enrichment
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reconnected Serper-backed lookup for existing CRM contacts missing email, phone, or
          website. A recurring background tick claims a small batch every 10 minutes; you can
          also trigger a batch manually below. This path is independent of the CRO-03
          candidate-factory pipeline and its certification gate.
        </p>

        {status === "running" && (
          <Alert className="border-amber-200 bg-amber-50">
            <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />
            <AlertDescription className="text-amber-800 text-sm">
              Batch in progress — {progress?.processed ?? 0} of {progress?.total ?? 0} processed.
            </AlertDescription>
          </Alert>
        )}
        {status === "failed" && (
          <Alert className="border-red-200 bg-red-50">
            <XCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              Last run failed: {progress?.error ?? "unknown error"}
            </AlertDescription>
          </Alert>
        )}
        {status === "blocked" && (
          <Alert className="border-amber-200 bg-amber-50">
            <XCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-sm">
              Last run stopped early — the Serper gateway was disabled or its circuit was open.
              Untouched contacts were not attempted and remain in the backlog.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Backlog remaining", value: progress?.backlogRemaining ?? 0 },
            { label: "Processed (last run)", value: progress?.processed ?? 0 },
            { label: "Emails found", value: progress?.emailsFound ?? 0 },
            { label: "Phones found", value: progress?.phonesFound ?? 0 },
            { label: "Websites found", value: progress?.websitesFound ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {typeof progress?.errors === "number" && progress.errors > 0 && (
          <p className="text-xs text-red-600">{progress.errors} contacts errored on the last run.</p>
        )}
        {progress?.lastUpdate && (
          <p className="text-xs text-muted-foreground">
            Last update: {new Date(progress.lastUpdate).toLocaleString()}
          </p>
        )}

        <Button onClick={() => runMutation.mutate()} disabled={isRunning || runMutation.isPending}>
          {isRunning || runMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {isRunning ? "Batch running…" : "Starting…"}
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run batch now (up to 100)
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function EnrichmentActivationPanel() {
  const { toast } = useToast();

  const { data: status, isLoading, refetch } = useQuery<ActivationStatus>({
    queryKey: ["/api/admin/enrichment/activation-status"],
    refetchInterval: 60_000,
  });

  const canaryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/enrichment/canary");
      return res.json() as Promise<CanaryResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/enrichment/activation-status"] });
      toast({
        title: "Canary completed",
        description: `${data.promoted} promoted, ${data.productionClassified} classified as production.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Canary failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const canaryData = canaryMutation.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeCount = status?.subsystems.filter(s => s.status === "active").length ?? 0;
  const totalCount = status?.subsystems.length ?? 0;
  const allActive = activeCount === totalCount;

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Enrichment Subsystem Status</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {activeCount}/{totalCount} active
              </span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {allActive ? (
            <Alert className="border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-800 text-sm">
                All {totalCount} enrichment subsystems are active.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                {totalCount - activeCount} subsystem{totalCount - activeCount !== 1 ? "s" : ""} not yet active.
                Review the details below and enable flags as needed.
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 divide-y">
            {status?.subsystems.map(s => (
              <SubsystemRow key={s.key} subsystem={s} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Existing-contact backlog enrichment */}
      <ContactBacklogEnrichmentCard />

      {/* Phase 2 Canary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Phase 2 — Enrichment Canary (20 records)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Runs exactly 20 enriched Sunbiz entities through the full auto-convert pipeline and
            verifies that promoted contacts receive a canonical vertical and are classified as{" "}
            <code className="text-xs bg-muted px-1 rounded">production</code>. Complete this before
            enabling CRO-03 provider transport (Phase 3).
          </p>

          {status?.canary.completed && (
            <Alert className="border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-800 text-sm">
                Canary previously completed at{" "}
                {status.canary.lastCompletedAt
                  ? new Date(status.canary.lastCompletedAt).toLocaleString()
                  : "unknown time"}
                . You may re-run to verify the current state.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => canaryMutation.mutate()}
              disabled={canaryMutation.isPending}
              variant={status?.canary.completed ? "outline" : "default"}
            >
              {canaryMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Running canary…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run 20-record canary
                </>
              )}
            </Button>
            {status?.canary.completed && (
              <span className="text-xs text-muted-foreground">
                Last run:{" "}
                {status.canary.lastCompletedAt
                  ? new Date(status.canary.lastCompletedAt).toLocaleString()
                  : "unknown"}
              </span>
            )}
          </div>

          {canaryData && (
            <div className="rounded-md border p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Candidates", value: canaryData.candidateCount },
                  { label: "Promoted", value: canaryData.promoted },
                  { label: "Classified production", value: canaryData.productionClassified },
                  { label: "With vertical", value: canaryData.withVertical },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-2xl font-bold">{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
              <Separator />
              <p className="text-sm font-medium">{canaryData.recommendation}</p>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1 pr-2">Entity</th>
                      <th className="py-1 pr-2">Outcome</th>
                      <th className="py-1 pr-2">Class</th>
                      <th className="py-1">Vertical</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canaryData.results.map(r => (
                      <tr key={r.entityId} className="border-b border-muted/50">
                        <td className="py-1 pr-2 max-w-[140px] truncate" title={r.entityName}>
                          {r.entityName}
                        </td>
                        <td className="py-1 pr-2">
                          <span
                            className={
                              r.outcome === "promoted"
                                ? "text-emerald-700"
                                : r.outcome === "error"
                                  ? "text-red-600"
                                  : "text-amber-700"
                            }
                          >
                            {r.outcome}
                          </span>
                        </td>
                        <td className="py-1 pr-2">
                          {r.recordClass ? (
                            <span
                              className={
                                r.recordClass === "production"
                                  ? "text-emerald-700 font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {r.recordClass}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-1 text-muted-foreground">{r.vertical ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phase 3 gate notice */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Phase 3 — CRO-03 Provider Transport</p>
              <p className="text-xs text-muted-foreground mt-1">
                Live transport for Serper, Apollo, and Outscraper is controlled by the{" "}
                <code className="bg-muted px-1 rounded">CRO03_PROVIDER_TRANSPORT_ENABLED</code>{" "}
                environment secret. Set it to{" "}
                <code className="bg-muted px-1 rounded">true</code> after completing a signed CRO-03C
                approval ceremony (run{" "}
                <code className="bg-muted px-1 rounded">scripts/cro03d-run-ceremony.ts</code>). Enabling
                it will immediately trigger real provider API spend.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
