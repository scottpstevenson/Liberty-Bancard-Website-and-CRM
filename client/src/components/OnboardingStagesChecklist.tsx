import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2, Circle, AlertCircle, Clock, ChevronDown, ChevronUp,
  ClipboardList, Loader2, Play, RefreshCw, User, Calendar, FileText,
} from "lucide-react";
import type { MerchantOnboardingStage } from "@shared/schema";
import {
  MERCHANT_ONBOARDING_STAGE_KEYS,
  MERCHANT_ONBOARDING_STAGE_LABELS,
  type MerchantOnboardingStageKey,
  type MerchantOnboardingStageStatus,
} from "@shared/schema";

const STATUS_CONFIG: Record<MerchantOnboardingStageStatus, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: "default" | "secondary" | "destructive" | "outline";
  color: string;
}> = {
  pending: { label: "Pending", icon: Circle, badge: "outline", color: "text-muted-foreground" },
  in_progress: { label: "In Progress", icon: Play, badge: "secondary", color: "text-blue-600 dark:text-blue-400" },
  complete: { label: "Complete", icon: CheckCircle2, badge: "default", color: "text-green-600 dark:text-green-400" },
  blocked: { label: "Blocked", icon: AlertCircle, badge: "destructive", color: "text-red-600 dark:text-red-400" },
};

function StageRow({
  dealId,
  stageKey,
  stage,
}: {
  dealId: number;
  stageKey: MerchantOnboardingStageKey;
  stage: MerchantOnboardingStage | undefined;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(stage?.owner || "");
  const [dueDate, setDueDate] = useState(stage?.dueDate ? new Date(stage.dueDate).toISOString().split("T")[0] : "");
  const [notes, setNotes] = useState(stage?.notes || "");
  const [equipmentOrderRef, setEquipmentOrderRef] = useState(stage?.equipmentOrderRef || "");

  const status = (stage?.status as MerchantOnboardingStageStatus) || "pending";
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const label = MERCHANT_ONBOARDING_STAGE_LABELS[stageKey];
  const isEquipment = stageKey === "equipment_terminal";

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/deals/${dealId}/onboarding-stages/${stageKey}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}/onboarding-stages`] });
      toast({ title: "Stage updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ status: newStatus });
  };

  const handleSaveDetails = () => {
    const updates: Record<string, any> = { owner, notes };
    if (dueDate) updates.dueDate = dueDate;
    if (isEquipment && equipmentOrderRef) updates.equipmentOrderRef = equipmentOrderRef;
    updateMutation.mutate(updates);
    setOpen(false);
  };

  const isOverdue = stage?.dueDate && !stage.completedAt && new Date(stage.dueDate) < new Date();

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={`flex items-center justify-between gap-3 p-3 rounded-md border transition-colors ${
          status === "complete"
            ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
            : status === "blocked"
            ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
            : status === "in_progress"
            ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
            : "border-border"
        }`}
        data-testid={`stage-row-${stageKey}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm" data-testid={`stage-label-${stageKey}`}>{label}</span>
              {isOverdue && (
                <Badge variant="destructive" className="text-xs" data-testid={`badge-overdue-${stageKey}`}>
                  Overdue
                </Badge>
              )}
              {stage?.owner && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> {stage.owner}
                </span>
              )}
              {stage?.dueDate && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(stage.dueDate).toLocaleDateString()}
                </span>
              )}
              {isEquipment && stage?.equipmentOrderRef && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Order: {stage.equipmentOrderRef}
                </span>
              )}
            </div>
            {stage?.completedAt && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                Completed {new Date(stage.completedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select value={status} onValueChange={handleStatusChange} disabled={updateMutation.isPending}>
            <SelectTrigger className="h-7 w-32 text-xs" data-testid={`select-status-${stageKey}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["pending", "in_progress", "complete", "blocked"] as MerchantOnboardingStageStatus[]).map(s => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`button-expand-${stageKey}`}>
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="mt-1 ml-7 p-3 rounded-md bg-muted/50 border border-border space-y-3" data-testid={`stage-detail-${stageKey}`}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Owner</label>
              <Input
                value={owner}
                onChange={e => setOwner(e.target.value)}
                placeholder="Assigned person"
                className="h-7 text-xs"
                data-testid={`input-owner-${stageKey}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Due Date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="h-7 text-xs"
                data-testid={`input-due-date-${stageKey}`}
              />
            </div>
          </div>

          {isEquipment && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Equipment Order Ref</label>
              <Input
                value={equipmentOrderRef}
                onChange={e => setEquipmentOrderRef(e.target.value)}
                placeholder="Order # or tracking link"
                className="h-7 text-xs"
                data-testid={`input-equipment-ref-${stageKey}`}
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Stage notes…"
              rows={2}
              className="text-xs resize-none"
              data-testid={`textarea-notes-${stageKey}`}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSaveDetails} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface Props {
  dealId: number;
}

export function OnboardingStagesChecklist({ dealId }: Props) {
  const { toast } = useToast();

  const { data: stages = [], isLoading } = useQuery<MerchantOnboardingStage[]>({
    queryKey: [`/api/deals/${dealId}/onboarding-stages`],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/onboarding-stages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load onboarding stages");
      return res.json();
    },
  });

  const initMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/onboarding-stages/initialize`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}/onboarding-stages`] });
      toast({ title: "Onboarding checklist initialized" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const stageMap = Object.fromEntries(stages.map(s => [s.stageKey, s])) as Record<string, MerchantOnboardingStage>;
  const completeCount = stages.filter(s => s.status === "complete").length;
  const totalCount = MERCHANT_ONBOARDING_STAGE_KEYS.length;
  const progressPct = totalCount > 0 ? Math.round((completeCount / totalCount) * 100) : 0;
  const hasStages = stages.length > 0;

  return (
    <Card data-testid="card-onboarding-stages">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Onboarding Workflow
          </CardTitle>
          <div className="flex items-center gap-2">
            {!hasStages && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => initMutation.mutate()}
                disabled={initMutation.isPending}
                data-testid="button-init-stages"
              >
                {initMutation.isPending ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Initialize Checklist
              </Button>
            )}
            {hasStages && (
              <Badge variant="outline" className="text-xs" data-testid="badge-progress">
                {completeCount}/{totalCount} complete
              </Badge>
            )}
          </div>
        </div>

        {hasStages && (
          <div className="space-y-1 mt-2">
            <Progress value={progressPct} className="h-2" data-testid="progress-bar-stages" />
            <p className="text-xs text-muted-foreground">{progressPct}% complete</p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasStages ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-stages">
            <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No onboarding checklist yet.</p>
            <p className="text-xs mt-1">Click "Initialize Checklist" to set up the 10-stage workflow.</p>
          </div>
        ) : (
          MERCHANT_ONBOARDING_STAGE_KEYS.map(key => (
            <StageRow
              key={key}
              dealId={dealId}
              stageKey={key}
              stage={stageMap[key]}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
