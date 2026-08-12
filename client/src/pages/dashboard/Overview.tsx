import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Users, Ticket, TrendingUp, CheckCircle, AlertTriangle, Clock,
  Target, ArrowUpRight, ArrowDownRight, Loader2, Brain, Sparkles,
  RefreshCw, DollarSign, Banknote, CalendarDays, BarChart3, Globe,
  Mail, Flame, Thermometer, Snowflake, Ban, PauseCircle, Activity,
  MessageSquare, Upload, Wifi, WifiOff,
} from "lucide-react";
import type { Contact, Deal } from "@shared/schema";

function formatResolutionTime(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours >= 24) return `${(hours / 24).toFixed(1)}d`;
  return `${hours.toFixed(1)}h`;
}

// #221 — Animated stat counter (count-up on first viewport entry)
function useCountUp(end: number, duration = 1200) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting && !started) setStarted(true); }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);
  useEffect(() => {
    if (!started || end === 0) return;
    const steps = 50;
    const inc = end / steps;
    let cur = 0;
    const t = setInterval(() => {
      cur += inc;
      if (cur >= end) { setCount(end); clearInterval(t); } else { setCount(Math.round(cur)); }
    }, duration / steps);
    return () => clearInterval(t);
  }, [started, end, duration]);
  return { count, ref };
}

function AnimatedStat({ value, "data-testid": testId }: { value: number; "data-testid"?: string }) {
  const { count, ref } = useCountUp(value);
  return <div className="text-2xl font-bold" data-testid={testId} ref={ref}>{count}</div>;
}

