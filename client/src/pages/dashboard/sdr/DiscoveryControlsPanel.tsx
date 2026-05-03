import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock } from "lucide-react";

export function DiscoveryControlsPanel() {
  const { data, isLoading } = useQuery<{
    nightlySchedulerRunning: boolean;
    discoveryInProgress: boolean;
    nightlyDiscoveryEnabled: boolean;
  }>({
    queryKey: ["/api/sdr/discovery-controls"],
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

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
      {!data?.nightlyDiscoveryEnabled && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center text-muted-foreground text-sm" data-testid="text-nightly-disabled">
            Nightly discovery is disabled. Set NIGHTLY_DISCOVERY_ENABLED=true to enable automated lead discovery.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
