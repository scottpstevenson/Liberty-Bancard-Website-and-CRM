import { useCallback, useEffect, useState } from "react";
import {
  checkIntakeStatus, checkStatementStatus, claimStatementAnalytics, classifyStatementResponse, clearIntent,
  clearStatementIntent, loadIntent, loadStatementIntent, recordStatementOutcome, saveStatementIntent, sendStatementUpload,
  statementFingerprint, statementIntentFor, submitPublicIntake,
  type IntakeForm, type IntakeOutcome, type StatementOutcome, type StatementRejection,
} from "@/lib/public-intake";

export type PublicIntakeState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "saved"; receipt: string; pendingReview: boolean }
  | { phase: "recoverable"; receipt: string; restored: boolean }
  | { phase: "unresolved"; receipt: string | null; restored: boolean; reason: string }
  | { phase: "rejected"; message: string; fieldErrors?: Record<string, string> };

/**
 * One public sales-form intent. Restores an unresolved/recoverable intent after a reload (key + receipt only, never the
 * submitted details), submits through the shared typed parser, and offers a read-only status check.
 */
export function usePublicIntake(form: IntakeForm, path: string) {
  const [state, setState] = useState<PublicIntakeState>({ phase: "idle" });
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadIntent(form);
    if (!stored) return;
    if (stored.state === "saved" && stored.receipt) setState({ phase: "saved", receipt: stored.receipt, pendingReview: false });
    else if (stored.state === "recoverable" && stored.receipt) setState({ phase: "recoverable", receipt: stored.receipt, restored: true });
    // A request that was in flight when the page went away (pending) is as ambiguous as an unresolved one: never silently dropped.
    else if (stored.state === "unresolved" || stored.state === "pending") setState({ phase: "unresolved", receipt: stored.receipt, restored: true, reason: "restored" });
  }, [form]);

  const apply = useCallback((outcome: IntakeOutcome): IntakeOutcome => {
    if (outcome.kind === "saved") setState({ phase: "saved", receipt: outcome.receipt, pendingReview: outcome.pendingReview });
    else if (outcome.kind === "recoverable") setState({ phase: "recoverable", receipt: outcome.receipt, restored: false });
    else if (outcome.kind === "unresolved") setState({ phase: "unresolved", receipt: outcome.receipt, restored: false, reason: outcome.reason });
    else setState({ phase: "rejected", message: outcome.message, fieldErrors: outcome.fieldErrors });
    return outcome;
  }, []);

  const submit = useCallback(async (payload: Record<string, unknown>) => {
    setCheckNote(null);
    setState({ phase: "submitting" });
    return apply(await submitPublicIntake(form, path, payload));
  }, [apply, form, path]);

  const check = useCallback(async () => {
    setChecking(true);
    setCheckNote(null);
    const result = await checkIntakeStatus(form);
    setChecking(false);
    if (!result) { setCheckNote("We couldn't read the status from this browser session. Try again, or call us."); return null; }
    // The verified receipt comes back with the result; storage is never read after the status read.
    if (result.saved) setState({ phase: "saved", receipt: result.receipt, pendingReview: result.status === "review_required" });
    else setCheckNote("Still pending. Your details are saved; nothing needs to be re-entered.");
    return result;
  }, [form]);

  const dismiss = useCallback(() => { clearIntent(form); setCheckNote(null); setState({ phase: "idle" }); }, [form]);

  /** Leave the saved view (e.g. closing a widget) without discarding an unresolved intent. */
  const acknowledgeSaved = useCallback(() => {
    if (loadIntent(form)?.state === "saved") clearIntent(form);
    setState((current) => (current.phase === "saved" ? { phase: "idle" } : current));
  }, [form]);

  return { state, submit, check, dismiss, acknowledgeSaved, checking, checkNote, submitting: state.phase === "submitting" };
}

export type StatementUploadState =
  | { phase: "idle" }
  /** Bytes are leaving the browser; `percent` is real transfer progress. */
  | { phase: "uploading"; percent: number }
  /** Every byte was sent; waiting for the server to say what it recorded. No steps are implied. */
  | { phase: "confirming" }
  | { phase: "saved"; receipt: string; reference: string; processing: "queued" | "deferred"; restored: boolean; fresh: boolean }
  | { phase: "unresolved"; receipt: string | null; reason: string; restored: boolean }
  | { phase: "rejected"; code: StatementRejection; message: string };

