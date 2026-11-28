import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { FinalEmailPreview, type FinalMessagePreview } from "./MessageFinalPreview";

type ReviewCopy = "current" | "premium_draft";

export interface ReleaseReviewRecipient {
  enrollmentId: number;
  bindingHash: string;
  currentStep: number;
  name: string | null;
  email: string;
  business: string;
  county: string | null;
  vertical: string | null;
  sequence: string;
  kind: "new" | "continuation";
}

interface ReviewMessage {
  to: string;
  stepOrder: number;
  steps: Array<{ stepOrder: number; day: number }>;
  final: FinalMessagePreview | null;
  error: { detail: string } | null;
}

function RecipientMessage({ recipient, initialCopy }: { recipient: ReleaseReviewRecipient; initialCopy: ReviewCopy }) {
  const [copy, setCopy] = useState<ReviewCopy>(initialCopy);
  const [stepOrder, setStepOrder] = useState<number>();
  const { enrollmentId, bindingHash, currentStep } = recipient;
  const message = useQuery<ReviewMessage>({
    queryKey: ["release-recipient-message", enrollmentId, bindingHash, currentStep, copy, stepOrder ?? null],
    queryFn: async () => (await apiRequest("POST", "/api/canonical-enrichment/release/message-preview", {
      enrollmentId, bindingHash, currentStep, copy, stepOrder,
    })).json(),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const selectCopy = (value: ReviewCopy) => {
    setCopy(value);
    setStepOrder(undefined);
  };
  const result = message.data;
  return (
    <div className="space-y-3 min-w-0">
      <p className="break-words text-sm"><strong>To</strong> {recipient.email}</p>
      <div role="group" aria-label="Message version" className="flex flex-wrap gap-2">
        <Button size="sm" variant={copy === "premium_draft" ? "default" : "outline"} aria-pressed={copy === "premium_draft"} onClick={() => selectCopy("premium_draft")}>Premium draft</Button>
        <Button size="sm" variant={copy === "current" ? "default" : "outline"} aria-pressed={copy === "current"} onClick={() => selectCopy("current")}>Current sequence</Button>
      </div>
      {copy === "premium_draft" && <p className="text-sm text-muted-foreground">Draft for review. A release uses the currently published sequence.</p>}
      {result?.steps.length ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Sequence touch
          <select className="rounded-md border bg-background px-2 py-1.5" value={result.stepOrder} onChange={e => setStepOrder(Number(e.target.value))}>
            {result.steps.map(step => <option key={step.stepOrder} value={step.stepOrder}>Touch {step.stepOrder} · Day {step.day}</option>)}
          </select>
        </label>
      ) : null}
      {message.isPending && <p role="status" className="text-sm text-muted-foreground">Rendering personalized email…</p>}
      {message.isError && <p role="alert" className="text-sm text-destructive">This email preview could not be loaded. Run the release preview again to refresh the recipient’s details.</p>}
      {result?.error && <p role="alert" className="text-sm text-destructive">{result.error.detail}</p>}
      {result?.final && (
        <>
          <p className="break-words text-sm"><strong>Subject</strong> {result.final.subject}</p>
          <FinalEmailPreview final={result.final} />
        </>
      )}
    </div>
  );
}

export function ReleaseRecipientReview({ recipients, verifiedSubjects }: {
  recipients: ReleaseReviewRecipient[]; verifiedSubjects?: ReadonlyMap<number, string>;
}) {
  const headingId = useId();
  const [selected, setSelected] = useState<ReleaseReviewRecipient | null>(null);
  if (recipients.length === 0) return null;
  return (
    <section className="mt-4 space-y-2" aria-labelledby={headingId} data-testid="release-recipient-roster">
      <h3 id={headingId} className="text-sm font-semibold">{verifiedSubjects ? "Verified held recipients" : "Selected recipients"}</h3>
      <p className="text-xs text-muted-foreground">Open a recipient to compare personalized premium drafts and the current sequence.</p>
      <div className="max-h-[28rem] overflow-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs">
            <tr><th scope="col" className="px-3 py-2">Recipient</th><th scope="col" className="px-3 py-2">Business</th><th scope="col" className="px-3 py-2">Sequence</th><th scope="col" className="px-3 py-2">Email</th></tr>
          </thead>
          <tbody>
            {recipients.map(recipient => (
              <tr key={recipient.enrollmentId} className="border-t" data-testid="release-recipient-row">
                <td className="px-3 py-2">
                  <p>{recipient.name ?? "Name unavailable"}</p>
                  <p className="break-all text-xs text-muted-foreground">{recipient.email}</p>
                  <p className="text-xs text-muted-foreground">Enrollment {recipient.enrollmentId}</p>
                </td>
                <td className="px-3 py-2">
                  <p>{recipient.business}</p>
                  <p className="text-xs text-muted-foreground">{[recipient.county, recipient.vertical].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-3 py-2">
                  <p>{recipient.sequence}</p>
                  <p className="text-xs text-muted-foreground">{recipient.kind === "continuation" ? "Continuing" : "First email"} · Touch {recipient.currentStep + 1}</p>
                </td>
                <td className="px-3 py-2">
                  {verifiedSubjects?.has(recipient.enrollmentId) && <p className="mb-1 text-xs">{verifiedSubjects.get(recipient.enrollmentId)}</p>}
                  <Button size="sm" variant="outline" aria-label={`Preview email for ${recipient.email}`} onClick={() => setSelected(recipient)}>Preview</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
        {selected && (
          <DialogContent size="workspace">
            <DialogHeader>
              <DialogTitle>Personalized email preview</DialogTitle>
              <DialogDescription>{selected.name ? `${selected.name} · ` : ""}{selected.business}</DialogDescription>
            </DialogHeader>
            <RecipientMessage key={selected.enrollmentId} recipient={selected} initialCopy={verifiedSubjects ? "current" : "premium_draft"} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
