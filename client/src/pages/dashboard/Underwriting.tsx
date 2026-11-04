import { PageTitle } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { selectValue, safeParams, safeContextKeys, destinationUrl, underwritingViews } from "@/lib/crm-destination-state";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Clock, ThumbsDown,
  ThumbsUp, Settings, Loader2, RefreshCw, XCircle, Link as LinkIcon,
} from "lucide-react";
import { Link } from "wouter";

interface QueueRow {
  id: number;
  deal_id: number | null;
  decision: string;
  score: number;
  reasons: string[] | null;
  decided_at: string;
  override_action: string | null;
  overridden_at: string | null;
  override_note: string | null;
  deal_stage: string | null;
  deal_contact_id: number | null;
  total_volume: string | null;
  effective_rate: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
}

interface StatsData {
  /** Deals waiting NOW (latest decision per deal, not overridden) — the same cohort as the queue list. */
  current: { pendingReview: number; pendingHold: number };
  /** Decision EVENTS since local midnight. */
  today: { approvedEvents: number; overridesRecorded: number };
  /** Decision EVENTS over all time. */
  history: { total: number; approved: number; review: number; hold: number; overridden: number };
}

interface PagedRows<T> { rows: T[]; total: number; limit: number; offset: number; hasMore: boolean }
const PAGE_SIZE = 50;

