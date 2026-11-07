import { FileText } from "lucide-react";
import { SAMPLE_FINDINGS } from "./home-content";
import { cn } from "@/lib/utils";

const chipTone = { negative: "report-chip-negative", positive: "report-chip-positive", neutral: "report-chip-neutral" } as const;
const valueTone = { negative: "text-stat-negative", positive: "text-stat-positive", neutral: "text-foreground" } as const;

/**
 * The one illustrative fee-audit report used on Home. It is labelled as a sample both in its
 * header stamp and in its footer, and carries no real account data.
 */
export function SampleReviewCard({ className, rows = SAMPLE_FINDINGS.length, testId = "card-statement-audit" }: { className?: string; rows?: number; testId?: string }) {
  return (
    <figure className={cn("public-card overflow-hidden", className)} data-testid={testId} aria-label="Example statement review (illustrative sample)">
      <div className="flex items-center justify-between gap-3 bg-primary px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10">
            <FileText className="h-4 w-4 text-sky-200" aria-hidden="true" />
          </span>
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold text-white">Statement Fee Audit</div>
            <div className="num text-[11px] tracking-wide text-white/75">REF · LB-0000 · SAMPLE</div>
          </div>
        </div>
        <span className="audit-stamp bg-card shrink-0" data-testid="badge-illustrative">Illustrative</span>
      </div>
      <div className="px-4">
        {SAMPLE_FINDINGS.slice(0, rows).map((row, i) => (
          <div key={row.label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border py-2.5 last:border-0" data-testid={row.testId ?? `row-statement-${i}`}>
            <span className="public-small min-w-0 flex-1 text-foreground">{row.label}</span>
            <span className="flex items-center gap-2">
              <span className={cn("report-chip", chipTone[row.tone])}>{row.chip}</span>
              <span className={cn("num whitespace-nowrap text-sm font-semibold", valueTone[row.tone])}>{row.value}</span>
            </span>
          </div>
        ))}
      </div>
      <figcaption className="border-t border-border bg-muted/50 px-4 py-3 public-caption public-secondary">
        Sample for illustration only, not a real account. Actual findings require statement review. *Funding timing subject to eligibility, underwriting, and card brand rules.
      </figcaption>
    </figure>
  );
}
