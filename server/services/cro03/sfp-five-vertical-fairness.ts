/**
 * Pure five-vertical minimum-coverage selection for SFP v2 cohorts.
 *
 * The caller supplies candidates already ranked by starvation protection,
 * evidenced ROI, and stable business id. This helper reserves a minimum
 * proportional slice for each configured vertical, then fills the remaining
 * capacity in that same global order.
 */
export function selectWithFiveVerticalMinimum<T extends { vertical: string | null }>(
  rankedCandidates: T[],
  maxCohort: number,
  verticalIds: string[],
): T[] {
  const cap = Math.max(0, Math.floor(maxCohort));
  if (cap === 0 || rankedCandidates.length === 0) return [];

  const verticals = [...new Set(verticalIds)].filter(Boolean);
  if (verticals.length !== 5 || cap < 5) return rankedCandidates.slice(0, cap);

  const minimumPerVertical = Math.max(1, Math.floor(cap / verticals.length));
  const selected = new Set<T>();
  for (const vertical of verticals) {
    let covered = 0;
    for (const candidate of rankedCandidates) {
      if (candidate.vertical !== vertical) continue;
      if (selected.has(candidate)) continue;
      if (covered >= minimumPerVertical || selected.size >= cap) break;
      selected.add(candidate);
      covered++;
    }
  }

  for (const candidate of rankedCandidates) {
    if (selected.size >= cap) break;
    selected.add(candidate);
  }
  return rankedCandidates.filter((candidate) => selected.has(candidate));
}