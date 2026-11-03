import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUrlParam } from "@/hooks/use-url-param";
import { Plus, Play, Trash2, Zap, Clock, CheckCircle2, XCircle, AlertTriangle, Settings, MessageSquare, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import type { Workflow, WorkflowRun } from "@shared/schema";
import { WORKFLOW_TRIGGERS, INBOUND_CLASSIFICATIONS, INBOUND_CLASSIFICATION_LABELS } from "@shared/schema";
import DashboardErrorState from "@/components/DashboardErrorState";

const triggerLabels: Record<string, string> = {
  deal_stage_changed: "Deal Stage Changed",
  ticket_created: "Ticket Created",
  contact_created: "Contact Created",
  deal_created: "Deal Created",
  ticket_sla_breach: "Ticket SLA Breach",
  deal_sla_breach: "Deal SLA Breach",
  form_submitted: "Form Submitted",
  go_live_milestone: "Go-Live Milestone",
  scheduled: "Scheduled",
  manual: "Manual Trigger",
  application_reminder: "Application Reminder",
  inbound_message: "Inbound Message (Classification)",
};

const actionTypeLabels: Record<string, string> = {
  create_task: "Create Task",
  send_notification: "Send Notification",
  update_deal: "Update Deal",
  create_audit_log: "Log to Audit Trail",
  wait: "Wait",
};

interface ActionDef {
  type: string;
  title?: string;
  message?: string;
  channel?: string;
  assignedTo?: string;
  priority?: string;
  dueHours?: number;
  notificationType?: string;
  logAction?: string;
}

const RUN_PAGE_SIZE = 25;
const RUN_STATUS_FILTERS = ["running", "waiting", "completed", "failed", "blocked"] as const;
interface RunsPage { data: WorkflowRun[]; total: number; limit: number; offset: number }

async function readRunsPage(
  params: { limit: number; offset: number; search?: string; status?: string; workflowId?: number }, signal?: AbortSignal,
): Promise<RunsPage> {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.workflowId !== undefined) query.set("workflowId", String(params.workflowId));
  const response = await fetch(`/api/workflow-runs?${query}`, { credentials: "include", signal });
  if (!response.ok) throw new Error("Run history is unavailable.");
  const body = await response.json();
  if (!body || !Array.isArray(body.data) || !Number.isSafeInteger(body.total)) throw new Error("Run history response was not a page.");
  return body as RunsPage;
}

function getClassification(wf: Workflow): string | null {
  const cond = wf.triggerConditions as Record<string, any> | null;
  return cond?.classification ?? null;
}

