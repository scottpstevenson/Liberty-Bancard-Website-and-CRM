import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, Calendar, CheckCircle2,
  Clock, Loader2, Mail, MessageSquare, Phone, RefreshCw, Send, Shield,
  Target, TrendingUp, Users, XCircle, Zap, Eye, Filter, ChevronRight, ChevronDown, Server, GitMerge,
  Bot, DollarSign, Hash, Play, Flag, ShieldCheck, FileText, Upload, Database,
} from "lucide-react";
import StatementChainPanel from "@/components/operator/StatementChainPanel";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";

interface SyncConflict {
  id: number;
  contactId: number;
  fieldName: string;
  internalValue: string | null;
  ghlValue: string | null;
  internalUpdatedAt: string | null;
  ghlUpdatedAt: string | null;
  resolution: string;
  resolvedAt: string | null;
  createdAt: string | null;
}

function SyncConflictsPanel() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("pending");

  const { data: conflicts, isLoading, isError, refetch } = useQuery<SyncConflict[]>({
    queryKey: ["/api/operator/sync-conflicts", filter],
    queryFn: async () => {
      const url = filter === "all"
        ? "/api/operator/sync-conflicts"
        : `/api/operator/sync-conflicts?resolution=${filter}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sync conflicts");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, resolution }: { id: number; resolution: "kept-internal" | "kept-ghl" | "manual" }) => {
      const res = await apiRequest("PATCH", `/api/operator/sync-conflicts/${id}/resolve`, { resolution });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Conflict resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/sync-conflicts"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to resolve conflict", description: err.message, variant: "destructive" });
    },
  });

  const pendingCount = (conflicts || []).filter(c => c.resolution === "pending").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="sync-conflicts-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load sync conflicts</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-sync-conflicts">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">GHL Sync Conflicts</h3>
          {pendingCount > 0 && (
            <Badge variant="destructive" data-testid="badge-pending-conflicts">{pendingCount} pending</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-conflict-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="kept-internal">Kept Ours</SelectItem>
              <SelectItem value="kept-ghl">Kept GHL</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-conflicts">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {(!conflicts || conflicts.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground" data-testid="no-conflicts-message">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="text-sm font-medium">No conflicts found</p>
          <p className="text-xs">GHL sync is clean — no unresolved field conflicts</p>
        </div>
      )}

      <div className="space-y-3">
        {conflicts?.map((conflict) => (
          <Card key={conflict.id} data-testid={`conflict-card-${conflict.id}`} className={conflict.resolution === "pending" ? "border-yellow-300 dark:border-yellow-700" : ""}>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs" data-testid={`conflict-field-${conflict.id}`}>
                      {conflict.fieldName}
                    </Badge>
                    <Badge
                      variant={conflict.resolution === "pending" ? "destructive" : conflict.resolution === "kept-internal" ? "default" : "secondary"}
                      data-testid={`conflict-resolution-${conflict.id}`}
                    >
                      {conflict.resolution}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Contact #{conflict.contactId}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-2">
                      <div className="text-xs text-muted-foreground mb-1 font-medium">Internal (Ours)</div>
                      <div className="font-mono text-xs break-all" data-testid={`conflict-internal-${conflict.id}`}>
                        {conflict.internalValue || <span className="italic text-muted-foreground">(empty)</span>}
                      </div>
                      {conflict.internalUpdatedAt && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(conflict.internalUpdatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-950/30 rounded p-2">
                      <div className="text-xs text-muted-foreground mb-1 font-medium">GHL Value</div>
                      <div className="font-mono text-xs break-all" data-testid={`conflict-ghl-${conflict.id}`}>
                        {conflict.ghlValue || <span className="italic text-muted-foreground">(empty)</span>}
                      </div>
                      {conflict.ghlUpdatedAt && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(conflict.ghlUpdatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Detected: {conflict.createdAt ? new Date(conflict.createdAt).toLocaleString() : "—"}
                    {conflict.resolvedAt && ` · Resolved: ${new Date(conflict.resolvedAt).toLocaleString()}`}
                  </div>
                </div>

                {conflict.resolution === "pending" && (
                  <div className="flex gap-2 sm:flex-col sm:items-end shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
                      onClick={() => resolveMutation.mutate({ id: conflict.id, resolution: "kept-internal" })}
                      disabled={resolveMutation.isPending}
                      data-testid={`btn-keep-ours-${conflict.id}`}
                    >
                      Keep Ours
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
                      onClick={() => resolveMutation.mutate({ id: conflict.id, resolution: "kept-ghl" })}
                      disabled={resolveMutation.isPending}
                      data-testid={`btn-keep-ghl-${conflict.id}`}
                    >
                      Keep GHL
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

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

interface RecentSend {
  action: string;
  channel: string;
  entityId: number | null;
  sentAt: string;
}

interface SendMonitoringData {
  identities: SendMonitoringIdentity[];
  aggregated: {
    totalIdentities: number;
    activeIdentities: number;
    totalSentToday: number;
    totalDailyLimit: number;
    overallCapUtilization: number;
    smtpFallbacksLast24h?: number;
    ghlSendsLast24h?: number;
  };
  recentSends?: RecentSend[];
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

interface BounceFeedbackIdentity {
  emailAddress: string;
  label: string;
  inboxBouncesToday: number;
}

interface BounceFeedbackSummary {
  contactsWrittenBackToday: number;
  identities: BounceFeedbackIdentity[];
}

function SendMonitoringPanel() {
  const { data, isLoading, isError, refetch } = useQuery<SendMonitoringData>({
    queryKey: ["/api/sdr/operator/send-monitoring"],
    refetchInterval: 15000,
  });

  const { data: bounceFeedback } = useQuery<BounceFeedbackSummary>({
    queryKey: ["/api/sdr/operator/bounce-feedback-summary"],
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Total Identities" value={agg?.totalIdentities || 0} icon={Mail} color="text-blue-600" />
        <KpiCard label="Active" value={agg?.activeIdentities || 0} icon={Activity} color="text-green-600" />
        <KpiCard label="Sent Today" value={agg?.totalSentToday || 0} icon={Send} color="text-purple-600" subtext={`of ${agg?.totalDailyLimit || 0} limit`} />
        <KpiCard label="Cap Used" value={agg?.overallCapUtilization || 0} icon={BarChart3} color="text-orange-600" suffix="%" />
        <KpiCard
          label="Contacts Written Back"
          value={bounceFeedback?.contactsWrittenBackToday ?? 0}
          icon={AlertTriangle}
          color="text-red-600"
          subtext="bounced today (CRM)"
        />
      </div>

      {(agg?.smtpFallbacksLast24h ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3" data-testid="banner-smtp-fallback-warning">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-amber-800 dark:text-amber-300">SMTP Fallback Active: </span>
            <span className="text-amber-700 dark:text-amber-400">
              {agg!.smtpFallbacksLast24h} email{agg!.smtpFallbacksLast24h === 1 ? "" : "s"} delivered via SMTP in the last 24 hours.
              GHL was unavailable for these sends. Check the{" "}
              <a href="/dashboard/operator" className="underline font-medium">Email Health tab</a>.
            </span>
          </div>
        </div>
      )}

      {((agg?.ghlSendsLast24h ?? 0) > 0 || (agg?.smtpFallbacksLast24h ?? 0) > 0) && (
        <Card data-testid="card-channel-breakdown">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Communication Channel (24h)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium text-muted-foreground pb-1.5">Channel</th>
                  <th className="text-right font-medium text-muted-foreground pb-1.5">Sends</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b last:border-0">
                  <td className="py-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                    GHL (all channels)
                  </td>
                  <td className="py-2 text-right font-medium" data-testid="channel-count-ghl">{agg?.ghlSendsLast24h ?? 0}</td>
                </tr>
                <tr>
                  <td className="py-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                    SMTP Fallback
                  </td>
                  <td className="py-2 text-right font-medium" data-testid="channel-count-smtp">{agg?.smtpFallbacksLast24h ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {(data?.recentSends?.length ?? 0) > 0 && (
        <Card data-testid="card-recent-sends">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Recent Sends — Communication Channel</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-xs min-w-[400px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium text-muted-foreground pb-1.5">Type</th>
                  <th className="text-left font-medium text-muted-foreground pb-1.5">Communication Channel</th>
                  <th className="text-right font-medium text-muted-foreground pb-1.5">Time</th>
                </tr>
              </thead>
              <tbody>
                {data!.recentSends!.map((s, idx) => {
                  const channelColor =
                    s.channel === "GHL-Direct" ? "text-green-600 dark:text-green-400" :
                    s.channel === "GHL-Workflow" ? "text-blue-600 dark:text-blue-400" :
                    s.channel === "SMTP-Fallback" ? "text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground";
                  const typeLabel =
                    s.action === "proposal_email_sent" ? "Proposal" :
                    s.action === "merchant_welcome_sent" ? "Merchant Welcome" :
                    s.action === "merchant_portal_welcome_sent" ? "Portal Welcome" :
                    s.action === "co_branded_proposal_sent" ? "Co-Brand Proposal" : s.action;
                  return (
                    <tr key={idx} className="border-b last:border-0" data-testid={`recent-send-${idx}`}>
                      <td className="py-1.5 pr-2 text-muted-foreground">{typeLabel}</td>
                      <td className={`py-1.5 pr-2 font-medium ${channelColor}`}>{s.channel}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{new Date(s.sentAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

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

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm mb-3">
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
                <div>
                  <div className="text-xs text-muted-foreground">Inbox Bounces Today</div>
                  {(() => {
                    const entry = bounceFeedback?.identities?.find(b => b.emailAddress === identity.emailAddress);
                    const count = entry?.inboxBouncesToday ?? 0;
                    return (
                      <div className={`font-medium ${count > 0 ? "text-red-600" : "text-muted-foreground"}`} data-testid={`bounce-contacts-${identity.id}`}>
                        {count}
                      </div>
                    );
                  })()}
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
  ghlSync?: { circuitOpen: boolean; consecutiveFailures: number };
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

      {data.ghlSync?.circuitOpen && (
        <Card className="border-red-500/70 bg-red-500/5" data-testid="card-ghl-circuit-open">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm text-red-700 dark:text-red-400">GHL Sync Circuit Breaker — OPEN</div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.ghlSync.consecutiveFailures} consecutive GHL API failures detected. The sync loop paused to avoid flooding a degraded API.
                It will automatically reset and retry on the next 45-second tick. Refresh GHL credentials if this persists.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
          <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground" data-testid="row-ghl-circuit-state">
            <span className={`w-2 h-2 rounded-full ${data.ghlSync?.circuitOpen ? "bg-red-500" : "bg-green-500"}`} />
            GHL circuit breaker: {data.ghlSync?.circuitOpen
              ? `OPEN (${data.ghlSync.consecutiveFailures} failures — will auto-reset next tick)`
              : "Closed — sync healthy"}
          </div>
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

interface SubjectAuditItem {
  id: number;
  contactId: number;
  dealId: number | null;
  sequenceId: number | null;
  sequenceName: string | null;
  currentStep: number | null;
  status: string;
  nextActionAt: string | null;
  updatedAt: string | null;
  nextStepSubject: string | null;
  nextStepType: string | null;
}

interface SubjectAuditData {
  totalActive: number;
  midSequenceCount: number;
  items: SubjectAuditItem[];
}

function SubjectAuditPanel() {
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<SubjectAuditData>({
    queryKey: ["/api/operator/enrollment-subject-audit"],
    refetchInterval: 60000,
  });

  const retriggerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/operator/enrollment-subject-audit/retrigger", {});
      return res.json();
    },
    onSuccess: (result: { count: number; message: string }) => {
      toast({ title: `Re-triggered ${result.count} enrollment(s)`, description: result.message });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/enrollment-subject-audit"] });
    },
    onError: (err: any) => {
      toast({ title: "Re-trigger failed", description: err.message, variant: "destructive" });
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
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load enrollment audit data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-subject-audit">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const midCount = data?.midSequenceCount ?? 0;

  return (
    <div className="space-y-4">
      <Card className={midCount > 0 ? "border-yellow-500/50 bg-yellow-500/5" : "border-green-500/30 bg-green-500/5"}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Mail className={`w-5 h-5 mt-0.5 ${midCount > 0 ? "text-yellow-600" : "text-green-600"}`} />
              <div>
                <div className="font-medium text-sm" data-testid="text-subject-audit-summary">
                  {midCount > 0
                    ? `${midCount} mid-sequence enrollment${midCount !== 1 ? "s" : ""} may have pending steps with updated subject lines`
                    : "No mid-sequence enrollments — all leads are at step 0 or completed"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {data?.totalActive ?? 0} total active enrollments · {midCount} past step 0 (subject sync relevant)
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Re-triggering bumps <code className="bg-muted px-1 rounded">nextActionAt</code> to now so the sequence worker uses the updated subject on the next tick.
                </div>
              </div>
            </div>
            {midCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-yellow-500/50 text-yellow-700 hover:bg-yellow-500/10"
                disabled={retriggerMutation.isPending}
                onClick={() => retriggerMutation.mutate()}
                data-testid="btn-retrigger-enrollments"
              >
                {retriggerMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-1" />
                )}
                Re-trigger All ({midCount})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mid-Sequence Active Enrollments</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.items?.length ? (
            <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-no-mid-sequence">
              No mid-sequence enrollments found
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left">
                    <th className="py-1 px-2">ID</th>
                    <th className="py-1 px-2">Contact</th>
                    <th className="py-1 px-2">Sequence</th>
                    <th className="py-1 px-2">Step</th>
                    <th className="py-1 px-2">Next Step Type</th>
                    <th className="py-1 px-2">Next Subject</th>
                    <th className="py-1 px-2">Next Action At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(item => (
                    <tr key={item.id} className="border-b hover:bg-muted/30" data-testid={`subject-audit-row-${item.id}`}>
                      <td className="py-1 px-2">{item.id}</td>
                      <td className="py-1 px-2">{item.contactId}</td>
                      <td className="py-1 px-2 max-w-[150px] truncate" title={item.sequenceName ?? undefined}>
                        {item.sequenceName ?? `Seq #${item.sequenceId}`}
                      </td>
                      <td className="py-1 px-2">{item.currentStep}</td>
                      <td className="py-1 px-2">
                        {item.nextStepType ? (
                          <Badge variant="secondary" className="text-xs capitalize">{item.nextStepType}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1 px-2 max-w-[200px] truncate text-muted-foreground" title={item.nextStepSubject ?? undefined}>
                        {item.nextStepSubject ?? <span className="italic">none / non-email step</span>}
                      </td>
                      <td className="py-1 px-2 text-muted-foreground whitespace-nowrap">
                        {item.nextActionAt ? new Date(item.nextActionAt).toLocaleString() : "—"}
                      </td>
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

interface QueueMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  repeatEveryMs: number;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  avgDurationMs: number | null;
  throughputPerHour: number | null;
}

interface DlqItem {
  id: string;
  queueName: string;
  jobName: string;
  failedReason: string;
  attemptsMade: number;
  stacktrace: string[];
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  data: any;
}

interface QueueMetricsData {
  queues: QueueMetric[];
  usingMock: boolean;
}

function formatRepeatInterval(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  return `${ms / 3600000}h`;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function QueueMetricsPanel() {
  const { toast } = useToast();
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);

  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery<QueueMetricsData>({
    queryKey: ["/api/operator/queue-metrics"],
    refetchInterval: 15000,
  });

  const { data: historyData } = useQuery<Record<string, Array<{ label: string; completed: number; failed: number }>>>({
    queryKey: ["/api/operator/queue-history"],
    refetchInterval: 60000,
  });

  const { data: dlqItems, isLoading: dlqLoading, refetch: refetchDlq } = useQuery<DlqItem[]>({
    queryKey: ["/api/operator/queue-dlq"],
    refetchInterval: 30000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/operator/queue-dlq/${encodeURIComponent(id)}/retry`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job requeued for retry" });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/queue-dlq"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/queue-metrics"] });
    },
    onError: (err: any) => toast({ title: "Retry failed", description: err.message, variant: "destructive" }),
  });

  const discardMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/operator/queue-dlq/${encodeURIComponent(id)}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job discarded" });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/queue-dlq"] });
    },
    onError: (err: any) => toast({ title: "Discard failed", description: err.message, variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/operator/queue/${name}/pause`);
      return res.json();
    },
    onSuccess: (_data, name) => {
      toast({ title: `Queue ${name} paused` });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/queue-metrics"] });
    },
    onError: (err: any) => toast({ title: "Failed to pause queue", description: err.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/operator/queue/${name}/resume`);
      return res.json();
    },
    onSuccess: (_data, name) => {
      toast({ title: `Queue ${name} resumed` });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/queue-metrics"] });
    },
    onError: (err: any) => toast({ title: "Failed to resume queue", description: err.message, variant: "destructive" }),
  });

  const totalActive = metrics?.queues.reduce((s, q) => s + q.active, 0) ?? 0;
  const totalWaiting = metrics?.queues.reduce((s, q) => s + q.waiting, 0) ?? 0;
  const totalFailed = metrics?.queues.reduce((s, q) => s + q.failed, 0) ?? 0;

  return (
    <div className="space-y-6">
      {metrics?.usingMock && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md text-sm text-yellow-800 dark:text-yellow-300" data-testid="banner-mock-redis">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Running in dev mode with in-memory queue (no Redis). Set <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">REDIS_URL</code> for production durability.</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card data-testid="card-queue-active">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Active Jobs</span>
            </div>
            <div className="text-2xl font-bold">{totalActive}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-queue-waiting">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Waiting</span>
            </div>
            <div className="text-2xl font-bold">{totalWaiting}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-queue-failed">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Failed (DLQ)</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{totalFailed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Queue Health</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetchMetrics()} data-testid="btn-refresh-queues">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {metricsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-2 px-4 font-medium text-muted-foreground">Queue</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Active</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Waiting</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Failed</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Completed</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Avg Duration</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Rate/hr</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Repeats</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics?.queues || []).map(q => (
                    <tr key={q.name} className={`border-b last:border-0 hover:bg-muted/20 cursor-pointer ${selectedQueue === q.name ? "bg-muted/40" : ""}`} onClick={() => setSelectedQueue(selectedQueue === q.name ? null : q.name)} data-testid={`row-queue-${q.name}`}>
                      <td className="py-2 px-4 font-mono text-xs font-medium">{q.name}</td>
                      <td className="py-2 px-3 text-right">
                        {q.active > 0 ? <Badge variant="default" className="text-xs">{q.active}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">{q.waiting}</td>
                      <td className="py-2 px-3 text-right">
                        {q.failed > 0 ? <span className="text-red-600 text-xs font-medium">{q.failed}</span> : <span className="text-muted-foreground text-xs">0</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">{q.completed}</td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">{formatDurationMs(q.avgDurationMs)}</td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">
                        {q.throughputPerHour !== null ? `${q.throughputPerHour}/hr` : "—"}
                      </td>
                      <td className="py-2 px-3 text-center text-xs text-muted-foreground">every {formatRepeatInterval(q.repeatEveryMs)}</td>
                      <td className="py-2 px-3 text-center">
                        {q.paused ? (
                          <Badge variant="secondary" className="text-xs">Paused</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Active</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {q.paused ? (
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => resumeMutation.mutate(q.name)} data-testid={`btn-resume-queue-${q.name}`}>
                            Resume
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => pauseMutation.mutate(q.name)} data-testid={`btn-pause-queue-${q.name}`}>
                            Pause
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedQueue && historyData && historyData[selectedQueue] && (
        <Card data-testid={`card-queue-history-${selectedQueue}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Job History — <span className="font-mono">{selectedQueue}</span> (last 24h)</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedQueue(null)} aria-label="Close job history chart">
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={historyData[selectedQueue]} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">Hourly event counts since process start. Resets on server restart.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Dead-Letter Queue</CardTitle>
              {(dlqItems?.length ?? 0) > 0 && (
                <Badge variant="destructive" data-testid="badge-dlq-count">{dlqItems!.length}</Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchDlq()} data-testid="btn-refresh-dlq">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {dlqLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !dlqItems || dlqItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground" data-testid="no-dlq-message">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
              <p className="text-sm">No dead-letter jobs — all queues healthy</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dlqItems.map(item => (
                <Card key={item.id} className="border-red-200 dark:border-red-900" data-testid={`dlq-item-${item.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="font-mono text-xs">{item.queueName}</Badge>
                          <Badge variant="destructive" className="text-xs">{item.attemptsMade} attempts</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">{item.failedReason}</p>
                        {item.stacktrace[0] && (
                          <p className="text-xs font-mono text-muted-foreground truncate max-w-lg">{item.stacktrace[0]}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => retryMutation.mutate(item.id)} disabled={retryMutation.isPending} data-testid={`btn-retry-dlq-${item.id}`}>
                          Retry
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => discardMutation.mutate(item.id)} disabled={discardMutation.isPending} data-testid={`btn-discard-dlq-${item.id}`}>
                          Discard
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Queue metrics refresh every 15 seconds</p>
    </div>
  );
}

interface BounceStats {
  windowDays: number;
  emailBounceRate: number;
  smsFailureRate: number;
  emailBouncedTotal: number;
  smsUndeliverableTotal: number;
  unreachableContactCount: number;
  todayFailureEvents: number;
  topFailureReasons: Array<{ reason: string; count: number }>;
}

function BounceFailurePanel() {
  const { data, isLoading, isError, refetch } = useQuery<BounceStats>({
    queryKey: ["/api/operator/bounce-stats"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="bounce-failure-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center py-16 gap-3" data-testid="bounce-failure-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load bounce &amp; failure data</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-bounce-failure">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const bounceRateColor = data.emailBounceRate > 5 ? "text-red-600" : data.emailBounceRate > 2 ? "text-yellow-600" : "text-green-600";
  const smsRateColor = data.smsFailureRate > 10 ? "text-red-600" : data.smsFailureRate > 5 ? "text-yellow-600" : "text-green-600";

  return (
    <div className="space-y-4" data-testid="bounce-failure-panel">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="stat-email-bounced">
          <CardContent className="pt-4 pb-3 text-center">
            <Mail className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <p className={`text-2xl font-bold ${bounceRateColor}`} data-testid="email-bounce-rate">{data.emailBounceRate}%</p>
            <p className="text-xs text-muted-foreground">Email Bounce Rate ({data.windowDays}d)</p>
            <p className="text-xs text-muted-foreground mt-0.5">{data.emailBouncedTotal} total contacts</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-sms-undeliverable">
          <CardContent className="pt-4 pb-3 text-center">
            <MessageSquare className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <p className={`text-2xl font-bold ${smsRateColor}`} data-testid="sms-failure-rate">{data.smsFailureRate}%</p>
            <p className="text-xs text-muted-foreground">SMS Failure Rate ({data.windowDays}d)</p>
            <p className="text-xs text-muted-foreground mt-0.5">{data.smsUndeliverableTotal} total contacts</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-unreachable">
          <CardContent className="pt-4 pb-3 text-center">
            <Phone className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <p className={`text-2xl font-bold ${data.unreachableContactCount > 0 ? "text-red-600" : "text-green-600"}`} data-testid="unreachable-count">{data.unreachableContactCount}</p>
            <p className="text-xs text-muted-foreground">Unreachable (auto-paused)</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-today-events">
          <CardContent className="pt-4 pb-3 text-center">
            <Activity className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold" data-testid="today-failure-events">{data.todayFailureEvents}</p>
            <p className="text-xs text-muted-foreground">Failures Today</p>
          </CardContent>
        </Card>
      </div>

      {data.topFailureReasons.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Top Failure Reasons (Last {data.windowDays} Days — failures only)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="failure-reasons-list">
              {data.topFailureReasons.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid={`failure-reason-${idx}`}>
                  <div className="flex-1 text-sm capitalize">{item.reason.replace(/_/g, " ")}</div>
                  <div className="w-32 bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{ width: `${Math.min(100, (item.count / (data.topFailureReasons[0]?.count || 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground w-8 text-right">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.topFailureReasons.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto text-green-500 mb-2" />
            <p className="text-sm text-muted-foreground">No communication failures in the last 7 days.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface CommHealthData {
  smtp: { configured: boolean; host: string | null; port: number; user: string | null; from: string | null };
  ghl: { emailConfigured: boolean; fullyConfigured: boolean };
  proposalAutoSend: boolean;
  warnings: string[];
  allHealthy: boolean;
}

function CommHealthPanel() {
  const { toast } = useToast();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<CommHealthData>({
    queryKey: ["/api/operator/communications-health"],
    refetchInterval: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/settings/proposal-auto-send", { enabled });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/operator/communications-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/proposal-auto-send"] });
      toast({
        title: result.enabled ? "Auto-Send Enabled" : "Auto-Send Disabled",
        description: result.enabled
          ? "Proposals will be automatically emailed to merchants after generation."
          : "Proposals will be held for rep review before sending.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <AlertTriangle className="w-7 h-7 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load communications health.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-comm-health">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const StatusRow = ({
    label, ok, detail, testId,
  }: { label: string; ok: boolean; detail?: string; testId?: string }) => (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0" data-testid={testId}>
      {ok
        ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
        : <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
      <Badge variant={ok ? "default" : "destructive"} className="text-xs shrink-0">
        {ok ? "OK" : "Not Set"}
      </Badge>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="panel-comm-health">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Communications Health</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Email routing status and auto-send configuration for this system.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="btn-refresh-comm-health"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-1" data-testid="comm-health-warnings">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">{w}</p>
            </div>
          ))}
        </div>
      )}

      <Card data-testid="card-comm-channels">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Channel Status</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <StatusRow
            label="SMTP Direct Email"
            ok={data.smtp.configured}
            detail={data.smtp.configured
              ? `Host: ${data.smtp.host}  ·  Port: ${data.smtp.port}  ·  User: ${data.smtp.user}`
              : "Set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable direct email fallback"}
            testId="row-smtp-status"
          />
          <StatusRow
            label="GHL Email (primary)"
            ok={data.ghl.emailConfigured}
            detail={data.ghl.emailConfigured
              ? `GHL integration active · Full SDR: ${data.ghl.fullyConfigured ? "Yes" : "Partial"}`
              : "Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID to enable GHL email"}
            testId="row-ghl-email-status"
          />
        </CardContent>
      </Card>

      <Card data-testid="card-proposal-auto-send">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Proposal Auto-Send</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium">{data.proposalAutoSend ? "Auto-Send ON" : "Hold for Review (OFF)"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.proposalAutoSend
                  ? "Proposals are automatically emailed to merchants when generated."
                  : "Proposals are generated but held until a rep manually approves sending."}
              </p>
            </div>
            <Button
              variant={data.proposalAutoSend ? "default" : "outline"}
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => toggleMutation.mutate(!data.proposalAutoSend)}
              disabled={toggleMutation.isPending}
              data-testid="button-toggle-auto-send-health"
            >
              {toggleMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : data.proposalAutoSend ? (
                <Send className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              {data.proposalAutoSend ? "Disable Auto-Send" : "Enable Auto-Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GhlConnectionPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [failedOpsOpen, setFailedOpsOpen] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<{
    connected: boolean;
    status: "ok" | "expired" | "unconfigured";
    latencyMs: number;
    locationName?: string;
    error?: string;
    failureCount: number;
    lastSync: string | null;
    checkedAt?: string;
    cached?: boolean;
  }>({
    queryKey: ["/api/admin/ghl-health"],
    refetchInterval: 60_000,
    retry: false,
    staleTime: 25_000,
  });

  const { data: auditData, refetch: refetchAudit } = useQuery<{
    logs: Array<{
      id: number;
      action: string;
      entityType: string;
      entityKey?: string;
      entityId?: number | null;
      details?: any;
      createdAt?: string;
    }>;
  }>({
    queryKey: ["/api/admin/ghl-failures"],
    retry: false,
    staleTime: 30_000,
  });

  const failedOps = auditData?.logs || [];

  async function handleRetry(op: { id: number; entityId?: number | null; entityKey?: string }) {
    if (!op.entityId) {
      toast({ title: "Cannot retry", description: "No contact ID available for this log entry.", variant: "destructive" });
      return;
    }
    setRetryingId(op.id);
    try {
      const res = await apiRequest("POST", "/api/admin/ghl-sync/retry", { contactId: op.entityId });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || "Retry failed");
      toast({ title: "GHL sync re-triggered", description: `Contact ${op.entityKey || op.entityId} queued for re-sync.` });
      refetchAudit();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl-health"] });
    } catch (err: any) {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-4 mt-4" data-testid="panel-ghl-connection">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">GHL Connection Status</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live connectivity check to GoHighLevel. Refreshes every 60 seconds. Results are cached 30s server-side.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl-health"] });
            refetch();
          }}
          disabled={isFetching}
          data-testid="button-refresh-ghl-health"
          aria-label="Refresh GHL health"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Failed to load GHL health.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-ghl-status">
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Status</p>
              {(() => {
                const triState =
                  data.status === "ok" && (data.failureCount ?? 0) === 0 ? "ok" :
                  data.status === "ok" ? "degraded" : "down";
                return (
                  <>
                    {triState === "ok" && (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-semibold text-sm">Connected</span>
                      </div>
                    )}
                    {triState === "degraded" && (
                      <div className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="font-semibold text-sm">Degraded</span>
                      </div>
                    )}
                    {triState === "down" && (
                      <div className="flex items-center gap-2 text-destructive">
                        <XCircle className="w-5 h-5" />
                        <span className="font-semibold text-sm capitalize">{data.status}</span>
                      </div>
                    )}
                    {triState === "degraded" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                        {data.failureCount} sync failure{data.failureCount !== 1 ? "s" : ""} in last 24h
                      </p>
                    )}
                  </>
                );
              })()}
              {data.error && data.status !== "ok" && <p className="text-xs text-destructive/80 mt-1">{data.error}</p>}
              {data.checkedAt && (
                <p className="text-xs text-muted-foreground mt-auto">
                  Checked: {new Date(data.checkedAt).toLocaleTimeString()}
                  {data.cached && <span className="ml-1 opacity-60">(cached)</span>}
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-ghl-latency">
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Latency</p>
              <p className="text-2xl font-bold tabular-nums">
                {data.latencyMs ?? "—"}
                <span className="text-sm font-normal text-muted-foreground ml-1">ms</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {data.latencyMs == null ? "—" : data.latencyMs < 500 ? "Good" : data.latencyMs < 1500 ? "Moderate" : "Slow"}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-ghl-last-sync">
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Last Successful Sync</p>
              <p className="text-sm font-medium">
                {data.lastSync ? new Date(data.lastSync).toLocaleString() : "No data yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.lastSync ? "Last recorded successful GHL sync" : "Sync audit logs not yet written"}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-ghl-failure-count">
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Failures (24h)</p>
              <p className={`text-2xl font-bold tabular-nums ${(data.failureCount ?? 0) > 0 ? "text-destructive" : "text-green-600"}`}>
                {data.failureCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                {(data.failureCount ?? 0) === 0 ? "No failures detected" : "Failed GHL sync operations"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div data-testid="section-ghl-failed-ops">
        <button
          type="button"
          onClick={() => setFailedOpsOpen(v => !v)}
          className="w-full flex items-center justify-between py-2 px-0 text-left group"
          data-testid="button-toggle-failed-ops"
          aria-expanded={failedOpsOpen}
        >
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Failed GHL Operations (Last 24h)
            {failedOps.length > 0 && (
              <Badge variant="destructive" className="text-xs ml-1">{failedOps.length}</Badge>
            )}
          </h4>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${failedOpsOpen ? "rotate-180" : ""}`} />
        </button>

        {failedOpsOpen && (
          failedOps.length === 0 ? (
            <Card data-testid="card-no-ghl-failures">
              <CardContent className="py-8 text-center">
                <CheckCircle2 className="w-7 h-7 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium">No GHL sync failures in the last 24 hours</p>
                <p className="text-xs text-muted-foreground mt-1">All GHL operations are succeeding.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-ghl-failures">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Contact / Key</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Operation</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Error</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">When</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedOps.slice(0, 25).map(f => (
                        <tr key={f.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-ghl-failure-${f.id}`}>
                          <td className="px-4 py-2 font-medium">{f.entityKey || `ID ${f.entityId}` || "—"}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">{f.action}</Badge>
                          </td>
                          <td className="px-4 py-2 max-w-xs">
                            <span
                              className="truncate block max-w-xs text-destructive/80"
                              title={typeof f.details === "string" ? f.details : JSON.stringify(f.details)}
                            >
                              {typeof f.details === "object" && f.details !== null
                                ? (f.details.error || f.details.message || JSON.stringify(f.details).slice(0, 80))
                                : String(f.details || "—")}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                            {f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              disabled={retryingId === f.id || !f.entityId}
                              onClick={() => handleRetry(f)}
                              data-testid={`button-retry-ghl-${f.id}`}
                              aria-label={`Retry GHL sync for ${f.entityKey || f.entityId}`}
                            >
                              {retryingId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}

interface DeletedRecord {
  id: number;
  entityType: string | null;
  entityId: number | null;
  entityKey: string | null;
  action: string;
  details: any;
  createdAt: string | null;
}

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
  ghl_delete_propagated: { label: "Sent to GHL", variant: "default" },
  ghl_delete_received: { label: "Received from GHL", variant: "secondary" },
  ghl_delete_detected: { label: "Detected by sync", variant: "outline" },
  ghl_delete_failed: { label: "Delete Failed", variant: "destructive" },
};

function DeletedRecordsPanel() {
  const { data, isLoading, isError, refetch } = useQuery<{ records: DeletedRecord[]; total: number }>({
    queryKey: ["/api/ghl/deleted-records"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/deleted-records?limit=50", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deleted records");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading deleted records…</span>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive text-sm">Failed to load deleted records.</p>
        </CardContent>
      </Card>
    );
  }

  const records = data?.records ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <XCircle className="w-4 h-4 text-destructive" />
            Deleted Records
            <Badge variant="outline" className="ml-1 text-xs">{records.length}</Badge>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-deleted-records" aria-label="Refresh deleted records">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {records.length === 0 ? (
            <div className="px-6 py-8 text-center text-muted-foreground text-sm" data-testid="text-no-deleted-records">
              No deleted records logged yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-deleted-records">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Entity</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name / Key</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">GHL ID</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Event</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Source</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Direction</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">When</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => {
                    const details = typeof r.details === "object" && r.details !== null ? r.details : {};
                    const direction = details.direction || "—";
                    const source = details.source || (direction === "replit_to_ghl" ? "replit" : "—");
                    const ghlId = details.ghlContactId || details.ghlOpportunityId || details.ghlTaskId || "—";
                    const meta = ACTION_LABELS[r.action] || { label: r.action, variant: "outline" as const };
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-deleted-record-${r.id}`}>
                        <td className="px-4 py-2 capitalize font-medium">{r.entityType || "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate">
                          {r.entityKey || (r.entityId ? `#${r.entityId}` : "—")}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono max-w-[120px] truncate" title={ghlId} data-testid={`text-ghl-id-${r.id}`}>
                          {ghlId}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={meta.variant} className="text-xs">{meta.label}</Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground capitalize" data-testid={`text-source-${r.id}`}>
                          {source === "webhook" ? "Webhook" : source === "sync_tick" ? "Sync tick" : source === "replit" ? "Replit" : source}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {direction === "replit_to_ghl" ? "Replit → GHL" : direction === "ghl_to_replit" ? "GHL → Replit" : direction}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                          {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><strong>Replit → GHL:</strong> Archiving a contact or deal, or deleting a task, automatically sends a DELETE request to GHL so the record disappears from both systems.</p>
          <p><strong>GHL → Replit:</strong> When GHL fires a ContactDelete, OpportunityDelete, or TaskDelete webhook, the local record is soft-deleted (archived) instantly.</p>
          <p><strong>Sync-tick fallback:</strong> Set <code className="bg-muted px-1 rounded">GHL_SYNC_DELETE_DETECTION=true</code> to detect contacts that vanish from GHL between webhooks and soft-delete them automatically.</p>
        </CardContent>
      </Card>
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
          <TabsTrigger value="queue-metrics" data-testid="tab-queue-metrics" className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" />
            Job Queue
          </TabsTrigger>
          <TabsTrigger value="readiness" data-testid="tab-readiness">Readiness</TabsTrigger>
          <TabsTrigger value="kpis" data-testid="tab-kpis">KPIs</TabsTrigger>
          <TabsTrigger value="recent-sends" data-testid="tab-recent-sends">Recent Sends</TabsTrigger>
          <TabsTrigger value="silent-sequences" data-testid="tab-silent-sequences">Sequences Not Firing</TabsTrigger>
          <TabsTrigger value="send-monitoring" data-testid="tab-send-monitoring">Send Monitoring</TabsTrigger>
          <TabsTrigger value="webhook-events" data-testid="tab-webhook-events">Webhook Events</TabsTrigger>
          <TabsTrigger value="stuck-leads" data-testid="tab-stuck-leads">Stuck Leads</TabsTrigger>
          <TabsTrigger value="low-confidence" data-testid="tab-low-confidence">Low Confidence</TabsTrigger>
          <TabsTrigger value="sync-conflicts" data-testid="tab-sync-conflicts" className="flex items-center gap-1">
            <GitMerge className="w-3 h-3" /> Sync Conflicts
          </TabsTrigger>
          <TabsTrigger value="content-organic" data-testid="tab-content-organic">Content & Organic</TabsTrigger>
          <TabsTrigger value="ai-health" data-testid="tab-ai-health" className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> AI Health
          </TabsTrigger>
          <TabsTrigger value="ai-activity" data-testid="tab-ai-activity">AI Activity</TabsTrigger>
          <TabsTrigger value="subject-audit" data-testid="tab-subject-audit" className="flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> Subject Sync
          </TabsTrigger>
          <TabsTrigger value="vertical-coverage" data-testid="tab-vertical-coverage" className="flex items-center gap-1">
            <BarChart3 className="w-3.5 h-3.5" /> Vertical Coverage
          </TabsTrigger>
          <TabsTrigger value="statement-upload" data-testid="tab-statement-upload" className="flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Upload Failures
          </TabsTrigger>
          <TabsTrigger value="bounce-failure" data-testid="tab-bounce-failure" className="flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" /> Bounce &amp; Failure
          </TabsTrigger>
          <TabsTrigger value="comm-health" data-testid="tab-comm-health" className="flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> Email Health
          </TabsTrigger>
          <TabsTrigger value="registry-import" data-testid="tab-registry-import" className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5" /> Registry Import
          </TabsTrigger>
          <TabsTrigger value="ghl-connection" data-testid="tab-ghl-connection" className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> GHL Status
          </TabsTrigger>
          <TabsTrigger value="deleted-records" data-testid="tab-deleted-records" className="flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" /> Deleted Records
          </TabsTrigger>
          <TabsTrigger value="conversion" data-testid="tab-conversion" className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> Conversion
          </TabsTrigger>
        </TabsList>

        <TabsContent value="job-health">
          <JobHealthPanel />
        </TabsContent>
        <TabsContent value="queue-metrics">
          <QueueMetricsPanel />
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
        <TabsContent value="sync-conflicts">
          <SyncConflictsPanel />
        </TabsContent>
        <TabsContent value="content-organic">
          <ContentOrganicKpiPanel />
        </TabsContent>
        <TabsContent value="ai-health">
          <AiHealthPanel />
        </TabsContent>
        <TabsContent value="ai-activity">
          <AiActivityPanel />
        </TabsContent>
        <TabsContent value="subject-audit">
          <SubjectAuditPanel />
        </TabsContent>
        <TabsContent value="vertical-coverage">
          <VerticalCoveragePanel />
        </TabsContent>
        <TabsContent value="statement-upload">
          <StatementUploadFailuresPanel />
        </TabsContent>
        <TabsContent value="bounce-failure">
          <BounceFailurePanel />
        </TabsContent>
        <TabsContent value="comm-health">
          <CommHealthPanel />
        </TabsContent>
        <TabsContent value="registry-import">
          <RegistryImportPanel />
        </TabsContent>
        <TabsContent value="ghl-connection">
          <GhlConnectionPanel />
        </TabsContent>
        <TabsContent value="deleted-records">
          <DeletedRecordsPanel />
        </TabsContent>
        <TabsContent value="conversion">
          <ConversionPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ImportHistoryRow {
  import_id: string;
  source: string;
  state: string;
  total: string;
  matched: string;
  unmatched: string;
  skipped: string;
  created_at: string;
}

interface ImportSummary {
  importId: string;
  total: number;
  matched: number;
  updated: number;
  unmatched: number;
  skipped: number;
}

const PRIORITY_STATES = ["FL", "TX", "CA", "NY", "GA", "NC", "AZ", "IL"];
const LICENSE_BOARD_TYPES = ["dental", "medical", "cosmetology", "veterinary"];

const MAPPING_FIELD_LABELS: Record<string, string> = {
  businessName: "Business Name",
  legalName: "Legal Name",
  ownerFirstName: "Owner First Name",
  ownerLastName: "Owner Last Name",
  ownerName: "Owner Full Name",
  formationDate: "Formation / License Date",
  address: "Street Address",
  city: "City",
  state: "State",
  zip: "ZIP Code",
  phone: "Phone",
  licenseNumber: "License Number",
};

type ColumnMapping = Record<string, string>;

function RegistryImportPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<"registry" | "license">("registry");
  const [state, setState] = useState("FL");
  const [subType, setSubType] = useState("dental");
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [mappingLoaded, setMappingLoaded] = useState(false);

  const { data: allMappings } = useQuery<{ registryMappings: Record<string, ColumnMapping>; licenseMappings: Record<string, ColumnMapping>; states: string[]; licenseBoardTypes: string[] }>({
    queryKey: ["/api/admin/registry-import/mappings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/registry-import/mappings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mappings");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!allMappings) return;
    let defaultMapping: ColumnMapping = {};
    if (sourceType === "registry") {
      defaultMapping = allMappings.registryMappings[state] || {};
    } else {
      defaultMapping = allMappings.licenseMappings[subType] || {};
    }
    setColumnMapping({ ...defaultMapping });
    setMappingLoaded(true);
  }, [sourceType, state, subType, allMappings]);

  const { data: history = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery<ImportHistoryRow[]>({
    queryKey: ["/api/admin/registry-import/history"],
    queryFn: async () => {
      const res = await fetch("/api/admin/registry-import/history", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch import history");
      return res.json();
    },
  });

  const handleUpload = async () => {
    if (!file) {
      toast({ title: "No file selected", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sourceType", sourceType);
      formData.append("state", state);
      if (sourceType === "license") formData.append("subType", subType);
      formData.append("columnMapping", JSON.stringify(columnMapping));

      const res = await fetch("/api/admin/registry-import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");

      setLastSummary(data.summary);
      toast({ title: "Import complete", description: data.message });
      refetchHistory();
      setFile(null);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const mappingEntries = Object.entries(MAPPING_FIELD_LABELS);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Bulk Registry & License Board Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Upload state business registry CSVs or professional license board exports to enrich
            merchant records with legal names, owner names, formation dates, and license numbers.
            Matching uses fuzzy name similarity + address + phone fallback.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Source Type</label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as "registry" | "license")} data-testid="select-source-type">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="registry">State Business Registry</SelectItem>
                  <SelectItem value="license">Professional License Board</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">State</label>
              <Select value={state} onValueChange={setState} data-testid="select-state">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  <SelectItem value="OTHER">Other (custom mapping)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceType === "license" && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Board Type</label>
                <Select value={subType} onValueChange={setSubType} data-testid="select-sub-type">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSE_BOARD_TYPES.map((b) => (
                      <SelectItem key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">CSV File</label>
            <div className="flex items-center gap-3">
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="max-w-sm"
                data-testid="input-registry-csv"
              />
              {file && (
                <span className="text-sm text-muted-foreground">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Column Mapping</label>
              <span className="text-xs text-muted-foreground">Edit CSV header names to match your export</span>
            </div>
            <div className="border rounded-md overflow-hidden" data-testid="column-mapping-editor">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground w-1/2">Target Field</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground w-1/2">CSV Column Header</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingEntries.map(([fieldKey, fieldLabel]) => (
                    <tr key={fieldKey} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 px-3 text-xs text-muted-foreground font-medium">{fieldLabel}</td>
                      <td className="py-1 px-2">
                        <Input
                          value={columnMapping[fieldKey] || ""}
                          onChange={(e) => setColumnMapping((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                          placeholder={`leave blank to skip`}
                          className="h-7 text-xs font-mono"
                          data-testid={`mapping-input-${fieldKey}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingLoaded && (
              <p className="text-xs text-muted-foreground">Loading default mapping…</p>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || isUploading}
            data-testid="button-run-registry-import"
          >
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Run Import
          </Button>
        </CardContent>
      </Card>

      {lastSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last Import Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: "Total Rows", value: lastSummary.total, color: "text-blue-600" },
                { label: "Matched", value: lastSummary.matched, color: "text-green-600" },
                { label: "Updated", value: lastSummary.updated, color: "text-emerald-600" },
                { label: "Unmatched", value: lastSummary.unmatched, color: "text-orange-600" },
                { label: "Skipped", value: lastSummary.skipped, color: "text-gray-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center p-3 rounded border" data-testid={`stat-${label.toLowerCase().replace(" ", "-")}`}>
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Import ID: <code className="bg-muted px-1 rounded">{lastSummary.importId}</code> — Unmatched rows are stored in the import log for review.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Import History</span>
            <Button variant="outline" size="sm" onClick={() => refetchHistory()} data-testid="button-refresh-history">
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No imports yet. Upload a CSV above to get started.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Source</th>
                    <th className="text-left py-2 px-3">State</th>
                    <th className="text-right py-2 px-3">Total</th>
                    <th className="text-right py-2 px-3">Matched</th>
                    <th className="text-right py-2 px-3">Unmatched</th>
                    <th className="text-right py-2 px-3">Skipped</th>
                    <th className="text-right py-2 px-3">Match Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const total = parseInt(row.total) || 0;
                    const matched = parseInt(row.matched) || 0;
                    const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;
                    return (
                      <tr key={row.import_id} className="border-b hover:bg-muted/50" data-testid={`row-import-${row.import_id}`}>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={row.source === "registry" ? "default" : "secondary"} className="text-xs">
                            {row.source}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 font-mono text-xs">{row.state}</td>
                        <td className="py-2 px-3 text-right">{row.total}</td>
                        <td className="py-2 px-3 text-right text-green-600 font-medium">{row.matched}</td>
                        <td className="py-2 px-3 text-right text-orange-600">{row.unmatched}</td>
                        <td className="py-2 px-3 text-right text-gray-500">{row.skipped}</td>
                        <td className="py-2 px-3 text-right">
                          <Badge variant={matchRate >= 50 ? "default" : matchRate >= 20 ? "secondary" : "destructive"} className="text-xs">
                            {matchRate}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface VerticalCoverageRow {
  id: number;
  sequenceName: string;
  vertical: string;
  sequenceType: string;
  sequenceStatus: string;
  totalSteps: number;
  enrolled: number;
  step1Complete: number;
  step3Complete: number;
  completed: number;
  conversionRate: number;
  lastEnrolledAt: string | null;
  daysSinceEnrollment: number | null;
}

function VerticalCoveragePanel() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading, isError, refetch } = useQuery<VerticalCoverageRow[]>({
    queryKey: ["/api/sequences/vertical-coverage"],
    queryFn: async () => {
      const res = await fetch("/api/sequences/vertical-coverage", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vertical coverage data");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/sequences/${id}/toggle-status`, { method: "PUT", credentials: "include" });
      if (!res.ok) throw new Error("Failed to toggle sequence status");
      return res.json();
    },
    onSuccess: (updated: any) => {
      toast({ title: `Sequence ${updated.status}`, description: `"${updated.name}" is now ${updated.status}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences/vertical-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
    onError: (err: Error) => toast({ title: "Toggle failed", description: err.message, variant: "destructive" }),
  });

  const filtered = rows.filter((r) =>
    r.vertical.toLowerCase().includes(search.toLowerCase()) ||
    r.sequenceType.toLowerCase().includes(search.toLowerCase())
  );

  const zeroEnrollment = filtered.filter((r) => r.enrolled === 0);
  const staleSequences = filtered.filter((r) => r.sequenceStatus === "active" && r.daysSinceEnrollment !== null && r.daysSinceEnrollment >= 7);
  const hasData = rows.length > 0;

  function exportCsv() {
    const headers = ["Vertical", "Sequence Type", "Status", "Steps", "Enrolled", "Step 1 ✓", "Step 3 ✓", "Completed", "Conv. Rate %"];
    const csvRows = [
      headers.join(","),
      ...filtered.map((r) =>
        [
          `"${r.vertical}"`,
          `"${r.sequenceType}"`,
          r.sequenceStatus,
          r.totalSteps,
          r.enrolled,
          r.step1Complete,
          r.step3Complete,
          r.completed,
          r.conversionRate,
        ].join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vertical-coverage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${filtered.length} rows exported.` });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3" data-testid="vertical-coverage-error">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-muted-foreground">Failed to load vertical coverage data.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-vertical-coverage">
          <RefreshCw className="w-4 h-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4" data-testid="vertical-coverage-panel">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold">Vertical Sequence Coverage</h2>
          <p className="text-sm text-muted-foreground">
            Enrollment stats per sequence — spot zero-enrollment verticals and step drop-off at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-vertical-coverage" aria-label="Refresh">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="button-export-vertical-coverage" disabled={filtered.length === 0}>
            <ArrowUpRight className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {zeroEnrollment.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {zeroEnrollment.length} sequence{zeroEnrollment.length > 1 ? "s" : ""} with zero enrollments
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Auto-tagging may not be firing for: {zeroEnrollment.slice(0, 5).map((r) => r.vertical).join(", ")}
                  {zeroEnrollment.length > 5 ? ` +${zeroEnrollment.length - 5} more` : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {staleSequences.length > 0 && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-700">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                  {staleSequences.length} active sequence{staleSequences.length > 1 ? "s" : ""} with no new enrollments in 7+ days
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-400 mt-0.5">
                  {staleSequences.slice(0, 3).map((r) => `${r.vertical} (${r.daysSinceEnrollment}d ago)`).join(", ")}
                  {staleSequences.length > 3 ? ` +${staleSequences.length - 3} more` : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">{rows.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Sequences</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold">{rows.reduce((s, r) => s + r.enrolled, 0).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Enrolled</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold text-amber-600">{zeroEnrollment.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Zero-Enrollment</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-2xl font-bold text-green-600">{rows.reduce((s, r) => s + r.completed, 0).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Completed</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by vertical or type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm text-sm"
          data-testid="input-vertical-coverage-search"
        />
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")} data-testid="button-clear-vertical-search" aria-label="Clear search">
            <XCircle className="w-4 h-4" />
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="vertical-coverage-empty">
          {rows.length === 0 ? "No sequences found in database." : "No sequences match your filter."}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-vertical-coverage">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Vertical</th>
                  <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Sequence Type</th>
                  <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Enrolled</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Step 1 ✓</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Step 3 ✓</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Completed</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Conv. Rate</th>
                  <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Last Enrolled</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    data-testid={`row-vertical-coverage-${row.id}`}
                  >
                    <td className="py-2.5 px-3 font-medium max-w-[180px]">
                      <span className="truncate block" title={row.vertical}>{row.vertical}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground max-w-[160px]">
                      <span className="truncate block text-xs" title={row.sequenceType}>{row.sequenceType || "—"}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          row.sequenceStatus === "active"
                            ? "border-green-500 text-green-700 dark:text-green-400"
                            : "border-muted text-muted-foreground"
                        }`}
                        data-testid={`status-vertical-${row.id}`}
                      >
                        {row.sequenceStatus}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`font-medium ${row.enrolled === 0 ? "text-amber-600" : ""}`} data-testid={`enrolled-vertical-${row.id}`}>
                        {row.enrolled.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted-foreground" data-testid={`step1-vertical-${row.id}`}>
                      {row.enrolled > 0 ? (
                        <>
                          {row.step1Complete.toLocaleString()}
                          <span className="text-xs ml-1">({row.enrolled > 0 ? Math.round((row.step1Complete / row.enrolled) * 100) : 0}%)</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted-foreground" data-testid={`step3-vertical-${row.id}`}>
                      {row.enrolled > 0 ? (
                        <>
                          {row.step3Complete.toLocaleString()}
                          <span className="text-xs ml-1">({row.enrolled > 0 ? Math.round((row.step3Complete / row.enrolled) * 100) : 0}%)</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right" data-testid={`completed-vertical-${row.id}`}>
                      {row.completed.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right" data-testid={`conv-rate-vertical-${row.id}`}>
                      {row.enrolled === 0 ? (
                        <span className="text-muted-foreground/50">—</span>
                      ) : (
                        <span className={`font-medium ${row.conversionRate >= 10 ? "text-green-600 dark:text-green-400" : row.conversionRate > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                          {row.conversionRate}%
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-xs text-muted-foreground whitespace-nowrap" data-testid={`last-enrolled-vertical-${row.id}`}>
                      {row.lastEnrolledAt ? (
                        <span className={row.daysSinceEnrollment !== null && row.daysSinceEnrollment >= 7 && row.sequenceStatus === "active" ? "text-orange-600 dark:text-orange-400 font-medium" : ""}>
                          {row.daysSinceEnrollment === 0 ? "today" : row.daysSinceEnrollment === 1 ? "1d ago" : `${row.daysSinceEnrollment}d ago`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">never</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        size="sm"
                        variant={row.sequenceStatus === "active" ? "outline" : "default"}
                        className={`text-xs h-7 px-2 ${row.sequenceStatus === "active" ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/20" : "bg-green-600 hover:bg-green-700 text-white"}`}
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate(row.id)}
                        data-testid={`button-toggle-sequence-${row.id}`}
                        aria-label={row.sequenceStatus === "active" ? "Pause sequence" : "Activate sequence"}
                      >
                        {row.sequenceStatus === "active" ? "Pause" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-xs text-muted-foreground text-right">
        Showing {filtered.length} of {rows.length} sequences · Auto-refreshes every 60s
      </p>
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
  "chargeback-copilot": "Chargeback Copilot",
  "auto-reply": "Auto Reply",
  "content-generation": "Content Generation",
  "social-generation": "Social Generation",
  "training-generation": "Training Generation",
};

interface AiHealthMetrics {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  completionRate: number;
  avgLatencyMs: number;
  avgConfidenceScore: number;
  flaggedCount: number;
  flaggedRate: number;
  topErrors: Array<{ error: string; count: number }>;
  byTriggerType: Record<string, {
    calls: number; errors: number; avgConfidence: number; avgLatencyMs: number; flagged: number;
  }>;
  confidenceDistribution: { high: number; medium: number; low: number };
  totalCostCents: number;
  todayCostCents: number;
  monthCostCents: number;
  dailyRollup: Array<{ date: string; calls: number; costCents: number; promptTokens: number; completionTokens: number }>;
  confidenceThreshold: number;
}

function ConfidenceBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(score * 100);
  if (pct >= 75) return <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{pct}%</Badge>;
  if (pct >= 50) return <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{pct}%</Badge>;
  return <Badge variant="destructive" className="text-xs">{pct}%</Badge>;
}

interface ReplayResult {
  originalResponse: string | null;
  newResponse: string;
  originalLogId: number;
  model: string;
  durationMs: number;
  diff: { changed: boolean; originalLength: number; newLength: number };
}

interface AiLogDetail {
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
  promptHash: string | null;
  confidenceScore: number | null;
  flagged: boolean | null;
  rawPrompt: string | null;
  rawResponse: string | null;
  createdAt: string;
}

function AiLogDetailModal({ logId, open, onClose }: { logId: number | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);

  const { data: log, isLoading } = useQuery<AiLogDetail>({
    queryKey: ["/api/operator/ai-audit", logId],
    queryFn: () => fetch(`/api/operator/ai-audit/${logId}`, { credentials: "include" }).then(r => r.json()),
    enabled: open && logId != null,
  });

  async function handleReplay() {
    if (!logId) return;
    setReplaying(true);
    setReplayResult(null);
    try {
      const res = await apiRequest("POST", `/api/operator/ai-audit/${logId}/replay`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Replay failed");
      setReplayResult(data);
      toast({ title: "Replay complete", description: data.diff.changed ? "Response differs from original." : "Response matches original." });
    } catch (err: any) {
      toast({ title: "Replay failed", description: err.message, variant: "destructive" });
    } finally {
      setReplaying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setReplayResult(null); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-ai-log-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            AI Audit Log #{logId}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !log ? (
          <div className="text-center py-8 text-muted-foreground">Log not found</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Trigger</div>
                <div className="font-medium">{AI_TRIGGER_LABELS[log.triggerType] || log.triggerType}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Model</div>
                <div className="font-medium">{log.model}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Confidence</div>
                <div><ConfidenceBadge score={log.confidenceScore} /></div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="font-medium">{log.durationMs ? `${log.durationMs}ms` : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tokens</div>
                <div className="font-medium">{(log.promptTokens + log.completionTokens).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cost</div>
                <div className="font-medium">${(log.costCents / 100).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Prompt Hash</div>
                <div className="font-mono text-xs">{log.promptHash || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Flagged</div>
                <div>
                  {log.flagged
                    ? <Badge variant="destructive" className="text-xs"><Flag className="w-3 h-3 mr-1" />Flagged</Badge>
                    : <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">OK</Badge>}
                </div>
              </div>
            </div>

            {log.error && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-3">
                <div className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Error</div>
                <div className="text-sm text-red-700 dark:text-red-300 font-mono">{log.error}</div>
              </div>
            )}

            {log.rawPrompt && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Raw Prompt</div>
                <Textarea
                  readOnly
                  value={log.rawPrompt}
                  className="font-mono text-xs h-32 resize-none"
                  data-testid="textarea-raw-prompt"
                />
              </div>
            )}

            {log.rawResponse && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Original Response</div>
                <Textarea
                  readOnly
                  value={log.rawResponse}
                  className="font-mono text-xs h-32 resize-none"
                  data-testid="textarea-raw-response"
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleReplay}
                disabled={replaying || !log.rawPrompt}
                variant="outline"
                size="sm"
                data-testid="button-replay-prompt"
                title={!log.rawPrompt ? "No prompt stored for this log entry" : "Re-run this exact prompt"}
              >
                {replaying
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Replaying…</>
                  : <><Play className="w-4 h-4 mr-2" /> Replay Prompt</>}
              </Button>
            </div>

            {replayResult && (
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Replay Result</div>
                  <div className="flex items-center gap-2">
                    {replayResult.diff.changed
                      ? <Badge variant="destructive" className="text-xs">Response Changed</Badge>
                      : <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Matches Original</Badge>}
                    <span className="text-xs text-muted-foreground">{replayResult.durationMs}ms</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">New Response</div>
                  <Textarea
                    readOnly
                    value={replayResult.newResponse}
                    className="font-mono text-xs h-32 resize-none"
                    data-testid="textarea-replay-response"
                  />
                </div>
                {replayResult.diff.changed && (
                  <div className="text-xs text-muted-foreground">
                    Original: {replayResult.diff.originalLength} chars → New: {replayResult.diff.newLength} chars
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AiHealthPanel() {
  const [range, setRange] = useState("7d");

  const { data: metrics, isLoading, isError, refetch } = useQuery<AiHealthMetrics>({
    queryKey: ["/api/operator/ai-health", range],
    queryFn: () => fetch(`/api/operator/ai-health?range=${range}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const pieData = metrics ? [
    { name: "High (≥75%)", value: metrics.confidenceDistribution.high, color: "#22c55e" },
    { name: "Medium (50-74%)", value: metrics.confidenceDistribution.medium, color: "#f59e0b" },
    { name: "Low (<50%)", value: metrics.confidenceDistribution.low, color: "#ef4444" },
  ].filter(d => d.value > 0) : [];

  const triggerRows = metrics
    ? Object.entries(metrics.byTriggerType)
        .sort((a, b) => b[1].calls - a[1].calls)
        .slice(0, 10)
    : [];

  return (
    <div className="space-y-6 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-500" /> AI Health Monitor
        </h3>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[140px]" data-testid="select-health-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-ai-health">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-sm text-muted-foreground">Failed to load AI health metrics</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {metrics && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card data-testid="card-completion-rate">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <CheckCircle2 className="w-3 h-3 text-green-500" /> Completion Rate
                </div>
                <div className="text-2xl font-bold text-green-600" data-testid="text-completion-rate">
                  {metrics.completionRate}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {metrics.successCalls} / {metrics.totalCalls} calls
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-avg-latency">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Clock className="w-3 h-3 text-blue-500" /> Avg Latency
                </div>
                <div className="text-2xl font-bold" data-testid="text-avg-latency">
                  {metrics.avgLatencyMs > 0 ? `${metrics.avgLatencyMs}ms` : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">per call</div>
              </CardContent>
            </Card>
            <Card data-testid="card-avg-confidence">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="w-3 h-3 text-purple-500" /> Avg Confidence
                </div>
                <div className="text-2xl font-bold" data-testid="text-avg-confidence">
                  {metrics.avgConfidenceScore > 0 ? `${Math.round(metrics.avgConfidenceScore * 100)}%` : "—"}
                </div>
                <Progress
                  value={metrics.avgConfidenceScore * 100}
                  className="h-1 mt-2"
                />
              </CardContent>
            </Card>
            <Card data-testid="card-flagged-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Flag className="w-3 h-3 text-red-500" /> Flagged for Review
                </div>
                <div className="text-2xl font-bold text-red-600" data-testid="text-flagged-count">
                  {metrics.flaggedCount}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{metrics.flaggedRate}% of calls</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Confidence Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No confidence data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={180} data-testid="chart-confidence-dist">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: number) => [val, "calls"]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {metrics.topErrors.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Top Error Types</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {metrics.topErrors.map((e, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 text-sm" data-testid={`error-row-${i}`}>
                        <span className="text-muted-foreground text-xs flex-1 truncate" title={e.error}>{e.error}</span>
                        <Badge variant="destructive" className="text-xs shrink-0">{e.count}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card data-testid="card-cost-today">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <DollarSign className="w-3 h-3 text-green-500" /> Cost Today
                </div>
                <div className="text-2xl font-bold" data-testid="text-cost-today">
                  ${((metrics.todayCostCents ?? 0) / 100).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">USD</div>
              </CardContent>
            </Card>
            <Card data-testid="card-cost-month">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <DollarSign className="w-3 h-3 text-blue-500" /> Cost This Month
                </div>
                <div className="text-2xl font-bold" data-testid="text-cost-month">
                  ${((metrics.monthCostCents ?? 0) / 100).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">USD</div>
              </CardContent>
            </Card>
            <Card data-testid="card-confidence-threshold">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <ShieldCheck className="w-3 h-3 text-purple-500" /> Flag Threshold
                </div>
                <div className="text-2xl font-bold" data-testid="text-confidence-threshold">
                  {Math.round((metrics.confidenceThreshold ?? 0.5) * 100)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">min confidence to pass</div>
              </CardContent>
            </Card>
          </div>

          {metrics.dailyRollup && metrics.dailyRollup.some(d => d.calls > 0) && (
            <Card data-testid="card-completions-over-time">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">AI Completions Over Time (Last 30 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={metrics.dailyRollup.slice(-30)} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => v.slice(5)}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(val: number, name: string) => [val, name === "calls" ? "Completions" : "Cost ($)"]}
                      labelFormatter={(label: string) => `Date: ${label}`}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="calls" name="Completions" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {triggerRows.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Per-Trigger Health Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Trigger</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Calls</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Errors</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Confidence</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Latency</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Flagged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {triggerRows.map(([tt, stats]) => (
                        <tr key={tt} className="border-b last:border-0 hover:bg-muted/20" data-testid={`health-row-${tt}`}>
                          <td className="px-4 py-2 text-muted-foreground">{AI_TRIGGER_LABELS[tt] || tt}</td>
                          <td className="px-4 py-2 text-right font-medium">{stats.calls}</td>
                          <td className="px-4 py-2 text-right">
                            {stats.errors > 0
                              ? <span className="text-red-600">{stats.errors}</span>
                              : <span className="text-green-600">0</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <ConfidenceBadge score={stats.avgConfidence} />
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {stats.avgLatencyMs > 0 ? `${stats.avgLatencyMs}ms` : "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {stats.flagged > 0
                              ? <Badge variant="destructive" className="text-xs">{stats.flagged}</Badge>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

interface AiCostSummary {
  summary: {
    todayCostCents: number;
    todayCalls: number;
    monthCostCents: number;
    monthCalls: number;
    rangeCostCents: number;
    rangeCalls: number;
    byTriggerType: Record<string, { calls: number; costCents: number; promptTokens: number; completionTokens: number }>;
  };
  dailyRollup: Array<{ date: string; calls: number; costCents: number; promptTokens: number; completionTokens: number }>;
}

function AiCostPanel() {
  const { data, isLoading } = useQuery<AiCostSummary>({
    queryKey: ["/api/operator/ai-cost-summary"],
    queryFn: () => fetch("/api/operator/ai-cost-summary", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const summary = data?.summary;
  const dailyRollup = data?.dailyRollup || [];

  const chartData = dailyRollup.map(d => ({
    date: d.date.slice(5),
    cost: parseFloat((d.costCents / 100).toFixed(4)),
    calls: d.calls,
  }));

  return (
    <div className="space-y-4 mb-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">AI Cost Overview</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3 h-3 text-green-600" /> Today's Spend
            </div>
            {isLoading ? (
              <div className="h-8 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-today-ai-cost">
                  ${((summary?.todayCostCents || 0) / 100).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{summary?.todayCalls || 0} calls today</div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3 h-3 text-blue-600" /> This Month
            </div>
            {isLoading ? (
              <div className="h-8 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400" data-testid="text-month-ai-cost">
                  ${((summary?.monthCostCents || 0) / 100).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{summary?.monthCalls || 0} calls this month</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            Trigger Type Breakdown (this month)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded m-4" />
          ) : Object.keys(summary?.byTriggerType || {}).length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">No AI calls recorded this month</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Trigger Type</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Calls</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Cost</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Prompt Tokens</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Completion Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary?.byTriggerType || {})
                    .sort((a, b) => b[1].costCents - a[1].costCents)
                    .map(([type, stats]) => (
                      <tr key={type} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-cost-trigger-${type}`}>
                        <td className="px-4 py-2 text-muted-foreground">{AI_TRIGGER_LABELS[type] || type}</td>
                        <td className="px-4 py-2 text-right font-medium" data-testid={`text-calls-${type}`}>{stats.calls.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-medium text-green-700 dark:text-green-400" data-testid={`text-cost-${type}`}>${(stats.costCents / 100).toFixed(4)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{stats.promptTokens.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{stats.completionTokens.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            30-Day AI Spend Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 bg-muted animate-pulse rounded" />
          ) : chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180} data-testid="chart-ai-spend-trend">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  interval={Math.floor(chartData.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  tickFormatter={v => `$${v}`}
                  width={48}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    name === "cost" ? `$${value.toFixed(4)}` : value,
                    name === "cost" ? "Cost" : "Calls",
                  ]}
                  labelFormatter={label => `Date: ${label}`}
                />
                <Bar dataKey="cost" fill="#22c55e" radius={[2, 2, 0, 0]} name="cost" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AiActivityPanel() {
  const [triggerType, setTriggerType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const PAGE_SIZE = 50;

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (triggerType !== "all") params.set("triggerType", triggerType);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (flaggedOnly) params.set("flaggedOnly", "true");

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
      confidenceScore: number | null;
      flagged: boolean | null;
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
    queryKey: ["/api/operator/ai-audit", triggerType, startDate, endDate, page, flaggedOnly],
    queryFn: () => fetch(`/api/operator/ai-audit?${params}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const totals = data?.totals;
  const logs = data?.logs || [];

  return (
    <div className="space-y-4 mt-4">
      <AiLogDetailModal
        logId={selectedLogId}
        open={selectedLogId !== null}
        onClose={() => setSelectedLogId(null)}
      />
      <AiCostPanel />
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
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Filter</label>
          <Button
            variant={flaggedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => { setFlaggedOnly(v => !v); setPage(0); }}
            data-testid="button-toggle-flagged"
            className="flex items-center gap-1"
          >
            <Flag className="w-3.5 h-3.5" />
            {flaggedOnly ? "Flagged Only" : "All Calls"}
          </Button>
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
          <CardTitle className="text-sm flex items-center gap-2">
            Recent AI Calls
            {flaggedOnly && <Badge variant="destructive" className="text-xs">Flagged Only</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {flaggedOnly ? "No flagged AI calls found." : "No AI calls recorded yet."}
            </div>
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
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Confidence</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr
                      key={log.id}
                      className={`border-b last:border-0 hover:bg-muted/20 ${log.flagged ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                      data-testid={`row-ai-log-${log.id}`}
                    >
                      <td className="py-2 px-3 text-muted-foreground whitespace-nowrap text-xs">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          {log.flagged && <Flag className="w-3 h-3 text-red-500 shrink-0" />}
                          <Badge variant="outline" className="text-xs">{AI_TRIGGER_LABELS[log.triggerType] || log.triggerType}</Badge>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">{log.model}</td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-xs">{(log.promptTokens + log.completionTokens).toLocaleString()}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-xs">${(log.costCents / 100).toFixed(4)}</td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">{log.durationMs ? `${log.durationMs}ms` : "—"}</td>
                      <td className="py-2 px-3 text-center">
                        <ConfidenceBadge score={log.confidenceScore} />
                      </td>
                      <td className="py-2 px-3">
                        {log.error ? (
                          <Badge variant="destructive" className="text-xs">Error</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">OK</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setSelectedLogId(log.id)}
                          data-testid={`button-view-log-${log.id}`}
                          aria-label="View log details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
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

// ─── Statement Upload Failures Panel ─────────────────────────────────────────

interface UploadFailure {
  id: number;
  dealId: number | null;
  step: number | null;
  stepName: string | null;
  error: string | null;
  timestamp: string | null;
  createdAt: string | null;
}

const STEP_LABELS: Record<number, string> = {
  1: "Contact verified",
  2: "Company linked",
  3: "Deal created/advanced",
  4: "File attached",
  5: "AI analysis queued",
  6: "Rep notified",
  7: "GHL contact synced",
  8: "Pipeline stage set",
  9: "Merchant confirmation",
  10: "Proposal draft",
  11: "Follow-up enrolled",
};

function StatementUploadFailuresPanel() {
  const { data: failures = [], isLoading, refetch, isFetching } = useQuery<UploadFailure[]>({
    queryKey: ["/api/operator/statement-upload-failures"],
    staleTime: 30_000,
  });

  const stepCounts = failures.reduce<Record<string, number>>((acc, f) => {
    const key = f.stepName || `Step ${f.step}` || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const stepBreakdown = Object.entries(stepCounts).sort((a, b) => b[1] - a[1]);

  function relativeTime(ts: string | null) {
    if (!ts) return "—";
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="space-y-4" data-testid="panel-statement-upload-failures">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Statement Upload Chain Failures</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Logs individual step failures from the 11-step conversion chain. Uploads are never lost — these are background step failures only.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-upload-failures"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : failures.length === 0 ? (
        <Card data-testid="card-no-failures">
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm font-medium">All upload chain steps are passing</p>
            <p className="text-xs text-muted-foreground mt-1">No failures recorded in the last 500 audit log entries.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Step breakdown summary */}
          {stepBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Failure Breakdown by Step</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stepBreakdown.map(([step, count]) => (
                  <div key={step} className="flex items-center gap-2" data-testid={`row-step-breakdown-${step.replace(/\s/g, "-")}`}>
                    <span className="text-xs text-muted-foreground w-44 truncate">{step}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-destructive"
                        style={{ width: `${Math.min(100, (count / failures.length) * 100)}%` }}
                      />
                    </div>
                    <Badge variant="destructive" className="text-xs shrink-0" data-testid={`badge-step-count-${step.replace(/\s/g, "-")}`}>
                      {count}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Recent failures table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                Recent Failures ({failures.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-upload-failures">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Step</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Error</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Deal</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.slice(0, 50).map((f) => (
                      <tr key={f.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-failure-${f.id}`}>
                        <td className="py-2 px-4">
                          <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
                            {f.stepName || (f.step ? STEP_LABELS[f.step] : "Unknown")}
                          </Badge>
                        </td>
                        <td className="py-2 px-4 max-w-xs">
                          <span className="text-destructive/80 truncate block max-w-xs" title={f.error || "—"}>
                            {f.error || "—"}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          {f.dealId ? (
                            <a
                              href={`/dashboard/deals/${f.dealId}`}
                              className="text-primary hover:underline"
                              data-testid={`link-deal-${f.dealId}`}
                            >
                              #{f.dealId}
                            </a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground whitespace-nowrap">
                          {relativeTime(f.timestamp || f.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Wave 8: Conversion Panel ─────────────────────────────────────────────────
function ConversionPanel() {
  const [days, setDays] = useState(30);

  const { data: funnelData, isLoading: funnelLoading } = useQuery<{
    funnel: { stage: string; eventName: string; count: number }[];
    byEvent: Record<string, number>;
    days: number;
  }>({
    queryKey: ["/api/analytics/conversion-funnel", days],
    queryFn: () => fetch(`/api/analytics/conversion-funnel?days=${days}`).then(r => r.json()),
  });

  const { data: utmData, isLoading: utmLoading } = useQuery<{
    rows: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; cnt: string }[];
    days: number;
  }>({
    queryKey: ["/api/analytics/utm-attribution", days],
    queryFn: () => fetch(`/api/analytics/utm-attribution?days=${days}`).then(r => r.json()),
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery<{
    events: {
      id: number;
      eventName: string;
      occurredAt: string;
      contactId: number | null;
      dealId: number | null;
      utmSource: string | null;
      channel: string | null;
      blockReason: string | null;
      dealStage: string | null;
      offerRoute: string | null;
    }[];
  }>({
    queryKey: ["/api/analytics/conversion-events", 7],
    queryFn: () => fetch(`/api/analytics/conversion-events?days=7&limit=100`).then(r => r.json()),
  });

  const funnelColors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];
  const topUtm = (utmData?.rows ?? []).sort((a, b) => Number(b.cnt) - Number(a.cnt)).slice(0, 10);
  const recentEvents = eventsData?.events ?? [];

  function relT(s: string) {
    const diff = Date.now() - new Date(s).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  }

  return (
    <div className="space-y-6" data-testid="panel-conversion">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Conversion Attribution</h2>
        <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-32" data-testid="select-conversion-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card data-testid="card-conversion-funnel">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Conversion Funnel (last {days} days)</CardTitle>
        </CardHeader>
        <CardContent>
          {funnelLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading funnel…</div>
          ) : (
            <div className="space-y-3">
              {(funnelData?.funnel ?? []).map((row, i) => {
                const topCount = funnelData?.funnel?.[0]?.count ?? 1;
                const pct = topCount > 0 ? Math.round((row.count / topCount) * 100) : 0;
                return (
                  <div key={row.eventName} data-testid={`funnel-row-${row.eventName}`}>
                    <div className="flex items-center justify-between mb-1 text-sm">
                      <span className="font-medium">{row.stage}</span>
                      <span className="text-muted-foreground">{row.count.toLocaleString()} <span className="text-xs">({pct}%)</span></span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
              {(funnelData?.funnel?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">No conversion events recorded yet.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-utm-attribution">
        <CardHeader>
          <CardTitle className="text-sm font-medium">UTM Source Attribution (last {days} days)</CardTitle>
        </CardHeader>
        <CardContent>
          {utmLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : topUtm.length === 0 ? (
            <p className="text-sm text-muted-foreground">No UTM-tagged events yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Source</th>
                    <th className="text-left py-2 pr-4 font-medium">Medium</th>
                    <th className="text-left py-2 pr-4 font-medium">Campaign</th>
                    <th className="text-right py-2 font-medium">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {topUtm.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`utm-row-${i}`}>
                      <td className="py-2 pr-4">{r.utmSource ?? <span className="text-muted-foreground italic">(direct)</span>}</td>
                      <td className="py-2 pr-4">{r.utmMedium ?? "—"}</td>
                      <td className="py-2 pr-4">{r.utmCampaign ?? "—"}</td>
                      <td className="py-2 text-right font-medium">{Number(r.cnt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-recent-conversion-events">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent CRM Milestone Events (last 7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestone events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Event</th>
                    <th className="text-left py-2 pr-4 font-medium">Contact</th>
                    <th className="text-left py-2 pr-4 font-medium">Deal</th>
                    <th className="text-left py-2 pr-4 font-medium">Detail</th>
                    <th className="text-right py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.slice(0, 50).map((ev) => (
                    <tr key={ev.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`event-row-${ev.id}`}>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-xs font-mono">{ev.eventName}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {ev.contactId ? <a href={`/dashboard/contacts/${ev.contactId}`} className="text-primary hover:underline">#{ev.contactId}</a> : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {ev.dealId ? <a href={`/dashboard/deals/${ev.dealId}`} className="text-primary hover:underline">#{ev.dealId}</a> : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">
                        {ev.channel ?? ev.dealStage ?? ev.blockReason ?? ev.offerRoute ?? "—"}
                      </td>
                      <td className="py-2 text-right text-muted-foreground text-xs whitespace-nowrap">{relT(ev.occurredAt)}</td>
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
