import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Users, Ticket, TrendingUp, CheckCircle, AlertTriangle, Clock, Target, ArrowUpRight, Loader2, Brain, Sparkles, RefreshCw, DollarSign, Banknote } from "lucide-react";
import type { Contact, Deal } from "@shared/schema";

function formatInsights(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function Overview() {
  const [insights, setInsights] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const insightsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/insights");
      return await res.json() as { insights: string };
    },
    onSuccess: (data) => {
      setInsights(data.insights);
      setLastUpdated(new Date());
    },
  });

  const { data: kpi, isLoading: kpiLoading, isError } = useQuery<{
    pipeline: { totalActive: number; closedWon30d: number; closedLost30d: number; conversionRate: number; stagesBreakdown: Record<string, number>; newLeads7d: number };
    onboarding: { active: number; live: number };
    support: { openTickets: number; breachedSla: number };
    tasks: { pending: number; overdue: number };
    contacts: { total: number; new30d: number };
    revenue: { totalEstVolume: number; totalEstResidual: number; totalEstProfit: number; avgDealProfit: number };
  }>({ queryKey: ["/api/kpi/summary"] });

  const { data: contacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: deals } = useQuery<Deal[]>({ queryKey: ["/api/deals"] });

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

  return (
    <div className="space-y-8">
      <Card className="bg-primary/5 dark:bg-primary/10" data-testid="card-ai-copilot">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">AI Operations Copilot</CardTitle>
          </div>
          {insights ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => insightsMutation.mutate()}
              disabled={insightsMutation.isPending}
              data-testid="button-get-insights"
            >
              {insightsMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh Insights
            </Button>
          ) : (
            <Button
              onClick={() => insightsMutation.mutate()}
              disabled={insightsMutation.isPending}
              size="sm"
              data-testid="button-get-insights"
            >
              {insightsMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Get AI Insights
            </Button>
          )}
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
          {!insights && !insightsMutation.isPending && (
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-kpi-pipeline">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Pipeline</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-pipeline">{kpi?.pipeline.totalActive || 0}</div>
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-new-leads">{kpi?.pipeline.newLeads7d || 0} new leads this week</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-conversion">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">30-Day Conversion</CardTitle>
            <Target className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-conversion-rate">{kpi?.pipeline.conversionRate || 0}%</div>
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-won-lost">{kpi?.pipeline.closedWon30d || 0} won / {kpi?.pipeline.closedLost30d || 0} lost</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-support">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Tickets</CardTitle>
            <Ticket className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-open-tickets">{kpi?.support.openTickets || 0}</div>
            {(kpi?.support.breachedSla || 0) > 0 ? (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1" data-testid="text-sla-breach">
                <AlertTriangle className="w-3 h-3" />
                {kpi?.support.breachedSla} SLA breaches
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-sla-ok">All within SLA</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-tasks">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-tasks">{kpi?.tasks.pending || 0}</div>
            {(kpi?.tasks.overdue || 0) > 0 ? (
              <p className="text-xs text-destructive mt-1" data-testid="text-overdue-tasks">{kpi?.tasks.overdue} overdue</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-tasks-ok">None overdue</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-kpi-volume">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Processing Volume</CardTitle>
            <DollarSign className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-est-volume">${(kpi?.revenue.totalEstVolume || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Monthly estimated volume</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-residual">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Monthly Residual</CardTitle>
            <Banknote className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-est-residual">${(kpi?.revenue.totalEstResidual || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Projected monthly income</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-profit">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Gross Profit</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-est-profit">${(kpi?.revenue.totalEstProfit || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Monthly from all deals</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-avg-deal">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Deal Profit</CardTitle>
            <Target className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-deal-profit">${(kpi?.revenue.avgDealProfit || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Per deal average</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card data-testid="card-kpi-contacts">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Contacts</CardTitle>
            <Users className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-contacts">{kpi?.contacts.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{kpi?.contacts.new30d || 0} added last 30 days</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-onboarding">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Onboarding</CardTitle>
            <ArrowUpRight className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-onboarding-active">{kpi?.onboarding.active || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{kpi?.onboarding.live || 0} live merchants</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-stages">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Stages</CardTitle>
            <CheckCircle className="w-4 h-4 text-primary" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card data-testid="card-recent-contacts">
          <CardHeader>
            <CardTitle className="text-base">Recent Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentContacts.map((contact: Contact) => (
                <div key={contact.id} className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate transition-colors" data-testid={`row-contact-${contact.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {contact.firstName[0]}{contact.lastName[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate" data-testid={`text-contact-name-${contact.id}`}>{contact.firstName} {contact.lastName}</div>
                      <div className="text-xs text-muted-foreground truncate">{contact.companyName || contact.email}</div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0" data-testid={`badge-contact-status-${contact.id}`}>
                    {contact.status}
                  </Badge>
                </div>
              ))}
              {recentContacts.length === 0 && (
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
              {activeDeals.map((deal: Deal) => (
                <div key={deal.id} className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate transition-colors" data-testid={`row-deal-${deal.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium text-sm" data-testid={`text-deal-id-${deal.id}`}>Deal #{deal.id}</div>
                    <div className="text-xs text-muted-foreground">{deal.offerPath || "No offer path"}</div>
                  </div>
                  <Badge variant="outline" className="shrink-0" data-testid={`badge-deal-stage-${deal.id}`}>
                    {deal.stage}
                  </Badge>
                </div>
              ))}
              {activeDeals.length === 0 && (
                <div className="text-center text-muted-foreground py-8" data-testid="text-no-deals">No active deals</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
