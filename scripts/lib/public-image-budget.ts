/**
 * Public imagery budget rules, kept separate from the encoder so tests can exercise them with fixtures
 * (and a deliberately broken selector) without running sharp.
 *
 *  - The principal above-the-fold mobile derivative (the Home hero's 720 px WebP) must stay <= 120 KiB.
 *  - Every derivative must stay <= 260 KiB.
 *  - The hero selector must name the image the Home hero actually renders as its priority (LCP) image.
 *    A selector that points at an image the page no longer uses would pass while checking nothing.
 */

export interface BudgetFile {
  format: "avif" | "webp" | "jpg";
  file: string;
  width: number;
  height: number;
  bytes: number;
}
export interface BudgetEntry {
  id: string;
  variants: { name: string; files: BudgetFile[] }[];
}

export interface HeroBudgetSelector {
  id: string;
  variant: string;
  width: number;
  format: "webp";
  maxBytes: number;
}

export const PER_FILE_MAX_BYTES = 260 * 1024;

/** The Home hero's mobile LCP derivative. The id/variant must match HOME_HERO_IMAGE in shared/public-home-content.ts. */
export const HERO_MOBILE_BUDGET: HeroBudgetSelector = {
  id: "home-hero-merchant",
  variant: "mobile",
  width: 720,
  format: "webp",
  maxBytes: 120 * 1024,
};

export function budgetProblems(entries: readonly BudgetEntry[], selector: HeroBudgetSelector = HERO_MOBILE_BUDGET): string[] {
  const problems: string[] = [];
  const entry = entries.find((e) => e.id === selector.id);
  const variant = entry?.variants.find((v) => v.name === selector.variant);
  const hero = variant?.files.find((f) => f.format === selector.format && f.width === selector.width);
  const label = `${selector.id}/${selector.variant} ${selector.width}px ${selector.format}`;
  if (!entry) problems.push(`budget selector: no manifest entry for ${selector.id}`);
  else if (!variant) problems.push(`budget selector: ${selector.id} has no ${selector.variant} variant`);
  else if (!hero) problems.push(`budget selector: ${label} derivative missing`);
  else if (hero.bytes > selector.maxBytes) problems.push(`${hero.file} is ${hero.bytes} bytes (> ${selector.maxBytes}) for the LCP hero`);
  for (const f of entries.flatMap((e) => e.variants.flatMap((v) => v.files))) {
    if (f.bytes > PER_FILE_MAX_BYTES) problems.push(`${f.file} is ${f.bytes} bytes (> ${PER_FILE_MAX_BYTES})`);
  }
  return problems;
}

/** The hero the page renders (from shared content) must be the image the budget selector measures. */
export function heroSelectorProblems(
  selector: HeroBudgetSelector,
  rendered: { id: string; mobileVariant: string },
): string[] {
  const problems: string[] = [];
  if (selector.id !== rendered.id) problems.push(`budget selector measures ${selector.id} but the Home hero renders ${rendered.id}`);
  if (selector.variant !== rendered.mobileVariant) problems.push(`budget selector measures the ${selector.variant} variant but the Home hero renders ${rendered.mobileVariant} on phones`);
  return problems;
}
