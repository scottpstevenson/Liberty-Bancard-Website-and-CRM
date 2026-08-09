/**
 * LeadQueuePanel — Speed-to-Lead pipeline health dashboard widget.
 *
 * Shows:
 *   • Leads created today
 *   • Median minutes from lead creation to first NBA computation
 *   • High-score leads whose SLA timer is overdue (no human touch yet)
 *
 * Fetches from GET /api/admin/lead-queue-stats (admin/manager only).
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, Users, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface OverdueLead {
  contactId: number;
  name: string;
  email: string;
  leadScore: number;
  assignedTo: string | null;
  slaDueAt: string;
  minutesOverdue: number;
}

interface LeadQueueStats {
  leadsCreatedToday: number;
  medianMinutesToFirstNba: number | null;
  overdueHighScoreCount: number;
  overdueLeads: OverdueLead[];
  stalledLeadsCount: number;
  threshold: number;
  slaMins: number;
  asOf: string;
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  urgent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  urgent?: boolean;
}) {
  return (
    <Card className={cn("flex-1", urgent && "border-destructive/40 bg-destructive/5")}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1 text-muted-foreground text-xs uppercase tracking-wide">
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {title}
        </div>
        <div className={cn("text-2xl font-bold", urgent && "text-destructive")}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function LeadQueuePanel() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<LeadQueueStats>({
    queryKey: ["/api/admin/lead-queue-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lead-queue-stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead queue stats");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 min
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Speed to Lead</h2>
          <p className="text-sm text-muted-foreground">
            Lead pipeline health — from first touch to first NBA
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-lead-queue-health"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading pipeline stats…
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-center text-destructive text-sm">
            Failed to load lead queue stats.{" "}
            <button onClick={() => refetch()} className="underline">
              Retry
            </button>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Metric cards */}
          <div className="flex gap-3 flex-wrap">
            <StatCard
              title="Leads Today"
              value={data.leadsCreatedToday}
              sub="new contacts created"
              icon={Users}
            />
            <StatCard
              title="Median Time to NBA"
              value={
                data.medianMinutesToFirstNba !== null
                  ? `${data.medianMinutesToFirstNba}m`
                  : "—"
              }
              sub="from creation to first action"
              icon={Clock}
            />
            <StatCard
              title="Overdue (≥ SLA)"
              value={data.overdueHighScoreCount}
              sub={`score ≥ ${data.threshold}, no touch in ${data.slaMins}m`}
              icon={AlertTriangle}
              urgent={data.overdueHighScoreCount > 0}
            />
            <StatCard
              title="Stalled (no NBA)"
              value={data.stalledLeadsCount}
              sub="high-score leads without NBA"
              icon={CheckCircle2}
              urgent={data.stalledLeadsCount > 0}
            />
          </div>

          {/* Overdue leads table */}
          {data.overdueLeads.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  Overdue High-Score Leads ({data.overdueLeads.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-overdue-leads">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left px-4 py-2 font-medium">Contact</th>
                        <th className="text-left px-4 py-2 font-medium">Score</th>
                        <th className="text-left px-4 py-2 font-medium">Assigned</th>
                        <th className="text-left px-4 py-2 font-medium">Overdue by</th>
                        <th className="text-left px-4 py-2 font-medium">SLA Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overdueLeads.map((lead) => (
                        <tr key={lead.contactId} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2">
                            <a
                              href={`/dashboard/contacts/${lead.contactId}`}
                              className="font-medium hover:underline text-primary"
                            >
                              {lead.name || lead.email}
                            </a>
                            <div className="text-xs text-muted-foreground">{lead.email}</div>
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={lead.leadScore >= 70 ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {lead.leadScore}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {lead.assignedTo ?? <span className="text-muted-foreground">Unassigned</span>}
                          </td>
                          <td className="px-4 py-2">
                            <span className="text-destructive font-medium">
                              {lead.minutesOverdue}m
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {new Date(lead.slaDueAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-green-500" />
                No overdue high-score leads — all within SLA ({data.slaMins}m window, score ≥{" "}
                {data.threshold})
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-right">
            As of {new Date(data.asOf).toLocaleTimeString()} ·{" "}
            SLA threshold: score ≥ {data.threshold}, window = {data.slaMins}m
          </p>
        </>
      ) : null}
    </div>
  );
}