function formatInsights(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

interface LeadSource {
  source: string;
  leads: number;
  deals: number;
  won: number;
  conversionRate: number;
}

interface FunnelStep {
  stage: string;
  count: number;
}

interface DailyTrend {
  date: string;
  leads: number;
  deals: number;
}

interface OutboundSettings {
  outboundGlobalPaused: boolean;
  outboundGlobalPausedReason: string | null;
  outboundDailyEmailCap: number | null;
  ghlSyncEnabled: boolean;
}

// #319 — Time-of-day greeting helper
function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function Overview() {
  const { user } = useAuth();
  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);
  const [insights, setInsights] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [digestSending, setDigestSending] = useState(false);
  const [digestResult, setDigestResult] = useState<{
    period: string;
    newLeads: number;
    newDeals: number;
    proposalsSent: number;
    closedWon: number;
    closedLost: number;
    conversionRate: number;
    weeklyRevenue: number;
    newTickets: number;
    resolvedTickets: number;
    overdueTaskCount: number;
    sourceBreakdown: Record<string, number>;
  } | null>(null);

  const { data: outboundSettings } = useQuery<OutboundSettings>({
    queryKey: ["/api/system/outbound-settings"],
    refetchInterval: 60000,
    retry: false,
  });

  const insightsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/insights");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await res.json() as any;
    },
    onSuccess: (data) => {
      if (data?.error) {
        setInsights(data.message || "The AI assistant is temporarily unavailable.");
      } else {
        setInsights(data.insights);
      }
      setLastUpdated(new Date());
    },
  });

  const { data: kpi, isLoading: kpiLoading, isError } = useQuery<{
    pipeline: { totalActive: number; closedWon30d: number; closedLost30d: number; conversionRate: number; stagesBreakdown: Record<string, number>; newLeads7d: number };
    onboarding: { active: number; live: number };
    support: { openTickets: number; breachedSla: number; avgResolutionHours: number | null };
    tasks: { pending: number; overdue: number };
    contacts: { total: number; new30d: number; noOutreach24h: number }; // #1063 — noOutreach24h is a full-table server aggregate
    revenue: { totalEstVolume: number; totalEstResidual: number; totalEstProfit: number; avgDealProfit: number };
    topRepsByPipeline: Array<{ owner: string; openDeals: number }>; // #1144 — full-table server aggregate
  }>({ queryKey: ["/api/kpi/summary"], refetchInterval: 30000 });

  const { data: contactsResult, isLoading: contactsLoading } = useQuery<{ data: Contact[]; total: number }>({ queryKey: ["/api/contacts"], refetchInterval: 30000 });
  const contacts = contactsResult?.data;
  const { data: dealsResult, isLoading: dealsLoading } = useQuery<{ data: Deal[]; total: number }>({ queryKey: ["/api/deals"], refetchInterval: 30000 });
  const deals = dealsResult?.data;

  const { data: pipelineStats } = useQuery<{
    contactsByTier: Record<string, number>;
    dealsByStage: Record<string, number>;
    scored: number;
    unscored: number;
    totalDeals: number;
    awaitingOutreach: number;
    pipelineValue: number;
  }>({ queryKey: ["/api/kpi/pipeline-stats"] });

  const { data: comparative } = useQuery<{
    newDeals: { current: number; previous: number; change: number };
    newContacts: { current: number; previous: number; change: number };
    closedWon: { current: number; previous: number; change: number };
    tickets: { current: number; previous: number; change: number };
  }>({ queryKey: ["/api/kpi/comparative"], refetchInterval: 60000 });

  const { data: leadSources } = useQuery<{ sources: LeadSource[] }>({
    queryKey: ["/api/analytics/lead-sources"],
    refetchInterval: 60000,
  });

  // #380 — Rep activity today (admin/manager only; gracefully returns null for other roles)
  const { data: repActivity } = useQuery<{ date: string; reps: { actorId: string; name: string; callsLogged: number; emailsSent: number; smsSent: number; contactsCreated: number; dealsCreated: number; total: number }[] }>({
    queryKey: ["/api/admin/rep-activity/today"],
    refetchInterval: 60000,
    retry: false,
  });

  // #418 — Inactive reps (7 days, admin/manager only)
  const { data: inactiveRepsData } = useQuery<{ days: number; inactiveReps: { agentId: number; name: string; email: string }[] }>({
    queryKey: ["/api/admin/rep-activity/inactive"],
    refetchInterval: 300000,
    retry: false,
  });

  // #533 — Lifecycle state distribution
  const { data: lifecycleDistData } = useQuery<{ distribution: Record<string, number> }>({
    queryKey: ["/api/analytics/lifecycle-distribution"],
    refetchInterval: 120000,
    retry: false,
  });

  // #596 — Weekly outreach count
  const { data: weeklyOutreach } = useQuery<{ weekStart: string; total: number; counts: Record<string, number> }>({
    queryKey: ["/api/analytics/weekly-outreach"],
    refetchInterval: 60000,
    retry: false,
  });

  const { data: funnelData } = useQuery<{ totalLeads: number; totalDeals: number; funnel: FunnelStep[] }>({
    queryKey: ["/api/analytics/conversion-funnel"],
    refetchInterval: 60000,
  });

  const { data: dailyData } = useQuery<{ todayLeads: number; todayDeals: number; trend: DailyTrend[] }>({
    queryKey: ["/api/analytics/daily-leads"],
    refetchInterval: 30000,
  });

  if (kpiLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Unable to load dashboard data. Please try again.</p>
      </div>
    );
  }

  const recentContacts = contacts?.slice(0, 5) || [];
  const activeDeals = deals?.filter((d: Deal) => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost").slice(0, 5) || [];

  const handleSendDigest = async () => {
    setDigestSending(true);
    try {
      const res = await apiRequest("POST", "/api/analytics/weekly-digest", {});
      const data = await res.json();
      setDigestResult(data);
    } catch {
      setDigestResult(null);
    } finally {
      setDigestSending(false);
    }
  };

  const maxFunnelCount = funnelData?.funnel ? Math.max(...funnelData.funnel.map(f => f.count), 1) : 1;
  const maxTrendLeads = dailyData?.trend ? Math.max(...dailyData.trend.map(t => t.leads), 1) : 1;

  return (
    <div className="space-y-8">
      {/* #319 — Personalized time-of-day greeting */}
      {user?.firstName && (
        <p className="text-lg font-medium text-muted-foreground" data-testid="text-overview-greeting">
          {greeting}, {user.firstName}!
        </p>
      )}

      {/* ── OUTBOUND PAUSED BANNER ── */}
      {outboundSettings?.outboundGlobalPaused && (
        <Alert
          variant="destructive"
          className="border-orange-400 bg-orange-50 dark:bg-orange-950 text-orange-900 dark:text-orange-100"
          data-testid="banner-outbound-paused"
        >
          <PauseCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
            <span>
              <strong>Outbound is globally paused.</strong>
              {outboundSettings.outboundGlobalPausedReason && (
                <span className="ml-1 opacity-80">{outboundSettings.outboundGlobalPausedReason}</span>
              )}{" "}
              No emails, SMS, or sequences will be sent until outbound is re-enabled.
            </span>
            <Link
              href="/dashboard/activation"
              className="underline underline-offset-2 font-semibold text-orange-800 dark:text-orange-200 hover:opacity-80 whitespace-nowrap shrink-0"
              data-testid="link-outbound-paused-go-live"
            >
              Go-Live Controls →
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-primary/5 dark:bg-primary/10" data-testid="card-ai-copilot">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">AI Operations Copilot</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendDigest}
              disabled={digestSending}
              data-testid="button-send-digest"
            >
              {digestSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
              Weekly Digest
            </Button>
            {insights ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => insightsMutation.mutate()}
                disabled={insightsMutation.isPending}
                data-testid="button-get-insights"
              >
                {insightsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Refresh
              </Button>
            ) : (
              <Button
                onClick={() => insightsMutation.mutate()}
                disabled={insightsMutation.isPending}
                size="sm"
                data-testid="button-get-insights"
              >
                {insightsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Get AI Insights
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {insightsMutation.isPending && !insights && (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analyzing your operations data...</span>
            </div>
          )}
          {insights && (
            <div className="space-y-3">
              <div className="text-sm leading-relaxed whitespace-pre-line" data-testid="text-ai-insights">
                {formatInsights(insights)}
              </div>
              {lastUpdated && (
                <p className="text-xs text-muted-foreground" data-testid="text-insights-timestamp">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
          {digestResult && !insights && (
            <div className="text-sm text-muted-foreground">
              Digest generated: {digestResult.newLeads} leads, {digestResult.closedWon} won this week
            </div>
          )}
          {!insights && !insightsMutation.isPending && !digestResult && (
            <p className="text-sm text-muted-foreground">
              Click "Get AI Insights" to analyze your pipeline, support tickets, and onboarding data.
            </p>
          )}
          {insightsMutation.isError && (
            <p className="text-sm text-destructive mt-2">
              Failed to load insights. Please try again.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── SECTION 1: ACTUAL PERFORMANCE ── */}
      <div data-testid="section-actual-performance">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Actual Performance</h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <Card data-testid="card-kpi-today-leads">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Today's Leads</CardTitle>
                <CalendarDays className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <AnimatedStat value={dailyData?.todayLeads || 0} data-testid="text-today-leads" />
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-today-deals">{dailyData?.todayDeals || 0} deals created</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-pipeline">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Pipeline</CardTitle>
                <TrendingUp className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <AnimatedStat value={kpi?.pipeline.totalActive || 0} data-testid="text-active-pipeline" />
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-new-leads">{kpi?.pipeline.newLeads7d || 0} new this week</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-conversion">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate (30d)</CardTitle>
                <Target className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-conversion-rate">{kpi?.pipeline.conversionRate || 0}%</div>
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-won-lost">{kpi?.pipeline.closedWon30d || 0}W / {kpi?.pipeline.closedLost30d || 0}L</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-support">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Open Tickets</CardTitle>
                <Ticket className="w-4 h-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <AnimatedStat value={kpi?.support.openTickets || 0} data-testid="text-open-tickets" />
                {(kpi?.support.breachedSla || 0) > 0 ? (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1" data-testid="text-sla-breach">
                    <AlertTriangle className="w-3 h-3" />
                    {kpi?.support.breachedSla} SLA breaches
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-sla-ok">All within SLA</p>
                )}
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-avg-resolution">
                  Avg resolution: <span className="font-medium">{formatResolutionTime(kpi?.support.avgResolutionHours)}</span>
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-tasks">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
                <Clock className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <AnimatedStat value={kpi?.tasks.pending || 0} data-testid="text-pending-tasks" />
                {(kpi?.tasks.overdue || 0) > 0 ? (
                  <p className="text-xs text-destructive mt-1" data-testid="text-overdue-tasks">{kpi?.tasks.overdue} overdue</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-tasks-ok">None overdue</p>
                )}
              </CardContent>
            </Card>

            {/* #584 — Stale deals (no updatedAt change in 30 days) */}
            {(() => {
              if (!deals) return null;
              const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
              const stale = deals.filter((d: any) => {
                if (d.archivedAt || d.stage === "Closed Won" || d.stage === "Closed Lost") return false;
                const last = d.updatedAt || d.createdAt;
                return last && new Date(last).getTime() < thirtyDaysAgo;
              }).length;
              if (stale === 0) return null;
              return (
                <Card data-testid="card-kpi-stale-deals">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Stale Deals (30d)</CardTitle>
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </CardHeader>
                  <CardContent>
                    <AnimatedStat value={stale} data-testid="text-stale-deals" />
                    <p className="text-xs text-muted-foreground mt-1">Active deals with no update</p>
                  </CardContent>
                </Card>
              );
            })()}

            {/* #603 — Follow-ups due today */}
            {(() => {
              if (!deals) return null;
              const todayStr = new Date().toLocaleDateString();
              const dueToday = deals.filter((d: any) => {
                if (!d.nextFollowUp || d.archivedAt || d.stage === "Closed Won" || d.stage === "Closed Lost") return false;
                return new Date(d.nextFollowUp).toLocaleDateString() === todayStr;
              }).length;
              return (
                <Card data-testid="card-kpi-follow-ups-today">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Follow-ups Today</CardTitle>
                    <CalendarDays className="w-4 h-4 text-amber-500" />
                  </CardHeader>
                  <CardContent>
                    <AnimatedStat value={dueToday} data-testid="text-follow-ups-today" />
                    <p className="text-xs text-muted-foreground mt-1">Deals due for follow-up</p>
                  </CardContent>
                </Card>
              );
            })()}
          </div>

          {/* Month-over-month comparisons */}
          {comparative && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-comparative">
              {[
                { label: "New Deals", data: comparative.newDeals, icon: TrendingUp },
                { label: "New Contacts", data: comparative.newContacts, icon: Users },
                { label: "Closed Won", data: comparative.closedWon, icon: CheckCircle },
                { label: "Support Tickets", data: comparative.tickets, icon: Ticket },
              ].map((item) => (
                <Card key={item.label} data-testid={`card-compare-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
                    <item.icon className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{item.data.current}</div>
                    <div className="flex items-center gap-1 text-xs flex-wrap">
                      {item.data.change >= 0 ? (
                        <ArrowUpRight className="w-3 h-3 text-green-600" />
                      ) : (
                        <ArrowDownRight className="w-3 h-3 text-red-600" />
                      )}
                      <span className={item.data.change >= 0 ? "text-green-600" : "text-red-600"}>
                        {item.data.change > 0 ? "+" : ""}{item.data.change}%
                      </span>
                      <span className="text-muted-foreground">vs last month ({item.data.previous})</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Contacts, onboarding, pipeline stages, lead sources */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card data-testid="card-lead-sources">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  Top Lead Sources (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* #799 — visual bar breakdown by source */}
                {leadSources?.sources && leadSources.sources.length > 0 ? (
                  <div className="space-y-3">
                    {(() => {
                      const maxLeads = Math.max(...leadSources.sources.map((s: any) => s.leads || 0), 1);
                      return leadSources.sources.map((src: any) => (
                        <div key={src.source} className="space-y-1" data-testid={`source-row-${src.source}`}>
                          <div className="flex items-center justify-between text-xs">
                            <Badge variant="secondary" className="text-xs shrink-0">{src.source}</Badge>
                            <span className="text-muted-foreground">{src.leads} leads · {src.deals} deals · <span className="font-medium text-foreground">{src.conversionRate}% conv.</span></span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${Math.round((src.leads / maxLeads) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No source data available</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-contacts">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Contacts & Onboarding
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Contacts</span>
                  <span className="text-lg font-bold" data-testid="text-total-contacts">{kpi?.contacts.total || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">New (30d)</span>
                  <span className="text-lg font-medium">{kpi?.contacts.new30d || 0}</span>
                </div>
                {/* #1063 — New leads in last 24h with no outreach (server-side full-table aggregate) */}
                {kpi?.contacts && kpi.contacts.noOutreach24h > 0 && (
                  <div className="flex items-center justify-between" data-testid="stat-no-outreach-24h">
                    <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> No outreach (24h)
                    </span>
                    <Link href="/dashboard/contacts" className="text-lg font-medium text-amber-600 dark:text-amber-400 hover:underline" data-testid="text-no-outreach-24h">
                      {kpi.contacts.noOutreach24h}
                    </Link>
                  </div>
                )}
                {/* #673 — Contacts added this week */}
                {kpi?.contacts && (kpi.contacts as any).new7d != null && (
                  <div className="flex items-center justify-between" data-testid="stat-contacts-this-week">
                    <span className="text-sm text-muted-foreground">New (7d)</span>
                    <span className="text-lg font-medium">{(kpi.contacts as any).new7d}</span>
                  </div>
                )}
                {/* #848 — Blocked contacts count */}
                {kpi?.contacts && (kpi.contacts as any).blocked > 0 && (
                  <div className="flex items-center justify-between" data-testid="stat-blocked-contacts">
                    <span className="text-sm text-muted-foreground text-destructive">Blocked</span>
                    <span className="text-lg font-medium text-destructive">{(kpi.contacts as any).blocked}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Onboarding Active</span>
                  <span className="text-lg font-medium" data-testid="text-onboarding-active">{kpi?.onboarding.active || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Live Merchants</span>
                  <span className="text-lg font-medium text-green-600">{kpi?.onboarding.live || 0}</span>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-stages">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  Pipeline Stages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {kpi?.pipeline.stagesBreakdown && Object.keys(kpi.pipeline.stagesBreakdown).length > 0 ? (
                    Object.entries(kpi.pipeline.stagesBreakdown).map(([stage, count]) => (
                      <Badge key={stage} variant="secondary" className="text-xs" data-testid={`badge-stage-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                        {stage}: {count}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No active deals</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card data-testid="card-recent-contacts">
              <CardHeader>
                <CardTitle className="text-base">Recent Contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {contactsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-muted rounded w-32" />
                          <div className="h-2.5 bg-muted rounded w-48" />
                        </div>
                      </div>
                    ))
                  ) : recentContacts.length > 0 ? (
                    recentContacts.map((contact: Contact) => (
                      <div key={contact.id} className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate transition-colors" data-testid={`row-contact-${contact.id}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {contact.firstName?.[0] ?? '?'}{contact.lastName?.[0] ?? ''}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate" data-testid={`text-contact-name-${contact.id}`}>{contact.firstName} {contact.lastName}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {contact.companyName || contact.email}
                              {contact.utmSource && <span className="ml-1 text-primary/70">({contact.utmSource})</span>}
                            </div>
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0" data-testid={`badge-contact-status-${contact.id}`}>
                          {contact.status}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground py-8" data-testid="text-no-contacts">No recent contacts</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-active-deals">
              <CardHeader>
                <CardTitle className="text-base">Active Deals</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dealsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-muted rounded w-24" />
                          <div className="h-2.5 bg-muted rounded w-40" />
                        </div>
                        <div className="h-5 bg-muted rounded w-20" />
                      </div>
                    ))
                  ) : activeDeals.length > 0 ? (
                    activeDeals.map((deal: Deal) => (
                      <div key={deal.id} className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate transition-colors" data-testid={`row-deal-${deal.id}`}>
                        <div className="min-w-0">
                          <div className="font-medium text-sm" data-testid={`text-deal-id-${deal.id}`}>Deal #{deal.id}</div>
                          <div className="text-xs text-muted-foreground">
                            {deal.offerPath || "No offer path"}
                            {deal.leadSource && <span className="ml-1 text-primary/70">({deal.leadSource})</span>}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0" data-testid={`badge-deal-stage-${deal.id}`}>
                          {deal.stage}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground py-8" data-testid="text-no-deals">No active deals</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* #596 — Weekly outreach count metric */}
      {weeklyOutreach && weeklyOutreach.total > 0 && (
        <Card className="mb-6" data-testid="card-weekly-outreach">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              This Week's Outreach
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div data-testid="stat-weekly-calls">
                <div className="text-2xl font-bold">{(weeklyOutreach.counts.call_logged || 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Calls</div>
              </div>
              <div data-testid="stat-weekly-emails">
                <div className="text-2xl font-bold">{((weeklyOutreach.counts.email_sent || 0) + (weeklyOutreach.counts.sequence_email_sent || 0)).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Emails</div>
              </div>
              <div data-testid="stat-weekly-sms">
                <div className="text-2xl font-bold">{(weeklyOutreach.counts.sms_sent || 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">SMS</div>
              </div>
              <div data-testid="stat-weekly-total">
                <div className="text-2xl font-bold text-primary">{weeklyOutreach.total.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Actions</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── SECTION 2: PIPELINE PROJECTIONS ── */}
      <div data-testid="section-pipeline-projections">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pipeline Projections</h2>
          <Badge variant="secondary" className="text-xs font-normal">AI Estimates · Not earned revenue</Badge>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-6">
          {/* Projected financial KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="card-kpi-volume">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Proj. Monthly Volume</CardTitle>
                <DollarSign className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-est-volume">${(kpi?.revenue.totalEstVolume || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Est. if pipeline converts</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-residual">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Proj. Monthly Residual</CardTitle>
                <Banknote className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-est-residual">${(kpi?.revenue.totalEstResidual || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Est. if pipeline converts</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-profit">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Proj. Gross Profit</CardTitle>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-est-profit">${(kpi?.revenue.totalEstProfit || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Est. across all pipeline deals</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-avg-deal">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Projected Profit</CardTitle>
                <Target className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-avg-deal-profit">${(kpi?.revenue.avgDealProfit || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Per deal average</p>
              </CardContent>
            </Card>
          </div>

          {/* Lead scoring tiers */}
          {pipelineStats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="section-pipeline-stats">
              <Card data-testid="card-tier-hot">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Hot Leads (70+)</CardTitle>
                  <Flame className="w-4 h-4 text-red-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600" data-testid="text-hot-count">{pipelineStats.contactsByTier.hot || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Ready for immediate outreach</p>
                </CardContent>
              </Card>

              <Card data-testid="card-tier-warm">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Warm Leads (45-69)</CardTitle>
                  <Thermometer className="w-4 h-4 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600" data-testid="text-warm-count">{pipelineStats.contactsByTier.warm || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Nurture pipeline</p>
                </CardContent>
              </Card>

              <Card data-testid="card-tier-cold">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cold Leads (20-44)</CardTitle>
                  <Snowflake className="w-4 h-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600" data-testid="text-cold-count">{pipelineStats.contactsByTier.cold || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Long-term nurture</p>
                </CardContent>
              </Card>

              <Card data-testid="card-awaiting-outreach">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Awaiting Outreach</CardTitle>
                  <Mail className="w-4 h-4 text-purple-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600" data-testid="text-awaiting-outreach">{pipelineStats.awaitingOutreach || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Scored but not yet contacted</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Scoring summary + deals by stage */}
          {pipelineStats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="section-scoring-summary">
              <Card data-testid="card-scoring-progress">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Scoring Progress</CardTitle>
                  <Target className="w-4 h-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-scored-count">{pipelineStats.scored.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">{pipelineStats.unscored.toLocaleString()} unscored remaining</p>
                  <div className="mt-2 w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${pipelineStats.scored + pipelineStats.unscored > 0 ? Math.round((pipelineStats.scored / (pipelineStats.scored + pipelineStats.unscored)) * 100) : 0}%` }}
                      data-testid="progress-scoring"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-total-deals">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Deals</CardTitle>
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-deals">{pipelineStats.totalDeals.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Across all pipelines</p>
                </CardContent>
              </Card>

              <Card data-testid="card-pipeline-value">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active Deal Value</CardTitle>
                  <DollarSign className="w-4 h-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-pipeline-value">${Math.round(pipelineStats.pipelineValue).toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Est. gross profit (open deals only)</p>
                </CardContent>
              </Card>
            </div>
          )}

          {pipelineStats && Object.keys(pipelineStats.dealsByStage).length > 0 && (
            <Card data-testid="card-deals-by-stage">
              <CardHeader>
                <CardTitle className="text-base">Deals by Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(pipelineStats.dealsByStage).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between gap-2" data-testid={`row-stage-${stage.toLowerCase().replace(/[\s/]+/g, "-")}`}>
                      <span className="text-sm truncate">{stage}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-32 bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${Math.min(100, (count / Math.max(...Object.values(pipelineStats.dealsByStage))) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-12 text-right">{count.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trend & funnel charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card data-testid="card-weekly-trend">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Weekly Lead Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dailyData?.trend && dailyData.trend.length > 0 ? (
                  <div className="space-y-2">
                    {dailyData.trend.map((day) => {
                      const dayLabel = new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                      return (
                        <div key={day.date} className="space-y-1" data-testid={`trend-row-${day.date}`}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground w-28 shrink-0">{dayLabel}</span>
                            <span className="font-medium">{day.leads} leads / {day.deals} deals</span>
                          </div>
                          <div className="flex gap-1 h-3">
                            <div
                              className="bg-primary/70 rounded-sm transition-all"
                              style={{ width: `${(day.leads / maxTrendLeads) * 100}%`, minWidth: day.leads > 0 ? "4px" : "0" }}
                              title={`${day.leads} leads`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No trend data available</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-conversion-funnel">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-600" />
                  Conversion Funnel (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {funnelData?.funnel && funnelData.funnel.length > 0 ? (
                  <div className="space-y-2">
                    {funnelData.funnel.map((step) => (
                      <div key={step.stage} className="space-y-1" data-testid={`funnel-step-${step.stage.toLowerCase().replace(/\s+/g, "-")}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span>{step.stage}</span>
                          <span className="font-medium text-muted-foreground">{step.count}</span>
                        </div>
                        <Progress value={maxFunnelCount > 0 ? (step.count / maxFunnelCount) * 100 : 0} className="h-2" />
                      </div>
                    ))}
                    <div className="pt-2 flex gap-4 text-xs text-muted-foreground">
                      <span>{funnelData.totalLeads} total leads</span>
                      <span>{funnelData.totalDeals} total deals</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No funnel data available</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* #380 — Rep Activity Today (admin/manager only) */}
          {repActivity && repActivity.reps.length > 0 && (
            <Card data-testid="card-rep-activity-today">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Rep Activity Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left pb-2">Rep</th>
                        <th className="text-right pb-2">Calls</th>
                        <th className="text-right pb-2">Emails</th>
                        <th className="text-right pb-2">SMS</th>
                        <th className="text-right pb-2">Contacts</th>
                        <th className="text-right pb-2">Deals</th>
                        <th className="text-right pb-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repActivity.reps.map(rep => (
                        <tr key={rep.actorId} className="border-b last:border-0" data-testid={`rep-activity-row-${rep.actorId}`}>
                          <td className="py-1.5 font-medium">{rep.name}</td>
                          <td className="py-1.5 text-right">{rep.callsLogged || "—"}</td>
                          <td className="py-1.5 text-right">{rep.emailsSent || "—"}</td>
                          <td className="py-1.5 text-right">{rep.smsSent || "—"}</td>
                          <td className="py-1.5 text-right">{rep.contactsCreated || "—"}</td>
                          <td className="py-1.5 text-right">{rep.dealsCreated || "—"}</td>
                          <td className="py-1.5 text-right font-semibold">{rep.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          {/* #533 — Lifecycle state breakdown */}
          {lifecycleDistData && Object.keys(lifecycleDistData.distribution).length > 0 && (
            <Card data-testid="card-lifecycle-distribution">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Contacts by Lifecycle State
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {Object.entries(lifecycleDistData.distribution).slice(0, 10).map(([state, count]) => (
                    <div key={state} className="flex items-center justify-between text-xs" data-testid={`row-lifecycle-${state}`}>
                      <span className="text-muted-foreground capitalize">{state.replace(/_/g, " ")}</span>
                      <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* #1083 — Recent wins (last 5 Closed Won deals) */}
          {deals && (deals as any[]).filter((d: any) => d.stage === "Closed Won").length > 0 && (
            <Card data-testid="card-recent-wins">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-green-500">🏆</span>
                  Recent Wins
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(deals as any[])
                    .filter((d: any) => d.stage === "Closed Won")
                    .sort((a: any, b: any) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
                    .slice(0, 5)
                    .map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between text-sm" data-testid={`win-${d.id}`}>
                        <span className="font-medium truncate max-w-[60%]">{d.businessName || d.contactName || `Deal #${d.id}`}</span>
                        <span className="text-xs text-muted-foreground">{d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : "—"}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* #1144 — Top 5 reps by open deals (server-side full-table aggregate via kpi/summary) */}
          {kpi?.topRepsByPipeline && kpi.topRepsByPipeline.length > 0 && (
            <Card data-testid="card-top-reps-pipeline">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Top Reps by Open Deals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {kpi.topRepsByPipeline.map((rep, i) => (
                    <div key={rep.owner} className="flex items-center justify-between text-sm" data-testid={`top-rep-pipeline-${i}`}>
                      <span className="font-medium truncate max-w-[60%]">{rep.owner}</span>
                      <Badge variant="secondary">{rep.openDeals} open</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* #418 — Inactive Reps (7 days) */}
          {inactiveRepsData && inactiveRepsData.inactiveReps.length > 0 && (
            <Card data-testid="card-inactive-reps">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-500" />
                  Inactive Reps (7 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {inactiveRepsData.inactiveReps.map(rep => (
                    <span key={rep.agentId} className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded px-2 py-0.5" data-testid={`badge-inactive-rep-${rep.agentId}`}>
                      {rep.name || rep.email}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">No activity logged in the past {inactiveRepsData.days} days</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
