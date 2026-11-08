import { FileText } from "lucide-react";
import { HOME_SAMPLE_REVIEW } from "@shared/public-home-content";
import { cn } from "@/lib/utils";

/**
 * Review layout shown on Home: the four things a statement review covers, with a dash where a result
 * would appear. It is a worksheet, not a result: no rate, fee amount or savings figure is shown, and
 * it is labelled as an illustrative layout in the header stamp and in the caption.
 */
export function SampleReviewCard({ className, testId = "card-statement-audit" }: { className?: string; testId?: string }) {
  return (
    <figure className={cn("public-card overflow-hidden", className)} data-testid={testId} aria-label="Statement review layout (illustrative, no results shown)">
      <div className="flex items-center justify-between gap-3 bg-primary px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10">
            <FileText className="h-4 w-4 text-sky-200" aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold text-white">Statement review</div>
            <div className="num text-[11px] tracking-wide text-white/75">LAYOUT · NO RESULTS</div>
          </div>
        </div>
        <span className="audit-stamp shrink-0 bg-card" data-testid="badge-illustrative">Illustrative</span>
      </div>
      <dl className="px-4">
        {HOME_SAMPLE_REVIEW.rows.map((row, i) => (
          <div key={row.label} className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0" data-testid={`row-statement-${i}`}>
            <div className="min-w-0">
              <dt className="public-small font-semibold text-foreground">{row.label}</dt>
              <dd className="public-caption public-secondary">{row.note}</dd>
            </div>
            <span className="num shrink-0 text-sm font-semibold text-muted-foreground" aria-hidden="true">—</span>
          </div>
        ))}
      </dl>
      <figcaption className="border-t border-border bg-muted/50 px-4 py-3 public-caption public-secondary">
        {HOME_SAMPLE_REVIEW.label}
      </figcaption>
    </figure>
  );
}
