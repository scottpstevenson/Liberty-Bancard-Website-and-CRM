import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Send, RefreshCw, CheckCircle2, Clock, AlertCircle, XCircle,
  ChevronDown, ChevronUp, CreditCard, Info, PauseCircle, ShieldAlert,
} from "lucide-react";

interface BoardingStatus {
  boardingStatus: string;
  processorApplicationId: string | null;
  midMasked: string | null;
  hasMid: boolean;
  boardingLog: Array<{
    timestamp: string;
    event: string;
    status?: string;
    message?: string;
    processorApplicationId?: string;
    moreInfoRequest?: string;
    declineReason?: string;
    estimatedDecisionDate?: string;
    midMasked?: string;
  }>;
  boardingSubmittedAt: string | null;
  boardingApprovedAt: string | null;
}

interface Readiness {
  ready: boolean;
  blockers: Array<{ code: string; detail?: string }>;
  facts: { applicationUpdatedAt: string | null; applicationId: number | null; applicationBinding: string };
  policyGates: Array<{ code: string; state: string; meaning: string }>;
}

interface SubmitResponse {
  status: string;
  replayed?: boolean;
  outboxId?: string | null;
  receipt?: { outboxId: string | null; boardingStatus: string | null; processorName: string | null };
  message?: string;
}

