import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  Medal,
  Award,
  Settings,
  DollarSign,
  PhoneCall,
  Send,
  Target,
  Users,
  Percent,
} from "lucide-react";

type TimePeriod = "week" | "month" | "quarter" | "all";
type MetricKey = "deals" | "revenue" | "proposals" | "calls" | "responseRate";
type BooleanSettingKey = "showDeals" | "showRevenue" | "showProposals" | "showCallsMade" | "showResponseRate" | "visibleToAgents";

interface LeaderboardEntry {
  agentId: number;
  name: string;
  initials: string;
  rank: number;
  dealsClosed: number;
  revenueManaged: number;
  proposalsSent: number;
  callsMade: number;
  responseRate: number;
  closeRate: number;   // #530
  prevDealsClosed: number;
  prevRevenueManaged: number;
  prevProposalsSent: number;
  prevCallsMade: number;
  prevResponseRate: number;
  prevCloseRate: number; // #530
  isCurrentUser: boolean;
  goalProgress?: number;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  period: TimePeriod;
  settings: {
    showDeals: boolean;
    showRevenue: boolean;
    showProposals: boolean;
    showCallsMade: boolean;
    showResponseRate: boolean;
    visibleToAgents: boolean;
    monthlyDealGoal: number;
    monthlyRevenueGoal: string;
  };
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  week: "This Week",
  month: "This Month",
  quarter: "This Quarter",
  all: "All Time",
};

