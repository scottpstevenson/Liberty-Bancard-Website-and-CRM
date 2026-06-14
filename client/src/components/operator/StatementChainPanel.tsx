import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, Minus } from "lucide-react";

interface ChainStepResult {
  name: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  durationMs: number;
}

interface ChainLog {
  id: number;
  action: string;
  entityId: number;
  createdAt: string;
  details: {
    contactId: number;
    dealId: number;
    steps: ChainStepResult[];
    hasFailures: boolean;
    failedSteps: string[];
    completedAt: string;
  };
}

const STEP_LABELS: Record<string, string> = {
  blueprint_generation: "Blueprint",
  proposal_generation: "Proposal",
  ghl_form_sync: "GHL Sync",
  ghl_statement_sync: "GHL Tag",
  sequence_enrollment: "Sequence",
  workflow_trigger: "Workflow",
  inbound_confirmation: "Confirmation",
  confirm_sms: "SMS",
};

function StepDot({ step }: { step: ChainStepResult }) {
  if (step.status === "success") return (
    <div title={`${STEP_LABELS[step.name] || step.name} — OK`}>
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    </div>
  );
  if (step.status === "failed") return (
    <div title={`${STEP_LABELS[step.name] || step.name} — FAILED: ${step.error}`}>
      <XCircle className="h-3.5 w-3.5 text-red-500" />
    </div>
  );
  return (
    <div title={`${STEP_LABELS[step.name] || step.name} — skipped`}>
      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

export default function StatementChainPanel() {
  const [failuresOnly, setFailuresOnly] = useState(false);

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery<ChainLog[]>({
    queryKey: ["/api/operator/statement-chain", failuresOnly],
    queryFn: async () => {
      const res = await fetch(
        `/api/operator/statement-chain?failuresOnly=${failuresOnly}&limit=60`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const totalFailures = logs.filter((l) => l.action === "statement_chain_partial_failure").length;

  return (
    <Card data-testid="statement-chain-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">Statement Upload Chain</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-step visibility on every statement upload. Each upload fires 7-8 async steps (GHL sync, blueprint, proposal, sequences…).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={failuresOnly ? "default" : "outline"}
              className="h-7 text-xs gap-1"
              onClick={() => setFailuresOnly((v) => !v)}
              data-testid="button-failures-only-toggle"
            >
              <AlertTriangle className="h-3 w-3" />
              {failuresOnly ? "Showing failures" : "Show failures only"}
              {totalFailures > 0 && !failuresOnly && (
                <Badge variant="destructive" className="h-4 text-[10px] px-1 ml-0.5">{totalFailures}</Badge>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-chain"
            >
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Clock className="h-4 w-4 animate-spin" /> Loading chain events…
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {failuresOnly
              ? "No chain failures recorded. All statement uploads completed successfully."
              : "No statement chain events yet. Upload a statement to see chain tracking here."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-statement-chain">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2 pr-3 font-medium">Time</th>
                  <th className="text-left pb-2 pr-3 font-medium">Deal</th>
                  <th className="text-left pb-2 pr-3 font-medium">Status</th>
                  <th className="text-left pb-2 pr-3 font-medium">Steps</th>
                  <th className="text-left pb-2 font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const d = log.details;
                  const hasFailure = log.action === "statement_chain_partial_failure";
                  return (
                    <tr
                      key={log.id}
                      className={`border-b last:border-0 ${hasFailure ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
                      data-testid={`row-chain-${log.id}`}
                    >
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString(undefined, {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={`/dashboard/pipeline?dealId=${d?.dealId}`}
                          className="text-primary hover:underline font-mono"
                          data-testid={`link-deal-${d?.dealId}`}
                        >
                          #{d?.dealId}
                        </a>
                      </td>
                      <td className="py-2 pr-3">
                        {hasFailure ? (
                          <Badge variant="outline" className="h-4 text-[10px] px-1 bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300">
                            Partial failure
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-4 text-[10px] px-1 bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300">
                            Complete
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          {(d?.steps || []).map((step, i) => (
                            <StepDot key={i} step={step} />
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-red-600 dark:text-red-400">
                        {(d?.failedSteps || []).map((s) => STEP_LABELS[s] || s).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
