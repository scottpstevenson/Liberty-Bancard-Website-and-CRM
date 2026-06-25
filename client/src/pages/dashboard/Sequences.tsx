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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Trash2, Loader2, Play, Pause, Mail, MessageSquare, Phone,
  CheckSquare, Clock, ChevronDown, ChevronUp, Users, Zap, Send, ArrowDown,
  Target, BarChart3, FlaskConical, Pencil, AlertTriangle, Tag, ShieldCheck,
  Radio,
} from "lucide-react";

interface ABTestConfig {
  splitRatio: number;
  minSampleSize: number;
  winnerCriteria: "open_rate" | "reply_rate";
}

interface SequenceStep {
  id?: number;
  stepOrder: number;
  actionType: string;
  delayDays: number;
  delayHours: number;
  subject?: string;
  body?: string;
  config?: any;
  variantBEnabled?: boolean;
  variantBSubject?: string;
  variantBBody?: string;
  abTestConfig?: ABTestConfig;
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

function supportsABTest(actionType: string) {
  return actionType === "email" || actionType === "sms";
}

export default function Sequences() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingSeq, setEditingSeq] = useState<any | null>(null);
  const [editLoadingSteps, setEditLoadingSteps] = useState(false);
  const [originalStepIds, setOriginalStepIds] = useState<number[]>([]);
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

  const isEditMode = editingSeq !== null;

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
        const s = steps[i];
        await apiRequest("POST", `/api/sequences/${seq.id}/steps`, {
          stepOrder: i + 1,
          actionType: s.actionType,
          delayDays: s.delayDays,
          delayHours: s.delayHours,
          subject: s.subject || null,
          body: s.body || null,
          config: s.config || null,
          variantBSubject: s.variantBEnabled ? (s.variantBSubject || null) : null,
          variantBBody: s.variantBEnabled ? (s.variantBBody || null) : null,
          abTestConfig: s.variantBEnabled
            ? (s.abTestConfig || { splitRatio: 50, minSampleSize: 100, winnerCriteria: "open_rate" })
            : null,
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

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingSeq) return;
      await apiRequest("PUT", `/api/sequences/${editingSeq.id}`, {
        name: form.name,
        description: form.description,
        triggerType: form.triggerType,
        totalSteps: steps.length,
      });
      for (const stepId of originalStepIds) {
        await apiRequest("DELETE", `/api/sequence-steps/${stepId}`);
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await apiRequest("POST", `/api/sequences/${editingSeq.id}/steps`, {
          stepOrder: i + 1,
          actionType: s.actionType,
          delayDays: s.delayDays,
          delayHours: s.delayHours,
          subject: s.subject || null,
          body: s.body || null,
          config: s.config || null,
          variantBSubject: s.variantBEnabled ? (s.variantBSubject || null) : null,
          variantBBody: s.variantBEnabled ? (s.variantBBody || null) : null,
          abTestConfig: s.variantBEnabled
            ? (s.abTestConfig || { splitRatio: 50, minSampleSize: 100, winnerCriteria: "open_rate" })
            : null,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences", editingSeq?.id, "steps"] });
      setEditingSeq(null);
      setOriginalStepIds([]);
      setForm({ name: "", description: "", triggerType: "manual", status: "active" });
      setSteps([]);
      toast({ title: "Sequence updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update sequence", description: err.message, variant: "destructive" });
    },
  });

  const openEditDialog = async (seq: any) => {
    setEditLoadingSteps(true);
    setEditingSeq(seq);
    setForm({
      name: seq.name,
      description: seq.description || "",
      triggerType: seq.triggerType || "manual",
      status: seq.status,
    });
    try {
      const res = await fetch(`/api/sequences/${seq.id}/steps`, { credentials: "include" });
      const existingSteps: any[] = res.ok ? await res.json() : [];
      setOriginalStepIds(existingSteps.map((s: any) => s.id));
      setSteps(existingSteps.map((s: any) => ({
        id: s.id,
        stepOrder: s.stepOrder,
        actionType: s.actionType,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
        subject: s.subject || "",
        body: s.body || "",
        variantBEnabled: !!(s.variantBBody || s.variantBSubject),
        variantBSubject: s.variantBSubject || "",
        variantBBody: s.variantBBody || "",
        abTestConfig: s.abTestConfig || { splitRatio: 50, minSampleSize: 100, winnerCriteria: "open_rate" },
      })));
    } finally {
      setEditLoadingSteps(false);
    }
  };

  const closeDialog = () => {
    setShowCreate(false);
    setEditingSeq(null);
    setOriginalStepIds([]);
    setForm({ name: "", description: "", triggerType: "manual", status: "active" });
    setSteps([]);
  };

  const addStep = () => {
    setSteps([...steps, {
      stepOrder: steps.length + 1,
      actionType: "email",
      delayDays: steps.length === 0 ? 0 : 2,
      delayHours: 0,
      subject: "",
      body: "",
      variantBEnabled: false,
      variantBSubject: "",
      variantBBody: "",
      abTestConfig: { splitRatio: 50, minSampleSize: 100, winnerCriteria: "open_rate" },
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
            const hasSmsSteps = seq.channelsAllowed?.includes("sms");
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
                        {seq.status === "paused" && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" data-testid={`badge-paused-${seq.id}`}>
                            <Pause className="w-3 h-3 mr-1" /> Paused
                          </Badge>
                        )}
                        <Badge variant="outline" data-testid={`badge-seq-trigger-${seq.id}`}>
                          {TRIGGER_TYPES.find(t => t.value === seq.triggerType)?.label || seq.triggerType}
                        </Badge>
                        {seq.sequenceFamily && (
                          <Badge variant="outline" className="font-mono text-xs text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-900/20" data-testid={`badge-family-${seq.id}`}>
                            <Tag className="w-3 h-3 mr-1" />{seq.sequenceFamily}
                          </Badge>
                        )}
                      </div>
                      {seq.description && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{seq.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>{seq.totalSteps || 0} steps</span>
                        <span>{seqEnrollments.length} enrolled</span>
                        <span>{seqEnrollments.filter((e: any) => e.status === "active").length} active</span>
                      </div>
                      {(seq.eligibleConsentTiers?.length > 0 || seq.channelsAllowed?.length > 0 || seq.offerRoutes?.length > 0) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {seq.channelsAllowed?.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`channels-${seq.id}`}>
                              <Radio className="w-3 h-3" />
                              {seq.channelsAllowed.map((ch: string) => (
                                <span key={ch} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-muted text-muted-foreground">
                                  {ch === "email" && <Mail className="w-3 h-3" />}
                                  {ch === "sms" && <MessageSquare className="w-3 h-3" />}
                                  {ch === "task" && <CheckSquare className="w-3 h-3" />}
                                  {ch === "voice_ai" && <Phone className="w-3 h-3" />}
                                  {!["email","sms","task","voice_ai"].includes(ch) && ch}
                                </span>
                              ))}
                            </div>
                          )}
                          {seq.eligibleConsentTiers?.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap" data-testid={`consent-tiers-${seq.id}`}>
                              <ShieldCheck className="w-3 h-3 text-muted-foreground" />
                              {seq.eligibleConsentTiers.map((tier: string) => (
                                <Badge key={tier} variant="outline" className="text-xs px-1 py-0">
                                  {tier === "cold_no_consent" ? "cold" : tier === "warm_no_pewc" ? "warm" : tier === "pewc_full_automation" ? "PEWC" : tier}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {seq.offerRoutes?.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap" data-testid={`offer-routes-${seq.id}`}>
                              {seq.offerRoutes.map((route: string) => (
                                <Badge key={route} variant="secondary" className="text-xs px-1 py-0">
                                  {route}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {seq.sequenceFamily && (!seq.totalSteps || seq.totalSteps === 0) && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-red-600" data-testid={`warn-no-steps-${seq.id}`}>
                          <AlertTriangle className="w-3 h-3" />
                          No steps defined — sequence cannot execute until steps are added
                        </div>
                      )}
                      {hasSmsSteps && seq.status !== "active" && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600" data-testid={`warn-sms-paused-${seq.id}`}>
                          <AlertTriangle className="w-3 h-3" />
                          SMS steps present — activate sequence and ensure PEWC flag is enabled before enrolling contacts
                        </div>
                      )}
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
                        aria-label="Edit sequence"
                        onClick={() => openEditDialog(seq)}
                        data-testid={`button-edit-${seq.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={seq.status === "active" ? "Pause sequence" : "Resume sequence"}
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
                        aria-label={isExpanded ? "Collapse sequence" : "Expand sequence"}
                        onClick={() => setExpandedId(isExpanded ? null : seq.id)}
                        data-testid={`button-expand-${seq.id}`}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete sequence"
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

      <Dialog open={showCreate || isEditMode} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-sequence">
          <DialogHeader>
            <DialogTitle>{isEditMode ? `Edit: ${editingSeq?.name}` : "Create Drip Sequence"}</DialogTitle>
          </DialogHeader>
          {isEditMode && editLoadingSteps && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading steps…</span>
            </div>
          )}
          {(!isEditMode || !editLoadingSteps) && <div className="space-y-6">
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
                              onValueChange={v => updateStep(index, { actionType: v, variantBEnabled: false })}
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
                            aria-label="Remove step"
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
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Variant A (Primary)</Label>
                              <Input
                                placeholder="Subject line"
                                value={step.subject || ""}
                                onChange={e => updateStep(index, { subject: e.target.value })}
                                data-testid={`input-step-subject-${index}`}
                              />
                            </div>
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
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground block">Variant A (Primary)</Label>
                            <Textarea
                              placeholder="SMS message... Use {{firstName}} for personalization"
                              value={step.body || ""}
                              onChange={e => updateStep(index, { body: e.target.value })}
                              className="min-h-[60px]"
                              data-testid={`input-step-sms-${index}`}
                            />
                          </div>
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

                        {supportsABTest(step.actionType) && (
                          <div className="mt-3 border-t pt-3">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <FlaskConical className="w-4 h-4 text-purple-500" />
                                <span className="text-sm font-medium">A/B Test</span>
                                <Badge variant="outline" className="text-xs">Beta</Badge>
                              </div>
                              <Switch
                                checked={!!step.variantBEnabled}
                                onCheckedChange={v => updateStep(index, { variantBEnabled: v })}
                                data-testid={`switch-ab-test-${index}`}
                              />
                            </div>

                            {step.variantBEnabled && (
                              <div className="space-y-3 mt-2 pl-1">
                                <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-2">
                                  <Label className="text-xs font-semibold text-purple-700 dark:text-purple-300 block">Variant B</Label>
                                  {step.actionType === "email" && (
                                    <>
                                      <Input
                                        placeholder="Variant B subject line"
                                        value={step.variantBSubject || ""}
                                        onChange={e => updateStep(index, { variantBSubject: e.target.value })}
                                        data-testid={`input-variant-b-subject-${index}`}
                                      />
                                      <Textarea
                                        placeholder="Variant B email body..."
                                        value={step.variantBBody || ""}
                                        onChange={e => updateStep(index, { variantBBody: e.target.value })}
                                        className="min-h-[80px]"
                                        data-testid={`input-variant-b-body-${index}`}
                                      />
                                    </>
                                  )}
                                  {step.actionType === "sms" && (
                                    <Textarea
                                      placeholder="Variant B SMS message..."
                                      value={step.variantBBody || ""}
                                      onChange={e => updateStep(index, { variantBBody: e.target.value })}
                                      className="min-h-[60px]"
                                      data-testid={`input-variant-b-sms-${index}`}
                                    />
                                  )}
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Traffic Split (A%)</Label>
                                    <Input
                                      type="number"
                                      min={10}
                                      max={90}
                                      value={step.abTestConfig?.splitRatio ?? 50}
                                      onChange={e => updateStep(index, {
                                        abTestConfig: { ...step.abTestConfig!, splitRatio: Number(e.target.value) }
                                      })}
                                      data-testid={`input-ab-split-${index}`}
                                    />
                                    <p className="text-xs text-muted-foreground">B gets {100 - (step.abTestConfig?.splitRatio ?? 50)}%</p>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Min Sample</Label>
                                    <Input
                                      type="number"
                                      min={10}
                                      value={step.abTestConfig?.minSampleSize ?? 100}
                                      onChange={e => updateStep(index, {
                                        abTestConfig: { ...step.abTestConfig!, minSampleSize: Number(e.target.value) }
                                      })}
                                      data-testid={`input-ab-sample-${index}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Winner By</Label>
                                    <Select
                                      value={step.abTestConfig?.winnerCriteria ?? "open_rate"}
                                      onValueChange={v => updateStep(index, {
                                        abTestConfig: { ...step.abTestConfig!, winnerCriteria: v as "open_rate" | "reply_rate" }
                                      })}
                                    >
                                      <SelectTrigger data-testid={`select-ab-criteria-${index}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="open_rate">Open Rate</SelectItem>
                                        <SelectItem value="reply_rate">Reply Rate</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-create">
                Cancel
              </Button>
              {isEditMode ? (
                <Button
                  onClick={() => editMutation.mutate()}
                  disabled={!form.name || steps.length === 0 || editMutation.isPending || editLoadingSteps}
                  data-testid="button-save-sequence"
                >
                  {editMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</>
                  ) : (
                    <><Pencil className="w-4 h-4 mr-2" /> Save Changes</>
                  )}
                </Button>
              ) : (
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
              )}
            </div>
          </div>}
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
              const hasABTest = !!(step.abTestConfig && (step.variantBSubject || step.variantBBody));
              const abResults = step.abTestResults as any;
              return (
                <div key={step.id} className="space-y-1" data-testid={`view-step-${step.id}`}>
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-xs shrink-0">{i + 1}</Badge>
                      <StepIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">{stepLabel(step.actionType)}</span>
                      {step.subject && <span className="text-xs text-muted-foreground truncate">- {step.subject}</span>}
                      {hasABTest && (
                        <Badge variant="outline" className="text-xs shrink-0 border-purple-400 text-purple-600 dark:text-purple-400">
                          <FlaskConical className="w-3 h-3 mr-1" /> A/B
                        </Badge>
                      )}
                      {step.actionType === "call_reminder" && (
                        <Badge variant="outline" className="text-xs shrink-0 border-amber-400 text-amber-600 dark:text-amber-400" title="Voice execution requires ORCHESTRATOR_ENABLED=true">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Needs Orchestrator
                        </Badge>
                      )}
                    </div>
                    {(step.delayDays > 0 || step.delayHours > 0) && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {step.delayDays > 0 && `${step.delayDays}d`} {step.delayHours > 0 && `${step.delayHours}h`} delay
                      </Badge>
                    )}
                    {hasABTest && abResults?.winnerSelected && (
                      <Badge variant="default" className="text-xs shrink-0 bg-green-600">
                        Winner: {abResults.winnerSelected}
                      </Badge>
                    )}
                  </div>
                  {hasABTest && abResults && (
                    <div className="ml-8 grid grid-cols-2 gap-2 text-xs text-muted-foreground pb-1">
                      <div className="rounded border p-2">
                        <p className="font-semibold mb-0.5">Variant A</p>
                        <p>Sent: {abResults.variantASent ?? 0}</p>
                        <p>Opens: {abResults.aOpens ?? 0}</p>
                        <p>Replies: {abResults.aReplies ?? 0}</p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="font-semibold mb-0.5">Variant B</p>
                        <p>Sent: {abResults.variantBSent ?? 0}</p>
                        <p>Opens: {abResults.bOpens ?? 0}</p>
                        <p>Replies: {abResults.bReplies ?? 0}</p>
                      </div>
                    </div>
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
