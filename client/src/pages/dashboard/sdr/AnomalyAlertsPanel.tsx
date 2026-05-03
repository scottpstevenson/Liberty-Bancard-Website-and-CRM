import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Bell, CheckCircle2 } from "lucide-react";

export function AnomalyAlertsPanel() {
  const { data, isLoading } = useQuery<{
    alerts: Array<{
      id: string;
      type: string;
      severity: "warning" | "critical";
      title: string;
      description: string;
      metric: string;
      currentValue: number;
      expectedValue: number;
      threshold: number;
      detectedAt: string;
      identityId?: number;
      identityLabel?: string;
    }>;
    criticalCount: number;
    warningCount: number;
    lastChecked: string;
  }>({
    queryKey: ["/api/sdr/anomaly-alerts"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const alerts = data?.alerts || [];
  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const warningAlerts = alerts.filter(a => a.severity === "warning");

  return (
    <div className="space-y-4" data-testid="panel-anomaly-alerts">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-total-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Alerts</span>
            </div>
            <div className="text-2xl font-bold">{alerts.length}</div>
          </CardContent>
        </Card>
        <Card className={criticalAlerts.length > 0 ? "border-red-300 dark:border-red-800" : ""} data-testid="card-critical-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Critical</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{criticalAlerts.length}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-warning-alerts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Warnings</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">{warningAlerts.length}</div>
          </CardContent>
        </Card>
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-alerts">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            No anomalies detected. All systems operating normally.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <Card
              key={idx}
              className={alert.severity === "critical"
                ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950"
                : "border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950"}
              data-testid={`alert-item-${idx}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 mt-0.5 ${alert.severity === "critical" ? "text-red-600" : "text-yellow-600"}`} />
                    <div>
                      <div className="font-medium text-sm">{alert.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{alert.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {alert.metric}: {alert.currentValue.toFixed(1)} (expected: {alert.expectedValue.toFixed(1)}, threshold: {alert.threshold.toFixed(1)})
                      </div>
                    </div>
                  </div>
                  <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} data-testid={`badge-severity-${idx}`}>
                    {alert.severity}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data?.lastChecked && (
        <div className="text-xs text-muted-foreground text-right" data-testid="text-last-checked">
          Last checked: {new Date(data.lastChecked).toLocaleString()}
        </div>
      )}
    </div>
  );
}
