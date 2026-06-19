import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, Database, Globe } from "lucide-react";

interface SourceStatusEntry {
  configured: boolean;
  free?: boolean;
  description?: string;
  usage?: { businessesFound?: number } | null;
}

interface SourceStatus {
  serper?: SourceStatusEntry;
  outscraper?: SourceStatusEntry;
  apify?: SourceStatusEntry;
  apollo?: SourceStatusEntry;
  osm?: SourceStatusEntry;
  yellowpages?: SourceStatusEntry;
  bbb?: SourceStatusEntry;
}

interface DiscoveryStats {
  today: { rawFound: number; newInserted: number; duplicatesSkipped: number; jobCount: number };
  bySource: Array<{ source: string | null; count: number; newCount: number }>;
}

const SOURCE_LABELS: Record<string, string> = {
  serper: "Serper (Google)",
  outscraper: "Outscraper",
  apify: "Apify",
  apollo: "Apollo.io",
  osm: "OpenStreetMap",
  yellowpages: "Yellow Pages",
  bbb: "BBB.org",
};

export function DiscoveryControlsPanel() {
  const { data, isLoading } = useQuery<{
    nightlySchedulerRunning: boolean;
    discoveryInProgress: boolean;
    nightlyDiscoveryEnabled: boolean;
  }>({
    queryKey: ["/api/sdr/discovery-controls"],
    refetchInterval: 10000,
  });

  const { data: sourceStatus } = useQuery<SourceStatus>({
    queryKey: ["/api/sdr/discovery/source-status"],
    refetchInterval: 60000,
  });

  const { data: stats } = useQuery<DiscoveryStats>({
    queryKey: ["/api/sdr/discovery/stats"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const sourceCountMap: Record<string, { count: number; newCount: number }> = {};
  if (stats?.bySource) {
    for (const s of stats.bySource) {
      const key = (s.source || "").replace("discovery_", "");
      if (!sourceCountMap[key]) sourceCountMap[key] = { count: 0, newCount: 0 };
      sourceCountMap[key].count += s.count;
      sourceCountMap[key].newCount += s.newCount;
    }
  }

  const freeSources: Array<{ key: string; entry: SourceStatusEntry }> = [
    { key: "osm", entry: sourceStatus?.osm || { configured: true, free: true } },
    { key: "yellowpages", entry: sourceStatus?.yellowpages || { configured: true, free: true } },
    { key: "bbb", entry: sourceStatus?.bbb || { configured: true, free: true } },
  ];

  const paidSources: Array<{ key: string; entry: SourceStatusEntry }> = [
    { key: "serper", entry: sourceStatus?.serper || { configured: false } },
    { key: "outscraper", entry: sourceStatus?.outscraper || { configured: false } },
    { key: "apify", entry: sourceStatus?.apify || { configured: false } },
    { key: "apollo", entry: sourceStatus?.apollo || { configured: false } },
  ];

  return (
    <div className="space-y-4" data-testid="panel-discovery-controls">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-nightly-enabled">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Nightly Discovery</span>
            </div>
            <Badge className={data?.nightlyDiscoveryEnabled
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.nightlyDiscoveryEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-scheduler-running">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Scheduler Status</div>
            <Badge className={data?.nightlySchedulerRunning
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.nightlySchedulerRunning ? "Running" : "Stopped"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-progress">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Discovery Status</div>
            <Badge className={data?.discoveryInProgress
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.discoveryInProgress ? "In Progress" : "Idle"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-free-sources">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Free Discovery Sources
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs ml-1">No API Key Required</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {freeSources.map(({ key, entry }) => {
              const counts = sourceCountMap[key] || { count: 0, newCount: 0 };
              return (
                <div key={key} className="border rounded-lg p-3" data-testid={`source-card-${key}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{SOURCE_LABELS[key] || key}</span>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">Active</Badge>
                  </div>
                  {entry.description && (
                    <p className="text-xs text-muted-foreground mb-2">{entry.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="text-center">
                      <div className="text-lg font-bold" data-testid={`source-count-${key}`}>{counts.count.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Found Today</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600" data-testid={`source-new-${key}`}>{counts.newCount.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">New Records</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-paid-sources">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="w-4 h-4" />
            Paid Discovery Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {paidSources.map(({ key, entry }) => {
              const counts = sourceCountMap[key] || { count: 0, newCount: 0 };
              return (
                <div key={key} className="border rounded-lg p-3" data-testid={`source-card-${key}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{SOURCE_LABELS[key] || key}</span>
                    <Badge className={entry.configured
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 text-xs"
                    }>
                      {entry.configured ? "Configured" : "No Key"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="text-center">
                      <div className="text-lg font-bold" data-testid={`source-count-${key}`}>{counts.count.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Found Today</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600" data-testid={`source-new-${key}`}>{counts.newCount.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">New Records</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {!data?.nightlyDiscoveryEnabled && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center text-muted-foreground text-sm" data-testid="text-nightly-disabled">
            Nightly discovery is disabled. Set NIGHTLY_DISCOVERY_ENABLED=true to enable automated lead discovery.
            Free sources (OSM, Yellow Pages, BBB) will run with no API keys required.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
