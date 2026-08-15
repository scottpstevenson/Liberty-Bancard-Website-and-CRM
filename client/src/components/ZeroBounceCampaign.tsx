import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  Loader2, PlayCircle, XCircle, AlertTriangle, CheckCircle2, CalendarClock, Ban,
} from "lucide-react";

// ── Types (mirror GET /api/contacts/validate-emails-campaign) ────────────────

interface CampaignCounts {
  claimed: number;
  providerCompleted: number;
  retryableFailed: number;
  skippedPlaceholders: number;
  errors: number;
  pending: number;
  valid: number;
  blocked: number;
  remainingEligible: number;
}

interface CampaignRun {
  id: string;
  state: "running" | "budget_stopped" | "interrupted" | "completed";
  stopReason: string | null;
  cancelRequested: boolean;
  contactLimit: number;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface CampaignResponse {
  active: boolean;
  campaign: {
    id: string;
    initialEligibleTotal: number;
    status: string;
    createdAt: string;
  } | null;
  counts?: CampaignCounts;
  dailyBudget?: { used: number; limit: number };
  latestRun?: CampaignRun | null;
}

const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

type CardState =
  | "not_started"
  | "running"
  | "budget_stopped"
  | "interrupted"
  | "run_finished" // day's run done (contact limit / cohort pass), campaign not complete
  | "completed"
  | "cancelled";

/**
 * Persistent multi-day ZeroBounce validation campaign tracker (task 1540C).
 * Polls the campaign summary every 10s ONLY while a run is in 'running' state;
 * otherwise fetches once on load and stays quiet.
 */
export function ZeroBounceCampaign({
  fallbackEligible,
  fallbackDailyLimit,
}: {
  /** Eligible-contact count from quality-summary, used before a campaign exists. */
  fallbackEligible: number | undefined;
  /** ZeroBounce daily limit from quality-summary, used before a campaign exists. */
  fallbackDailyLimit: number | undefined;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user as any)?.role === "admin";
  const [locallyCancelled, setLocallyCancelled] = useState(false);

  const { data, isLoading, error } = useQuery<CampaignResponse>({
    queryKey: ["/api/contacts/validate-emails-campaign"],
    queryFn: () =>
      apiRequest("GET", "/api/contacts/validate-emails-campaign").then((r) => r.json()),
    // Poll every 10s ONLY while a run is actively running — never when no
    // campaign exists or the latest run is in a terminal state.
    refetchInterval: (query) =>
      (query.state.data as CampaignResponse | undefined)?.latestRun?.state === "running"
        ? 10_000
        : false,
  });

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/contacts/validate-emails-batch", {
        issue: "unvalidated_email",
        limit: 500,
      }).then((r) => r.json()),
    onSuccess: (res: any) => {
      setLocallyCancelled(false);
      toast({
        title: res.alreadyRunning ? "Run already in progress" : "Validation run started",
        description: res.message,
      });
      qc.invalidateQueries({ queryKey: ["/api/contacts/validate-emails-campaign"] });
    },
    onError: (err: any) =>
      toast({ title: "Could not start run", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) =>
      apiRequest("DELETE", `/api/contacts/validate-emails-batch/${runId}`).then((r) => r.json()),
    onSuccess: (res: any) => {
      setLocallyCancelled(true);
      toast({ title: "Campaign cancelled", description: res.message });
      qc.invalidateQueries({ queryKey: ["/api/contacts/validate-emails-campaign"] });
    },
    onError: (err: any) =>
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading validation campaign…
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-600">
          Could not load validation campaign status.
        </CardContent>
      </Card>
    );
  }

  const run = data.latestRun ?? null;
  const counts = data.counts;
  const initialTotal = data.campaign?.initialEligibleTotal ?? 0;
  const remaining = counts?.remainingEligible ?? 0;
  const dailyLimit = data.dailyBudget?.limit ?? fallbackDailyLimit ?? 500;

  // Heartbeat staleness (client-side display guard; the server also marks
  // stale runs interrupted on every read).
  const heartbeatStale =
    run?.state === "running" &&
    run.lastHeartbeatAt != null &&
    Date.now() - new Date(run.lastHeartbeatAt).getTime() > STALE_HEARTBEAT_MS;

  let cardState: CardState;
  if (locallyCancelled && !data.active) cardState = "cancelled";
  else if (!data.active || !data.campaign) cardState = "not_started";
  else if (run?.state === "running" && !heartbeatStale) cardState = "running";
  else if (run?.state === "running" && heartbeatStale) cardState = "interrupted";
  else if (remaining === 0 && (counts?.pending ?? 0) === 0) cardState = "completed";
  else if (run?.state === "budget_stopped") cardState = "budget_stopped";
  else if (run?.state === "interrupted") cardState = "interrupted";
  else if (run?.state === "completed") cardState = "run_finished";
  else cardState = "not_started";

  const isRunning = cardState === "running";
  const estDays = remaining > 0 ? Math.ceil(remaining / dailyLimit) : 0;
  const progressPct =
    initialTotal > 0 ? Math.min(100, ((counts?.providerCompleted ?? 0) / initialTotal) * 100) : 0;

  const stateBadge: Record<CardState, { label: string; cls: string }> = {
    not_started:   { label: "Not started",        cls: "text-gray-600 border-gray-300 bg-gray-50" },
    running:       { label: "Running",            cls: "text-blue-700 border-blue-300 bg-blue-50" },
    budget_stopped:{ label: "Daily limit reached", cls: "text-amber-700 border-amber-300 bg-amber-50" },
    interrupted:   { label: "Interrupted",         cls: "text-red-700 border-red-300 bg-red-50" },
    run_finished:  { label: "Run finished",        cls: "text-amber-700 border-amber-300 bg-amber-50" },
    completed:     { label: "Completed",           cls: "text-green-700 border-green-300 bg-green-50" },
    cancelled:     { label: "Cancelled",           cls: "text-gray-600 border-gray-300 bg-gray-50" },
  };

  const startLabel =
    cardState === "budget_stopped" ? "Start Next Day's Run"
    : cardState === "interrupted" ? "Resume"
    : cardState === "run_finished" ? "Resume"
    : "Start Batch Run";

  return (
    <Card data-testid="zb-campaign-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Validation Campaign
            </CardTitle>
            <CardDescription>
              Durable multi-day ZeroBounce validation of all eligible contacts.
            </CardDescription>
          </div>
          <Badge variant="outline" className={`text-xs ${stateBadge[cardState].cls}`} data-testid="zb-campaign-state">
            {stateBadge[cardState].label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* State-specific banner */}
        {cardState === "not_started" && (
          <p className="text-sm text-muted-foreground">
            No campaign yet. {fallbackEligible != null ? (
              <>
                <span className="font-medium text-foreground">{fallbackEligible.toLocaleString()}</span>{" "}
                contacts have unvalidated emails — estimated minimum{" "}
                <span className="font-medium text-foreground">
                  {Math.ceil(fallbackEligible / dailyLimit).toLocaleString()} days
                </span>{" "}
                at the current limit of {dailyLimit}/day.
              </>
            ) : "Start a batch run to begin."}
          </p>
        )}
        {cardState === "cancelled" && (
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <Ban className="h-4 w-4 shrink-0" />
            Campaign cancelled. Starting a new run will create a fresh campaign.
          </div>
        )}
        {cardState === "budget_stopped" && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Daily limit reached — resume tomorrow.
          </div>
        )}
        {cardState === "run_finished" && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Last run finished ({run?.stopReason === "contact_limit_reached" ? "run contact limit reached" : run?.stopReason ?? "done"}) — more contacts remain.
          </div>
        )}
        {cardState === "interrupted" && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="zb-campaign-stalled">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Last run appears stalled (heartbeat &gt;5 min ago — last heartbeat{" "}
              {relativeTime(run?.lastHeartbeatAt ?? null)}
              {run?.stopReason ? `; reason: ${run.stopReason}` : ""}). Start a new run to resume.
            </span>
          </div>
        )}
        {cardState === "completed" && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            All eligible contacts processed
            {run?.finishedAt ? ` — completed ${new Date(run.finishedAt).toLocaleString()}` : ""}.
          </div>
        )}

        {/* Progress + counters (any state with a campaign) */}
        {data.active && counts && (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {counts.providerCompleted.toLocaleString()} / {initialTotal.toLocaleString()} validated
                </span>
                <span>{Math.floor(progressPct)}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="zb-campaign-counters">
              <span>Completed: <span className="font-medium text-foreground">{counts.providerCompleted.toLocaleString()}</span></span>
              <span>Retryable errors: <span className="font-medium text-foreground">{counts.retryableFailed.toLocaleString()}</span></span>
              <span>Skipped (placeholders): <span className="font-medium text-foreground">{counts.skippedPlaceholders.toLocaleString()}</span></span>
              <span>Remaining: <span className="font-medium text-foreground">{counts.remainingEligible.toLocaleString()}</span></span>
              {cardState === "completed" && (
                <>
                  <span>Valid: <span className="font-medium text-green-700">{counts.valid.toLocaleString()}</span></span>
                  <span>Blocked (unsafe): <span className="font-medium text-red-700">{counts.blocked.toLocaleString()}</span></span>
                  <span>Errors: <span className="font-medium text-foreground">{counts.errors.toLocaleString()}</span></span>
                </>
              )}
            </div>

            {/* Estimated timeline */}
            <p className="text-xs text-muted-foreground">
              {remaining === 0 ? (
                <span className="text-green-700 font-medium">Complete</span>
              ) : (
                <>
                  Estimated minimum:{" "}
                  <span className="font-medium text-foreground">{estDays.toLocaleString()} days</span>{" "}
                  at current limit of {dailyLimit}/day
                </>
              )}
            </p>

            {/* Heartbeat while running */}
            {isRunning && (
              <p className="text-xs text-muted-foreground">
                Last heartbeat: {relativeTime(run?.lastHeartbeatAt ?? null)}
                {run?.cancelRequested && " — cancellation requested, stopping between contacts…"}
              </p>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {cardState !== "completed" && (
            <Button
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={isRunning || startMutation.isPending}
              data-testid="zb-campaign-start"
            >
              {startMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                : <PlayCircle className="h-3 w-3 mr-1" />}
              {startLabel}
            </Button>
          )}
          {isAdmin && data.active && run && (cardState === "running" || cardState === "budget_stopped" || cardState === "interrupted" || cardState === "run_finished") && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => {
                if (window.confirm("Cancel this validation campaign? The current run will stop and the next start creates a fresh campaign.")) {
                  cancelMutation.mutate(run.id);
                }
              }}
              disabled={cancelMutation.isPending}
              data-testid="zb-campaign-cancel"
            >
              {cancelMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                : <XCircle className="h-3 w-3 mr-1" />}
              Cancel Run
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
