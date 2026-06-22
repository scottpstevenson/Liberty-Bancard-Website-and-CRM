import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Settings, CheckCircle2, XCircle, Key, MapPin, Calendar, Activity, Mail, Clock, Zap, ArrowRightLeft, Send, Database, AlertTriangle, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GhlActivityLog, MessageTemplate, SlaConfig } from "@shared/schema";

interface GhlStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasLocationId: boolean;
  hasCalendarId: boolean;
}

interface HealthCheckResult {
  connected: boolean;
  latencyMs: number;
  locationName?: string;
  error?: string;
}

interface AdminHealthResult {
  status: "ok" | "expired" | "unconfigured";
  failureCount: number;
  lastSync: string | null;
  latencyMs?: number;
  locationName?: string;
  error?: string;
  checkedAt?: string;
}

interface SyncStatus {
  configured: boolean;
  totalContacts: number;
  syncedToGhl: number;
  unsyncedToGhl: number;
  lastSyncTo: any;
  lastSyncFrom: any;
  hotLeadSync?: { timestamp: string; synced: number; failed: number; total: number };
  hotLeadEnrollment?: { timestamp: string; enrolled: number; skipped: number; blocked: number; total: number };
}

interface EntitySyncStatus {
  entityType: string;
  lastSyncAt: string | null;
  lastSyncDirection: string | null;
  syncedCount: number;
  errorCount: number;
  lastError: string | null;
  localCount: number;
  ghlCount: number;
}

interface SyncDashboard {
  configured: boolean;
  totalContacts: number;
  syncedToGhl: number;
  unsyncedToGhl: number;
  totalDeals: number;
  entitySyncStatuses: EntitySyncStatus[];
  entityStatuses: Record<string, {
    lastSyncAt: string | null;
    lastSyncDirection: string | null;
    syncedCount: number;
    errorCount: number;
    lastError: string | null;
    localCount?: number;
    ghlSyncedCount?: number;
  }>;
}

interface BackfillStatus {
  totalContacts: number;
  missingGhlId: number;
}

interface BackfillResult {
  results: { matched: number; notFound: number; errors: number; total: number };
  log: Array<{ id: number; email: string; status: string; ghlId?: string; error?: string }>;
}

