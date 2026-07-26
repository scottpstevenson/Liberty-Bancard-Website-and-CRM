import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/ui/page-header";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Copy,
  Clock,
  ChevronDown,
  ChevronRight,
  Users,
  Database,
  FileSearch,
  Shield,
  GitBranch,
  CheckSquare,
  Calendar,
  MessageSquare,
  Headphones,
  Bot,
  ClipboardList,
  Workflow,
  FileText,
  Scale,
  FolderLock,
  Globe,
  Zap,
  Mail,
  Webhook,
  Activity,
  PauseCircle,
  BookOpen,
  BarChart3,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { IntegrationReadiness } from "@/components/dashboard/IntegrationReadiness";

// ─── Types ────────────────────────────────────────────────────────────────────
type SubsystemStatus = "pass" | "warn" | "fail" | "disabled";

interface SubsystemResult {
  id: string;
  name: string;
  status: SubsystemStatus;
  evidence: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

interface FullReport {
  subsystems: SubsystemResult[];
  summary: { total: number; pass: number; warn: number; fail: number; disabled: number };
  verdict: "GO" | "WARN" | "NO-GO";
  checkedAt: string;
}

// Legacy gate types (from existing /api/admin/launch-readiness)
interface Gate {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
  ownerAction?: string;
}

// ─── Icons map ───────────────────────────────────────────────────────────────
const SUBSYSTEM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  staff_roles: Users,
  contacts: Database,
  lead_database: Database,
  lead_imports: FileSearch,
  dedupe_suppression: Shield,
  pipeline_deals: GitBranch,
  tasks: CheckSquare,
  calendar: Calendar,
  comms_hub: MessageSquare,
  support_hub: Headphones,
  ai_advisor: Bot,
  merchant_applications: ClipboardList,
  onboarding: Workflow,
  statement_review: FileText,
  underwriting: Scale,
  document_vault: FolderLock,
  form_submissions: Globe,
  ghl_sync: Zap,
  ghl_email: Mail,
  gmail: Mail,
  webhooks: Webhook,
  queue_health: Activity,
  outbound_pause: PauseCircle,
  audit_log: BookOpen,
  reporting: BarChart3,
};

