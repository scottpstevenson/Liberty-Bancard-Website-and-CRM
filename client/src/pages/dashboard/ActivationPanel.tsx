import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Loader2, Play, Square, Pause, Shield, Activity, Server, Mail, AlertTriangle, CheckCircle2, XCircle, Zap, RefreshCw, Radio, ArrowRightLeft, Plus, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface AppHealthData {
  ok: boolean;
  uptime: number;
  db: string;
  session: string;
  timestamp: string;
}

interface GhlHealthData {
  configured: boolean;
  authTest: boolean;
  hasWebhookSecret: boolean;
}

interface SdrHealthData {
  globalPaused: boolean;
  globalPauseReason: string;
  sendingIdentityCount: number;
  activeIdentityCount: number;
  eligibleLeadCount: number;
  recentFailures24h: number;
  orchestratorRunning: boolean;
  lastSweepTime: string | null;
  webhookLastReceived: string | null;
}

interface FeatureFlagsData {
  [key: string]: boolean | number | string;
}

interface SendingIdentity {
  id: number;
  label: string;
  emailAddress: string;
  status: string;
  dailyLimit: number;
  sentToday: number;
  healthScore: number | null;
}

interface ChannelAttempt {
  id: number;
  sentAt: string | null;
  channel: string;
  status: string;
  leadStateId: number;
  subject: string | null;
  body: string | null;
}

interface LeadEvent {
  id: number;
  createdAt: string | null;
  eventType: string;
  leadStateId: number;
  decisionReason: string | null;
}

interface StuckLead {
  id: number;
  companyName: string | null;
  stage: string;
  nextActionType: string | null;
  nextActionAt: string | null;
  updatedAt: string | null;
}

interface DailyChannelLimit {
  sent?: number;
  made?: number;
  limit: number;
}

interface OrchestratorStatusData {
  running: boolean;
  enabled: boolean;
  webhookFailures: number;
  dailyLimits: {
    email?: DailyChannelLimit;
    sms?: DailyChannelLimit;
    call?: DailyChannelLimit;
  };
}

interface BridgeResultItem {
  id: number | string;
  name: string;
  status: string;
  reason?: string;
  vertical?: string;
}

interface BridgeResponse {
  dryRun: boolean;
  source: string;
  totalProcessed: number;
  created: number;
  deduped: number;
  skipped: number;
  errors: number;
  results: BridgeResultItem[];
}

interface IdentityFormState {
  label: string;
  emailAddress: string;
  dailyLimit: string;
  status: string;
}

const emptyIdentityForm: IdentityFormState = { label: "", emailAddress: "", dailyLimit: "50", status: "active" };

