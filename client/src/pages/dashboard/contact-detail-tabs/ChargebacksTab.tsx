import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import type { Chargeback } from "@shared/schema";

export function ContactChargebacksTab({ contactId }: { contactId: number }) {
  const { data: chargebacks = [], isLoading } = useQuery<Chargeback[]>({
    queryKey: ["/api/chargebacks/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/chargebacks/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const open = chargebacks.filter(c => !["Won", "Lost"].includes(c.status));
  const won = chargebacks.filter(c => c.status === "Won");
  const lost = chargebacks.filter(c => c.status === "Lost");
  const totalAmount = chargebacks.reduce((sum, c) => sum + (c.amount || 0), 0);
  const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const now = new Date();
  const overdue = open.filter(c => c.responseDeadline && new Date(c.responseDeadline) < now);

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading chargebacks...</div>;
  }

  return (
    <div className="space-y-4" data-testid="contact-chargebacks-tab">
      {chargebacks.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-total">{chargebacks.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${overdue.length > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-overdue">{overdue.length}</div>
              <div className="text-xs text-muted-foreground">Overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-amount">${totalAmount.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">Total Disputed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${winRate !== null && winRate >= 50 ? "text-green-600 dark:text-green-400" : winRate !== null ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-winrate">
                {winRate !== null ? `${winRate}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </CardContent>
          </Card>
        </div>
      )}

      {chargebacks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-chargebacks-contact">
            <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No chargebacks for this merchant
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {chargebacks.map(cb => {
            const isOverdue = !["Won", "Lost"].includes(cb.status) && cb.responseDeadline && new Date(cb.responseDeadline) < now;
            return (
              <Card key={cb.id} className={isOverdue ? "border-red-300 dark:border-red-800" : ""} data-testid={`card-cb-${cb.id}`}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">${cb.amount.toFixed(2)}</span>
                        <Badge variant="outline">{cb.cardBrand}</Badge>
                        <Badge variant={cb.status === "Won" ? "default" : cb.status === "Lost" ? "destructive" : "secondary"}>
                          {cb.status}
                        </Badge>
                        {isOverdue && <Badge variant="destructive">OVERDUE</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{cb.reasonCode}</p>
                      {cb.responseDeadline && (
                        <p className={`text-xs ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                          Deadline: {new Date(cb.responseDeadline).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {cb.transactionDate ? new Date(cb.transactionDate).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
