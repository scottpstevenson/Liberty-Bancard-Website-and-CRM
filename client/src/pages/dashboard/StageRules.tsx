import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowRight, Pencil, Loader2, Zap } from "lucide-react";

const SALES_STAGES = ["New Lead", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Nurture / Not Now", "Closed Won", "Closed Lost"];
const ONBOARDING_STAGES = ["Application Submitted", "Application Started", "Underwriting Submitted", "Approved", "Terminal Ordered", "Go-Live Scheduled", "Live (First Batch)", "Active (7 Days)", "Active (30 Days)"];
const SUPPORT_STAGES = ["New Ticket", "In Progress", "Waiting on Merchant", "Resolved", "Closed"];

const PIPELINE_STAGES: Record<string, string[]> = {
  sales: SALES_STAGES,
  onboarding: ONBOARDING_STAGES,
  support: SUPPORT_STAGES,
};

const PIPELINE_LABELS: Record<string, string> = {
  sales: "Sales",
  onboarding: "Onboarding",
  support: "Support",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_task: "Create Task",
  send_email: "Send Email",
  send_notification: "Send Notification",
  create_follow_up: "Create Follow-Up",
  enroll_sequence: "Enroll in Sequence",
  assign_owner: "Assign Owner",
};

interface ActionConfig {
  type: string;
  title?: string;
  assignedTo?: string;
  priority?: string;
  dueHours?: number;
  message?: string;
  channel?: string;
  delayHours?: number;
  description?: string;
  sequenceId?: string;
  owner?: string;
}

interface StageRule {
  id: number;
  name: string;
  pipeline: string;
  fromStage: string | null;
  toStage: string;
  actions: ActionConfig[];
  enabled: boolean;
  createdAt: string;
}

interface Sequence {
  id: number;
  name: string;
}

function getEmptyAction(type: string): ActionConfig {
  switch (type) {
    case "create_task":
      return { type, title: "", assignedTo: "", priority: "medium", dueHours: 2 };
    case "send_email":
      return { type, title: "", message: "" };
    case "send_notification":
      return { type, title: "", message: "", channel: "in_app" };
    case "create_follow_up":
      return { type, title: "", delayHours: 24, description: "" };
    case "enroll_sequence":
      return { type, sequenceId: "" };
    case "assign_owner":
      return { type, owner: "" };
    default:
      return { type };
  }
}

export default function StageRules() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<StageRule | null>(null);

  const [name, setName] = useState("");
  const [pipeline, setPipeline] = useState("sales");
  const [fromStage, setFromStage] = useState("any");
  const [toStage, setToStage] = useState("");
  const [actions, setActions] = useState<ActionConfig[]>([]);

  const { data: rules, isLoading } = useQuery<StageRule[]>({
    queryKey: ["/api/stage-rules"],
  });

  const { data: sequences } = useQuery<Sequence[]>({
    queryKey: ["/api/sequences"],
  });

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/stage-rules", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-rules"] });
      toast({ title: "Rule created" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create rule", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: any) => {
      const res = await apiRequest("PUT", `/api/stage-rules/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-rules"] });
      toast({ title: "Rule updated" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update rule", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await apiRequest("PUT", `/api/stage-rules/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-rules"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/stage-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete rule", description: error.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setName("");
    setPipeline("sales");
    setFromStage("any");
    setToStage("");
    setActions([]);
    setEditingRule(null);
  }

  function closeDialog() {
    setCreateOpen(false);
    resetForm();
  }

  function openEdit(rule: StageRule) {
    setEditingRule(rule);
    setName(rule.name);
    setPipeline(rule.pipeline);
    setFromStage(rule.fromStage || "any");
    setToStage(rule.toStage);
    setActions(rule.actions || []);
    setCreateOpen(true);
  }

  function addAction() {
    setActions([...actions, getEmptyAction("create_task")]);
  }

  function updateAction(index: number, updates: Partial<ActionConfig>) {
    const updated = [...actions];
    if (updates.type && updates.type !== updated[index].type) {
      updated[index] = getEmptyAction(updates.type);
    } else {
      updated[index] = { ...updated[index], ...updates };
    }
    setActions(updated);
  }

  function removeAction(index: number) {
    setActions(actions.filter((_, i) => i !== index));
  }

  function handleSave() {
    if (!name || !toStage) return;
    const body = {
      name,
      pipeline,
      fromStage: fromStage === "any" ? null : fromStage,
      toStage,
      actions,
      enabled: true,
    };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, ...body });
    } else {
      createMutation.mutate(body);
    }
  }

  const stages = PIPELINE_STAGES[pipeline] || [];
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6" data-testid="page-stage-rules">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-stage-rules-title">Stage Automation Rules</h2>
          <p className="text-sm text-muted-foreground" data-testid="text-stage-rules-description">
            Automatically trigger actions when deals move between stages
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setCreateOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-rule">
              <Plus className="w-4 h-4" />
              Create Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle data-testid="text-dialog-title">
                {editingRule ? "Edit Rule" : "Create Rule"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Welcome email on closed won"
                  data-testid="input-rule-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select value={pipeline} onValueChange={(v) => { setPipeline(v); setFromStage("any"); setToStage(""); }}>
                  <SelectTrigger data-testid="select-pipeline">
                    <SelectValue placeholder="Select pipeline..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>From Stage</Label>
                <Select value={fromStage} onValueChange={setFromStage}>
                  <SelectTrigger data-testid="select-from-stage">
                    <SelectValue placeholder="Select stage..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any Stage</SelectItem>
                    {stages.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>To Stage</Label>
                <Select value={toStage} onValueChange={setToStage}>
                  <SelectTrigger data-testid="select-to-stage">
                    <SelectValue placeholder="Select stage..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label>Actions</Label>
                  <Button variant="outline" size="sm" onClick={addAction} data-testid="button-add-action">
                    <Plus className="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>

                {actions.map((action, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="secondary">Action {idx + 1}</Badge>
                        <Button variant="ghost" size="icon" onClick={() => removeAction(idx)} data-testid={`button-remove-action-${idx}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      <Select value={action.type} onValueChange={(v) => updateAction(idx, { type: v })}>
                        <SelectTrigger data-testid={`select-action-type-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="create_task">Create Task</SelectItem>
                          <SelectItem value="send_email">Send Email</SelectItem>
                          <SelectItem value="send_notification">Send Notification</SelectItem>
                          <SelectItem value="create_follow_up">Create Follow-Up</SelectItem>
                          <SelectItem value="enroll_sequence">Enroll in Sequence</SelectItem>
                          <SelectItem value="assign_owner">Assign Owner</SelectItem>
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
                          <div className="flex gap-2 flex-wrap">
                            <Input
                              value={action.assignedTo || ""}
                              onChange={(e) => updateAction(idx, { assignedTo: e.target.value })}
                              placeholder="Assigned to"
                              className="flex-1"
                              data-testid={`input-action-assigned-${idx}`}
                            />
                            <Select value={action.priority || "medium"} onValueChange={(v) => updateAction(idx, { priority: v })}>
                              <SelectTrigger className="w-28" data-testid={`select-action-priority-${idx}`}>
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
                            value={action.dueHours ?? ""}
                            onChange={(e) => updateAction(idx, { dueHours: Number(e.target.value) })}
                            placeholder="Due in hours"
                            data-testid={`input-action-due-hours-${idx}`}
                          />
                        </div>
                      )}

                      {action.type === "send_email" && (
                        <div className="space-y-2">
                          <Input
                            value={action.title || ""}
                            onChange={(e) => updateAction(idx, { title: e.target.value })}
                            placeholder="Email subject"
                            data-testid={`input-action-title-${idx}`}
                          />
                          <Input
                            value={action.message || ""}
                            onChange={(e) => updateAction(idx, { message: e.target.value })}
                            placeholder="Email body"
                            data-testid={`input-action-message-${idx}`}
                          />
                        </div>
                      )}

                      {action.type === "send_notification" && (
                        <div className="space-y-2">
                          <Input
                            value={action.title || ""}
                            onChange={(e) => updateAction(idx, { title: e.target.value })}
                            placeholder="Notification title"
                            data-testid={`input-action-title-${idx}`}
                          />
                          <Input
                            value={action.message || ""}
                            onChange={(e) => updateAction(idx, { message: e.target.value })}
                            placeholder="Notification message"
                            data-testid={`input-action-message-${idx}`}
                          />
                          <Select value={action.channel || "in_app"} onValueChange={(v) => updateAction(idx, { channel: v })}>
                            <SelectTrigger data-testid={`select-action-channel-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="in_app">In-App</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="sms">SMS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {action.type === "create_follow_up" && (
                        <div className="space-y-2">
                          <Input
                            value={action.title || ""}
                            onChange={(e) => updateAction(idx, { title: e.target.value })}
                            placeholder="Follow-up title"
                            data-testid={`input-action-title-${idx}`}
                          />
                          <Input
                            type="number"
                            value={action.delayHours ?? ""}
                            onChange={(e) => updateAction(idx, { delayHours: Number(e.target.value) })}
                            placeholder="Delay in hours"
                            data-testid={`input-action-delay-hours-${idx}`}
                          />
                          <Input
                            value={action.description || ""}
                            onChange={(e) => updateAction(idx, { description: e.target.value })}
                            placeholder="Description"
                            data-testid={`input-action-description-${idx}`}
                          />
                        </div>
                      )}

                      {action.type === "enroll_sequence" && (
                        <div className="space-y-2">
                          <Select value={action.sequenceId || ""} onValueChange={(v) => updateAction(idx, { sequenceId: v })}>
                            <SelectTrigger data-testid={`select-action-sequence-${idx}`}>
                              <SelectValue placeholder="Select sequence..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(sequences || []).map((seq) => (
                                <SelectItem key={seq.id} value={String(seq.id)}>{seq.name}</SelectItem>
                              ))}
                              {(!sequences || sequences.length === 0) && (
                                <SelectItem value="_none" disabled>No sequences available</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {action.type === "assign_owner" && (
                        <div className="space-y-2">
                          <Input
                            value={action.owner || ""}
                            onChange={(e) => updateAction(idx, { owner: e.target.value })}
                            placeholder="Owner name"
                            data-testid={`input-action-owner-${idx}`}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={handleSave}
                disabled={!name || !toStage || isSaving}
                data-testid="button-save-rule"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {editingRule ? "Update Rule" : "Save Rule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" data-testid="loading-spinner" />
        </div>
      ) : !rules || rules.length === 0 ? (
        <Card data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-lg font-medium" data-testid="text-empty-title">No automation rules yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first rule to automate actions when deals move between stages.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4" data-testid="rules-list">
          {rules.map((rule) => (
            <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-sm font-semibold" data-testid={`text-rule-name-${rule.id}`}>{rule.name}</h3>
                      <Badge variant="outline" data-testid={`badge-pipeline-${rule.id}`}>
                        {PIPELINE_LABELS[rule.pipeline] || rule.pipeline}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`text-rule-stages-${rule.id}`}>
                      <span>{rule.fromStage || "Any Stage"}</span>
                      <ArrowRight className="w-4 h-4 shrink-0" />
                      <span>{rule.toStage}</span>
                    </div>
                    {rule.actions && rule.actions.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap" data-testid={`actions-list-${rule.id}`}>
                        {rule.actions.map((action: ActionConfig, idx: number) => (
                          <Badge key={idx} variant="secondary" data-testid={`badge-action-${rule.id}-${idx}`}>
                            {ACTION_TYPE_LABELS[action.type] || action.type}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, enabled: checked })}
                      data-testid={`switch-rule-enabled-${rule.id}`}
                    />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(rule)} data-testid={`button-edit-rule-${rule.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      data-testid={`button-delete-rule-${rule.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
