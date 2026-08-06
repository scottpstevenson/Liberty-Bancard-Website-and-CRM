import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Target, DollarSign,
  BarChart3, Users, ChevronDown, ChevronUp, Settings, Sparkles, Brain,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoalStatus { goal: number; actual: number; status: "green" | "yellow" | "red"; pct: number }
interface RepBreakdown { agentId: string | null; name: string; closedWonCount: number; closedWonVolume: number; grossProfitMonthly: number; proposalsSent: number; statementsReceived: number; meetingsBooked: number; replyCount: number }
interface ClaudeCard { agentId: string | null; name: string; coachingText: string; gapSummary: string }
interface GoalEntry { key: string; value: number; period: string; label: string | null }

interface ExecSnapshot {
  weekStart: string; weekEnd: string; source: string;
  closedWonVolume: number; closedWonCount: number;
  grossProfitMonthly: number; netProfitMonthly: number;
  grossMarginPct: number; netMarginPct: number;
  pipelineValue: number; pipelineDealCount: number;
  newLeads: number; proposalsSent: number; statementsReceived: number; meetingsBooked: number;
  emailsSent: number; smsSent: number; callsMade: number; replyCount: number;
  prevWeekVolume: number | null; prevWeekDeals: number | null; prevWeekGrossMargin: number | null;
  goalsVsActuals: Record<string, GoalStatus>;
  repBreakdown: RepBreakdown[];
  gpt_briefing: string | null;
  claude_coaching: ClaudeCard[] | null;
  ai_generated_at: string | null;
  goals: GoalEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number) => `${n.toFixed(3)}%`;

const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : fmt$(n);

