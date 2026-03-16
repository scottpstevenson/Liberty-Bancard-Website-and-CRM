import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Target, MessageSquare, Calendar, FileText, Send, AlertTriangle, BarChart3, Mail, Phone, MessageCircle, Bot, ArrowRightLeft, Clock, ShieldCheck, UserCheck, ArrowRight, TrendingUp, Search, MapPin, Building2, Zap, Settings, Play, Square, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

interface SdrSummaryData {
  newToday: number;
  qualifiedToday: number;
  contactedToday: number;
  repliedToday: number;
  meetingsToday: number;
  statementsToday: number;
  proposalsToday: number;
  totalMerchants: number;
  closedWonToday: number;
  humanOwnedCount: number;
}

interface FunnelStageData {
  stage: string;
  count: number;
  conversionRate?: number;
}

interface StuckLeadData {
  type: "overdue" | "compliance_blocked" | "waiting_statement" | "stage_age";
  leadId: number | null;
  merchantId: number;
  businessName: string;
  currentStage: string | null;
  nextActionAt: string | null;
  reason: string;
  stageAgeDays?: number;
  assignedOwnerType?: string;
}

interface ChannelActivityData {
  emailsSent: number;
  smsSent: number;
  callsMade: number;
  emailReplyRate: number;
  smsReplyRate: number;
  optOutRate: number;
  optOuts: number;
  noAnswerRate: number;
  emailDailyLimit: number;
  smsDailyLimit: number;
  callDailyLimit: number;
}

interface ChatAnalyticsData {
  chatsInitiated: number;
  chatMessages: number;
  chatLeadsCaptured: number;
  chatBookings: number;
  chatHandoffs: number;
  handoffRate: number;
}

