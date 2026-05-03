import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MapPin, Building2, TrendingUp } from "lucide-react";

interface MarketExpansionData {
  byState: {
    state: string;
    total: number;
    contacted: number;
    engaged: number;
    closedWon: number;
    contactRate: number;
    engagementRate: number;
    addressable: number;
    penetration: number;
  }[];
  byMetro: {
    city: string;
    state: string;
    total: number;
    contacted: number;
    engaged: number;
  }[];
  expansionSuggestions: {
    currentState: string;
    utilization: number;
    suggestedState: string;
    reason: string;
    estimatedAddressable: number;
  }[];
}

export function MarketExpansionDashboard() {
  const { data, isLoading } = useQuery<MarketExpansionData>({
    queryKey: ["/api/sdr/market-expansion"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-market-expansion">
      {(data?.expansionSuggestions || []).length > 0 && (
        <Card data-testid="card-expansion-suggestions">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Expansion Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.expansionSuggestions.map((sug, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg" data-testid={`suggestion-${idx}`}>
                  <MapPin className="w-5 h-5 text-green-600 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{sug.reason}</div>
                    <div className="text-xs text-muted-foreground">
                      Estimated addressable market: {sug.estimatedAddressable.toLocaleString()} businesses
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-state-penetration">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="w-4 h-4" />
              Market Penetration by State
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byState || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No state data yet</div>
            ) : (
              <div className="space-y-2">
                {(data?.byState || []).map((st) => (
                  <div key={st.state} className="space-y-1" data-testid={`state-${st.state}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{st.state}</span>
                      <span className="text-muted-foreground">{st.total} / {st.addressable.toLocaleString()} ({st.penetration}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-full rounded-full transition-all ${st.penetration >= 80 ? "bg-orange-500" : st.penetration >= 50 ? "bg-yellow-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.min(st.penetration, 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Contacted: {st.contactRate}%</span>
                      <span>Engaged: {st.engagementRate}%</span>
                      <span>Won: {st.closedWon}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-metro-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="w-4 h-4" />
              Top Metros
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byMetro || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No metro data yet</div>
            ) : (
              <div className="space-y-2">
                {(data?.byMetro || []).slice(0, 15).map((m, idx) => (
                  <div key={`${m.city}-${m.state}`} className="flex items-center justify-between text-sm" data-testid={`metro-${idx}`}>
                    <span className="text-muted-foreground">{m.city}, {m.state}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{m.total}</span>
                      <span className="text-xs text-muted-foreground">{m.contacted} contacted</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
