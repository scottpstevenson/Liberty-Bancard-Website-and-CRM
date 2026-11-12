import { Button } from "@/components/ui/button";
import { UNASSIGNED_POLICY_NOTE, type UnassignedSummary } from "@/lib/unassigned-work";

/**
 * Unassigned-management queue header shared by Work and Support. It reports the loaded counts, states the review blocker in
 * plain words, and toggles the unassigned-only view. It performs no assignment itself.
 */
export function UnassignedQueueBanner({
  kind, summary, active, onShowUnassigned, onShowAll, canClaim, overdueLabel,
}: {
  kind: "task" | "ticket";
  summary: UnassignedSummary;
  active: boolean;
  onShowUnassigned: () => void;
  onShowAll: () => void;
  canClaim: boolean;
  overdueLabel: string;
}) {
  const plural = kind === "task" ? "tasks" : "tickets";
  if (summary.unassigned === 0 && !active) return null;
  return (
    <section
      aria-label={`Unassigned ${plural}`}
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
      data-testid={`unassigned-queue-${kind}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium" data-testid={`text-unassigned-summary-${kind}`}>
          {summary.unassigned === 0
            ? `No unassigned ${plural} in the ${summary.loaded} loaded.`
            : `${summary.unassigned} unassigned ${summary.unassigned === 1 ? kind : plural} in the ${summary.loaded} loaded`}
          {summary.unassigned > 0 && summary.unassignedOverdue > 0 && ` · ${summary.unassignedOverdue} ${overdueLabel}`}
        </p>
        {active ? (
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={onShowAll} data-testid={`button-show-all-${kind}s`}>
            Show all {plural}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={onShowUnassigned} data-testid={`button-show-unassigned-${kind}s`}>
            Show unassigned only
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs" data-testid={`text-unassigned-policy-${kind}`}>
        {UNASSIGNED_POLICY_NOTE}
        {canClaim ? "" : " Ask a manager or administrator to claim or assign it."}
      </p>
    </section>
  );
}
