import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, parseApiRequestError, queryClient } from "@/lib/queryClient";
import { InboundResumeAction } from "@/components/lead-ops/InboundResumeAction";
import type { AnalysisState } from "@shared/statement-chain-state";
import { taskSelectionHref, todayDestinations } from "@/lib/crm-destination-state";
import { statementReviewHref } from "@/lib/statement-request-paths";

export interface InboundRequestRow {
  requestReceipt: string;
  shortRef: string;
  businessName: string | null;
  processingNeedsAttention: boolean;
  work: { taskId: number | null; ticketId: number | null; title: string | null; status: string | null } | null;
  receipt: { state: string; reason: string | null } | null;
  sourceClass: string;
  sourceCategory: string;
  sourceType: string;
  lifecycleState: string;
  effects: Array<{
    effectKey: string;
    effectType: string;
    state: string;
    required: boolean;
    externalSideEffect: boolean;
    terminalReason: string | null;
  }>;
  assignmentStatus: string;
  assignmentReason?: string | null;
  assignedTo: string | null;
  slaDueAt: string | null;
  contactId: number | null;
  dealId: number | null;
  ticketId: number | null;
  createdAt: string;
  terminalReason: string | null;
  reviewRevision?: number | null;
  /** Frozen context of an equipment or general inquiry (null for every other source). */
  inquiry?: {
    mode: "equipment_inquiry" | "general_inquiry";
    offerId: string | null;
    businessName: string;
    businessType: string | null;
    volumeBand: string | null;
    currentlyLeasing: string | null;
    intent: string | null;
    phoneProvided: boolean;
    smsPermissionRequested: boolean;
    note: string | null;
  } | null;
  /** Statement rows only. `available: false` means the durable read failed, not that the analysis is held. */
  statement?: {
    available: boolean;
    analysis: AnalysisState | null;
    documentId: number | null;
    documentHref: string | null;
    autoAnalysisEnabled: boolean | null;
  } | null;
}

export const PROCESSING_NEEDS_ATTENTION = "Processing needs attention";

const SOURCE_CLASS_LABEL: Record<string, string> = {
  sales_request: "Sales request",
  support_request: "Support request",
  fulfillment_request: "Equipment order",
  partner_application_request: "Partner application",
  privacy_request: "Privacy request",
  content_reputation: "Content and reputation",
  marketing_opt_in: "Marketing opt-in",
  imported_provider_event: "Imported provider event",
};
const SOURCE_TYPE_LABEL: Record<string, string> = {
  statement_upload: "Statement upload",
  estimate_form: "Estimate request",
  get_started_form: "Get-started request",
  equipment_inquiry: "Equipment inquiry",
  general_inquiry: "General inquiry",
  callback_form: "Callback request",
  free_analysis: "Free analysis request",
  integration_request: "Integration request",
  support_form: "Support request",
  equipment_request: "Equipment order",
  partner_application: "Partner application",
  privacy_request: "Privacy request",
};
const LIFECYCLE_LABEL: Record<string, string> = {
  claimed: "Received", processing: "Processing", accepted: "Accepted", completed: "Completed", failed: "Failed",
  cancelled: "Cancelled", review_required: "Needs review",
};
const ASSIGNMENT_LABEL: Record<string, string> = {
  assigned: "Assigned", pending: "Waiting for an owner", unassigned_policy_missing: "No owner policy", review_required: "Needs review",
};
const RECEIPT_LABEL: Record<string, string> = {
  prepared: "Receipt prepared", sent: "Receipt sent", blocked: "Receipt blocked", failed: "Receipt failed",
  suppressed: "Receipt not sent (suppressed)", pending: "Receipt waiting", sending: "Receipt sending",
};
const EFFECT_LABEL: Record<string, string> = {
  assignment: "Owner assignment", sales_work: "Review task", sales_sla: "Response deadline", statement_review: "Statement processing",
  transactional_ack: "Receipt email", ghl_projection: "GoHighLevel sync", sales_notification: "Team notification",
};

export const inboundSourceLabel = (row: Pick<InboundRequestRow, "sourceClass" | "sourceType">) =>
  SOURCE_TYPE_LABEL[row.sourceType] ?? SOURCE_CLASS_LABEL[row.sourceClass] ?? "Request";