// ─── Status helpers ───────────────────────────────────────────────────────────
function statusColor(s: SubsystemStatus): string {
  if (s === "pass") return "text-green-600 dark:text-green-400";
  if (s === "warn") return "text-yellow-600 dark:text-yellow-400";
  if (s === "fail") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function StatusIcon({ status }: { status: SubsystemStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />;
  if (status === "fail") return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
  return <div className="h-5 w-5 rounded-full border-2 border-muted shrink-0" />;
}

function StatusBadge({ status }: { status: SubsystemStatus }) {
  if (status === "pass") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-xs font-semibold">✅ Pass</Badge>;
  if (status === "warn") return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 text-xs font-semibold">⚠ Warning</Badge>;
  if (status === "fail") return <Badge variant="destructive" className="text-xs font-semibold">❌ Fail</Badge>;
  return <Badge variant="outline" className="text-xs font-semibold text-muted-foreground">⏸ Disabled</Badge>;
}

// ─── Subsystem Card ───────────────────────────────────────────────────────────
function SubsystemCard({ result }: { result: SubsystemResult }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = SUBSYSTEM_ICONS[result.id] ?? Activity;
  const hasDetails = result.details && Object.keys(result.details).length > 0;
  const borderColor = result.status === "pass" ? "border-green-200 dark:border-green-900/40"
    : result.status === "warn" ? "border-yellow-200 dark:border-yellow-900/40"
    : result.status === "fail" ? "border-red-200 dark:border-red-900/40"
    : "border-border";

  return (
    <Card className={`${borderColor} border transition-shadow hover:shadow-sm`}>
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${statusColor(result.status)}`} />
            <span className="font-medium text-sm leading-tight">{result.name}</span>
          </div>
          <StatusBadge status={result.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <p className="text-xs text-muted-foreground leading-relaxed">{result.evidence}</p>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(result.checkedAt).toLocaleTimeString()}
          </span>
          {hasDetails && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              details
            </button>
          )}
        </div>
        {expanded && hasDetails && (
          <pre className="mt-2 text-xs font-mono bg-muted/50 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">
            {JSON.stringify(result.details, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Copy Report ─────────────────────────────────────────────────────────────
function buildMarkdownReport(report: FullReport): string {
  const lines: string[] = [
    "# CRM Launch-Readiness Audit Report",
    `**Generated:** ${new Date(report.checkedAt).toLocaleString()}`,
    `**Verdict:** ${report.verdict}`,
    `**Summary:** ${report.summary.pass} Pass · ${report.summary.warn} Warning · ${report.summary.fail} Fail · ${report.summary.total} Total`,
    "",
    "## Subsystem Checks",
    "",
  ];
  for (const s of report.subsystems) {
    const icon = s.status === "pass" ? "✅" : s.status === "warn" ? "⚠️" : s.status === "fail" ? "❌" : "⏸";
    lines.push(`### ${icon} ${s.name}`);
    lines.push(`**Status:** ${s.status.toUpperCase()}`);
    lines.push(`**Evidence:** ${s.evidence}`);
    lines.push(`**Checked:** ${new Date(s.checkedAt).toLocaleString()}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("*Report generated from Liberty Bancard CRM Launch-Readiness Audit Panel*");
  return lines.join("\n");
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LaunchReadiness() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"full" | "infra">("full");

  // Full 25-subsystem report
  const { data: fullReport, isLoading: fullLoading, refetch: refetchFull, isFetching: fullFetching } = useQuery<FullReport>({
    queryKey: ["/api/admin/launch-readiness-full"],
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  // Run all checks now (POST triggers immediate re-run)
  const runAll = useMutation({
    mutationFn: async (): Promise<FullReport> => {
      const res = await apiRequest("POST", "/api/admin/launch-readiness-full/run");
      return res.json();
    },
    onSuccess: (data: FullReport) => {
      qc.setQueryData(["/api/admin/launch-readiness-full"], data);
      toast({ title: "Checks complete", description: `Verdict: ${data.verdict} · ${data.summary.pass}/${data.summary.total} passed` });
    },
    onError: (e: any) => toast({ title: "Check run failed", description: e.message, variant: "destructive" }),
  });

  // Copy report
  function copyReport() {
    if (!fullReport) return;
    const md = buildMarkdownReport(fullReport);
    navigator.clipboard.writeText(md).then(() => {
      toast({ title: "Report copied", description: "Markdown report copied to clipboard" });
    }).catch(() => {
      toast({ title: "Copy failed", description: "Use browser context menu to copy", variant: "destructive" });
    });
  }

  // Summary banner
  const verdict = fullReport?.verdict;
  const summary = fullReport?.summary;

  const verdictBg = verdict === "GO"
    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
    : verdict === "WARN"
    ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
    : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";

  // Group subsystems by status for prioritized display
  const fails = fullReport?.subsystems.filter(s => s.status === "fail") ?? [];
  const warns = fullReport?.subsystems.filter(s => s.status === "warn") ?? [];
  const passes = fullReport?.subsystems.filter(s => s.status === "pass") ?? [];
  const disabled = fullReport?.subsystems.filter(s => s.status === "disabled") ?? [];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Launch Readiness"
        subtitle="25-subsystem audit — pass/fail evidence for every major CRM function. Auto-refreshes every 60 seconds."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyReport} disabled={!fullReport} data-testid="button-copy-report">
              <Copy className="h-4 w-4 mr-2" />
              Copy Report
            </Button>
            <Button
              size="sm"
              onClick={() => runAll.mutate()}
              disabled={runAll.isPending}
              data-testid="button-run-all-checks"
            >
              {runAll.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run All Checks Now
            </Button>
          </div>
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("full")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "full" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          25-Subsystem Audit
        </button>
        <button
          onClick={() => setActiveTab("infra")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "infra" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Infrastructure Gates
        </button>
      </div>

      {activeTab === "full" && (
        <>
          {/* Verdict banner */}
          {fullLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <Card key={i} className="animate-pulse"><CardContent className="h-28" /></Card>
              ))}
            </div>
          ) : fullReport ? (
            <>
              {/* Summary banner */}
              <div className={`flex items-center gap-4 rounded-lg border px-5 py-4 ${verdictBg}`}>
                {verdict === "GO"
                  ? <CheckCircle2 className="h-8 w-8 text-green-600 shrink-0" />
                  : verdict === "WARN"
                  ? <AlertTriangle className="h-8 w-8 text-yellow-600 shrink-0" />
                  : <XCircle className="h-8 w-8 text-red-600 shrink-0" />}
                <div className="flex-1">
                  <p className="font-bold text-lg">
                    {verdict === "GO" ? "GO — All 25 subsystems passing" : verdict === "WARN" ? `WARN — ${summary?.warn} subsystem(s) need attention` : `NO-GO — ${summary?.fail} subsystem(s) failing`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {summary?.pass} pass · {summary?.warn} warning · {summary?.fail} fail · checked {new Date(fullReport.checkedAt).toLocaleString()}
                    {" · "}
                    <button className="underline text-xs" onClick={() => refetchFull()} disabled={fullFetching}>
                      {fullFetching ? "refreshing…" : "refresh"}
                    </button>
                  </p>
                </div>
                {/* Mini stat pills */}
                <div className="hidden sm:flex gap-2 shrink-0">
                  <span className="rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-bold px-3 py-1">{summary?.pass} Pass</span>
                  {(summary?.warn ?? 0) > 0 && <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-xs font-bold px-3 py-1">{summary?.warn} Warn</span>}
                  {(summary?.fail ?? 0) > 0 && <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-bold px-3 py-1">{summary?.fail} Fail</span>}
                </div>
              </div>

              {/* Failures first */}
              {fails.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4" /> Failing ({fails.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {fails.map(s => <SubsystemCard key={s.id} result={s} />)}
                  </div>
                </section>
              )}

              {/* Warnings */}
              {warns.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Warnings ({warns.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {warns.map(s => <SubsystemCard key={s.id} result={s} />)}
                  </div>
                </section>
              )}

              {/* Passing */}
              {passes.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Passing ({passes.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {passes.map(s => <SubsystemCard key={s.id} result={s} />)}
                  </div>
                </section>
              )}

              {disabled.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <PauseCircle className="h-4 w-4" /> Disabled by Design ({disabled.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {disabled.map(s => <SubsystemCard key={s.id} result={s} />)}
                  </div>
                </section>
              )}

              {/* Markdown preview / export */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Export for Scott's Records</CardTitle>
                    <Button variant="outline" size="sm" onClick={copyReport} data-testid="button-copy-report-bottom">
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Markdown Report
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Click "Copy Markdown Report" to copy a full audit summary to clipboard. The report includes all 25 subsystem statuses, evidence notes, and timestamps — formatted for Notion, Slack, or email.
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Failed to load launch readiness data. Check server logs.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {activeTab === "infra" && (
        <InfraGates />
      )}
    </div>
  );
}

// ─── Infrastructure gates tab (legacy P0 gates) ───────────────────────────────
function InfraGates() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<any>({
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse"><CardContent className="h-32" /></Card>
        ))}
      </div>
    );
  }
  if (!data) return <div className="text-destructive text-sm">Failed to load infrastructure gates.</div>;

  const isGo = data.verdict === "GO";

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-4 rounded-lg border px-5 py-4 ${isGo ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800" : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"}`}>
        {isGo ? <CheckCircle2 className="h-7 w-7 text-green-600" /> : <XCircle className="h-7 w-7 text-red-600" />}
        <div>
          <p className="font-semibold">{data.verdict} — P0 Infrastructure Gates</p>
          <p className="text-xs text-muted-foreground mt-0.5">Checked at {new Date(data.timestamp).toLocaleString()}</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">P0 Launch Gates</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {(data.gates ?? []).map((g: Gate) => (
            <div key={g.id} className="flex items-start gap-3 py-2.5">
              {g.pass ? <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{g.label}</span>
                  <Badge variant={g.pass ? "default" : "destructive"} className="text-xs">{g.pass ? "PASS" : "FAIL"}</Badge>
                </div>
                {g.detail && <p className="text-xs text-muted-foreground mt-0.5">{g.detail}</p>}
                {!g.pass && g.ownerAction && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">⚠ Action: {g.ownerAction}</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">BullMQ Queues</CardTitle>
              <Badge variant={(data.queues?.length ?? 0) >= 8 ? "default" : "destructive"}>
                {data.queues?.length ?? 0} registered
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.queues ?? []).map((q: any) => (
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
              {(data.queues ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No queue metrics available.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Database Backups</CardTitle>
              <Button size="sm" variant="outline" onClick={() => runBackup.mutate()} disabled={runBackup.isPending} data-testid="button-run-backup">
                {runBackup.isPending ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Run Now
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(data.backups ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet. Run one to establish baseline.</p>
            ) : (
              <div className="space-y-2">
                {(data.backups ?? []).map((b: any, i: number) => (
                  <div key={i} className="text-sm">
                    <div className="font-mono text-xs truncate">{b.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {(b.sizeBytes / 1024).toFixed(1)} KB{b.triggeredBy && ` · ${b.triggeredBy}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(data.recentAlerts ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Critical Alert Feed
              {(data.recentAlerts ?? []).filter((a: any) => !a.acknowledged).length > 0 && (
                <Badge variant="destructive">{(data.recentAlerts ?? []).filter((a: any) => !a.acknowledged).length} unacknowledged</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.recentAlerts ?? []).map((a: any) => (
                <div key={a.id} className={`flex items-start gap-3 p-2 rounded text-sm border ${a.acknowledged ? "opacity-50" : a.severity === "critical" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} className="text-xs">{a.severity}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{a.subsystem}</span>
                      <span className="text-xs text-muted-foreground"><Clock className="inline h-3 w-3 mr-0.5" />{new Date(a.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-0.5">{a.summary}</p>
                  </div>
                  {!a.acknowledged && (
                    <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => ackAlert.mutate(a.id)} data-testid={`button-ack-alert-${a.id}`}>Ack</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />
      <div>
        <h2 className="text-base font-semibold mb-3">Secrets &amp; Integration Readiness</h2>
        <IntegrationReadiness />
      </div>

      {data.canonicalUrl && (
        <p className="text-xs text-muted-foreground text-center">
          Canonical URL: <strong>{data.canonicalUrl.url}</strong> · Source: <strong>{data.canonicalUrl.source}</strong>
        </p>
      )}
    </div>
  );
}
