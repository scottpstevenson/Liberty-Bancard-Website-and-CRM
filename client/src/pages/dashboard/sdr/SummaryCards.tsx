import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Users, Target, MessageSquare, Calendar, FileText, Send, TrendingUp, UserCheck } from "lucide-react";

interface SdrSummaryData {
  newToday: number;
  qualifiedToday: number;
  contactedToday: number;
  repliedToday: number;
  meetingsToday: number;
  statementsToday: number;
  proposalsToday: number;
  totalMerchants: number;
  closedWonToday: number;
  humanOwnedCount: number;
}

export function SummaryCards() {
  const { data, isLoading } = useQuery<SdrSummaryData>({
    queryKey: ["/api/sdr/dashboard/summary"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards = [
    { label: "New Today", value: data?.newToday || 0, icon: Users, color: "text-blue-600" },
    { label: "Qualified", value: data?.qualifiedToday || 0, icon: Target, color: "text-green-600" },
    { label: "Contacted", value: data?.contactedToday || 0, icon: Send, color: "text-purple-600" },
    { label: "Replied", value: data?.repliedToday || 0, icon: MessageSquare, color: "text-orange-600" },
    { label: "Meetings Set", value: data?.meetingsToday || 0, icon: Calendar, color: "text-indigo-600" },
    { label: "Statements", value: data?.statementsToday || 0, icon: FileText, color: "text-teal-600" },
    { label: "Proposals", value: data?.proposalsToday || 0, icon: FileText, color: "text-emerald-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} data-testid={`card-sdr-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${card.color}`} />
                  <span className="text-xs text-muted-foreground">{card.label}</span>
                </div>
                <div className="text-2xl font-bold" data-testid={`value-sdr-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {card.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card data-testid="card-sdr-total-merchants">
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Total Merchants</div>
              <div className="text-xl font-bold">{data?.totalMerchants || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-sdr-closed-won">
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <div>
              <div className="text-sm text-muted-foreground">Closed Won Today</div>
              <div className="text-xl font-bold">{data?.closedWonToday || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-sdr-human-owned">
          <CardContent className="p-4 flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-sm text-muted-foreground">Human-Owned Leads</div>
              <div className="text-xl font-bold">{data?.humanOwnedCount || 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
