import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  TrendingDown,
  XCircle,
  Shield,
  Wifi,
  Ban,
  Loader2,
  CheckCircle,
  Activity,
  Heart,
  Clock,
  WifiOff,
  DollarSign,
  BarChart3,
  Brain,
  Info,
  ExternalLink,
  RefreshCw,
  Filter,
} from "lucide-react";
import type { HealthAlert, MerchantHealthScore, Agent } from "@shared/schema";

const ALERT_TYPE_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle }> = {
  volume_decline: { label: "Volume Decline", icon: TrendingDown },
  chargeback_spike: { label: "Chargeback", icon: AlertTriangle },
  no_processing: { label: "No Processing", icon: XCircle },
  high_refund_rate: { label: "High Refunds", icon: Ban },
  compliance_issue: { label: "Compliance", icon: Shield },
  terminal_offline: { label: "Terminal Offline", icon: WifiOff },
  funding_hold: { label: "Funding Hold", icon: DollarSign },
};

const SEVERITY_STYLES: Record<string, { badge: "destructive" | "outline" | "secondary"; textClass: string }> = {
  critical: { badge: "destructive", textClass: "text-red-600 dark:text-red-400" },
  warning: { badge: "outline", textClass: "text-amber-600 dark:text-amber-400" },
  info: { badge: "secondary", textClass: "text-blue-600 dark:text-blue-400" },
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, warning: 1, info: 2 };

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "volume_decline", label: "Volume Decline" },
  { key: "chargeback_spike", label: "Chargeback" },
  { key: "no_processing", label: "No Processing" },
  { key: "high_refund_rate", label: "High Refunds" },
  { key: "compliance_issue", label: "Compliance" },
  { key: "terminal_offline", label: "Terminal Offline" },
  { key: "funding_hold", label: "Funding Hold" },
];

const CHURN_TIER_FILTERS = ["all", "Critical", "High", "Medium", "Low"] as const;

