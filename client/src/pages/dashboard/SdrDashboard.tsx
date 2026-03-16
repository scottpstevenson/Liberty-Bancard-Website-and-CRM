import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Target, MessageSquare, Calendar, FileText, Send, AlertTriangle, BarChart3, Mail, Phone, MessageCircle, Bot, ArrowRightLeft, Clock, ShieldCheck, UserCheck, ArrowRight, TrendingUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
          <TabsTrigger value="funnel" data-testid="tab-sdr-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-sdr-stuck">Stuck Leads</TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-sdr-channels">Channel Health</TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-sdr-chat">Chat AI</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryCards />
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
