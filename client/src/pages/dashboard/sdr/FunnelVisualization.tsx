import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, BarChart3, ArrowRight } from "lucide-react";

interface FunnelStageData {
  stage: string;
  count: number;
  conversionRate?: number;
}

export function FunnelVisualization() {
  const { data, isLoading } = useQuery<FunnelStageData[]>({
    queryKey: ["/api/sdr/dashboard/funnel"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stages = data || [];
  const maxCount = Math.max(...stages.map(s => s.count), 1);

  return (
    <Card data-testid="card-sdr-funnel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Pipeline Funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No leads in pipeline yet. Funnel data will appear here as leads progress through stages.
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((stage, idx) => (
              <div key={stage.stage} className="flex items-center gap-3" data-testid={`funnel-stage-${stage.stage}`}>
                <div className="w-44 text-sm truncate text-muted-foreground">{stage.stage}</div>
                <div className="flex-1 bg-muted rounded-full h-7 relative overflow-hidden">
                  <div
                    className="bg-primary/80 h-full rounded-full transition-all"
                    style={{ width: `${Math.max((stage.count / maxCount) * 100, 2)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                    {stage.count}
                  </span>
                </div>
                <div className="w-16 text-right">
                  {stage.conversionRate !== undefined && stage.conversionRate !== null ? (
                    <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
                      <ArrowRight className="w-3 h-3" />
                      <span>{stage.conversionRate}%</span>
                    </div>
                  ) : idx === 0 ? (
                    <span className="text-xs text-muted-foreground">100%</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