function TrendIndicator({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (current > prev) return <TrendingUp className="w-3 h-3 text-green-600" />;
  if (current < prev) return <TrendingDown className="w-3 h-3 text-destructive" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" data-testid="icon-rank-1" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" data-testid={`icon-rank-${rank}`} />;
  if (rank === 3) return <Award className="w-5 h-5 text-amber-600" data-testid={`icon-rank-${rank}`} />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center" data-testid={`text-rank-${rank}`}>{rank}</span>;
}

function formatRevenue(val: number) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export default function Leaderboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState<TimePeriod>("month");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("deals");
  const [editingSettings, setEditingSettings] = useState(false);
  const [localSettings, setLocalSettings] = useState<LeaderboardData["settings"] | null>(null);

  const role = (user?.role as string) || "merchant";
  const isAdmin = role === "admin" || role === "manager";

  const { data, isLoading } = useQuery<LeaderboardData>({
    queryKey: ["/api/leaderboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      return res.json();
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<LeaderboardData["settings"]>) =>
      apiRequest("PUT", "/api/leaderboard/settings", settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast({ title: "Settings saved" });
      setEditingSettings(false);
    },
    onError: (err: any) => toast({ title: "Failed to save settings", description: err.message, variant: "destructive" }),
  });

  const settings = data?.settings;
  const entries = data?.entries || [];

  const metricKey: Record<string, keyof LeaderboardEntry> = {
    deals: "dealsClosed",
    revenue: "revenueManaged",
    proposals: "proposalsSent",
    calls: "callsMade",
    responseRate: "responseRate",
    closeRate: "closeRate", // #530
  };

  const prevMetricKey: Record<string, keyof LeaderboardEntry> = {
    deals: "prevDealsClosed",
    revenue: "prevRevenueManaged",
    proposals: "prevProposalsSent",
    calls: "prevCallsMade",
    responseRate: "prevResponseRate",
    closeRate: "prevCloseRate", // #530
  };

  const sortedEntries = [...entries].sort((a, b) => {
    const key = metricKey[activeMetric];
    return (b[key] as number) - (a[key] as number);
  }).map((e, i) => ({ ...e, rank: i + 1 }));

  const currentUserEntry = sortedEntries.find(e => e.isCurrentUser);
  const visibleEntries = sortedEntries.filter(e => !e.isCurrentUser || sortedEntries.indexOf(e) < 10);
  const top10 = sortedEntries.slice(0, 10);
  const needsSeparator = currentUserEntry && currentUserEntry.rank > 10;

  const formatMetricValue = (entry: LeaderboardEntry, metric: string): string => {
    switch (metric) {
      case "deals": return `${entry.dealsClosed} deals`;
      case "revenue": return formatRevenue(entry.revenueManaged);
      case "proposals": return `${entry.proposalsSent} sent`;
      case "calls": return `${entry.callsMade} calls`;
      case "responseRate": return `${entry.responseRate}%`;
      case "closeRate": return `${entry.closeRate ?? 0}%`; // #530
      default: return "";
    }
  };

  type MetricTab = { key: string; label: string; icon: React.ElementType };
  const tabs = [
    settings?.showDeals !== false && { key: "deals", label: "Deals", icon: Trophy },
    settings?.showRevenue !== false && { key: "revenue", label: "Revenue", icon: DollarSign },
    settings?.showProposals !== false && { key: "proposals", label: "Proposals", icon: Send },
    settings?.showCallsMade !== false && { key: "calls", label: "Calls", icon: PhoneCall },
    settings?.showResponseRate && { key: "responseRate", label: "Response Rate", icon: Percent },
    { key: "closeRate", label: "Close Rate", icon: Percent }, // #530
  ].filter(Boolean) as MetricTab[];

  function openSettings() {
    if (settings) setLocalSettings({ ...settings });
    setEditingSettings(true);
  }

  return (
    <div className="space-y-6" data-testid="leaderboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-leaderboard-title">
            <Trophy className="w-7 h-7 text-yellow-500" />
            Team Leaderboard
          </h1>
          <p className="text-muted-foreground mt-1">Top performers ranked by key sales metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
            <SelectTrigger className="w-40" data-testid="select-time-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PERIOD_LABELS) as [TimePeriod, string][]).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button variant="outline" size="icon" aria-label="Leaderboard settings" onClick={openSettings} data-testid="button-leaderboard-settings">
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {editingSettings && localSettings && (
        <Card data-testid="card-leaderboard-settings">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Leaderboard Configuration
            </CardTitle>
            <CardDescription>Choose which metrics appear and set monthly targets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(
                [
                  { key: "showDeals" as BooleanSettingKey, label: "Show Deals Closed" },
                  { key: "showRevenue" as BooleanSettingKey, label: "Show Revenue Managed" },
                  { key: "showProposals" as BooleanSettingKey, label: "Show Proposals Sent" },
                  { key: "showCallsMade" as BooleanSettingKey, label: "Show Calls Made" },
                  { key: "showResponseRate" as BooleanSettingKey, label: "Show Response Rate" },
                  { key: "visibleToAgents" as BooleanSettingKey, label: "Visible to All Reps" },
                ] as { key: BooleanSettingKey; label: string }[]
              ).map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <Switch
                    id={`switch-${key}`}
                    checked={localSettings[key]}
                    onCheckedChange={(val) => setLocalSettings(s => s ? { ...s, [key]: val } : s)}
                    data-testid={`switch-${key}`}
                  />
                  <Label htmlFor={`switch-${key}`} className="text-sm">{label}</Label>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-1.5">
                <Label className="text-sm">Monthly Deal Goal</Label>
                <Input
                  type="number"
                  min={0}
                  value={localSettings.monthlyDealGoal}
                  onChange={(e) => setLocalSettings(s => s ? { ...s, monthlyDealGoal: Number(e.target.value) } : s)}
                  data-testid="input-monthly-deal-goal"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Monthly Revenue Goal ($)</Label>
                <Input
                  type="number"
                  min={0}
                  value={localSettings.monthlyRevenueGoal}
                  onChange={(e) => setLocalSettings(s => s ? { ...s, monthlyRevenueGoal: e.target.value } : s)}
                  data-testid="input-monthly-revenue-goal"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditingSettings(false)} data-testid="button-cancel-settings">Cancel</Button>
              <Button onClick={() => localSettings && saveSettingsMutation.mutate(localSettings)} disabled={saveSettingsMutation.isPending} data-testid="button-save-settings">
                {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeMetric} onValueChange={(v) => setActiveMetric(v as MetricKey)}>
        <TabsList data-testid="tabs-leaderboard-metrics">
          {tabs.map(({ key, label, icon: Icon }) => (
            <TabsTrigger key={key} value={key} data-testid={`tab-metric-${key}`}>
              <Icon className="w-3.5 h-3.5 mr-1.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map(({ key }) => (
          <TabsContent key={key} value={key} className="mt-4">
            {isLoading ? (
              <Card>
                <CardContent className="pt-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 py-3 border-b last:border-0">
                      <Skeleton className="w-6 h-6 rounded-full" />
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : entries.length === 0 ? (
              <Card data-testid="card-empty-leaderboard">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground mb-3" />
                  <p className="font-medium">No data yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Leaderboard data will appear once agents have activity for this period.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card data-testid="card-leaderboard-rankings">
                <CardContent className="p-0">
                  <div className="divide-y">
                    {top10.map((entry) => {
                      const metricVal = entry[metricKey[activeMetric]] as number;
                      const prevVal = entry[prevMetricKey[activeMetric]] as number;
                      const goalPct = settings?.monthlyDealGoal && key === "deals"
                        ? Math.min(100, Math.round((entry.dealsClosed / settings.monthlyDealGoal) * 100))
                        : null;
                      return (
                        <div
                          key={entry.agentId}
                          className={`flex items-center gap-3 px-4 py-3 transition-colors ${entry.isCurrentUser ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"}`}
                          data-testid={`row-agent-${entry.agentId}`}
                        >
                          <div className="w-6 flex justify-center shrink-0">
                            <RankBadge rank={entry.rank} />
                          </div>
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {entry.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate" data-testid={`text-agent-name-${entry.agentId}`}>
                                {entry.name}
                              </span>
                              {entry.isCurrentUser && (
                                <Badge variant="secondary" className="text-xs shrink-0" data-testid="badge-you">You</Badge>
                              )}
                            </div>
                            {goalPct !== null && (
                              <div className="mt-1 flex items-center gap-2">
                                <Progress value={goalPct} className="h-1.5 flex-1" />
                                <span className="text-xs text-muted-foreground shrink-0">{goalPct}% of goal</span>
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <span className="font-semibold text-sm" data-testid={`text-metric-${entry.agentId}`}>
                                {key === "revenue" ? formatRevenue(metricVal) : key === "responseRate" ? `${metricVal}%` : metricVal}
                              </span>
                              <TrendIndicator current={metricVal} prev={prevVal} />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {key === "deals" ? "deals" : key === "revenue" ? "revenue" : key === "proposals" ? "proposals" : key === "responseRate" ? "response rate" : "calls"}
                            </span>
                            {/* #1001 — Avg deal size when sorting by deals or revenue */}
                            {(key === "deals" || key === "revenue") && entry.dealsClosed > 0 && (
                              <span className="text-[10px] text-muted-foreground block" data-testid={`text-avg-deal-${entry.agentId}`}>
                                avg {formatRevenue(Math.round(entry.revenueManaged / entry.dealsClosed))}
                              </span>
                            )}
                            {/* #1101 — Rep efficiency score (deals closed ÷ contacts worked) */}
                            {key === "deals" && (() => {
                              const contactsWorked = (entry as any).contactsWorked as number | undefined;
                              if (!contactsWorked || contactsWorked === 0) return null;
                              const eff = entry.dealsClosed / contactsWorked;
                              return (
                                <span className="text-[10px] text-primary/70 block" data-testid={`text-efficiency-${entry.agentId}`}>
                                  {(eff * 100).toFixed(1)}% efficiency
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}

                    {needsSeparator && currentUserEntry && (
                      <>
                        <div className="px-4 py-2 text-xs text-muted-foreground text-center bg-muted/30">
                          · · ·
                        </div>
                        <div
                          className="flex items-center gap-3 px-4 py-3 bg-primary/5 border-l-2 border-l-primary"
                          data-testid={`row-agent-${currentUserEntry.agentId}-pinned`}
                        >
                          <div className="w-6 flex justify-center shrink-0">
                            <RankBadge rank={currentUserEntry.rank} />
                          </div>
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {currentUserEntry.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{currentUserEntry.name}</span>
                              <Badge variant="secondary" className="text-xs shrink-0">You</Badge>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <span className="font-semibold text-sm">
                                {key === "revenue"
                                  ? formatRevenue(currentUserEntry[metricKey[activeMetric]] as number)
                                  : key === "responseRate"
                                  ? `${currentUserEntry[metricKey[activeMetric]]}%`
                                  : currentUserEntry[metricKey[activeMetric]]}
                              </span>
                              <TrendIndicator
                                current={currentUserEntry[metricKey[activeMetric]] as number}
                                prev={currentUserEntry[prevMetricKey[activeMetric]] as number}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {settings?.monthlyDealGoal && key === "deals" && !isLoading && entries.length > 0 && (
              <Card className="mt-4" data-testid="card-goal-summary">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    Monthly Deal Goal: {settings.monthlyDealGoal} deals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {sortedEntries.slice(0, 5).map((entry) => {
                      const pct = Math.min(100, Math.round((entry.dealsClosed / settings.monthlyDealGoal) * 100));
                      return (
                        <div key={entry.agentId} className="space-y-1" data-testid={`goal-row-${entry.agentId}`}>
                          <div className="flex justify-between text-xs">
                            <span className={entry.isCurrentUser ? "font-semibold" : ""}>{entry.name}</span>
                            <span className="text-muted-foreground">{entry.dealsClosed}/{settings.monthlyDealGoal}</span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
