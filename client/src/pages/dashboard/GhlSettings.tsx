import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Settings, CheckCircle2, XCircle, Key, MapPin, Calendar, Activity, Mail, Clock, Zap, ArrowRightLeft, Send, Database, AlertTriangle, RefreshCw, Shield, ShieldAlert, ShieldCheck, GitBranch } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GhlActivityLog, MessageTemplate, SlaConfig } from "@shared/schema";

// Local stage names that map to GHL pipeline stages
const LOCAL_STAGE_NAMES = [
  "New Lead", "Statement Received", "Review In Progress", "Call Booked",
  "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Nurture / Not Now",
  "Closed Won", "Closed Lost", "Contract Sent", "Application Started",
  "Underwriting Submitted", "Approved", "Terminal Ordered", "Go-Live Scheduled",
  "Live (First Batch)", "Active (7 Days)", "Active (30 Days)",
];

interface AlignmentRow {
  localName: string;
  ghlId: string | null;
  ghlName: string | null;
  score: number;
  method: "exact" | "fuzzy" | "none";
  override?: string;
}

interface PipelineStagesResult {
  pipelineId: string | null;
  ghlStages: Array<{ name: string; id: string }>;
  alignment: AlignmentRow[];
  dbOverrides: Record<string, string>;
  envOverrides: Record<string, string>;
}

interface StageMapResult {
  stageMap: Record<string, string>;
}

interface GhlStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasPrivateToken: boolean;
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
  // Wave 7: Sync Authority Guard fields
  circuitState?: {
    open: boolean;
    consecutiveFailures: number;
    threshold: number;
    lastTripAt: string | null;
  };
  failedSyncsLast24h?: number;
  missingGhlContactId?: number;
  fieldWriteErrors422?: number;
  recent422Errors?: Array<{ contactId: number | null; operation: string | null; httpStatus: number | null; createdAt: string | null }>;
  webhookEventsLast24h?: number;
  permissionCheckCallsLast24h?: number;
  optOutEventsLast24h?: number;
  hasPermissionFieldGap?: boolean;
}

interface CircuitStatus {
  circuitOpen: boolean;
  consecutiveFailures: number;
  threshold: number;
  lastTripAt: string | null;
  lastTripReason: string | null;
  lastResetAt: string | null;
  ghlWebhookSecretConfigured: boolean;
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
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || user?.role === "manager";
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [forceSyncContactId, setForceSyncContactId] = useState("");
  const [draftStageMap, setDraftStageMap] = useState<Record<string, string>>({});

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

  const { data: circuitStatus } = useQuery<CircuitStatus>({
    queryKey: ["/api/ghl/circuit-status"],
    refetchInterval: 30000,
    retry: false,
  });

