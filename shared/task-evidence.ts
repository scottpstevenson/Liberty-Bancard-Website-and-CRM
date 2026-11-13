/**
 * Read-only evidence a work task can show about the website request that created it.
 *
 * The server resolves the evidence from RECORDED relationships only: `inbound_request_work_links` (request -> task) and
 * the statement upload command that recorded the retained document. A reference that happens to appear in a task's
 * description, or a name/email/time match, is never used and never authorizes anything. Every destination this
 * evidence points at (website request, statement review, contact) still authorizes its own record when it is opened.
 */
import type { AnalysisState } from "./statement-chain-state";

export const TASK_EVIDENCE_STATES = ["none_recorded", "linked", "ambiguous", "mismatch", "restricted"] as const;
export type TaskEvidenceState = typeof TASK_EVIDENCE_STATES[number];

export type TaskEvidenceFileState = "retained" | "none_recorded" | "missing" | "unavailable";
export type TaskEvidenceReviewState = "present" | "none" | "ambiguous" | "unavailable";

export interface TaskEvidenceRequest {
  requestReceipt: string;
  shortRef: string;
  sourceType: string;
  lifecycleState: string;
  createdAt: string;
  contactId: number | null;
}

export interface TaskEvidenceFile {
  state: TaskEvidenceFileState;
  documentId: number | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  review: { state: TaskEvidenceReviewState; reviewId: number | null; status: string | null };
  /** The held/queued/failed truth of the automatic analysis; never "completed" unless durable evidence names this document. */
  analysis: AnalysisState | null;
}

export interface TaskEvidence {
  taskId: number;
  state: TaskEvidenceState;
  request: TaskEvidenceRequest | null;
  /** Only statement-upload requests carry a retained file. Null means the request has no file. */
  file: TaskEvidenceFile | null;
  /** Plain reason for every state except `linked`. */
  reason: string | null;
}

const INT_MAX = 2147483647;
const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= INT_MAX;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict response check: an unexpected shape is "unavailable", never a guessed link. */
export function parseTaskEvidence(raw: unknown, expectedTaskId: number): TaskEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<TaskEvidence>;
  if (value.taskId !== expectedTaskId) return null;
  if (!TASK_EVIDENCE_STATES.includes(value.state as TaskEvidenceState)) return null;
  const request = value.request ?? null;
  if (value.state === "linked") {
    if (!request || typeof request !== "object") return null;
    if (typeof request.requestReceipt !== "string" || !UUID.test(request.requestReceipt)) return null;
    if (typeof request.shortRef !== "string" || !/^[0-9A-F]{4,8}$/.test(request.shortRef)) return null;
  } else if (request !== null) {
    return null;
  }
  const file = value.file ?? null;
  if (file !== null) {
    if (typeof file !== "object" || !["retained", "none_recorded", "missing", "unavailable"].includes(file.state)) return null;
    if (file.documentId !== null && !isId(file.documentId)) return null;
    if (!file.review || !["present", "none", "ambiguous", "unavailable"].includes(file.review.state)) return null;
    if (file.review.reviewId !== null && !isId(file.review.reviewId)) return null;
  }
  return {
    taskId: expectedTaskId,
    state: value.state as TaskEvidenceState,
    request: request as TaskEvidenceRequest | null,
    file: file as TaskEvidenceFile | null,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

export interface TaskEvidenceAction { kind: "request" | "review"; label: string; href: string }

const WORK_RETURN = /^\/dashboard\/tasks-appointments(?:\?[A-Za-z0-9_%=&.,:+~-]{0,1500})?$/;
/** The Work list URL (with its filters) that a destination may offer as "Back to Work". Anything else is dropped. */
export function safeWorkReturn(url: string | null | undefined): string | null {
  return typeof url === "string" && WORK_RETURN.test(url) ? url : null;
}

/** Appends the safe Work return as `from` so it survives reload and the browser Back button. */
export function withWorkReturn(href: string, workReturn: string | null): string {
  const safe = safeWorkReturn(workReturn);
  if (!safe) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("from", safe);
  return `${path}?${params.toString()}`;
}

/**
 * Actions the evidence authorizes the operator to attempt. Only recorded identities become links; a held, missing
 * or ambiguous state produces no link, and the panel says why instead.
 */
export function taskEvidenceActions(evidence: TaskEvidence, workReturn: string | null): TaskEvidenceAction[] {
  if (evidence.state !== "linked" || !evidence.request) return [];
  const actions: TaskEvidenceAction[] = [{
    kind: "request", label: `Open request ${evidence.request.shortRef}`,
    href: withWorkReturn(`/dashboard/lead-ops?tab=pipeline&ref=${evidence.request.shortRef}`, workReturn),
  }];
  const review = evidence.file?.review;
  if (evidence.file?.state === "retained" && evidence.file.documentId && review?.state === "present") {
    actions.push({
      kind: "review", label: `Open statement review for file #${evidence.file.documentId}`,
      href: withWorkReturn(`/dashboard/statement-review?documentId=${evidence.file.documentId}`, workReturn),
    });
  }
  return actions;
}

/** One plain sentence per non-linked state and per file state, so an operator is never left with a blank. */
export function taskEvidenceNotice(evidence: TaskEvidence): string | null {
  switch (evidence.state) {
    case "none_recorded": return "No website request is recorded for this task.";
    case "ambiguous": return "More than one website request is recorded for this task, so none is opened automatically.";
    case "mismatch": return "The recorded request belongs to a different contact than this task, so no request or file is shown.";
    case "restricted": return "Request and file details are available to administrators and managers.";
    case "linked": break;
  }
  const file = evidence.file;
  if (!file) return null;
  if (file.state === "unavailable") return "The retained file details could not be read. Retry, or open the request.";
  if (file.state === "missing") return "A retained file is recorded for this request, but its record is missing.";
  if (file.state === "none_recorded") return "No retained file is recorded for this request.";
  if (file.review.state === "none") return "The file is retained and no analyst review exists for it yet.";
  if (file.review.state === "ambiguous") return "More than one analyst review exists for this file, so none is opened automatically.";
  if (file.review.state === "unavailable") return "The analyst review lookup could not be read. Retry.";
  return null;
}
