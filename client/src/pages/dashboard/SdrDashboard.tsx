import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Target, MessageSquare, Calendar, FileText, Send, AlertTriangle, BarChart3, Mail, Phone, MessageCircle, Bot, ArrowRightLeft, Clock, ShieldCheck, UserCheck, ArrowRight, TrendingUp, Search, MapPin, Building2, Zap, Settings, Play, Square, CheckCircle2, XCircle, RefreshCw, Cpu, Megaphone, PieChart, Mic, Bell, Globe, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  const { data, isLoading, isError, refetch } = useQuery<StuckLeadData[]>({
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
    onError: (err: any) => {
      console.error("Handoff failed:", err);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-sdr-stuck-leads-error">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-destructive" />
          <div className="font-medium text-destructive">Failed to load stuck leads</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()} data-testid="button-retry-stuck-leads">Retry</Button>
        </CardContent>
      </Card>
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

interface ProcessorDistItem {
  vendor: string;
  count: number;
}

interface AdDistItem {
  platform: string;
  running: number;
  notRunning: number;
}

interface ConversionByProcessorItem {
  vendor: string;
  total: number;
  converted: number;
  conversionRate: number;
}

interface ProcessorIntelData {
  processorDistribution: ProcessorDistItem[];
  coverage: { total: number; detected: number; coverageRate: number };
  adDistribution: AdDistItem[];
  conversionByProcessor: ConversionByProcessorItem[];
}

function DiscoveryDashboard() {
  const { toast } = useToast();
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
    onError: (err: any) => {
      toast({ title: "Discovery run failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleNightlyMutation = useMutation({
    mutationFn: async (start: boolean) => {
      return apiRequest("POST", `/api/sdr/discovery/nightly/${start ? "start" : "stop"}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Toggle failed", description: err.message, variant: "destructive" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<SearchMatrixConfig>) => {
      return apiRequest("PUT", "/api/sdr/discovery/config", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/config"] });
    },
    onError: (err: any) => {
      toast({ title: "Config update failed", description: err.message, variant: "destructive" });
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

function ProcessorIntelligence() {
  const { data, isLoading } = useQuery<ProcessorIntelData>({
    queryKey: ["/api/sdr/processor-intelligence"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const coverage = data?.coverage || { total: 0, detected: 0, coverageRate: 0 };
  const processors = data?.processorDistribution || [];
  const adDist = data?.adDistribution || [];
  const totalProcessorDetections = processors.reduce((sum, p) => sum + p.count, 0);

  const VENDOR_COLORS: Record<string, string> = {
    Square: "bg-blue-500",
    Stripe: "bg-purple-500",
    Toast: "bg-orange-500",
    Clover: "bg-green-500",
    Shopify: "bg-emerald-500",
    PayPal: "bg-yellow-500",
    Mindbody: "bg-pink-500",
    Vagaro: "bg-indigo-500",
    Boulevard: "bg-teal-500",
    NCR: "bg-gray-500",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card data-testid="card-processor-coverage">
          <CardContent className="p-4 flex items-center gap-3">
            <PieChart className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-sm text-muted-foreground">Detection Coverage</div>
              <div className="text-xl font-bold" data-testid="value-processor-coverage">{coverage.coverageRate}%</div>
              <div className="text-xs text-muted-foreground">{coverage.detected} of {coverage.total} businesses</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-processor-detections">
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="w-5 h-5 text-purple-600" />
            <div>
              <div className="text-sm text-muted-foreground">Total Detections</div>
              <div className="text-xl font-bold" data-testid="value-processor-detections">{totalProcessorDetections}</div>
              <div className="text-xs text-muted-foreground">{processors.length} unique processors</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-ad-signals">
          <CardContent className="p-4 flex items-center gap-3">
            <Megaphone className="w-5 h-5 text-orange-600" />
            <div>
              <div className="text-sm text-muted-foreground">Running Ads</div>
              <div className="text-xl font-bold" data-testid="value-ads-running">{adDist.reduce((sum, a) => sum + a.running, 0)}</div>
              <div className="text-xs text-muted-foreground">{adDist.length} platforms tracked</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-processor-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Processor Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {processors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No processors detected yet. Run detection on businesses to populate this view.</p>
            ) : (
              <div className="space-y-3">
                {processors.map((p) => {
                  const pct = totalProcessorDetections > 0 ? Math.round((p.count / totalProcessorDetections) * 100) : 0;
                  return (
                    <div key={p.vendor} data-testid={`processor-row-${p.vendor.toLowerCase()}`}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{p.vendor}</span>
                        <span className="text-muted-foreground">{p.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${VENDOR_COLORS[p.vendor] || "bg-gray-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ad-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              Ad Platform Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {adDist.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No ad signals detected yet.</p>
            ) : (
              <div className="space-y-3">
                {adDist.map((a) => (
                  <div key={a.platform} className="p-3 bg-muted/50 rounded-lg" data-testid={`ad-row-${a.platform}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-medium capitalize">{a.platform}</span>
                      <div className="flex gap-2">
                        <Badge variant="default" data-testid={`badge-ads-running-${a.platform}`}>{a.running} running</Badge>
                        <Badge variant="outline">{a.notRunning} inactive</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(data?.conversionByProcessor || []).length > 0 && (
        <Card data-testid="card-conversion-by-processor">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Conversion Rate by Processor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.conversionByProcessor || []).map((c) => (
                <div key={c.vendor} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`conversion-row-${c.vendor.toLowerCase()}`}>
                  <div>
                    <span className="font-medium">{c.vendor}</span>
                    <span className="text-sm text-muted-foreground ml-2">({c.total} leads)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{c.converted} converted</span>
                    <Badge variant={c.conversionRate >= 20 ? "default" : "outline"} data-testid={`badge-conversion-${c.vendor.toLowerCase()}`}>
                      {c.conversionRate}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-switchable-targets">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Top Switchable Targets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {processors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No data available yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {processors.filter(p => ["Square", "Stripe", "Toast", "Clover", "PayPal", "Shopify"].includes(p.vendor)).map((p) => (
                <div key={p.vendor} className="p-3 bg-muted/50 rounded-lg text-center" data-testid={`switchable-target-${p.vendor.toLowerCase()}`}>
                  <div className="text-lg font-bold">{p.count}</div>
                  <div className="text-sm text-muted-foreground">{p.vendor}</div>
                  <Badge variant="outline" className="mt-1 text-xs">Switchable</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface SourceQualityData {
  sourceType: string;
  totalLeads: number;
  enrichmentRate: number;
  hotRate: number;
  replyRate: number;
  meetingRate: number;
  statementRate: number;
  closeRate: number;
}

function SourceQualityDashboard() {
  const { data, isLoading } = useQuery<SourceQualityData[]>({
    queryKey: ["/api/sdr/source-quality"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sources = data || [];

  return (
    <Card data-testid="card-source-quality">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Source Quality (Last 30 Days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No source quality data available yet. Aggregate funnel metrics to populate this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-source-quality">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Source</th>
                  <th className="text-right py-2 px-3 font-medium">Leads</th>
                  <th className="text-right py-2 px-3 font-medium">Enrich%</th>
                  <th className="text-right py-2 px-3 font-medium">Reply%</th>
                  <th className="text-right py-2 px-3 font-medium">Meeting%</th>
                  <th className="text-right py-2 px-3 font-medium">Statement%</th>
                  <th className="text-right py-2 px-3 font-medium">Close%</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => (
                  <tr key={src.sourceType} className="border-b border-muted" data-testid={`row-source-${src.sourceType}`}>
                    <td className="py-2 px-3 font-medium">{src.sourceType}</td>
                    <td className="text-right py-2 px-3">{src.totalLeads}</td>
                    <td className="text-right py-2 px-3">{src.enrichmentRate}%</td>
                    <td className="text-right py-2 px-3">{src.replyRate}%</td>
                    <td className="text-right py-2 px-3">{src.meetingRate}%</td>
                    <td className="text-right py-2 px-3">{src.statementRate}%</td>
                    <td className="text-right py-2 px-3">
                      <span className={src.closeRate > 5 ? "text-green-600 font-medium" : ""}>{src.closeRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface IdentityHealthData {
  id: number;
  label: string;
  domain: string;
  emailAddress: string;
  isActive: boolean;
  warmupStatus: string;
  dailyLimit: number;
  sentToday: number;
  healthScore: number;
  bounceRate: number;
  replyRate: number;
  complaintRate: number;
  openRate: number;
  weekSent: number;
  alert: string | null;
}

function IdentityHealthDashboard() {
  const { data, isLoading } = useQuery<IdentityHealthData[]>({
    queryKey: ["/api/sdr/identity-health"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const identities = data || [];

  return (
    <Card data-testid="card-identity-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Inbox Deliverability Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {identities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No sending identities configured yet. Set up inboxes in the inbox rotation settings.
          </div>
        ) : (
          <div className="space-y-3">
            {identities.map((identity) => (
              <div key={identity.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg" data-testid={`identity-${identity.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{identity.label}</span>
                    <Badge variant={identity.isActive ? "secondary" : "outline"} className="text-xs">
                      {identity.warmupStatus}
                    </Badge>
                    {identity.alert && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {identity.alert}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{identity.emailAddress} ({identity.domain})</div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className={`font-medium ${identity.healthScore >= 80 ? "text-green-600" : identity.healthScore >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                      {identity.healthScore}%
                    </div>
                    <div className="text-xs text-muted-foreground">Health</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{identity.sentToday}/{identity.dailyLimit}</div>
                    <div className="text-xs text-muted-foreground">Today</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{identity.bounceRate}%</div>
                    <div className="text-xs text-muted-foreground">Bounce</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{identity.replyRate}%</div>
                    <div className="text-xs text-muted-foreground">Reply</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{identity.openRate}%</div>
                    <div className="text-xs text-muted-foreground">Open</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MarketExpansionData {
  byState: {
    state: string;
    total: number;
    contacted: number;
    engaged: number;
    closedWon: number;
    contactRate: number;
    engagementRate: number;
    addressable: number;
    penetration: number;
  }[];
  byMetro: {
    city: string;
    state: string;
    total: number;
    contacted: number;
    engaged: number;
  }[];
  expansionSuggestions: {
    currentState: string;
    utilization: number;
    suggestedState: string;
    reason: string;
    estimatedAddressable: number;
  }[];
}

function MarketExpansionDashboard() {
  const { data, isLoading } = useQuery<MarketExpansionData>({
    queryKey: ["/api/sdr/market-expansion"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-market-expansion">
      {(data?.expansionSuggestions || []).length > 0 && (
        <Card data-testid="card-expansion-suggestions">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Expansion Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.expansionSuggestions.map((sug, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg" data-testid={`suggestion-${idx}`}>
                  <MapPin className="w-5 h-5 text-green-600 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{sug.reason}</div>
                    <div className="text-xs text-muted-foreground">
                      Estimated addressable market: {sug.estimatedAddressable.toLocaleString()} businesses
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-state-penetration">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="w-4 h-4" />
              Market Penetration by State
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byState || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No state data yet</div>
            ) : (
              <div className="space-y-2">
                {(data?.byState || []).map((st) => (
                  <div key={st.state} className="space-y-1" data-testid={`state-${st.state}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{st.state}</span>
                      <span className="text-muted-foreground">{st.total} / {st.addressable.toLocaleString()} ({st.penetration}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-full rounded-full transition-all ${st.penetration >= 80 ? "bg-orange-500" : st.penetration >= 50 ? "bg-yellow-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.min(st.penetration, 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Contacted: {st.contactRate}%</span>
                      <span>Engaged: {st.engagementRate}%</span>
                      <span>Won: {st.closedWon}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-metro-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="w-4 h-4" />
              Top Metros
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byMetro || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No metro data yet</div>
            ) : (
              <div className="space-y-2">
                {(data?.byMetro || []).slice(0, 15).map((m, idx) => (
                  <div key={`${m.city}-${m.state}`} className="flex items-center justify-between text-sm" data-testid={`metro-${idx}`}>
                    <span className="text-muted-foreground">{m.city}, {m.state}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{m.total}</span>
                      <span className="text-xs text-muted-foreground">{m.contacted} contacted</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface WeeklyKpiData {
  period: { start: string; end: string };
  topFunnel: { leadsFound: number; leadsEnriched: number; enrichmentRate: number; hotCreated: number; warmCreated: number };
  outreach: { emailsSent: number; smsSent: number; callsMade: number; replies: number; replyRate: number; meetingsBooked: number };
  midFunnel: { statementsReceived: number; proposalsSent: number };
  bottomFunnel: { closedWon: number; closedLost: number; winRate: number };
  verticalPerformance: { vertical: string; leads: number; replies: number; meetings: number; closedWon: number }[];
  sourceQuality: SourceQualityData[];
  identityHealth: { label: string; domain: string; healthScore: number; alert: string | null }[];
  expansionSuggestions: { reason: string }[];
}

function WeeklyKpiReport() {
  const { data, isLoading } = useQuery<WeeklyKpiData>({
    queryKey: ["/api/sdr/weekly-kpi"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const sections = [
    { title: "Top of Funnel", items: [
      { label: "Leads Found", value: data.topFunnel.leadsFound },
      { label: "Enriched", value: `${data.topFunnel.leadsEnriched} (${data.topFunnel.enrichmentRate}%)` },
      { label: "Hot Leads", value: data.topFunnel.hotCreated },
      { label: "Warm Leads", value: data.topFunnel.warmCreated },
    ]},
    { title: "Outreach", items: [
      { label: "Emails Sent", value: data.outreach.emailsSent },
      { label: "SMS Sent", value: data.outreach.smsSent },
      { label: "Calls Made", value: data.outreach.callsMade },
      { label: "Replies", value: `${data.outreach.replies} (${data.outreach.replyRate}%)` },
      { label: "Meetings Booked", value: data.outreach.meetingsBooked },
    ]},
    { title: "Mid Funnel", items: [
      { label: "Statements Received", value: data.midFunnel.statementsReceived },
      { label: "Proposals Sent", value: data.midFunnel.proposalsSent },
    ]},
    { title: "Bottom Funnel", items: [
      { label: "Closed Won", value: data.bottomFunnel.closedWon },
      { label: "Closed Lost", value: data.bottomFunnel.closedLost },
      { label: "Win Rate", value: `${data.bottomFunnel.winRate}%` },
    ]},
  ];

  return (
    <div className="space-y-4" data-testid="section-weekly-kpi">
      <div className="text-sm text-muted-foreground" data-testid="text-kpi-period">
        Week of {data.period.start} to {data.period.end}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {sections.map((section) => (
          <Card key={section.title} data-testid={`card-kpi-${section.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.verticalPerformance.length > 0 && (
        <Card data-testid="card-kpi-verticals">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Vertical Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Vertical</th>
                    <th className="text-right py-2 px-3 font-medium">Leads</th>
                    <th className="text-right py-2 px-3 font-medium">Replies</th>
                    <th className="text-right py-2 px-3 font-medium">Meetings</th>
                    <th className="text-right py-2 px-3 font-medium">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verticalPerformance.map((v) => (
                    <tr key={v.vertical} className="border-b border-muted" data-testid={`kpi-vertical-${v.vertical}`}>
                      <td className="py-2 px-3">{v.vertical}</td>
                      <td className="text-right py-2 px-3">{v.leads}</td>
                      <td className="text-right py-2 px-3">{v.replies}</td>
                      <td className="text-right py-2 px-3">{v.meetings}</td>
                      <td className="text-right py-2 px-3 font-medium">{v.closedWon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AnomalyAlertsPanel() {
  const { data, isLoading } = useQuery<{
    alerts: Array<{
      id: string;
      type: string;
      severity: "warning" | "critical";
      title: string;
      description: string;
      metric: string;
      currentValue: number;
      expectedValue: number;
      threshold: number;
      detectedAt: string;
      identityId?: number;
      identityLabel?: string;
    }>;
    criticalCount: number;
    warningCount: number;
    lastChecked: string;
  }>({
    queryKey: ["/api/sdr/anomaly-alerts"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const alerts = data?.alerts || [];
  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const warningAlerts = alerts.filter(a => a.severity === "warning");

  return (
    <div className="space-y-4" data-testid="panel-anomaly-alerts">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-total-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Alerts</span>
            </div>
            <div className="text-2xl font-bold">{alerts.length}</div>
          </CardContent>
        </Card>
        <Card className={criticalAlerts.length > 0 ? "border-red-300 dark:border-red-800" : ""} data-testid="card-critical-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Critical</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{criticalAlerts.length}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-warning-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Warnings</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">{warningAlerts.length}</div>
          </CardContent>
        </Card>
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-alerts">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            No anomalies detected. All systems operating normally.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <Card
              key={idx}
              className={alert.severity === "critical"
                ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950"
                : "border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950"}
              data-testid={`alert-item-${idx}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 mt-0.5 ${alert.severity === "critical" ? "text-red-600" : "text-yellow-600"}`} />
                    <div>
                      <div className="font-medium text-sm">{alert.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{alert.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {alert.metric}: {alert.currentValue.toFixed(1)} (expected: {alert.expectedValue.toFixed(1)}, threshold: {alert.threshold.toFixed(1)})
                      </div>
                    </div>
                  </div>
                  <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} data-testid={`badge-severity-${idx}`}>
                    {alert.severity}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data?.lastChecked && (
        <div className="text-xs text-muted-foreground text-right" data-testid="text-last-checked">
          Last checked: {new Date(data.lastChecked).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function SmsMetricsPanel() {
  const { data, isLoading } = useQuery<{
    smsEnabled: boolean;
    today: { total: number; sent: number; failed: number; replied: number; replyRate: number };
  }>({
    queryKey: ["/api/sdr/sms-metrics"],
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  if (!data?.smsEnabled) {
    return (
      <Card data-testid="card-sms-disabled">
        <CardContent className="p-6 text-center">
          <Smartphone className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <div className="font-medium text-muted-foreground">SMS Channel Disabled</div>
          <div className="text-xs text-muted-foreground mt-1">Set SMS_ENABLED=true to activate SMS outreach</div>
        </CardContent>
      </Card>
    );
  }

  const stats = data.today;
  return (
    <div className="space-y-4" data-testid="panel-sms-metrics">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card data-testid="card-sms-total">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Attempts</div>
            <div className="text-xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-sent">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Sent</div>
            <div className="text-xl font-bold text-green-600">{stats.sent}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-failed">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Failed</div>
            <div className="text-xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-replied">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Replied</div>
            <div className="text-xl font-bold text-blue-600">{stats.replied}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-reply-rate">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Reply Rate</div>
            <div className="text-xl font-bold">{stats.replyRate}%</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function VoiceAiStatusPanel() {
  const { data, isLoading } = useQuery<{
    voiceAiEnabled: boolean;
    configuredScripts: Array<{
      verticalKey: string;
      verticalLabel: string;
      hasOpening: boolean;
      hasQualifyingQuestions: boolean;
      hasObjectionHandlers: boolean;
      hasComplianceDisclosure: boolean;
    }>;
    totalScripts: number;
    readyForActivation: boolean;
  }>({
    queryKey: ["/api/sdr/voice-ai/status"],
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4" data-testid="panel-voice-ai">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-voice-status">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Voice AI</span>
            </div>
            <Badge className={data?.voiceAiEnabled
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.voiceAiEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-voice-scripts">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Configured Scripts</div>
            <div className="text-xl font-bold">{data?.totalScripts || 0}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-voice-ready">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Ready for Activation</div>
            <Badge className={data?.readyForActivation
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
            }>
              {data?.readyForActivation ? "Ready" : "Not Ready"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {data?.configuredScripts && data.configuredScripts.length > 0 && (
        <Card data-testid="card-voice-script-list">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Script Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.configuredScripts.map((script) => (
                <div key={script.verticalKey} className="flex items-center justify-between p-2 rounded border" data-testid={`voice-script-${script.verticalKey}`}>
                  <span className="text-sm font-medium">{script.verticalLabel}</span>
                  <div className="flex items-center gap-2">
                    {script.hasOpening && <Badge variant="outline" className="text-xs">Opening</Badge>}
                    {script.hasQualifyingQuestions && <Badge variant="outline" className="text-xs">Questions</Badge>}
                    {script.hasObjectionHandlers && <Badge variant="outline" className="text-xs">Objections</Badge>}
                    {script.hasComplianceDisclosure && <Badge variant="outline" className="text-xs">Compliance</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!data?.voiceAiEnabled && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-voice-disabled">
            <Mic className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="font-medium">Voice AI is not enabled</div>
            <div className="text-xs mt-1">Set VOICE_AI_ENABLED=true to activate voice calling</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SerperEnrichmentPanel() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{
    serperConfigured: boolean;
    totalEnriched: number;
    last7Days: { totalProcessed: number; websitesFound: number; phonesFound: number; emailsFound: number; errors: number };
  }>({
    queryKey: ["/api/sdr/serper-enrichment/metrics"],
  });

  const runBatchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sdr/serper-enrichment/run", { limit: 50 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/serper-enrichment/metrics"] });
      toast({ title: "Enrichment batch completed" });
    },
    onError: (err: any) => {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  if (!data?.serperConfigured) {
    return (
      <Card data-testid="card-serper-disabled">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <div className="font-medium">Serper Enrichment Not Configured</div>
          <div className="text-xs mt-1">Set SERPER_API_KEY to enable business data enrichment</div>
        </CardContent>
      </Card>
    );
  }

  const last7 = data.last7Days;
  return (
    <div className="space-y-4" data-testid="panel-serper-enrichment">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Serper Business Enrichment</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runBatchMutation.mutate()}
          disabled={runBatchMutation.isPending}
          data-testid="button-run-enrichment"
        >
          {runBatchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Run Batch
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card data-testid="card-serper-total">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Enriched</div>
            <div className="text-xl font-bold">{data.totalEnriched}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-7d-enriched">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Processed</div>
            <div className="text-xl font-bold">{last7.totalProcessed}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-websites">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Websites</div>
            <div className="text-xl font-bold text-blue-600">{last7.websitesFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-phones">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Phones</div>
            <div className="text-xl font-bold text-green-600">{last7.phonesFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-emails">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Emails</div>
            <div className="text-xl font-bold text-purple-600">{last7.emailsFound}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DiscoveryControlsPanel() {
  const { data, isLoading } = useQuery<{
    nightlySchedulerRunning: boolean;
    discoveryInProgress: boolean;
    nightlyDiscoveryEnabled: boolean;
  }>({
    queryKey: ["/api/sdr/discovery-controls"],
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4" data-testid="panel-discovery-controls">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-nightly-enabled">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Nightly Discovery</span>
            </div>
            <Badge className={data?.nightlyDiscoveryEnabled
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.nightlyDiscoveryEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-scheduler-running">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Scheduler Status</div>
            <Badge className={data?.nightlySchedulerRunning
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.nightlySchedulerRunning ? "Running" : "Stopped"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-progress">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Discovery Status</div>
            <Badge className={data?.discoveryInProgress
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.discoveryInProgress ? "In Progress" : "Idle"}
            </Badge>
          </CardContent>
        </Card>
      </div>
      {!data?.nightlyDiscoveryEnabled && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center text-muted-foreground text-sm" data-testid="text-nightly-disabled">
            Nightly discovery is disabled. Set NIGHTLY_DISCOVERY_ENABLED=true to enable automated lead discovery.
          </CardContent>
        </Card>
      )}
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
        <TabsList className="flex-wrap">
          <TabsTrigger value="summary" data-testid="tab-sdr-summary">Summary</TabsTrigger>
          <TabsTrigger value="discovery" data-testid="tab-sdr-discovery">Discovery</TabsTrigger>
          <TabsTrigger value="funnel" data-testid="tab-sdr-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-sdr-stuck">Stuck Leads</TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-sdr-channels">Channel Health</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-sdr-alerts">Anomaly Alerts</TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sdr-sms">SMS</TabsTrigger>
          <TabsTrigger value="enrichment" data-testid="tab-sdr-enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="voice" data-testid="tab-sdr-voice">Voice AI</TabsTrigger>
          <TabsTrigger value="nightlycontrols" data-testid="tab-sdr-nightlycontrols">Discovery Controls</TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-sdr-chat">Chat AI</TabsTrigger>
          <TabsTrigger value="processors" data-testid="tab-sdr-processors">Processor Intel</TabsTrigger>
          <TabsTrigger value="sources" data-testid="tab-sdr-sources">Source Quality</TabsTrigger>
          <TabsTrigger value="identity" data-testid="tab-sdr-identity">Inbox Health</TabsTrigger>
          <TabsTrigger value="market" data-testid="tab-sdr-market">Market Expansion</TabsTrigger>
          <TabsTrigger value="kpi" data-testid="tab-sdr-kpi">Weekly KPI</TabsTrigger>
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

        <TabsContent value="alerts" className="mt-4">
          <AnomalyAlertsPanel />
        </TabsContent>

        <TabsContent value="sms" className="mt-4">
          <SmsMetricsPanel />
        </TabsContent>

        <TabsContent value="enrichment" className="mt-4">
          <SerperEnrichmentPanel />
        </TabsContent>

        <TabsContent value="voice" className="mt-4">
          <VoiceAiStatusPanel />
        </TabsContent>

        <TabsContent value="nightlycontrols" className="mt-4">
          <DiscoveryControlsPanel />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatAnalytics />
        </TabsContent>

        <TabsContent value="processors" className="mt-4">
          <ProcessorIntelligence />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <SourceQualityDashboard />
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <IdentityHealthDashboard />
        </TabsContent>

        <TabsContent value="market" className="mt-4">
          <MarketExpansionDashboard />
        </TabsContent>

        <TabsContent value="kpi" className="mt-4">
          <WeeklyKpiReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