  const forceSyncPermsMutation = useMutation({
    mutationFn: async (contactId: string) => {
      // Reuse the existing sync-contact endpoint (admin/manager only by UI convention)
      const res = await apiRequest("POST", "/api/ghl/sync-contact", { contactId: Number(contactId) });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Permission Sync Done", description: `GHL Contact ID: ${data.ghlContactId}` });
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/sync-dashboard"] });
    },
    onError: (err: any) => toast({ title: "Sync Failed", description: err.message, variant: "destructive" }),
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

  // ── Stage Mapping ──────────────────────────────────────────────────────────
  const { data: pipelineStages, isLoading: stagesLoading, refetch: refetchStages } = useQuery<PipelineStagesResult>({
    queryKey: ["/api/admin/ghl/pipeline-stages"],
    retry: false,
  });

  const { data: savedStageMap } = useQuery<StageMapResult>({
    queryKey: ["/api/admin/ghl/stage-map"],
  });

  // Seed draft from saved DB map whenever it loads
  useEffect(() => {
    if (savedStageMap?.stageMap) {
      setDraftStageMap(savedStageMap.stageMap);
    }
  }, [savedStageMap]);

  const saveStageMapMutation = useMutation({
    mutationFn: async (stageMap: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/admin/ghl/stage-map", { stageMap });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl/stage-map"] });
      toast({ title: "Stage Map Saved", description: "GHL pipeline stage mapping updated." });
    },
    onError: () => toast({ title: "Save Failed", description: "Could not save stage mapping.", variant: "destructive" }),
  });

  const syncStagesToGhlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ghl/sync-stages");
      return res.json() as Promise<{ created: number; skipped: number; failed: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl/pipeline-stages"] });
      toast({
        title: "Stages Synced",
        description: `${data.created} created in GHL, ${data.skipped} already matched, ${data.failed} failed.`,
      });
    },
    onError: (err: any) => toast({ title: "Sync Failed", description: err.message || "Could not sync stages to GHL.", variant: "destructive" }),
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
            <CardTitle className="text-sm font-medium text-muted-foreground">API Token</CardTitle>
            <Key className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={(status?.hasApiKey || status?.hasPrivateToken) ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-apikey-status">
                {(status?.hasApiKey || status?.hasPrivateToken) ? "Configured" : "Not Set"}
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

            {/* Wave 7: Sync Authority Guard Metrics */}
            {(syncDashboard.circuitState || syncDashboard.failedSyncsLast24h !== undefined) && (
              <div className="mt-4 pt-4 border-t space-y-3" data-testid="section-sync-authority-guard">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  Sync Authority Guard (Wave 7)
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Circuit State</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {syncDashboard.circuitState?.open
                        ? <ShieldAlert className="w-4 h-4 text-red-500" />
                        : <ShieldCheck className="w-4 h-4 text-green-500" />}
                      <span className={`font-semibold ${syncDashboard.circuitState?.open ? "text-red-600" : "text-green-600"}`}
                        data-testid="text-circuit-state">
                        {syncDashboard.circuitState?.open ? "OPEN" : "Closed"}
                      </span>
                      {syncDashboard.circuitState && (
                        <span className="text-muted-foreground text-xs">
                          ({syncDashboard.circuitState.consecutiveFailures}/{syncDashboard.circuitState.threshold})
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Failed Syncs (24h)</p>
                    <p className={`font-semibold ${(syncDashboard.failedSyncsLast24h ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}
                      data-testid="text-failed-syncs-24h">
                      {syncDashboard.failedSyncsLast24h ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Missing GHL IDs</p>
                    <p className={`font-semibold ${(syncDashboard.missingGhlContactId ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}
                      data-testid="text-missing-ghl-ids">
                      {syncDashboard.missingGhlContactId ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Opt-Out Events (24h)</p>
                    <p className="font-semibold" data-testid="text-optout-events">
                      {syncDashboard.optOutEventsLast24h ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Webhook Events (24h)</p>
                    <p className="font-semibold" data-testid="text-webhook-events">
                      {syncDashboard.webhookEventsLast24h ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Permission Checks (24h)</p>
                    <p className="font-semibold" data-testid="text-perm-checks">
                      {syncDashboard.permissionCheckCallsLast24h ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Field Write Errors (422)</p>
                    <p className={`font-semibold ${(syncDashboard.fieldWriteErrors422 ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}
                      data-testid="text-field-write-errors">
                      {syncDashboard.fieldWriteErrors422 ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">GHL Webhook Secret</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {circuitStatus?.ghlWebhookSecretConfigured
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`text-xs font-medium ${circuitStatus?.ghlWebhookSecretConfigured ? "text-green-600" : "text-red-600"}`}
                        data-testid="text-webhook-secret-status">
                        {circuitStatus?.ghlWebhookSecretConfigured ? "Set" : "Not Set"}
                      </span>
                    </div>
                  </div>
                </div>

                {syncDashboard.hasPermissionFieldGap && (
                  <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/30" data-testid="alert-permission-field-gap">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
                      <strong>Permission field gap detected:</strong> GHL returned 422 errors when writing lb_* custom fields. This means GHL workflows may not see the contactability gate fields. Go to GHL → Settings → Custom Fields and create the required lb_* fields, then run a force-sync below.
                    </AlertDescription>
                  </Alert>
                )}

                {syncDashboard.circuitState?.lastTripAt && (
                  <div className="text-xs text-muted-foreground">
                    <p>Last circuit trip: {new Date(syncDashboard.circuitState.lastTripAt).toLocaleString()}</p>
                    {circuitStatus?.lastTripReason && (
                      <p className="text-amber-700 dark:text-amber-400 mt-0.5" data-testid="text-circuit-trip-reason">Reason: {circuitStatus.lastTripReason}</p>
                    )}
                  </div>
                )}

                {/* Recent 422 error rows (last 10) */}
                {(syncDashboard.recent422Errors?.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Recent 422 Field-Write Errors (last 10):</p>
                    <div className="overflow-x-auto rounded border border-amber-200 dark:border-amber-800">
                      <table className="text-xs w-full" data-testid="table-recent-422-errors">
                        <thead className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                          <tr>
                            <th className="px-2 py-1 text-left">Contact ID</th>
                            <th className="px-2 py-1 text-left">Operation</th>
                            <th className="px-2 py-1 text-left">Status</th>
                            <th className="px-2 py-1 text-left">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {syncDashboard.recent422Errors!.map((row, i) => (
                            <tr key={i} className="border-t border-amber-100 dark:border-amber-900">
                              <td className="px-2 py-1">{row.contactId ?? "—"}</td>
                              <td className="px-2 py-1">{row.operation ?? "—"}</td>
                              <td className="px-2 py-1">{row.httpStatus ?? 422}</td>
                              <td className="px-2 py-1">{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Wave 7: Force Permission Sync card — admin/manager only */}
      {isAdminOrManager && <Card data-testid="card-force-permission-sync">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Force Contact Permission Sync</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-push Replit permission fields (lb_do_not_contact, lb_consent_tier, lb_can_email, etc.) to GHL for a specific contact. Use this after creating lb_* custom fields in GHL or after resolving a 422 field write error.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Contact ID (number)"
              value={forceSyncContactId}
              onChange={e => setForceSyncContactId(e.target.value)}
              className="max-w-[200px]"
              data-testid="input-force-sync-contact-id"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => forceSyncPermsMutation.mutate(forceSyncContactId)}
              disabled={forceSyncPermsMutation.isPending || !forceSyncContactId.trim()}
              className="gap-2"
              data-testid="button-force-sync-perms"
            >
              {forceSyncPermsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync Permissions
            </Button>
          </div>
        </CardContent>
      </Card>}

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

      {/* ── GHL Pipeline Stage Mapping ───────────────────────────────────────── */}
      <Card data-testid="card-ghl-stage-map">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Pipeline Stage Mapping</CardTitle>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchStages()}
                disabled={stagesLoading}
                className="gap-2"
                data-testid="button-refresh-stages"
              >
                {stagesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Refresh
              </Button>
              {user?.role === "admin" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncStagesToGhlMutation.mutate()}
                  disabled={syncStagesToGhlMutation.isPending}
                  className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                  data-testid="button-sync-stages-to-ghl"
                >
                  {syncStagesToGhlMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
                  Sync Stages to GHL
                </Button>
              )}
              {Object.keys(draftStageMap).length > 0 && (
                <Button
                  size="sm"
                  onClick={() => saveStageMapMutation.mutate(draftStageMap)}
                  disabled={saveStageMapMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-stage-map"
                >
                  {saveStageMapMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Save Overrides
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Stages are matched automatically to your GHL pipeline by name. If any stages show as unmatched
            (red), click <strong>Sync Stages to GHL</strong> — it pushes the missing stages directly into
            your GHL pipeline and wires up the IDs automatically. No manual UUID entry needed.
          </p>

          {pipelineStages?.pipelineId && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 flex gap-4 flex-wrap" data-testid="text-pipeline-id">
              <span>Pipeline: <code className="font-mono">{pipelineStages.pipelineId}</code></span>
              <span>{pipelineStages.ghlStages.length} GHL stage{pipelineStages.ghlStages.length !== 1 ? "s" : ""} discovered</span>
              {(() => {
                const matched = pipelineStages.alignment.filter(r => r.ghlId || r.override).length;
                const total = pipelineStages.alignment.length;
                return <span className={matched === total ? "text-green-600" : "text-yellow-600"}>{matched}/{total} local stages resolved</span>;
              })()}
            </div>
          )}

          {pipelineStages && Object.keys(pipelineStages.envOverrides).length > 0 && (
            <Alert data-testid="alert-env-overrides">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-xs">
                <strong>GHL_STAGE_ID_MAP</strong> env var overrides {Object.keys(pipelineStages.envOverrides).length} stage(s) — env takes highest priority.
              </AlertDescription>
            </Alert>
          )}

          {stagesLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading GHL pipeline stages…
            </div>
          )}

          {pipelineStages && !stagesLoading && (
            <Table data-testid="table-stage-map">
              <TableHeader>
                <TableRow>
                  <TableHead>Local Stage</TableHead>
                  <TableHead>Auto-matched GHL Stage</TableHead>
                  <TableHead className="w-8">Conf.</TableHead>
                  <TableHead>Override UUID (if needed)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipelineStages.alignment.map((row) => {
                  const effectiveId = row.override || row.ghlId;
                  const isExact = row.method === "exact";
                  const isFuzzy = row.method === "fuzzy";
                  const isNone = row.method === "none" && !row.override;
                  const hasEnvOverride = !!pipelineStages.envOverrides[row.localName];
                  const slug = row.localName.replace(/\W+/g, "-").toLowerCase();
                  return (
                    <TableRow
                      key={row.localName}
                      data-testid={`row-stage-${slug}`}
                      className={isNone && !row.override ? "bg-red-50/40 dark:bg-red-950/20" : ""}
                    >
                      <TableCell className="text-sm font-medium">{row.localName}</TableCell>
                      <TableCell>
                        {hasEnvOverride ? (
                          <span className="text-xs text-blue-600 font-mono">{pipelineStages.envOverrides[row.localName].slice(0, 12)}… (env)</span>
                        ) : effectiveId ? (
                          <div>
                            <span className="text-xs font-medium">{row.ghlName || "override"}</span>
                            <span className="text-xs text-muted-foreground font-mono ml-2">{effectiveId.slice(0, 10)}…</span>
                          </div>
                        ) : (
                          <span className="text-xs text-red-500">⚠ Not matched — enter UUID below</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasEnvOverride ? (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">env</Badge>
                        ) : isExact ? (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">exact</Badge>
                        ) : isFuzzy ? (
                          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">{Math.round(row.score * 100)}%</Badge>
                        ) : row.override ? (
                          <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">manual</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-red-500 border-red-300">none</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 items-center">
                          <Input
                            className="h-7 text-xs font-mono w-52"
                            placeholder={isNone ? "Paste GHL stage UUID…" : "Override (optional)"}
                            value={draftStageMap[row.localName] || ""}
                            onChange={(e) => {
                              const val = e.target.value.trim();
                              setDraftStageMap(prev => {
                                const n = { ...prev };
                                if (val) n[row.localName] = val; else delete n[row.localName];
                                return n;
                              });
                            }}
                            data-testid={`input-override-${slug}`}
                          />
                          {draftStageMap[row.localName] && (
                            <button
                              className="text-muted-foreground hover:text-foreground text-xs px-1"
                              onClick={() => setDraftStageMap(prev => { const n = { ...prev }; delete n[row.localName]; return n; })}
                              title="Clear override"
                            >✕</button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {!pipelineStages && !stagesLoading && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              GHL not connected or pipeline not yet discovered. Click <strong>Refresh from GHL</strong> to load.
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