function wowDelta(current: number, prev: number | null) {
  if (prev == null || prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

function StatusBadge({ status }: { status: "green" | "yellow" | "red" }) {
  const colors = { green: "bg-emerald-100 text-emerald-700", yellow: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700" };
  const labels = { green: "On Track", yellow: "At Risk", red: "Off Track" };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status]}`}>{labels[status]}</span>;
}

function WoWArrow({ delta }: { delta: number | null }) {
  if (delta == null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (delta > 0) return <span className="flex items-center gap-0.5 text-emerald-600 text-xs font-medium"><TrendingUp className="h-3 w-3" />+{delta.toFixed(1)}%</span>;
  return <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium"><TrendingDown className="h-3 w-3" />{delta.toFixed(1)}%</span>;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, delta, goalStatus, icon: Icon }: {
  title: string; value: string; sub?: string; delta: number | null;
  goalStatus?: GoalStatus; icon: any;
}) {
  return (
    <Card className="border border-border/60 shadow-sm">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="p-2 rounded-lg bg-primary/8">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          {goalStatus && <StatusBadge status={goalStatus.status} />}
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <div className="flex items-center gap-2">
            <WoWArrow delta={delta} />
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
        </div>
        {goalStatus && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>vs goal {goalStatus.goal >= 1000 ? fmtK(goalStatus.goal) : goalStatus.goal}</span>
              <span>{goalStatus.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${goalStatus.status === "green" ? "bg-emerald-500" : goalStatus.status === "yellow" ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${Math.min(goalStatus.pct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Goal Edit Modal ─────────────────────────────────────────────────────────

function GoalEditor({ goals, onClose, onSaved }: { goals: GoalEntry[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(goals.map((g) => [g.key, String(g.value)]))
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const updates = goals.map((g) => ({ ...g, value: Number(values[g.key] ?? g.value) }));
      return apiRequest("PUT", "/api/executive/goals", updates);
    },
    onSuccess: () => {
      toast({ title: "Goals saved" });
      onSaved();
      onClose();
    },
    onError: () => toast({ title: "Failed to save goals", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Revenue Goals</DialogTitle>
          <DialogDescription>Changes take effect immediately on the dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {goals.map((g) => (
            <div key={g.key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{g.label ?? g.key} <span className="text-muted-foreground/60">({g.period})</span></Label>
              <Input
                type="number"
                value={values[g.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [g.key]: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Goals"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Executive() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [expandedRep, setExpandedRep] = useState<string | null>(null);

  const { data: snap, isLoading } = useQuery<ExecSnapshot>({
    queryKey: ["/api/executive/snapshot"],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/executive/snapshots"],
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/executive/refresh", {});
    },
    onSuccess: (data: any) => {
      toast({ title: "Snapshot refreshed", description: data?.aiGenerated ? "AI briefings regenerated." : "Data updated (no AI key set)." });
      qc.invalidateQueries({ queryKey: ["/api/executive/snapshot"] });
      qc.invalidateQueries({ queryKey: ["/api/executive/snapshots"] });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!snap) return <div className="p-6 text-muted-foreground">No snapshot available. Click Refresh to generate one.</div>;

  const g = snap.goalsVsActuals ?? {};
  const volDelta = wowDelta(snap.closedWonVolume, snap.prevWeekVolume);
  const dealDelta = wowDelta(snap.closedWonCount, snap.prevWeekDeals);
  const marginDelta = snap.prevWeekGrossMargin != null ? snap.grossMarginPct - snap.prevWeekGrossMargin : null;

  const coachingByName: Record<string, ClaudeCard> = {};
  for (const c of (snap.claude_coaching ?? [])) coachingByName[c.name] = c;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Executive Command Center</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Week of {snap.weekStart} — {snap.weekEnd}
            {snap.source === "live" && <span className="ml-2 text-xs text-amber-600">(live, not yet saved)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setGoalEditorOpen(true)}
            className="gap-1.5"
          >
            <Settings className="h-3.5 w-3.5" /> Edit Goals
          </Button>
          <Button
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            {refreshMutation.isPending ? "Refreshing…" : "Refresh Now"}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="New Volume Boarded"
          value={fmtK(snap.closedWonVolume)}
          sub={`${snap.closedWonCount} deal${snap.closedWonCount !== 1 ? "s" : ""}`}
          delta={volDelta}
          goalStatus={g["weekly_volume"]}
          icon={DollarSign}
        />
        <KpiCard
          title="Gross Margin %"
          value={fmtPct(snap.grossMarginPct)}
          sub={`Net: ${fmtPct(snap.netMarginPct)}`}
          delta={marginDelta}
          goalStatus={g["gross_margin_pct"]}
          icon={TrendingUp}
        />
        <KpiCard
          title="Pipeline Value"
          value={fmtK(snap.pipelineValue)}
          sub={`${snap.pipelineDealCount} open deals`}
          delta={null}
          icon={Target}
        />
        <KpiCard
          title="Proposals Sent"
          value={String(snap.proposalsSent)}
          sub={`${snap.meetingsBooked} meetings booked`}
          delta={null}
          goalStatus={g["weekly_proposals"]}
          icon={BarChart3}
        />
      </div>

      {/* AI Briefings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* GPT-4o Executive Briefing */}
        <Card className="border border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Executive Briefing</CardTitle>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">GPT-4o</Badge>
              </div>
              {snap.ai_generated_at && (
                <span className="text-[11px] text-muted-foreground">
                  {new Date(snap.ai_generated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {snap.gpt_briefing ? (
              <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {snap.gpt_briefing}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                No briefing yet. Click "Refresh Now" to generate the AI executive briefing.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Funnel Summary */}
        <Card className="border border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Weekly Funnel</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {[
                { label: "New Leads", value: snap.newLeads, goalKey: null },
                { label: "Statements Received", value: snap.statementsReceived, goalKey: "weekly_statements" },
                { label: "Proposals Sent", value: snap.proposalsSent, goalKey: "weekly_proposals" },
                { label: "Meetings Booked", value: snap.meetingsBooked, goalKey: "weekly_meetings" },
                { label: "Deals Closed", value: snap.closedWonCount, goalKey: "weekly_deals" },
              ].map((row) => {
                const gs = row.goalKey ? g[row.goalKey] : null;
                return (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{row.value}</span>
                      {gs && <StatusBadge status={gs.status} />}
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-border/50 grid grid-cols-3 gap-2 text-center">
                {[["Emails", snap.emailsSent], ["SMS", snap.smsSent], ["Replies", snap.replyCount]].map(([label, val]) => (
                  <div key={label as string}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-semibold">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Leaderboard + Coaching Cards */}
      <Card className="border border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Team Performance</CardTitle>
            {snap.claude_coaching && snap.claude_coaching.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                <Brain className="h-2.5 w-2.5" /> Claude Coaching
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {snap.repBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No closed deals this week yet.</p>
          ) : (
            <div className="space-y-1">
              {/* Table header */}
              <div className="grid grid-cols-6 gap-3 text-xs text-muted-foreground font-medium uppercase tracking-wide px-3 pb-1">
                <div className="col-span-2">Rep</div>
                <div className="text-right">Deals</div>
                <div className="text-right">Volume</div>
                <div className="text-right">Proposals</div>
                <div className="text-right">Coaching</div>
              </div>
              {snap.repBreakdown.map((rep) => {
                const coaching = coachingByName[rep.name];
                const isExpanded = expandedRep === rep.name;
                return (
                  <div key={rep.name} className="rounded-lg border border-border/40 overflow-hidden">
                    <div
                      className="grid grid-cols-6 gap-3 items-center px-3 py-2.5 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedRep(isExpanded ? null : rep.name)}
                    >
                      <div className="col-span-2 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {rep.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium truncate">{rep.name}</span>
                      </div>
                      <div className="text-right text-sm font-semibold">{rep.closedWonCount}</div>
                      <div className="text-right text-sm">{fmtK(rep.closedWonVolume)}</div>
                      <div className="text-right text-sm">{rep.proposalsSent}</div>
                      <div className="text-right">
                        {coaching ? (
                          isExpanded ? <ChevronUp className="h-4 w-4 ml-auto text-muted-foreground" /> : <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    {isExpanded && coaching && (
                      <div className="px-4 pb-3 pt-1 bg-muted/20 border-t border-border/30">
                        <div className="flex items-start gap-2">
                          <Brain className="h-3.5 w-3.5 text-purple-500 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">{coaching.gapSummary}</p>
                            <p className="text-sm text-foreground/85 leading-relaxed">{coaching.coachingText}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 12-Week Trend Table */}
      {history.length > 1 && (
        <Card className="border border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">12-Week Volume Trend</CardTitle>
            <CardDescription>Closed-won processing volume per week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    {["Week", "Volume", "Deals", "Margin %", "Pipeline", "Goal Status"].map((h) => (
                      <th key={h} className="text-left text-muted-foreground font-medium py-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 12).map((row: any) => {
                    const gva = row.goals_vs_actuals ? (typeof row.goals_vs_actuals === "string" ? JSON.parse(row.goals_vs_actuals) : row.goals_vs_actuals) : {};
                    const vs = gva["weekly_volume"];
                    return (
                      <tr key={row.week_start} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="py-1.5 pr-4 font-medium">{row.week_start}</td>
                        <td className="py-1.5 pr-4">{fmtK(Number(row.closed_won_volume ?? 0))}</td>
                        <td className="py-1.5 pr-4">{row.closed_won_count ?? 0}</td>
                        <td className="py-1.5 pr-4">{fmtPct(Number(row.gross_margin_pct ?? 0))}</td>
                        <td className="py-1.5 pr-4">{fmtK(Number(row.pipeline_value ?? 0))}</td>
                        <td className="py-1.5">{vs ? <StatusBadge status={vs.status} /> : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Goal Editor Modal */}
      {goalEditorOpen && snap.goals && (
        <GoalEditor
          goals={snap.goals}
          onClose={() => setGoalEditorOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["/api/executive/snapshot"] })}
        />
      )}
    </div>
  );
}
