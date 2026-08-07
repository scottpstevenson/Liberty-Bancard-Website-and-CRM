import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Target, DollarSign,
  BarChart3, Users, ChevronDown, ChevronUp, Sparkles, Bot, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepBreakdown {
  agentId: number;
  name: string;
  initials: string;
  dealsClosed: number;
  revenue: number;
  grossProfit: number;
  proposalsSent: number;
  prevDealsClosed: number;
  prevRevenue: number;
  goalStatus: "green" | "yellow" | "red" | "none";
}

interface CoachingCard {
  agentId: number;
  name: string;
  coaching: string;
}

interface GoalVsActual {
  key: string;
  label: string;
  goal: number;
  actual: number;
  pct: number;
  status: "green" | "yellow" | "red" | "none";
}

interface LiveSnapshot {
  weekStart: string;
  weekEnd: string;
  closedWonRevenue: number;
  prevClosedWonRevenue: number;
  revenueWoW: number;
  grossMarginPct: number;
  netMarginPct: number;
  prevGrossMarginPct: number;
  pipelineValue: number;
  pipelineByStageSummary: Array<{ stage: string; count: number; value: number }>;
  newDealsClosed: number;
  prevDealsClosed: number;
  proposalsSent: number;
  prevProposalsSent: number;
  statementsReceived: number;
  meetingsBooked: number;
  outreachAttempts: number;
  perRepBreakdown: RepBreakdown[];
  goalsVsActuals: GoalVsActual[];
  gptBriefing?: string | null;
  claudeCoaching?: CoachingCard[] | null;
  generatedAt?: string | null;
}

interface StoredSnapshot {
  weekStart: string;
  closedWonRevenue: string;
  grossProfit: string;
  netProfit: string;
  grossMarginPct: string;
  netMarginPct: string;
  pipelineValue: string;
  newDealsClosed: number;
  proposalsSent: number;
  statementsReceived: number;
  meetingsBooked: number;
  outreachAttempts: number;
  perRepBreakdown: RepBreakdown[] | null;
  goalsVsActuals: GoalVsActual[] | null;
  gptBriefing: string | null;
  claudeCoaching: CoachingCard[] | null;
  generatedAt: string | null;
  createdAt: string;
}

interface SnapshotResponse {
  source: "stored" | "live";
  snapshot: StoredSnapshot | LiveSnapshot;
}

interface ExecutiveGoal {
  id: number;
  key: string;
  value: string;
  periodType: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numVal(v: string | number | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return parseFloat(v) || 0;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function statusColor(s: string): string {
  if (s === "green") return "text-green-600";
  if (s === "yellow") return "text-amber-500";
  if (s === "red") return "text-red-500";
  return "text-muted-foreground";
}

function statusBg(s: string): string {
  if (s === "green") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (s === "yellow") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  if (s === "red") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}

function WoWBadge({ delta }: { delta: number }) {
  if (delta > 0) return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1 text-xs">
      <TrendingUp className="w-3 h-3" />+{delta}%
    </Badge>
  );
  if (delta < 0) return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <TrendingDown className="w-3 h-3" />{delta}%
    </Badge>
  );
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Minus className="w-3 h-3" />0%
    </Badge>
  );
}

