import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, XCircle, HelpCircle, BarChart2 } from "lucide-react";
import {
  READINESS_COMPONENT_META,
  humanizeReasonCode,
  type ReadinessBreakdownShape,
  type ReadinessComponentEntry,
} from "@shared/readiness-types";

const CURRENT_MODEL_VERSION = 1;

// ── Grade badge ───────────────────────────────────────────────────────────────

const GRADE_STYLES: Record<string, { bg: string; text: string }> = {
  A: { bg: "bg-green-100 dark:bg-green-900/40",  text: "text-green-800 dark:text-green-300" },
  B: { bg: "bg-blue-100 dark:bg-blue-900/40",    text: "text-blue-800 dark:text-blue-300" },
  C: { bg: "bg-amber-100 dark:bg-amber-900/40",  text: "text-amber-800 dark:text-amber-300" },
  D: { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-800 dark:text-orange-300" },
  F: { bg: "bg-red-100 dark:bg-red-900/40",      text: "text-red-800 dark:text-red-300" },
};

function GradeBadge({ grade }: { grade: string }) {
  const style = GRADE_STYLES[grade] ?? { bg: "bg-muted", text: "text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-xl font-bold ${style.bg} ${style.text}`}
      aria-label={`Grade ${grade}`}
      data-testid="readiness-grade-badge"
    >
      {grade}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ReadinessBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  let barClass = "bg-red-500";
  if (pct >= 80) barClass = "bg-green-500";
  else if (pct >= 60) barClass = "bg-blue-500";
  else if (pct >= 40) barClass = "bg-amber-500";
  else if (pct >= 20) barClass = "bg-orange-500";

  return (
    <div
      className="w-full h-2 bg-muted rounded-full overflow-hidden"
      role="progressbar"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Readiness score ${score} out of 100`}
      data-testid="readiness-progress-bar"
    >
      <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Status icon for a component row ──────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "present") {
    return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" aria-label="Present" />;
  }
  if (status === "missing") {
    return <XCircle className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0" aria-label="Missing" />;
  }
  if (status === "unavailable") {
    return <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Unavailable" />;
  }
  return <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0" aria-label="Issues found" />;
}

// ── Stale indicator ───────────────────────────────────────────────────────────

function StaleIndicator({
  readinessModelVersion,
  readinessUpdatedAt,
  lastMeaningfulContactMutationAt,
}: {
  readinessModelVersion: number | null;
  readinessUpdatedAt: string | null;
  lastMeaningfulContactMutationAt: string | null;
}) {
  if (readinessModelVersion !== null && readinessModelVersion !== CURRENT_MODEL_VERSION) {
    return (
      <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300" data-testid="readiness-stale-model">
        Stale model version
      </Badge>
    );
  }
  if (
    readinessUpdatedAt &&
    lastMeaningfulContactMutationAt &&
    new Date(readinessUpdatedAt) < new Date(lastMeaningfulContactMutationAt)
  ) {
    return (
      <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300" data-testid="readiness-may-be-outdated">
        Score may be outdated
      </Badge>
    );
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReadinessCardProps {
  score: number | null;
  grade: string | null;
  breakdown: unknown;
  readinessUpdatedAt: string | null;
  readinessModelVersion: number | null;
  lastMeaningfulContactMutationAt: string | null;
}

function parseBreakdown(raw: unknown): ReadinessBreakdownShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.components || typeof r.components !== "object") return null;
  return {
    version: typeof r.version === "number" ? r.version : 0,
    components: r.components as ReadinessBreakdownShape["components"],
    missingReasons: Array.isArray(r.missingReasons)
      ? (r.missingReasons as string[])
      : [],
  };
}

export function ReadinessCard({
  score,
  grade,
  breakdown,
  readinessUpdatedAt,
  readinessModelVersion,
  lastMeaningfulContactMutationAt,
}: ReadinessCardProps) {
  const parsed = parseBreakdown(breakdown);

  return (
    <Card data-testid="readiness-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary" />
          Data Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {score === null || score === undefined ? (
          <p className="text-sm text-muted-foreground italic" data-testid="readiness-unscored">
            Not yet scored. Readiness will be calculated by the active readiness backfill.
          </p>
        ) : (
          <>
            {/* Score summary */}
            <div className="flex items-center gap-3" data-testid="readiness-summary">
              <GradeBadge grade={grade ?? "F"} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-semibold" data-testid="readiness-score-label">
                    {grade ?? "F"} — {score} / 100
                  </span>
                  <StaleIndicator
                    readinessModelVersion={readinessModelVersion}
                    readinessUpdatedAt={readinessUpdatedAt}
                    lastMeaningfulContactMutationAt={lastMeaningfulContactMutationAt}
                  />
                </div>
                <ReadinessBar score={score} />
              </div>
            </div>

            {/* Timestamp */}
            {readinessUpdatedAt && (
              <p className="text-xs text-muted-foreground" data-testid="readiness-last-scored">
                Last scored:{" "}
                {new Date(readinessUpdatedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}

            {/* Field breakdown */}
            {parsed && (
              <div data-testid="readiness-breakdown">
                <div className="grid grid-cols-[1fr_auto_auto] text-xs font-medium text-muted-foreground pb-1 border-b gap-x-3">
                  <span>Field</span>
                  <span className="text-right">Pts</span>
                  <span className="w-4" />
                </div>
                <div className="space-y-1 pt-1">
                  {READINESS_COMPONENT_META.map(({ key, label }) => {
                    const comp: ReadinessComponentEntry | undefined =
                      parsed.components[key];

                    if (!comp) {
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-0.5 text-sm"
                          data-testid={`readiness-row-${key}`}
                        >
                          <span className="text-muted-foreground text-xs truncate">{label}</span>
                          <span className="text-right text-xs text-muted-foreground">—</span>
                          <StatusIcon status="unavailable" />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-0.5 text-sm"
                        data-testid={`readiness-row-${key}`}
                      >
                        <span className="text-xs text-muted-foreground truncate">{label}</span>
                        <span
                          className="text-right text-xs font-medium tabular-nums"
                          data-testid={`readiness-pts-${key}`}
                        >
                          {comp.earnedPoints}/{comp.maxPoints}
                        </span>
                        <StatusIcon status={comp.status} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Missing reasons */}
            {parsed && parsed.missingReasons.length > 0 && (
              <div data-testid="readiness-missing-reasons">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Missing or invalid fields:</p>
                <ul className="space-y-0.5">
                  {parsed.missingReasons.map((code) => (
                    <li
                      key={code}
                      className="flex items-start gap-1.5 text-xs text-muted-foreground"
                      data-testid={`readiness-reason-${code}`}
                    >
                      <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                      {humanizeReasonCode(code)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
