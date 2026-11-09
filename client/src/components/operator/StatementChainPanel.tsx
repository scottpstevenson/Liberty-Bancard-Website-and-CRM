import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, Hand, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import {
  ANALYSIS_LABEL,
  CHAIN_STEP_LABEL,
  OCCURRENCE_STATUS_LABEL,
  type ChainStepState,
  type OccurrenceStatus,
  type StatementChainResponse,
  type StoredChainStep,
} from "@shared/statement-chain-state";

/** A failed read is never an empty list: the panel says whether access was denied or the data is unavailable. */
export class ChainReadError extends Error {
  constructor(public readonly kind: "denied" | "unavailable", message: string) {
    super(message);
  }
}

const STEP_STATE_TEXT: Record<ChainStepState, string> = {
  done: "Done",
  held: "Held — not run",
  handed_off: "Handed off — not confirmed by the provider",
  failed: "Failed",
};

const STATUS_CLASS: Record<OccurrenceStatus, string> = {
  complete: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300",
  held: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200",
  manual_review: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/20 dark:text-amber-200",
  needs_attention: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300",
  unrecorded: "bg-muted text-muted-foreground border-border",
};

function StepMark({ step }: { step: StoredChainStep }) {
  const name = CHAIN_STEP_LABEL[step.name] ?? step.name;
  const text = `${name}: ${STEP_STATE_TEXT[step.state]}${step.detail ? ` (${step.detail})` : ""}`;
  const icon =
    step.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
    : step.state === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
    : step.state === "held" ? <Hand className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
    : <ArrowRightLeft className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />;
  return (
    <li className="flex items-center gap-1.5">
      {icon}
      <span>{text}</span>
    </li>
  );
}

export async function loadStatementChain(failuresOnly: boolean): Promise<StatementChainResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/operator/statement-chain?failuresOnly=${failuresOnly}&limit=60`, { credentials: "include" });
  } catch {
    throw new ChainReadError("unavailable", "The connection failed.");
  }
  if (res.status === 401 || res.status === 403) throw new ChainReadError("denied", "Your account is not allowed to view statement handoff status.");
  if (!res.ok) throw new ChainReadError("unavailable", "Statement handoff status could not be loaded.");
  return res.json();
}

export default function StatementChainPanel() {
  const [failuresOnly, setFailuresOnly] = useState(false);

  const query = useQuery<StatementChainResponse, ChainReadError>({
    queryKey: ["/api/operator/statement-chain", failuresOnly],
    queryFn: () => loadStatementChain(failuresOnly),
    refetchInterval: 60000,
    retry: false,
  });

  const data = query.data;
  const asOf = data ? new Date(data.asOf).toLocaleString() : null;

  return (
    <Card data-testid="statement-chain-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Statement handoff status</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="text-chain-scope">
              The latest statement requests and what actually happened to each step. A held step has not run, and a handed-off step is not
              confirmed by the provider.
              {data ? ` Showing ${data.scope.returned} of the latest ${data.scope.limit} requests as of ${asOf}.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={failuresOnly ? "default" : "outline"}
              className="min-h-11 gap-1 text-xs sm:min-h-8"
              onClick={() => setFailuresOnly((value) => !value)}
              aria-pressed={failuresOnly}
              data-testid="button-failures-only-toggle"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {failuresOnly ? "Showing items needing attention" : "Show items needing attention"}
              {data && data.scope.needsAttention > 0 && !failuresOnly && (
                <Badge variant="destructive" className="ml-0.5 h-4 px-1 text-[10px]">{data.scope.needsAttention}</Badge>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 gap-1 text-xs sm:min-h-8"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              data-testid="button-refresh-chain"
            >
              <RefreshCw className={`h-3 w-3 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground" data-testid="text-chain-analysis-setting">
            {data.autoAnalysisEnabled
              ? "Automatic statement analysis is turned on."
              : "Automatic statement analysis is held. Statements wait for manual review until an owner turns it on."}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Clock className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading statement requests…
          </div>
        ) : query.isError ? (
          <div className="space-y-3 py-6" role="alert" data-testid={query.error.kind === "denied" ? "chain-denied" : "chain-unavailable"}>
            <p className="flex items-start gap-2 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {query.error.kind === "denied" ? "Access denied. " : "Unavailable right now, so this is not an all-clear. "}
                {query.error.message}
              </span>
            </p>
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => query.refetch()} data-testid="button-chain-retry">Retry</Button>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="chain-empty">
            {failuresOnly
              ? `No requests in this window need attention (latest ${data?.scope.limit ?? 60} requests, as of ${asOf}).`
              : "No statement requests have been received yet."}
          </div>
        ) : (
          <ul className="divide-y" data-testid="list-statement-chain">
            {data.rows.map((row) => (
              <li key={row.requestReceipt} className="space-y-2 py-3" data-testid={`row-chain-${row.shortRef}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.businessName ?? "Business name not provided"}</span>
                  <span className="font-mono text-xs text-muted-foreground">Ref {row.shortRef}</span>
                  <span className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString()}</span>
                  <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${STATUS_CLASS[row.status]}`} data-testid={`badge-chain-status-${row.shortRef}`}>
                    {OCCURRENCE_STATUS_LABEL[row.status]}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span data-testid={`text-chain-analysis-${row.shortRef}`}>{ANALYSIS_LABEL[row.analysis]}</span>
                  <a className="text-blue-600 hover:underline" href={`/dashboard/lead-ops?tab=pipeline&ref=${row.shortRef}`} data-testid={`link-chain-request-${row.shortRef}`}>Open request</a>
                  {row.documentId != null && (
                    <a className="text-blue-600 hover:underline" href={`/api/documents/download/${row.documentId}`} data-testid={`link-chain-file-${row.shortRef}`}>Open retained file</a>
                  )}
                  {row.dealId != null && <a className="text-blue-600 hover:underline" href={`/dashboard/pipeline?id=${row.dealId}`}>Open deal</a>}
                </div>
                {row.steps.length > 0 ? (
                  <details className="text-xs">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground lg:min-h-0">Step detail</summary>
                    <ul className="mt-1 space-y-1" data-testid={`steps-chain-${row.shortRef}`}>
                      {row.steps.map((step) => <StepMark key={step.step} step={step} />)}
                    </ul>
                  </details>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {row.status === "manual_review"
                      ? "Automatic processing did not start. The file is retained for manual review."
                      : "No step detail was recorded for this request."}
                  </p>
                )}
                {row.diagnostics.terminalReason && (
                  <details className="text-xs">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground lg:min-h-0">Diagnostics</summary>
                    <p className="mt-1 break-words text-muted-foreground">Reason on record: {row.diagnostics.terminalReason}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
