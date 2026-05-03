import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, BarChart3 } from "lucide-react";
import type { SourceQualityData } from "./types";

export function SourceQualityDashboard() {
  const { data, isLoading } = useQuery<SourceQualityData[]>({
    queryKey: ["/api/sdr/source-quality"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sources = data || [];

  return (
    <Card data-testid="card-source-quality">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Source Quality (Last 30 Days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No source quality data available yet. Aggregate funnel metrics to populate this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-source-quality">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Source</th>
                  <th className="text-right py-2 px-3 font-medium">Leads</th>
                  <th className="text-right py-2 px-3 font-medium">Enrich%</th>
                  <th className="text-right py-2 px-3 font-medium">Reply%</th>
                  <th className="text-right py-2 px-3 font-medium">Meeting%</th>
                  <th className="text-right py-2 px-3 font-medium">Statement%</th>
                  <th className="text-right py-2 px-3 font-medium">Close%</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => (
                  <tr key={src.sourceType} className="border-b border-muted" data-testid={`row-source-${src.sourceType}`}>
                    <td className="py-2 px-3 font-medium">{src.sourceType}</td>
                    <td className="text-right py-2 px-3">{src.totalLeads}</td>
                    <td className="text-right py-2 px-3">{src.enrichmentRate}%</td>
                    <td className="text-right py-2 px-3">{src.replyRate}%</td>
                    <td className="text-right py-2 px-3">{src.meetingRate}%</td>
                    <td className="text-right py-2 px-3">{src.statementRate}%</td>
                    <td className="text-right py-2 px-3">
                      <span className={src.closeRate > 5 ? "text-green-600 font-medium" : ""}>{src.closeRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
