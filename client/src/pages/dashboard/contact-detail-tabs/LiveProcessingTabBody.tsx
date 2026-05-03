import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import LiveProcessingTab from "@/components/LiveProcessingTab";
import type { Deal } from "@shared/schema";

export function LiveProcessingTabBody({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No deals yet</CardContent></Card>;
  }

  const filtered = deals.filter(d => d.mid || d.pipeline === "onboarding" || d.stage?.toLowerCase().includes("approved"));

  return (
    <div className="space-y-6">
      {filtered.map(deal => (
        <div key={deal.id}>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" data-testid={`badge-live-deal-pipeline-${deal.id}`}>{deal.pipeline}</Badge>
            <Badge variant="secondary" data-testid={`badge-live-deal-stage-${deal.id}`}>{deal.stage}</Badge>
            {deal.mid && (
              <span className="text-xs text-muted-foreground font-mono">#{deal.id}</span>
            )}
          </div>
          <LiveProcessingTab dealId={deal.id} mid={deal.mid || null} />
        </div>
      ))}
      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium text-muted-foreground">No approved deals yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Processing data appears once a deal is approved and a MID is assigned.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
