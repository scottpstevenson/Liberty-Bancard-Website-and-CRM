import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Plus, Trash2, Settings, Workflow, Mail, Edit2, Save, X, Loader2, ShieldCheck, Linkedin, Info, Cpu, RefreshCw, AlertTriangle, Activity } from "lucide-react";

interface WorkflowEnvEntry {
  id: string;
  name: string;
  category: string;
  envKey: string;
  description: string;
  triggerType: string;
  value: string | null;
  isSet: boolean;
}

interface SendingIdentity {
  id: number;
  label: string;
  domain: string;
  emailAddress: string;
  mailboxType: string | null;
  isActive: boolean | null;
  warmupStatus: string | null;
  dailyLimit: number | null;
  healthScore: number | null;
  verticalAssignment: string | null;
  sentToday: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  sdr_outbound: "SDR Outbound",
  inbound_lead: "Inbound Lead",
  onboarding: "Onboarding",
  nurture: "Nurture",
  scheduling: "Scheduling",
  support: "Support",
};

const CATEGORY_COLORS: Record<string, string> = {
  sdr_outbound: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  inbound_lead: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  onboarding: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  nurture: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  scheduling: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  support: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};

function WorkflowEnvRow({ entry, onSaved }: { entry: WorkflowEnvEntry; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(entry.value || "");

  const saveMutation = useMutation({
    mutationFn: async (value: string | null) => {
      await apiRequest("PUT", `/api/ghl/workflow-env-ids/${entry.envKey}`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-env-ids"] });
      toast({ title: "Workflow ID saved" });
      setEditing(false);
      onSaved();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <TableRow data-testid={`row-workflow-env-${entry.envKey}`}>
      <TableCell className="max-w-[200px]">
        <div className="font-medium text-sm">{entry.name}</div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{entry.envKey}</div>
      </TableCell>
      <TableCell>
        <Badge className={CATEGORY_COLORS[entry.category] || "bg-gray-100 text-gray-700"}>
          {CATEGORY_LABELS[entry.category] || entry.category}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[250px]">{entry.description}</TableCell>
      <TableCell>
        {entry.isSet
          ? <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 gap-1"><CheckCircle2 className="w-3 h-3" />Set</Badge>
          : <Badge variant="outline" className="text-muted-foreground gap-1"><XCircle className="w-3 h-3" />Missing</Badge>
        }
      </TableCell>
      <TableCell className="min-w-[260px]">
        {editing ? (
          <div className="flex gap-2 items-center">
            <Input
              className="h-7 text-xs font-mono"
              placeholder="Paste GHL Workflow ID..."
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              data-testid={`input-workflow-id-${entry.envKey}`}
            />
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(inputVal || null)}
              data-testid={`button-save-workflow-${entry.envKey}`}
            >
              {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditing(false); setInputVal(entry.value || ""); }}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
              {entry.value ? entry.value : <span className="italic">Not set</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 ml-auto"
              onClick={() => { setEditing(true); setInputVal(entry.value || ""); }}
              data-testid={`button-edit-workflow-${entry.envKey}`}
            >
              <Edit2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddIdentityDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [domain, setDomain] = useState("");
  const [mailboxType, setMailboxType] = useState("google_workspace");
  const [dailyLimit, setDailyLimit] = useState("30");
  const [warmupStatus, setWarmupStatus] = useState("warming");
  const [vertical, setVertical] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("POST", "/api/sdr/sending-identities", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      toast({ title: "Sending identity added" });
      setOpen(false);
      setLabel(""); setEmailAddress(""); setDomain(""); setMailboxType("google_workspace");
      setDailyLimit("30"); setWarmupStatus("warming"); setVertical("");
      onCreated();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add identity", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!label || !emailAddress || !domain) {
      toast({ title: "Label, email, and domain are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      label,
      emailAddress,
      domain,
      mailboxType,
      isActive: true,
      warmupStatus,
      warmupStartedAt: warmupStatus === "warming" ? new Date().toISOString() : null,
      dailyLimit: parseInt(dailyLimit) || 30,
      verticalAssignment: vertical || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-add-identity">
          <Plus className="w-4 h-4 mr-1" />Add Identity
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-add-identity">
        <DialogHeader>
          <DialogTitle>Add Sending Identity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-sm">Label</Label>
            <Input placeholder="e.g. Scott - Liberty Bancard" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-identity-label" />
          </div>
          <div>
            <Label className="text-sm">Email Address</Label>
            <Input placeholder="e.g. Scott@mail.libertybancard.com" value={emailAddress} onChange={(e) => { setEmailAddress(e.target.value); if (!domain && e.target.value.includes("@")) setDomain(e.target.value.split("@")[1]); }} data-testid="input-identity-email" />
          </div>
          <div>
            <Label className="text-sm">Domain</Label>
            <Input placeholder="e.g. mail.libertybancard.com" value={domain} onChange={(e) => setDomain(e.target.value)} data-testid="input-identity-domain" />
          </div>
          <div>
            <Label className="text-sm">Mailbox Type</Label>
            <Select value={mailboxType} onValueChange={setMailboxType}>
              <SelectTrigger data-testid="select-identity-mailbox-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google_workspace">Google Workspace</SelectItem>
                <SelectItem value="microsoft_365">Microsoft 365</SelectItem>
                <SelectItem value="smtp">SMTP</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Daily Limit</Label>
              <Input type="number" min="20" max="35" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} data-testid="input-identity-daily-limit" />
              <p className="text-xs text-muted-foreground mt-1">20–35 for safe deliverability</p>
            </div>
            <div>
              <Label className="text-sm">Warmup Status</Label>
              <Select value={warmupStatus} onValueChange={setWarmupStatus}>
                <SelectTrigger data-testid="select-identity-warmup-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warming">Warming</SelectItem>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-sm">Vertical Assignment (optional)</Label>
            <Input placeholder="e.g. restaurant, retail" value={vertical} onChange={(e) => setVertical(e.target.value)} data-testid="input-identity-vertical" />
          </div>
          <Button className="w-full" disabled={createMutation.isPending} onClick={handleSubmit} data-testid="button-submit-add-identity">
            {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Adding...</> : "Add Sending Identity"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SendingIdentitiesTab() {
  const { toast } = useToast();

  const { data: identities = [], isLoading, refetch } = useQuery<SendingIdentity[]>({
    queryKey: ["/api/sdr/sending-identities"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/seed-scott-identity", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      toast({ title: data?.created ? "Scott's identity seeded" : "Scott's identity already exists", description: data?.message });
    },
    onError: (err: any) => {
      toast({ title: "Seed failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sdr/sending-identities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/sending-identities"] });
      toast({ title: "Identity removed" });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const scottExists = identities.some(i => i.emailAddress === "Scott@mail.libertybancard.com");

  function warmupBadge(status: string | null) {
    switch (status) {
      case "warm": return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Warm</Badge>;
      case "warming": return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Warming</Badge>;
      case "paused": return <Badge variant="destructive">Paused</Badge>;
      default: return <Badge variant="outline">{status || "Unknown"}</Badge>;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            All registered sending identities used for SDR outreach. The orchestrator picks the best available warm inbox.
          </p>
        </div>
        <div className="flex gap-2">
          {!scottExists && (
            <Button
              size="sm"
              variant="outline"
              disabled={seedMutation.isPending}
              onClick={() => seedMutation.mutate()}
              data-testid="button-seed-scott"
            >
              {seedMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
              Seed Scott's Identity
            </Button>
          )}
          <AddIdentityDialog onCreated={() => refetch()} />
        </div>
      </div>

      {scottExists && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200" data-testid="banner-scott-exists">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span><strong>Scott@mail.libertybancard.com</strong> is active as the primary sending identity.</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : identities.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No sending identities registered yet.</p>
          <p className="text-xs mt-1">Seed Scott's identity or add one manually to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identity</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Daily Limit</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Sent Today</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identities.map((identity) => (
                <TableRow key={identity.id} data-testid={`row-identity-${identity.id}`}>
                  <TableCell>
                    <div className="font-medium text-sm">{identity.label}</div>
                    <div className="text-xs text-muted-foreground">{identity.emailAddress}</div>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{identity.domain}</TableCell>
                  <TableCell>{warmupBadge(identity.warmupStatus)}</TableCell>
                  <TableCell className="text-sm">{identity.dailyLimit ?? 30}</TableCell>
                  <TableCell>
                    <span className={`text-sm font-medium ${(identity.healthScore ?? 100) >= 80 ? "text-green-600" : (identity.healthScore ?? 100) >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                      {(identity.healthScore ?? 100).toFixed(0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{identity.sentToday ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{identity.verticalAssignment || <span className="italic">All</span>}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(identity.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-identity-${identity.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function GhlWorkflowEnvTab() {
  const { data: registry = [], isLoading, refetch } = useQuery<WorkflowEnvEntry[]>({
    queryKey: ["/api/ghl/workflow-env-ids"],
  });

  const grouped: Record<string, WorkflowEnvEntry[]> = {};
  for (const entry of registry) {
    const cat = entry.category || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  const total = registry.length;
  const configured = registry.filter(e => e.isSet).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="text-sm text-muted-foreground flex-1">
          Wire up the GHL workflow IDs that the SDR orchestrator uses to trigger outreach sequences.
          Values saved here take effect immediately without a code change.
        </div>
        <div className="flex gap-3 text-sm">
          <span className="text-green-600 font-medium">{configured} configured</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{total} total</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, entries]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={CATEGORY_COLORS[category] || "bg-gray-100 text-gray-700"}>
                  {CATEGORY_LABELS[category] || category}
                </Badge>
                <span className="text-xs text-muted-foreground">{entries.filter(e => e.isSet).length}/{entries.length} set</span>
              </div>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="hidden md:table-cell">Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>GHL Workflow ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <WorkflowEnvRow key={entry.envKey} entry={entry} onSaved={() => refetch()} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AdapterStatus {
  name: string;
  enabled: boolean;
  configured: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  errorRate: number;
}

interface ProcessorAdaptersResponse {
  adapters: AdapterStatus[];
}

function ProcessorAdaptersTab() {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<ProcessorAdaptersResponse>({
    queryKey: ["/api/admin/processor-adapters"],
  });

  const pingMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/processor-adapters/ping", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/processor-adapters"] });
      toast({ title: "Ping complete", description: "Adapter connectivity check finished." });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Ping failed", description: err.message, variant: "destructive" });
    },
  });

  const adapters = data?.adapters ?? [];

  function formatTimeAgo(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <div className="space-y-4" data-testid="section-processor-adapters">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground flex-1">
          All registered processor adapters and their live connectivity status. Add new processors by creating an adapter file and registering it — no changes to the boarding flow required.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pingMutation.isPending}
          onClick={() => pingMutation.mutate()}
          data-testid="button-ping-adapters"
        >
          {pingMutation.isPending
            ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            : <RefreshCw className="w-4 h-4 mr-1.5" />
          }
          Ping All
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adapter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Configured</TableHead>
                <TableHead>Last Success</TableHead>
                <TableHead>Last Error</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>Error Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adapters.map((adapter) => (
                <TableRow key={adapter.name} data-testid={`row-adapter-${adapter.name.replace(/\s+/g, "-").toLowerCase()}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{adapter.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {adapter.enabled
                      ? <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 gap-1"><Activity className="w-3 h-3" />Enabled</Badge>
                      : <Badge variant="outline" className="text-muted-foreground gap-1"><XCircle className="w-3 h-3" />Disabled</Badge>
                    }
                  </TableCell>
                  <TableCell>
                    {adapter.configured
                      ? <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 gap-1"><CheckCircle2 className="w-3 h-3" />Configured</Badge>
                      : <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1"><AlertTriangle className="w-3 h-3" />Not set</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatTimeAgo(adapter.lastSuccessAt)}</TableCell>
                  <TableCell>
                    {adapter.lastError ? (
                      <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[200px] block" title={adapter.lastError}>
                        {adapter.lastError.slice(0, 60)}{adapter.lastError.length > 60 ? "…" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{adapter.callCount}</TableCell>
                  <TableCell>
                    <span className={`text-sm font-medium ${adapter.errorRate === 0 ? "text-green-600" : adapter.errorRate < 10 ? "text-yellow-600" : "text-red-600"}`}>
                      {adapter.errorRate}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded-md border p-4 space-y-3 bg-card">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" />Adding a New Processor</h3>
        <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
          <li>Create <code className="font-mono bg-muted px-1 rounded text-xs">server/services/processors/yourprocessor.adapter.ts</code> implementing <code className="font-mono bg-muted px-1 rounded text-xs">IProcessorAdapter</code>.</li>
          <li>Register the adapter in <code className="font-mono bg-muted px-1 rounded text-xs">server/services/processors/registry.ts</code> with its env var flag.</li>
          <li>Set <code className="font-mono bg-muted px-1 rounded text-xs">ENABLED_PROCESSORS=nmi,yourprocessor</code> in your environment secrets.</li>
          <li>The boarding flow picks up the adapter automatically via <code className="font-mono bg-muted px-1 rounded text-xs">getDefaultProcessor()</code> — no further changes needed.</li>
        </ol>
      </div>
    </div>
  );
}

function ProxycurlTab() {
  const { data: status, isLoading } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/proxycurl/status"],
  });

  const configured = status?.configured ?? false;

  return (
    <div className="space-y-4" data-testid="section-proxycurl">
      <p className="text-sm text-muted-foreground">
        Proxycurl powers LinkedIn profile enrichment. When configured, the "Enrich from LinkedIn" button
        on contact records will fetch name, title, company, location, and more directly from LinkedIn profiles.
      </p>

      <div className={`flex items-start gap-3 p-4 rounded-lg border ${configured ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800" : "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"}`} data-testid="banner-proxycurl-status">
        {configured ? (
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
        ) : (
          <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Checking configuration…</p>
          ) : configured ? (
            <>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">Proxycurl API key is configured</p>
              <p className="text-xs text-green-700 dark:text-green-300">LinkedIn enrichment is active. Open any contact with a LinkedIn URL and click "Enrich from LinkedIn".</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Proxycurl API key is not set</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Set the <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">PROXYCURL_API_KEY</code> environment variable to enable LinkedIn enrichment.
                Get your API key at{" "}
                <a href="https://nubela.co/proxycurl" target="_blank" rel="noopener noreferrer" className="underline font-medium">nubela.co/proxycurl</a>.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-3 bg-card">
        <h3 className="text-sm font-semibold">Setup Instructions</h3>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Sign up at <a href="https://nubela.co/proxycurl" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">nubela.co/proxycurl</a> and obtain an API key.</li>
          <li>In your Replit project, open the Secrets panel and add a new secret named <code className="font-mono bg-muted px-1 rounded text-xs">PROXYCURL_API_KEY</code> with your key as the value.</li>
          <li>Restart the application for the change to take effect.</li>
          <li>Open any contact record that has a LinkedIn URL and click <strong>Enrich from LinkedIn</strong>.</li>
        </ol>
      </div>
    </div>
  );
}

export default function SettingsIntegrations() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-settings-integrations">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Settings — Integrations
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage GHL workflow IDs, SDR sending identities, and API integrations.
        </p>
      </div>

      <Tabs defaultValue="ghl-workflows" data-testid="tabs-integrations">
        <TabsList>
          <TabsTrigger value="ghl-workflows" data-testid="tab-ghl-workflows">
            <Workflow className="w-4 h-4 mr-1.5" />GHL Workflow IDs
          </TabsTrigger>
          <TabsTrigger value="sending-identities" data-testid="tab-sending-identities">
            <Mail className="w-4 h-4 mr-1.5" />Sending Identities
          </TabsTrigger>
          <TabsTrigger value="processor-adapters" data-testid="tab-processor-adapters">
            <Cpu className="w-4 h-4 mr-1.5" />Processor Adapters
          </TabsTrigger>
          <TabsTrigger value="linkedin" data-testid="tab-linkedin-enrichment">
            <Linkedin className="w-4 h-4 mr-1.5" />LinkedIn Enrichment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ghl-workflows" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GHL Workflow ID Registry</CardTitle>
              <CardDescription>
                All 20 GHL workflow slots grouped by category. Paste the GHL workflow ID from your GoHighLevel account to activate each sequence.
                Values are stored in the database and take effect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GhlWorkflowEnvTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sending-identities" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sending Identities</CardTitle>
              <CardDescription>
                Email inboxes used for SDR outreach. The orchestrator automatically selects the healthiest warm inbox.
                Scott@mail.libertybancard.com is the primary sending identity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SendingIdentitiesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processor-adapters" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                Processor Adapters
              </CardTitle>
              <CardDescription>
                Universal processor abstraction layer. Each adapter implements the same interface so new processors can be added without changing the boarding flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProcessorAdaptersTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="linkedin" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Linkedin className="w-4 h-4 text-blue-600" />
                LinkedIn Enrichment (Proxycurl)
              </CardTitle>
              <CardDescription>
                Automatically enrich contact records with LinkedIn profile data including job title, company, and location.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProxycurlTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