async function fetchPaged<T>(path: string, page: number): Promise<PagedRows<T>> {
  const res = await fetch(`${path}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function Pager({ page, total, onPage, testId }: { page: number; total: number; onPage: (p: number) => void; testId: string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-2 pb-20 pr-16" data-testid={testId}>
      <span className="text-xs text-muted-foreground">Page {page + 1} of {pages} · {total} total</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</Button>
      </div>
    </div>
  );
}

interface RulesConfig {
  id: number;
  minMonthlyVolume: string;
  maxMonthlyVolume: string;
  effectiveRateCeiling: string;
  chargebackRateLimit: string;
  chargebackRateHardLimit: string;
  volumeHardDeviationPct: string;
  blockedProcessors: string[] | null;
  allowedProcessors: string[] | null;
  autoApproveEnabled: boolean;
}

function decisionBadge(decision: string, overrideAction?: string | null) {
  if (overrideAction === "approve") {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Manually Approved</Badge>;
  }
  if (overrideAction === "reject") {
    return <Badge variant="destructive">Manually Rejected</Badge>;
  }
  if (decision === "approve") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Auto-Approved</Badge>;
  if (decision === "hold") return <Badge variant="destructive">Hold</Badge>;
  return <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">Needs Review</Badge>;
}

function scoreBadge(score: number) {
  const color = score >= 80 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={`font-semibold text-sm ${color}`} data-testid="text-underwriting-score">{score}</span>;
}

function merchantName(row: QueueRow) {
  if (row.company_name) return row.company_name;
  const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  return name || row.email || `Deal #${row.deal_id}`;
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function UnderwritingPage() {
  const { toast } = useToast();
  const search=useSearch();
  const [,navigate]=useLocation();
  const view=selectValue(new URLSearchParams(search),"underwritingView",underwritingViews,"queue");
  const tab=view.value;
  const setTab=(next:string)=>{
    if(!underwritingViews.includes(next as typeof tab))return;
    const params=safeParams(search,safeContextKeys);
    params.set("underwritingView",next);
    navigate(destinationUrl("/dashboard/underwriting",params,window.location.hash));
  };
  const [overrideDialog, setOverrideDialog] = useState<{
    dealId: number;
    action: "approve" | "reject";
  } | null>(null);
  const [overrideNote, setOverrideNote] = useState("");
  const [rulesForm, setRulesForm] = useState<Partial<RulesConfig>>({});
  const [blockedInput, setBlockedInput] = useState("");

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: retryStats } = useQuery<StatsData>({
    queryKey: ["/api/underwriting/stats"],
    refetchInterval: 60000,
  });

  const [queuePage, setQueuePage] = useState(0);
  const [approvedPage, setApprovedPage] = useState(0);

  const { data: queueData, isLoading: queueLoading, isError: queueError, refetch: refetchQueue } = useQuery<PagedRows<QueueRow>>({
    queryKey: ["/api/underwriting/queue", queuePage],
    queryFn: () => fetchPaged<QueueRow>("/api/underwriting/queue", queuePage),
    refetchInterval: 60000,
  });
  const queue = queueData?.rows ?? [];
  const queueTotal = queueData?.total ?? 0;

  const { data: approvedData, isLoading: approvedLoading, isError: approvedError, refetch: retryApproved } = useQuery<PagedRows<QueueRow>>({
    queryKey: ["/api/underwriting/approved-today", approvedPage],
    queryFn: () => fetchPaged<QueueRow>("/api/underwriting/approved-today", approvedPage),
    refetchInterval: 60000,
  });
  const approvedToday = approvedData?.rows ?? [];
  const approvedTotal = approvedData?.total ?? 0;

  // A page that no longer exists (items were actioned elsewhere) falls back to the last real page.
  useEffect(() => {
    if (queueData && queueData.rows.length === 0 && queueData.total > 0 && queuePage > 0) setQueuePage(Math.max(0, Math.ceil(queueData.total / PAGE_SIZE) - 1));
  }, [queueData, queuePage]);
  useEffect(() => {
    if (approvedData && approvedData.rows.length === 0 && approvedData.total > 0 && approvedPage > 0) setApprovedPage(Math.max(0, Math.ceil(approvedData.total / PAGE_SIZE) - 1));
  }, [approvedData, approvedPage]);

  const { data: rules, isLoading: rulesLoading, isError: rulesError, refetch: retryRules } = useQuery<RulesConfig>({
    queryKey: ["/api/underwriting/rules"],
  } as any);

  const approveMutation = useMutation({
    mutationFn: ({ dealId, note }: { dealId: number; note: string }) =>
      apiRequest("POST", `/api/underwriting/deals/${dealId}/approve`, { note }),
    onSuccess: () => {
      toast({ title: "Deal approved", description: "Deal advanced to Proposal Sent." });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/approved-today"] });
      setOverrideDialog(null);
      setOverrideNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  useEffect(()=>{if(rules && !rulesError)setRulesForm(rules);},[rules,rulesError]);

  const rejectMutation = useMutation({
    mutationFn: ({ dealId, note }: { dealId: number; note: string }) =>
      apiRequest("POST", `/api/underwriting/deals/${dealId}/reject`, { note }),
    onSuccess: () => {
      toast({ title: "Decision recorded", description: "Deal returned to Review In Progress." });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/stats"] });
      setOverrideDialog(null);
      setOverrideNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rulesMutation = useMutation({
    mutationFn: (body: Partial<RulesConfig>) =>
      apiRequest("PUT", "/api/underwriting/rules", body),
    onSuccess: () => {
      toast({ title: "Rules saved", description: "Underwriting thresholds updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/rules"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleOverrideSubmit() {
    if (!overrideDialog) return;
    if (overrideDialog.action === "approve") {
      approveMutation.mutate({ dealId: overrideDialog.dealId, note: overrideNote });
    } else {
      rejectMutation.mutate({ dealId: overrideDialog.dealId, note: overrideNote });
    }
  }

  function handleRulesSave() {
    const blocked = blockedInput
      ? blockedInput.split(",").map(s => s.trim()).filter(Boolean)
      : rulesForm.blockedProcessors ?? [];
    rulesMutation.mutate({ ...rulesForm, blockedProcessors: blocked });
  }

  const holdRows = queue.filter(r => r.decision === "hold");
  const reviewRows = queue.filter(r => r.decision === "review");

  return (
    <>
    {view.issues.length>0 && <p role="status" className="text-sm border rounded p-3">{view.issues[0].reason}</p>}
    <div className="space-y-6" data-testid="page-underwriting">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <PageTitle className="text-2xl font-bold tracking-tight" data-testid="heading-underwriting">Underwriting</PageTitle>
          <p className="text-muted-foreground text-sm mt-0.5">
            Auto-approval engine · Risk threshold configuration · Manual overrides
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void Promise.all([refetchQueue(), retryStats(), retryApproved(), retryRules()]); }} data-testid="button-refresh-queue">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statsError ? <CrmDataState state="unavailable" message="Underwriting statistics unavailable. No zero-population conclusion." onRetry={()=>void retryStats()}/> : statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card data-testid="card-approved-today">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">Approval decisions today</span>
                </div>
                <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-approved-today">
                  {stats?.today.approvedEvents ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-pending-review">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Deals needing review now</span>
                </div>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-review">
                  {stats?.current.pendingReview ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-pending-hold">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-xs text-muted-foreground">Deals on hold now</span>
                </div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-pending-hold">
                  {stats?.current.pendingHold ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-overridden">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Overrides recorded today</span>
                </div>
                <div className="text-2xl font-bold" data-testid="text-overridden">
                  {stats?.today.overridesRecorded ?? 0}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start" data-testid="tabs-underwriting">
          <TabsTrigger value="queue" data-testid="tab-needs-review">
            Needs Review
            {queueTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 font-semibold" data-testid="badge-queue-total">
                {queueTotal}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-auto-approved">Approvals today</TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-rules-config">Rules Config</TabsTrigger>
        </TabsList>

        {/* ── Needs Review Tab ─────────────────────────────────────────── */}
        <TabsContent value="queue" className="mt-4 space-y-4">
          {queueError ? <CrmDataState state="unavailable" message="Review queue unavailable. The queue is not confirmed clear." onRetry={()=>void refetchQueue()}/> : queueLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : queue.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShieldCheck className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="font-medium text-lg" data-testid="text-queue-empty">No deals are waiting on a review or hold decision</p>
                <p className="text-muted-foreground text-sm">This reflects each deal's latest underwriting decision. It does not say anything about deals without a decision yet.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {holdRows.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" /> Hard Holds ({holdRows.length} on this page)
                  </h3>
                  {holdRows.map(row => (
                    <QueueCard
                      key={row.id}
                      row={row}
                      onApprove={() => setOverrideDialog({ dealId: row.deal_id!, action: "approve" })}
                      onReject={() => setOverrideDialog({ dealId: row.deal_id!, action: "reject" })}
                    />
                  ))}
                </div>
              )}
              {reviewRows.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-amber-600 flex items-center gap-1.5">
                    <Clock className="w-4 h-4" /> Soft Flags — Needs Review ({reviewRows.length} on this page)
                  </h3>
                  {reviewRows.map(row => (
                    <QueueCard
                      key={row.id}
                      row={row}
                      onApprove={() => setOverrideDialog({ dealId: row.deal_id!, action: "approve" })}
                      onReject={() => setOverrideDialog({ dealId: row.deal_id!, action: "reject" })}
                    />
                  ))}
                </div>
              )}
              <Pager page={queuePage} total={queueTotal} onPage={setQueuePage} testId="pager-queue" />
            </>
          )}
        </TabsContent>

        {/* ── Auto-Approved Today Tab ───────────────────────────────────── */}
        <TabsContent value="approved" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Approval decisions today <span className="text-xs font-normal text-muted-foreground" data-testid="text-approved-total">({approvedTotal} recorded)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
          {approvedError ? <CrmDataState state="unavailable" message="Approved-today source unavailable." onRetry={()=>void retryApproved()}/> : approvedLoading ? (
                <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : approvedToday.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">No approval decisions have been recorded yet today.</p>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 font-medium">Merchant</th>
                        <th className="text-left pb-2 font-medium">Score</th>
                        <th className="text-left pb-2 font-medium">Volume</th>
                        <th className="text-left pb-2 font-medium">Rate</th>
                        <th className="text-left pb-2 font-medium">Decided</th>
                        <th className="text-left pb-2 font-medium">Deal</th>
                        <th className="text-left pb-2 font-medium">Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedToday.map(row => (
                        <tr key={row.id} className="border-b hover:bg-muted/40 transition-colors" data-testid={`row-approved-${row.id}`}>
                          <td className="py-2 font-medium">{merchantName(row)}</td>
                          <td className="py-2">{scoreBadge(row.score)}</td>
                          <td className="py-2 text-muted-foreground">{row.total_volume || "—"}</td>
                          <td className="py-2 text-muted-foreground">{row.effective_rate ? `${row.effective_rate}%` : "—"}</td>
                          <td className="py-2 text-muted-foreground">{formatDate(row.decided_at)}</td>
                          <td className="py-2">
                            {row.deal_id && (
                              <Link href={`/dashboard/pipeline`} className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                                <LinkIcon className="w-3 h-3" /> Deal #{row.deal_id}
                              </Link>
                            )}
                          </td>
                          <td className="py-2">
                            {row.deal_id && !row.override_action && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                onClick={() => setOverrideDialog({ dealId: row.deal_id!, action: "reject" })}
                                data-testid={`button-rescind-${row.id}`}
                              >
                                <ThumbsDown className="w-3 h-3 mr-1" /> Rescind
                              </Button>
                            )}
                            {row.override_action && (
                              <span className="text-xs text-muted-foreground">
                                {row.override_action === "reject" ? "Rescinded" : "Confirmed"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={approvedPage} total={approvedTotal} onPage={setApprovedPage} testId="pager-approved" />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Rules Config Tab ─────────────────────────────────────────── */}
        <TabsContent value="config" className="mt-4">
          {rulesError ? <CrmDataState state="unavailable" message="Rules configuration unavailable; editing is blocked until a successful readback." onRetry={()=>void retryRules()}/> : null}
          <fieldset disabled={rulesLoading || rulesError || !rules}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Underwriting Thresholds
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rulesLoading ? (
                <div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="space-y-6 max-w-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">Auto-Approve Enabled</Label>
                      <p className="text-xs text-muted-foreground">When off, all deals go to manual review</p>
                    </div>
                    <Switch
                      checked={rulesForm.autoApproveEnabled ?? rules?.autoApproveEnabled ?? true}
                      onCheckedChange={v => setRulesForm(f => ({ ...f, autoApproveEnabled: v }))}
                      data-testid="switch-auto-approve"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="minVol">Min Monthly Volume ($)</Label>
                      <Input
                        id="minVol"
                        type="number"
                        data-testid="input-min-volume"
                        value={rulesForm.minMonthlyVolume ?? rules?.minMonthlyVolume ?? "5000"}
                        onChange={e => setRulesForm(f => ({ ...f, minMonthlyVolume: e.target.value as any }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="maxVol">Max Monthly Volume ($)</Label>
                      <Input
                        id="maxVol"
                        type="number"
                        data-testid="input-max-volume"
                        value={rulesForm.maxMonthlyVolume ?? rules?.maxMonthlyVolume ?? "500000"}
                        onChange={e => setRulesForm(f => ({ ...f, maxMonthlyVolume: e.target.value as any }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="rateCeil">Effective Rate Ceiling (%)</Label>
                      <Input
                        id="rateCeil"
                        type="number"
                        step="0.1"
                        data-testid="input-rate-ceiling"
                        value={rulesForm.effectiveRateCeiling ?? rules?.effectiveRateCeiling ?? "3.5"}
                        onChange={e => setRulesForm(f => ({ ...f, effectiveRateCeiling: e.target.value as any }))}
                      />
                      <p className="text-xs text-muted-foreground">Soft flag above this</p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cbLimit">Chargeback Rate Limit (%)</Label>
                      <Input
                        id="cbLimit"
                        type="number"
                        step="0.1"
                        data-testid="input-chargeback-limit"
                        value={rulesForm.chargebackRateLimit ?? rules?.chargebackRateLimit ?? "1.0"}
                        onChange={e => setRulesForm(f => ({ ...f, chargebackRateLimit: e.target.value as any }))}
                      />
                      <p className="text-xs text-muted-foreground">Soft flag above this</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="cbHard">Chargeback Hard Limit (%)</Label>
                      <Input
                        id="cbHard"
                        type="number"
                        step="0.1"
                        data-testid="input-chargeback-hard-limit"
                        value={rulesForm.chargebackRateHardLimit ?? rules?.chargebackRateHardLimit ?? "2.0"}
                        onChange={e => setRulesForm(f => ({ ...f, chargebackRateHardLimit: e.target.value as any }))}
                      />
                      <p className="text-xs text-muted-foreground">Hard hold above this</p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="volDev">Volume Deviation for Hard Hold (%)</Label>
                      <Input
                        id="volDev"
                        type="number"
                        data-testid="input-volume-deviation"
                        value={rulesForm.volumeHardDeviationPct ?? rules?.volumeHardDeviationPct ?? "50"}
                        onChange={e => setRulesForm(f => ({ ...f, volumeHardDeviationPct: e.target.value as any }))}
                      />
                      <p className="text-xs text-muted-foreground">% outside volume range → hard hold</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blocked">Blocked Processors (comma-separated)</Label>
                    <Input
                      id="blocked"
                      placeholder="e.g. HighRisk Inc, BadProcessor"
                      data-testid="input-blocked-processors"
                      value={
                        blockedInput ||
                        (rules?.blockedProcessors ?? []).join(", ")
                      }
                      onChange={e => setBlockedInput(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Deals from these processors get a hard hold</p>
                  </div>

                  <Button
                    onClick={handleRulesSave}
                    disabled={rulesMutation.isPending}
                    data-testid="button-save-rules"
                  >
                    {rulesMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save Thresholds
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          </fieldset>
        </TabsContent>
      </Tabs>

      {/* Override Dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={() => { setOverrideDialog(null); setOverrideNote(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {overrideDialog?.action === "approve"
                ? <><ThumbsUp className="w-4 h-4 text-green-600" /> Approve Deal</>
                : <><ThumbsDown className="w-4 h-4 text-destructive" /> Return to Review</>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {overrideDialog?.action === "approve"
                ? "This will advance the deal to Proposal Sent and create an audit log entry."
                : "This will return the deal to Review In Progress and notify the team."}
            </p>
            <div className="space-y-1">
              <Label htmlFor="override-note">Note (optional)</Label>
              <Textarea
                id="override-note"
                placeholder="Reason for manual override..."
                value={overrideNote}
                onChange={e => setOverrideNote(e.target.value)}
                rows={3}
                data-testid="input-override-note"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setOverrideDialog(null); setOverrideNote(""); }}>
                Cancel
              </Button>
              <Button
                variant={overrideDialog?.action === "approve" ? "default" : "destructive"}
                onClick={handleOverrideSubmit}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                data-testid="button-override-confirm"
              >
                {(approveMutation.isPending || rejectMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {overrideDialog?.action === "approve" ? "Approve" : "Confirm Return"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

interface QueueCardProps {
  row: QueueRow;
  onApprove: () => void;
  onReject: () => void;
}

function QueueCard({ row, onApprove, onReject }: QueueCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isHold = row.decision === "hold";

  return (
    <Card
      className={`border ${isHold ? "border-destructive/50 bg-destructive/5" : "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"}`}
      data-testid={`card-queue-${row.id}`}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isHold
                ? <XCircle className="w-4 h-4 text-destructive shrink-0" />
                : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
              <span className="font-semibold truncate" data-testid={`text-merchant-name-${row.id}`}>
                {merchantName(row)}
              </span>
              {decisionBadge(row.decision, row.override_action)}
              <span className="text-xs text-muted-foreground">Score: {scoreBadge(row.score)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {row.total_volume && <span>Volume: {row.total_volume}</span>}
              {row.effective_rate && <span>Rate: {row.effective_rate}%</span>}
              <span>{formatDate(row.decided_at)}</span>
              {row.deal_id && (
                <Link href={`/dashboard/pipeline`} className="text-primary hover:underline inline-flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" /> Deal #{row.deal_id}
                </Link>
              )}
            </div>
            {row.reasons && row.reasons.length > 0 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline mt-0.5"
                data-testid={`button-expand-reasons-${row.id}`}
              >
                {expanded ? "Hide reasons" : `${row.reasons.length} reason(s)`}
              </button>
            )}
            {expanded && row.reasons && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground list-disc list-inside">
                {row.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
          {!row.override_action && row.deal_id && (
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={onReject}
                data-testid={`button-reject-${row.id}`}
              >
                <ThumbsDown className="w-3 h-3 mr-1" /> Return
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={onApprove}
                data-testid={`button-approve-${row.id}`}
              >
                <ThumbsUp className="w-3 h-3 mr-1" /> Approve
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
