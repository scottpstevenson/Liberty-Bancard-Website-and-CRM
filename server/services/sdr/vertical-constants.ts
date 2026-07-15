/**
 * Canonical coarse-vertical taxonomy — zero external dependencies.
 * This file must never import from db.ts, storage, or any route module.
 * Both helpers.ts and canonical-vertical-resolver.ts import from here.
 */

export const CANONICAL_COARSE_VERTICALS: ReadonlySet<string> = new Set([
  "Restaurant",
  "Auto",
  "Retail",
  "Salon/Spa",
  "Healthcare",
  "Fitness/Recreation",
  "Food/Beverage",
  "Construction",
  "Legal",
  "Accounting",
  "Professional Services",
  "Transportation",
  "Real Estate",
  "Insurance",
  "Hospitality",
  "Cleaning Services",
  "Marketing/Media",
  "Technology",
  "Education",
  "Manufacturing",
  "Other",
]);
