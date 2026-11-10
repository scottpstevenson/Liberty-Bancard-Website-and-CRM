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

/**
 * `not_queued`: this upload's own attempt to queue analysis failed (the occurrence needs a person, and it was never queued).
 * `not_recorded`: no durable evidence ties any analysis result to this upload, so none is claimed in either direction.
 */
export type AnalysisState = "completed" | "queued" | "failed" | "held" | "not_started" | "not_queued" | "not_recorded";

/** What the upload chain's own analysis step (step 5) recorded for one occurrence. */
export type AnalysisStepOutcome = "none" | "held" | "queued" | "failed";

/** Step 5 is the analysis step: held on purpose, queued (done), or failed to queue. Anything else recorded is "none". */
export function analysisStepOutcome(steps: readonly StoredChainStep[] | null | undefined): AnalysisStepOutcome {
  const step = steps?.find((candidate) => candidate.step === 5);
  if (!step) return "none";
  if (step.state === "held") return "held";
  if (step.state === "failed") return "failed";
  return "queued";
}

/** What the structured statement analyzer durably recorded for one retained document. */
export type AnalysisDocumentOutcome = "completed" | "failed" | "none";

export interface AnalysisEvidence {
  dealId: number | null;
  /** The deal's single, last-writer-wins analysis status. It describes this upload only through `ownsDealStatus`. */
  analysisStatus: string | null | undefined;
  autoAnalysisEnabled: boolean;
  /** What this occurrence's own command recorded for the analysis step. */
  ownStep: AnalysisStepOutcome;
  /** This occurrence's queue attempt is the newest one on its deal that wrote the deal's analysis status. */
  ownsDealStatus: boolean;
  /**
   * The newest durable structured-analysis record that names this occurrence's own retained document: `completed` (the analyzer
   * recorded a result for that document), `failed` (the analyzer recorded a failure for that document) or `none`. The deal's
   * status can never produce `completed`: it is also set when only the deal blueprint finished.
   */
  documentOutcome: AnalysisDocumentOutcome;
  /** The command finished but stored no steps (rows from before steps were recorded), so nothing ties analysis to it. */
  finishedWithoutSteps: boolean;
}

/**
 * Analysis truth for ONE occurrence, from its own durable evidence. The deal's analysis status is shared by every upload
 * on that deal, so it is read as this occurrence's status only when this occurrence queued the work and no later queue
 * attempt has taken the status over; a held or never-queued upload is never reported through an older upload's result,
 * and a failed enqueue is never reported as queued. With no deal there is nothing to analyse automatically.
 *
 * The deal status is set to complete when the deal BLUEPRINT finishes, before the structured statement analysis runs, and a
 * structured-analysis failure does not revert it. So it can say that work is queued or has failed, but it can never say that
 * this statement's analysis completed: only a result record naming this occurrence's own document can.
 */
export function deriveAnalysisState(input: AnalysisEvidence): AnalysisState {
  if (!input.dealId) return "held";
  if (input.documentOutcome === "completed") return "completed";
  if (input.documentOutcome === "failed") return "failed";
  switch (input.ownStep) {
    case "held":
      return "held";
    case "failed":
      return "not_queued";
    case "queued": {
      if (!input.ownsDealStatus) return "not_recorded";
      switch (input.analysisStatus) {
        case "pending":
        case "processing":
          return "queued";
        case "failed":
          return "failed";
        // "complete" is the blueprint's status, not a statement result: no completion is claimed without a document-bound record.
        default:
          return "not_recorded";
      }
    }
    default:
      if (input.finishedWithoutSteps) return "not_recorded";
      return input.autoAnalysisEnabled ? "not_started" : "held";
  }
}

export const ANALYSIS_LABEL: Record<AnalysisState, string> = {
  completed: "Analysis completed",
  queued: "Analysis queued",
  failed: "Analysis failed",
  held: "Automatic analysis held — manual review",
  not_started: "Analysis not started",
  not_queued: "Analysis could not be queued — manual review",
  not_recorded: "Analysis result not recorded for this statement",
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
