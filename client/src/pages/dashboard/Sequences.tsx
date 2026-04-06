import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Trash2, Loader2, Play, Pause, Mail, MessageSquare, Phone,
  CheckSquare, Clock, ChevronDown, ChevronUp, Users, Zap, Send, ArrowDown,
  GripVertical, Target, BarChart3,
} from "lucide-react";

interface SequenceStep {
  id?: number;
  stepOrder: number;
  actionType: string;
  delayDays: number;
  delayHours: number;
  subject?: string;
  body?: string;
  config?: any;
}

const STEP_TYPES = [
  { value: "email", label: "Send Email", icon: Mail },
  { value: "sms", label: "Send SMS", icon: MessageSquare },
  { value: "call_reminder", label: "Call Reminder", icon: Phone },
  { value: "task", label: "Create Task", icon: CheckSquare },
  { value: "wait", label: "Wait / Delay", icon: Clock },
];

const TRIGGER_TYPES = [
  { value: "manual", label: "Manual Enrollment" },
  { value: "deal_stage_changed", label: "Deal Stage Changed" },
  { value: "contact_created", label: "New Contact Created" },
  { value: "form_submitted", label: "Form Submitted" },
];

function stepIcon(actionType: string) {
  const found = STEP_TYPES.find(s => s.value === actionType);
  return found ? found.icon : Clock;
}

function stepLabel(actionType: string) {
  const found = STEP_TYPES.find(s => s.value === actionType);
  return found ? found.label : actionType;
}

