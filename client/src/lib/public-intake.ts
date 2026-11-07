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
export type IntakeForm = "estimate" | "get_started" | "callback_home" | "callback_bubble" | "callback_help";

export type IntakeOutcome =
  | { kind: "saved"; receipt: string; pendingReview: boolean; emailConsent?: "recorded" | "not_recorded" | "unavailable" }
  | { kind: "recoverable"; receipt: string }
  | { kind: "unresolved"; receipt: string | null; reason: "unreadable" | "network" | "server" | "in_progress" | "rate_limited" }
  | { kind: "rejected"; message: string };

interface StoredIntent {
  key: string;
  fingerprint: string;
  receipt: string | null;
  state: "pending" | "unresolved" | "recoverable";
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
