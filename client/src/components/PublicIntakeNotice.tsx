import { useState } from "react";
import { AlertTriangle, CheckCircle, Copy, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CALENDAR_URL, PHONE_NUMBER, PHONE_TEL } from "@/lib/constants";
import type { PublicIntakeState } from "@/hooks/use-public-intake";

interface Props {
  state: PublicIntakeState;
  testIdPrefix: string;
  checking: boolean;
  checkNote: string | null;
  onCheck: () => void;
  /** Re-send the identical request (same key). Omitted when the details are no longer in memory (after a reload). */
  onRetry?: () => void;
  onDismiss: () => void;
  compact?: boolean;
}

export function IntakeReceipt({ receipt, testIdPrefix }: { receipt: string; testIdPrefix: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
      <span>Reference</span>
      <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]" data-testid={`${testIdPrefix}-receipt`}>{receipt}</code>
      <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" data-testid={`${testIdPrefix}-copy-receipt`}
        onClick={async () => { try { await navigator.clipboard.writeText(receipt); setCopied(true); } catch { setCopied(false); } }}>
        <Copy className="h-3 w-3" />{copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Truthful notice for a request that is saved-but-pending or not yet confirmed. No callback deadline is promised. */
export function PublicIntakeNotice({ state, testIdPrefix, checking, checkNote, onCheck, onRetry, onDismiss, compact }: Props) {
  if (state.phase !== "recoverable" && state.phase !== "unresolved") return null;
  const recoverable = state.phase === "recoverable";
  const receipt = state.receipt;
  return (
    <div role="status" className={`rounded-md border border-amber-300 bg-amber-50 text-left text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 ${compact ? "p-3 text-xs" : "p-4 text-sm"} space-y-3`}
      data-testid={`${testIdPrefix}-notice`} data-intake-phase={state.phase}>
      <div className="flex items-start gap-2">
        {recoverable ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="space-y-1">
          <p className="font-semibold" data-testid={`${testIdPrefix}-notice-title`}>
            {recoverable ? "Request saved — follow-up is pending review" : "We couldn't confirm your request"}
          </p>
          <p>
            {recoverable
              ? "Your details are saved, but we could not finish routing them. We cannot say when someone will reach you. You can check the status or try to finish it now."
              : state.restored
                ? "A request from this session was not confirmed. Check it below, or re-enter the same details to finish it without creating a second request."
                : "We could not confirm that your request arrived. Trying again re-sends the same request and will not create a duplicate."}
          </p>
        </div>
      </div>
      {receipt && <IntakeReceipt receipt={receipt} testIdPrefix={testIdPrefix} />}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {receipt && (
          <Button type="button" size="sm" variant="outline" disabled={checking} onClick={onCheck} data-testid={`${testIdPrefix}-check`}>
            {checking && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Check status
          </Button>
        )}
        {onRetry && (
          <Button type="button" size="sm" onClick={onRetry} data-testid={`${testIdPrefix}-retry`}>
            {recoverable ? "Try to finish now" : "Try again"}
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1" asChild>
          <a href={PHONE_TEL} data-testid={`${testIdPrefix}-call`}><Phone className="h-3 w-3" />Call {PHONE_NUMBER}</a>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid={`${testIdPrefix}-book`}>Book a review call</a>
        </Button>
        {state.restored && (
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss} data-testid={`${testIdPrefix}-dismiss`}>Start a new request</Button>
        )}
      </div>
      {checkNote && <p data-testid={`${testIdPrefix}-check-note`} className="text-center text-xs">{checkNote}</p>}
    </div>
  );
}
