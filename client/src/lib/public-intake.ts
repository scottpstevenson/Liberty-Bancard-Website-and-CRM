import { apiRequest } from "@/lib/queryClient";

/**
 * Shared, typed handling of the public sales-form responses (estimate, get-started, callback).
 *
 * The server answers with one of:
 *  - 201 / 200 { success:true, requestReceipt, status }       saved (status review_required = saved, not yet assigned);
 *    `emailConsent` (recorded | not_recorded | unavailable) appears only when the visitor checked the email-updates box
 *  - 202 { success:false, recoverable:true, requestReceipt }  saved in part; the SAME request completes on a same-key retry
 *  - 400                                                      real validation failure, nothing saved
 * `apiRequest` only throws for non-2xx, so a 202 and an unreadable 2xx body must be classified here. An unreadable or
 * truncated body is never treated as success and never starts a new intent: the same key is kept for the retry.
 */
export type IntakeForm = "estimate" | "get_started" | "callback_home" | "callback_bubble" | "callback_help" | "statement_upload";

export type IntakeOutcome =
  | { kind: "saved"; receipt: string; pendingReview: boolean; emailConsent?: "recorded" | "not_recorded" | "unavailable" }
  | { kind: "recoverable"; receipt: string }
  | { kind: "unresolved"; receipt: string | null; reason: "unreadable" | "network" | "server" | "in_progress" | "rate_limited" }
  | { kind: "rejected"; message: string };

interface StoredIntent {
  key: string;
  fingerprint: string;
  receipt: string | null;
  state: "pending" | "unresolved" | "recoverable" | "saved";
}

const STORAGE_PREFIX = "lb:public-intake:";

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function loadIntent(form: IntakeForm): StoredIntent | null {
  const raw = storage()?.getItem(STORAGE_PREFIX + form);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredIntent;
    return typeof value.key === "string" && typeof value.fingerprint === "string" ? value : null;
  } catch { return null; }
}

function saveIntent(form: IntakeForm, intent: StoredIntent) {
  try { storage()?.setItem(STORAGE_PREFIX + form, JSON.stringify(intent)); } catch { /* private mode: in-memory retry still works for this page */ }
}

export function clearIntent(form: IntakeForm) {
  try { storage()?.removeItem(STORAGE_PREFIX + form); } catch { /* nothing stored */ }
}

async function fingerprintPayload(payload: unknown): Promise<string> {
  const text = JSON.stringify(payload);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `weak-${hash}-${text.length}`;
}

/** Reuse the unresolved intent's key only for the identical payload; any edit is a different intent. */
async function intentFor(form: IntakeForm, payload: unknown): Promise<StoredIntent> {
  const fingerprint = await fingerprintPayload(payload);
  const existing = loadIntent(form);
  if (existing && existing.fingerprint === fingerprint) return existing;
  const fresh: StoredIntent = { key: crypto.randomUUID(), fingerprint, receipt: null, state: "pending" };
  saveIntent(form, fresh);
  return fresh;
}

/** Classify a 2xx response. Anything that is not a readable, receipt-bearing body is unresolved. */
export async function readIntakeOutcome(res: Response): Promise<IntakeOutcome> {
  let body: any;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { kind: "unresolved", receipt: null, reason: "unreadable" };
  }
  const receipt = typeof body?.requestReceipt === "string" && body.requestReceipt ? body.requestReceipt : null;
  if (!receipt) return { kind: "unresolved", receipt: null, reason: "unreadable" };
  if (res.status === 202 || body.recoverable === true) return { kind: "recoverable", receipt };
  if (body.success !== true) return { kind: "unresolved", receipt, reason: "unreadable" };
  if (body.status === "failed" || body.status === "cancelled") return { kind: "rejected", message: "We could not save that request. Please try again." };
  if (body.status === "claimed" || body.status === "processing") return { kind: "unresolved", receipt, reason: "in_progress" };
  const emailConsent = ["recorded", "not_recorded", "unavailable"].includes(body.emailConsent) ? body.emailConsent : undefined;
  return { kind: "saved", receipt, pendingReview: body.status === "review_required", emailConsent };
}