function SummaryCards() {
  const { data, isLoading } = useQuery<SdrSummaryData>({
    queryKey: ["/api/sdr/dashboard/summary"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards = [
    { label: "New Today", value: data?.newToday || 0, icon: Users, color: "text-blue-600" },
    { label: "Qualified", value: data?.qualifiedToday || 0, icon: Target, color: "text-green-600" },
    { label: "Contacted", value: data?.contactedToday || 0, icon: Send, color: "text-purple-600" },
    { label: "Replied", value: data?.repliedToday || 0, icon: MessageSquare, color: "text-orange-600" },
    { label: "Meetings Set", value: data?.meetingsToday || 0, icon: Calendar, color: "text-indigo-600" },
    { label: "Statements", value: data?.statementsToday || 0, icon: FileText, color: "text-teal-600" },
    { label: "Proposals", value: data?.proposalsToday || 0, icon: FileText, color: "text-emerald-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} data-testid={`card-sdr-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${card.color}`} />
                  <span className="text-xs text-muted-foreground">{card.label}</span>
                </div>
                <div className="text-2xl font-bold" data-testid={`value-sdr-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {card.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card data-testid="card-sdr-total-merchants">
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Total Merchants</div>
              <div className="text-xl font-bold">{data?.totalMerchants || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-sdr-closed-won">
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <div>
              <div className="text-sm text-muted-foreground">Closed Won Today</div>
              <div className="text-xl font-bold">{data?.closedWonToday || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-sdr-human-owned">
          <CardContent className="p-4 flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-sm text-muted-foreground">Human-Owned Leads</div>
              <div className="text-xl font-bold">{data?.humanOwnedCount || 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FunnelVisualization() {
  const { data, isLoading } = useQuery<FunnelStageData[]>({
    queryKey: ["/api/sdr/dashboard/funnel"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stages = data || [];
  const maxCount = Math.max(...stages.map(s => s.count), 1);

  return (
    <Card data-testid="card-sdr-funnel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Pipeline Funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No leads in pipeline yet. Funnel data will appear here as leads progress through stages.
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((stage, idx) => (
              <div key={stage.stage} className="flex items-center gap-3" data-testid={`funnel-stage-${stage.stage}`}>
                <div className="w-44 text-sm truncate text-muted-foreground">{stage.stage}</div>
                <div className="flex-1 bg-muted rounded-full h-7 relative overflow-hidden">
                  <div
                    className="bg-primary/80 h-full rounded-full transition-all"
                    style={{ width: `${Math.max((stage.count / maxCount) * 100, 2)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                    {stage.count}
                  </span>
                </div>
                <div className="w-16 text-right">
                  {stage.conversionRate !== undefined && stage.conversionRate !== null ? (
                    <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
                      <ArrowRight className="w-3 h-3" />
                      <span>{stage.conversionRate}%</span>
                    </div>
                  ) : idx === 0 ? (
                    <span className="text-xs text-muted-foreground">100%</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StuckLeads() {
  const { data, isLoading } = useQuery<StuckLeadData[]>({
    queryKey: ["/api/sdr/dashboard/stuck-leads"],
  });

  const handoffMutation = useMutation({
    mutationFn: async (leadId: number) => {
      return apiRequest("POST", `/api/sdr/leads/${leadId}/handoff`, { assignedUserId: "manual_review", note: "Escalated from stuck leads view" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/dashboard/stuck-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/dashboard/summary"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const leads = data || [];

  const typeLabels: Record<string, string> = {
    overdue: "Overdue",
    compliance_blocked: "Blocked",
    waiting_statement: "Waiting Statement",
    stage_age: "Stale",
  };

  const typeVariants: Record<string, "destructive" | "secondary" | "outline"> = {
    compliance_blocked: "destructive",
    overdue: "secondary",
    waiting_statement: "outline",
    stage_age: "secondary",
  };

  return (
    <Card data-testid="card-sdr-stuck-leads">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600" />
          Stuck Leads ({leads.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No stuck leads. All leads are progressing normally.
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((lead, idx) => (
              <div key={`${lead.merchantId}-${idx}`} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`stuck-lead-${lead.merchantId}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{lead.businessName}</div>
                  <div className="text-xs text-muted-foreground">{lead.reason}</div>
                  {lead.stageAgeDays !== undefined && lead.stageAgeDays > 0 && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {lead.stageAgeDays}d in stage
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  {lead.currentStage && (
                    <Badge variant="outline" className="text-xs">{lead.currentStage}</Badge>
                  )}
                  <Badge variant={typeVariants[lead.type] || "secondary"} className="text-xs">
                    {typeLabels[lead.type] || lead.type}
                  </Badge>
                  {lead.assignedOwnerType !== "human" && lead.type !== "compliance_blocked" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => lead.leadId && handoffMutation.mutate(lead.leadId)}
                      disabled={handoffMutation.isPending}
                      data-testid={`btn-handoff-${lead.merchantId}`}
                    >
                      <UserCheck className="w-3 h-3 mr-1" />
                      Claim
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelHealth() {
  const { data, isLoading } = useQuery<ChannelActivityData>({
    queryKey: ["/api/sdr/dashboard/activity"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const channels = [
    {
      label: "Emails Sent",
      value: data?.emailsSent || 0,
      icon: Mail,
      replyRate: data?.emailReplyRate || 0,
      limit: data?.emailDailyLimit || 200,
      usage: data?.emailsSent ? Math.round(((data?.emailsSent || 0) / (data?.emailDailyLimit || 200)) * 100) : 0,
    },
    {
      label: "SMS Sent",
      value: data?.smsSent || 0,
      icon: MessageCircle,
      replyRate: data?.smsReplyRate || 0,
      limit: data?.smsDailyLimit || 100,
      usage: data?.smsSent ? Math.round(((data?.smsSent || 0) / (data?.smsDailyLimit || 100)) * 100) : 0,
    },
    {
      label: "Calls Made",
      value: data?.callsMade || 0,
      icon: Phone,
      replyRate: null as number | null,
      limit: data?.callDailyLimit || 50,
      usage: data?.callsMade ? Math.round(((data?.callsMade || 0) / (data?.callDailyLimit || 50)) * 100) : 0,
      noAnswerRate: data?.noAnswerRate || 0,
    },
  ];

  return (
    <Card data-testid="card-sdr-channel-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="w-5 h-5" />
          Channel Health (Today)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {channels.map((ch) => {
            const Icon = ch.icon;
            return (
              <div key={ch.label} className="p-4 bg-muted/50 rounded-lg" data-testid={`channel-${ch.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{ch.label}</span>
                </div>
                <div className="text-2xl font-bold">{ch.value}</div>
                <div className="mt-2 space-y-1">
                  {ch.replyRate !== null && (
                    <div className="text-xs text-muted-foreground">
                      Reply rate: <span className="font-medium">{ch.replyRate}%</span>
                    </div>
                  )}
                  {"noAnswerRate" in ch && ch.noAnswerRate !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      No-answer rate: <span className="font-medium">{ch.noAnswerRate}%</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Daily limit: <span className="font-medium">{ch.value}/{ch.limit}</span> ({ch.usage}%)
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className={`h-full rounded-full transition-all ${ch.usage > 80 ? "bg-red-500" : ch.usage > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(ch.usage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Opt-outs today:</span>
            <span className="font-medium">{data?.optOuts || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Opt-out rate:</span>
            <span className="font-medium">{data?.optOutRate || 0}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChatAnalytics() {
  const { data, isLoading } = useQuery<ChatAnalyticsData>({
    queryKey: ["/api/sdr/dashboard/chat-analytics"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const metrics = [
    { label: "Chats Initiated", value: data?.chatsInitiated || 0, icon: MessageSquare, color: "text-blue-600" },
    { label: "Messages", value: data?.chatMessages || 0, icon: MessageCircle, color: "text-purple-600" },
    { label: "Leads Captured", value: data?.chatLeadsCaptured || 0, icon: UserCheck, color: "text-green-600" },
    { label: "Bookings", value: data?.chatBookings || 0, icon: Calendar, color: "text-indigo-600" },
    { label: "Handoffs", value: data?.chatHandoffs || 0, icon: ArrowRightLeft, color: "text-orange-600" },
  ];

  return (
    <Card data-testid="card-sdr-chat-analytics">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          Chat Widget Analytics (Today)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="p-4 bg-muted/50 rounded-lg" data-testid={`chat-metric-${metric.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${metric.color}`} />
                  <span className="text-sm font-medium">{metric.label}</span>
                </div>
                <div className="text-2xl font-bold">{metric.value}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Handoff rate:</span>
            <span className="font-medium" data-testid="text-chat-handoff-rate">{data?.handoffRate || 0}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Conversion:</span>
            <span className="font-medium" data-testid="text-chat-conversion">
              {(data?.chatsInitiated || 0) > 0
                ? Math.round(((data?.chatLeadsCaptured || 0) / (data?.chatsInitiated || 1)) * 100)
                : 0}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface DiscoveryStatsData {
  today: {
    rawFound: number;
    newInserted: number;
    duplicatesSkipped: number;
    enrichmentQueued: number;
    jobCount: number;
    dedupRate: number;
  };
  week: {
    rawFound: number;
    newInserted: number;
    duplicatesSkipped: number;
    enrichmentQueued: number;
    jobCount: number;
  };
  byVertical: { vertical: string; count: number; newCount: number }[];
  byMetro: { metro: string; count: number; newCount: number }[];
  bySource: { source: string; count: number; newCount: number }[];
}

interface DiscoveryStatusData {
  discoveryRunning: boolean;
  nightlySchedulerActive: boolean;
}

interface SearchMatrixConfig {
  verticals: string[];
  metros: string[];
  dataSources: string[];
  state: string;
  limitPerSearch: number;
  enabled: boolean;
  schedule: string;
  dailyBudgetCap: number;
}

interface SourceStatusData {
  serper: { configured: boolean; usage: any };
  outscraper: { configured: boolean; usage: any };
  apify: { configured: boolean; usage: any };
}

interface DiscoveryJob {
  id: number;
  status: string;
  triggerType: string;
  rawFound: number;
  newInserted: number;
  duplicatesSkipped: number;
  errorsCount: number;
  enrichmentQueued: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  searchVerticals: string[] | null;
  searchMetros: string[] | null;
}

function DiscoveryDashboard() {
  const [showConfig, setShowConfig] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<DiscoveryStatsData>({
    queryKey: ["/api/sdr/discovery/stats"],
  });

  const { data: status } = useQuery<DiscoveryStatusData>({
    queryKey: ["/api/sdr/discovery/status"],
    refetchInterval: 5000,
  });

  const { data: config } = useQuery<SearchMatrixConfig>({
    queryKey: ["/api/sdr/discovery/config"],
  });

  const { data: sourceStatus } = useQuery<SourceStatusData>({
    queryKey: ["/api/sdr/discovery/source-status"],
  });

  const { data: jobs } = useQuery<DiscoveryJob[]>({
    queryKey: ["/api/sdr/discovery/jobs"],
  });

  const runDiscoveryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sdr/discovery/run", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/jobs"] });
    },
  });

  const toggleNightlyMutation = useMutation({
    mutationFn: async (start: boolean) => {
      return apiRequest("POST", `/api/sdr/discovery/nightly/${start ? "start" : "stop"}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/status"] });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<SearchMatrixConfig>) => {
      return apiRequest("PUT", "/api/sdr/discovery/config", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/config"] });
    },
  });

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const todayStats = stats?.today || { rawFound: 0, newInserted: 0, duplicatesSkipped: 0, enrichmentQueued: 0, jobCount: 0, dedupRate: 0 };
  const weekStats = stats?.week || { rawFound: 0, newInserted: 0, duplicatesSkipped: 0, enrichmentQueued: 0, jobCount: 0 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status?.discoveryRunning && (
            <Badge variant="secondary" className="animate-pulse" data-testid="badge-discovery-running">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Discovery Running
            </Badge>
          )}
          {status?.nightlySchedulerActive && (
            <Badge variant="outline" data-testid="badge-nightly-active">
              <Clock className="w-3 h-3 mr-1" />
              Nightly Active (2 AM EST)
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
            data-testid="btn-toggle-config"
          >
            <Settings className="w-4 h-4 mr-1" />
            Config
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleNightlyMutation.mutate(!status?.nightlySchedulerActive)}
            disabled={toggleNightlyMutation.isPending}
            data-testid="btn-toggle-nightly"
          >
            {status?.nightlySchedulerActive ? (
              <><Square className="w-4 h-4 mr-1" />Stop Nightly</>
            ) : (
              <><Clock className="w-4 h-4 mr-1" />Start Nightly</>
            )}
          </Button>
          <Button
            size="sm"
            onClick={() => runDiscoveryMutation.mutate()}
            disabled={runDiscoveryMutation.isPending || status?.discoveryRunning}
            data-testid="btn-run-discovery"
          >
            {runDiscoveryMutation.isPending || status?.discoveryRunning ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Running...</>
            ) : (
              <><Play className="w-4 h-4 mr-1" />Run Discovery</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card data-testid="card-discovery-raw">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Found Today</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-raw">{todayStats.rawFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-new">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-green-600" />
              <span className="text-xs text-muted-foreground">New Inserted</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-new">{todayStats.newInserted}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-dupes">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-orange-600" />
              <span className="text-xs text-muted-foreground">Duplicates</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-dupes">{todayStats.duplicatesSkipped}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-dedup-rate">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">Dedup Rate</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-dedup-rate">{todayStats.dedupRate}%</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-enrichment">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-muted-foreground">Enrichment Queue</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-enrichment">{todayStats.enrichmentQueued}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-week">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-muted-foreground">This Week</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-week">{weekStats.newInserted}</div>
          </CardContent>
        </Card>
      </div>

      {showConfig && config && (
        <Card data-testid="card-discovery-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Search Matrix Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium mb-2">Target Verticals</h4>
                <div className="flex flex-wrap gap-1.5">
                  {config.verticals.map((v) => (
                    <Badge key={v} variant="secondary" className="text-xs" data-testid={`badge-vertical-${v}`}>
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Target Metros</h4>
                <div className="flex flex-wrap gap-1.5">
                  {config.metros.map((m) => (
                    <Badge key={m} variant="secondary" className="text-xs" data-testid={`badge-metro-${m}`}>
                      <MapPin className="w-3 h-3 mr-0.5" />
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Data Sources</h4>
                <div className="flex flex-wrap gap-1.5">
                  {config.dataSources.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs" data-testid={`badge-source-${s}`}>
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Limit per search:</span>
                  <span className="font-medium">{config.limitPerSearch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Schedule:</span>
                  <span className="font-medium">{config.schedule}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Daily budget cap:</span>
                  <span className="font-medium">${config.dailyBudgetCap}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">State:</span>
                  <span className="font-medium">{config.state}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-discovery-by-vertical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              By Vertical (Today)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.byVertical || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No data yet</div>
            ) : (
              <div className="space-y-2">
                {(stats?.byVertical || []).map((v) => (
                  <div key={v.vertical} className="flex items-center justify-between text-sm" data-testid={`row-vertical-${v.vertical}`}>
                    <span className="text-muted-foreground">{v.vertical}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{v.newCount} new</span>
                      <span className="text-xs text-muted-foreground">/ {v.count} found</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-discovery-by-metro">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              By Metro (Today)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.byMetro || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No data yet</div>
            ) : (
              <div className="space-y-2">
                {(stats?.byMetro || []).map((m) => (
                  <div key={m.metro} className="flex items-center justify-between text-sm" data-testid={`row-metro-${m.metro}`}>
                    <span className="text-muted-foreground">{m.metro}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.newCount} new</span>
                      <span className="text-xs text-muted-foreground">/ {m.count} found</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-discovery-sources">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Data Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {["serper", "outscraper", "apify"].map((src) => {
                const srcData = sourceStatus?.[src as keyof SourceStatusData] as { configured: boolean; usage: any } | undefined;
                return (
                  <div key={src} className="flex items-center justify-between text-sm" data-testid={`row-source-${src}`}>
                    <div className="flex items-center gap-2">
                      {srcData?.configured ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="capitalize">{src}</span>
                    </div>
                    <Badge variant={srcData?.configured ? "secondary" : "outline"} className="text-xs">
                      {srcData?.configured ? "Active" : "Not configured"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-discovery-jobs">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Job History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!jobs || jobs.length === 0) ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No discovery jobs yet. Click "Run Discovery" to start finding leads.
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 10).map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`job-${job.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Job #{job.id}</span>
                      <Badge variant={
                        job.status === "completed" ? "secondary" :
                        job.status === "running" ? "outline" :
                        job.status === "failed" ? "destructive" : "secondary"
                      } className="text-xs" data-testid={`badge-job-status-${job.id}`}>
                        {job.status === "running" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        {job.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{job.triggerType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="font-medium">{job.rawFound || 0}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-green-600">{job.newInserted || 0}</div>
                      <div className="text-xs text-muted-foreground">New</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-orange-600">{job.duplicatesSkipped || 0}</div>
                      <div className="text-xs text-muted-foreground">Dupes</div>
                    </div>
                    {(job.errorsCount || 0) > 0 && (
                      <div className="text-center">
                        <div className="font-medium text-red-600">{job.errorsCount}</div>
                        <div className="text-xs text-muted-foreground">Errors</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SdrDashboard() {
  return (
    <div className="space-y-6" data-testid="page-sdr-dashboard">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-sdr-title">AI SDR Dashboard</h2>
        <p className="text-muted-foreground">Autonomous lead development pipeline overview</p>
      </div>

      <Tabs defaultValue="summary" data-testid="tabs-sdr">
        <TabsList>
          <TabsTrigger value="summary" data-testid="tab-sdr-summary">Summary</TabsTrigger>
          <TabsTrigger value="discovery" data-testid="tab-sdr-discovery">Discovery</TabsTrigger>
          <TabsTrigger value="funnel" data-testid="tab-sdr-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-sdr-stuck">Stuck Leads</TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-sdr-channels">Channel Health</TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-sdr-chat">Chat AI</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryCards />
        </TabsContent>

        <TabsContent value="discovery" className="mt-4">
          <DiscoveryDashboard />
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <FunnelVisualization />
        </TabsContent>

        <TabsContent value="stuck" className="mt-4">
          <StuckLeads />
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <ChannelHealth />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}
