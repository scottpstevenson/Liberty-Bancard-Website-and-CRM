import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, Calendar, CheckCircle2,
  Clock, Loader2, Mail, MessageSquare, Phone, RefreshCw, Send, Shield,
  Target, TrendingUp, Users, XCircle, Zap, Eye, Filter, ChevronRight,
} from "lucide-react";

interface OperatorKpis {
  range: string;
  startDate: string;
  endDate: string;
  leadsQueued: number;
  emailsSent: number;
  smsSent: number;
  callsMade: number;
  totalContacted: number;
  replies: number;
  positiveReplies: number;
  meetingsBooked: number;
  statementsRequested: number;
  proposalsSent: number;
  closedWon: number;
  closedLost: number;
  bounceRate: number;
  replyRate: number;
  positiveIntentRate: number;
  bookedCallRate: number;
  sendSuccessRate: number;
  activeIdentities: number;
  pausedSystems: number;
  stuckLeadsCount: number;
}

interface SendMonitoringIdentity {
  id: number;
  label: string;
  domain: string;
  emailAddress: string;
  isActive: boolean | null;
  warmupStatus: string | null;
  warmupProgress: number;
  warmupDays: number;
  dailyLimit: number;
  sentToday: number;
  bouncesToday: number;
  complaintsToday: number;
  healthScore: number;
  capUtilization: number;
  week: {
    sent: number;
    delivered: number;
    bounced: number;
    replied: number;
    complaints: number;
    opened: number;
    positiveReplies: number;
    bounceRate: number;
    replyRate: number;
    complaintRate: number;
    openRate: number;
  };
}

interface SendMonitoringData {
  identities: SendMonitoringIdentity[];
  aggregated: {
    totalIdentities: number;
    activeIdentities: number;
    totalSentToday: number;
    totalDailyLimit: number;
    overallCapUtilization: number;
  };
}

interface WebhookEvent {
  id: number;
  eventType: string;
  merchantId: number | null;
  businessName: string;
  leadStateId: number | null;
  fromStage: string | null;
  toStage: string | null;
  actionType: string | null;
  channel: string | null;
  actorType: string | null;
  decisionReason: string | null;
  complianceResult: string | null;
  metadata: any;
  ghlRefId: string | null;
  createdAt: string | null;
  eventAt: string | null;
}

interface LowConfidenceItem {
  id: number;
  merchantId: number;
  businessName: string;
  classifiedIntent: string;
  confidence: number;
  replyText: string;
  channel: string;
  createdAt: string;
}

interface StuckLead {
  type: string;
  leadId: number | null;
  merchantId: number;
  businessName: string;
  currentStage: string | null;
  nextActionAt: string | null;
  reason: string;
  stageAgeDays?: number;
}

function KpiCard({ label, value, icon: Icon, color, suffix, subtext }: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
  suffix?: string;
  subtext?: string;
}) {
  return (
    <Card data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold" data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}{suffix}
        </div>
        {subtext && <div className="text-xs text-muted-foreground mt-1">{subtext}</div>}
      </CardContent>
    </Card>
  );
}

