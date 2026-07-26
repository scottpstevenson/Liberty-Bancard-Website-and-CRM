import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

interface CplMetrics {
  source: string;
  leads: number;
  bookedCalls: number;
  signedMerchants: number;
  cpl: number | null;
  cpb: number | null;
  cps: number | null;
}

interface VerticalCloseRate {
  vertical: string;
  leads: number;
  booked: number;
  signed: number;
  leadToBooked: number;
  bookedToSigned: number;
  leadToSigned: number;
}

interface SequenceReplyRate {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  converted: number;
  replyRate: number;
}

interface FunnelStage {
  stage: string;
  count: number;
  pct: number;
}

interface OverdueTask {
  id: number;
  title: string;
  assignedTo: string | null;
  dueDate: string;
  daysOverdue: number;
}

interface IncidentSummary {
  queueFailures7d: number;
  ghlSyncFailures7d: number;
  mostRecentQueueError: string | null;
  mostRecentGhlError: string | null;
}

interface OperationsReportData {
  days: number;
  adSpend: number;
  cplBySource: CplMetrics[];
  closeRateByVertical: VerticalCloseRate[];
  sequenceReplyRates: SequenceReplyRate[];
  funnel: FunnelStage[];
  overdueTasks: OverdueTask[];
  incidentSummary: IncidentSummary;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function downloadCsv(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function CplTable({ rows, adSpend }: { rows: CplMetrics[]; adSpend: number }) {
  const exportCsv = () => {
    downloadCsv(
      "cpl-by-source.csv",
      rows.map(r => [
        r.source,
        String(r.leads),
        String(r.bookedCalls),
        String(r.signedMerchants),
        r.cpl != null ? fmt$(r.cpl) : "N/A",
        r.cpb != null ? fmt$(r.cpb) : "N/A",
        r.cps != null ? fmt$(r.cps) : "N/A",
      ]),
      ["Source", "Leads", "Booked Calls", "Signed Merchants", "CPL", "Cost/Booked", "Cost/Signed"],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" /> Cost Per Lead / Booked / Signed
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {adSpend > 0 ? `Based on $${adSpend.toLocaleString()} ad spend input` : "Enter ad spend above to see CPL/CPB/CPS"}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}>
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
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Signed</TableHead>
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

function CloseRateTable({ rows }: { rows: VerticalCloseRate[] }) {
  const exportCsv = () => {
    downloadCsv(
      "close-rate-by-vertical.csv",
      rows.map(r => [
        r.vertical,
        String(r.leads),
        String(r.booked),
        String(r.signed),
        fmtPct(r.leadToBooked),
        fmtPct(r.bookedToSigned),
        fmtPct(r.leadToSigned),
      ]),
      ["Vertical", "Leads", "Booked", "Signed", "Lead→Booked", "Booked→Signed", "Lead→Signed"],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-600" /> Close Rate by Vertical
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
                    <Badge variant={r.leadToSigned >= 0.15 ? "default" : r.leadToSigned > 0 ? "secondary" : "outline"}>
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

function SequenceReplyRateTable({ rows }: { rows: SequenceReplyRate[] }) {
  const exportCsv = () => {
    downloadCsv(
      "sequence-reply-rates.csv",
      rows.map(r => [r.name, r.status, String(r.enrolled), String(r.converted), fmtPct(r.replyRate)]),
      ["Sequence", "Status", "Enrolled", "Converted", "Reply Rate"],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500" /> Reply Rate by Sequence
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">Converted ÷ enrolled per sequence family</CardDescription>
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
                <TableHead className="text-right">Converted</TableHead>
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
                  <TableCell className="text-right text-green-600">{r.converted}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Progress value={Math.round(r.replyRate * 100)} className="w-16 h-1.5" />
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

function FunnelTable({ stages }: { stages: FunnelStage[] }) {
  const exportCsv = () => {
    downloadCsv(
      "funnel-conversion.csv",
      stages.map(s => [s.stage, String(s.count), fmtPct(s.pct)]),
      ["Stage", "Count", "vs. Top"],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" /> Funnel Conversion
          </CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.map((s) => (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="text-sm w-32 shrink-0 text-muted-foreground truncate">{s.stage}</span>
              <Progress value={Math.round(s.pct * 100)} className="flex-1 h-3" />
              <span className="text-sm font-semibold w-12 text-right">{s.count.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground w-10 text-right">{fmtPct(s.pct)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OverdueTasksTable({ tasks }: { tasks: OverdueTask[] }) {
  const exportCsv = () => {
    downloadCsv(
      "overdue-tasks.csv",
      tasks.map(t => [t.title, t.assignedTo ?? "Unassigned", t.dueDate, String(t.daysOverdue)]),
      ["Task", "Assigned To", "Due Date", "Days Overdue"],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-red-500" /> Overdue Tasks
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
            {summary.mostRecentQueueError && (
              <p className="text-xs text-muted-foreground truncate">{summary.mostRecentQueueError}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">GHL Sync Failures</p>
            <p className={`text-2xl font-bold ${summary.ghlSyncFailures7d > 0 ? "text-orange-600" : "text-green-600"}`}>
              {summary.ghlSyncFailures7d}
            </p>
            {summary.mostRecentGhlError && (
              <p className="text-xs text-muted-foreground truncate">{summary.mostRecentGhlError}</p>
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

  const spendVal = parseFloat(adSpend.replace(/[^0-9.]/g, "")) || 0;

  const { data, isLoading, refetch } = useQuery<OperationsReportData>({
    queryKey: ["/api/reporting/operations", days, adSpendApplied],
    queryFn: async () => {
      const params = new URLSearchParams({ days, adSpend: String(adSpendApplied) });
      const res = await fetch(`/api/reporting/operations?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load operations report");
      return res.json();
    },
  });

  const applyFilters = () => {
    setAdSpendApplied(spendVal);
    refetch();
  };

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading operations report…
      </div>
    );
  }

  if (!data) {
    return <div className="py-8 text-center text-destructive">Failed to load report.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Date Range</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-32 h-8 text-xs">
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
              <Label className="text-xs">Total Ad Spend ($)</Label>
              <Input
                className="w-36 h-8 text-xs"
                placeholder="e.g. 4500"
                value={adSpend}
                onChange={(e) => setAdSpend(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={applyFilters} className="h-8">
              <Filter className="w-3 h-3 mr-1" /> Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CPL by source */}
      <CplTable rows={data.cplBySource} adSpend={data.adSpend} />

      {/* Close rate by vertical */}
      <CloseRateTable rows={data.closeRateByVertical} />

      {/* Sequence reply rates */}
      <SequenceReplyRateTable rows={data.sequenceReplyRates} />

      {/* Funnel conversion */}
      <FunnelTable stages={data.funnel} />

      {/* Overdue tasks */}
      <OverdueTasksTable tasks={data.overdueTasks} />

      {/* Incident summary */}
      <IncidentSummaryCard summary={data.incidentSummary} />
    </div>
  );
}
