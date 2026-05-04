import { useState } from "react";
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
import { Plus, Play, Trash2, Zap, Clock, CheckCircle2, XCircle, AlertTriangle, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import type { Workflow, WorkflowRun } from "@shared/schema";
import { WORKFLOW_TRIGGERS } from "@shared/schema";
import DashboardErrorState from "@/components/DashboardErrorState";

const triggerLabels: Record<string, string> = {
  deal_stage_changed: "Deal Stage Changed",
  ticket_created: "Ticket Created",
  contact_created: "Contact Created",
  deal_created: "Deal Created",
  ticket_sla_breach: "Ticket SLA Breach",
  manual: "Manual Trigger",
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

export default function Workflows() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailWorkflow, setDetailWorkflow] = useState<Workflow | null>(null);

  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [newActions, setNewActions] = useState<ActionDef[]>([]);

  const { data: workflows, isLoading, isError, refetch } = useQuery<Workflow[]>({ queryKey: ["/api/workflows"] });
  const { data: runs } = useQuery<WorkflowRun[]>({ queryKey: ["/api/workflow-runs"] });

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/workflows", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow created" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create workflow", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await apiRequest("PUT", `/api/workflows/${id}`, { enabled });
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
      await apiRequest("DELETE", `/api/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-runs"] });
      toast({ title: "Workflow deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete workflow", description: err.message, variant: "destructive" });
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

  function resetForm() {
    setNewName("");
    setNewTrigger("");
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

  function handleCreate() {
    if (!newName || !newTrigger) return;
    createMutation.mutate({
      name: newName,
      triggerType: newTrigger,
      actions: newActions,
      enabled: true,
    });
  }

  const statusIcon = (status: string | null) => {
    if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "failed") return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === "running") return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
    return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
  };

  const detailRuns = detailWorkflow
    ? (runs || []).filter((r) => r.workflowId === detailWorkflow.id)
    : [];

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
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                <Select value={newTrigger} onValueChange={setNewTrigger}>
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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Actions</Label>
                  <Button variant="outline" size="sm" onClick={addAction} data-testid="button-add-action">
                    <Plus className="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>

                {newActions.map((action, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary">Step {idx + 1}</Badge>
                        <Button variant="ghost" size="icon" aria-label="Remove action" onClick={() => removeAction(idx)} data-testid={`button-remove-action-${idx}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <Select value={action.type} onValueChange={(v) => updateAction(idx, { type: v })}>
                        <SelectTrigger data-testid={`select-action-type-${idx}`}>
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
                            onChange={(e) => updateAction(idx, { title: e.target.value })}
                            placeholder="Task title"
                            data-testid={`input-action-title-${idx}`}
                          />
                          <div className="flex gap-2">
                            <Input
                              value={action.assignedTo || ""}
                              onChange={(e) => updateAction(idx, { assignedTo: e.target.value })}
                              placeholder="Assigned to"
                              data-testid={`input-action-assigned-${idx}`}
                            />
                            <Select value={action.priority || "medium"} onValueChange={(v) => updateAction(idx, { priority: v })}>
                              <SelectTrigger data-testid={`select-action-priority-${idx}`}>
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
                            onChange={(e) => updateAction(idx, { dueHours: Number(e.target.value) })}
                            placeholder="Due in hours"
                            data-testid={`input-action-due-hours-${idx}`}
                          />
                        </div>
                      )}

                      {action.type === "send_notification" && (
                        <div className="space-y-2">
                          <Input
                            value={action.title || ""}
                            onChange={(e) => updateAction(idx, { title: e.target.value })}
                            placeholder="Notification title"
                            data-testid={`input-action-notif-title-${idx}`}
                          />
                          <Input
                            value={action.message || ""}
                            onChange={(e) => updateAction(idx, { message: e.target.value })}
                            placeholder="Notification message"
                            data-testid={`input-action-notif-message-${idx}`}
                          />
                          <Select value={action.channel || "internal"} onValueChange={(v) => updateAction(idx, { channel: v })}>
                            <SelectTrigger data-testid={`select-action-channel-${idx}`}>
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
                          onChange={(e) => updateAction(idx, { logAction: e.target.value })}
                          placeholder="Log action name"
                          data-testid={`input-action-log-${idx}`}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button
                onClick={handleCreate}
                disabled={!newName || !newTrigger || createMutation.isPending}
                className="w-full"
                data-testid="button-submit-workflow"
              >
                {createMutation.isPending ? "Creating..." : "Create Workflow"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="workflows">
        <TabsList data-testid="tabs-workflows">
          <TabsTrigger value="workflows" data-testid="tab-workflows">Workflows ({workflows?.length || 0})</TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">Run History ({runs?.length || 0})</TabsTrigger>
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
                return (
                  <Card key={wf.id} data-testid={`card-workflow-${wf.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Zap className={`w-5 h-5 shrink-0 ${wf.enabled ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <div className="font-medium truncate" data-testid={`text-workflow-name-${wf.id}`}>{wf.name}</div>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <Badge variant="outline">{triggerLabels[wf.triggerType] || wf.triggerType}</Badge>
                              <span className="text-xs text-muted-foreground">{wfActions.length} action{wfActions.length !== 1 ? "s" : ""}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{wf.enabled ? "Active" : "Disabled"}</span>
                            <Switch
                              checked={!!wf.enabled}
                              onCheckedChange={(checked) => toggleMutation.mutate({ id: wf.id, enabled: checked })}
                              data-testid={`switch-workflow-${wf.id}`}
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Workflow settings"
                            onClick={() => setDetailWorkflow(wf)}
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
                            aria-label="Delete workflow"
                            onClick={() => deleteMutation.mutate(wf.id)}
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

        <TabsContent value="runs" className="mt-4">
          {!runs?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No workflow runs yet. Create and execute a workflow to see run history.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollArea className="max-h-[500px]">
                <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
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
                              {statusIcon(run.status)}
                              <span className="text-sm capitalize">{run.status}</span>
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
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailWorkflow} onOpenChange={(open) => !open && setDetailWorkflow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Workflow Details</DialogTitle>
          </DialogHeader>
          {detailWorkflow && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground text-xs">Name</Label>
                <p className="font-medium" data-testid="text-detail-name">{detailWorkflow.name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Trigger</Label>
                <Badge variant="outline">{triggerLabels[detailWorkflow.triggerType] || detailWorkflow.triggerType}</Badge>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Status</Label>
                <Badge variant={detailWorkflow.enabled ? "default" : "secondary"}>
                  {detailWorkflow.enabled ? "Active" : "Disabled"}
                </Badge>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Actions ({((detailWorkflow.actions as ActionDef[]) || []).length})</Label>
                <div className="space-y-2 mt-2">
                  {((detailWorkflow.actions as ActionDef[]) || []).map((action, i) => (
                    <Card key={i}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">Step {i + 1}</Badge>
                          <span className="text-sm font-medium">{actionTypeLabels[action.type] || action.type}</span>
                        </div>
                        {action.title && <p className="text-xs text-muted-foreground">Title: {action.title}</p>}
                        {action.assignedTo && <p className="text-xs text-muted-foreground">Assigned: {action.assignedTo}</p>}
                        {action.message && <p className="text-xs text-muted-foreground">Message: {action.message}</p>}
                        {action.dueHours && <p className="text-xs text-muted-foreground">Due: {action.dueHours}h</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {detailRuns.length > 0 && (
                <div>
                  <Label className="text-muted-foreground text-xs">Recent Runs</Label>
                  <div className="space-y-1 mt-2">
                    {detailRuns.slice(0, 5).map((run) => (
                      <div key={run.id} className="flex items-center gap-2 text-sm">
                        {statusIcon(run.status)}
                        <span className="capitalize">{run.status}</span>
                        <span className="text-muted-foreground">
                          {run.createdAt ? new Date(run.createdAt).toLocaleString() : ""}
                        </span>
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
