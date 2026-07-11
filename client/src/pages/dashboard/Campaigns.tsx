import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Send, Plus, Play, Pause, Trash2, Mail, Clock, Pencil, Eye, Users, List } from "lucide-react";
import DashboardErrorState from "@/components/DashboardErrorState";
import EmailPreviewModal, { EmailPreviewContent } from "@/components/EmailPreviewModal";
import type { Campaign, CampaignStep, ProspectList } from "@shared/schema";

const CANONICAL_VERTICALS = [
  "Restaurant", "Retail", "Healthcare", "Salon", "Auto Repair",
  "Dental", "Med Spa", "Hotel", "Gym", "Landscaping", "Construction", "Legal",
];

const campaignFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  targetListId: z.coerce.number().optional(),
  targetVerticals: z.array(z.string()).optional(),
  targetScores: z.array(z.string()).optional(),
  aiPersonalization: z.boolean().optional(),
  dailySendLimit: z.coerce.number().min(1).optional(),
});

type CampaignFormData = z.infer<typeof campaignFormSchema>;

const stepFormSchema = z.object({
  stepOrder: z.coerce.number().min(1, "Step order is required"),
  stepType: z.string().min(1, "Step type is required"),
  delayDays: z.coerce.number().min(0).optional(),
  subject: z.string().optional(),
  bodyTemplate: z.string().optional(),
  channel: z.string().optional(),
});

type StepFormData = z.infer<typeof stepFormSchema>;

function isMeaningfulBody(html: string): boolean {
  if (!html) return false;
  const normalised = html
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalised) return false;
  const EMPTY_SHELLS = /^(\s*<p(\s[^>]*)?>(\s|<br\s*\/?>)*<\/p>\s*)*$/i;
  return !EMPTY_SHELLS.test(normalised);
}

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "paused":
      return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "draft":
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

type AudiencePreviewResult = {
  eligibleCount: number;
  sampleContacts: Array<{ id: number; name: string; email: string; vertical: string | null }>;
  totalInVerticals: number;
  blockedCount: number;
  blockReasons: Record<string, number>;
};

type PreviewPollResponse = {
  status: "idle" | "running" | "done" | "error" | "interrupted";
  previewId?: number;
  result?: AudiencePreviewResult;
  error?: string;
};

