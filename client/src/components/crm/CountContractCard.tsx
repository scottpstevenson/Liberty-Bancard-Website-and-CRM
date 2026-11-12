import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  POPULATION_STAGES, contractLines, countHeadline, type CountReading,
} from "@/lib/count-contract";

/** One count with its contract behind a disclosure. Unavailable reads as words and never as zero. */
export function CountTile({ label, reading, testId, tone, suffix }: { label: string; reading: CountReading; testId: string; tone?: string; suffix?: string }) {
  const unavailable = reading.availability === "unavailable";
  return (
    <div className={`rounded-md border px-3 py-2 ${unavailable ? "border-red-200 bg-red-50/30" : "bg-muted/10"}`} data-testid={testId} data-availability={reading.availability} data-temporal={reading.contract.temporal}>
      <div className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {reading.contract.temporal === "historical" && (
          <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">Historical</Badge>
        )}
      </div>
      <div className={`text-lg font-bold ${unavailable ? "text-sm font-medium text-red-600" : tone ?? ""}`} data-testid={`${testId}-value`}>
        {countHeadline(reading)}{reading.availability === "available" && suffix ? suffix : ""}
      </div>
      <details className="mt-1 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">What this counts</summary>
        <dl className="mt-1 space-y-0.5">
          {contractLines(reading.contract, reading.availability).map(line => (
            <div key={line.label}><dt className="inline font-medium">{line.label}: </dt><dd className="inline">{line.text}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  );
}

/** Named disclosure for raw, historical or diagnostic material, so the page opens on the current summary. */
export function NamedDisclosure({ title, summary, testId, children }: { title: string; summary: string; testId: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-card" data-testid={testId}>
      <summary className="cursor-pointer select-none px-4 py-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
      </summary>
      <div className="space-y-5 border-t p-4">{children}</div>
    </details>
  );
}

/**
 * The eight population words, each with its unit, what it does not mean, its authority and the screen that owns the
 * number. It adds nothing together and shows no number of its own, so no two populations can be made to look equal.
 */
export function PopulationStagesGuide({ testId = "population-stages" }: { testId?: string }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2" data-testid={testId}>
      {POPULATION_STAGES.map((stage, index) => (
        <li key={stage.key} className="rounded-md border bg-muted/10 p-3 text-sm" data-testid={`${testId}-${stage.key}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{index + 1}. {stage.term}</span>
            <span className="text-[11px] text-muted-foreground">{stage.unit}</span>
          </div>
          <p className="mt-1 text-xs">{stage.meaning}</p>
          <p className="mt-1 text-xs text-muted-foreground">{stage.notThis}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Authority: {stage.authority}.</p>
          <Link href={stage.owner.href} className="mt-1 inline-block text-xs underline" data-testid={`${testId}-${stage.key}-link`}>
            Open the population: {stage.owner.label}
          </Link>
        </li>
      ))}
    </ol>
  );
}
