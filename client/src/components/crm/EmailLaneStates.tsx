import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { laneVerdict, type LaneState, type LaneTone } from "@/lib/email-lane-states";

const TONE_CLASS: Record<LaneTone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  blocked: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
  unknown: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
};
const TONE_WORD: Record<LaneTone, string> = { ok: "Clear", blocked: "Blocking", unknown: "Not read", neutral: "Info" };

/** One sentence: why this row will or will not advance. Never says "ready". */
export function LaneVerdictLine({ states, testId }: { states: readonly LaneState[]; testId: string }) {
  const verdict = laneVerdict(states);
  return (
    <p className={`text-xs ${verdict.kind === "blocked" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`} data-testid={testId} data-verdict={verdict.kind}>
      {verdict.text}
    </p>
  );
}

/** The eight states, each with its own basis, behind a disclosure so the row stays scannable. */
export function EmailLaneStates({ states, testId }: { states: readonly LaneState[]; testId: string }) {
  return (
    <details className="group rounded-md border bg-muted/20 text-sm" data-testid={`${testId}-details`}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
        Send readiness: eight separate states
      </summary>
      <dl className="divide-y px-3 pb-2" data-testid={testId}>
        {states.map(state => (
          <div key={state.key} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]" data-testid={`${testId}-${state.key}`} data-tone={state.tone}>
            <dt className="flex items-center gap-2 text-xs font-medium">
              {state.label}
              <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${TONE_CLASS[state.tone]}`}>{TONE_WORD[state.tone]}</Badge>
            </dt>
            <dd className="text-xs">
              <span className="font-medium">{state.summary}</span>
              <span className="block text-muted-foreground">{state.basis}</span>
              {state.href && <Link href={state.href} className="underline">Open the owning screen</Link>}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