/** Submit one intent. Never throws: every outcome is typed so the caller cannot show a false success. */
export async function submitPublicIntake(form: IntakeForm, path: string, payload: Record<string, unknown>): Promise<IntakeOutcome> {
  const intent = await intentFor(form, payload);
  let outcome: IntakeOutcome;
  try {
    const res = await apiRequest("POST", path, payload, { "Idempotency-Key": intent.key });
    outcome = await readIntakeOutcome(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /^(\d{3}):/.exec(message)?.[1];
    if (status === "400" || status === "409" || status === "404") {
      // The server refused the intent before saving anything: the next edit is a new intent.
      clearIntent(form);
      return { kind: "rejected", message: status === "400" ? "Please check your details and try again." : "That request could not be matched. Please try again." };
    }
    if (status === "429") outcome = { kind: "unresolved", receipt: intent.receipt, reason: "rate_limited" };
    else outcome = { kind: "unresolved", receipt: intent.receipt, reason: status ? "server" : "network" };
  }
  if (outcome.kind === "saved" || outcome.kind === "rejected") clearIntent(form);
  else if (outcome.kind === "recoverable") saveIntent(form, { ...intent, receipt: outcome.receipt, state: "recoverable" });
  else saveIntent(form, { ...intent, receipt: outcome.receipt ?? intent.receipt, state: "unresolved" });
  return outcome;
}

/**
 * Read-only check of a saved request. Needs the original idempotency key (kept in this browser session) and the original
 * caller scope. Returns null when the capability cannot be verified.
 */
export async function checkIntakeStatus(form: IntakeForm): Promise<{ saved: boolean; recoverable: boolean; status: string } | null> {
  const intent = loadIntent(form);
  if (!intent?.receipt) return null;
  try {
    const res = await apiRequest("GET", `/api/public/inbound-requests/${encodeURIComponent(intent.receipt)}/status`, undefined, { "Idempotency-Key": intent.key });
    const body = JSON.parse(await res.text());
    if (typeof body?.status !== "string") return null;
    const recoverable = body.recoverable === true;
    const saved = !recoverable && ["accepted", "completed", "review_required"].includes(body.status);
    if (saved) clearIntent(form);
    return { saved, recoverable, status: body.status };
  } catch {
    return null;
  }
}

// ── Statement upload ────────────────────────────────────────────────────────
//
// The statement form is a multipart upload, so it cannot use `apiRequest` (JSON only). It keeps the same discipline:
// one stable idempotency key per logical submission (held in sessionStorage next to the receipt, never the submitted
// details, the file name or any figure), typed outcomes, and no success message unless the server returned a readable,
// receipt-bearing body. Progress shown to the visitor is real bytes sent; nothing is simulated.

export type StatementRejection = "file_required" | "file_too_large" | "file_type_unsupported" | "changed_request" | "invalid";

export type StatementOutcome =
  | { kind: "saved"; receipt: string; reference: string; processing: "queued" | "deferred" }
  | { kind: "unresolved"; receipt: string | null; reason: "unreadable" | "network" | "server" | "in_progress" | "rate_limited" | "failed" }
  | { kind: "rejected"; code: StatementRejection; message: string };

export const STATEMENT_REJECTION_COPY: Record<StatementRejection, string> = {
  file_required: "Choose a statement file to upload.",
  file_too_large: "That file is larger than 10 MB. Upload a smaller PDF, JPG or PNG.",
  file_type_unsupported: "Upload your statement as a PDF, JPG or PNG.",
  changed_request: "Those details changed since the last attempt. Please submit again.",
  invalid: "Please check your details and try again.",
};

const STATEMENT_SERVER_CODES: Record<string, StatementRejection> = {
  STATEMENT_FILE_REQUIRED: "file_required",
  STATEMENT_FILE_TOO_LARGE: "file_too_large",
  STATEMENT_FILE_TYPE_UNSUPPORTED: "file_type_unsupported",
  IDEMPOTENCY_KEY_CONFLICT: "changed_request",
};

/**
 * Classify one statement-upload HTTP response. Pure: no network, storage or DOM. A 2xx is "saved" only with a readable
 * body carrying the request receipt, its reference and the processing state; anything else is unresolved so the SAME
 * key is retried, never a new intent and never an invented success.
 */
export function classifyStatementResponse(status: number, bodyText: string): StatementOutcome {
  let body: any = null;
  try { body = JSON.parse(bodyText); } catch { body = null; }
  if (status >= 200 && status < 300) {
    const receipt = typeof body?.requestReceipt === "string" && body.requestReceipt ? body.requestReceipt : null;
    if (!receipt || body?.success !== true) return { kind: "unresolved", receipt, reason: "unreadable" };
    if (body.status === "failed" || body.status === "cancelled") return { kind: "unresolved", receipt, reason: "failed" };
    if (body.status === "claimed") return { kind: "unresolved", receipt, reason: "in_progress" };
    const reference = typeof body.reference === "string" && body.reference ? body.reference : null;
    const processing = body.statementProcessing === "deferred" ? "deferred" : body.statementProcessing === "queued" ? "queued" : null;
    // A 2xx that does not say what happened to the file is not proof the file was received.
    if (!reference || !processing) return { kind: "unresolved", receipt, reason: "unreadable" };
    return { kind: "saved", receipt, reference, processing };
  }
  const serverCode = typeof body?.error === "string" ? body.error : null;
  const mapped = serverCode ? STATEMENT_SERVER_CODES[serverCode] : undefined;
  if (mapped) return { kind: "rejected", code: mapped, message: STATEMENT_REJECTION_COPY[mapped] };
  if (status === 413) return { kind: "rejected", code: "file_too_large", message: STATEMENT_REJECTION_COPY.file_too_large };
  if (status === 415) return { kind: "rejected", code: "file_type_unsupported", message: STATEMENT_REJECTION_COPY.file_type_unsupported };
  if (status === 409) return { kind: "rejected", code: "changed_request", message: STATEMENT_REJECTION_COPY.changed_request };
  if (status === 400) return { kind: "rejected", code: "invalid", message: STATEMENT_REJECTION_COPY.invalid };
  if (status === 429) return { kind: "unresolved", receipt: null, reason: "rate_limited" };
  if (status === 422) return { kind: "unresolved", receipt: null, reason: "failed" };
  return { kind: "unresolved", receipt: null, reason: "server" };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // No SubtleCrypto (insecure context): size plus a sampled checksum still distinguishes a different file.
  const view = new Uint8Array(bytes);
  let hash = 5381;
  const step = Math.max(1, Math.floor(view.length / 4096));
  for (let i = 0; i < view.length; i += step) hash = ((hash << 5) + hash + view[i]) | 0;
  return `weak-${hash}-${view.length}`;
}

/**
 * Fingerprint of everything the visitor submitted, including the file CONTENT (a hash, never the bytes). It covers at
 * least what the server fingerprints (email, mobile, business, source metadata, file bytes), so a different file or a
 * corrected address is a different intent with a fresh key, while a retry of the identical submission reuses the key.
 */
export async function statementFingerprint(fields: Record<string, string>, file: { arrayBuffer: () => Promise<ArrayBuffer> } | null): Promise<string> {
  const normalized: Record<string, string> = {};
  for (const k of Object.keys(fields).sort()) normalized[k] = (fields[k] ?? "").trim();
  if (normalized.email) normalized.email = normalized.email.toLowerCase();
  if (normalized.businessName) normalized.businessName = normalized.businessName.toLowerCase();
  const fileHash = file ? await sha256Hex(await file.arrayBuffer()) : "none";
  return fingerprintPayload({ fields: normalized, fileHash });
}

export interface StatementIntent extends StoredIntent {
  /** Present once the server confirmed receipt; the reference the visitor was shown. */
  reference?: string | null;
  processing?: "queued" | "deferred" | null;
  tracked?: boolean;
}

export function loadStatementIntent(): StatementIntent | null {
  return loadIntent("statement_upload") as StatementIntent | null;
}

export function saveStatementIntent(intent: StatementIntent) { saveIntent("statement_upload", intent); }

export function clearStatementIntent() { clearIntent("statement_upload"); }

/** Reuse the stored key for an identical submission (retry, replay after reload); otherwise mint a new one. */
export async function statementIntentFor(fingerprint: string): Promise<StatementIntent> {
  const existing = loadStatementIntent();
  if (existing && existing.fingerprint === fingerprint) return existing;
  const fresh: StatementIntent = { key: crypto.randomUUID(), fingerprint, receipt: null, state: "pending" };
  saveStatementIntent(fresh);
  return fresh;
}

/** Record the outcome against the stored intent so a reload can show the truth (receipt, reference, processing state only). */
export function recordStatementOutcome(intent: StatementIntent, outcome: StatementOutcome): void {
  if (outcome.kind === "rejected") { clearStatementIntent(); return; }
  if (outcome.kind === "saved") {
    saveStatementIntent({ ...intent, receipt: outcome.receipt, reference: outcome.reference, processing: outcome.processing, state: "saved" });
    return;
  }
  saveStatementIntent({ ...intent, receipt: outcome.receipt ?? intent.receipt, state: "unresolved" });
}

/** Analytics are claimed exactly once per confirmed receipt, across replays and reloads of the same session. */
export function claimStatementAnalytics(receipt: string): boolean {
  const intent = loadStatementIntent();
  if (!intent || intent.receipt !== receipt || intent.tracked) return false;
  saveStatementIntent({ ...intent, tracked: true });
  return true;
}

/** Send the multipart body with real byte progress. Resolves with the raw status/text, or null on a network failure. */
export function sendStatementUpload(formData: FormData, key: string, onProgress: (percent: number) => void): Promise<{ status: number; text: string } | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open("POST", "/api/public/statement-upload");
    xhr.setRequestHeader("Idempotency-Key", key);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener("load", () => resolve({ status: xhr.status, text: xhr.responseText }));
    xhr.addEventListener("error", () => resolve(null));
    xhr.addEventListener("abort", () => resolve(null));
    xhr.addEventListener("timeout", () => resolve(null));
    xhr.send(formData);
  });
}

/** Read-only check of a saved statement request (original key + caller scope required). Null when it cannot be verified. */
export async function checkStatementStatus(): Promise<{ saved: boolean; recoverable: boolean; status: string } | null> {
  const intent = loadStatementIntent();
  if (!intent?.receipt) return null;
  try {
    const res = await apiRequest("GET", `/api/public/inbound-requests/${encodeURIComponent(intent.receipt)}/status`, undefined, { "Idempotency-Key": intent.key });
    const body = JSON.parse(await res.text());
    if (typeof body?.status !== "string") return null;
    const recoverable = body.recoverable === true;
    return { saved: !recoverable && ["accepted", "completed", "review_required", "processing"].includes(body.status), recoverable, status: body.status };
  } catch {
    return null;
  }
}