function Sparkline({ data }: { data: Array<{ week: string; value: number }> }) {
  if (!data || data.length < 2) return <div className="h-8 w-16 bg-muted/40 rounded" />;
  return (
    <div className="h-8 w-16">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <RTooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [fmt(v), ""]} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Goal fields config ───────────────────────────────────────────────────────

const GOAL_FIELDS = [
  { key: "weekly_revenue", label: "Weekly Revenue ($)", placeholder: "e.g. 50000" },
  { key: "weekly_deals", label: "Weekly Deals Closed", placeholder: "e.g. 10" },
  { key: "weekly_proposals", label: "Weekly Proposals Sent", placeholder: "e.g. 25" },
  { key: "weekly_statements", label: "Weekly Statements Received", placeholder: "e.g. 30" },
  { key: "gross_margin_pct", label: "Gross Margin % Target", placeholder: "e.g. 35" },
  { key: "rep_deals_closed", label: "Per-Rep Weekly Deal Goal", placeholder: "e.g. 3" },
];

// ─── Goal Modal ───────────────────────────────────────────────────────────────

function GoalModal({
  open, onClose, currentGoals,
}: {
  open: boolean;
  onClose: () => void;
  currentGoals: ExecutiveGoal[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of GOAL_FIELDS) {
      const found = currentGoals.find(g => g.key === f.key);
      init[f.key] = found ? found.value : "";
    }
    return init;
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const goals = GOAL_FIELDS
        .filter(f => values[f.key]?.trim())
        .map(f => ({ key: f.key, value: parseFloat(values[f.key]), periodType: "weekly" }));
      await apiRequest("PUT", "/api/executive/goals", goals);
    },
    onSuccess: () => {
      toast({ title: "Goals saved" });
      qc.invalidateQueries({ queryKey: ["/api/executive/goals"] });
      qc.invalidateQueries({ queryKey: ["/api/executive/snapshot"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to save goals", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Set Weekly Goals
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {GOAL_FIELDS.map(f => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`goal-${f.key}`} className="text-sm">{f.label}</Label>
              <Input
                id={`goal-${f.key}`}
                type="number"
                min={0}
                placeholder={f.placeholder}
                value={values[f.key]}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Goals"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Executive() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = (user as any)?.role === "admin";
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [expandedRep, setExpandedRep] = useState<number | null>(null);

  const { data: snapResp, isLoading: snapLoading } = useQuery<SnapshotResponse>({
    queryKey: ["/api/executive/snapshot"],
    staleTime: 5 * 60_000,
  });

  const { data: history = [] } = useQuery<StoredSnapshot[]>({
    queryKey: ["/api/executive/snapshots"],
    staleTime: 10 * 60_000,
  });

  const { data: goals = [] } = useQuery<ExecutiveGoal[]>({
    queryKey: ["/api/executive/goals"],
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/executive/refresh"),
    onSuccess: () => {
      toast({ title: "Snapshot refreshed", description: "AI briefing and coaching updated." });
      qc.invalidateQueries({ queryKey: ["/api/executive/snapshot"] });
      qc.invalidateQueries({ queryKey: ["/api/executive/snapshots"] });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const raw = snapResp?.snapshot as any;

  // Normalise stored vs live snapshots
  const revenue = numVal(raw?.closedWonRevenue);
  const prevRevenue = numVal(raw?.prevClosedWonRevenue);
  const revenueWoW = raw?.revenueWoW ?? (prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : 0);
  const grossMargin = numVal(raw?.grossMarginPct);
  const netMargin = numVal(raw?.netMarginPct);
  const prevGrossMargin = numVal(raw?.prevGrossMarginPct);
  const pipeline = numVal(raw?.pipelineValue);
  const dealsClosed = raw?.newDealsClosed ?? 0;
  const prevDeals = raw?.prevDealsClosed ?? 0;
  const proposals = raw?.proposalsSent ?? 0;
  const statements = raw?.statementsReceived ?? 0;
  const meetings = raw?.meetingsBooked ?? 0;
  const weekStart = raw?.weekStart ?? "";

  const perRep: RepBreakdown[] = raw?.perRepBreakdown ?? [];
  const goalsVsActuals: GoalVsActual[] = raw?.goalsVsActuals ?? [];
  const gptBriefing: string | null = raw?.gptBriefing ?? null;
  const claudeCoaching: CoachingCard[] = raw?.claudeCoaching ?? [];
  const pipelineStages: Array<{ stage: string; count: number; value: number }> = raw?.pipelineByStageSummary ?? [];

  // Sparkline history from stored snapshots
  const revSparkline = history.slice().reverse().slice(-8).map(s => ({
    week: s.weekStart,
    value: numVal(s.closedWonRevenue),
  }));
  const marginSparkline = history.slice().reverse().slice(-8).map(s => ({
    week: s.weekStart,
    value: numVal(s.grossMarginPct),
  }));

  const generatedAt = raw?.generatedAt
    ? new Date(raw.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-6 p-0" data-testid="executive-dashboard">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Executive Intelligence
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {weekStart ? `Week of ${weekStart}` : "Current week"} · AI-powered performance briefing
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setGoalModalOpen(true)}>
              <Target className="w-4 h-4 mr-1" /> Set Goals
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Refreshing…" : "Refresh Now"}
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI Cards Row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Revenue */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" /> Revenue This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapLoading ? <Skeleton className="h-9 w-24 mb-2" /> : (
              <>
                <div className="text-3xl font-bold" data-testid="text-revenue">{fmt(revenue)}</div>
                <div className="flex items-center gap-2 mt-1">
                  <WoWBadge delta={revenueWoW} />
                  <span className="text-xs text-muted-foreground">vs {fmt(prevRevenue)} last wk</span>
                </div>
                {revSparkline.length > 1 && <div className="mt-2"><Sparkline data={revSparkline} /></div>}
              </>
            )}
          </CardContent>
        </Card>

        {/* Gross Margin */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Margin Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapLoading ? <Skeleton className="h-9 w-20 mb-2" /> : (
              <>
                <div className="text-3xl font-bold">{grossMargin.toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Gross · Net {netMargin.toFixed(1)}%
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <WoWBadge delta={Math.round((grossMargin - prevGrossMargin) * 10) / 10} />
                  <span className="text-xs text-muted-foreground">vs {prevGrossMargin.toFixed(1)}% last wk</span>
                </div>
                {marginSparkline.length > 1 && <div className="mt-2"><Sparkline data={marginSparkline} /></div>}
              </>
            )}
          </CardContent>
        </Card>

        {/* Pipeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Active Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapLoading ? <Skeleton className="h-9 w-24 mb-2" /> : (
              <>
                <div className="text-3xl font-bold">{fmt(pipeline)}</div>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {pipelineStages.slice(0, 3).map(s => (
                    <div key={s.stage} className="flex justify-between">
                      <span className="truncate max-w-[130px]">{s.stage}</span>
                      <span className="font-medium ml-2">{s.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Activity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapLoading ? <Skeleton className="h-9 w-24 mb-2" /> : (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deals closed</span>
                  <span className="font-semibold">{dealsClosed} <span className="text-xs text-muted-foreground">(prev: {prevDeals})</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Proposals sent</span>
                  <span className="font-semibold">{proposals}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Statements</span>
                  <span className="font-semibold">{statements}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Meetings booked</span>
                  <span className="font-semibold">{meetings}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Goals vs Actuals ── */}
      {goalsVsActuals.filter(g => g.goal > 0).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Goals vs Actuals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {goalsVsActuals.filter(g => g.goal > 0).map(g => (
                <div key={g.key} className="space-y-1">
                  <div className="text-xs text-muted-foreground">{g.label}</div>
                  <div className={`text-lg font-bold ${statusColor(g.status)}`}>
                    {g.key.includes("revenue") ? fmt(g.actual) : g.key.includes("pct") ? `${g.actual}%` : g.actual}
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        g.status === "green" ? "bg-green-500" : g.status === "yellow" ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${Math.min(g.pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">{g.pct}% of goal</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Team Leaderboard ── */}
      {perRep.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Team Leaderboard
              <span className="text-xs font-normal text-muted-foreground ml-1">— Week of {weekStart}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Rep</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Deals</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">WoW Δ</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {perRep.map((r) => {
                    const dealDelta = r.dealsClosed - r.prevDealsClosed;
                    return (
                      <tr key={r.agentId} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                              {r.initials}
                            </div>
                            <span className="font-medium">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{r.dealsClosed}</td>
                        <td className="px-3 py-2.5 text-right">{fmt(r.revenue)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {dealDelta > 0
                            ? <span className="text-green-600 font-medium">+{dealDelta}</span>
                            : dealDelta < 0
                            ? <span className="text-red-500 font-medium">{dealDelta}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {r.goalStatus !== "none"
                            ? <Badge className={`text-xs ${statusBg(r.goalStatus)}`}>{r.goalStatus}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── GPT-4o Executive Briefing ── */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            Executive Briefing
            <Badge variant="outline" className="ml-1 text-xs font-normal">GPT-4o</Badge>
            {generatedAt && (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Generated {generatedAt}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          ) : gptBriefing ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
              {gptBriefing}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No briefing yet. Click <strong>Refresh Now</strong> to generate.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Claude Per-Rep Coaching Cards ── */}
      {claudeCoaching.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Per-Rep Coaching</h3>
            <Badge variant="outline" className="text-xs font-normal">Claude</Badge>
            <span className="text-xs text-muted-foreground ml-1">— empathetic, actionable</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {claudeCoaching.map(card => {
              const repData = perRep.find(r => r.agentId === card.agentId || r.name.toLowerCase() === card.name.toLowerCase());
              const isExpanded = expandedRep === card.agentId;
              return (
                <Card key={card.agentId || card.name} className="border-muted/60">
                  <CardHeader className="pb-2 pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {repData?.initials ?? card.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-semibold leading-tight">{card.name}</div>
                          {repData && (
                            <div className="text-xs text-muted-foreground">
                              {repData.dealsClosed} deals · {fmt(repData.revenue)}
                            </div>
                          )}
                        </div>
                      </div>
                      {repData?.goalStatus && repData.goalStatus !== "none" && (
                        <Badge className={`text-xs ${statusBg(repData.goalStatus)}`}>
                          {repData.goalStatus}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className={`text-sm text-muted-foreground leading-relaxed ${isExpanded ? "" : "line-clamp-3"}`}>
                      {card.coaching}
                    </div>
                    {card.coaching.length > 180 && (
                      <button
                        className="mt-1 text-xs text-primary flex items-center gap-0.5 hover:underline"
                        onClick={() => setExpandedRep(isExpanded ? null : card.agentId)}
                      >
                        {isExpanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> More</>}
                      </button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {claudeCoaching.length === 0 && !snapLoading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Per-rep coaching cards will appear here after the first AI refresh.</p>
            {isAdmin && (
              <Button size="sm" className="mt-3" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Generate Now
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Goal Modal */}
      <GoalModal
        open={goalModalOpen}
        onClose={() => setGoalModalOpen(false)}
        currentGoals={goals}
      />
    </div>
  );
}
