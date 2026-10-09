import { useState } from "react";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { operationsReportCsv } from "@/lib/operations-report-export";
import { operationsReportSchema, parseOperationsSpend, type OperationsReportData } from "@shared/operations-report";
import {
  DollarSign, TrendingUp, PhoneCall, FileCheck, Clock, AlertTriangle,
  Download, RefreshCw, Users, Zap, BarChart3, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ─── Types ────────────────────────────────────────────────────────────────────

type CplMetrics = OperationsReportData["cplBySource"][number];
type VerticalCloseRate = OperationsReportData["closeRateByVertical"][number];
type SequenceReplyRate = OperationsReportData["sequenceReplyRates"][number];
type FunnelStage = OperationsReportData["funnel"][number];
type OverdueTask = OperationsReportData["overdueTasks"][number];
type IncidentSummary = OperationsReportData["incidentSummary"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtPct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function downloadCsv(filename: string, rows: (string | number | null)[][], headers: string[], report: OperationsReportData) {
  const csv = operationsReportCsv(headers, rows, report);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function CplTable({ report }: { report: OperationsReportData }) {
  const { cplBySource: rows, adSpend } = report;
  const exportCsv = () => {
    downloadCsv(
      "cpl-by-source.csv",
      rows.map(r => [
        r.source,
        r.leads, r.bookedCalls, r.signedMerchants, r.cpl, r.cpb, r.cps,
      ]),
      ["Source", "Lead contacts", "Currently booked deals", "Currently won deals", "Estimated CPL", "Estimated cost/booked deal", "Estimated cost/won deal"], report,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" /> Estimated Cost Per Lead / Booked Deal / Won Deal
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
               {adSpend > 0 ? `Estimate only: $${adSpend.toLocaleString()} user-entered spend allocated proportionally by production lead volume` : "Enter user-supplied ad spend to estimate CPL/CPB/CPS; no authoritative spend source is connected"}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} data-testid="button-export-operations-cpl">
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {adSpend === 0 && (
          <Alert className="mb-3 border-blue-200 bg-blue-50 dark:bg-blue-950">
            <AlertDescription className="text-xs text-blue-800 dark:text-blue-200">
              Enter your total ad spend in the filter bar above to calculate CPL, cost per booked call, and cost per signed merchant.
            </AlertDescription>
          </Alert>
        )}
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Booked deals</TableHead>
                <TableHead className="text-right">Won deals</TableHead>
                <TableHead className="text-right">CPL</TableHead>
                <TableHead className="text-right">Cost/Booked</TableHead>
                <TableHead className="text-right">Cost/Signed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No lead data in this period.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{r.source}</TableCell>
                  <TableCell className="text-right">{r.leads.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{r.bookedCalls.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{r.signedMerchants.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-blue-700 dark:text-blue-300">
                    {r.cpl != null ? fmt$(r.cpl) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-indigo-700 dark:text-indigo-300">
                    {r.cpb != null ? fmt$(r.cpb) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-green-700 dark:text-green-300 font-semibold">
                    {r.cps != null ? fmt$(r.cps) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function CloseRateTable({ rows, report }: { rows: VerticalCloseRate[]; report: OperationsReportData }) {
  const exportCsv = () => {
    downloadCsv(
      "close-rate-by-vertical.csv",
      rows.map(r => [
        r.vertical,
        String(r.leads),
        String(r.booked),
        String(r.signed),
        r.leadToBooked, r.bookedToSigned, r.leadToSigned,
      ]),
      ["Vertical", "Lead contacts", "Booked deals", "Won deals", "Booked/lead ratio", "Won/booked ratio", "Won/lead ratio"], report,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-600" /> Current Deal-to-Lead Ratios by Vertical
          </CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vertical</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Signed</TableHead>
                <TableHead className="text-right">Lead→Booked</TableHead>
                <TableHead className="text-right">Booked→Signed</TableHead>
                <TableHead className="text-right">Lead→Signed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No vertical data in this period.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.vertical}</TableCell>
                  <TableCell className="text-right">{r.leads}</TableCell>
                  <TableCell className="text-right">{r.booked}</TableCell>
                  <TableCell className="text-right text-green-600 font-medium">{r.signed}</TableCell>
                  <TableCell className="text-right">{fmtPct(r.leadToBooked)}</TableCell>
                  <TableCell className="text-right">{fmtPct(r.bookedToSigned)}</TableCell>
                  <TableCell className="text-right">
                      <Badge variant={r.leadToSigned != null && r.leadToSigned >= 0.15 ? "default" : r.leadToSigned != null && r.leadToSigned > 0 ? "secondary" : "outline"}>
                      {fmtPct(r.leadToSigned)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SequenceReplyRateTable({ rows, report }: { rows: SequenceReplyRate[]; report: OperationsReportData }) {
  const exportCsv = () => {
    downloadCsv(
      "sequence-reply-rates.csv",
       rows.map(r => [r.id, r.name, r.status, r.enrolled, r.replies, r.replyRate]),
       ["Sequence ID", "Sequence", "Status", "Enrollment records", "Replies", "Reply ratio"], report,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
             <CardTitle className="text-base flex items-center gap-2">
               <Zap className="w-4 h-4 text-orange-500" /> Sequence Reply Attribution
            </CardTitle>
             <CardDescription className="text-xs mt-0.5">Unavailable until replies have an authoritative sequence attribution; conversions are not used as a proxy.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Enrolled</TableHead>
                 <TableHead className="text-right">Replies</TableHead>
                <TableHead className="text-right">Reply Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No sequence data in this period.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.enrolled}</TableCell>
                   <TableCell className="text-right text-muted-foreground">{r.replies ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                       {r.replyRate != null && <Progress value={Math.round(r.replyRate * 100)} className="w-16 h-1.5" />}
                      <span className="text-sm font-medium w-10 text-right">{fmtPct(r.replyRate)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelTable({ stages, report }: { stages: FunnelStage[]; report: OperationsReportData }) {
  const exportCsv = () => {
    downloadCsv(
      "funnel-conversion.csv",
      stages.map(s => [s.stage, s.count, s.pct]),
       ["Operational Fact", "Count", "Fact/lead ratio"], report,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
             <BarChart3 className="w-4 h-4 text-blue-500" /> Production Operational Facts
          </CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No funnel data in this period.</p>
          ) : stages.map((s) => (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="text-sm w-32 shrink-0 text-muted-foreground truncate">{s.stage}</span>
              <Progress value={Math.round((s.pct ?? 0) * 100)} className="flex-1 h-3" />
              <span className="text-sm font-semibold w-12 text-right">{s.count.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground w-10 text-right">{fmtPct(s.pct)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OverdueTasksTable({ tasks, report }: { tasks: OverdueTask[]; report: OperationsReportData }) {
  const exportCsv = () => {
    downloadCsv(
      "overdue-tasks.csv",
      tasks.map(t => [t.id, t.title, t.assignedTo ?? "Unassigned", t.dueDate, t.daysOverdue]),
      ["Task ID", "Task", "Assigned To", "Due Date", "Days Overdue"], report,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-red-500" /> Loaded Overdue Tasks (up to 50)
            {tasks.length > 0 && <Badge variant="destructive">{tasks.length}</Badge>}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={tasks.length === 0}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No overdue tasks — great job!</p>
        ) : (
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Days Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[200px] truncate font-medium">{t.title}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.assignedTo ?? "Unassigned"}</TableCell>
                    <TableCell className="text-sm">{new Date(t.dueDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={t.daysOverdue > 7 ? "destructive" : "secondary"}>
                        {t.daysOverdue}d
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IncidentSummaryCard({ summary }: { summary: IncidentSummary }) {
  const total = summary.queueFailures7d + summary.ghlSyncFailures7d;
  return (
    <Card className={total > 0 ? "border-red-200" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${total > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          Incident Summary — Last 7 Days
          {total > 0 && <Badge variant="destructive">{total}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Queue Failures</p>
            <p className={`text-2xl font-bold ${summary.queueFailures7d > 0 ? "text-red-600" : "text-green-600"}`}>
              {summary.queueFailures7d}
            </p>
            {summary.mostRecentQueueIncident && (
              <p className="text-xs text-muted-foreground">{summary.mostRecentQueueIncident.code} · {summary.mostRecentQueueIncident.category} · {new Date(summary.mostRecentQueueIncident.occurredAt).toLocaleString()}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">GHL Sync Failures</p>
            <p className={`text-2xl font-bold ${summary.ghlSyncFailures7d > 0 ? "text-orange-600" : "text-green-600"}`}>
              {summary.ghlSyncFailures7d}
            </p>
            {summary.mostRecentGhlIncident && (
              <p className="text-xs text-muted-foreground">{summary.mostRecentGhlIncident.code} · {summary.mostRecentGhlIncident.category} · {new Date(summary.mostRecentGhlIncident.occurredAt).toLocaleString()}</p>
            )}
          </div>
        </div>
        {total > 0 && (
          <Alert className="mt-3 border-yellow-200 bg-yellow-50 dark:bg-yellow-950">
            <AlertDescription className="text-xs">
              Visit <strong>System Health → Incidents</strong> tab to retry failed jobs and GHL sync operations.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OperationsReport() {
  const [days, setDays] = useState("30");
  const [adSpend, setAdSpend] = useState("");
  const [adSpendApplied, setAdSpendApplied] = useState(0);
  const [spendError, setSpendError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<OperationsReportData>({
    queryKey: ["/api/reporting/operations", days, adSpendApplied],
    queryFn: async ({signal}) => {
      const params = new URLSearchParams({ days, adSpend: String(adSpendApplied) });
      const res = await fetch(`/api/reporting/operations?${params}`, { credentials: "include",signal });
      if (!res.ok) throw new Error("Failed to load operations report");
      const parsed = operationsReportSchema.safeParse(await res.json());
      if (!parsed.success || parsed.data.days !== Number(days) || parsed.data.adSpend !== adSpendApplied) {
        throw new Error("Operations report response is malformed or belongs to a different filter.");
      }
      return parsed.data;
    },
  });

  const applyFilters = () => {
    try {
      const spendVal = parseOperationsSpend(adSpend || "0");
      setSpendError(null);
      if (spendVal === adSpendApplied) void refetch();
      else setAdSpendApplied(spendVal);
    } catch (error) { setSpendError((error as Error).message); }
  };

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading operations report…
      </div>
    );
  }

  if (isError || !data || !data.meta?.exact) {
    return <div role="alert" className="py-8 text-center text-destructive">Operations report unavailable: {error instanceof Error ? error.message : "failed to load data."}
      <Button variant="outline" onClick={() => void refetch()} data-testid="button-retry-operations" className="ml-3">Retry</Button>
    </div>;
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="operations-period" className="text-xs">Date Range</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger id="operations-period" className="w-32 min-h-11 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="60">Last 60 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="operations-spend" className="text-xs">User-entered spend estimate (USD)</Label>
              <Input
                id="operations-spend" data-testid="input-operations-spend" inputMode="decimal"
                aria-invalid={!!spendError} aria-describedby={spendError ? "operations-spend-error" : undefined}
                className="w-36 min-h-11 text-sm"
                placeholder="e.g. 4500"
                value={adSpend}
                onChange={(e) => setAdSpend(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={applyFilters} className="min-h-11" data-testid="button-apply-operations">
              <Filter className="w-3 h-3 mr-1" /> Apply
            </Button>
          </div>
          {spendError && <p id="operations-spend-error" role="alert" className="mt-2 text-sm text-destructive">{spendError}</p>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Captured around {new Date(data.meta.asOf).toLocaleString()} · Scope: {data.meta.scope}. Snapshot consistency is unavailable because sources are queried independently.
      </p>
      <p className="text-xs text-muted-foreground">Spend estimate assumption: {data.meta.spendAllocation.assumption}</p>
      <p className="text-xs text-muted-foreground">UTC window: {data.meta.period.startInclusive} inclusive to {data.meta.period.endExclusive} exclusive. {data.meta.period.basis} Operational facts have independent denominators, not a cohort conversion funnel.</p>

      {/* CPL by source */}
      <CplTable report={data}/>

      {/* Close rate by vertical */}
      <CloseRateTable rows={data.closeRateByVertical} report={data}/>

      {/* Sequence reply rates */}
      <SequenceReplyRateTable rows={data.sequenceReplyRates} report={data}/>

      {/* Funnel conversion */}
      <FunnelTable stages={data.funnel} report={data}/>

      {/* Overdue tasks */}
      <OverdueTasksTable tasks={data.overdueTasks} report={data}/>

      {/* Incident summary */}
      <IncidentSummaryCard summary={data.incidentSummary} />
    </div>
  );
}
