import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PENDING_COPY = "Your request is saved and follow-up is pending review. We can’t say when someone will reach you.";
const CONFIRMED_COPY = "We’ve received your request. Our team will review the details and contact you using the information you provided.";

/** The short reference a visitor can quote on a call: the first eight characters of the saved receipt. */
export function shortIntakeReference(receipt: string): string {
  return receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
}

interface Props {
  receipt: string;
  pendingReview: boolean;
  testIdPrefix: string;
  startLabel: string;
  /** The explicit "send another" choice. It is the only way out of a confirmed save, and it starts a new request. */
  onStartNew: () => void;
}

/**
 * What a visitor sees after a reload, Back or Forward to a form whose request this browser session already saved. It restores the
 * original reference and the truthful pending-review wording instead of an empty form, so the same inquiry is never re-entered and
 * re-sent under a new key. It carries only the receipt and review state, never the visitor's details.
 */
export function SavedIntakeConfirmation({ receipt, pendingReview, testIdPrefix, startLabel, onStartNew }: Props) {
  const reference = shortIntakeReference(receipt);
  return (
    <div className="space-y-3 py-4 text-center" role="status" data-testid={`${testIdPrefix}-saved`}>
      <CheckCircle className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
      <p className="text-lg font-semibold text-foreground" data-testid={`${testIdPrefix}-saved-title`}>Request received</p>
      <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-saved-detail`}>{pendingReview ? PENDING_COPY : CONFIRMED_COPY}</p>
      {reference ? (
        <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-saved-reference`}>
          Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Keep it if you call us about this request.
        </p>
      ) : null}
      <Button type="button" variant="outline" onClick={onStartNew} data-testid={`${testIdPrefix}-start-another`}>{startLabel}</Button>
    </div>
  );
}
