import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Send, RefreshCw, CheckCircle2, Clock, AlertCircle, XCircle,
  ChevronDown, ChevronUp, CreditCard, Info,
} from "lucide-react";

interface BoardingStatus {
  boardingStatus: string;
  processorApplicationId: string | null;
  mid: string | null;
  boardingLog: Array<{
    timestamp: string;
    event: string;
    status?: string;
    message?: string;
    processorApplicationId?: string;
    moreInfoRequest?: string;
    declineReason?: string;
    estimatedDecisionDate?: string;
    mid?: string;
  }>;
  boardingSubmittedAt: string | null;
  boardingApprovedAt: string | null;
}

interface BoardingPanelProps {
  dealId: number;
  dealStage: string;
  dealPipeline: string;
  onStatusChange?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  not_submitted: { label: "Not Submitted", color: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300", icon: Clock },
  submitted: { label: "Submitted", color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300", icon: Send },
  under_review: { label: "Under Review", color: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300", icon: Clock },
  more_info_needed: { label: "More Info Needed", color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300", icon: AlertCircle },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300", icon: CheckCircle2 },
  declined: { label: "Declined", color: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300", icon: XCircle },
};

const PROCESSOR_DISPLAY_NAMES: Record<string, string> = {
  nmi: "NMI (Network Merchants, Inc.)",
  mock: "Mock / Sandbox",
};

function formatTs(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BoardingPanel({ dealId, dealStage, dealPipeline, onStatusChange }: BoardingPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [selectedProcessor, setSelectedProcessor] = useState<string>("");

  const isUnderwriting = dealPipeline === "onboarding" || dealStage?.toLowerCase().includes("underwriting") || dealStage?.toLowerCase().includes("approved");

  const { data: status, isLoading } = useQuery<BoardingStatus>({
    queryKey: ["/api/deals", dealId, "boarding-status"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/boarding-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch boarding status");
      return res.json();
    },
    enabled: !!dealId && isUnderwriting,
    refetchInterval: (query) => {
      const d = query.state.data as BoardingStatus | undefined;
      return d?.boardingStatus === "submitted" || d?.boardingStatus === "under_review" ? 60000 : false;
    },
  });

  const { data: enabledProcessors } = useQuery<{ processors: string[] }>({
    queryKey: ["/api/boarding/enabled-processors"],
    enabled: isUnderwriting,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "boarding-status"] });
    onStatusChange?.();
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (selectedProcessor && selectedProcessor !== "__default") body.processorName = selectedProcessor;
      const res = await apiRequest("POST", `/api/deals/${dealId}/submit-to-processor`, body);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Submitted to processor",
        description: `Application ID: ${data.processorApplicationId}. ${data.message}`,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/refresh-boarding-status`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: `Status: ${STATUS_CONFIG[data.status]?.label || data.status}`,
        description: data.midMasked ? `MID assigned: ${data.midMasked}` : data.message,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isUnderwriting) return null;
  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading boarding status…
    </div>
  );

  const s = status || { boardingStatus: "not_submitted", processorApplicationId: null, mid: null, boardingLog: [], boardingSubmittedAt: null, boardingApprovedAt: null };
  const cfg = STATUS_CONFIG[s.boardingStatus] || STATUS_CONFIG.not_submitted;
  const StatusIcon = cfg.icon;
  const canSubmit = s.boardingStatus === "not_submitted" || s.boardingStatus === "declined";
  const canRefresh = s.boardingStatus === "submitted" || s.boardingStatus === "under_review" || s.boardingStatus === "more_info_needed";
  const lastLog = s.boardingLog?.length > 0 ? s.boardingLog[s.boardingLog.length - 1] : null;
  const processors = enabledProcessors?.processors ?? [];

  return (
    <div className="border rounded-lg bg-muted/20 p-3 space-y-2" data-testid="boarding-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Processor Boarding</span>
          <Badge variant="outline" className={`text-xs border ${cfg.color}`} data-testid="badge-boarding-status">
            <StatusIcon className="h-3 w-3 mr-1" />
            {cfg.label}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {canSubmit && processors.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Via:</Label>
              <Select value={selectedProcessor} onValueChange={setSelectedProcessor} data-testid="select-processor">
                <SelectTrigger className="h-7 text-xs w-44" data-testid="trigger-processor-select">
                  <SelectValue placeholder="Default processor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">Default</SelectItem>
                  {processors.map(p => (
                    <SelectItem key={p} value={p} data-testid={`option-processor-${p}`}>
                      {PROCESSOR_DISPLAY_NAMES[p] || p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {canSubmit && (
            <Button
              size="sm"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="h-7 text-xs"
              data-testid="button-submit-to-processor"
            >
              <Send className={`h-3.5 w-3.5 mr-1 ${submitMutation.isPending ? "animate-spin" : ""}`} />
              {submitMutation.isPending ? "Submitting…" : "Submit to Processor"}
            </Button>
          )}
          {canRefresh && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="h-7 text-xs"
              data-testid="button-refresh-boarding-status"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Checking…" : "Refresh Status"}
            </Button>
          )}
        </div>
      </div>

      {s.processorApplicationId && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span data-testid="text-processor-app-id">
            App ID: <span className="font-mono font-medium text-foreground">{s.processorApplicationId}</span>
          </span>
          {s.mid && (
            <span data-testid="text-mid">
              MID: <span className="font-mono font-medium text-green-600 dark:text-green-400">{s.mid}</span>
            </span>
          )}
          {s.boardingSubmittedAt && (
            <span data-testid="text-submitted-at">
              Submitted: {new Date(s.boardingSubmittedAt).toLocaleDateString()}
            </span>
          )}
          {s.boardingApprovedAt && (
            <span data-testid="text-approved-at">
              Approved: {new Date(s.boardingApprovedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {lastLog?.moreInfoRequest && (
        <div className="flex items-start gap-2 p-2 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 text-xs text-orange-700 dark:text-orange-300">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span data-testid="text-more-info-request"><span className="font-medium">Required: </span>{lastLog.moreInfoRequest}</span>
        </div>
      )}

      {lastLog?.declineReason && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span data-testid="text-decline-reason"><span className="font-medium">Declined: </span>{lastLog.declineReason}</span>
        </div>
      )}

      {s.boardingLog?.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowLog(p => !p)}
            data-testid="button-toggle-boarding-log"
          >
            {showLog ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showLog ? "Hide" : "Show"} timeline ({s.boardingLog.length} event{s.boardingLog.length !== 1 ? "s" : ""})
          </button>

          {showLog && (
            <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-muted ml-1" data-testid="boarding-timeline">
              {[...s.boardingLog].reverse().map((entry, i) => (
                <div key={i} className="text-xs" data-testid={`timeline-entry-${i}`}>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="font-medium text-foreground capitalize">{entry.event?.replace(/_/g, " ")}</span>
                    <span>·</span>
                    <span>{formatTs(entry.timestamp)}</span>
                    {entry.status && (
                      <Badge variant="outline" className="h-4 text-[10px] px-1">
                        {STATUS_CONFIG[entry.status]?.label || entry.status}
                      </Badge>
                    )}
                  </div>
                  {entry.message && <p className="text-muted-foreground ml-3">{entry.message}</p>}
                  {entry.mid && <p className="text-green-600 dark:text-green-400 ml-3 font-mono">MID: {entry.mid}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
