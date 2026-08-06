import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { DollarSign, Clock, CheckCircle, Banknote, TrendingUp } from "lucide-react";

interface AgentPayout {
  id: number;
  agentUserId: string;
  periodMonth: string;
  grossResidual: string;
  agentShare: string;
  partnerShare: string;
  status: string;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isNaN(num) ? 0 : num);
}

function PayoutStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
        <Banknote className="w-3 h-3 mr-1" />Paid
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0">
        <CheckCircle className="w-3 h-3 mr-1" />Approved
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      <Clock className="w-3 h-3 mr-1" />Pending
    </Badge>
  );
}

export default function MyEarnings() {
  const { data: payouts = [], isLoading } = useQuery<AgentPayout[]>({
    queryKey: ["/api/payouts/my"],
  });

  const totalPaid = payouts
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + parseFloat(p.agentShare || "0"), 0);

  const totalPending = payouts
    .filter((p) => p.status !== "paid")
    .reduce((acc, p) => acc + parseFloat(p.agentShare || "0"), 0);

  const latestPayout = payouts[0] ?? null;

  return (
    <div className="space-y-6 p-6" data-testid="page-my-earnings">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">My Earnings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your residual commission history — period by period
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="section-earnings-kpis">
        <Card data-testid="card-total-paid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid Out</CardTitle>
            <Banknote className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-green-600" data-testid="text-total-paid">
                {formatCurrency(totalPaid)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Across all paid periods</p>
          </CardContent>
        </Card>

        <Card data-testid="card-pending-earnings">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending / Approved</CardTitle>
            <Clock className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-pending-earnings">
                {formatCurrency(totalPending)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Awaiting disbursement</p>
          </CardContent>
        </Card>

        <Card data-testid="card-latest-period">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Latest Period</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : latestPayout ? (
              <>
                <div className="text-2xl font-bold" data-testid="text-latest-period-amount">
                  {formatCurrency(latestPayout.agentShare)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{latestPayout.periodMonth}</p>
              </>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payout History Table */}
      <Card data-testid="card-payout-history">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            Payout History
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Residual commissions generated from confirmed imports. Contact your admin if you have questions about a period.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : payouts.length === 0 ? (
            <div className="py-12 text-center" data-testid="text-no-earnings">
              <DollarSign className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payout records yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Payouts are generated by your admin after each monthly residual import is confirmed.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-payout-history">
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Gross Residual</TableHead>
                    <TableHead className="text-right">Your Share</TableHead>
                    <TableHead className="text-right">Partner Share</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid On</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((payout) => (
                    <TableRow key={payout.id} data-testid={`row-payout-${payout.id}`}>
                      <TableCell className="font-mono font-medium">{payout.periodMonth}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payout.grossResidual)}</TableCell>
                      <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">
                        {formatCurrency(payout.agentShare)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {parseFloat(payout.partnerShare || "0") > 0
                          ? formatCurrency(payout.partnerShare)
                          : <span className="text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <PayoutStatusBadge status={payout.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {payout.paidAt
                          ? new Date(payout.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : <span className="text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                        {payout.notes || <span>—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
