import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CreditCard,
  DollarSign, Activity, BarChart3,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface MidDailyStat {
  id: number;
  mid: string;
  dealId: number | null;
  date: string;
  volume: string | null;
  txCount: number | null;
  avgTicket: string | null;
  effectiveRate: string | null;
  chargebackCount: number | null;
  chargebackAmount: string | null;
  refundCount: number | null;
  fetchedAt: string | null;
}

interface MidStatsResponse {
  stats: MidDailyStat[];
  mid: string | null;
  fetchedAt: string | null;
  message?: string;
}

interface LiveProcessingTabProps {
  dealId: number;
  mid: string | null;
}

function fmt(val: string | number | null | undefined, type: "currency" | "percent" | "number" = "number") {
  if (val == null || val === "") return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  if (type === "currency") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === "percent") return `${(n * 100).toFixed(2)}%`;
  return n.toLocaleString("en-US");
}

function DataAge({ fetchedAt }: { fetchedAt: string | null }) {
  if (!fetchedAt) return null;
  const diff = Date.now() - new Date(fetchedAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  const label = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : "just now";
  const isStale = hours > 26;
  return (
    <Badge
      variant="outline"
      className={`text-xs ${isStale ? "border-yellow-300 text-yellow-700 dark:text-yellow-400" : "border-green-300 text-green-700 dark:text-green-400"}`}
      data-testid="badge-data-freshness"
    >
      {isStale ? <AlertTriangle className="h-2.5 w-2.5 mr-1" /> : <Activity className="h-2.5 w-2.5 mr-1" />}
      Data: {label}
    </Badge>
  );
}

export default function LiveProcessingTab({ dealId, mid }: LiveProcessingTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MidStatsResponse>({
    queryKey: ["/api/deals", dealId, "mid-stats"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/mid-stats?days=30`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch MID stats");
      return res.json();
    },
    enabled: !!dealId,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/refresh-mid-stats`);
      return res.json();
    },
    onSuccess: (d: any) => {
      toast({ title: "MID stats refreshed", description: `${d.rowsUpserted} days updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "mid-stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (!mid) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CreditCard className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium text-muted-foreground">No MID Assigned</p>
          <p className="text-sm text-muted-foreground mt-1">
            A Merchant ID will be assigned once this deal is approved by the processor.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading processing data…
      </div>
    );
  }

  const stats = data?.stats ?? [];
  const fetchedAt = data?.fetchedAt ?? null;

  if (stats.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Live Processing
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs" data-testid="text-mid-label">MID: {mid}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="h-7 text-xs"
              data-testid="button-refresh-mid-stats"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Pulling data…" : "Pull Data"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Activity className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No processing data yet for this MID.</p>
          <p className="text-xs mt-1">Click "Pull Data" to fetch the last 30 days from the processor.</p>
        </CardContent>
      </Card>
    );
  }

  const sortedAsc = [...stats].sort((a, b) => a.date.localeCompare(b.date));

  const totalVolume = stats.reduce((sum, s) => sum + parseFloat(s.volume || "0"), 0);
  const totalTx = stats.reduce((sum, s) => sum + (s.txCount || 0), 0);
  const totalCb = stats.reduce((sum, s) => sum + (s.chargebackCount || 0), 0);
  const avgTicketVals = stats.filter(s => s.avgTicket).map(s => parseFloat(s.avgTicket!));
  const avgTicket = avgTicketVals.length > 0 ? avgTicketVals.reduce((a, b) => a + b, 0) / avgTicketVals.length : 0;

  const firstHalf = sortedAsc.slice(0, Math.floor(sortedAsc.length / 2));
  const secondHalf = sortedAsc.slice(Math.floor(sortedAsc.length / 2));
  const firstVol = firstHalf.reduce((s, d) => s + parseFloat(d.volume || "0"), 0);
  const secondVol = secondHalf.reduce((s, d) => s + parseFloat(d.volume || "0"), 0);
  const trend = firstVol > 0 ? ((secondVol - firstVol) / firstVol) * 100 : 0;

  const chartData = sortedAsc.map(s => ({
    date: new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    volume: parseFloat(s.volume || "0"),
    txCount: s.txCount || 0,
  }));

  return (
    <div className="space-y-4" data-testid="live-processing-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs" data-testid="text-mid-display">MID: {mid}</Badge>
          <DataAge fetchedAt={fetchedAt} />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="h-7 text-xs"
          data-testid="button-refresh-mid-stats"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="mid-stats-summary">
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">30-Day Volume</p>
            <p className="text-lg font-bold" data-testid="text-total-volume">{fmt(totalVolume, "currency")}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {trend >= 0
                ? <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
              <span className={`text-xs ${trend >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-volume-trend">
                {trend >= 0 ? "+" : ""}{trend.toFixed(1)}% trend
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Transactions</p>
            <p className="text-lg font-bold" data-testid="text-total-tx">{fmt(totalTx)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{stats.length} days</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Avg Ticket</p>
            <p className="text-lg font-bold" data-testid="text-avg-ticket">{fmt(avgTicket, "currency")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">per transaction</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Chargebacks</p>
            <p className={`text-lg font-bold ${totalCb > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-chargeback-count">
              {totalCb}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">30-day total</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-volume-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> 30-Day Volume Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="volumeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip
                formatter={(val: number) => [`$${val.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Volume"]}
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="hsl(var(--primary))"
                fill="url(#volumeGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card data-testid="card-daily-table">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Daily Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Volume</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Txns</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Ticket</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Eff. Rate</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">CBs</th>
                </tr>
              </thead>
              <tbody>
                {sortedAsc.slice().reverse().map((s, i) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-mid-stat-${i}`}>
                    <td className="px-4 py-2 font-mono">{s.date}</td>
                    <td className="px-4 py-2 text-right">{fmt(s.volume, "currency")}</td>
                    <td className="px-4 py-2 text-right">{fmt(s.txCount)}</td>
                    <td className="px-4 py-2 text-right">{fmt(s.avgTicket, "currency")}</td>
                    <td className="px-4 py-2 text-right">{fmt(s.effectiveRate ? parseFloat(s.effectiveRate) : null, "percent")}</td>
                    <td className={`px-4 py-2 text-right ${(s.chargebackCount || 0) > 0 ? "text-red-600 dark:text-red-400 font-medium" : ""}`}>
                      {s.chargebackCount || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