export default function ActivationPanel() {
  const { toast } = useToast();
  const [bridgeSource, setBridgeSource] = useState("contacts");
  const [bridgeLimit, setBridgeLimit] = useState("50");
  const [bridgeDryRun, setBridgeDryRun] = useState(true);
  const [bridgeVertical, setBridgeVertical] = useState("");
  const [bridgeGeo, setBridgeGeo] = useState("");
  const [bridgeResults, setBridgeResults] = useState<BridgeResponse | null>(null);
  const [identityForm, setIdentityForm] = useState<IdentityFormState>(emptyIdentityForm);
  const [editingIdentityId, setEditingIdentityId] = useState<number | null>(null);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);

  const healthQuery = useQuery<SdrHealthData>({ queryKey: ["/api/sdr/health"] });
  const ghlHealthQuery = useQuery<GhlHealthData>({ queryKey: ["/api/ghl/health"] });
  const appHealthQuery = useQuery<AppHealthData>({ queryKey: ["/api/health"] });
  const flagsQuery = useQuery<FeatureFlagsData>({ queryKey: ["/api/sdr/flags"] });
  const identitiesQuery = useQuery<SendingIdentity[]>({ queryKey: ["/api/sdr/sending-identities"] });
  const attemptsQuery = useQuery<ChannelAttempt[]>({ queryKey: ["/api/sdr/activation/recent-attempts"] });
  const eventsQuery = useQuery<LeadEvent[]>({ queryKey: ["/api/sdr/activation/recent-events"] });
  const stuckQuery = useQuery<StuckLead[]>({ queryKey: ["/api/sdr/activation/stuck-leads"] });
  const orchestratorQuery = useQuery<OrchestratorStatusData>({ queryKey: ["/api/sdr/orchestrator/status"] });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/pause-all", { reason: "Manual pause from activation panel" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/orchestrator/status"] });
      toast({ title: "All outbound paused" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/resume-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/orchestrator/status"] });
      toast({ title: "Outbound resumed" });
    },
  });

  const startOrchestratorMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/orchestrator/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/orchestrator/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      toast({ title: "Orchestrator started" });
    },
    onError: (err: Error) => toast({ title: "Failed to start", description: err.message, variant: "destructive" }),
  });

  const stopOrchestratorMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/orchestrator/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/orchestrator/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      toast({ title: "Orchestrator stopped" });
    },
  });

  const ghlTestMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/bootstrap-ghl"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/health"] });
      toast({ title: "GHL connection tested & bootstrapped" });
    },
    onError: (err: Error) => toast({ title: "GHL test failed", description: err.message, variant: "destructive" }),
  });

  const bridgeMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/sdr/bridge", {
        source: bridgeSource,
        limit: parseInt(bridgeLimit, 10),
        dryRun: bridgeDryRun,
        vertical: bridgeVertical || undefined,
        geography: bridgeGeo || undefined,
      });
      return resp.json() as Promise<BridgeResponse>;
    },
    onSuccess: (data) => {
      setBridgeResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      toast({ title: data.dryRun ? "Dry run complete" : "Bridge complete", description: `${data.created} created, ${data.deduped} deduped, ${data.skipped} skipped` });
    },
    onError: (err: Error) => toast({ title: "Bridge failed", description: err.message, variant: "destructive" }),
  });

  const createIdentityMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sdr/sending-identities", {
      label: identityForm.label,
      emailAddress: identityForm.emailAddress,
      dailyLimit: parseInt(identityForm.dailyLimit, 10),
      status: identityForm.status,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      setIdentityDialogOpen(false);
      setIdentityForm(emptyIdentityForm);
      toast({ title: "Identity created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create identity", description: err.message, variant: "destructive" }),
  });

  const updateIdentityMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/sdr/sending-identities/${editingIdentityId}`, {
      label: identityForm.label,
      emailAddress: identityForm.emailAddress,
      dailyLimit: parseInt(identityForm.dailyLimit, 10),
      status: identityForm.status,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      setIdentityDialogOpen(false);
      setEditingIdentityId(null);
      setIdentityForm(emptyIdentityForm);
      toast({ title: "Identity updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update identity", description: err.message, variant: "destructive" }),
  });

  const health = healthQuery.data;
  const ghlHealth = ghlHealthQuery.data;
  const appHealth = appHealthQuery.data;
  const flags = flagsQuery.data;
  const identities = identitiesQuery.data || [];
  const attempts = attemptsQuery.data || [];
  const events = eventsQuery.data || [];
  const stuckLeads = stuckQuery.data || [];
  const orchestratorStatus = orchestratorQuery.data;

  const refreshAll = () => {
    ["/api/sdr/health", "/api/ghl/health", "/api/health", "/api/sdr/flags", "/api/sdr/sending-identities", "/api/sdr/activation/recent-attempts", "/api/sdr/activation/recent-events", "/api/sdr/activation/stuck-leads", "/api/sdr/orchestrator/status"]
      .forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
  };

  const openCreateIdentity = () => {
    setEditingIdentityId(null);
    setIdentityForm(emptyIdentityForm);
    setIdentityDialogOpen(true);
  };

  const openEditIdentity = (identity: SendingIdentity) => {
    setEditingIdentityId(identity.id);
    setIdentityForm({
      label: identity.label,
      emailAddress: identity.emailAddress,
      dailyLimit: String(identity.dailyLimit),
      status: identity.status,
    });
    setIdentityDialogOpen(true);
  };

  const handleIdentitySave = () => {
    if (editingIdentityId) {
      updateIdentityMutation.mutate();
    } else {
      createIdentityMutation.mutate();
    }
  };

  const identitySaving = createIdentityMutation.isPending || updateIdentityMutation.isPending;

  return (
    <div className="space-y-6" data-testid="activation-panel">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Activation Control Panel</h1>
          <p className="text-muted-foreground">Day 1 Go-Live Command Center</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-refresh-all">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh All
          </Button>
          {health?.globalPaused ? (
            <Button variant="default" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending} data-testid="button-resume-all">
              <Play className="w-4 h-4 mr-1" /> Resume All
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending} data-testid="button-pause-all">
              <Pause className="w-4 h-4 mr-1" /> Pause All Outbound
            </Button>
          )}
        </div>
      </div>

      {health?.globalPaused && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <span className="font-medium text-destructive" data-testid="text-pause-reason">GLOBAL PAUSE ACTIVE: {health.globalPauseReason}</span>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="status">
        <TabsList data-testid="tabs-activation">
          <TabsTrigger value="status" data-testid="tab-status">System Status</TabsTrigger>
          <TabsTrigger value="bridge" data-testid="tab-bridge">Bridge</TabsTrigger>
          <TabsTrigger value="orchestrator" data-testid="tab-orchestrator">Orchestrator</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-stuck">Stuck Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Server className="w-4 h-4" /> App Health</CardTitle>
              </CardHeader>
              <CardContent>
                {appHealth ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span>Database</span><Badge variant={appHealth.db === "connected" ? "default" : "destructive"} data-testid="badge-db-status">{appHealth.db}</Badge></div>
                    <div className="flex justify-between"><span>Session Store</span><Badge variant={appHealth.session === "connected" ? "default" : "destructive"} data-testid="badge-session-status">{appHealth.session}</Badge></div>
                    <div className="flex justify-between"><span>Uptime</span><span data-testid="text-uptime">{Math.floor((appHealth.uptime || 0) / 60)}m</span></div>
                  </div>
                ) : <Loader2 className="w-4 h-4 animate-spin" />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4" /> GHL Connection</CardTitle>
              </CardHeader>
              <CardContent>
                {ghlHealth ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span>Configured</span><Badge variant={ghlHealth.configured ? "default" : "destructive"} data-testid="badge-ghl-configured">{ghlHealth.configured ? "Yes" : "No"}</Badge></div>
                    <div className="flex justify-between"><span>Auth Test</span><Badge variant={ghlHealth.authTest ? "default" : "secondary"} data-testid="badge-ghl-auth">{ghlHealth.authTest ? "Pass" : "N/A"}</Badge></div>
                    <div className="flex justify-between"><span>Webhook Secret</span><Badge variant={ghlHealth.hasWebhookSecret ? "default" : "secondary"} data-testid="badge-ghl-webhook">{ghlHealth.hasWebhookSecret ? "Set" : "Missing"}</Badge></div>
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => ghlTestMutation.mutate()} disabled={ghlTestMutation.isPending} data-testid="button-test-ghl">
                      {ghlTestMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                      Test & Bootstrap
                    </Button>
                  </div>
                ) : <Loader2 className="w-4 h-4 animate-spin" />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> SDR Health</CardTitle>
              </CardHeader>
              <CardContent>
                {health ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span>Sending Identities</span><span data-testid="text-identity-count">{health.activeIdentityCount}/{health.sendingIdentityCount}</span></div>
                    <div className="flex justify-between"><span>Eligible Leads</span><span data-testid="text-eligible-leads">{health.eligibleLeadCount}</span></div>
                    <div className="flex justify-between"><span>Failures (24h)</span><Badge variant={health.recentFailures24h > 10 ? "destructive" : "secondary"} data-testid="badge-failures">{health.recentFailures24h}</Badge></div>
                    <div className="flex justify-between"><span>Orchestrator</span><Badge variant={health.orchestratorRunning ? "default" : "secondary"} data-testid="badge-orchestrator">{health.orchestratorRunning ? "Running" : "Stopped"}</Badge></div>
                    <div className="flex justify-between"><span>Last Sweep</span><span className="text-xs" data-testid="text-last-sweep">{health.lastSweepTime ? new Date(health.lastSweepTime).toLocaleTimeString() : "Never"}</span></div>
                    <div className="flex justify-between"><span>Webhook Heartbeat</span><span className="text-xs" data-testid="text-webhook-heartbeat">{health.webhookLastReceived ? new Date(health.webhookLastReceived).toLocaleString() : "None"}</span></div>
                  </div>
                ) : <Loader2 className="w-4 h-4 animate-spin" />}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Feature Flags</CardTitle>
            </CardHeader>
            <CardContent>
              {flags ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(flags).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-2 rounded border" data-testid={`flag-${key}`}>
                      <span className="text-xs font-mono">{key}</span>
                      <Badge variant={value === true ? "default" : value === false ? "secondary" : "outline"}>
                        {String(value)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : <Loader2 className="w-4 h-4 animate-spin" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Mail className="w-4 h-4" /> Sending Identities</CardTitle>
                <Dialog open={identityDialogOpen} onOpenChange={setIdentityDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" onClick={openCreateIdentity} data-testid="button-add-identity">
                      <Plus className="w-3 h-3 mr-1" /> Add Identity
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingIdentityId ? "Edit Sending Identity" : "Add Sending Identity"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label>Label</Label>
                        <Input
                          value={identityForm.label}
                          onChange={e => setIdentityForm(f => ({ ...f, label: e.target.value }))}
                          placeholder="e.g. Main Sales"
                          data-testid="input-identity-label"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email Address</Label>
                        <Input
                          type="email"
                          value={identityForm.emailAddress}
                          onChange={e => setIdentityForm(f => ({ ...f, emailAddress: e.target.value }))}
                          placeholder="sales@example.com"
                          data-testid="input-identity-email"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Daily Limit</Label>
                          <Input
                            type="number"
                            value={identityForm.dailyLimit}
                            onChange={e => setIdentityForm(f => ({ ...f, dailyLimit: e.target.value }))}
                            min={1}
                            max={200}
                            data-testid="input-identity-limit"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select value={identityForm.status} onValueChange={v => setIdentityForm(f => ({ ...f, status: v }))}>
                            <SelectTrigger data-testid="select-identity-status"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="paused">Paused</SelectItem>
                              <SelectItem value="warming">Warming</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <DialogClose asChild>
                          <Button variant="outline" data-testid="button-identity-cancel">Cancel</Button>
                        </DialogClose>
                        <Button
                          onClick={handleIdentitySave}
                          disabled={identitySaving || !identityForm.label || !identityForm.emailAddress}
                          data-testid="button-identity-save"
                        >
                          {identitySaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                          {editingIdentityId ? "Update" : "Create"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {identitiesQuery.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-1 pr-4">Label</th>
                        <th className="py-1 pr-4">Email</th>
                        <th className="py-1 pr-4">Status</th>
                        <th className="py-1 pr-4">Daily Limit</th>
                        <th className="py-1 pr-4">Today Sent</th>
                        <th className="py-1 pr-4">Health</th>
                        <th className="py-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {identities.length === 0 ? (
                        <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No sending identities configured</td></tr>
                      ) : identities.map((id) => (
                        <tr key={id.id} className="border-b" data-testid={`identity-row-${id.id}`}>
                          <td className="py-1 pr-4">{id.label}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{id.emailAddress}</td>
                          <td className="py-1 pr-4"><Badge variant={id.status === "active" ? "default" : "secondary"}>{id.status}</Badge></td>
                          <td className="py-1 pr-4">{id.dailyLimit}</td>
                          <td className="py-1 pr-4">{id.sentToday || 0}</td>
                          <td className="py-1 pr-4">{id.healthScore ?? "N/A"}</td>
                          <td className="py-1">
                            <Button size="sm" variant="ghost" onClick={() => openEditIdentity(id)} data-testid={`button-edit-identity-${id.id}`}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bridge" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" /> Bridge Script</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={bridgeSource} onValueChange={setBridgeSource}>
                    <SelectTrigger data-testid="select-bridge-source"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contacts">Contacts</SelectItem>
                      <SelectItem value="sunbiz">Sunbiz Entities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Limit</Label>
                  <Input type="number" value={bridgeLimit} onChange={e => setBridgeLimit(e.target.value)} min={1} max={500} data-testid="input-bridge-limit" />
                </div>
                <div className="space-y-2">
                  <Label>Vertical Filter</Label>
                  <Input placeholder="e.g. Auto, Healthcare..." value={bridgeVertical} onChange={e => setBridgeVertical(e.target.value)} data-testid="input-bridge-vertical" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Geography Filter</Label>
                  <Input placeholder="e.g. Miami, FL..." value={bridgeGeo} onChange={e => setBridgeGeo(e.target.value)} data-testid="input-bridge-geo" />
                </div>
                <div className="flex items-end gap-4">
                  <div className="flex items-center gap-2">
                    <Switch checked={bridgeDryRun} onCheckedChange={setBridgeDryRun} data-testid="switch-dry-run" />
                    <Label>Dry Run</Label>
                  </div>
                  <Button onClick={() => bridgeMutation.mutate()} disabled={bridgeMutation.isPending} data-testid="button-run-bridge">
                    {bridgeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                    {bridgeDryRun ? "Preview" : "Run Bridge"}
                  </Button>
                </div>
              </div>

              {bridgeResults && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-3 flex-wrap">
                    <Badge variant="outline">Source: {bridgeResults.source}</Badge>
                    <Badge variant={bridgeResults.dryRun ? "secondary" : "default"}>{bridgeResults.dryRun ? "DRY RUN" : "LIVE"}</Badge>
                    <Badge variant="outline">Processed: {bridgeResults.totalProcessed}</Badge>
                    <Badge className="bg-green-500/20 text-green-700">Created: {bridgeResults.created}</Badge>
                    <Badge className="bg-yellow-500/20 text-yellow-700">Deduped: {bridgeResults.deduped}</Badge>
                    <Badge className="bg-gray-500/20">Skipped: {bridgeResults.skipped}</Badge>
                    {bridgeResults.errors > 0 && <Badge variant="destructive">Errors: {bridgeResults.errors}</Badge>}
                  </div>
                  <div className="max-h-64 overflow-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left">
                          <th className="py-1 px-2">ID</th>
                          <th className="py-1 px-2">Name</th>
                          <th className="py-1 px-2">Status</th>
                          <th className="py-1 px-2">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bridgeResults.results.map((r, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-1 px-2">{r.id}</td>
                            <td className="py-1 px-2">{r.name}</td>
                            <td className="py-1 px-2">
                              <Badge variant={r.status === "created" || r.status === "would_create" ? "default" : r.status === "error" ? "destructive" : "secondary"} className="text-xs">
                                {r.status}
                              </Badge>
                            </td>
                            <td className="py-1 px-2 text-muted-foreground">{r.reason || r.vertical || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orchestrator" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4" /> Orchestrator Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {orchestratorStatus ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="p-3 border rounded">
                      <div className="text-xs text-muted-foreground">Status</div>
                      <Badge variant={orchestratorStatus.running ? "default" : "secondary"} className="mt-1" data-testid="badge-orchestrator-status">
                        {orchestratorStatus.running ? "Running" : "Stopped"}
                      </Badge>
                    </div>
                    <div className="p-3 border rounded">
                      <div className="text-xs text-muted-foreground">Emails Today</div>
                      <div className="text-lg font-bold" data-testid="text-emails-today">{orchestratorStatus.dailyLimits?.email?.sent || 0} / {orchestratorStatus.dailyLimits?.email?.limit || 200}</div>
                    </div>
                    <div className="p-3 border rounded">
                      <div className="text-xs text-muted-foreground">SMS Today</div>
                      <div className="text-lg font-bold" data-testid="text-sms-today">{orchestratorStatus.dailyLimits?.sms?.sent || 0} / {orchestratorStatus.dailyLimits?.sms?.limit || 100}</div>
                    </div>
                    <div className="p-3 border rounded">
                      <div className="text-xs text-muted-foreground">Calls Today</div>
                      <div className="text-lg font-bold" data-testid="text-calls-today">{orchestratorStatus.dailyLimits?.call?.made || 0} / {orchestratorStatus.dailyLimits?.call?.limit || 50}</div>
                    </div>
                    <div className="p-3 border rounded">
                      <div className="text-xs text-muted-foreground">Webhook Failures</div>
                      <div className="text-lg font-bold" data-testid="text-webhook-failures">
                        <Badge variant={orchestratorStatus.webhookFailures > 10 ? "destructive" : "secondary"}>
                          {orchestratorStatus.webhookFailures}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {!orchestratorStatus.enabled && (
                    <div className="p-2 border border-yellow-500/50 bg-yellow-500/10 rounded text-sm text-yellow-700">
                      <AlertTriangle className="w-4 h-4 inline mr-1" />
                      Orchestrator is disabled via ORCHESTRATOR_ENABLED feature flag. Enable it in environment variables to allow starting.
                    </div>
                  )}
                  <div className="flex gap-2">
                    {orchestratorStatus.running ? (
                      <Button variant="destructive" size="sm" onClick={() => stopOrchestratorMutation.mutate()} disabled={stopOrchestratorMutation.isPending} data-testid="button-stop-orchestrator">
                        <Square className="w-4 h-4 mr-1" /> Stop
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => startOrchestratorMutation.mutate()} disabled={startOrchestratorMutation.isPending || !orchestratorStatus.enabled} data-testid="button-start-orchestrator">
                        <Play className="w-4 h-4 mr-1" /> Start
                      </Button>
                    )}
                  </div>
                </>
              ) : <Loader2 className="w-4 h-4 animate-spin" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Outbound Attempts (50)</CardTitle>
              </CardHeader>
              <CardContent>
                {attemptsQuery.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left">
                          <th className="py-1 px-1">Time</th>
                          <th className="py-1 px-1">Channel</th>
                          <th className="py-1 px-1">Status</th>
                          <th className="py-1 px-1">Lead</th>
                          <th className="py-1 px-1">Subject</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.length === 0 ? (
                          <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No recent attempts</td></tr>
                        ) : attempts.map((a) => (
                          <tr key={a.id} className="border-b" data-testid={`attempt-row-${a.id}`}>
                            <td className="py-1 px-1">{a.sentAt ? new Date(a.sentAt).toLocaleTimeString() : "-"}</td>
                            <td className="py-1 px-1"><Badge variant="outline" className="text-xs">{a.channel}</Badge></td>
                            <td className="py-1 px-1">
                              {a.status === "sent" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                            </td>
                            <td className="py-1 px-1">{a.leadStateId}</td>
                            <td className="py-1 px-1 max-w-32 truncate">{a.subject || a.body?.slice(0, 40) || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Webhook Events (50)</CardTitle>
              </CardHeader>
              <CardContent>
                {eventsQuery.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left">
                          <th className="py-1 px-1">Time</th>
                          <th className="py-1 px-1">Type</th>
                          <th className="py-1 px-1">Lead</th>
                          <th className="py-1 px-1">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.length === 0 ? (
                          <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No recent events</td></tr>
                        ) : events.map((e) => (
                          <tr key={e.id} className="border-b" data-testid={`event-row-${e.id}`}>
                            <td className="py-1 px-1">{e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : "-"}</td>
                            <td className="py-1 px-1"><Badge variant="outline" className="text-xs">{e.eventType}</Badge></td>
                            <td className="py-1 px-1">{e.leadStateId}</td>
                            <td className="py-1 px-1 max-w-48 truncate">{e.decisionReason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="stuck" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Stuck Leads</CardTitle>
            </CardHeader>
            <CardContent>
              {stuckQuery.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left">
                        <th className="py-1 px-2">ID</th>
                        <th className="py-1 px-2">Company</th>
                        <th className="py-1 px-2">Stage</th>
                        <th className="py-1 px-2">Next Action</th>
                        <th className="py-1 px-2">Due At</th>
                        <th className="py-1 px-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stuckLeads.length === 0 ? (
                        <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No stuck leads</td></tr>
                      ) : stuckLeads.map((l) => (
                        <tr key={l.id} className="border-b" data-testid={`stuck-row-${l.id}`}>
                          <td className="py-1 px-2">{l.id}</td>
                          <td className="py-1 px-2">{l.companyName || "Unknown"}</td>
                          <td className="py-1 px-2"><Badge variant="outline">{l.stage}</Badge></td>
                          <td className="py-1 px-2">{l.nextActionType || "-"}</td>
                          <td className="py-1 px-2 text-muted-foreground">{l.nextActionAt ? new Date(l.nextActionAt).toLocaleString() : "-"}</td>
                          <td className="py-1 px-2 text-muted-foreground">{l.updatedAt ? new Date(l.updatedAt).toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
