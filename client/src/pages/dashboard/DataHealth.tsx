import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Database,
  Loader2, Play, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DataHealthSummary {
  orphanedDeals: number;
  orphanedEnrollments: number;
  contactsNullLifecycle: number;
  activeEnrollmentsNoNextAction: number;
  contactsEmailInconsistency: number;
  dealsNoGhlOpportunityId: number;
}

interface OrphanedDeal { id: number; stage: string; created_at: string }
interface OrphanedEnrollment { id: number; contact_id: number; sequence_id: number; status: string }
interface NullLifecycleContact { id: number; email: string; created_at: string }

interface DataHealthReport {
  generatedAt: string;
  summary: DataHealthSummary;
  samples: {
    orphanedDeals: OrphanedDeal[];
    orphanedEnrollments: OrphanedEnrollment[];
    contactsNullLifecycle: NullLifecycleContact[];
  };
}

interface ReconcileResult {
  message: string;
  output?: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function severityClass(n: number, warn = 1, error = 10): "ok" | "warn" | "error" {
  if (n === 0) return "ok";
  if (n < error) return "warn";
  return "error";
}

function SeverityIcon({ n, warn, error }: { n: number; warn?: number; error?: number }) {
  const s = severityClass(n, warn, error);
  if (s === "ok") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function CountBadge({ n }: { n: number }) {
  const cls = n === 0
    ? "bg-green-50 text-green-700 border-green-200"
    : n < 10
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {n.toLocaleString()}
    </span>
  );
}

function MetricRow({
  label,
  description,
  value,
  warn,
  error,
}: {
  label: string;
  description: string;
  value: number;
  warn?: number;
  error?: number;
}) {
  return (
    <div className="flex items-center justify-between py-2 text-sm border-b last:border-0">
      <div className="flex items-start gap-2">
        <div className="pt-0.5"><SeverityIcon n={value} warn={warn} error={error} /></div>
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <CountBadge n={value} />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DataHealth() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dealsOpen, setDealsOpen] = useState(false);
  const [enrollmentsOpen, setEnrollmentsOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [reconcileOutput, setReconcileOutput] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<DataHealthReport>({
    queryKey: ["/api/admin/data-health"],
    refetchInterval: 120_000,
  });

  const reconcileMutation = useMutation<ReconcileResult>({
    mutationFn: () => apiRequest("POST", "/api/admin/data-health/reconcile").then(r => r.json()),
    onSuccess: (result: ReconcileResult) => {
      setReconcileOutput(result.output ?? result.message ?? "Reconcile triggered.");
      toast({ title: "Reconcile started", description: "Orphan cleanup is running in the background." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/admin/data-health"] }), 3000);
    },
    onError: (err: any) => toast({ title: "Reconcile failed", description: err.message, variant: "destructive" }),
  });

  const summary = data?.summary;
  const totalIssues = summary
    ? summary.orphanedDeals + summary.orphanedEnrollments + summary.contactsNullLifecycle + summary.activeEnrollmentsNoNextAction + summary.contactsEmailInconsistency
    : 0;

  const overallStatus: "ok" | "warn" | "error" = !summary
    ? "ok"
    : (summary.orphanedDeals > 10 || summary.orphanedEnrollments > 10 || summary.contactsNullLifecycle > 10 || summary.activeEnrollmentsNoNextAction > 10)
      ? "error"
      : totalIssues > 0
        ? "warn"
        : "ok";

  const overallColor = overallStatus === "ok" ? "text-green-600" : overallStatus === "warn" ? "text-amber-600" : "text-red-600";
  const overallLabel = overallStatus === "ok" ? "Clean" : overallStatus === "warn" ? "Needs Attention" : "Critical";

  return (
    <>
      <Helmet>
        <title>Data Health — Liberty Bancard</title>
      </Helmet>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              Data Health
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Detect orphaned records, missing lifecycle states, and enrollment gaps.
              {data && (
                <span className="ml-2 text-xs">
                  Last checked {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {/* Overall status banner */}
        {summary && (
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${
            overallStatus === "ok" ? "bg-green-50 border-green-200" :
            overallStatus === "warn" ? "bg-amber-50 border-amber-200" :
            "bg-red-50 border-red-200"
          }`}>
            {overallStatus === "ok"
              ? <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              : overallStatus === "warn"
                ? <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                : <XCircle className="h-5 w-5 text-red-600 shrink-0" />}
            <div>
              <p className={`font-semibold ${overallColor}`}>{overallLabel}</p>
              <p className="text-sm text-muted-foreground">
                {totalIssues === 0
                  ? "No data integrity issues detected."
                  : `${totalIssues.toLocaleString()} issue(s) detected across tracked metrics.`}
              </p>
            </div>
          </div>
        )}

        {/* Metrics grid */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Integrity Metrics</CardTitle>
            <CardDescription>
              Counts are live against the database. Zero is healthy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : isError ? (
              <p className="text-sm text-red-600 py-4">Failed to load data health. Check server logs.</p>
            ) : summary ? (
              <div className="divide-y">
                <MetricRow
                  label="Orphaned deals"
                  description="Deals with no linked contact — will never appear in CRM pipeline."
                  value={summary.orphanedDeals}
                  warn={1}
                  error={10}
                />
                <MetricRow
                  label="Orphaned sequence enrollments"
                  description="Active/paused enrollments whose sequence has been deleted — stuck forever."
                  value={summary.orphanedEnrollments}
                  warn={1}
                  error={10}
                />
                <MetricRow
                  label="Contacts with null lifecycle state"
                  description="Non-archived contacts missing lifecycle_state — may be invisible to NBA engine."
                  value={summary.contactsNullLifecycle}
                  warn={1}
                  error={25}
                />
                <MetricRow
                  label="Active enrollments with no next_action_at"
                  description="Enrollments that will never fire — sequence worker skips them."
                  value={summary.activeEnrollmentsNoNextAction}
                  warn={1}
                  error={10}
                />
                <MetricRow
                  label="No-email contacts flagged active"
                  description="Contacts with email_status='active' but no email address — misleadingly contactable."
                  value={summary.contactsEmailInconsistency}
                  warn={5}
                  error={50}
                />
                <MetricRow
                  label="Deals missing GHL opportunity ID"
                  description="Sales/onboarding deals >1h old with no ghl_opportunity_id — GHL sync gap."
                  value={summary.dealsNoGhlOpportunityId}
                  warn={10}
                  error={100}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Sample rows — orphaned deals */}
        {data?.samples?.orphanedDeals?.length ? (
          <Collapsible open={dealsOpen} onOpenChange={setDealsOpen}>
            <Card>
              <CardHeader className="pb-2">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
                  <div>
                    <CardTitle className="text-sm font-semibold">Orphaned Deals (sample)</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Up to 25 most recent — fix by linking to a contact or archiving.</CardDescription>
                  </div>
                  {dealsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Deal ID</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.samples.orphanedDeals.map(d => (
                          <TableRow key={d.id}>
                            <TableCell className="font-mono text-xs">#{d.id}</TableCell>
                            <TableCell>{d.stage}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ) : null}

        {/* Sample rows — orphaned enrollments */}
        {data?.samples?.orphanedEnrollments?.length ? (
          <Collapsible open={enrollmentsOpen} onOpenChange={setEnrollmentsOpen}>
            <Card>
              <CardHeader className="pb-2">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
                  <div>
                    <CardTitle className="text-sm font-semibold">Orphaned Enrollments (sample)</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Enrollments whose sequence no longer exists. Safe to delete.</CardDescription>
                  </div>
                  {enrollmentsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Enrollment ID</TableHead>
                          <TableHead>Contact ID</TableHead>
                          <TableHead>Sequence ID</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.samples.orphanedEnrollments.map(e => (
                          <TableRow key={e.id}>
                            <TableCell className="font-mono text-xs">#{e.id}</TableCell>
                            <TableCell className="font-mono text-xs">#{e.contact_id}</TableCell>
                            <TableCell className="font-mono text-xs">#{e.sequence_id}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{e.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ) : null}

        {/* Sample rows — null lifecycle contacts */}
        {data?.samples?.contactsNullLifecycle?.length ? (
          <Collapsible open={lifecycleOpen} onOpenChange={setLifecycleOpen}>
            <Card>
              <CardHeader className="pb-2">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
                  <div>
                    <CardTitle className="text-sm font-semibold">Contacts Missing Lifecycle State (sample)</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Run the lifecycle backfill script to repair.</CardDescription>
                  </div>
                  {lifecycleOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contact ID</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.samples.contactsNullLifecycle.map(c => (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs">#{c.id}</TableCell>
                            <TableCell className="text-xs">{c.email}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ) : null}

        {/* Reconcile action */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Auto-Reconcile Orphans</CardTitle>
            <CardDescription>
              Runs the reconcile-orphans script in the background. Deletes orphaned enrollments and
              updates deals with null contact_id. Safe to run at any time — no contacts are deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              className="flex items-center gap-2"
            >
              {reconcileMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                : <><Play className="h-4 w-4" /> Run Reconcile Now</>}
            </Button>
            {reconcileOutput && (
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-48">
                {reconcileOutput}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
