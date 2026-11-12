import { Badge } from "@/components/ui/badge";
import { PRODUCTION_SCOPE_COPY, PRODUCTION_SCOPE_REVIEW_COPY, recordClassBadge } from "@/lib/record-class";

/** Labels a record whose authoritative class is not production. Renders nothing for production records. */
export function RecordClassBadge({ recordClass, className = "" }: { recordClass: unknown; className?: string }) {
  const badge = recordClassBadge(recordClass);
  if (!badge) return null;
  return (
    <Badge variant="outline" title={badge.title} data-testid="record-class-badge" data-record-class={String(recordClass)}
      className={`${className} ${badge.tone === "warn" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
      {badge.label}
    </Badge>
  );
}

/** One scope line shared by KPIs, queues and boards so the production default is stated the same way everywhere. */
export function ProductionScopeNote({ className = "", showReview = true }: { className?: string; showReview?: boolean }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`} data-testid="production-scope-note">
      {PRODUCTION_SCOPE_COPY}{showReview ? ` ${PRODUCTION_SCOPE_REVIEW_COPY}` : ""}
    </p>
  );
}