export default function Workflows() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailWorkflow, setDetailWorkflow] = useState<Workflow | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [newClassification, setNewClassification] = useState("");
  const [newActions, setNewActions] = useState<ActionDef[]>([]);

  const [editName, setEditName] = useState("");
  const [editClassification, setEditClassification] = useState("");
  const [editActions, setEditActions] = useState<ActionDef[]>([]);

  const { data: workflows, isLoading, isError, refetch } = useQuery<Workflow[]>({ queryKey: ["/api/workflows"] });
  // Run history is server-paged and searchable: one bounded page is read at a time, never the whole table.
  // Tab, search, status, page and the opened run are validated URL parameters (reload and Back/Forward keep them).
  const [activeTab, setActiveTab] = useUrlParam<string>("wf_tab", "workflows", raw => (["workflows", "runs"].includes(raw) ? raw : undefined));
  const [runSearch, setRunSearch] = useUrlParam<string>("wf_q", "", raw => (raw.length <= 120 ? raw : undefined), { history: "replace" });
  const [runSearchInput, setRunSearchInput] = useState(runSearch);
  const [runStatus, setRunStatus] = useUrlParam<string>("wf_status", "all", raw => (raw === "all" || (RUN_STATUS_FILTERS as readonly string[]).includes(raw) ? raw : undefined));
  const [runPage, setRunPage] = useUrlParam<number>("wf_page", 1, raw => (/^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : undefined));
  const [openRunParam, setOpenRunParam] = useUrlParam<number>("wf_run", 0, raw => (/^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : undefined));
  const runOffset = (runPage - 1) * RUN_PAGE_SIZE;
  const setRunOffset = (offset: number) => setRunPage(Math.floor(offset / RUN_PAGE_SIZE) + 1);
  useEffect(() => { setRunSearchInput(runSearch); }, [runSearch]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = runSearchInput.trim();
      if (trimmed !== runSearch) { setRunSearch(trimmed); setRunPage(1); }
    }, 300);
    return () => clearTimeout(timer);
  }, [runSearchInput]);
  const runsParams = { limit: RUN_PAGE_SIZE, offset: runOffset, search: runSearch, status: runStatus === "all" ? "" : runStatus };
  const { data: runsPage, isError: runsError, isFetching: runsFetching, refetch: refetchRuns } = useQuery<RunsPage>({
    queryKey: ["/api/workflow-runs", runsParams],
    queryFn: async ({ signal }) => readRunsPage(runsParams, signal),
  });
  const runs = runsPage?.data;
  const openRun = openRunParam > 0 ? (runs?.find((r) => r.id === openRunParam) ?? null) : null;
  const runsFetchedAt = runsPage ? new Date().toLocaleString() : undefined;

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/workflows", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow created" });
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create workflow", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => {
      const res = await apiRequest("PUT", `/api/workflows/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow updated" });
      setEditOpen(false);
      setDetailWorkflow(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update workflow", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const expectedVersion = workflows?.find(w => w.id === id)?.version;
      if (!expectedVersion) throw new Error("Reload the workflow before changing it");
      const res = await apiRequest("PUT", `/api/workflows/${id}`, { enabled, expectedVersion });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to toggle workflow", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const expectedVersion = workflows?.find(w => w.id === id)?.version;
      if (!expectedVersion) throw new Error("Reload the workflow before retiring it");
      await apiRequest("DELETE", `/api/workflows/${id}`, { expectedVersion });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-runs"] });
      toast({ title: "Workflow retired", description: "History is retained. Restore returns it disabled." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to retire workflow", description: err.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/workflows/${id}/run`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-runs"] });
      toast({ title: "Workflow executed successfully" });
    },
    onError: () => {
      toast({ title: "Workflow execution failed", variant: "destructive" });
    },
  });

  function resetCreateForm() {
    setNewName("");
    setNewTrigger("");
    setNewClassification("");
    setNewActions([]);
  }

  function addAction() {
    setNewActions([...newActions, { type: "create_task", title: "", assignedTo: "", priority: "medium", dueHours: 2 }]);
  }

  function updateAction(index: number, updates: Partial<ActionDef>) {
    const updated = [...newActions];
    updated[index] = { ...updated[index], ...updates };
    setNewActions(updated);
  }

  function removeAction(index: number) {
    setNewActions(newActions.filter((_, i) => i !== index));
  }

  function addEditAction() {
    setEditActions([...editActions, { type: "create_task", title: "", assignedTo: "", priority: "medium", dueHours: 2 }]);
  }

  function updateEditAction(index: number, updates: Partial<ActionDef>) {
    const updated = [...editActions];
    updated[index] = { ...updated[index], ...updates };
    setEditActions(updated);
  }

  function removeEditAction(index: number) {
    setEditActions(editActions.filter((_, i) => i !== index));
  }

  function handleCreate() {
    if (!newName || !newTrigger) return;
    if (newTrigger === "inbound_message" && !newClassification) return;
    const body: any = {
      name: newName,
      triggerType: newTrigger,
      actions: newActions,
      enabled: true,
    };
    if (newTrigger === "inbound_message") {
      body.triggerConditions = { classification: newClassification };
    }
    createMutation.mutate(body);
  }

  function openEdit(wf: Workflow) {
    setDetailWorkflow(wf);
    setEditName(wf.name);
    setEditClassification(getClassification(wf) ?? "");
    setEditActions((wf.actions as ActionDef[]) || []);
    setEditOpen(true);
  }

  function handleUpdate() {
    if (!detailWorkflow) return;
    const body: any = {
      name: editName,
      actions: editActions,
      expectedVersion: detailWorkflow.version,
    };
    if (detailWorkflow.triggerType === "inbound_message" && editClassification) {
      body.triggerConditions = { classification: editClassification };
    }
    updateMutation.mutate({ id: detailWorkflow.id, body });
  }

  // A recorded "completed" status is shown as recorded; older runs whose log has failed, blocked, unknown or locally
  // queued steps additionally show that the outcome was incomplete. History is never rewritten.
  const runStepProblems = (run: { log?: unknown }) => {
    const entries = Array.isArray(run.log) ? run.log as Array<{ step?: number; action?: string; status?: string }> : [];
    const last = new Map<string, number>();
    entries.forEach((e, i) => { if (typeof e?.step === "number" && e.step > 0) last.set(`${e.step}:${e.action}`, i); });
    // After a controlled retry the latest entry per step is its outcome.
    return entries.filter((e, i) => !(typeof e?.step === "number" && e.step > 0 && last.get(`${e.step}:${e.action}`) !== i))
      .filter((e) => ["failed", "queued_no_ghl", "unknown_outcome", "blocked"].includes(e?.status ?? "")).length;
  };
  const runStatusLabel = (run: { status: string | null; log?: unknown }) => {
    const problems = runStepProblems(run);
    return run.status === "completed" && problems > 0
      ? `completed · ${problems} step${problems === 1 ? "" : "s"} with unresolved or failed outcome`
      : (run.status ?? "unknown");
  };
  const statusIcon = (status: string | null, problems = 0) => {
    if (status === "completed" && problems > 0) return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    if (status === "blocked") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "failed") return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === "running") return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
    return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
  };

  const detailRunsParams = { workflowId: detailWorkflow?.id, limit: 5, offset: 0 };
  const { data: detailRunsPage } = useQuery<RunsPage>({
    queryKey: ["/api/workflow-runs", detailRunsParams],
    enabled: !!detailWorkflow && !editOpen,
    queryFn: async ({ signal }) => readRunsPage(detailRunsParams, signal),
  });
  const detailRuns = detailWorkflow && !editOpen ? (detailRunsPage?.data ?? []) : [];

  if (isError) {
    return <DashboardErrorState title="Failed to load workflows" onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6" data-testid="page-workflows">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-workflows-title">Workflow Automation</h2>
          <p className="text-sm text-muted-foreground">Create automated workflows with triggers and actions</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-workflow">
              <Plus className="w-4 h-4" />
              New Workflow
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Workflow</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Workflow Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., New Lead Follow-up"
                  data-testid="input-workflow-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select value={newTrigger} onValueChange={(v) => { setNewTrigger(v); setNewClassification(""); }}>
                  <SelectTrigger data-testid="select-workflow-trigger">
                    <SelectValue placeholder="Select trigger..." />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKFLOW_TRIGGERS.map((t) => (
                      <SelectItem key={t} value={t}>{triggerLabels[t] || t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {newTrigger === "inbound_message" && (
                <div className="space-y-2">
                  <Label>Classification Filter</Label>
                  <p className="text-xs text-muted-foreground">
                    This workflow triggers only when an inbound message is classified as the selected intent.
                  </p>
                  <Select value={newClassification} onValueChange={setNewClassification}>
                    <SelectTrigger data-testid="select-workflow-classification">
                      <SelectValue placeholder="Select classification..." />
                    </SelectTrigger>
                    <SelectContent>
                      {INBOUND_CLASSIFICATIONS.map((c) => (
                        <SelectItem key={c} value={c}>{INBOUND_CLASSIFICATION_LABELS[c] || c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Actions</Label>
                  <Button variant="outline" size="sm" onClick={addAction} data-testid="button-add-action">
                    <Plus className="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>

                {newActions.map((action, idx) => (
                  <ActionCard
                    key={idx}
                    action={action}
                    idx={idx}
                    onUpdate={updateAction}
                    onRemove={removeAction}
                  />
                ))}
              </div>

              <Button
                onClick={handleCreate}
                disabled={
                  !newName ||
                  !newTrigger ||
                  (newTrigger === "inbound_message" && !newClassification) ||
                  createMutation.isPending
                }
                className="w-full"
                data-testid="button-submit-workflow"
              >
                {createMutation.isPending ? "Creating..." : "Create Workflow"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-workflows">
          <TabsTrigger value="workflows" data-testid="tab-workflows">Workflows ({workflows?.length || 0})</TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">Run History ({runsPage ? runsPage.total : "…"})</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="mt-4">
          {isLoading ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Loading...</CardContent></Card>
          ) : !workflows?.length ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Zap className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">No Workflows Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">Create your first automated workflow to streamline operations.</p>
                <Button onClick={() => setCreateOpen(true)} data-testid="button-create-first-workflow">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Workflow
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => {
                const wfActions = (wf.actions as ActionDef[]) || [];
                const classification = getClassification(wf);
                return (
                  <Card key={wf.id} data-testid={`card-workflow-${wf.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {wf.triggerType === "inbound_message" ? (
                            <MessageSquare className={`w-5 h-5 shrink-0 ${wf.enabled ? "text-primary" : "text-muted-foreground"}`} />
                          ) : (
                            <Zap className={`w-5 h-5 shrink-0 ${wf.enabled ? "text-primary" : "text-muted-foreground"}`} />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium truncate" data-testid={`text-workflow-name-${wf.id}`}>{wf.name}</div>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <Badge variant="outline">{triggerLabels[wf.triggerType] || wf.triggerType}</Badge>
                              {classification && (
                                <Badge variant="secondary" className="gap-1" data-testid={`badge-classification-${wf.id}`}>
                                  <MessageSquare className="w-3 h-3" />
                                  {INBOUND_CLASSIFICATION_LABELS[classification] || classification}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">{wfActions.length} action{wfActions.length !== 1 ? "s" : ""}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{wf.retiredAt ? "Retired · history retained" : wf.enabled ? "Active" : "Disabled"}</span>
                            <Switch
                              checked={!!wf.enabled}
                              disabled={!!wf.retiredAt || toggleMutation.isPending}
                              onCheckedChange={(checked) => toggleMutation.mutate({ id: wf.id, enabled: checked })}
                              data-testid={`switch-workflow-${wf.id}`}
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Edit workflow"
                            onClick={() => openEdit(wf)}
                            data-testid={`button-detail-workflow-${wf.id}`}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          {wf.triggerType === "manual" && (
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Run workflow"
                              onClick={() => runMutation.mutate(wf.id)}
                              disabled={runMutation.isPending}
                              data-testid={`button-run-workflow-${wf.id}`}
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={wf.retiredAt ? "Restore workflow disabled" : "Retire workflow"}
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (wf.retiredAt) {
                                apiRequest("POST", `/api/workflows/${wf.id}/restore`, { expectedVersion: wf.version })
                                  .then(() => { queryClient.invalidateQueries({ queryKey: ["/api/workflows"] }); toast({ title: "Restored disabled; no run started" }); })
                                  .catch((err: Error) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }));
                              } else if (window.confirm("Retire this workflow? History will be kept and it can be restored disabled.")) deleteMutation.mutate(wf.id);
                            }}
                            data-testid={`button-delete-workflow-${wf.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="run-history-controls">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search run history"
                placeholder="Search run id, workflow, contact or deal #"
                className="pl-8"
                value={runSearchInput}
                onChange={(e) => setRunSearchInput(e.target.value)}
                data-testid="input-run-search"
              />
            </div>
            <Select value={runStatus} onValueChange={(value) => { setRunStatus(value); setRunPage(1); }}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter runs by status" data-testid="select-run-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {RUN_STATUS_FILTERS.map((status) => <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {runsError ? (
            <Card>
              <CardContent className="space-y-2 p-8 text-center" role="alert" data-testid="run-history-unavailable">
                <p className="text-sm">Run history could not be read. This is not an empty history.</p>
                <Button variant="outline" size="sm" onClick={() => void refetchRuns()} data-testid="button-retry-runs">Retry</Button>
              </CardContent>
            </Card>
          ) : !runsPage ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground" role="status" data-testid="run-history-loading">Loading run history...</CardContent></Card>
          ) : !runs?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground" data-testid="run-history-empty">
                {runSearch || runStatus !== "all"
                  ? "No workflow runs match this search."
                  : runOffset > 0
                    ? "No runs on this page."
                    : "No workflow runs yet. Create and execute a workflow to see run history."}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollArea className="max-h-[500px]">
                <div className="overflow-x-auto" role="region" aria-label="Workflow run history" tabIndex={0}>
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead><span className="sr-only">Details</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const wf = workflows?.find((w) => w.id === run.workflowId);
                      return (
                        <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                          <TableCell className="font-mono text-sm">#{run.id}</TableCell>
                          <TableCell>{wf?.name || `Workflow #${run.workflowId}`}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {statusIcon(run.status, runStepProblems(run))}
                              <span className="text-sm capitalize" data-testid={`text-run-status-${run.id}`}>{runStatusLabel(run)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {run.entityType ? `${run.entityType} #${run.entityId}` : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {run.createdAt ? new Date(run.createdAt).toLocaleString() : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {run.completedAt ? new Date(run.completedAt).toLocaleString() : "-"}
                          </TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" className="min-h-11" onClick={() => setOpenRunParam(run.id)}
                              aria-label={`View details for run ${run.id}`} data-testid={`button-run-details-${run.id}`}>Details</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </ScrollArea>
            </Card>
          )}
          {runsPage && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-16" data-testid="run-history-pager">
              <span className="text-xs text-muted-foreground" role="status" data-testid="text-run-range">
                {runsPage.total === 0 ? "0 runs" : `Showing ${runOffset + 1}–${runOffset + (runs?.length ?? 0)} of ${runsPage.total}`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={runOffset === 0 || runsFetching}
                  onClick={() => setRunOffset(Math.max(0, runOffset - RUN_PAGE_SIZE))} data-testid="button-runs-prev">Previous</Button>
                <Button variant="outline" size="sm" disabled={runsFetching || runOffset + RUN_PAGE_SIZE >= runsPage.total}
                  onClick={() => setRunOffset(runOffset + RUN_PAGE_SIZE)} data-testid="button-runs-next">Next</Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={openRun !== null || (openRunParam > 0 && !!runsPage)} onOpenChange={(open) => { if (!open) setOpenRunParam(0); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="run-detail-drawer">
          {openRun ? <RunDetailBody run={openRun} workflowName={workflows?.find((w) => w.id === openRun.workflowId)?.name} asOf={runsFetchedAt} />
            : (
              <>
                <SheetHeader>
                  <SheetTitle>Run #{openRunParam}</SheetTitle>
                  <SheetDescription>This run is not on the displayed page.</SheetDescription>
                </SheetHeader>
                <p className="mt-4 text-sm text-muted-foreground" role="status" data-testid="run-detail-not-on-page">
                  The run is not in the current search, status filter or page. Clear the filters or change the page to find it; its absence here does not mean it does not exist.
                </p>
              </>
            )}
        </SheetContent>
      </Sheet>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setDetailWorkflow(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
          </DialogHeader>
          {detailWorkflow && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Workflow Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="input-edit-workflow-name"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Trigger (cannot be changed)</Label>
                <Badge variant="outline">{triggerLabels[detailWorkflow.triggerType] || detailWorkflow.triggerType}</Badge>
              </div>

              {detailWorkflow.triggerType === "inbound_message" && (
                <div className="space-y-2">
                  <Label>Classification Filter</Label>
                  <p className="text-xs text-muted-foreground">
                    This workflow triggers only when an inbound message is classified as the selected intent.
                  </p>
                  <Select value={editClassification} onValueChange={setEditClassification}>
                    <SelectTrigger data-testid="select-edit-classification">
                      <SelectValue placeholder="Select classification..." />
                    </SelectTrigger>
                    <SelectContent>
                      {INBOUND_CLASSIFICATIONS.map((c) => (
                        <SelectItem key={c} value={c}>{INBOUND_CLASSIFICATION_LABELS[c] || c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Actions</Label>
                  <Button variant="outline" size="sm" onClick={addEditAction} data-testid="button-add-edit-action">
                    <Plus className="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>

                {editActions.map((action, idx) => (
                  <ActionCard
                    key={idx}
                    action={action}
                    idx={idx}
                    idPrefix="edit-"
                    onUpdate={updateEditAction}
                    onRemove={removeEditAction}
                  />
                ))}

                {editActions.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3 border rounded-md">
                    No actions defined. Add an action to automate a response.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setEditOpen(false); setDetailWorkflow(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleUpdate}
                  disabled={
                    !editName ||
                    (detailWorkflow.triggerType === "inbound_message" && !editClassification) ||
                    updateMutation.isPending
                  }
                  data-testid="button-submit-edit-workflow"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>

              {detailRuns.length > 0 && (
                <div>
                  <Label className="text-muted-foreground text-xs">Recent Runs</Label>
                  <div className="space-y-1 mt-1">
                    {detailRuns.slice(0, 5).map((run) => (
                      <div key={run.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {statusIcon(run.status, runStepProblems(run))}
                        <span className="capitalize">{runStatusLabel(run)}</span>
                        <span>•</span>
                        <span>{run.createdAt ? new Date(run.createdAt).toLocaleString() : "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionCard({
  action,
  idx,
  idPrefix = "",
  onUpdate,
  onRemove,
}: {
  action: ActionDef;
  idx: number;
  idPrefix?: string;
  onUpdate: (index: number, updates: Partial<ActionDef>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">Step {idx + 1}</Badge>
          <Button variant="ghost" size="icon" aria-label="Remove action" onClick={() => onRemove(idx)} data-testid={`button-remove-action-${idPrefix}${idx}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <Select value={action.type} onValueChange={(v) => onUpdate(idx, { type: v })}>
          <SelectTrigger data-testid={`select-action-type-${idPrefix}${idx}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create_task">Create Task</SelectItem>
            <SelectItem value="send_notification">Send Notification</SelectItem>
            <SelectItem value="create_audit_log">Log to Audit Trail</SelectItem>
          </SelectContent>
        </Select>

        {action.type === "create_task" && (
          <div className="space-y-2">
            <Input
              value={action.title || ""}
              onChange={(e) => onUpdate(idx, { title: e.target.value })}
              placeholder="Task title"
              data-testid={`input-action-title-${idPrefix}${idx}`}
            />
            <div className="flex gap-2">
              <Input
                value={action.assignedTo || ""}
                onChange={(e) => onUpdate(idx, { assignedTo: e.target.value })}
                placeholder="Assigned to"
                data-testid={`input-action-assigned-${idPrefix}${idx}`}
              />
              <Select value={action.priority || "medium"} onValueChange={(v) => onUpdate(idx, { priority: v })}>
                <SelectTrigger data-testid={`select-action-priority-${idPrefix}${idx}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              type="number"
              value={action.dueHours || ""}
              onChange={(e) => onUpdate(idx, { dueHours: Number(e.target.value) })}
              placeholder="Due in hours"
              data-testid={`input-action-due-hours-${idPrefix}${idx}`}
            />
          </div>
        )}

        {action.type === "send_notification" && (
          <div className="space-y-2">
            <Input
              value={action.title || ""}
              onChange={(e) => onUpdate(idx, { title: e.target.value })}
              placeholder="Notification title"
              data-testid={`input-action-notif-title-${idPrefix}${idx}`}
            />
            <Input
              value={action.message || ""}
              onChange={(e) => onUpdate(idx, { message: e.target.value })}
              placeholder="Notification message"
              data-testid={`input-action-notif-message-${idPrefix}${idx}`}
            />
            <Select value={action.channel || "internal"} onValueChange={(v) => onUpdate(idx, { channel: v })}>
              <SelectTrigger data-testid={`select-action-channel-${idPrefix}${idx}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="#sales">#sales</SelectItem>
                <SelectItem value="#support">#support</SelectItem>
                <SelectItem value="#onboarding">#onboarding</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {action.type === "create_audit_log" && (
          <Input
            value={action.logAction || ""}
            onChange={(e) => onUpdate(idx, { logAction: e.target.value })}
            placeholder="Log action name"
            data-testid={`input-action-log-${idPrefix}${idx}`}
          />
        )}
      </CardContent>
    </Card>
  );
}


type RunLogEntry = { step?: number; action?: string; status?: string; reason?: string; error?: string; replay?: boolean; timestamp?: string };
const STEP_STATE_COPY: Record<string, string> = {
  completed: "Completed",
  failed: "Failed (the provider or action refused it)",
  blocked: "Blocked (held for review; not delivered)",
  queued_no_ghl: "Held locally; nothing was delivered",
  unknown_outcome: "Unknown: the provider may have accepted it; it is never re-sent automatically",
  skipped: "Skipped",
};

/** Run detail from recorded state only: owner, occurrence, next owed step, reason and per-step outcomes. */
function RunDetailBody({ run, workflowName, asOf }: { run: WorkflowRun; workflowName?: string; asOf?: string }) {
  const entries = (Array.isArray(run.log) ? run.log : []) as RunLogEntry[];
  const latest = new Map<string, RunLogEntry>();
  entries.forEach((e) => { if (typeof e?.step === "number" && e.step > 0) latest.set(`${e.step}:${e.action}`, e); });
  const steps = [...latest.values()].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const owed = steps.find((e) => ["failed", "blocked", "queued_no_ghl", "unknown_outcome"].includes(e.status ?? ""));
  const occurrence = (run as unknown as { occurrenceKey?: string | null }).occurrenceKey ?? null;
  const row = (label: string, value: string, mono = false) => (
    <div className="grid grid-cols-3 gap-2 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className={`col-span-2 break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>
  );
  return (
    <>
      <SheetHeader>
        <SheetTitle data-testid="run-detail-title">Run #{run.id}</SheetTitle>
        <SheetDescription>{workflowName ?? `Workflow #${run.workflowId}`}</SheetDescription>
      </SheetHeader>
      <dl className="mt-4 space-y-2" data-testid="run-detail-facts">
        {row("Status", run.status ?? "unknown")}
        {row("Entity", run.entityType ? `${run.entityType} #${run.entityId}` : "None")}
        {row("Occurrence", occurrence ?? "No occurrence identity (older run)", true)}
        {row("Current step", String(run.currentStep ?? 0))}
        {row("Next run", run.nextRunAt ? new Date(run.nextRunAt).toLocaleString() : "None scheduled")}
        {row("Started", run.createdAt ? new Date(run.createdAt).toLocaleString() : "-")}
        {row("Page read", asOf ?? "-")}
      </dl>
      <section className="mt-5 space-y-2" aria-labelledby="run-owed-h" data-testid="run-detail-owed">
        <h3 id="run-owed-h" className="text-sm font-semibold">Next owed step</h3>
        <p className="text-sm text-muted-foreground">
          {owed
            ? `Step ${owed.step} (${owed.action}): ${STEP_STATE_COPY[owed.status ?? ""] ?? owed.status}${owed.reason || owed.error ? ` — ${owed.reason ?? owed.error}` : ""}`
            : run.status === "waiting" ? "The run is waiting for its next scheduled step." : "No unresolved step is recorded."}
        </p>
      </section>
      <section className="mt-5 space-y-2" aria-labelledby="run-steps-h" data-testid="run-detail-steps">
        <h3 id="run-steps-h" className="text-sm font-semibold">Recorded step outcomes</h3>
        {steps.length === 0 ? <p className="text-sm text-muted-foreground">No step outcome is recorded.</p> : (
          <ul className="space-y-2">
            {steps.map((e) => (
              <li key={`${e.step}-${e.action}`} className="rounded-md border p-2 text-sm">
                <span className="font-medium">Step {e.step} · {e.action}</span>
                <span className="block text-xs">{STEP_STATE_COPY[e.status ?? ""] ?? e.status ?? "Not recorded"}{e.replay ? " (replayed receipt)" : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">These are recorded outcomes. “Completed” on a send means the provider accepted it, not that the person received it. No retry is offered here.</p>
      </section>
    </>
  );
}
