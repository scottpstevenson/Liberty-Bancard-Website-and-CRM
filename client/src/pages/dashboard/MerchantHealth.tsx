import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertTriangle,
  TrendingDown,
  XCircle,
  Shield,
  Wifi,
  Ban,
  Loader2,
  CheckCircle,
  Activity,
  Heart,
  Clock,
  WifiOff,
  DollarSign,
  BarChart3,
} from "lucide-react";
import type { HealthAlert } from "@shared/schema";

const ALERT_TYPE_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle }> = {
  volume_decline: { label: "Volume Decline", icon: TrendingDown },
  chargeback_spike: { label: "Chargeback", icon: AlertTriangle },
  no_processing: { label: "No Processing", icon: XCircle },
  high_refund_rate: { label: "High Refunds", icon: Ban },
  compliance_issue: { label: "Compliance", icon: Shield },
  terminal_offline: { label: "Terminal Offline", icon: WifiOff },
  funding_hold: { label: "Funding Hold", icon: DollarSign },
};

const SEVERITY_STYLES: Record<string, { badge: "destructive" | "outline" | "secondary"; textClass: string }> = {
  critical: { badge: "destructive", textClass: "text-red-600 dark:text-red-400" },
  warning: { badge: "outline", textClass: "text-amber-600 dark:text-amber-400" },
  info: { badge: "secondary", textClass: "text-blue-600 dark:text-blue-400" },
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, warning: 1, info: 2 };

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "volume_decline", label: "Volume Decline" },
  { key: "chargeback_spike", label: "Chargeback" },
  { key: "no_processing", label: "No Processing" },
  { key: "high_refund_rate", label: "High Refunds" },
  { key: "compliance_issue", label: "Compliance" },
  { key: "terminal_offline", label: "Terminal Offline" },
  { key: "funding_hold", label: "Funding Hold" },
];

function getAlertIcon(alertType: string) {
  const config = ALERT_TYPE_CONFIG[alertType];
  if (!config) return AlertTriangle;
  return config.icon;
}

function getSeverityStyle(severity: string | null) {
  return SEVERITY_STYLES[severity || "info"] || SEVERITY_STYLES.info;
}

export default function MerchantHealth() {
  const [activeFilter, setActiveFilter] = useState("all");

  const { data: alerts = [], isLoading, isError } = useQuery<HealthAlert[]>({
    queryKey: ["/api/health-alerts"],
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/health-alerts/${id}`, {
        status: "acknowledged",
        acknowledgedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health-alerts"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/health-alerts/${id}`, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health-alerts"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-merchant-health">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="error-merchant-health">
        <p className="text-muted-foreground">Unable to load health alerts. Please try again.</p>
      </div>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical" || a.severity === "urgent").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const healthyCount = Math.max(0, 100 - alerts.length);
  const avgHealthScore = alerts.length > 0 ? Math.max(0, 100 - alerts.length * 5) : 100;

  const filteredAlerts = (activeFilter === "all" ? alerts : alerts.filter((a) => a.alertType === activeFilter))
    .sort((a, b) => (SEVERITY_ORDER[a.severity || "info"] ?? 2) - (SEVERITY_ORDER[b.severity || "info"] ?? 2));

  return (
    <div className="space-y-8" data-testid="page-merchant-health">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Merchant Health Monitor</h1>
        <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
          Proactive alerts for declining volume, rising chargebacks, and at-risk merchants
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-kpi-critical">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical Alerts</CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-critical-count">{criticalCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Requires immediate attention</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-warning">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warning Alerts</CardTitle>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-warning-count">{warningCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Monitor closely</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-healthy">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Healthy Merchants</CardTitle>
            <Heart className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-healthy-count">{healthyCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Operating normally</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-health-score">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Portfolio Health</CardTitle>
            <BarChart3 className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-health-score">{avgHealthScore}%</div>
            <p className="text-xs text-muted-foreground mt-1">Overall portfolio score</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="filter-alert-types">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.key}
            variant={activeFilter === opt.key ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(opt.key)}
            className={`toggle-elevate ${activeFilter === opt.key ? "toggle-elevated" : ""}`}
            data-testid={`button-filter-${opt.key}`}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <Card data-testid="card-active-alerts">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Active Alerts
            {filteredAlerts.length > 0 && (
              <Badge variant="secondary" data-testid="badge-alert-count">{filteredAlerts.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredAlerts.length === 0 ? (
            <div className="text-center py-12" data-testid="text-no-alerts">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No active alerts - all merchants are healthy</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert) => {
                const IconComponent = getAlertIcon(alert.alertType);
                const severityStyle = getSeverityStyle(alert.severity);
                const typeConfig = ALERT_TYPE_CONFIG[alert.alertType];

                return (
                  <div
                    key={alert.id}
                    className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-md border"
                    data-testid={`card-alert-${alert.id}`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`mt-0.5 shrink-0 ${severityStyle.textClass}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm" data-testid={`text-alert-title-${alert.id}`}>
                            {alert.title}
                          </span>
                          <Badge
                            variant={severityStyle.badge}
                            data-testid={`badge-severity-${alert.id}`}
                          >
                            {alert.severity}
                          </Badge>
                          {typeConfig && (
                            <Badge variant="secondary" data-testid={`badge-type-${alert.id}`}>
                              {typeConfig.label}
                            </Badge>
                          )}
                        </div>
                        {alert.description && (
                          <p className="text-sm text-muted-foreground" data-testid={`text-alert-desc-${alert.id}`}>
                            {alert.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          {alert.metric && (
                            <span data-testid={`text-alert-metric-${alert.id}`}>
                              Metric: {alert.metric}
                            </span>
                          )}
                          {alert.currentValue && (
                            <span data-testid={`text-alert-value-${alert.id}`}>
                              Current: {alert.currentValue}
                            </span>
                          )}
                          {alert.threshold && (
                            <span data-testid={`text-alert-threshold-${alert.id}`}>
                              Threshold: {alert.threshold}
                            </span>
                          )}
                          {alert.createdAt && (
                            <span data-testid={`text-alert-date-${alert.id}`}>
                              {new Date(alert.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {alert.status === "acknowledged" && alert.acknowledgedAt && (
                          <p className="text-xs text-muted-foreground italic" data-testid={`text-alert-acked-${alert.id}`}>
                            Acknowledged {new Date(alert.acknowledgedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {alert.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          disabled={acknowledgeMutation.isPending}
                          data-testid={`button-acknowledge-${alert.id}`}
                        >
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => resolveMutation.mutate(alert.id)}
                        disabled={resolveMutation.isPending}
                        data-testid={`button-resolve-${alert.id}`}
                      >
                        Resolve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
