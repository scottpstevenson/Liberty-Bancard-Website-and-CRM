/**
 * Rates and averages that keep "no evidence" distinct from a real zero.
 * A rate with no denominator is null (insufficient evidence), never 0%.
 */
export function ratePercent(numerator: number | string | null | undefined, denominator: number | string | null | undefined, decimals = 0): number | null {
  const d = Number(denominator ?? 0);
  if (!Number.isFinite(d) || d <= 0) return null;
  const n = Number(numerator ?? 0);
  const f = 10 ** decimals;
  return Math.round((n / d) * 100 * f) / f;
}

export function formatRate(rate: number | null | undefined, suffix = "%"): string {
  return rate == null ? "n/a" : `${rate}${suffix}`;
}

/** Averages only known scores. A real 0 is known; null/undefined are excluded and reported through the coverage. */
export function averageKnown(scores: Array<number | null | undefined>): { average: number | null; known: number; total: number } {
  const known = scores.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  return {
    average: known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0) / known.length),
    known: known.length,
    total: scores.length,
  };
}

export interface RateEvidence {
  /** What the rates are measured over. */
  basis: string;
  denominator: number;
  /** false = the denominator is zero, so every rate in this record is null (insufficient evidence). */
  sufficient: boolean;
}
