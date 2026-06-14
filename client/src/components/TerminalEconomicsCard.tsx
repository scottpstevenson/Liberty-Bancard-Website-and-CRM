import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Monitor, TrendingUp, Clock, CheckCircle2, AlertTriangle, Info } from "lucide-react";

interface EquipmentOrder {
  id: number;
  equipmentType: string;
  quantity: number;
  status: string;
  libertyCost?: string | number | null;
  estimatedMonthlyGp?: string | number | null;
  paybackMonths?: string | number | null;
  approvalTier?: string | null;
  managerApproved?: boolean;
  approvedAt?: string | null;
}

interface Props {
  dealId: number;
  terminalRecommendation?: string | null;
  monthlyVolume?: string | null;
  isManagerOrAdmin?: boolean;
}

const TIER_CONFIG: Record<string, { label: string; badgeClass: string; icon: typeof Info }> = {
  green:  {
    label: "Auto-Approve (≤6 mo)",
    badgeClass: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300",
    icon: CheckCircle2,
  },
  yellow: {
    label: "Rep Discretion (6-12 mo)",
    badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300",
    icon: Info,
  },
  red:    {
    label: "Manager Approval Required (>12 mo)",
    badgeClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300",
    icon: AlertTriangle,
  },
};

function fmt(v: string | number | null | undefined, prefix = "$"): string {
  const n = Number(v);
  if (!v || isNaN(n)) return "—";
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMonths(v: string | number | null | undefined): string {
  const n = Number(v);
  if (!v || isNaN(n)) return "N/A";
  return `${n.toFixed(1)} mo`;
}

export default function TerminalEconomicsCard({ dealId, terminalRecommendation, isManagerOrAdmin }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery<EquipmentOrder[]>({
    queryKey: ["/api/equipment-orders", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/equipment-orders?dealId=${dealId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!dealId,
  });

  const approveMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/equipment-orders/${orderId}/approve`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Approval failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Terminal approved", description: "Manager approval recorded." });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-orders", dealId] });
    },
    onError: (err: Error) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return null;

  const ordersWithEconomics = orders.filter(
    (o) => o.libertyCost != null || o.approvalTier != null
  );

  if (ordersWithEconomics.length === 0 && !terminalRecommendation) return null;

  if (ordersWithEconomics.length === 0 && terminalRecommendation) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 space-y-1" data-testid="terminal-economics-estimated">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          Terminal Recommendation
        </div>
        <p className="text-xs text-muted-foreground pl-6">{terminalRecommendation}</p>
        <p className="text-xs text-muted-foreground pl-6">
          Create an equipment order to see payback economics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="terminal-economics-card">
      {ordersWithEconomics.map((order) => {
        const tier = order.approvalTier || "green";
        const cfg = TIER_CONFIG[tier] || TIER_CONFIG.green;
        const TierIcon = cfg.icon;
        const needsApproval = tier === "red" && !order.managerApproved && isManagerOrAdmin;
        const isApproved = order.managerApproved;

        return (
          <Card key={order.id} className="border-0 bg-muted/30" data-testid={`terminal-economics-order-${order.id}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  {order.equipmentType}
                  {order.quantity > 1 && <span className="text-muted-foreground">×{order.quantity}</span>}
                </div>
                <Badge variant="outline" className={`text-[10px] px-1.5 border ${cfg.badgeClass}`} data-testid="badge-approval-tier">
                  <TierIcon className="h-2.5 w-2.5 mr-0.5" />
                  {isApproved ? "Approved" : cfg.label}
                </Badge>
              </div>

              <Separator className="my-1" />

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col items-center p-1.5 rounded bg-background border">
                  <span className="text-muted-foreground mb-0.5">Liberty Cost</span>
                  <span className="font-semibold" data-testid="text-liberty-cost">{fmt(order.libertyCost)}</span>
                </div>
                <div className="flex flex-col items-center p-1.5 rounded bg-background border">
                  <TrendingUp className="h-3 w-3 text-muted-foreground mb-0.5" />
                  <span className="text-muted-foreground text-[10px]">Est. Monthly GP</span>
                  <span className="font-semibold" data-testid="text-monthly-gp">{fmt(order.estimatedMonthlyGp)}</span>
                </div>
                <div className="flex flex-col items-center p-1.5 rounded bg-background border">
                  <Clock className="h-3 w-3 text-muted-foreground mb-0.5" />
                  <span className="text-muted-foreground text-[10px]">Payback</span>
                  <span className="font-semibold" data-testid="text-payback-months">{fmtMonths(order.paybackMonths)}</span>
                </div>
              </div>

              {tier === "red" && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  {isApproved ? (
                    <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Manager approved {order.approvedAt ? `on ${new Date(order.approvedAt).toLocaleDateString()}` : ""}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Payback exceeds 12 months — manager approval required before ordering.
                      </p>
                      {needsApproval && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] shrink-0 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                          onClick={() => approveMutation.mutate(order.id)}
                          disabled={approveMutation.isPending}
                          data-testid="button-approve-terminal"
                        >
                          {approveMutation.isPending ? "Approving…" : "Approve"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