export default function GhlSettings() {
  const { toast } = useToast();
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<GhlStatus>({
    queryKey: ["/api/ghl/status"],
  });

  const { data: adminHealth } = useQuery<AdminHealthResult>({
    queryKey: ["/api/admin/ghl-health"],
    refetchInterval: 60_000,
    retry: false,
    staleTime: 25_000,
  });

  const { data: healthResult } = useQuery<HealthCheckResult>({
    queryKey: ["/api/ghl/health-check"],
    refetchInterval: 60000,
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["/api/ghl/sync-status"],
    refetchInterval: 15000,
  });

  const { data: syncDashboard } = useQuery<SyncDashboard>({
    queryKey: ["/api/ghl/sync-dashboard"],
    refetchInterval: 30000,
  });

  const { data: activity, isLoading: activityLoading } = useQuery<GhlActivityLog[]>({
    queryKey: ["/api/ghl/activity"],
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/message-templates"],
  });

  const { data: slaConfigs, isLoading: slaLoading } = useQuery<SlaConfig[]>({
    queryKey: ["/api/sla-configs"],
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ghl/test-connection");
      return res.json() as Promise<HealthCheckResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/health-check"] });
      if (data.connected) {
        toast({ title: "GHL Connected", description: `Location: ${data.locationName} (${data.latencyMs}ms)` });
      } else {
        toast({ title: "Connection Failed", description: data.error || "Could not reach GHL", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Error", description: "Failed to test connection", variant: "destructive" }),
  });

  const syncToGhlMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ghl/sync-all-to-ghl"),
    onSuccess: () => {
      toast({ title: "Sync Started", description: "Pushing contacts to GHL" });
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/sync-status"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const syncHotLeadsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ghl/sync-hot-leads", { limit: 100 }),
    onSuccess: () => {
      toast({ title: "Hot Lead Sync Started", description: "Syncing up to 100 hot lead contacts to GHL" });
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/sync-status"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { data: backfillStatus, refetch: refetchBackfillStatus } = useQuery<BackfillStatus>({
    queryKey: ["/api/admin/backfill-ghl-contacts/status"],
    refetchInterval: 0,
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/backfill-ghl-contacts");
      return res.json() as Promise<BackfillResult>;
    },
    onSuccess: (data) => {
      setBackfillResult(data);
      refetchBackfillStatus();
      toast({
        title: "Backfill Complete",
        description: `${data.results.matched} matched, ${data.results.notFound} not in GHL, ${data.results.errors} errors`,
      });
    },
    onError: () => toast({ title: "Backfill Failed", description: "Could not run GHL contact ID backfill", variant: "destructive" }),
  });

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="ghlsettings-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const StatusIndicator = ({ configured }: { configured: boolean }) =>
    configured ? (
      <CheckCircle2 className="w-5 h-5 text-green-500" />
    ) : (
      <XCircle className="w-5 h-5 text-red-500" />
    );

  return (
    <div className="space-y-6" data-testid="ghlsettings-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold" data-testid="text-ghlsettings-title">GHL Integration Settings</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Manage your GoHighLevel integration and communication settings</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => testConnectionMutation.mutate()}
            disabled={testConnectionMutation.isPending}
            className="gap-2"
            data-testid="button-test-connection"
          >
            {testConnectionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Test Connection
          </Button>
          <Button
            variant="outline"
            onClick={() => syncHotLeadsMutation.mutate()}
            disabled={syncHotLeadsMutation.isPending}
            className="gap-2"
            data-testid="button-sync-hot-leads"
          >
            {syncHotLeadsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Sync Hot Leads
          </Button>
          <Button
            variant="outline"
            onClick={() => syncToGhlMutation.mutate()}
            disabled={syncToGhlMutation.isPending}
            className="gap-2"
            data-testid="button-sync-all"
          >
            {syncToGhlMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            Sync All
          </Button>
        </div>
      </div>

      {adminHealth && (() => {
        const triState: "ok" | "degraded" | "down" =
          adminHealth.status === "ok" && (adminHealth.failureCount ?? 0) === 0 ? "ok" :
          adminHealth.status === "ok" ? "degraded" : "down";
        return (
          <div
            data-testid="card-ghl-admin-health"
            className={`flex items-start gap-4 p-4 rounded-lg border text-sm ${
              triState === "ok"
                ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100"
                : triState === "degraded"
                ? "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100"
                : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100"
            }`}
          >
            {triState === "ok"
              ? <CheckCircle2 className="w-5 h-5 shrink-0 text-green-600 dark:text-green-400 mt-0.5" />
              : triState === "degraded"
              ? <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              : <XCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                {triState === "ok" ? "GHL Connected — All Systems Healthy" :
                 triState === "degraded" ? `GHL Connected — ${adminHealth.failureCount} failure${adminHealth.failureCount !== 1 ? "s" : ""} in last 24h` :
                 adminHealth.status === "unconfigured" ? "GHL Not Configured" : "GHL Token Expired or Rejected"}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs opacity-80">
                <span>Last sync: {adminHealth.lastSync ? new Date(adminHealth.lastSync).toLocaleString() : "No data yet"}</span>
                <span>Failures (24h): {adminHealth.failureCount ?? 0}</span>
                {adminHealth.latencyMs != null && <span>Latency: {adminHealth.latencyMs}ms</span>}
                {adminHealth.locationName && <span>Location: {adminHealth.locationName}</span>}
              </div>
              {adminHealth.status !== "ok" && adminHealth.error && (
                <p className="text-xs mt-1 opacity-80">{adminHealth.error}</p>
              )}
            </div>
          </div>
        );
      })()}

      {healthResult && (
        <Alert variant={healthResult.connected ? "default" : "destructive"} data-testid="alert-health-result">
          {healthResult.connected ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          <AlertDescription>
            {healthResult.connected
              ? `Connected to GHL. Location: ${healthResult.locationName}. Latency: ${healthResult.latencyMs}ms.`
              : `Connection failed: ${healthResult.error}`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-ghl-connection">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Connection Status</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={healthResult?.connected ?? status?.configured ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-connection-status">
                {healthResult?.connected ? "Connected" : status?.configured ? "Configured" : "Not Configured"}
              </span>
            </div>
            {healthResult?.locationName && (
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-ghl-location-name">{healthResult.locationName}</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-apikey">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API Key</CardTitle>
            <Key className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasApiKey ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-apikey-status">
                {status?.hasApiKey ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-locationid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Location ID</CardTitle>
            <MapPin className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasLocationId ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-locationid-status">
                {status?.hasLocationId ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-calendarid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Calendar ID</CardTitle>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasCalendarId ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-calendarid-status">
                {status?.hasCalendarId ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {syncStatus && (
        <Card data-testid="card-ghl-sync-status">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Sync Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Contacts</p>
                <p className="text-lg font-semibold" data-testid="text-sync-total">{syncStatus.totalContacts}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Synced to GHL</p>
                <p className="text-lg font-semibold text-green-600" data-testid="text-sync-synced">{syncStatus.syncedToGhl}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Unsynced</p>
                <p className="text-lg font-semibold text-amber-600" data-testid="text-sync-unsynced">{syncStatus.unsyncedToGhl}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Sync</p>
                <p className="text-sm font-medium" data-testid="text-sync-last">
                  {syncStatus.lastSyncTo?.timestamp
                    ? new Date(syncStatus.lastSyncTo.timestamp).toLocaleString()
                    : "Never"}
                </p>
              </div>
            </div>
            {syncStatus.hotLeadSync && (
              <div className="mt-3 pt-3 border-t text-sm" data-testid="text-hot-lead-sync-result">
                <p className="text-muted-foreground">Last Hot Lead Sync: {new Date(syncStatus.hotLeadSync.timestamp).toLocaleString()}</p>
                <p>{syncStatus.hotLeadSync.synced} synced, {syncStatus.hotLeadSync.failed} failed of {syncStatus.hotLeadSync.total} total</p>
              </div>
            )}
            {syncStatus.hotLeadEnrollment && (
              <div className="mt-2 text-sm" data-testid="text-hot-lead-enrollment-result">
                <p className="text-muted-foreground">Last Hot Lead Enrollment: {new Date(syncStatus.hotLeadEnrollment.timestamp).toLocaleString()}</p>
                <p>{syncStatus.hotLeadEnrollment.enrolled} enrolled, {syncStatus.hotLeadEnrollment.skipped} skipped, {syncStatus.hotLeadEnrollment.blocked} blocked</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {syncDashboard && (
        <Card data-testid="card-sync-dashboard">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Sync Health Dashboard</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Contacts</p>
                <p className="text-lg font-semibold" data-testid="text-dashboard-contacts">{syncDashboard.totalContacts}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Synced Contacts</p>
                <p className="text-lg font-semibold text-green-600" data-testid="text-dashboard-synced">{syncDashboard.syncedToGhl}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Unsynced</p>
                <p className="text-lg font-semibold text-amber-600" data-testid="text-dashboard-unsynced">{syncDashboard.unsyncedToGhl}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Deals</p>
                <p className="text-lg font-semibold" data-testid="text-dashboard-deals">{syncDashboard.totalDeals}</p>
              </div>
            </div>

            {Object.keys(syncDashboard.entityStatuses || {}).length > 0 && (
              <Table data-testid="table-entity-sync-status">
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Last Sync</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Synced</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(syncDashboard.entityStatuses).map(([entityType, status]) => (
                    <TableRow key={entityType} data-testid={`row-sync-entity-${entityType}`}>
                      <TableCell className="text-sm font-medium capitalize">{entityType}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Never"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {status.lastSyncDirection || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-green-600" data-testid={`text-sync-count-${entityType}`}>
                        {status.syncedCount || 0}
                        {status.localCount != null && (
                          <span className="text-muted-foreground ml-1">/ {status.localCount} local</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(status.errorCount || 0) > 0 ? (
                          <span className="text-red-600 flex items-center gap-1" data-testid={`text-error-count-${entityType}`}>
                            <AlertTriangle className="w-3 h-3" />
                            {status.errorCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {status.lastError ? (
                          <Badge variant="destructive" className="text-xs" data-testid={`badge-sync-error-${entityType}`}>
                            Error
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-xs">
                            OK
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {Object.keys(syncDashboard.entityStatuses || {}).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-entity-sync">
                No entity sync data yet. Sync operations will appear here once performed.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-ghl-instructions">
        <CardHeader>
          <CardTitle className="text-base">Configuration Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-ghl-instructions">
            To enable the GoHighLevel integration, set the following environment secrets in your Replit project:
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Key className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_API_KEY</code>
              <span className="text-muted-foreground">- Your GoHighLevel API key</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_LOCATION_ID</code>
              <span className="text-muted-foreground">- Your GHL location identifier</span>
            </li>
            <li className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_CALENDAR_ID</code>
              <span className="text-muted-foreground">- Your GHL calendar identifier</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="card-ghl-activity">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Recent GHL Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !activity || activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-ghl-activity-empty">
              No recent GHL activity
            </p>
          ) : (
            <Table data-testid="table-ghl-activity">
              <TableHeader>
                <TableRow>
                  <TableHead>Direction</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-ghl-activity-${entry.id}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {entry.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{entry.channel}</TableCell>
                    <TableCell className="text-sm">{entry.subject || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={entry.status === "sent" ? "default" : "secondary"} className="text-xs">
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-message-templates">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Message Templates</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {templatesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-templates-empty">
              No message templates configured
            </p>
          ) : (
            <Table data-testid="table-message-templates">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                    <TableCell className="text-sm font-medium">{t.name}</TableCell>
                    <TableCell className="text-sm">{t.category}</TableCell>
                    <TableCell className="text-sm">{t.channel}</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? "default" : "secondary"} className="text-xs">
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-ghl-backfill">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">GHL Contact ID Backfill</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending || (backfillStatus?.missingGhlId === 0)}
              className="gap-2"
              data-testid="button-run-backfill"
            >
              {backfillMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {backfillMutation.isPending ? "Running…" : "Run Backfill"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Looks up existing GHL contacts by email for any local contacts missing a GHL Contact ID.
            Run this once after importing contacts or rotating your GHL token.
          </p>
          {backfillStatus && (
            <div className="flex gap-6 text-sm">
              <span data-testid="text-backfill-total">Total contacts: <strong>{backfillStatus.totalContacts}</strong></span>
              <span data-testid="text-backfill-missing">
                Missing GHL ID:{" "}
                <strong className={backfillStatus.missingGhlId > 0 ? "text-amber-600" : "text-green-600"}>
                  {backfillStatus.missingGhlId}
                </strong>
              </span>
            </div>
          )}
          {backfillResult && (
            <div className="rounded-md border p-3 bg-muted/30 space-y-2" data-testid="card-backfill-result">
              <div className="flex gap-4 text-sm font-medium flex-wrap">
                <span className="text-green-600">✓ Matched: {backfillResult.results.matched}</span>
                <span className="text-muted-foreground">Not found: {backfillResult.results.notFound}</span>
                {backfillResult.results.errors > 0 && (
                  <span className="text-red-600">Errors: {backfillResult.results.errors}</span>
                )}
                <span className="text-muted-foreground">Total scanned: {backfillResult.results.total}</span>
              </div>
              {backfillResult.results.errors > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {backfillResult.log
                    .filter(l => l.status === "error")
                    .map((l, i) => (
                      <p key={i} className="text-xs text-red-600">{l.email}: {l.error}</p>
                    ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-sla-configs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">SLA Configurations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {slaLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !slaConfigs || slaConfigs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-sla-empty">
              No SLA configurations defined
            </p>
          ) : (
            <Table data-testid="table-sla-configs">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Max Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slaConfigs.map((sla) => (
                  <TableRow key={sla.id} data-testid={`row-sla-${sla.id}`}>
                    <TableCell className="text-sm font-medium">{sla.name}</TableCell>
                    <TableCell className="text-sm">{sla.entityType}</TableCell>
                    <TableCell className="text-sm">{sla.stage || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {sla.maxDurationMinutes >= 60
                        ? `${Math.floor(sla.maxDurationMinutes / 60)}h ${sla.maxDurationMinutes % 60}m`
                        : `${sla.maxDurationMinutes}m`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sla.isActive ? "default" : "secondary"} className="text-xs">
                        {sla.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
