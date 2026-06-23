import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Mail,
  Workflow,
  Send,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Server,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SendingIdentity } from "@shared/schema";

interface SmtpStatus {
  configured: boolean;
  hasHost: boolean;
  hasUser: boolean;
  hasPass: boolean;
  host: string | null;
  port: number;
  user: string | null;
  from: string | null;
}

interface GhlWorkflowEntry {
  id: string;
  name: string;
  category: string;
  envKey: string;
  description: string;
  value: string | null;
  isSet: boolean;
}

interface GhlStatusResponse {
  workflows: GhlWorkflowEntry[];
  total: number;
  configuredCount: number;
}

const IDENTITY_DEFAULTS: Partial<SendingIdentity> = {
  label: "",
  domain: "",
  emailAddress: "",
  mailboxType: "google_workspace",
  isActive: true,
  warmupStatus: "warming",
  dailyLimit: 30,
};

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
  ) : (
    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
  );
}

function EnvVarRow({ label, ok, value }: { label: string; ok: boolean; value?: string | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        <StatusDot ok={ok} />
        <span className="text-sm font-mono">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {ok ? (
          <Badge variant="default" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-0">
            Set
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-xs">Missing</Badge>
        )}
        {value && <span className="text-xs text-muted-foreground">{value}</span>}
      </div>
    </div>
  );
}