function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const { toast } = useToast();
  const [showStepForm, setShowStepForm] = useState(false);
  const [editingStep, setEditingStep] = useState<CampaignStep | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBodyTemplate, setEditBodyTemplate] = useState("");
  const [editDelayDays, setEditDelayDays] = useState(0);
  const [editBodyTab, setEditBodyTab] = useState<"write" | "preview">("write");
  const [previewStep, setPreviewStep] = useState<CampaignStep | null>(null);
  const [showQueueConfirm, setShowQueueConfirm] = useState(false);

  useEffect(() => {
    if (!editingStep) return;
    setEditBodyTab(isMeaningfulBody(editingStep.bodyTemplate ?? "") ? "preview" : "write");
  }, [editingStep?.id]);

  const { data: steps, isLoading: stepsLoading } = useQuery<CampaignStep[]>({
    queryKey: ["/api/campaigns", campaign.id, "steps"],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${campaign.id}/steps`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const stepForm = useForm<StepFormData>({
    resolver: zodResolver(stepFormSchema),
    defaultValues: {
      stepOrder: (steps?.length || 0) + 1,
      stepType: "initial_outreach",
      delayDays: 0,
      subject: "",
      bodyTemplate: "",
      channel: "email",
    },
  });

  const addStepMutation = useMutation({
    mutationFn: async (data: StepFormData) => {
      await apiRequest("POST", `/api/campaigns/${campaign.id}/steps`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaign.id, "steps"] });
      toast({ title: "Step added", description: "Campaign step has been created." });
      setShowStepForm(false);
      stepForm.reset({ stepOrder: (steps?.length || 0) + 2, stepType: "initial_outreach", delayDays: 0, subject: "", bodyTemplate: "", channel: "email" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add step", description: err.message, variant: "destructive" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (stepId: number) => {
      await apiRequest("DELETE", `/api/campaign-steps/${stepId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaign.id, "steps"] });
      toast({ title: "Step deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete step", description: err.message, variant: "destructive" });
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, subject, bodyTemplate, delayDays }: { stepId: number; subject: string; bodyTemplate: string; delayDays: number }) => {
      await apiRequest("PUT", `/api/campaign-steps/${stepId}`, { subject, bodyTemplate, delayDays });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaign.id, "steps"] });
      toast({ title: "Step updated", description: "Campaign step has been saved." });
      setEditingStep(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update step", description: err.message, variant: "destructive" });
    },
  });

  const isCrmMode = !campaign.targetListId && (campaign.targetVerticals?.length ?? 0) > 0;

  // Async audience preview — POST to start, GET to poll.
  // Polling runs every 2s while status === "running"; stops when done or error.
  const { data: previewPoll } = useQuery<PreviewPollResponse>({
    queryKey: ["/api/campaigns", campaign.id, "audience-preview"],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${campaign.id}/audience-preview`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: isCrmMode,
    refetchInterval: (query) => {
      const status = (query.state.data as PreviewPollResponse | undefined)?.status;
      return status === "running" ? 2000 : false;
    },
    staleTime: Infinity,
  });

  const startPreviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/audience-preview`);
      return res.json() as Promise<PreviewPollResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaign.id, "audience-preview"] });
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed to start", description: err.message, variant: "destructive" });
    },
  });

  // Convenience aliases for readability in JSX below.
  const previewStatus = previewPoll?.status ?? "idle";
  const audiencePreview = previewStatus === "done" ? previewPoll?.result : undefined;
  const previewRunning = previewStatus === "running" || startPreviewMutation.isPending;

  // previewId is captured when startPreviewMutation succeeds or when the polling
  // query returns a completed preview. It is required by the queue endpoint.
  const latestPreviewId = previewPoll?.previewId;

  const queueMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (isCrmMode && latestPreviewId) body.previewId = latestPreviewId;
      const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/queue`, body);
      return res.json() as Promise<{ queued: number; mode: string }>;
    },
    onSuccess: (data: { queued: number; mode: string; previewEligibleCount?: number; countDifference?: number } | void) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      const d = data as any;
      const queued = d?.queued ?? 0;
      const mode = d?.mode === "contacts" ? " from CRM contacts" : "";
      const diff = d?.countDifference;
      const diffNote = diff !== undefined && diff !== 0
        ? ` (preview showed ${d.previewEligibleCount} eligible — ${Math.abs(diff)} ${diff < 0 ? "fewer" : "more"} than preview due to live contactability check)`
        : "";
      toast({ title: "Messages queued", description: `${queued} messages queued${mode}.${diffNote}` });
    },
    onError: (err: Error) => {
      toast({ title: "Queue failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      const newStatus = campaign.status === "active" ? "paused" : "active";
      await apiRequest("PUT", `/api/campaigns/${campaign.id}`, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 pt-4 border-t">
      {isCrmMode && (
        <div className="rounded-md border bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300">CRM Contact Mode</p>
              <p className="text-xs text-muted-foreground">
                Targeting: {campaign.targetVerticals?.join(", ") || "All verticals"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => startPreviewMutation.mutate()}
              disabled={previewRunning}
              data-testid={`button-audience-preview-${campaign.id}`}
            >
              <Eye className="w-3 h-3 mr-1" />
              {previewRunning ? "Computing…" : previewStatus === "done" ? "Re-run Preview" : "Preview Audience"}
            </Button>
          </div>
          {previewRunning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="alert-preview-running">
              <Skeleton className="h-3 w-3 rounded-full" />
              <span>Computing exact eligible count across all contacts in vertical(s)… this may take a moment.</span>
            </div>
          )}
          {previewStatus === "error" && (
            <p className="text-xs text-destructive" data-testid="text-preview-error">
              Preview failed: {previewPoll?.error ?? "unknown error"}. Please try again.
            </p>
          )}
          {audiencePreview && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-green-700 dark:text-green-400" data-testid="text-eligible-count">
                  {audiencePreview.eligibleCount.toLocaleString()} eligible
                </span>
                <span className="text-muted-foreground">
                  of {audiencePreview.totalInVerticals.toLocaleString()} in vertical{(campaign.targetVerticals?.length ?? 0) !== 1 ? "s" : ""}
                </span>
                {audiencePreview.blockedCount > 0 && (
                  <span className="text-orange-600 dark:text-orange-400 text-xs">
                    {audiencePreview.blockedCount} blocked
                  </span>
                )}
              </div>
              {Object.keys(audiencePreview.blockReasons).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Block reasons:</p>
                  {Object.entries(audiencePreview.blockReasons).map(([reason, count]) => (
                    <div key={reason} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground truncate flex-1">{reason.replace(/_/g, " ")}</span>
                      <span className="font-medium tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              )}
              {audiencePreview.sampleContacts.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Sample contacts:</p>
                  {audiencePreview.sampleContacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs gap-2 p-1 rounded bg-background/80">
                      <span className="font-medium truncate">{c.name}</span>
                      <span className="text-muted-foreground truncate">{c.vertical ?? "—"}</span>
                      <span className="text-muted-foreground shrink-0 text-[10px]">{c.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => toggleStatusMutation.mutate()}
          disabled={toggleStatusMutation.isPending}
          data-testid={`button-toggle-status-${campaign.id}`}
        >
          {campaign.status === "active" ? (
            <><Pause className="w-4 h-4 mr-1" /> Pause</>
          ) : (
            <><Play className="w-4 h-4 mr-1" /> Activate</>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (isCrmMode) {
              setShowQueueConfirm(true);
            } else {
              queueMutation.mutate();
            }
          }}
          disabled={queueMutation.isPending || (isCrmMode && previewStatus !== "done")}
          title={
            isCrmMode && previewStatus === "idle" ? "Run Preview Audience first to confirm exact eligible count" :
            isCrmMode && previewStatus === "running" ? "Preview is computing — please wait" :
            isCrmMode && previewStatus === "error" ? "Preview failed — please re-run before queuing" :
            undefined
          }
          data-testid={`button-queue-messages-${campaign.id}`}
        >
          <Send className="w-4 h-4 mr-1" />
          {queueMutation.isPending ? "Queuing..." : isCrmMode && audiencePreview ? `Queue ${audiencePreview.eligibleCount.toLocaleString()} Contacts` : "Queue Messages"}
        </Button>
        {isCrmMode && previewStatus === "idle" && (
          <p className="text-xs text-muted-foreground self-center" data-testid="text-preview-required-hint">
            Preview audience first to enable queueing
          </p>
        )}
        {isCrmMode && previewRunning && (
          <p className="text-xs text-muted-foreground self-center" data-testid="text-preview-computing-hint">
            Preview computing…
          </p>
        )}
      </div>

      <AlertDialog open={showQueueConfirm} onOpenChange={setShowQueueConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Queue Campaign Messages</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will queue email messages for CRM contacts in{" "}
                  <strong>{campaign.targetVerticals?.join(", ") || "all verticals"}</strong>.
                </p>
                {audiencePreview ? (
                  <div className="rounded-md border bg-muted/40 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Eligible contacts</span>
                      <span className="font-medium">{audiencePreview.eligibleCount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Total in verticals</span>
                      <span>{audiencePreview.totalInVerticals.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Daily send limit</span>
                      <span>{campaign.dailySendLimit ?? 200}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Run "Preview Audience" first to see eligible contact counts before queuing.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Every contact is checked through the contactability gate before a message row is created.
                  Blocked contacts are skipped and audit-logged.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-queue-cancel-${campaign.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => queueMutation.mutate()}
              disabled={previewStatus !== "done" || !audiencePreview || audiencePreview.eligibleCount === 0}
              data-testid={`button-queue-confirm-${campaign.id}`}
            >
              {previewStatus !== "done" || !audiencePreview
                ? "Preview Required"
                : audiencePreview.eligibleCount > 0
                  ? `Queue ${audiencePreview.eligibleCount.toLocaleString()} Messages`
                  : "No Eligible Contacts"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="font-medium text-sm">Steps</h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStepForm(!showStepForm)}
            data-testid={`button-add-step-${campaign.id}`}
          >
            <Plus className="w-4 h-4 mr-1" /> Add Step
          </Button>
        </div>

        {stepsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : steps && steps.length > 0 ? (
          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.id}>
              <div
                className="flex flex-wrap items-center gap-3 p-3 rounded-md border bg-muted/30"
                data-testid={`step-item-${step.id}`}
              >
                <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">
                  #{step.stepOrder}
                </Badge>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Mail className="w-3 h-3" />
                  <span>{step.channel || "email"}</span>
                </div>
                <span className="text-sm font-medium">{step.stepType?.replace(/_/g, " ")}</span>
                {step.delayDays ? (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{step.delayDays}d delay</span>
                  </div>
                ) : null}
                {step.subject ? (
                  <span className="text-sm text-muted-foreground truncate max-w-[200px]">{step.subject}</span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Preview step"
                    onClick={() => setPreviewStep(step)}
                    data-testid={`button-preview-step-${step.id}`}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit step"
                    onClick={() => {
                      if (editingStep?.id === step.id) {
                        setEditingStep(null);
                      } else {
                        setEditingStep(step);
                        setEditSubject(step.subject ?? "");
                        setEditBodyTemplate(step.bodyTemplate ?? "");
                        setEditDelayDays(step.delayDays ?? 0);
                      }
                    }}
                    data-testid={`button-edit-step-${step.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete step"
                    onClick={() => deleteStepMutation.mutate(step.id)}
                    disabled={deleteStepMutation.isPending}
                    data-testid={`button-delete-step-${step.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {editingStep?.id === step.id && (
                <div className="mt-2 p-3 rounded-md border bg-background space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide" htmlFor={`edit-subject-${step.id}`}>
                      Subject
                    </label>
                    <Input
                      id={`edit-subject-${step.id}`}
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      data-testid={`input-edit-subject-${step.id}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Body Template
                      </label>
                      <div className="flex rounded border overflow-hidden text-xs">
                        <button
                          type="button"
                          onClick={() => setEditBodyTab("write")}
                          className={`px-3 py-1 ${editBodyTab === "write" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                          data-testid={`button-body-tab-write-${step.id}`}
                        >
                          Write
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditBodyTab("preview")}
                          className={`px-3 py-1 ${editBodyTab === "preview" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                          data-testid={`button-body-tab-preview-${step.id}`}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                    {editBodyTab === "write" ? (
                      <Textarea
                        id={`edit-body-${step.id}`}
                        value={editBodyTemplate}
                        onChange={(e) => setEditBodyTemplate(e.target.value)}
                        rows={5}
                        data-testid={`textarea-edit-body-${step.id}`}
                      />
                    ) : (
                      <div className="rounded border bg-background p-2 min-h-[120px]" data-testid={`preview-body-content-${step.id}`}>
                        <EmailPreviewContent
                          subject={editSubject}
                          body={editBodyTemplate}
                          showComplianceNotice={false}
                        />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide" htmlFor={`edit-delay-${step.id}`}>
                      Delay (days)
                    </label>
                    <Input
                      id={`edit-delay-${step.id}`}
                      type="number"
                      min={0}
                      value={editDelayDays}
                      onChange={(e) => setEditDelayDays(Number(e.target.value))}
                      data-testid={`input-edit-delay-${step.id}`}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingStep(null)}
                      data-testid={`button-cancel-edit-step-${step.id}`}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={updateStepMutation.isPending}
                      onClick={() => updateStepMutation.mutate({ stepId: step.id, subject: editSubject, bodyTemplate: editBodyTemplate, delayDays: editDelayDays })}
                      data-testid={`button-save-edit-step-${step.id}`}
                    >
                      {updateStepMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid={`text-no-steps-${campaign.id}`}>
            No steps configured yet.
          </p>
        )}

        {showStepForm && (
          <Card className="mt-3">
            <CardContent className="p-4">
              <Form {...stepForm}>
                <form onSubmit={stepForm.handleSubmit((d) => addStepMutation.mutate(d))} className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <FormField
                      control={stepForm.control}
                      name="stepOrder"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Step Order</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              data-testid={`input-step-order-${campaign.id}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={stepForm.control}
                      name="stepType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Step Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid={`select-step-type-${campaign.id}`}>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="initial_outreach">Initial Outreach</SelectItem>
                              <SelectItem value="follow_up">Follow Up</SelectItem>
                              <SelectItem value="break_up">Break Up</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={stepForm.control}
                      name="delayDays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delay (days)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              data-testid={`input-delay-days-${campaign.id}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={stepForm.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid={`input-step-subject-${campaign.id}`} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={stepForm.control}
                    name="bodyTemplate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Body Template</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={4}
                            data-testid={`textarea-step-body-${campaign.id}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={stepForm.control}
                    name="channel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Channel</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value || "email"}>
                          <FormControl>
                            <SelectTrigger data-testid={`select-step-channel-${campaign.id}`}>
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="email">Email</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowStepForm(false)} data-testid={`button-cancel-step-${campaign.id}`}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={addStepMutation.isPending} data-testid={`button-save-step-${campaign.id}`}>
                      {addStepMutation.isPending ? "Saving..." : "Save Step"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </div>

      <EmailPreviewModal
        open={!!previewStep}
        onOpenChange={(o) => { if (!o) setPreviewStep(null); }}
        subject={previewStep?.subject ?? ""}
        body={previewStep?.bodyTemplate ?? ""}
      />
    </div>
  );
}

export default function Campaigns() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [audienceSource, setAudienceSource] = useState<"prospect" | "crm">("prospect");

  const { data: campaigns, isLoading, isError, refetch } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const { data: prospectLists } = useQuery<ProspectList[]>({
    queryKey: ["/api/prospect-lists"],
  });

  const form = useForm<CampaignFormData>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      name: "",
      description: "",
      targetVerticals: [],
      targetScores: [],
      aiPersonalization: true,
      dailySendLimit: 200,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CampaignFormData) => {
      await apiRequest("POST", "/api/campaigns", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign created", description: "Your new campaign has been created." });
      setIsCreateOpen(false);
      form.reset({ name: "", description: "", targetVerticals: [], targetScores: [], aiPersonalization: true, dailySendLimit: 200 });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create campaign", description: err.message, variant: "destructive" });
    },
  });

  const listMap = new Map<number, ProspectList>();
  prospectLists?.forEach((l) => listMap.set(l.id, l));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-campaigns-title">Campaigns</h2>
          <p className="text-sm text-muted-foreground">Manage outbound email campaigns for lead generation</p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-campaign">
              <Plus className="w-4 h-4" /> Create Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Campaign Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Q1 Restaurant Outreach" data-testid="input-campaign-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={2} placeholder="Campaign description..." data-testid="input-campaign-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Audience Source toggle */}
                <FormItem>
                  <FormLabel>Audience Source</FormLabel>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={audienceSource === "prospect" ? "default" : "outline"}
                      className="gap-1.5"
                      onClick={() => {
                        setAudienceSource("prospect");
                        form.setValue("targetVerticals", []);
                      }}
                      data-testid="button-source-prospect"
                    >
                      <List className="w-3.5 h-3.5" /> Prospect List
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={audienceSource === "crm" ? "default" : "outline"}
                      className="gap-1.5"
                      onClick={() => {
                        setAudienceSource("crm");
                        form.setValue("targetListId", undefined);
                      }}
                      data-testid="button-source-crm"
                    >
                      <Users className="w-3.5 h-3.5" /> CRM Contacts by Vertical
                    </Button>
                  </div>
                </FormItem>

                {audienceSource === "prospect" && (
                  <FormField
                    control={form.control}
                    name="targetListId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target List</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(val ? Number(val) : undefined)}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-target-list">
                              <SelectValue placeholder="Select a prospect list" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {prospectLists?.map((list) => (
                              <SelectItem key={list.id} value={String(list.id)} data-testid={`select-item-list-${list.id}`}>
                                {list.name} ({list.totalRecords} records)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {audienceSource === "crm" && (
                  <FormField
                    control={form.control}
                    name="targetVerticals"
                    render={() => (
                      <FormItem>
                        <FormLabel>Target Verticals</FormLabel>
                        <p className="text-xs text-muted-foreground">Select industries to target from your 154K CRM contacts.</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {CANONICAL_VERTICALS.map((v) => (
                            <FormField
                              key={v}
                              control={form.control}
                              name="targetVerticals"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-1.5">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(v)}
                                      onCheckedChange={(checked) => {
                                        const current = field.value || [];
                                        field.onChange(checked ? [...current, v] : current.filter((x) => x !== v));
                                      }}
                                      data-testid={`checkbox-vertical-${v.toLowerCase().replace(/\s+/g, "-")}`}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal text-sm cursor-pointer">{v}</FormLabel>
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="targetScores"
                  render={() => (
                    <FormItem>
                      <FormLabel>Target Scores</FormLabel>
                      <div className="flex flex-wrap gap-4">
                        {["hot", "warm", "cold"].map((score) => (
                          <FormField
                            key={score}
                            control={form.control}
                            name="targetScores"
                            render={({ field }) => (
                              <FormItem className="flex items-center gap-2">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(score)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value || [];
                                      if (checked) {
                                        field.onChange([...current, score]);
                                      } else {
                                        field.onChange(current.filter((v) => v !== score));
                                      }
                                    }}
                                    data-testid={`checkbox-score-${score}`}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal capitalize cursor-pointer">{score}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="aiPersonalization"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-2">
                      <FormLabel>AI Personalization</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-ai-personalization"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dailySendLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily Send Limit</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-daily-send-limit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-campaign">
                    {createMutation.isPending ? "Creating..." : "Create Campaign"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isError ? (
        <DashboardErrorState title="Failed to load campaigns" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-16" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns && campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((campaign) => {
            const targetList = campaign.targetListId ? listMap.get(campaign.targetListId) : null;
            const isExpanded = expandedId === campaign.id;

            return (
              <Card key={campaign.id} data-testid={`card-campaign-${campaign.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base truncate" data-testid={`text-campaign-name-${campaign.id}`}>
                      {campaign.name}
                    </CardTitle>
                    {campaign.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-campaign-desc-${campaign.id}`}>
                        {campaign.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    {campaign.name.startsWith("SDR-") && (
                      <Badge
                        variant="secondary"
                        className="no-default-hover-elevate no-default-active-elevate"
                        data-testid={`badge-template-${campaign.id}`}
                      >
                        Template
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={`no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClass(campaign.status)}`}
                      data-testid={`badge-campaign-status-${campaign.id}`}
                    >
                      {campaign.status || "draft"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {targetList && (
                    <div className="text-sm text-muted-foreground" data-testid={`text-target-list-${campaign.id}`}>
                      Target: {targetList.name} ({targetList.totalRecords} records)
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1">
                    {campaign.aiPersonalization && (
                      <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-xs">
                        AI Personalization
                      </Badge>
                    )}
                    {campaign.totalSteps && (
                      <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-xs">
                        {campaign.totalSteps} Steps
                      </Badge>
                    )}
                    {campaign.targetVerticals && campaign.targetVerticals.length > 0 && !campaign.targetListId && (
                      <Badge
                        variant="outline"
                        className="no-default-hover-elevate no-default-active-elevate text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                        data-testid={`badge-crm-mode-${campaign.id}`}
                      >
                        CRM · {campaign.targetVerticals.length} {campaign.targetVerticals.length === 1 ? "Vertical" : "Verticals"}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-md bg-muted/50">
                      <div className="text-xs text-muted-foreground">Sent</div>
                      <div className="text-lg font-semibold" data-testid={`text-total-sent-${campaign.id}`}>
                        {campaign.totalSent || 0}
                      </div>
                    </div>
                    <div className="p-2 rounded-md bg-muted/50">
                      <div className="text-xs text-muted-foreground">Opened</div>
                      <div className="text-lg font-semibold" data-testid={`text-total-opened-${campaign.id}`}>
                        {campaign.totalOpened || 0}
                      </div>
                    </div>
                    <div className="p-2 rounded-md bg-muted/50">
                      <div className="text-xs text-muted-foreground">Replied</div>
                      <div className="text-lg font-semibold" data-testid={`text-total-replied-${campaign.id}`}>
                        {campaign.totalReplied || 0}
                      </div>
                    </div>
                    <div className="p-2 rounded-md bg-muted/50">
                      <div className="text-xs text-muted-foreground">Bounced</div>
                      <div className="text-lg font-semibold" data-testid={`text-total-bounced-${campaign.id}`}>
                        {campaign.totalBounced || 0}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setExpandedId(isExpanded ? null : campaign.id)}
                    data-testid={`button-expand-campaign-${campaign.id}`}
                  >
                    {isExpanded ? "Collapse" : "Manage Steps"}
                  </Button>

                  {isExpanded && <CampaignDetail campaign={campaign} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Mail className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-no-campaigns">
              No campaigns yet. Create your first campaign to start outbound outreach.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
