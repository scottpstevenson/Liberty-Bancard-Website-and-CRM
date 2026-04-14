import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, CalendarCheck, CalendarPlus } from "lucide-react";
import type { Deal, Contact } from "@shared/schema";

const STAGE_WEIGHTS: Record<string, number> = {
  "New Lead": 0.1,
  "Statement Received": 0.25,
  "Review In Progress": 0.4,
  "Call Booked": 0.5,
  "Proposal Sent": 0.6,
  "Negotiation / Follow-Up": 0.75,
  "Verbal Commit": 0.9,
  "Closed Won": 1.0,
  "Closed Lost": 0,
};

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatCurrencyFull(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

interface ForecastSummary {
  totalPipeline: number;
  weightedForecast: number;
  thisMonthForecast: number;
  nextMonthForecast: number;
  stageBreakdown: Record<string, { count: number; volume: number; profit: number; weight: number }>;
}

export default function Forecasting() {
  const { data: summary, isLoading: summaryLoading } = useQuery<ForecastSummary>({
    queryKey: ["/api/forecasting/summary"],
  });

  const { data: dealsRes, isLoading: dealsLoading } = useQuery<{ data: Deal[]; total: number }>({
    queryKey: ["/api/deals"],
  });
  const deals = dealsRes?.data;

  const { data: contactsRes } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes?.data;

  const contactMap = new Map((contacts || []).map(c => [c.id, c]));

  const activeDeals = (deals || [])
    .filter(d => d.pipeline === "sales" && d.stage !== "Closed Lost")
    .sort((a, b) => parseFloat(b.estimatedGrossProfitMonthly || "0") - parseFloat(a.estimatedGrossProfitMonthly || "0"));

  const topDeals = activeDeals.slice(0, 10);

  const monthlyForecast = computeMonthlyForecast(activeDeals);

  const maxMonthlyValue = Math.max(...monthlyForecast.map(m => m.value), 1);

  const isLoading = summaryLoading || dealsLoading;

  return (
    <div className="space-y-6" data-testid="page-forecasting">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-cards">
        <KpiCard
          testId="kpi-total-pipeline"
          title="Total Pipeline Value"
          value={summary ? formatCurrency(summary.totalPipeline) : "--"}
          icon={DollarSign}
          loading={isLoading}
        />
        <KpiCard
          testId="kpi-weighted-forecast"
          title="Weighted Forecast"
          value={summary ? formatCurrency(summary.weightedForecast) : "--"}
          icon={TrendingUp}
          loading={isLoading}
        />
        <KpiCard
          testId="kpi-this-month"
          title="Expected Close This Month"
          value={summary ? formatCurrency(summary.thisMonthForecast) : "--"}
          icon={CalendarCheck}
          loading={isLoading}
        />
        <KpiCard
          testId="kpi-next-month"
          title="Expected Close Next Month"
          value={summary ? formatCurrency(summary.nextMonthForecast) : "--"}
          icon={CalendarPlus}
          loading={isLoading}
        />
      </div>

      <Card data-testid="card-stage-breakdown">
        <CardHeader>
          <CardTitle>Forecast by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table data-testid="table-stage-breakdown">
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Deal Count</TableHead>
                  <TableHead className="text-right">Total Volume</TableHead>
                  <TableHead className="text-right">Est. Monthly Profit</TableHead>
                  <TableHead className="text-right">Weight %</TableHead>
                  <TableHead className="text-right">Weighted Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary && Object.entries(summary.stageBreakdown).map(([stage, data]) => (
                  <TableRow key={stage} data-testid={`row-stage-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-stage-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                        {stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-count-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                      {data.count}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-volume-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                      {formatCurrency(data.volume)}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-profit-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                      {formatCurrencyFull(data.profit)}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-weight-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                      {data.weight}%
                    </TableCell>
                    <TableCell className="text-right font-medium" data-testid={`text-weighted-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
                      {formatCurrencyFull(data.profit * (data.weight / 100))}
                    </TableCell>
                  </TableRow>
                ))}
                {summary && Object.keys(summary.stageBreakdown).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No active deals in pipeline
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-monthly-forecast">
        <CardHeader>
          <CardTitle>Monthly Forecast (Next 6 Months)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-end gap-3 h-48">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="flex-1 h-full" />)}
            </div>
          ) : (
            <div className="flex items-end gap-3 h-48" data-testid="chart-monthly-forecast">
              {monthlyForecast.map((month) => {
                const heightPct = maxMonthlyValue > 0 ? (month.value / maxMonthlyValue) * 100 : 0;
                return (
                  <div
                    key={month.label}
                    className="flex-1 flex flex-col items-center gap-1"
                    data-testid={`bar-month-${month.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span className="text-xs text-muted-foreground font-medium" data-testid={`text-bar-value-${month.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {formatCurrency(month.value)}
                    </span>
                    <div
                      className="w-full bg-primary/80 rounded-t-md transition-all"
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                    <span className="text-xs text-muted-foreground mt-1" data-testid={`text-bar-label-${month.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {month.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-top-deals">
        <CardHeader>
          <CardTitle>Top Deals by Value</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table data-testid="table-top-deals">
              <TableHeader>
                <TableRow>
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Est. Monthly Profit</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead>Follow-up Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDeals.map((deal) => {
                  const contact = deal.contactId ? contactMap.get(deal.contactId) : null;
                  return (
                    <TableRow key={deal.id} data-testid={`row-deal-${deal.id}`}>
                      <TableCell data-testid={`text-deal-contact-${deal.id}`}>
                        {contact ? `${contact.firstName} ${contact.lastName}` : "N/A"}
                      </TableCell>
                      <TableCell data-testid={`text-deal-company-${deal.id}`}>
                        {contact?.companyName || "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" data-testid={`badge-deal-stage-${deal.id}`}>
                          {deal.stage}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-deal-profit-${deal.id}`}>
                        {formatCurrencyFull(parseFloat(deal.estimatedGrossProfitMonthly || "0"))}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-deal-volume-${deal.id}`}>
                        {formatCurrency(parseFloat(deal.totalVolume || "0"))}
                      </TableCell>
                      <TableCell data-testid={`text-deal-followup-${deal.id}`}>
                        {deal.nextFollowUp ? new Date(deal.nextFollowUp).toLocaleDateString() : "Not set"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {topDeals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No active deals found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ testId, title, value, icon: Icon, loading }: {
  testId: string;
  title: string;
  value: string;
  icon: any;
  loading: boolean;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-bold" data-testid={`${testId}-value`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function computeMonthlyForecast(deals: Deal[]) {
  const now = new Date();
  const months: { label: string; start: Date; end: Date; value: number }[] = [];

  for (let i = 0; i < 6; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
    const label = start.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    months.push({ label, start, end, value: 0 });
  }

  deals.forEach(deal => {
    if (!deal.nextFollowUp) return;
    const followUp = new Date(deal.nextFollowUp);
    const profit = parseFloat(deal.estimatedGrossProfitMonthly || "0");
    const weight = STAGE_WEIGHTS[deal.stage] ?? 0.1;

    for (const month of months) {
      if (followUp >= month.start && followUp <= month.end) {
        month.value += profit * weight;
        break;
      }
    }
  });

  return months.map(m => ({ label: m.label, value: m.value }));
}