class ReadError extends Error {
  constructor(readonly httpStatus: number, message: string) { super(message); }
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
  queued: { label: "Queued", color: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300", icon: Clock },
  dead_letter: { label: "Submission failed", color: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300", icon: XCircle },
  ambiguous_reconciliation_required: { label: "Outcome unknown — on hold", color: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300", icon: PauseCircle },
  error: { label: "Needs attention", color: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300", icon: AlertCircle },
};

const BLOCKER_LABELS: Record<string, string> = {
  deal_not_in_onboarding_pipeline: "Deal is not in the Onboarding pipeline",
  deal_not_operational: "Deal is archived, lost or a test record",
  no_linked_application: "No merchant application is linked to this deal",
  application_on_sales_deal: "The application is on the Sales deal and has not been bridged to this deal",
  application_not_active: "The application is not in a submittable state",
  application_contact_mismatch: "The application belongs to a different contact",
  application_incomplete: "The application is missing required fields",
  internal_underwriting_not_cleared: "Internal underwriting has not cleared this deal",
  required_document_missing: "A required document is missing",
  e_signature_required: "A signed agreement is required",
};
function blockerText(b: { code: string; detail?: string }): string {
  if (b.code.startsWith("policy_unresolved:")) return "Boarding requirements are not yet recorded by the owner";
  const base = BLOCKER_LABELS[b.code] ?? b.code.replace(/_/g, " ");
  return b.detail && !b.detail.startsWith("native_policy") ? `${base} (${b.detail})` : base;
}

const PROCESSOR_DISPLAY_NAMES: Record<string, string> = {
  nmi: "NMI (Network Merchants, Inc.)",
  mock: "Mock / Sandbox",
};

function formatTs(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Durable command identity: the same actor, deal, reviewed application revision and processor always reuse one key. */
function commandKeyStore() {
  return {
    get(identity: string): string {
      const storageKey = `boarding-submit:${identity}`;
      try {
        const existing = window.sessionStorage.getItem(storageKey);
        if (existing) return existing;
        const fresh = crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, fresh);
        return fresh;
      } catch {
        return crypto.randomUUID();
      }
    },
    clear(identity: string) {
      try { window.sessionStorage.removeItem(`boarding-submit:${identity}`); } catch { /* storage unavailable */ }
    },
  };
}

export default function BoardingPanel({ dealId, dealStage, dealPipeline, onStatusChange }: BoardingPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showLog, setShowLog] = useState(false);
  const [selectedProcessor, setSelectedProcessor] = useState<string>("");
  const keys = useRef(commandKeyStore()).current;
  const canOperate = user?.role === "admin" || user?.role === "manager";

  const isUnderwriting = dealPipeline === "onboarding" || dealStage?.toLowerCase().includes("underwriting") || dealStage?.toLowerCase().includes("approved");

  const statusQuery = useQuery<BoardingStatus>({
    queryKey: ["/api/deals", dealId, "boarding-status"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/boarding-status`, { credentials: "include" });
      if (!res.ok) throw new ReadError(res.status, `Boarding status could not be read (${res.status})`);
      const body = await res.json();
      if (typeof body?.boardingStatus !== "string" || !Array.isArray(body?.boardingLog)) {
        throw new ReadError(500, "Boarding status response was not in the expected shape");
      }
      return body as BoardingStatus;
    },
    enabled: !!dealId && isUnderwriting,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data as BoardingStatus | undefined;
      return d?.boardingStatus === "submitted" || d?.boardingStatus === "under_review" || d?.boardingStatus === "queued" ? 60000 : false;
    },
  });
  const status = statusQuery.data;

  const { data: enabledProcessors } = useQuery<{ processors: string[] }>({
    queryKey: ["/api/boarding/enabled-processors"],
    enabled: isUnderwriting && canOperate,
  });

  // Readiness is the one verdict the server also enforces at submit; the button follows it, never a local guess.
  const readinessQuery = useQuery<Readiness>({
    queryKey: ["/api/deals", dealId, "boarding-readiness"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/boarding-readiness`, { credentials: "include" });
      if (!res.ok) throw new ReadError(res.status, `Readiness could not be read (${res.status})`);
      const body = await res.json();
      if (typeof body?.ready !== "boolean" || !Array.isArray(body?.blockers) || !body?.facts) {
        throw new ReadError(500, "Readiness response was not in the expected shape");
      }
      return body as Readiness;
    },
    enabled: !!dealId && isUnderwriting && canOperate && !!status,
    retry: false,
  });
  const readiness = readinessQuery.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "boarding-status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "boarding-readiness"] });
    onStatusChange?.();
  };

  const processorChoice = selectedProcessor && selectedProcessor !== "__default" ? selectedProcessor : "";
  const revision = readiness?.facts.applicationUpdatedAt ?? null;
  const commandIdentity = `${user?.id ?? "unknown"}:${dealId}:${revision ?? "none"}:${processorChoice || "default"}`;

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!revision) throw new Error("No reviewed application revision. Reload the readiness check first.");
      const body: Record<string, string> = { expectedApplicationRevision: revision };
      if (processorChoice) body.processorName = processorChoice;
      const res = await apiRequest("POST", `/api/deals/${dealId}/submit-to-processor`, body, { "Idempotency-Key": keys.get(commandIdentity) });
      const data = (await res.json()) as SubmitResponse;
      return { data, http: res.status };
    },
    onSuccess: ({ data, http }) => {
      if (data.replayed) {
        // A replay reports what the earlier identical command became; it is not a new submission.
        const saved = data.receipt?.boardingStatus ?? data.status;
        toast({
          title: "Already submitted",
          description: `This submission was already accepted (${STATUS_CONFIG[saved ?? ""]?.label ?? saved ?? data.status}).${data.outboxId ? ` Receipt ${String(data.outboxId).slice(0, 8)}.` : ""}`,
        });
        if (http === 200) keys.clear(commandIdentity);
      } else {
        keys.clear(commandIdentity);
        // The route only enqueues (202); the provider application id arrives later from the durable worker.
        toast({
          title: "Submission queued",
          description: `Queued for processing${data.outboxId ? ` (receipt ${String(data.outboxId).slice(0, 8)})` : ""}. The processor application ID appears here once the processor accepts it.`,
        });
      }
      invalidate();
    },
    onError: (err: Error) => {
      const conflict = /^409:/.test(err.message);
      toast({
        title: conflict ? "Submission not accepted" : "Submission failed",
        description: conflict ? `${err.message.replace(/^409:\s*/, "")} Review readiness and try again.` : err.message,
        variant: "destructive",
      });
      if (conflict) invalidate();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/refresh-boarding-status`);
      return res.json();
    },
    onSuccess: (data: any) => {
      const known = typeof data?.status === "string" && data.status.length > 0;
      toast({
        title: known ? `Status: ${STATUS_CONFIG[data.status]?.label || data.status}` : "Status checked",
        description: data?.midMasked ? `MID assigned: ${data.midMasked}` : data?.message
          ?? (known ? undefined : "The processor did not report a new status."),
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isUnderwriting) return null;
  if (statusQuery.isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2" data-testid="boarding-panel-loading">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading boarding status…
    </div>
  );
  if (statusQuery.isError || !status) {
    const err = statusQuery.error as ReadError | null;
    const denied = err instanceof ReadError && (err.httpStatus === 401 || err.httpStatus === 403);
    const lost = err instanceof ReadError && err.httpStatus === 404;
    return (
      <div className="border rounded-lg border-destructive/40 bg-destructive/5 p-3 space-y-2" role="alert" data-testid="boarding-panel-unavailable">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          {denied ? "You do not have access to this deal's boarding state" : lost ? "This deal could not be found" : "Boarding status is unavailable"}
        </div>
        <p className="text-xs text-muted-foreground">
          {denied ? "Nothing is shown or actionable here for your account."
            : lost ? "It may have been removed or merged. Submit and refresh are disabled."
            : "The status could not be read, so submit and refresh are disabled until it loads."}
        </p>
        {!denied && !lost && (
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => statusQuery.refetch()} data-testid="button-retry-boarding-status">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        )}
      </div>
    );
  }

  const s = status;
  const cfg = STATUS_CONFIG[s.boardingStatus] || { label: `Unrecognized status: ${s.boardingStatus}`, color: "bg-red-100 text-red-700 border-red-200", icon: AlertCircle };
  const StatusIcon = cfg.icon;
  const resubmittable = s.boardingStatus === "not_submitted" || s.boardingStatus === "declined" || s.boardingStatus === "dead_letter";
  const canRefresh = !!s.processorApplicationId && (s.boardingStatus === "submitted" || s.boardingStatus === "under_review" || s.boardingStatus === "more_info_needed");
  const lastLog = s.boardingLog?.length > 0 ? s.boardingLog[s.boardingLog.length - 1] : null;
  const processors = enabledProcessors?.processors ?? [];
  const blocked = canOperate && resubmittable && (!readiness || !readiness.ready);
  const canSubmit = canOperate && resubmittable && !!readiness?.ready && !!revision;

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
        <div className="flex flex-wrap items-center gap-1.5">
          {canSubmit && processors.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="boarding-processor-select" className="text-xs text-muted-foreground whitespace-nowrap">Via:</Label>
              <Select value={selectedProcessor} onValueChange={setSelectedProcessor}>
                <SelectTrigger id="boarding-processor-select" className="min-h-11 text-xs w-44" data-testid="trigger-processor-select">
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
          {canOperate && resubmittable && (
            <Button
              size="sm"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !canSubmit}
              className="min-h-11 text-xs"
              data-testid="button-submit-to-processor"
            >
              <Send className={`h-3.5 w-3.5 mr-1 ${submitMutation.isPending ? "animate-spin" : ""}`} />
              {submitMutation.isPending ? "Submitting…" : s.boardingStatus === "not_submitted" ? "Submit to Processor" : "Resubmit to Processor"}
            </Button>
          )}
          {canRefresh && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="min-h-11 text-xs"
              data-testid="button-refresh-boarding-status"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Checking…" : "Refresh Status"}
            </Button>
          )}
        </div>
      </div>

      {s.boardingStatus === "queued" && (
        <p className="text-xs text-muted-foreground" data-testid="text-boarding-queued">
          Queued for the processor. Nothing has been sent yet; the status changes once the submission worker runs.
        </p>
      )}
      {s.boardingStatus === "dead_letter" && (
        <p className="text-xs text-red-700 dark:text-red-300" role="status" data-testid="text-boarding-dead-letter">
          The submission could not be completed and was not delivered. Review readiness, then resubmit.
        </p>
      )}
      {s.boardingStatus === "ambiguous_reconciliation_required" && (
        <p className="text-xs text-orange-700 dark:text-orange-300" role="status" data-testid="text-boarding-ambiguous">
          The processor may or may not have received this application. It is on hold for reconciliation and must not be resubmitted from here.
        </p>
      )}
      {s.boardingStatus === "error" && (
        <p className="text-xs text-red-700 dark:text-red-300" role="status" data-testid="text-boarding-error">
          The last boarding step failed. Check the timeline; an operator needs to review before anything is sent again.
        </p>
      )}

      {canOperate && resubmittable && readinessQuery.isError && (
        <p className="text-xs text-destructive" role="alert" data-testid="text-readiness-unavailable">
          Readiness could not be read, so submission is disabled.{" "}
          <button className="underline min-h-11" onClick={() => readinessQuery.refetch()} data-testid="button-retry-readiness">Retry</button>
        </p>
      )}
      {blocked && readiness && !readiness.ready && (
        <div className="text-xs rounded border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 p-2 text-orange-800 dark:text-orange-300" data-testid="boarding-blockers">
          <p className="font-medium mb-1">Not ready to submit:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {readiness.blockers.map((b, i) => <li key={`${b.code}-${i}`} data-testid={`blocker-${b.code}`}>{blockerText(b)}</li>)}
          </ul>
        </div>
      )}

      {(s.processorApplicationId || s.hasMid) && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {s.processorApplicationId && (
            <span data-testid="text-processor-app-id">
              App ID: <span className="font-mono font-medium text-foreground">{s.processorApplicationId}</span>
            </span>
          )}
          {s.hasMid && s.midMasked && (
            <span data-testid="text-mid">
              MID: <span className="font-mono font-medium text-green-600 dark:text-green-400">{s.midMasked}</span>
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
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-11"
            onClick={() => setShowLog(p => !p)}
            aria-expanded={showLog}
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
                  {entry.midMasked && <p className="text-green-600 dark:text-green-400 ml-3 font-mono">MID: {entry.midMasked}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
