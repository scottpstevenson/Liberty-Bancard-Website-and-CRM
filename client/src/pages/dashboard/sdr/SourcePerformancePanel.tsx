import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, AlertTriangle, Info } from "lucide-react";

interface SourcePerf {
  source: string;
  leadsFound: number;
  newInserted: number;
  duplicatesSkipped: number;
  duplicateRate: number;
  abRate: number | null;
  processorCoverage: number | null;
  costTracked: boolean;
  costEstimate: number | null;
  costBasis: string;
  costPerAbLead: number | null;
}

interface SourcePerfData {
  performance: SourcePerf[];
  pilotJobCount: number;
}

const SOURCE_LABELS: Record<string, string> = {
  serper: "Serper",
  outscraper: "Outscraper",
  apify: "Apify",
  osm: "OSM (free)",
  yellowpages: "Yellow Pages (free)",
  bbb: "BBB (free)",
};

export function SourcePerformancePanel() {
  const { data, isLoading, isError } = useQuery<SourcePerfData>({
    queryKey: ["/api/sdr/discovery/source-performance"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-source-performance">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-source-performance">
        <CardContent className="p-6 flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Failed to load source performance</span>
        </CardContent>
      </Card>
    );
  }

  const hasPilotData = (data?.pilotJobCount ?? 0) > 0 && (data?.performance?.length ?? 0) > 0;

  return (
    <Card data-testid="card-source-performance">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Source Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasPilotData ? (
          <div className="text-sm text-muted-foreground text-center py-6" data-testid="text-source-performance-empty">
            Run a pilot to see source stats
          </div>
        ) : (
          <div className="space-y-3">
            {(data?.performance || []).map((row) => (
              <div key={row.source} className="border rounded-lg p-3 space-y-2" data-testid={`row-source-perf-${row.source}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{SOURCE_LABELS[row.source] ?? row.source}</span>
                  <div className="flex items-center gap-2">
                    {row.abRate !== null && (
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-ab-rate-${row.source}`}>
                        {row.abRate}% A/B
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs" data-testid={`badge-dedup-rate-${row.source}`}>
                      {row.duplicateRate}% dupe
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div data-testid={`stat-perf-found-${row.source}`}>
                    <span className="block font-medium text-foreground">{row.leadsFound}</span>
                    Leads Found
                  </div>
                  <div data-testid={`stat-perf-new-${row.source}`}>
                    <span className="block font-medium text-green-600">{row.newInserted}</span>
                    New Inserted
                  </div>
                  <div data-testid={`stat-perf-processor-${row.source}`}>
                    <span className="block font-medium text-foreground">
                      {row.processorCoverage !== null ? `${row.processorCoverage}%` : "—"}
                    </span>
                    Processor Coverage
                  </div>
                  <div data-testid={`stat-perf-cost-${row.source}`}>
                    <span className="block font-medium text-foreground">
                      {row.costTracked && row.costEstimate !== null ? (
                        <>
                          ${row.costEstimate.toFixed(2)}
                          {row.costPerAbLead !== null && (
                            <span className="text-muted-foreground ml-1">/ ${row.costPerAbLead.toFixed(2)} per A/B</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Cost not tracked</span>
                      )}
                    </span>
                    Est. Cost
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-start gap-1.5 mt-3 p-2 bg-muted/40 rounded text-xs text-muted-foreground" data-testid="note-conversion-analytics">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Full conversion analytics require canonical business linking
        </div>
      </CardContent>
    </Card>
  );
}
