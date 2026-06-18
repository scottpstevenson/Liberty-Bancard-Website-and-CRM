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
import { Loader2, Play, Square, Pause, Shield, Activity, Server, Mail, AlertTriangle, CheckCircle2, XCircle, Zap, RefreshCw, Radio, ArrowRightLeft, Plus, Pencil, ListChecks, Circle } from "lucide-react";
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
  warmupStatus?: string | null;
  warmupStartedAt?: string | null;
}

interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface ReadinessData {
  ready: boolean;
  passCount: number;
  totalChecks: number;
  checks: ReadinessCheck[];
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

interface ActivationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface ActivationStatus {
  ready: boolean;
  checks: ActivationCheck[];
  heartbeat: { sequenceRunner: any; slaWorker: any; stageProgression: any };
  activeIdentities: number;
  totalIdentities: number;
  activeEnrollments: number;
  flags: Record<string, boolean>;
}

interface WizardProps {
  identities: SendingIdentity[];
  ghlHealth: GhlHealthData | undefined;
  onTestGhl: () => void;
  ghlTesting: boolean;
}

interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  ghlProbe: { ok: boolean; detail: string };
}

function SendingIdentityWizard({ identities, ghlHealth, onTestGhl, ghlTesting }: WizardProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<IdentityFormState>(emptyIdentityForm);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const hasIdentity = identities.length > 0;
  const firstIdentity = identities[0];

  const ghlReady = !!ghlHealth?.configured && !!ghlHealth?.authTest;

  const validateMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/operator/validate-identity", {
        label: form.label,
        emailAddress: form.emailAddress,
      });
      return r.json() as Promise<ValidationResult>;
    },
    onSuccess: (data) => {
      setValidation(data);
      if (!data.ok) toast({ title: "Validation failed", description: data.errors[0], variant: "destructive" });
    },
    onError: (err: Error) => toast({ title: "Validation error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      // Always re-validate server-side immediately before saving so the GHL
      // sender check is the gate, not the client state.
      const v = await apiRequest("POST", "/api/operator/validate-identity", {
        label: form.label,
        emailAddress: form.emailAddress,
      });
      const vData = await v.json() as ValidationResult;
      setValidation(vData);
      if (!vData.ok) {
        throw new Error(vData.errors[0] || "Identity validation failed");
      }
      const r = await apiRequest("POST", "/api/sdr/sending-identities", {
        label: form.label,
        emailAddress: form.emailAddress,
        dailyLimit: parseInt(form.dailyLimit, 10),
        status: form.status,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operator/activation-status"] });
      toast({ title: "Sending identity created", description: "Warmup schedule started" });
      setForm(emptyIdentityForm);
      setValidation(null);
    },
    onError: (err: Error) => toast({ title: "Failed to create identity", description: err.message, variant: "destructive" }),
  });

  const step1Done = ghlReady;
  const step2Done = hasIdentity;
  const step3Done = hasIdentity && (firstIdentity?.warmupStatus === "warm" || firstIdentity?.healthScore !== null);

  const warmupSchedule = [
    { day: "Day 1-3", limit: 10, label: "Initial warmup" },
    { day: "Day 4-7", limit: 25, label: "Ramp-up" },
    { day: "Day 8-14", limit: 50, label: "Mid warmup" },
    { day: "Day 15+", limit: form.dailyLimit ? parseInt(form.dailyLimit, 10) : 50, label: "Full daily limit" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="w-4 h-4" /> First Sending Identity Wizard
            <Badge variant={hasIdentity ? "default" : "secondary"}>
              {hasIdentity ? "Identity active" : "Action required"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1 — GHL validation */}
          <div className="border rounded p-3" data-testid="wizard-step-ghl">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold">1</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {step1Done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-medium text-sm">Validate GHL connection</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Configured: <Badge variant={ghlHealth?.configured ? "default" : "destructive"}>{ghlHealth?.configured ? "Yes" : "No"}</Badge>
                  {" "}Auth: <Badge variant={ghlHealth?.authTest ? "default" : "secondary"}>{ghlHealth?.authTest ? "Pass" : "Pending"}</Badge>
                  {" "}Webhook: <Badge variant={ghlHealth?.hasWebhookSecret ? "default" : "secondary"}>{ghlHealth?.hasWebhookSecret ? "Set" : "Missing"}</Badge>
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={onTestGhl} disabled={ghlTesting} data-testid="button-wizard-test-ghl">
                  {ghlTesting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                  Test &amp; bootstrap GHL
                </Button>
              </div>
            </div>
          </div>

          {/* Step 2 — Identity form */}
          <div className="border rounded p-3" data-testid="wizard-step-identity">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold">2</div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  {step2Done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-medium text-sm">Add your first sending identity</span>
                </div>
                {!hasIdentity ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-xs">Label</Label>
                      <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Main Sales" data-testid="input-wizard-label" />
                    </div>
                    <div>
                      <Label className="text-xs">Email Address</Label>
                      <Input type="email" value={form.emailAddress} onChange={e => setForm(f => ({ ...f, emailAddress: e.target.value }))} placeholder="sales@example.com" data-testid="input-wizard-email" />
                    </div>
                    <div>
                      <Label className="text-xs">Daily Limit (post-warmup)</Label>
                      <Input type="number" value={form.dailyLimit} onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} min={1} max={200} data-testid="input-wizard-limit" />
                    </div>
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                        <SelectTrigger data-testid="select-wizard-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="warming">Warming</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => validateMutation.mutate()}
                        disabled={validateMutation.isPending || !form.label || !form.emailAddress}
                        data-testid="button-wizard-validate"
                      >
                        {validateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Shield className="w-4 h-4 mr-1" />}
                        Validate sender in GHL
                      </Button>
                      <Button
                        onClick={() => createMutation.mutate()}
                        disabled={!step1Done || !validation?.ok || createMutation.isPending || !form.label || !form.emailAddress}
                        data-testid="button-wizard-create"
                      >
                        {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                        Create identity &amp; start warmup
                      </Button>
                    </div>
                    {!step1Done && <p className="text-xs text-yellow-600 md:col-span-2">Pass step 1 (GHL connection) before validating the sender.</p>}
                    {validation && (
                      <div className={`md:col-span-2 text-xs p-2 rounded border ${validation.ok ? "border-green-500/50 bg-green-500/5" : "border-red-500/50 bg-red-500/5"}`} data-testid="text-wizard-validation">
                        <div className="font-medium flex items-center gap-1">
                          {validation.ok ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <XCircle className="w-3 h-3 text-red-600" />}
                          {validation.ok ? "Sender validated — ready to save" : "Sender validation failed"}
                        </div>
                        {validation.errors.map((e, i) => <div key={`e${i}`} className="text-red-600 ml-4">• {e}</div>)}
                        {validation.warnings.map((w, i) => <div key={`w${i}`} className="text-yellow-600 ml-4">⚠ {w}</div>)}
                        {validation.ghlProbe && <div className="text-muted-foreground ml-4">GHL probe: {validation.ghlProbe.detail}</div>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground" data-testid="text-identity-summary">
                    {firstIdentity.label} &lt;{firstIdentity.emailAddress}&gt; · status {firstIdentity.status}
                    {firstIdentity.warmupStatus ? ` · warmup ${firstIdentity.warmupStatus}` : ""}
                    {firstIdentity.healthScore !== null ? ` · health ${firstIdentity.healthScore}` : ""}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 3 — Warmup schedule */}
          <div className="border rounded p-3" data-testid="wizard-step-warmup">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold">3</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {step3Done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-medium text-sm">Warmup schedule</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  New identities are throttled in stages to protect deliverability. The system enforces these caps automatically — review the schedule below.
                </p>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs border" data-testid="table-warmup-schedule">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left">
                        <th className="py-1 px-2">Window</th>
                        <th className="py-1 px-2">Send cap / day</th>
                        <th className="py-1 px-2">Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warmupSchedule.map(w => (
                        <tr key={w.day} className="border-b">
                          <td className="py-1 px-2">{w.day}</td>
                          <td className="py-1 px-2">{w.limit}</td>
                          <td className="py-1 px-2">{w.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {firstIdentity?.warmupStartedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Warmup started: {new Date(firstIdentity.warmupStartedAt).toLocaleString()} · Current status: <strong>{firstIdentity.warmupStatus || "warming"}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Day1Runbook() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<ActivationStatus>({
    queryKey: ["/api/operator/activation-status"],
    refetchInterval: 30000,
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/operator/backfill-stages", { limit: 1000 });
      return r.json();
    },
    onSuccess: (res: any) => {
      toast({ title: "Stage backfill complete", description: `Evaluated ${res.evaluated}, progressed ${res.progressed}` });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Backfill failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4" /> Day-1 Activation Checklist
            <Badge variant={data.ready ? "default" : "secondary"} data-testid="badge-runbook-ready">
              {data.ready ? "READY" : "NOT READY"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {data.checks.map((check, idx) => (
              <li key={check.id} className="flex items-start gap-3 p-2 border rounded" data-testid={`runbook-check-${check.id}`}>
                <div className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold mt-0.5">{idx + 1}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {check.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" data-testid={`runbook-ok-${check.id}`} />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground" data-testid={`runbook-pending-${check.id}`} />
                    )}
                    <span className={check.ok ? "text-sm" : "text-sm font-medium"}>{check.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 ml-6">{check.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Worker Heartbeats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span>SLA worker last tick</span>
            <span data-testid="text-sla-heartbeat">{data.heartbeat.slaWorker?.at ? new Date(data.heartbeat.slaWorker.at).toLocaleString() : "never"}</span>
          </div>
          <div className="flex justify-between">
            <span>Sequence runner last tick</span>
            <span data-testid="text-sequence-heartbeat">{data.heartbeat.sequenceRunner?.at ? new Date(data.heartbeat.sequenceRunner.at).toLocaleString() : "never"}</span>
          </div>
          <div className="flex justify-between">
            <span>Last sequence batch</span>
            <span>processed {data.heartbeat.sequenceRunner?.processed ?? 0}, sent {data.heartbeat.sequenceRunner?.sent ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Stage progression last run</span>
            <span data-testid="text-stage-heartbeat">{data.heartbeat.stageProgression?.at ? `${new Date(data.heartbeat.stageProgression.at).toLocaleString()} (progressed ${data.heartbeat.stageProgression.progressed})` : "never"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">One-shot Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            data-testid="button-backfill-stages"
          >
            {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
            Backfill stuck deal stages
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Walks every active sales deal, infers the correct stage from existing signals (statement, review, proposal, app), and advances. Safe to re-run.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

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
  const readinessQuery = useQuery<ReadinessData>({ queryKey: ["/api/operator/readiness-checks"] });

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
    ["/api/sdr/health", "/api/ghl/health", "/api/health", "/api/sdr/flags", "/api/sdr/sending-identities", "/api/sdr/activation/recent-attempts", "/api/sdr/activation/recent-events", "/api/sdr/activation/stuck-leads", "/api/sdr/orchestrator/status", "/api/operator/readiness-checks"]
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

      {ghlHealth && ghlHealth.configured && !ghlHealth.authTest && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20" data-testid="banner-ghl-token-invalid">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-400">GHL Token Invalid — All GHL Syncs Are Failing</p>
              <p className="text-sm text-amber-700 dark:text-amber-500 mt-0.5">
                The GoHighLevel Private Integration Token returned a 401 Unauthorized error. Contact sync, opportunity updates, workflow enrollment, and calendar bookings are all blocked until a valid token is set.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-600 mt-1 font-mono">
                Fix: GHL → Settings → Integrations → Private Integrations → regenerate token → set <strong>GHL_PRIVATE_INTEGRATION_TOKEN</strong> env var → restart server.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={identities.length === 0 ? "wizard" : "status"}>
        <TabsList data-testid="tabs-activation">
          <TabsTrigger value="runbook" data-testid="tab-runbook">Day-1 Runbook</TabsTrigger>
          <TabsTrigger value="wizard" data-testid="tab-identity-wizard">Identity Wizard</TabsTrigger>
          <TabsTrigger value="status" data-testid="tab-status">System Status</TabsTrigger>
          <TabsTrigger value="readiness" data-testid="tab-readiness">Readiness</TabsTrigger>
          <TabsTrigger value="bridge" data-testid="tab-bridge">Bridge</TabsTrigger>
          <TabsTrigger value="orchestrator" data-testid="tab-orchestrator">Orchestrator</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-stuck">Stuck Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="runbook" className="space-y-4">
          <Day1Runbook />
        </TabsContent>

        <TabsContent value="wizard" className="space-y-4">
          <SendingIdentityWizard
            identities={identities}
            ghlHealth={ghlHealth}
            onTestGhl={() => ghlTestMutation.mutate()}
            ghlTesting={ghlTestMutation.isPending}
          />
        </TabsContent>

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

        <TabsContent value="readiness" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ListChecks className="w-4 h-4" /> Go-Live Readiness Checklist
                  </CardTitle>
                  {readinessQuery.data && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {readinessQuery.data.passCount} of {readinessQuery.data.totalChecks} checks passing
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {readinessQuery.data && (
                    <Badge
                      variant={readinessQuery.data.ready ? "default" : "destructive"}
                      data-testid="badge-readiness-status"
                    >
                      {readinessQuery.data.ready ? "Ready" : "Not Ready"}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/operator/readiness-checks"] })}
                    disabled={readinessQuery.isFetching}
                    data-testid="button-recheck-readiness"
                  >
                    {readinessQuery.isFetching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Re-check
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {readinessQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Running checks…
                </div>
              ) : readinessQuery.data ? (
                <div className="space-y-2">
                  {readinessQuery.data.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-start gap-3 p-3 rounded border"
                      data-testid={`readiness-check-${check.id}`}
                    >
                      {check.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{check.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{check.detail}</div>
                      </div>
                      <Badge variant={check.ok ? "default" : "destructive"} className="shrink-0 text-xs">
                        {check.ok ? "Pass" : "Fail"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Failed to load readiness checks.</div>
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