export default function Sequences() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [enrollDialogSeqId, setEnrollDialogSeqId] = useState<number | null>(null);
  const [enrollContactId, setEnrollContactId] = useState("");
  const [enrollDealId, setEnrollDealId] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    triggerType: "manual",
    status: "active",
  });
  const [steps, setSteps] = useState<SequenceStep[]>([]);

  const { data: sequences, isLoading } = useQuery<any[]>({
    queryKey: ["/api/sequences"],
  });

  const { data: allEnrollments } = useQuery<any[]>({
    queryKey: ["/api/sequence-enrollments"],
  });

  const { data: contactsRes } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes?.data;

  const createMutation = useMutation({
    mutationFn: async () => {
      const seqRes = await apiRequest("POST", "/api/sequences", {
        name: form.name,
        description: form.description,
        triggerType: form.triggerType,
        status: form.status,
        totalSteps: steps.length,
      });
      const seq = await seqRes.json();
      for (let i = 0; i < steps.length; i++) {
        await apiRequest("POST", `/api/sequences/${seq.id}/steps`, {
          stepOrder: i + 1,
          actionType: steps[i].actionType,
          delayDays: steps[i].delayDays,
          delayHours: steps[i].delayHours,
          subject: steps[i].subject || null,
          body: steps[i].body || null,
          config: steps[i].config || null,
        });
      }
      return seq;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      setShowCreate(false);
      setForm({ name: "", description: "", triggerType: "manual", status: "active" });
      setSteps([]);
      toast({ title: "Drip sequence created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create sequence", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sequences/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      toast({ title: "Sequence deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PUT", `/api/sequences/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/sequence-enrollments", {
        sequenceId: enrollDialogSeqId,
        contactId: enrollContactId ? Number(enrollContactId) : null,
        dealId: enrollDealId ? Number(enrollDealId) : null,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequence-enrollments"] });
      setEnrollDialogSeqId(null);
      setEnrollContactId("");
      setEnrollDealId("");
      toast({ title: "Contact enrolled in sequence" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to enroll", description: err.message, variant: "destructive" });
    },
  });

  const addStep = () => {
    setSteps([...steps, {
      stepOrder: steps.length + 1,
      actionType: "email",
      delayDays: steps.length === 0 ? 0 : 2,
      delayHours: 0,
      subject: "",
      body: "",
    }]);
  };

  const updateStep = (index: number, updates: Partial<SequenceStep>) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], ...updates };
    setSteps(updated);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 })));
  };

  const totalEnrollments = allEnrollments?.length || 0;
  const activeEnrollments = allEnrollments?.filter(e => e.status === "active").length || 0;
  const completedEnrollments = allEnrollments?.filter(e => e.status === "completed").length || 0;

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="sequences-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="sequences-page">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" data-testid="text-page-heading">Drip Sequences</h2>
          <p className="text-sm text-muted-foreground">Build multi-step follow-up sequences and drip marketing campaigns</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2" data-testid="button-create-sequence">
          <Plus className="w-4 h-4" /> Create Sequence
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="kpi-total-sequences">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10"><Zap className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{sequences?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Total Sequences</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-active-enrollments">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-500/10"><Users className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-2xl font-bold">{activeEnrollments}</p>
                <p className="text-xs text-muted-foreground">Active Enrollments</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-completed">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-500/10"><Target className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="text-2xl font-bold">{completedEnrollments}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-conversion">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-orange-500/10"><BarChart3 className="w-5 h-5 text-orange-600" /></div>
              <div>
                <p className="text-2xl font-bold">
                  {totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0}%
                </p>
                <p className="text-xs text-muted-foreground">Completion Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(!sequences || sequences.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">No drip sequences yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create automated multi-step campaigns to nurture leads and follow up with contacts</p>
            <Button onClick={() => setShowCreate(true)} data-testid="button-empty-create">
              <Plus className="w-4 h-4 mr-2" /> Create Your First Sequence
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sequences.map((seq: any) => {
            const seqEnrollments = allEnrollments?.filter(e => e.sequenceId === seq.id) || [];
            const isExpanded = expandedId === seq.id;
            return (
              <Card key={seq.id} data-testid={`card-sequence-${seq.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate" data-testid={`text-seq-name-${seq.id}`}>{seq.name}</h3>
                        <Badge variant={seq.status === "active" ? "default" : "secondary"} data-testid={`badge-seq-status-${seq.id}`}>
                          {seq.status}
                        </Badge>
                        <Badge variant="outline" data-testid={`badge-seq-trigger-${seq.id}`}>
                          {TRIGGER_TYPES.find(t => t.value === seq.triggerType)?.label || seq.triggerType}
                        </Badge>
                      </div>
                      {seq.description && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{seq.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>{seq.totalSteps || 0} steps</span>
                        <span>{seqEnrollments.length} enrolled</span>
                        <span>{seqEnrollments.filter((e: any) => e.status === "active").length} active</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEnrollDialogSeqId(seq.id)}
                        data-testid={`button-enroll-${seq.id}`}
                      >
                        <Users className="w-3.5 h-3.5 mr-1" /> Enroll
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleMutation.mutate({
                          id: seq.id,
                          status: seq.status === "active" ? "paused" : "active"
                        })}
                        data-testid={`button-toggle-${seq.id}`}
                      >
                        {seq.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExpandedId(isExpanded ? null : seq.id)}
                        data-testid={`button-expand-${seq.id}`}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(seq.id)}
                        data-testid={`button-delete-${seq.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <SequenceStepsView sequenceId={seq.id} enrollments={seqEnrollments} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-sequence">
          <DialogHeader>
            <DialogTitle>Create Drip Sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sequence Name</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., New Lead Follow-up"
                  data-testid="input-seq-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select value={form.triggerType} onValueChange={v => setForm({ ...form, triggerType: v })}>
                  <SelectTrigger data-testid="select-seq-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the purpose of this drip sequence..."
                data-testid="input-seq-description"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Campaign Steps</Label>
                <Button variant="outline" size="sm" onClick={addStep} data-testid="button-add-step">
                  <Plus className="w-4 h-4 mr-1" /> Add Step
                </Button>
              </div>

              {steps.length === 0 && (
                <div className="border border-dashed rounded-md p-6 text-center text-muted-foreground">
                  <p className="text-sm">No steps yet. Add your first step to build the drip campaign.</p>
                </div>
              )}

              <div className="space-y-2">
                {steps.map((step, index) => (
                  <div key={index}>
                    {index > 0 && (
                      <div className="flex items-center justify-center py-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ArrowDown className="w-3 h-3" />
                          <span>Wait {step.delayDays}d {step.delayHours}h</span>
                        </div>
                      </div>
                    )}
                    <Card className="border-l-2 border-l-primary" data-testid={`step-card-${index}`}>
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Step {index + 1}</Badge>
                            <Select
                              value={step.actionType}
                              onValueChange={v => updateStep(index, { actionType: v })}
                            >
                              <SelectTrigger className="w-40" data-testid={`select-step-type-${index}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STEP_TYPES.map(st => (
                                  <SelectItem key={st.value} value={st.value}>
                                    {st.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeStep(index)}
                            data-testid={`button-remove-step-${index}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>

                        {index > 0 && (
                          <div className="flex items-center gap-3 mb-3">
                            <div className="space-y-1 flex-1">
                              <Label className="text-xs">Delay (days)</Label>
                              <Input
                                type="number"
                                min={0}
                                value={step.delayDays}
                                onChange={e => updateStep(index, { delayDays: Number(e.target.value) })}
                                data-testid={`input-delay-days-${index}`}
                              />
                            </div>
                            <div className="space-y-1 flex-1">
                              <Label className="text-xs">Delay (hours)</Label>
                              <Input
                                type="number"
                                min={0}
                                value={step.delayHours}
                                onChange={e => updateStep(index, { delayHours: Number(e.target.value) })}
                                data-testid={`input-delay-hours-${index}`}
                              />
                            </div>
                          </div>
                        )}

                        {(step.actionType === "email" || step.actionType === "call_reminder") && (
                          <div className="space-y-2">
                            <Input
                              placeholder="Subject line"
                              value={step.subject || ""}
                              onChange={e => updateStep(index, { subject: e.target.value })}
                              data-testid={`input-step-subject-${index}`}
                            />
                            {step.actionType === "email" && (
                              <Textarea
                                placeholder="Email body... Use {{firstName}}, {{companyName}} for personalization"
                                value={step.body || ""}
                                onChange={e => updateStep(index, { body: e.target.value })}
                                className="min-h-[80px]"
                                data-testid={`input-step-body-${index}`}
                              />
                            )}
                          </div>
                        )}

                        {step.actionType === "sms" && (
                          <Textarea
                            placeholder="SMS message... Use {{firstName}} for personalization"
                            value={step.body || ""}
                            onChange={e => updateStep(index, { body: e.target.value })}
                            className="min-h-[60px]"
                            data-testid={`input-step-sms-${index}`}
                          />
                        )}

                        {step.actionType === "task" && (
                          <Input
                            placeholder="Task title"
                            value={step.subject || ""}
                            onChange={e => updateStep(index, { subject: e.target.value })}
                            data-testid={`input-step-task-${index}`}
                          />
                        )}

                        {step.actionType === "wait" && (
                          <p className="text-sm text-muted-foreground">
                            This step pauses the sequence for the configured delay before proceeding.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.name || steps.length === 0 || createMutation.isPending}
                data-testid="button-save-sequence"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Creating...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Create Sequence</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={enrollDialogSeqId !== null} onOpenChange={(open) => { if (!open) setEnrollDialogSeqId(null); }}>
        <DialogContent data-testid="dialog-enroll">
          <DialogHeader>
            <DialogTitle>Enroll Contact in Sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Contact</Label>
              <Select value={enrollContactId} onValueChange={setEnrollContactId}>
                <SelectTrigger data-testid="select-enroll-contact">
                  <SelectValue placeholder="Choose a contact..." />
                </SelectTrigger>
                <SelectContent>
                  {(contacts || []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.firstName} {c.lastName} - {c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Deal ID (optional)</Label>
              <Input
                value={enrollDealId}
                onChange={e => setEnrollDealId(e.target.value)}
                placeholder="Optional deal ID"
                data-testid="input-enroll-deal"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEnrollDialogSeqId(null)} data-testid="button-cancel-enroll">
                Cancel
              </Button>
              <Button
                onClick={() => enrollMutation.mutate()}
                disabled={!enrollContactId || enrollMutation.isPending}
                data-testid="button-confirm-enroll"
              >
                {enrollMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Users className="w-4 h-4 mr-2" />}
                Enroll
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SequenceStepsView({ sequenceId, enrollments }: { sequenceId: number; enrollments: any[] }) {
  const { data: steps, isLoading } = useQuery<any[]>({
    queryKey: ["/api/sequences", sequenceId, "steps"],
    queryFn: async () => {
      const res = await fetch(`/api/sequences/${sequenceId}/steps`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: contactsRes2 } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes2?.data;

  const contactMap = new Map((contacts || []).map((c: any) => [c.id, c]));

  if (isLoading) return <Skeleton className="h-20 mt-4" />;

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold mb-2">Steps Timeline</h4>
        {(!steps || steps.length === 0) ? (
          <p className="text-sm text-muted-foreground">No steps configured</p>
        ) : (
          <div className="space-y-1">
            {steps.map((step: any, i: number) => {
              const StepIcon = stepIcon(step.actionType);
              return (
                <div key={step.id} className="flex items-center gap-3 py-1.5" data-testid={`view-step-${step.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0">{i + 1}</Badge>
                    <StepIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium">{stepLabel(step.actionType)}</span>
                    {step.subject && <span className="text-xs text-muted-foreground truncate">- {step.subject}</span>}
                  </div>
                  {(step.delayDays > 0 || step.delayHours > 0) && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {step.delayDays > 0 && `${step.delayDays}d`} {step.delayHours > 0 && `${step.delayHours}h`} delay
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {enrollments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Enrollments ({enrollments.length})</h4>
          <div className="space-y-1">
            {enrollments.slice(0, 10).map((e: any) => {
              const contact = contactMap.get(e.contactId);
              return (
                <div key={e.id} className="flex items-center justify-between py-1 text-sm" data-testid={`enrollment-${e.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">
                      {contact ? `${contact.firstName} ${contact.lastName}` : `Contact #${e.contactId}`}
                    </span>
                    <Badge variant={e.status === "active" ? "default" : e.status === "completed" ? "secondary" : "outline"} className="text-xs">
                      {e.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    Step {e.currentStep || 0}/{steps?.length || "?"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
