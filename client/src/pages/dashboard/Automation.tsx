import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Zap, TrendingUp, Headphones, ListChecks, Package, Workflow } from "lucide-react";
import type { CollateralPacket, Workflow as WorkflowType } from "@shared/schema";

interface KpiSummary {
  pipeline?: {
    totalDeals?: number;
    openDeals?: number;
    closedWon?: number;
    closedLost?: number;
    conversionRate?: number;
  };
  support?: {
    totalTickets?: number;
    openTickets?: number;
    avgResolutionHours?: number;
    slaBreaches?: number;
  };
  tasks?: {
    totalTasks?: number;
    pendingTasks?: number;
    completedTasks?: number;
    overdueTasks?: number;
  };
}

export default function Automation() {
  const { data: kpi, isLoading: kpiLoading } = useQuery<KpiSummary>({
    queryKey: ["/api/kpi/summary"],
  });

  const { data: packets, isLoading: packetsLoading } = useQuery<CollateralPacket[]>({
    queryKey: ["/api/collateral-packets"],
  });

  const { data: workflows, isLoading: workflowsLoading } = useQuery<WorkflowType[]>({
    queryKey: ["/api/workflows"],
  });

  if (kpiLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="automation-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pipeline = kpi?.pipeline;
  const support = kpi?.support;
  const tasks = kpi?.tasks;

  return (
    <div className="space-y-6" data-testid="automation-page">
      <div>
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold" data-testid="text-automation-title">Automation Dashboard</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">KPI overview, collateral packets, and workflow automation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-kpi-pipeline">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Stats</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total Deals</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-total-deals">{pipeline?.totalDeals ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Open</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-open-deals">{pipeline?.openDeals ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Closed Won</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-closed-won">{pipeline?.closedWon ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Closed Lost</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-closed-lost">{pipeline?.closedLost ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Conversion Rate</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-conversion-rate">
                  {pipeline?.conversionRate != null ? `${pipeline.conversionRate}%` : "-"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-support">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Support Stats</CardTitle>
            <Headphones className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total Tickets</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-total-tickets">{support?.totalTickets ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Open</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-open-tickets">{support?.openTickets ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Avg Resolution</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-avg-resolution">
                  {support?.avgResolutionHours != null ? `${support.avgResolutionHours}h` : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">SLA Breaches</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-sla-breaches">{support?.slaBreaches ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-tasks">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Task Stats</CardTitle>
            <ListChecks className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total Tasks</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-total-tasks">{tasks?.totalTasks ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Pending</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-pending-tasks">{tasks?.pendingTasks ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Completed</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-completed-tasks">{tasks?.completedTasks ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Overdue</span>
                <span className="text-sm font-semibold" data-testid="text-kpi-overdue-tasks">{tasks?.overdueTasks ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-collateral-packets">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Collateral Packets</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {packetsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !packets || packets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-packets-empty">
              No collateral packets configured
            </p>
          ) : (
            <Table data-testid="table-collateral-packets">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Offer Path</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packets.map((p) => (
                  <TableRow key={p.id} data-testid={`row-packet-${p.id}`}>
                    <TableCell className="text-sm font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.offerPath || "-"}</TableCell>
                    <TableCell className="text-sm">{p.vertical || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-workflows-summary">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Pre-built Workflows</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {workflowsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !workflows || workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-workflows-empty">
              No workflows configured
            </p>
          ) : (
            <Table data-testid="table-workflows-summary">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((w) => (
                  <TableRow key={w.id} data-testid={`row-workflow-${w.id}`}>
                    <TableCell className="text-sm font-medium">{w.name}</TableCell>
                    <TableCell className="text-sm">{w.triggerType}</TableCell>
                    <TableCell className="text-sm">
                      {Array.isArray(w.actions) ? `${w.actions.length} action${w.actions.length !== 1 ? "s" : ""}` : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={w.enabled ? "default" : "secondary"} className="text-xs">
                        {w.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
