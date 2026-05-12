import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ContentOrganicKpiPanel } from "@/components/ContentOrganicKpiPanel";
import { PageHeader } from "@/components/ui/page-header";
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, Calendar, CheckCircle2,
  Clock, Loader2, Mail, MessageSquare, Phone, RefreshCw, Send, Shield,
  Target, TrendingUp, Users, XCircle, Zap, Eye, Filter, ChevronRight, Server,
  Bot, DollarSign, Hash,
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

  const { data: kpis, isLoading, isError, refetch } = useQuery<OperatorKpis>({
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

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="kpi-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load KPI data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-kpis">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
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
  const { data, isLoading, isError, refetch } = useQuery<SendMonitoringData>({
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

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="send-monitoring-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load send monitoring data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-send-monitoring">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
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

  const { data: events, isLoading, isError, refetch } = useQuery<WebhookEvent[]>({
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

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="webhook-events-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load webhook events</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-webhook-events">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

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
  const { data: stuckLeads, isLoading, isError, refetch } = useQuery<StuckLead[]>({
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

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="stuck-leads-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load stuck leads</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-stuck-leads">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
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

interface ActivationStatusData {
  ready: boolean;
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
  heartbeat: { sequenceRunner: any; slaWorker: any; stageProgression: any };
  activeIdentities: number;
  totalIdentities: number;
  activeEnrollments: number;
  flags: Record<string, boolean>;
}

function ReadinessChecklistWidget() {
  const { data, isLoading } = useQuery<ActivationStatusData>({
    queryKey: ["/api/operator/activation-status"],
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const slaTickAt = data.heartbeat.slaWorker?.at ? new Date(data.heartbeat.slaWorker.at).getTime() : 0;
  const seqTickAt = data.heartbeat.sequenceRunner?.at ? new Date(data.heartbeat.sequenceRunner.at).getTime() : 0;
  const STALE_MS = 15 * 60 * 1000;
  const workersFresh = slaTickAt > 0 && (Date.now() - slaTickAt) < STALE_MS;
  const systemActive = data.ready && workersFresh;
  const failed = data.checks.filter(c => !c.ok);
  const reason = systemActive
    ? "All preconditions met — pipeline & outreach active"
    : failed.length > 0
      ? `Idle — ${failed[0].label}`
      : "Idle — worker heartbeat stale";

  return (
    <div className="space-y-3">
      <Card className={systemActive ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}>
        <CardContent className="p-4 flex items-start gap-3">
          {systemActive ? (
            <CheckCircle2 className="w-6 h-6 text-green-600 mt-0.5" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-yellow-600 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base" data-testid="text-system-status">
                System {systemActive ? "Active" : "Idle"}
              </span>
              <Badge variant={systemActive ? "default" : "secondary"} data-testid="badge-system-status">
                {data.checks.filter(c => c.ok).length}/{data.checks.length} checks pass
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-1" data-testid="text-system-reason">{reason}</div>
            <div className="text-xs text-muted-foreground mt-2">
              SLA tick: {data.heartbeat.slaWorker?.at ? new Date(data.heartbeat.slaWorker.at).toLocaleString() : "never"} ·
              {" "}Sequence tick: {data.heartbeat.sequenceRunner?.at ? new Date(data.heartbeat.sequenceRunner.at).toLocaleString() : "never"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Pre-Flight Readiness Checklist</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {data.checks.map((check, idx) => (
              <li key={check.id} className="flex items-start gap-3 p-2 border rounded" data-testid={`operator-check-${check.id}`}>
                <div className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold mt-0.5">{idx + 1}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {check.ok
                      ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : <AlertTriangle className="w-4 h-4 text-yellow-600" />}
                    <span className="text-sm font-medium">{check.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 ml-6">{check.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

interface RecentSendsData {
  windowHours: number;
  totals: { email: number; calls: number; outbound: number; all: number };
  recent: Array<{ id: number; channel: string; to: string; subject: string; status: string; sentAt: string }>;
}

function RecentSendsWidget() {
  const { data, isLoading } = useQuery<RecentSendsData>({
    queryKey: ["/api/operator/recent-sends"],
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Email (24h)" value={data.totals.email} icon={Mail} color="text-blue-600" />
        <KpiCard label="Calls (24h)" value={data.totals.calls} icon={Phone} color="text-purple-600" />
        <KpiCard label="Outbound (24h)" value={data.totals.outbound} icon={Send} color="text-green-600" />
        <KpiCard label="All Sends (24h)" value={data.totals.all} icon={Activity} color="text-orange-600" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Email Sends (last 20)</CardTitle></CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-no-recent-sends">No outbound sends in last 24 hours</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left">
                    <th className="py-1 px-2">Time</th>
                    <th className="py-1 px-2">To</th>
                    <th className="py-1 px-2">Subject</th>
                    <th className="py-1 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map(r => (
                    <tr key={r.id} className="border-b" data-testid={`recent-send-${r.id}`}>
                      <td className="py-1 px-2 whitespace-nowrap">{r.sentAt ? new Date(r.sentAt).toLocaleTimeString() : "-"}</td>
                      <td className="py-1 px-2 truncate max-w-32">{r.to}</td>
                      <td className="py-1 px-2 truncate max-w-64">{r.subject}</td>
                      <td className="py-1 px-2"><Badge variant="outline" className="text-xs">{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface SilentSequencesData {
  totalActive: number;
  silentCount: number;
  reason: string;
  workerStale: boolean;
  outreachEnabled: boolean;
  lastTick: any;
  items: Array<{ id: number; contactId: number; dealId: number; sequenceId: number; currentStep: number; status: string; nextActionAt: string; updatedAt: string }>;
}

function SilentSequencesWidget() {
  const { data, isLoading } = useQuery<SilentSequencesData>({
    queryKey: ["/api/operator/silent-sequences"],
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <Card className={data.silentCount > 0 || data.workerStale ? "border-yellow-500/50 bg-yellow-500/5" : ""}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 mt-0.5 ${data.silentCount > 0 || data.workerStale ? "text-yellow-600" : "text-muted-foreground"}`} />
            <div className="flex-1">
              <div className="font-medium text-sm" data-testid="text-silent-reason">{data.reason}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.totalActive} active enrollments · {data.silentCount} silent for &gt;24h ·
                {" "}Outreach flag: <span className={data.outreachEnabled ? "text-green-600" : "text-red-600"}>{data.outreachEnabled ? "ON" : "OFF"}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Last tick: {data.lastTick?.at ? new Date(data.lastTick.at).toLocaleString() : "never"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Silent Enrollments (no progress &gt;24h)</CardTitle></CardHeader>
        <CardContent>
          {data.items.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-no-silent">All enrollments are progressing</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left">
                    <th className="py-1 px-2">ID</th>
                    <th className="py-1 px-2">Contact</th>
                    <th className="py-1 px-2">Sequence</th>
                    <th className="py-1 px-2">Step</th>
                    <th className="py-1 px-2">Next Action</th>
                    <th className="py-1 px-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(it => (
                    <tr key={it.id} className="border-b" data-testid={`silent-row-${it.id}`}>
                      <td className="py-1 px-2">{it.id}</td>
                      <td className="py-1 px-2">{it.contactId}</td>
                      <td className="py-1 px-2">{it.sequenceId}</td>
                      <td className="py-1 px-2">{it.currentStep}</td>
                      <td className="py-1 px-2 text-muted-foreground whitespace-nowrap">{it.nextActionAt ? new Date(it.nextActionAt).toLocaleString() : "-"}</td>
                      <td className="py-1 px-2 text-muted-foreground whitespace-nowrap">{it.updatedAt ? new Date(it.updatedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LowConfidencePanel() {
  const { data: items, isLoading, isError, refetch } = useQuery<LowConfidenceItem[]>({
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

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="low-confidence-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load low confidence data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-low-confidence">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
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

interface JobStatus {
  jobName: string;
  status: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  runCount: number;
  consecutiveFailures: number;
  updatedAt: string | null;
  lastDurationMs: number | null;
}

const JOB_LABELS: Record<string, string> = {
  "ghl-sync": "GHL Contact Sync",
  "sla-worker": "SLA Worker",
  "inbox-rotation": "Inbox Rotation",
  "content-scheduler": "Content Scheduler",
  "sequence-worker": "Sequence Worker",
  "anomaly-detection": "Anomaly Detection",
  "weekly-digest": "Weekly Digest",
  "mid-ingestion": "MID Ingestion",
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function JobHealthPanel() {
  const { data, isLoading, isError, refetch } = useQuery<{ jobs: JobStatus[] }>({
    queryKey: ["/api/operator/job-status"],
    refetchInterval: 30000,
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
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="job-health-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load job health data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-job-health">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  const criticalJobs = jobs.filter(j => j.consecutiveFailures >= 3);

  return (
    <div className="space-y-4" data-testid="panel-job-health">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Background Job Health</h3>
          {criticalJobs.length > 0 && (
            <Badge variant="destructive" data-testid="badge-job-failures">
              {criticalJobs.length} failing
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-job-health">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {criticalJobs.length > 0 && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 flex items-start gap-2" data-testid="alert-job-failures">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800 dark:text-red-200">
            <strong>{criticalJobs.length} job{criticalJobs.length > 1 ? "s" : ""}</strong> {criticalJobs.length > 1 ? "have" : "has"} 3 or more consecutive failures:{" "}
            {criticalJobs.map(j => JOB_LABELS[j.jobName] || j.jobName).join(", ")}
          </div>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm" data-testid="table-job-health">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Run</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Runs</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Failures</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {jobs.map((job) => {
              const isCritical = job.consecutiveFailures >= 3;
              const label = JOB_LABELS[job.jobName] || job.jobName;
              return (
                <tr
                  key={job.jobName}
                  className={isCritical ? "bg-red-50 dark:bg-red-950/30" : ""}
                  data-testid={`row-job-${job.jobName}`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {isCritical && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                      {label}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        job.status === "running" ? "secondary"
                          : job.status === "succeeded" ? "outline"
                          : job.status === "failed" ? "destructive"
                          : "secondary"
                      }
                      className={
                        job.status === "succeeded"
                          ? "border-green-500 text-green-700 dark:text-green-400"
                          : ""
                      }
                      data-testid={`badge-job-status-${job.jobName}`}
                    >
                      {job.status === "running" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      {job.status === "succeeded" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                      {job.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                      {job.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs" data-testid={`text-job-last-run-${job.jobName}`}>
                    {formatRelativeTime(job.lastFinishedAt)}
                    {job.lastError && (
                      <div className="text-red-500 truncate max-w-[180px]" title={job.lastError}>
                        {job.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDuration(job.lastDurationMs)}
                  </td>
                  <td className="px-4 py-3 text-xs">{job.runCount}</td>
                  <td className="px-4 py-3">
                    {job.consecutiveFailures > 0 ? (
                      <span className={`text-xs font-medium ${isCritical ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`} data-testid={`text-job-failures-${job.jobName}`}>
                        {job.consecutiveFailures}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Auto-refreshes every 30 seconds</p>
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
    <div className="space-y-6">
      <PageHeader
        title="Operator Dashboard"
        subtitle="Pilot instrumentation — real-time send monitoring and alerts"
        testId="text-operator-title"
        actions={
          <Button
            onClick={() => digestMutation.mutate()}
            disabled={digestMutation.isPending}
            variant="outline"
            data-testid="button-send-digest"
          >
            {digestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
            Send Daily Digest
          </Button>
        }
      />

      <Tabs defaultValue="job-health" className="w-full">
        <TabsList className="w-full justify-start flex-wrap" data-testid="tabs-operator">
          <TabsTrigger value="job-health" data-testid="tab-job-health" className="flex items-center gap-1">
            <Server className="w-3.5 h-3.5" />
            Job Health
          </TabsTrigger>
          <TabsTrigger value="readiness" data-testid="tab-readiness">Readiness</TabsTrigger>
          <TabsTrigger value="kpis" data-testid="tab-kpis">KPIs</TabsTrigger>
          <TabsTrigger value="recent-sends" data-testid="tab-recent-sends">Recent Sends</TabsTrigger>
          <TabsTrigger value="silent-sequences" data-testid="tab-silent-sequences">Sequences Not Firing</TabsTrigger>
          <TabsTrigger value="send-monitoring" data-testid="tab-send-monitoring">Send Monitoring</TabsTrigger>
          <TabsTrigger value="webhook-events" data-testid="tab-webhook-events">Webhook Events</TabsTrigger>
          <TabsTrigger value="stuck-leads" data-testid="tab-stuck-leads">Stuck Leads</TabsTrigger>
          <TabsTrigger value="low-confidence" data-testid="tab-low-confidence">Low Confidence</TabsTrigger>
          <TabsTrigger value="content-organic" data-testid="tab-content-organic">Content & Organic</TabsTrigger>
          <TabsTrigger value="ai-activity" data-testid="tab-ai-activity">AI Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="job-health">
          <JobHealthPanel />
        </TabsContent>
        <TabsContent value="readiness">
          <ReadinessChecklistWidget />
        </TabsContent>
        <TabsContent value="kpis">
          <OperatorKpiPanel />
        </TabsContent>
        <TabsContent value="recent-sends">
          <RecentSendsWidget />
        </TabsContent>
        <TabsContent value="silent-sequences">
          <SilentSequencesWidget />
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
        <TabsContent value="content-organic">
          <ContentOrganicKpiPanel />
        </TabsContent>
        <TabsContent value="ai-activity">
          <AiActivityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const AI_TRIGGER_LABELS: Record<string, string> = {
  "advisor-chat": "Advisor Chat",
  "insights": "Dashboard Insights",
  "compose-email": "Email Composer",
  "ticket-classify": "Ticket Classification",
  "statement-analysis": "Statement Analysis",
  "proposal": "Proposal Generator",
  "blueprint": "Deal Blueprint",
  "enrichment": "Lead Enrichment",
  "reply-classify": "Reply Classification",
  "outbound-copy": "Outbound Copy",
  "website-quality": "Website Quality",
  "nightly-discovery": "Nightly Discovery",
};

function AiActivityPanel() {
  const [triggerType, setTriggerType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (triggerType !== "all") params.set("triggerType", triggerType);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const { data, isLoading, refetch } = useQuery<{
    logs: Array<{
      id: number;
      triggerType: string;
      actorType: string;
      actorId: string | null;
      model: string;
      promptTokens: number;
      completionTokens: number;
      costCents: number;
      responseSummary: string | null;
      error: string | null;
      durationMs: number | null;
      createdAt: string;
    }>;
    totals: {
      totalCalls: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalCostCents: number;
      byTriggerType: Record<string, { calls: number; promptTokens: number; completionTokens: number; costCents: number }>;
    };
  }>({
    queryKey: ["/api/operator/ai-audit", triggerType, startDate, endDate, page],
    queryFn: () => fetch(`/api/operator/ai-audit?${params}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const totals = data?.totals;
  const logs = data?.logs || [];

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Trigger Type</label>
          <Select value={triggerType} onValueChange={v => { setTriggerType(v); setPage(0); }}>
            <SelectTrigger className="w-48" data-testid="select-trigger-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(AI_TRIGGER_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Start Date</label>
          <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0); }} className="w-40" data-testid="input-start-date" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">End Date</label>
          <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0); }} className="w-40" data-testid="input-end-date" />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-ai-audit">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Bot className="w-3 h-3" /> Total Calls</div>
              <div className="text-2xl font-bold" data-testid="text-total-calls">{totals.totalCalls.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Hash className="w-3 h-3" /> Prompt Tokens</div>
              <div className="text-2xl font-bold" data-testid="text-prompt-tokens">{totals.totalPromptTokens.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Hash className="w-3 h-3" /> Completion Tokens</div>
              <div className="text-2xl font-bold" data-testid="text-completion-tokens">{totals.totalCompletionTokens.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3 h-3" /> Est. Cost</div>
              <div className="text-2xl font-bold text-green-600" data-testid="text-total-cost">${(totals.totalCostCents / 100).toFixed(4)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {Object.keys(totals?.byTriggerType || {}).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cost by Trigger Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(totals!.byTriggerType).sort((a, b) => b[1].costCents - a[1].costCents).map(([type, stats]) => (
                <div key={type} className="flex justify-between items-center py-1 border-b last:border-0 text-sm" data-testid={`row-trigger-${type}`}>
                  <span className="text-muted-foreground">{AI_TRIGGER_LABELS[type] || type}</span>
                  <div className="text-right">
                    <div className="font-medium">{stats.calls} calls</div>
                    <div className="text-xs text-muted-foreground">${(stats.costCents / 100).toFixed(4)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent AI Calls</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No AI calls recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Time</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Trigger</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Model</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Tokens</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Cost</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Duration</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-ai-log-${log.id}`}>
                      <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className="text-xs">{AI_TRIGGER_LABELS[log.triggerType] || log.triggerType}</Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{log.model}</td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-xs">{(log.promptTokens + log.completionTokens).toLocaleString()}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-xs">${(log.costCents / 100).toFixed(4)}</td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">{log.durationMs ? `${log.durationMs}ms` : "—"}</td>
                      <td className="py-2 px-3">
                        {log.error ? (
                          <Badge variant="destructive" className="text-xs">Error</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {logs.length === PAGE_SIZE && (
            <div className="flex justify-center gap-2 py-3 border-t">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} data-testid="button-next-page">Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