/**
 * One public statement-upload intent. The idempotency key lives in sessionStorage with the receipt and reference only
 * (never the details, file name or contents), so a reload restores the real state and a retry of the identical
 * submission can never create a second occurrence. `fresh` is true only for the response that first confirmed receipt,
 * which is when analytics fire (once per receipt).
 */
export function usePublicStatementUpload() {
  const [state, setState] = useState<StatementUploadState>({ phase: "idle" });
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStatementIntent();
    if (!stored) return;
    if (stored.state === "saved" && stored.receipt && stored.reference && stored.processing) {
      setState({ phase: "saved", receipt: stored.receipt, reference: stored.reference, processing: stored.processing, restored: true, fresh: false });
    } else if (stored.state === "unresolved" || stored.state === "pending") {
      // A "pending" intent is written before the bytes leave the browser, so a reload during the transfer, or while the
      // response is awaited, leaves exactly this. The server may or may not have recorded it: it is restored as
      // unconfirmed, with its original key and any receipt, never discarded and never given a fresh key.
      setState({ phase: "unresolved", receipt: stored.receipt, reason: "restored", restored: true });
    }
  }, []);

  const apply = useCallback((outcome: StatementOutcome): StatementOutcome => {
    if (outcome.kind === "saved") {
      setState({ phase: "saved", receipt: outcome.receipt, reference: outcome.reference, processing: outcome.processing, restored: false, fresh: claimStatementAnalytics(outcome.receipt) });
    } else if (outcome.kind === "unresolved") {
      setState({ phase: "unresolved", receipt: outcome.receipt, reason: outcome.reason, restored: false });
    } else {
      setState({ phase: "rejected", code: outcome.code, message: outcome.message });
    }
    return outcome;
  }, []);

  const submit = useCallback(async (fields: Record<string, string>, file: File) => {
    setCheckNote(null);
    setState({ phase: "uploading", percent: 0 });
    const fingerprint = await statementFingerprint(fields, file);
    const { intent, blockedBy } = await statementIntentFor(fingerprint);
    // An earlier upload of this form is unconfirmed and this submission differs: send nothing and never rotate the key.
    if (blockedBy) return apply({ kind: "unresolved", receipt: blockedBy.receipt, reason: "different_request_pending" });
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) if (value !== "") formData.append(name, value);
    formData.append("statementFile", file);
    const sent = await sendStatementUpload(formData, intent.key, (percent) => {
      setState(percent >= 100 ? { phase: "confirming" } : { phase: "uploading", percent });
    });
    const outcome: StatementOutcome = sent ? classifyStatementResponse(sent.status, sent.text) : { kind: "unresolved", receipt: intent.receipt, reason: "network" };
    recordStatementOutcome(intent, outcome);
    return apply(outcome);
  }, [apply]);

  const check = useCallback(async () => {
    setChecking(true);
    setCheckNote(null);
    const result = await checkStatementStatus();
    setChecking(false);
    if (!result) { setCheckNote("We couldn't read the status from this browser session. Try again, or call us."); return null; }
    if (result.saved) {
      const intent = loadStatementIntent();
      if (intent?.receipt) {
        const reference = intent.reference ?? intent.receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
        const processing = intent.processing ?? (result.status === "review_required" ? "deferred" : "queued");
        saveStatementIntent({ ...intent, state: "saved", reference, processing });
        setState({ phase: "saved", receipt: intent.receipt, reference, processing, restored: true, fresh: claimStatementAnalytics(intent.receipt) });
      }
    } else setCheckNote("Still pending. Your upload is not lost; submit the same file again to finish it.");
    return result;
  }, []);

  const dismiss = useCallback(() => { clearStatementIntent(); setCheckNote(null); setState({ phase: "idle" }); }, []);

  return { state, submit, check, dismiss, checking, checkNote, busy: state.phase === "uploading" || state.phase === "confirming" };
}