function OperatorKpiPanel() {
  const [range, setRange] = useState("today");

  const { data: kpis, isLoading } = useQuery<OperatorKpis>({
    queryKey: ["/api/sdr/operator/kpis", range],
    queryFn: async () => {
      const res = await fetch(`/api/sdr/operator/kpis?range=${range}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const rangeLabel = range === "today" ? "Today" : range === "yesterday" ? "Yesterday" : "Last 7 Days";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Pilot KPIs — {rangeLabel}</h3>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[140px]" data-testid="select-kpi-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="7day">Last 7 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="Leads Queued" value={kpis?.leadsQueued || 0} icon={Users} color="text-blue-600" />
        <KpiCard label="Contacted" value={kpis?.totalContacted || 0} icon={Send} color="text-purple-600" subtext={`${kpis?.emailsSent || 0} email, ${kpis?.smsSent || 0} sms`} />
        <KpiCard label="Send Success" value={kpis?.sendSuccessRate || 0} icon={CheckCircle2} color="text-green-600" suffix="%" subtext={`${kpis?.bounceRate || 0}% bounce`} />
        <KpiCard label="Bounce Rate" value={kpis?.bounceRate || 0} icon={XCircle} color="text-red-600" suffix="%" />
        <KpiCard label="Reply Rate" value={kpis?.replyRate || 0} icon={MessageSquare} color="text-orange-600" suffix="%" subtext={`${kpis?.replies || 0} replies`} />
        <KpiCard label="Positive Intent" value={kpis?.positiveIntentRate || 0} icon={TrendingUp} color="text-emerald-600" suffix="%" subtext={`${kpis?.positiveReplies || 0} positive`} />
        <KpiCard label="Booked Calls" value={kpis?.meetingsBooked || 0} icon={Calendar} color="text-indigo-600" subtext={`${kpis?.bookedCallRate || 0}% rate`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Statements" value={kpis?.statementsRequested || 0} icon={Target} color="text-teal-600" />
        <KpiCard label="Stuck Leads" value={kpis?.stuckLeadsCount || 0} icon={AlertTriangle} color="text-yellow-600" subtext="Needs attention" />
        <KpiCard label="Active Identities" value={kpis?.activeIdentities || 0} icon={Activity} color="text-cyan-600" subtext={`${kpis?.pausedSystems || 0} paused`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-2">Outreach Breakdown</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span>
                <span className="font-medium">{kpis?.emailsSent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> SMS</span>
                <span className="font-medium">{kpis?.smsSent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> Calls</span>
                <span className="font-medium">{kpis?.callsMade || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-2">Funnel Progress</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Proposals Sent</span>
                <span className="font-medium">{kpis?.proposalsSent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Closed Won</span>
                <span className="font-medium text-green-600">{kpis?.closedWon || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Closed Lost</span>
                <span className="font-medium text-red-600">{kpis?.closedLost || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-2">System Status</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Active Inboxes</span>
                <Badge variant={kpis?.activeIdentities ? "default" : "destructive"} data-testid="badge-active-inboxes">
                  {kpis?.activeIdentities || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Paused Systems</span>
                <Badge variant={(kpis?.pausedSystems || 0) > 0 ? "destructive" : "secondary"} data-testid="badge-paused-systems">
                  {kpis?.pausedSystems || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Stuck Leads</span>
                <Badge variant={(kpis?.stuckLeadsCount || 0) > 5 ? "destructive" : "secondary"} data-testid="badge-stuck-leads">
                  {kpis?.stuckLeadsCount || 0}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SendMonitoringPanel() {
  const { data, isLoading } = useQuery<SendMonitoringData>({
    queryKey: ["/api/sdr/operator/send-monitoring"],
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const agg = data?.aggregated;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Send Monitoring</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" /> Auto-refresh every 15s
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Identities" value={agg?.totalIdentities || 0} icon={Mail} color="text-blue-600" />
        <KpiCard label="Active" value={agg?.activeIdentities || 0} icon={Activity} color="text-green-600" />
        <KpiCard label="Sent Today" value={agg?.totalSentToday || 0} icon={Send} color="text-purple-600" subtext={`of ${agg?.totalDailyLimit || 0} limit`} />
        <KpiCard label="Cap Used" value={agg?.overallCapUtilization || 0} icon={BarChart3} color="text-orange-600" suffix="%" />
      </div>

      <div className="space-y-3">
        {data?.identities.map((identity) => (
          <Card key={identity.id} data-testid={`send-identity-${identity.id}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-sm">{identity.label}</div>
                    <div className="text-xs text-muted-foreground">{identity.emailAddress}</div>
                  </div>
                  <Badge
                    variant={identity.warmupStatus === "warm" ? "default" : identity.warmupStatus === "warming" ? "secondary" : "destructive"}
                    data-testid={`badge-warmup-${identity.id}`}
                  >
                    {identity.warmupStatus || "unknown"}
                  </Badge>
                  {identity.isActive ? (
                    <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-red-600 border-red-300">Paused</Badge>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold" data-testid={`health-score-${identity.id}`}>{Math.round(identity.healthScore)}</div>
                  <div className="text-xs text-muted-foreground">Health</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <div className="text-xs text-muted-foreground">Today</div>
                  <div className="font-medium">{identity.sentToday} / {identity.dailyLimit}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">7d Sent</div>
                  <div className="font-medium">{identity.week.sent}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">7d Bounced</div>
                  <div className="font-medium text-red-600">{identity.week.bounced} ({identity.week.bounceRate}%)</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">7d Replied</div>
                  <div className="font-medium text-green-600">{identity.week.replied} ({identity.week.replyRate}%)</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Daily Cap Utilization</span>
                  <span>{identity.capUtilization}%</span>
                </div>
                <Progress value={identity.capUtilization} className="h-2" />
                {identity.warmupStatus === "warming" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>Warmup Progress ({identity.warmupDays}d / 14d)</span>
                      <span>{identity.warmupProgress}%</span>
                    </div>
                    <Progress value={identity.warmupProgress} className="h-2" />
                  </div>
                )}
              </div>

              {identity.week.complaints > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="w-3 h-3" />
                  {identity.week.complaints} complaint(s) this week ({identity.week.complaintRate}%)
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WebhookEventViewer() {
  const [eventFilter, setEventFilter] = useState<string>("all");

  const { data: events, isLoading } = useQuery<WebhookEvent[]>({
    queryKey: ["/api/sdr/operator/webhook-events", eventFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (eventFilter && eventFilter !== "all") params.set("eventType", eventFilter);
      const res = await fetch(`/api/sdr/operator/webhook-events?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const eventTypes = [...new Set(events?.map(e => e.eventType) || [])];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Webhook Event Log</h3>
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-event-filter">
            <SelectValue placeholder="All Events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {eventTypes.map(type => (
              <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {events?.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">No webhook events found</div>
          )}
          {events?.map((event) => (
            <Card key={event.id} data-testid={`webhook-event-${event.id}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{event.eventType.replace(/_/g, " ")}</Badge>
                    {event.channel && <Badge variant="secondary" className="text-xs">{event.channel}</Badge>}
                    {event.actorType && <Badge variant="secondary" className="text-xs">{event.actorType}</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Business: </span>
                    <span className="font-medium">{event.businessName}</span>
                  </div>
                  {event.fromStage && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Stage: </span>
                      <span>{event.fromStage}</span>
                      <ChevronRight className="w-3 h-3" />
                      <span className="font-medium">{event.toStage}</span>
                    </div>
                  )}
                  {event.decisionReason && (
                    <div>
                      <span className="text-muted-foreground">Reason: </span>
                      <span>{event.decisionReason}</span>
                    </div>
                  )}
                  {event.complianceResult && (
                    <div>
                      <span className="text-muted-foreground">Compliance: </span>
                      <span>{event.complianceResult}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StuckLeadsPanel() {
  const { data: stuckLeads, isLoading } = useQuery<StuckLead[]>({
    queryKey: ["/api/sdr/dashboard/stuck-leads"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Stuck Leads — Needs Attention</h3>
        <Badge variant={(stuckLeads?.length || 0) > 0 ? "destructive" : "secondary"} data-testid="badge-stuck-count">
          {stuckLeads?.length || 0} leads
        </Badge>
      </div>

      {stuckLeads?.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">No stuck leads — all systems running smoothly</div>
      )}

      <div className="space-y-2">
        {stuckLeads?.map((lead, idx) => (
          <Card key={`${lead.merchantId}-${idx}`} data-testid={`stuck-lead-${lead.merchantId}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-4 h-4 ${lead.type === "overdue" ? "text-red-600" : "text-yellow-600"}`} />
                  <div>
                    <div className="font-medium text-sm">{lead.businessName}</div>
                    <div className="text-xs text-muted-foreground">{lead.reason}</div>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="text-xs">{lead.currentStage}</Badge>
                  {lead.stageAgeDays !== undefined && (
                    <div className="text-xs text-muted-foreground mt-1">{lead.stageAgeDays}d in stage</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LowConfidencePanel() {
  const { data: items, isLoading } = useQuery<LowConfidenceItem[]>({
    queryKey: ["/api/sdr/operator/low-confidence"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Low Confidence Classifications (&lt;70%)</h3>
        <Badge variant={(items?.length || 0) > 0 ? "destructive" : "secondary"} data-testid="badge-low-confidence-count">
          {items?.length || 0} flagged
        </Badge>
      </div>

      {items?.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">No low-confidence classifications found</div>
      )}

      <div className="space-y-2">
        {items?.map((item) => (
          <Card key={item.id} data-testid={`low-confidence-${item.id}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  <span className="font-medium text-sm">{item.businessName}</span>
                  <Badge variant="outline">{item.classifiedIntent}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{Math.round(item.confidence * 100)}%</Badge>
                  <span className="text-xs text-muted-foreground">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
              {item.replyText && (
                <div className="text-xs bg-muted p-2 rounded mt-2 line-clamp-2">{item.replyText}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function OperatorDashboard() {
  const { toast } = useToast();

  const digestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sdr/operator/send-daily-digest");
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Daily digest sent successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send digest", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-operator-title">Operator Dashboard</h1>
          <p className="text-muted-foreground text-sm">Pilot instrumentation — real-time send monitoring and alerts</p>
        </div>
        <Button
          onClick={() => digestMutation.mutate()}
          disabled={digestMutation.isPending}
          variant="outline"
          data-testid="button-send-digest"
        >
          {digestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
          Send Daily Digest
        </Button>
      </div>

      <Tabs defaultValue="kpis" className="w-full">
        <TabsList className="w-full justify-start flex-wrap" data-testid="tabs-operator">
          <TabsTrigger value="kpis" data-testid="tab-kpis">KPIs</TabsTrigger>
          <TabsTrigger value="send-monitoring" data-testid="tab-send-monitoring">Send Monitoring</TabsTrigger>
          <TabsTrigger value="webhook-events" data-testid="tab-webhook-events">Webhook Events</TabsTrigger>
          <TabsTrigger value="stuck-leads" data-testid="tab-stuck-leads">Stuck Leads</TabsTrigger>
          <TabsTrigger value="low-confidence" data-testid="tab-low-confidence">Low Confidence</TabsTrigger>
        </TabsList>

        <TabsContent value="kpis">
          <OperatorKpiPanel />
        </TabsContent>
        <TabsContent value="send-monitoring">
          <SendMonitoringPanel />
        </TabsContent>
        <TabsContent value="webhook-events">
          <WebhookEventViewer />
        </TabsContent>
        <TabsContent value="stuck-leads">
          <StuckLeadsPanel />
        </TabsContent>
        <TabsContent value="low-confidence">
          <LowConfidencePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