const label = (map: Record<string, string>, key: string | null | undefined) => (key ? map[key] ?? key.replace(/_/g, " ") : "—");

function statusClass(status: string | null | undefined) {
  if (status === "accepted" || status === "completed" || status === "sent" || status === "assigned") return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "failed" || status === "cancelled" || status === "suppressed" || status === "blocked" || status === "unassigned_policy_missing") return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (status === "review_required" || status === "pending" || status === "held" || status === "prepared") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Due-today and overdue are different states: a deadline earlier today is "due today" until it has actually passed. */
function dueState(value: string | null | undefined): { text: string; tone: "overdue" | "today" | "later" | "none" } {
  if (!value) return { text: "No deadline set", tone: "none" };
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return { text: "No deadline set", tone: "none" };
  const now = new Date();
  const sameDay = due.toDateString() === now.toDateString();
  if (due.getTime() < now.getTime()) return { text: sameDay ? `Past due today — ${due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `Overdue since ${due.toLocaleDateString()}`, tone: "overdue" };
  if (sameDay) return { text: `Due today — ${due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, tone: "today" };
  return { text: `Due ${due.toLocaleDateString()}`, tone: "later" };
}
const dueToneClass = { overdue: "text-red-700 dark:text-red-400 font-medium", today: "text-amber-700 dark:text-amber-400 font-medium", later: "text-muted-foreground", none: "text-muted-foreground" } as const;

/** Admin-only: re-drive ONE retained statement that never reached a processor. Never resends the receipt. */
function StatementRecoveryAction({ requestReceipt }: { requestReceipt: string }) {
  const [message, setMessage] = useState<{ tone: "ok" | "blocked"; text: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/lead-ops/inbound-requests/${requestReceipt}/statement-recovery`, {})).json() as Promise<{ queued: boolean; queueCode: string | null }>,
    onSuccess: (result) => {
      setMessage({
        tone: result.queued ? "ok" : "blocked",
        text: result.queued
          ? "Statement handed to processing. The receipt email was not touched and no new submission was created."
          : "The file is still safely retained, but processing is not available yet. Nothing was sent.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/inbound-requests"] });
    },
    onError: (error: Error) => {
      const parsed = parseApiRequestError(error.message);
      setMessage({ tone: "blocked", text: parsed.reason ? `Not retried: ${parsed.reason}` : "Not retried. Reload the request and check its current state." });
    },
  });
  return (
    <div className="flex flex-col items-start gap-1" data-testid={`inbound-statement-recovery-${requestReceipt}`}>
      <Button size="sm" variant="outline" className="min-h-11 lg:min-h-8" disabled={mutation.isPending}
        onClick={() => { setMessage(null); mutation.mutate(); }} data-testid="button-statement-recovery">
        {mutation.isPending ? "Retrying…" : "Retry statement processing"}
      </Button>
      {message && (
        <p role="status" data-testid="text-statement-recovery-result"
          className={`max-w-[18rem] break-words text-xs ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function Links({ row }: { row: InboundRequestRow }) {
  return (
    <div className="flex flex-col items-start gap-1.5 text-sm">
      {row.work?.taskId != null && (
        <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={taskSelectionHref(row.work.taskId)} data-testid={`link-work-${row.shortRef}`}>
          Open review task{row.work.status ? ` (${row.work.status.replace(/_/g, " ")})` : ""}
        </a>
      )}
      {row.statement?.documentId != null && (
        <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={statementReviewHref(row.statement.documentId)} data-testid={`link-statement-review-${row.shortRef}`}>
          Open statement review
        </a>
      )}
      {row.contactId && <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={`/dashboard/contacts/${row.contactId}`}>Open contact</a>}
      {row.dealId && <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={`/dashboard/pipeline?id=${row.dealId}`}>Open deal</a>}
      {row.ticketId && <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={`/dashboard/tickets?id=${row.ticketId}`}>Open ticket</a>}
      {!row.work?.taskId && !row.contactId && !row.dealId && !row.ticketId && <span className="text-muted-foreground">No linked records</span>}
    </div>
  );
}

function Actions({ row, isAdmin }: { row: InboundRequestRow; isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {isAdmin && row.sourceType === "statement_upload" && row.processingNeedsAttention && <StatementRecoveryAction requestReceipt={row.requestReceipt} />}
      {row.sourceClass === "sales_request" && row.lifecycleState === "review_required" && row.contactId && (
        <InboundResumeAction requestReceipt={row.requestReceipt} reviewRevision={row.reviewRevision ?? null} />
      )}
    </div>
  );
}

function Diagnostics({ row }: { row: InboundRequestRow }) {
  return (
    <details className="text-xs" data-testid={`diagnostics-${row.shortRef}`}>
      <summary className="cursor-pointer min-h-11 lg:min-h-0 inline-flex items-center text-muted-foreground hover:text-foreground">Diagnostics</summary>
      <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="break-all"><span className="text-muted-foreground">Full receipt: </span><span className="font-mono">{row.requestReceipt}</span></div>
        <div><span className="text-muted-foreground">Source: </span>{row.sourceCategory} / {row.sourceType}</div>
        {row.terminalReason && <div className="break-words"><span className="text-muted-foreground">Reason on record: </span>{row.terminalReason}</div>}
        <div className="space-y-1">
          {row.effects.length === 0 ? <div className="text-muted-foreground">No steps reported</div> : row.effects.map((effect) => (
            <div key={effect.effectKey} className="flex flex-wrap items-center gap-1.5">
              <span>{label(EFFECT_LABEL, effect.effectKey)}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusClass(effect.state)}`}>{effect.state}</Badge>
              {effect.externalSideEffect && <span className="text-muted-foreground">(external effect)</span>}
              {effect.terminalReason && <span className="text-muted-foreground break-words">{effect.terminalReason}</span>}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function StatusBadges({ row }: { row: InboundRequestRow }) {
  const due = dueState(row.slaDueAt);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={`text-xs px-2 py-0.5 ${statusClass(row.lifecycleState)}`}>{label(LIFECYCLE_LABEL, row.lifecycleState)}</Badge>
        {row.processingNeedsAttention && (
          <Badge variant="outline" className="text-xs px-2 py-0.5 bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200" data-testid={`badge-needs-attention-${row.shortRef}`}>
            {PROCESSING_NEEDS_ATTENTION}
          </Badge>
        )}
      </div>
      <div className="text-xs">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusClass(row.assignmentStatus)}`}>{label(ASSIGNMENT_LABEL, row.assignmentStatus)}</Badge>
        {(row.assignedTo || row.assignmentReason) && <span className="ml-1.5 text-muted-foreground break-words">{row.assignedTo || row.assignmentReason}</span>}
        {!row.assignedTo && row.work?.taskId != null && (
          <div className="mt-1 text-muted-foreground" data-testid={`text-unassigned-review-${row.shortRef}`}>
            Review owner: none recorded. The review task is in the unassigned queue;{" "}
            <a className="text-blue-600 hover:underline" href={todayDestinations.unassignedTasks} data-testid={`link-unassigned-queue-${row.shortRef}`}>open the unassigned queue</a>.
          </div>
        )}
      </div>
      <div className={`text-xs ${dueToneClass[due.tone]}`}>{due.text}</div>
    </div>
  );
}

function ReceiptLine({ row }: { row: InboundRequestRow }) {
  if (!row.receipt) return <span className="text-xs text-muted-foreground">No receipt on record</span>;
  return (
    <div className="text-xs space-y-0.5">
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusClass(row.receipt.state)}`}>{label(RECEIPT_LABEL, row.receipt.state)}</Badge>
      {row.receipt.reason && <div className="text-muted-foreground break-words">{row.receipt.reason}</div>}
    </div>
  );
}

const ANALYSIS_TEXT: Record<AnalysisState, string> = {
  completed: "Analysis completed",
  queued: "Analysis queued",
  failed: "Analysis failed",
  held: "Automatic analysis held — review the statement manually",
  not_started: "Analysis not started",
  not_queued: "Analysis could not be queued — review the statement manually",
  not_recorded: "Analysis result not recorded for this statement",
};

/** What the requester told us, and where the retained file can be opened. Authorized staff only; no figures are shown. */
function RequestDetails({ row }: { row: InboundRequestRow }) {
  const inquiry = row.inquiry;
  const statement = row.statement;
  if (!inquiry && !statement) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-xs" data-testid={`request-details-${row.shortRef}`}>
      {inquiry && (
        <>
          {inquiry.intent && <div><span className="text-muted-foreground">Discuss: </span>{inquiry.intent}</div>}
          {inquiry.businessType && <div><span className="text-muted-foreground">Business type: </span>{inquiry.businessType}</div>}
          {inquiry.volumeBand && <div><span className="text-muted-foreground">Monthly card volume: </span>{inquiry.volumeBand}</div>}
          {inquiry.currentlyLeasing && <div><span className="text-muted-foreground">Currently leasing a terminal: </span>{inquiry.currentlyLeasing}</div>}
          <div className="text-muted-foreground">{inquiry.phoneProvided ? "Phone provided" : "No phone provided"}{inquiry.smsPermissionRequested ? " · text-message permission given" : ""}</div>
          {inquiry.note && <div className="break-words"><span className="text-muted-foreground">Note: </span>{inquiry.note}</div>}
        </>
      )}
      {statement && (
        statement.available ? (
          <>
            <div data-testid={`statement-analysis-${row.shortRef}`}>{statement.analysis ? ANALYSIS_TEXT[statement.analysis] : "Analysis state unavailable"}</div>
            {statement.documentHref ? (
              <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={statement.documentHref} data-testid={`link-statement-file-${row.shortRef}`}>
                Open retained statement file
              </a>
            ) : (
              <div className="text-muted-foreground">No retained file linked to this request</div>
            )}
          </>
        ) : (
          <div className="text-amber-700 dark:text-amber-400" data-testid={`statement-unavailable-${row.shortRef}`}>Statement detail is unavailable right now. Reload to try again.</div>
        )
      )}
    </div>
  );
}

function Title({ row }: { row: InboundRequestRow }) {
  return (
    <div className="min-w-0">
      <div className="font-medium break-words">{row.businessName ?? "Business name not provided"}</div>
      <div className="text-xs text-muted-foreground">{inboundSourceLabel(row)}</div>
      <div className="text-xs text-muted-foreground">Ref <span className="font-mono">{row.shortRef}</span> · {when(row.createdAt)}</div>
      <RequestDetails row={row} />
    </div>
  );
}

export function InboundRequestList({ requests, isLoading, isAdmin }: { requests: InboundRequestRow[]; isLoading: boolean; isAdmin: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" data-testid="inbound-loading">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }
  if (requests.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid="inbound-empty">No inbound requests match the current filters.</div>;
  }
  return (
    <>
      {/* Narrow screens: one readable card per request, no sideways scrolling. */}
      <div className="lg:hidden divide-y" data-testid="inbound-cards">
        {requests.map((row) => (
          <article key={row.requestReceipt} className="space-y-3 p-4" data-testid={`inbound-card-${row.shortRef}`}>
            <Title row={row} />
            <StatusBadges row={row} />
            <ReceiptLine row={row} />
            <Links row={row} />
            <Actions row={row} isAdmin={isAdmin} />
            <Diagnostics row={row} />
          </article>
        ))}
      </div>

      {/* Wide screens: compact table; technical detail stays behind Diagnostics. */}
      <div className="crm-dense-worklist hidden lg:block" data-testid="inbound-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request</TableHead>
              <TableHead>Status and deadline</TableHead>
              <TableHead>Receipt email</TableHead>
              <TableHead>Open</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((row) => (
              <TableRow key={row.requestReceipt} data-testid={`inbound-row-${row.shortRef}`} className="align-top">
                <TableCell className="max-w-[18rem]"><Title row={row} /><div className="mt-2"><Diagnostics row={row} /></div></TableCell>
                <TableCell><StatusBadges row={row} /></TableCell>
                <TableCell><ReceiptLine row={row} /></TableCell>
                <TableCell><Links row={row} /></TableCell>
                <TableCell><Actions row={row} isAdmin={isAdmin} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
