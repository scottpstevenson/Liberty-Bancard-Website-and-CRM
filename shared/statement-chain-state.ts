/**
 * Operator-facing truth for a retained statement occurrence. Pure and dependency-free so the server read model and the
 * browser panel normalise a step the same way.
 *
 * The upload chain records a step as `success: true` even when it was deliberately held (analysis, follow-up sequence)
 * or only handed to a worker (provider projection). Those are not completed work, so they are classified separately and
 * never count toward "done".
 */

export type ChainStepState = "done" | "held" | "handed_off" | "failed";

export interface StoredChainStep {
  step: number;
  name: string;
  state: ChainStepState;
  /** Sanitised, bounded operator text. Never provider output, a file name or a financial figure. */
  detail?: string;
}

export interface RawChainStep {
  step: number;
  name: string;
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

const DETAIL_MAX = 160;

/** Bounded, single-line, secret-shaped-text-free detail for an operator view. */
export function sanitizeChainDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
    .trim();
  return cleaned ? cleaned.slice(0, DETAIL_MAX) : undefined;
}

export function classifyChainStep(step: Pick<RawChainStep, "success" | "data">): ChainStepState {
  if (!step.success) return "failed";
  const data = step.data ?? {};
  if (data.state === "held" || data.enrollmentStatus === "held") return "held";
  if (data.state === "handed_off" || data.providerComplete === false) return "handed_off";
  return "done";
}

/** The shape stored on the statement command result. */
export function toStoredChainSteps(steps: readonly RawChainStep[]): StoredChainStep[] {
  return steps.map((step) => {
    const state = classifyChainStep(step);
    const reason = typeof step.data?.reason === "string" ? step.data.reason : undefined;
    return {
      step: step.step,
      name: step.name,
      state,
      ...(state === "failed" ? { detail: sanitizeChainDetail(step.error) } : reason ? { detail: sanitizeChainDetail(reason) } : {}),
    };
  });
}

export type AnalysisState = "completed" | "queued" | "failed" | "held" | "not_started";

/**
 * Analysis truth from durable state only: the deal's recorded analysis status and the owner setting. No deal means
 * there is nothing to analyse automatically, and an unset or false setting means automatic analysis is held.
 */
export function deriveAnalysisState(input: { dealId: number | null; analysisStatus: string | null | undefined; autoAnalysisEnabled: boolean }): AnalysisState {
  if (!input.dealId) return "held";
  switch (input.analysisStatus) {
    case "complete":
    case "completed":
      return "completed";
    case "pending":
    case "processing":
      return "queued";
    case "failed":
      return "failed";
    default:
      return input.autoAnalysisEnabled ? "not_started" : "held";
  }
}

export const ANALYSIS_LABEL: Record<AnalysisState, string> = {
  completed: "Analysis completed",
  queued: "Analysis queued",
  failed: "Analysis failed",
  held: "Automatic analysis held — manual review",
  not_started: "Analysis not started",
};

export type OccurrenceStatus = "in_progress" | "needs_attention" | "manual_review" | "held" | "complete" | "unrecorded";

/**
 * One overall status per occurrence. A deferred handoff or any failed step needs a person; held steps are a normal,
 * truthful state, not success; a command that has not finished is in progress; an occurrence with no recorded steps
 * (older rows) is "unrecorded", never "complete".
 */
export function deriveOccurrenceStatus(input: {
  lifecycleState: string;
  terminalReason: string | null;
  commandStatus: string | null;
  steps: readonly StoredChainStep[] | null;
}): OccurrenceStatus {
  if (input.lifecycleState === "review_required" && (input.terminalReason ?? "").startsWith("STATEMENT_PROCESSING_DEFERRED")) return "manual_review";
  if (input.lifecycleState === "failed") return "needs_attention";
  if (input.steps?.some((step) => step.state === "failed") || input.commandStatus === "recoverable_failed") return "needs_attention";
  if (input.commandStatus === "in_progress" || !input.commandStatus || input.lifecycleState === "claimed" || input.lifecycleState === "processing") return "in_progress";
  if (!input.steps || input.steps.length === 0) return "unrecorded";
  if (input.steps.some((step) => step.state === "held" || step.state === "handed_off")) return "held";
  return "complete";
}

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  in_progress: "In progress",
  needs_attention: "Needs attention",
  manual_review: "Manual review",
  held: "Saved — some steps held",
  complete: "All steps done",
  unrecorded: "Step detail not recorded",
};

export const CHAIN_STEP_LABEL: Record<string, string> = {
  "File attached": "File retained",
  "AI analysis held": "Analysis (held)",
  "AI analysis queued": "Analysis (queued)",
  "Rep notified": "Team notified",
  "Projection handoff recorded": "GoHighLevel sync handoff",
  "Pipeline stage set": "Pipeline stage",
  "Pipeline stage verified": "Pipeline stage",
  "Proposal draft created": "Proposal draft",
  "Follow-up sequence held": "Follow-up sequence (held)",
};

export interface StatementChainRow {
  requestReceipt: string;
  shortRef: string;
  occurredAt: string;
  businessName: string | null;
  contactId: number | null;
  dealId: number | null;
  documentId: number | null;
  lifecycleState: string;
  commandStatus: string | null;
  status: OccurrenceStatus;
  analysis: AnalysisState;
  steps: StoredChainStep[];
  diagnostics: { terminalReason: string | null };
}

export interface StatementChainResponse {
  asOf: string;
  scope: { kind: "latest_occurrences"; limit: number; failuresOnly: boolean; returned: number; needsAttention: number };
  autoAnalysisEnabled: boolean;
  rows: StatementChainRow[];
}
