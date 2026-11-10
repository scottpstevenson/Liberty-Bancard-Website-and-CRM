import { FileText } from "lucide-react";
import { HOME_SAMPLE_REVIEW } from "@shared/public-home-content";
import { cn } from "@/lib/utils";

/**
 * Statement-anatomy card shown on Home: the four parts of a statement a review separates, each with a
 * numbered annotation and a dash where a figure would appear. It is an explanation, not a result: no rate,
 * fee amount or savings figure is shown, and it is labelled illustrative in the header stamp, the
 * document note and the caption. The row numbers are decorative (aria-hidden); the list order carries
 * the sequence. The server-rendered Home emits the same rows from the same record.
 */
export function SampleReviewCard({ className, testId = "card-statement-audit" }: { className?: string; testId?: string }) {
  return (
    <figure className={cn("public-card overflow-hidden", className)} data-testid={testId} aria-label="Statement review layout (illustrative, no results shown)">
      <div className="px-4 pt-4">
        <p className="public-eyebrow public-eyebrow--brand">{HOME_SAMPLE_REVIEW.eyebrow}</p>
        <h3 className="public-h3 mt-1 text-foreground" data-testid="text-statement-heading">{HOME_SAMPLE_REVIEW.heading}</h3>
        <p className="public-small public-secondary mt-1">{HOME_SAMPLE_REVIEW.intro}</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 bg-primary px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10">
            <FileText className="h-4 w-4 text-sky-200" aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold tracking-wide text-white">{HOME_SAMPLE_REVIEW.documentLabel}</div>
            <div className="text-[11px] tracking-wide text-white/75">{HOME_SAMPLE_REVIEW.documentNote}</div>
          </div>
        </div>
        <span className="audit-stamp shrink-0 bg-card" data-testid="badge-illustrative">{HOME_SAMPLE_REVIEW.stamp}</span>
      </div>
      <dl className="px-4">
        {HOME_SAMPLE_REVIEW.rows.map((row, i) => (
          <div key={row.label} className="flex items-start gap-3 border-b border-border py-3 last:border-0" data-testid={`row-statement-${i}`}>
            <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <dt className="public-small font-semibold text-foreground">{row.label}</dt>
              <dd className="public-caption public-secondary">
                <span className="font-semibold">{row.heading}</span> {row.note}
              </dd>
            </div>
            <span className="num shrink-0 text-sm font-semibold text-muted-foreground" aria-hidden="true">—</span>
          </div>
        ))}
      </dl>
      <p className="px-4 pb-3 public-small font-semibold text-foreground">{HOME_SAMPLE_REVIEW.footnote}</p>
      <figcaption className="border-t border-border bg-muted/50 px-4 py-3 public-caption public-secondary">
        {HOME_SAMPLE_REVIEW.label}
      </figcaption>
    </figure>
  );
}