export default function EmailHealth() {
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<{ success: boolean; messageId?: string; error?: string } | null>(null);
  const [identityDialog, setIdentityDialog] = useState<{ open: boolean; mode: "add" | "edit"; identity?: SendingIdentity }>({
    open: false,
    mode: "add",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<SendingIdentity | null>(null);
  const [form, setForm] = useState<Partial<SendingIdentity>>({ ...IDENTITY_DEFAULTS });

  const { data: smtpStatus, isLoading: smtpLoading } = useQuery<SmtpStatus>({
    queryKey: ["/api/admin/email-health/smtp-status"],
    refetchInterval: 60_000,
  });

  const { data: ghlStatus, isLoading: ghlLoading } = useQuery<GhlStatusResponse>({
    queryKey: ["/api/admin/email-health/ghl-status"],
    refetchInterval: 60_000,
  });

  const { data: identities = [], isLoading: identitiesLoading } = useQuery<SendingIdentity[]>({
    queryKey: ["/api/admin/sending-identities"],
    refetchInterval: 60_000,
  });

  const testSmtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/email-health/test-smtp");
      return res.json() as Promise<{ success: boolean; messageId?: string; error?: string }>;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        toast({ title: "Test Email Sent", description: `Message ID: ${data.messageId}` });
      } else {
        toast({ title: "SMTP Test Failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createIdentityMutation = useMutation({
    mutationFn: async (data: Partial<SendingIdentity>) => {
      const res = await apiRequest("POST", "/api/admin/sending-identities", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sending-identities"] });
      setIdentityDialog({ open: false, mode: "add" });
      setForm({ ...IDENTITY_DEFAULTS });
      toast({ title: "Identity Added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateIdentityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<SendingIdentity> }) => {
      const res = await apiRequest("PATCH", `/api/admin/sending-identities/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sending-identities"] });
      setIdentityDialog({ open: false, mode: "edit" });
      setForm({ ...IDENTITY_DEFAULTS });
      toast({ title: "Identity Updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteIdentityMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/sending-identities/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sending-identities"] });
      setDeleteConfirm(null);
      toast({ title: "Identity Deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/sending-identities/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sending-identities"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openAdd = () => {
    setForm({ ...IDENTITY_DEFAULTS });
    setIdentityDialog({ open: true, mode: "add" });
  };

  const openEdit = (identity: SendingIdentity) => {
    setForm({ ...identity });
    setIdentityDialog({ open: true, mode: "edit", identity });
  };

  const EDITABLE_FIELDS = [
    "label", "domain", "emailAddress", "mailboxType", "provider",
    "ghlLocationId", "isActive", "warmupStatus", "dailyLimit",
    "verticalAssignment",
  ] as const;

  const handleSave = () => {
    const editableData = EDITABLE_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
      if (form[key as keyof typeof form] !== undefined) {
        acc[key] = form[key as keyof typeof form];
      }
      return acc;
    }, {});

    if (identityDialog.mode === "add") {
      createIdentityMutation.mutate(editableData as Partial<SendingIdentity>);
    } else if (identityDialog.identity) {
      updateIdentityMutation.mutate({ id: identityDialog.identity.id, data: editableData as Partial<SendingIdentity> });
    }
  };

  const warmupBadge = (status: string | null) => {
    if (status === "warm") return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-0">Warm</Badge>;
    if (status === "warming") return <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 border-0">Warming</Badge>;
    if (status === "paused") return <Badge variant="secondary" className="text-xs">Paused</Badge>;
    return <Badge variant="outline" className="text-xs">{status || "—"}</Badge>;
  };

  const healthColor = (score: number | null) => {
    if (score == null) return "text-muted-foreground";
    if (score >= 80) return "text-green-600";
    if (score >= 50) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-6" data-testid="email-health-page">
      <div>
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold" data-testid="text-email-health-title">Email & Comms Health</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Live status of all three outbound email layers — SMTP, GHL Workflows, and Sending Identities. Auto-refreshes every 60 seconds.
        </p>
      </div>

      {/* SMTP Card */}
      <Card data-testid="card-smtp-status">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">SMTP Configuration</CardTitle>
            {smtpStatus && (
              smtpStatus.configured
                ? <Badge className="ml-2 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-0 text-xs">Configured</Badge>
                : <Badge variant="destructive" className="ml-2 text-xs">Not Configured</Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => testSmtpMutation.mutate()}
            disabled={testSmtpMutation.isPending || !smtpStatus?.configured}
            data-testid="button-test-smtp"
          >
            {testSmtpMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send Test Email
          </Button>
        </CardHeader>
        <CardContent>
          {smtpLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="smtp-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : smtpStatus ? (
            <div className="space-y-0">
              <EnvVarRow label="SMTP_HOST" ok={smtpStatus.hasHost} value={smtpStatus.host} />
              <EnvVarRow label="SMTP_USER" ok={smtpStatus.hasUser} value={smtpStatus.user} />
              <EnvVarRow label="SMTP_PASS" ok={smtpStatus.hasPass} />
              <div className="pt-3 text-sm text-muted-foreground flex flex-wrap gap-4">
                <span>Port: <strong className="text-foreground">{smtpStatus.port}</strong></span>
                {smtpStatus.from && <span>From: <strong className="text-foreground">{smtpStatus.from}</strong></span>}
              </div>
            </div>
          ) : null}

          {testResult && (
            <Alert
              variant={testResult.success ? "default" : "destructive"}
              className="mt-4"
              data-testid="alert-smtp-test-result"
            >
              {testResult.success
                ? <CheckCircle2 className="h-4 w-4" />
                : <AlertTriangle className="h-4 w-4" />}
              <AlertDescription>
                {testResult.success
                  ? `Test email sent successfully. Message ID: ${testResult.messageId}`
                  : `Send failed: ${testResult.error}`}
              </AlertDescription>
            </Alert>
          )}

          {smtpStatus && !smtpStatus.configured && (
            <p className="text-xs text-muted-foreground mt-3">
              To enable SMTP, set <code className="bg-muted px-1 rounded">SMTP_HOST</code>,{" "}
              <code className="bg-muted px-1 rounded">SMTP_USER</code>, and{" "}
              <code className="bg-muted px-1 rounded">SMTP_PASS</code> in Replit Secrets.
            </p>
          )}
        </CardContent>
      </Card>

      {/* GHL Workflows Card */}
      <Card data-testid="card-ghl-workflow-status">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">GHL Workflows</CardTitle>
            {ghlStatus && (
              <Badge variant="outline" className="ml-2 text-xs" data-testid="badge-ghl-configured-count">
                {ghlStatus.configuredCount} / {ghlStatus.total} configured
              </Badge>
            )}
          </div>
          <Link href="/dashboard/ghl-workflows">
            <Button size="sm" variant="outline" className="gap-2" data-testid="button-ghl-workflows-link">
              <ExternalLink className="w-3 h-3" />
              Manage Workflow IDs
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {ghlLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="ghl-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : ghlStatus ? (
            <div className="overflow-x-auto">
              <Table data-testid="table-ghl-workflows">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">Status</TableHead>
                    <TableHead>Workflow Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Env Key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ghlStatus.workflows.map((wf) => (
                    <TableRow key={wf.id} data-testid={`row-ghl-workflow-${wf.id}`}>
                      <TableCell>
                        <StatusDot ok={wf.isSet} />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{wf.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{wf.category.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{wf.envKey}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Sending Identities Card */}
      <Card data-testid="card-sending-identities">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Sending Identities</CardTitle>
            <Badge variant="outline" className="ml-2 text-xs">{identities.length} total</Badge>
          </div>
          <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-identity">
            <Plus className="w-3 h-3" />
            Add Identity
          </Button>
        </CardHeader>
        <CardContent>
          {identitiesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="identities-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : identities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-identities">
              No sending identities configured. Add one to start managing outbound email senders.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-sending-identities">
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Warmup</TableHead>
                    <TableHead className="text-right">Daily Limit</TableHead>
                    <TableHead className="text-right">Sent Today</TableHead>
                    <TableHead className="text-right">Health</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {identities.map((identity) => (
                    <TableRow key={identity.id} data-testid={`row-identity-${identity.id}`}>
                      <TableCell className="text-sm font-medium">{identity.emailAddress}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{identity.domain}</TableCell>
                      <TableCell>{warmupBadge(identity.warmupStatus)}</TableCell>
                      <TableCell className="text-right text-sm">{identity.dailyLimit ?? 30}</TableCell>
                      <TableCell className="text-right text-sm">{identity.sentToday ?? 0}</TableCell>
                      <TableCell className={`text-right text-sm font-medium ${healthColor(identity.healthScore ?? null)}`}>
                        {identity.healthScore != null ? `${Math.round(identity.healthScore)}` : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={identity.isActive ?? true}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: identity.id, isActive: checked })}
                          data-testid={`toggle-identity-active-${identity.id}`}
                          aria-label={`Toggle active for ${identity.emailAddress}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openEdit(identity)}
                            aria-label={`Edit ${identity.emailAddress}`}
                            data-testid={`button-edit-identity-${identity.id}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirm(identity)}
                            aria-label={`Delete ${identity.emailAddress}`}
                            data-testid={`button-delete-identity-${identity.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Identity Dialog */}
      <Dialog open={identityDialog.open} onOpenChange={(open) => setIdentityDialog(d => ({ ...d, open }))}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-identity-form">
          <DialogHeader>
            <DialogTitle>{identityDialog.mode === "add" ? "Add Sending Identity" : "Edit Sending Identity"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="identity-email">Email Address</Label>
                <Input
                  id="identity-email"
                  value={form.emailAddress ?? ""}
                  onChange={(e) => setForm(f => ({ ...f, emailAddress: e.target.value }))}
                  placeholder="outreach@yourdomain.com"
                  data-testid="input-identity-email"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-label">Label</Label>
                <Input
                  id="identity-label"
                  value={form.label ?? ""}
                  onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Primary Outreach"
                  data-testid="input-identity-label"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-domain">Domain</Label>
                <Input
                  id="identity-domain"
                  value={form.domain ?? ""}
                  onChange={(e) => setForm(f => ({ ...f, domain: e.target.value }))}
                  placeholder="yourdomain.com"
                  data-testid="input-identity-domain"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-mailbox-type">Mailbox Type</Label>
                <Select
                  value={form.mailboxType ?? "google_workspace"}
                  onValueChange={(v) => setForm(f => ({ ...f, mailboxType: v }))}
                >
                  <SelectTrigger id="identity-mailbox-type" data-testid="select-identity-mailbox-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google_workspace">Google Workspace</SelectItem>
                    <SelectItem value="microsoft_365">Microsoft 365</SelectItem>
                    <SelectItem value="smtp">SMTP</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-warmup-status">Warmup Status</Label>
                <Select
                  value={form.warmupStatus ?? "warming"}
                  onValueChange={(v) => setForm(f => ({ ...f, warmupStatus: v }))}
                >
                  <SelectTrigger id="identity-warmup-status" data-testid="select-identity-warmup-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warming">Warming</SelectItem>
                    <SelectItem value="warm">Warm</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-daily-limit">Daily Limit</Label>
                <Input
                  id="identity-daily-limit"
                  type="number"
                  min={1}
                  max={500}
                  value={form.dailyLimit ?? 30}
                  onChange={(e) => setForm(f => ({ ...f, dailyLimit: parseInt(e.target.value, 10) || 30 }))}
                  data-testid="input-identity-daily-limit"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="identity-vertical">Vertical (optional)</Label>
                <Input
                  id="identity-vertical"
                  value={form.verticalAssignment ?? ""}
                  onChange={(e) => setForm(f => ({ ...f, verticalAssignment: e.target.value || null }))}
                  placeholder="restaurant, retail…"
                  data-testid="input-identity-vertical"
                />
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <Switch
                  id="identity-active"
                  checked={form.isActive ?? true}
                  onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))}
                  data-testid="switch-identity-active"
                />
                <Label htmlFor="identity-active">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIdentityDialog(d => ({ ...d, open: false }))} data-testid="button-identity-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createIdentityMutation.isPending || updateIdentityMutation.isPending}
              data-testid="button-identity-save"
            >
              {(createIdentityMutation.isPending || updateIdentityMutation.isPending) && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {identityDialog.mode === "add" ? "Add Identity" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Sending Identity</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong>{deleteConfirm?.emailAddress}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} data-testid="button-delete-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteIdentityMutation.mutate(deleteConfirm.id)}
              disabled={deleteIdentityMutation.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteIdentityMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