const TIER_CONFIG: Record<string, { badge: "destructive" | "outline" | "secondary" | "default"; bgClass: string; textClass: string; label: string }> = {
  Critical: { badge: "destructive", bgClass: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800", textClass: "text-red-700 dark:text-red-400", label: "Critical Risk" },
  High: { badge: "destructive", bgClass: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800", textClass: "text-orange-600 dark:text-orange-400", label: "High Risk" },
  Medium: { badge: "outline", bgClass: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", textClass: "text-amber-600 dark:text-amber-400", label: "Medium Risk" },
  Low: { badge: "secondary", bgClass: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800", textClass: "text-green-700 dark:text-green-400", label: "Low Risk" },
};

function getAlertIcon(alertType: string) {
  return ALERT_TYPE_CONFIG[alertType]?.icon ?? AlertTriangle;
}

function getSeverityStyle(severity: string | null) {
  return SEVERITY_STYLES[severity || "info"] || SEVERITY_STYLES.info;
}

type EnrichedChurnScore = MerchantHealthScore & {
  contact: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    vertical: string | null;
    email: string | null;
  } | null;
};

function ScoreBar({ value, max = 100, colorClass }: { value: number; max?: number; colorClass: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const SIGNAL_WEIGHT_KEYS: Record<string, string> = {
  "Volume Trend": "volume_trend",
  "Chargeback Trend": "chargeback_trend",
  "Ticket Velocity": "ticket_velocity",
  "NPS Score": "nps_score",
  "Portal Activity": "portal_activity",
  "Outreach Response": "outreach_response",
};

function ChurnScoreBreakdownTooltip({
  score,
  weightsMap,
}: {
  score: EnrichedChurnScore;
  weightsMap: Record<string, number>;
}) {
  const effective = score.overrideScore !== null ? score.overrideScore : score.churnScore;
  const components = [
    { label: "Volume Trend", value: score.volumeTrendScore ?? 0 },
    { label: "Chargeback Trend", value: score.chargebackTrendScore ?? 0 },
    { label: "Ticket Velocity", value: score.ticketVelocityScore ?? 0 },
    { label: "NPS Score", value: score.npsScore ?? 0 },
    { label: "Portal Activity", value: score.portalActivityScore ?? 0 },
    { label: "Outreach Response", value: score.outreachResponseScore ?? 0 },
  ];
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help inline-flex items-center gap-1">
            <span className="font-bold text-lg">{Math.round(effective)}</span>
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="w-72 p-3 space-y-2" side="right">
          <p className="font-semibold text-sm">Churn Score Breakdown</p>
          {score.overrideScore !== null && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ Manual override applied (computed: {Math.round(score.churnScore)})
            </p>
          )}
          <div className="grid grid-cols-3 gap-x-2 text-xs text-muted-foreground font-medium pb-1 border-b">
            <span>Signal</span>
            <span className="text-center">Raw</span>
            <span className="text-right">Weight</span>
          </div>
          {components.map(c => {
            const wKey = SIGNAL_WEIGHT_KEYS[c.label];
            const weight = wKey ? (weightsMap[wKey] ?? 1.0) : 1.0;
            return (
              <div key={c.label} className="space-y-0.5">
                <div className="grid grid-cols-3 gap-x-2 text-xs items-center">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-medium text-center">{Math.round(c.value)}</span>
                  <span className="text-right text-muted-foreground">×{weight.toFixed(2)}</span>
                </div>
                <ScoreBar value={c.value} max={30} colorClass="bg-primary" />
              </div>
            );
          })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function MerchantHealth() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("alerts");
  const [churnTierFilter, setChurnTierFilter] = useState<string>("all");
  const [churnVerticalFilter, setChurnVerticalFilter] = useState<string>("all");
  const [churnAgentFilter, setChurnAgentFilter] = useState<string>("all");

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<HealthAlert[]>({
    queryKey: ["/api/health-alerts"],
  });

  const { data: agentsList = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: churnScores = [], isLoading: churnLoading, refetch: refetchChurn } = useQuery<EnrichedChurnScore[]>({
    queryKey: ["/api/churn-scores", churnTierFilter, churnVerticalFilter, churnAgentFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (churnTierFilter !== "all") params.set("riskTier", churnTierFilter);
      if (churnVerticalFilter !== "all") params.set("vertical", churnVerticalFilter);
      if (churnAgentFilter !== "all") params.set("agentOwner", churnAgentFilter);
      const qs = params.toString();
      const url = qs ? `/api/churn-scores?${qs}` : "/api/churn-scores";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch churn scores");
      return res.json();
    },
  });

  const { data: churnSummary = [] } = useQuery<{ tier: string; count: number }[]>({
    queryKey: ["/api/churn-scores/summary"],
  });

  const { data: churnWeights = [] } = useQuery<{ signalKey: string; weight: number }[]>({
    queryKey: ["/api/churn-score-weights"],
  });
  const weightsMap = Object.fromEntries(churnWeights.map(w => [w.signalKey, w.weight]));

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/health-alerts/${id}`, {
        status: "acknowledged",
        acknowledgedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/health-alerts"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/health-alerts/${id}`, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/health-alerts"] }),
  });

  const criticalCount = alerts.filter(a => a.severity === "critical" || a.severity === "urgent").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const healthyCount = Math.max(0, 100 - alerts.length);
  const avgHealthScore = alerts.length > 0 ? Math.max(0, 100 - alerts.length * 5) : 100;

  const filteredAlerts = (activeFilter === "all" ? alerts : alerts.filter(a => a.alertType === activeFilter))
    .sort((a, b) => (SEVERITY_ORDER[a.severity || "info"] ?? 2) - (SEVERITY_ORDER[b.severity || "info"] ?? 2));

  const churnCriticalCount = churnSummary.find(s => s.tier === "Critical")?.count ?? 0;
  const churnHighCount = churnSummary.find(s => s.tier === "High")?.count ?? 0;
  const churnMediumCount = churnSummary.find(s => s.tier === "Medium")?.count ?? 0;
  const churnLowCount = churnSummary.find(s => s.tier === "Low")?.count ?? 0;
  const totalScored = churnCriticalCount + churnHighCount + churnMediumCount + churnLowCount;

  const filteredChurnScores = churnTierFilter === "all"
    ? churnScores
    : churnScores.filter(s => {
        const effective = s.overrideScore !== null ? s.overrideScore : s.churnScore;
        const tier = effective > 85 ? "Critical" : effective > 70 ? "High" : effective >= 40 ? "Medium" : "Low";
        return tier === churnTierFilter;
      });

  return (
    <div className="space-y-8" data-testid="page-merchant-health">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Merchant Health Monitor</h1>
        <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
          Proactive alerts, churn prediction scoring, and at-risk merchant intelligence
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-kpi-critical">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical Alerts</CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-critical-count">{criticalCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Requires immediate attention</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-warning">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warning Alerts</CardTitle>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-warning-count">{warningCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Monitor closely</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-healthy">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Healthy Merchants</CardTitle>
            <Heart className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-healthy-count">{healthyCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Operating normally</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-churn-risk">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">High/Critical Churn Risk</CardTitle>
            <Brain className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400" data-testid="text-churn-risk-count">
              {churnCriticalCount + churnHighCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {churnCriticalCount} critical · {churnHighCount} high
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="merchant-health-tabs">
        <TabsList data-testid="merchant-health-tabs-list">
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            <Activity className="w-4 h-4 mr-1.5" />
            Health Alerts
            {filteredAlerts.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">{filteredAlerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="churn-risk" data-testid="tab-churn-risk">
            <Brain className="w-4 h-4 mr-1.5" />
            Churn Risk
            {(churnCriticalCount + churnHighCount) > 0 && (
              <Badge variant="destructive" className="ml-1.5">{churnCriticalCount + churnHighCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Alerts Tab ─── */}
        <TabsContent value="alerts" data-testid="tab-content-alerts" className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-2" data-testid="filter-alert-types">
            {FILTER_OPTIONS.map(opt => (
              <Button
                key={opt.key}
                variant={activeFilter === opt.key ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveFilter(opt.key)}
                className={`toggle-elevate ${activeFilter === opt.key ? "toggle-elevated" : ""}`}
                data-testid={`button-filter-${opt.key}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <Card data-testid="card-active-alerts">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Active Alerts
                {filteredAlerts.length > 0 && (
                  <Badge variant="secondary" data-testid="badge-alert-count">{filteredAlerts.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAlerts.length === 0 ? (
                <div className="text-center py-12" data-testid="text-no-alerts">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No active alerts — all merchants are healthy</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredAlerts.map(alert => {
                    const IconComponent = getAlertIcon(alert.alertType);
                    const severityStyle = getSeverityStyle(alert.severity);
                    const typeConfig = ALERT_TYPE_CONFIG[alert.alertType];
                    return (
                      <div
                        key={alert.id}
                        className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-md border"
                        data-testid={`card-alert-${alert.id}`}
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`mt-0.5 shrink-0 ${severityStyle.textClass}`}>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm" data-testid={`text-alert-title-${alert.id}`}>{alert.title}</span>
                              <Badge variant={severityStyle.badge} data-testid={`badge-severity-${alert.id}`}>{alert.severity}</Badge>
                              {typeConfig && <Badge variant="secondary" data-testid={`badge-type-${alert.id}`}>{typeConfig.label}</Badge>}
                            </div>
                            {alert.description && (
                              <p className="text-sm text-muted-foreground" data-testid={`text-alert-desc-${alert.id}`}>{alert.description}</p>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {alert.metric && <span>Metric: {alert.metric}</span>}
                              {alert.currentValue && <span>Current: {alert.currentValue}</span>}
                              {alert.threshold && <span>Threshold: {alert.threshold}</span>}
                              {alert.createdAt && <span>{new Date(alert.createdAt).toLocaleDateString()}</span>}
                            </div>
                            {alert.status === "acknowledged" && alert.acknowledgedAt && (
                              <p className="text-xs text-muted-foreground italic">
                                Acknowledged {new Date(alert.acknowledgedAt).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {alert.status === "active" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => acknowledgeMutation.mutate(alert.id)}
                              disabled={acknowledgeMutation.isPending}
                              data-testid={`button-acknowledge-${alert.id}`}
                            >
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => resolveMutation.mutate(alert.id)}
                            disabled={resolveMutation.isPending}
                            data-testid={`button-resolve-${alert.id}`}
                          >
                            Resolve
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Churn Risk Tab ─── */}
        <TabsContent value="churn-risk" data-testid="tab-content-churn-risk" className="mt-6 space-y-6">
          {/* Tier summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(["Critical", "High", "Medium", "Low"] as const).map(tier => {
              const cfg = TIER_CONFIG[tier];
              const cnt = churnSummary.find(s => s.tier === tier)?.count ?? 0;
              return (
                <Card
                  key={tier}
                  className={`cursor-pointer border-2 transition-all ${churnTierFilter === tier ? cfg.bgClass + " border-primary" : "border-transparent"}`}
                  onClick={() => setChurnTierFilter(churnTierFilter === tier ? "all" : tier)}
                  data-testid={`card-churn-tier-${tier.toLowerCase()}`}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className={`text-2xl font-bold ${cfg.textClass}`}>{cnt}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{cfg.label}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2" data-testid="filter-churn-controls">
            {/* Tier filter buttons */}
            <div className="flex flex-wrap items-center gap-1" data-testid="filter-churn-tier">
              {CHURN_TIER_FILTERS.map(t => (
                <Button
                  key={t}
                  variant={churnTierFilter === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChurnTierFilter(t)}
                  data-testid={`button-churn-filter-${t.toLowerCase()}`}
                >
                  {t === "all" ? "All Tiers" : t}
                </Button>
              ))}
            </div>

            {/* Vertical filter */}
            <Select value={churnVerticalFilter} onValueChange={setChurnVerticalFilter}>
              <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-churn-vertical">
                <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
                <SelectValue placeholder="All Verticals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verticals</SelectItem>
                <SelectItem value="Restaurant">Restaurant</SelectItem>
                <SelectItem value="Retail">Retail</SelectItem>
                <SelectItem value="Healthcare">Healthcare</SelectItem>
                <SelectItem value="E-commerce">E-commerce</SelectItem>
                <SelectItem value="Services">Services</SelectItem>
                <SelectItem value="Hospitality">Hospitality</SelectItem>
                <SelectItem value="Automotive">Automotive</SelectItem>
                <SelectItem value="Professional Services">Professional Services</SelectItem>
                <SelectItem value="Beauty & Wellness">Beauty & Wellness</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>

            {/* Agent filter */}
            <Select value={churnAgentFilter} onValueChange={setChurnAgentFilter}>
              <SelectTrigger className="h-8 w-44 text-sm" data-testid="select-churn-agent">
                <SelectValue placeholder="All Agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {agentsList.map(agent => (
                  <SelectItem
                    key={agent.id}
                    value={`${agent.firstName} ${agent.lastName}`}
                  >
                    {agent.firstName} {agent.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchChurn()}
              className="ml-auto"
              data-testid="button-refresh-churn"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>

          {/* Merchant list */}
          <Card data-testid="card-churn-risk-list">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600" />
                Churn Risk Leaderboard
                <Badge variant="secondary">{filteredChurnScores.length} merchants</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {churnLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredChurnScores.length === 0 ? (
                <div className="text-center py-12" data-testid="text-no-churn-scores">
                  <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground font-medium">
                    {totalScored === 0
                      ? "No churn scores computed yet. Scores are generated nightly."
                      : `No merchants in the ${churnTierFilter} risk tier.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredChurnScores.map((score, idx) => {
                    const effective = score.overrideScore !== null ? score.overrideScore : score.churnScore;
                    const tier = effective > 85 ? "Critical" : effective > 70 ? "High" : effective >= 40 ? "Medium" : "Low";
                    const cfg = TIER_CONFIG[tier];
                    const merchantName = score.contact?.companyName
                      || [score.contact?.firstName, score.contact?.lastName].filter(Boolean).join(" ")
                      || `Contact #${score.contactId}`;

                    return (
                      <div
                        key={score.id}
                        className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border ${cfg.bgClass}`}
                        data-testid={`row-churn-score-${score.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate" data-testid={`text-churn-merchant-${score.id}`}>
                                {merchantName}
                              </span>
                              <Badge variant={cfg.badge} className="text-xs shrink-0" data-testid={`badge-churn-tier-${score.id}`}>
                                {tier}
                              </Badge>
                              {score.overrideScore !== null && (
                                <Badge variant="outline" className="text-xs shrink-0 border-amber-400 text-amber-600">
                                  Override
                                </Badge>
                              )}
                            </div>
                            {score.contact?.vertical && (
                              <span className="text-xs text-muted-foreground">{score.contact.vertical}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right space-y-1">
                            <ChurnScoreBreakdownTooltip score={score} weightsMap={weightsMap} />
                            <p className="text-xs text-muted-foreground">churn score</p>
                          </div>
                          {score.contact?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocation(`/dashboard/contacts/${score.contact!.id}`)}
                              data-testid={`button-view-contact-${score.id}`}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
