import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/export-csv";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  Search,
  BarChart3,
  Percent,
  Download,
} from "lucide-react";

interface ResidualReport {
  id: number;
  month: string;
  year: number;
  totalRevenue: number;
  totalCost: number;
  netRevenue: number;
  activeMerchants: number;
  attritionRate: number;
  createdAt: string;
}

interface MerchantResidual {
  id: number;
  merchantName: string;
  mid: string;
  volume: number;
  volumeChange: number;
  revenue: number;
  revenueChange: number;
  cost: number;
  netRevenue: number;
  agent: string;
  commission: number;
  flags: string[];
}

interface Agent {
  id: number;
  name: string;
  totalDeals: number;
  revenueManaged: number;
  commissionEarned: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyDetailed(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function ChangeIndicator({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground text-xs">--</span>;
  const isPositive = value > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${isPositive ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KPISkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-24 mb-1" />
        <Skeleton className="h-3 w-36" />
      </CardContent>
    </Card>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 9 }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export default function ResidualRevenue() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: reports, isLoading: reportsLoading } = useQuery<ResidualReport[]>({
    queryKey: ["/api/residual-reports"],
  });

  const { data: merchantResiduals, isLoading: residualsLoading } = useQuery<MerchantResidual[]>({
    queryKey: ["/api/merchant-residuals"],
  });

  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const currentMonth = reports && reports.length > 0 ? reports[0] : null;
  const last6Months = reports?.slice(0, 6).reverse() || [];
  const maxRevenue = last6Months.length > 0 ? Math.max(...last6Months.map((r) => r.totalRevenue)) : 0;

  const totalRevenue = currentMonth?.totalRevenue || 0;
  const activeMerchants = currentMonth?.activeMerchants || 0;
  const avgRevenuePerMerchant = activeMerchants > 0 ? totalRevenue / activeMerchants : 0;
  const attritionRate = currentMonth?.attritionRate || 0;

  const hasData = reports && reports.length > 0;

  const filteredMerchants = useMemo(() => {
    if (!merchantResiduals) return [];
    const sorted = [...merchantResiduals].sort((a, b) => b.revenue - a.revenue);
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(
      (m) =>
        m.merchantName.toLowerCase().includes(q) ||
        m.mid.toLowerCase().includes(q) ||
        m.agent.toLowerCase().includes(q)
    );
  }, [merchantResiduals, searchQuery]);

  const agentSummary = useMemo(() => {
    if (agents && agents.length > 0) return agents;
    if (!merchantResiduals) return [];
    const agentMap = new Map<string, { totalDeals: number; revenueManaged: number; commissionEarned: number }>();
    merchantResiduals.forEach((m) => {
      const existing = agentMap.get(m.agent) || { totalDeals: 0, revenueManaged: 0, commissionEarned: 0 };
      existing.totalDeals += 1;
      existing.revenueManaged += m.revenue;
      existing.commissionEarned += m.commission;
      agentMap.set(m.agent, existing);
    });
    return Array.from(agentMap.entries()).map(([name, data], i) => ({
      id: i,
      name,
      ...data,
    }));
  }, [agents, merchantResiduals]);

  return (
    <div className="space-y-8" data-testid="page-residual-revenue">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" data-testid="section-header">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Revenue Dashboard</h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Track monthly revenue, portfolio performance, and agent commissions
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportToCSV(filteredMerchants, "residual_revenue", [
            { key: "merchantName", label: "Merchant" },
            { key: "mid", label: "MID" },
            { key: "volume", label: "Volume" },
            { key: "revenue", label: "Revenue" },
            { key: "revenueChange", label: "Change %" },
          ])}
          data-testid="button-export-revenue"
        >
          <Download className="w-4 h-4 mr-1" /> Export Revenue Data
        </Button>
      </div>

      {!hasData && !reportsLoading && (
        <Card className="bg-primary/5 dark:bg-primary/10" data-testid="card-no-data">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground" data-testid="text-no-data">
              Import residual data to see revenue metrics
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="section-kpi-cards">
        {reportsLoading ? (
          <>
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
          </>
        ) : (
          <>
            <Card data-testid="card-kpi-total-revenue">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Portfolio Revenue</CardTitle>
                <DollarSign className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-revenue">
                  {formatCurrency(totalRevenue)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">This month</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-active-merchants">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Merchants</CardTitle>
                <Users className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-active-merchants">
                  {activeMerchants.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Processing merchants</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-avg-revenue">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Revenue Per Merchant</CardTitle>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-avg-revenue">
                  {formatCurrencyDetailed(avgRevenuePerMerchant)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Per merchant average</p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpi-attrition">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Attrition Rate</CardTitle>
                <Percent className="w-4 h-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-attrition-rate">
                  {attritionRate.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Monthly merchant churn</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card data-testid="card-revenue-chart">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Revenue Trend (Last 6 Months)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {reportsLoading ? (
            <div className="flex items-end gap-3 h-48">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <Skeleton className="w-full" style={{ height: `${40 + Math.random() * 60}%` }} />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          ) : last6Months.length > 0 ? (
            <div className="flex items-end gap-3 h-48" data-testid="chart-revenue-bars">
              {last6Months.map((report) => {
                const height = maxRevenue > 0 ? (report.totalRevenue / maxRevenue) * 100 : 0;
                return (
                  <div key={`${report.month}-${report.year}`} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground" data-testid={`text-chart-amount-${report.month}`}>
                      {formatCurrency(report.totalRevenue)}
                    </span>
                    <div
                      className="w-full bg-primary/80 dark:bg-primary/60 rounded-md transition-all"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      data-testid={`bar-revenue-${report.month}`}
                    />
                    <span className="text-xs text-muted-foreground" data-testid={`text-chart-month-${report.month}`}>
                      {report.month}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground" data-testid="text-no-chart-data">
              No revenue data available
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-merchant-residuals">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Merchant Residuals</CardTitle>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search merchants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
              data-testid="input-search-merchants"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table data-testid="table-merchant-residuals">
            <TableHeader>
              <TableRow>
                <TableHead>Merchant Name</TableHead>
                <TableHead>MID</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Net Revenue</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {residualsLoading ? (
                <TableSkeleton rows={5} />
              ) : filteredMerchants.length > 0 ? (
                filteredMerchants.map((merchant) => (
                  <TableRow key={merchant.id} data-testid={`row-merchant-${merchant.id}`}>
                    <TableCell className="font-medium" data-testid={`text-merchant-name-${merchant.id}`}>
                      {merchant.merchantName}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-merchant-mid-${merchant.id}`}>
                      {merchant.mid}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span data-testid={`text-merchant-volume-${merchant.id}`}>
                          {formatCurrency(merchant.volume)}
                        </span>
                        <ChangeIndicator value={merchant.volumeChange} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span data-testid={`text-merchant-revenue-${merchant.id}`}>
                          {formatCurrencyDetailed(merchant.revenue)}
                        </span>
                        <ChangeIndicator value={merchant.revenueChange} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-merchant-cost-${merchant.id}`}>
                      {formatCurrencyDetailed(merchant.cost)}
                    </TableCell>
                    <TableCell className="text-right font-medium" data-testid={`text-merchant-net-${merchant.id}`}>
                      {formatCurrencyDetailed(merchant.netRevenue)}
                    </TableCell>
                    <TableCell data-testid={`text-merchant-agent-${merchant.id}`}>
                      {merchant.agent}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-merchant-commission-${merchant.id}`}>
                      {formatCurrencyDetailed(merchant.commission)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {merchant.flags.length > 0 ? (
                          merchant.flags.map((flag) => (
                            <Badge
                              key={flag}
                              variant={flag === "critical" ? "destructive" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-flag-${merchant.id}-${flag}`}
                            >
                              {flag === "critical" && <AlertTriangle className="w-3 h-3 mr-1" />}
                              {flag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground" data-testid="text-no-merchants">
                    {searchQuery ? "No merchants match your search" : "No merchant residual data available"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="card-agent-commissions">
        <CardHeader>
          <CardTitle className="text-base">Agent Commission Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table data-testid="table-agent-commissions">
            <TableHeader>
              <TableRow>
                <TableHead>Agent Name</TableHead>
                <TableHead className="text-right">Total Deals</TableHead>
                <TableHead className="text-right">Revenue Managed</TableHead>
                <TableHead className="text-right">Commission Earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentsLoading || residualsLoading ? (
                <>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </>
              ) : agentSummary.length > 0 ? (
                agentSummary.map((agent) => (
                  <TableRow key={agent.id} data-testid={`row-agent-${agent.id}`}>
                    <TableCell className="font-medium" data-testid={`text-agent-name-${agent.id}`}>
                      {agent.name}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-agent-deals-${agent.id}`}>
                      {agent.totalDeals}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-agent-revenue-${agent.id}`}>
                      {formatCurrency(agent.revenueManaged)}
                    </TableCell>
                    <TableCell className="text-right font-medium" data-testid={`text-agent-commission-${agent.id}`}>
                      {formatCurrencyDetailed(agent.commissionEarned)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground" data-testid="text-no-agents">
                    No agent commission data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
