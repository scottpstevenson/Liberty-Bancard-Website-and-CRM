import { useCallback, useEffect, useState } from "react";
import {
  checkIntakeStatus, clearIntent, loadIntent, submitPublicIntake,
  type IntakeForm, type IntakeOutcome,
} from "@/lib/public-intake";

export type PublicIntakeState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "saved"; receipt: string; pendingReview: boolean }
  | { phase: "recoverable"; receipt: string; restored: boolean }
  | { phase: "unresolved"; receipt: string | null; restored: boolean; reason: string }
  | { phase: "rejected"; message: string };

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
    if (stored.state === "recoverable" && stored.receipt) setState({ phase: "recoverable", receipt: stored.receipt, restored: true });
    else if (stored.state === "unresolved") setState({ phase: "unresolved", receipt: stored.receipt, restored: true, reason: "restored" });
  }, [form]);

  const apply = useCallback((outcome: IntakeOutcome): IntakeOutcome => {
    if (outcome.kind === "saved") setState({ phase: "saved", receipt: outcome.receipt, pendingReview: outcome.pendingReview });
    else if (outcome.kind === "recoverable") setState({ phase: "recoverable", receipt: outcome.receipt, restored: false });
    else if (outcome.kind === "unresolved") setState({ phase: "unresolved", receipt: outcome.receipt, restored: false, reason: outcome.reason });
    else setState({ phase: "rejected", message: outcome.message });
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
    if (result.saved) {
      const receipt = loadIntent(form)?.receipt ?? "";
      setState({ phase: "saved", receipt, pendingReview: result.status === "review_required" });
    } else setCheckNote("Still pending. Your details are saved; nothing needs to be re-entered.");
    return result;
  }, [form]);

  const dismiss = useCallback(() => { clearIntent(form); setCheckNote(null); setState({ phase: "idle" }); }, [form]);

  /** Leave the saved view (e.g. closing a widget) without discarding an unresolved intent. */
  const acknowledgeSaved = useCallback(() => setState((current) => (current.phase === "saved" ? { phase: "idle" } : current)), []);

  return { state, submit, check, dismiss, acknowledgeSaved, checking, checkNote, submitting: state.phase === "submitting" };
}
