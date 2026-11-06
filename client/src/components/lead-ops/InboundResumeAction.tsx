import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, parseApiRequestError, queryClient } from "@/lib/queryClient";

interface ResumeResult {
  outcome: "continued" | "already_continued";
  lifecycleState: string;
  assignmentStatus: string | null;
  assignedTo: string | null;
}

/**
 * Continue ONE retained sales review in context. The server re-checks identity, classification, archive state, the
 * decision revision this row was loaded with and the task state, and answers with the real blocked reason. The action
 * never classifies the contact or picks an owner by itself, and external sends stay held.
 */
export function InboundResumeAction({ requestReceipt, reviewRevision }: { requestReceipt: string; reviewRevision: number | null }) {
  const [message, setMessage] = useState<{ tone: "ok" | "blocked"; text: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/lead-ops/inbound-requests/${requestReceipt}/resume`, { reviewRevision })).json() as Promise<ResumeResult>,
    onSuccess: (result) => {
      const owner = result.assignedTo ? `owner ${result.assignedTo}` : "no owner elected yet";
      setMessage({
        tone: "ok",
        text: result.outcome === "already_continued"
          ? "Already continued. No change made."
          : `Continued: ${result.lifecycleState}, assignment ${result.assignmentStatus ?? "pending"} (${owner}). External sends stay held.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/inbound-requests"] });
    },
    onError: (error: Error) => {
      const parsed = parseApiRequestError(error.message);
      setMessage({ tone: "blocked", text: parsed.reason || "Not continued. Reload the request and review its current state." });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/inbound-requests"] });
    },
  });
  if (reviewRevision === null) return null;
  return (
    <div className="flex flex-col items-start gap-1" data-testid={`inbound-resume-${requestReceipt}`}>
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={mutation.isPending} onClick={() => { setMessage(null); mutation.mutate(); }}
        data-testid="button-inbound-resume">
        {mutation.isPending ? "Continuing…" : "Continue review"}
      </Button>
      {message && (
        <p role="status" data-testid="text-inbound-resume-result"
          className={`max-w-[200px] break-words text-[11px] ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
