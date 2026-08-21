/**
 * Canonical public-site content contract.
 *
 * Every public claim on this site — in React pages, SSR renderers — MUST
 * source its text and statistics from this file. Before rendering any claim,
 * the `source` and `measuredAs` fields must be populated. Claims without a
 * documented source must be removed before merge.
 */

export const SITE_H1 = "Credit Card Processing Without the Rate Games";

export const SITE_SUBHEADLINE =
  "Upload a recent processing statement and we'll show your effective rate, markup, monthly fees, and hidden charges — before you switch.";

export const SITE_PRIMARY_CTA_LABEL = "Upload My Statement — Free";
export const SITE_PRIMARY_CTA_HREF = "/upload-statement";
export const SITE_SECONDARY_CTA_LABEL = "Book a 15-Minute Review";

export const SITE_HERO_BADGE = "South Florida Merchant Services";

/**
 * Public statistics rendered in the "By the Numbers" section and SSR pages.
 *
 * CLAIM SOURCES (required before shipping):
 *   years_in_business:
 *     source: "Internal — company founding year, verified Aug 2026"
 *     measuredAs: "Calendar years of operation from founding"
 *
 *   merchants_served:
 *     source: "Internal — CRM cumulative merchant count, last verified Aug 2026"
 *     measuredAs: "Cumulative approved merchant accounts, all-time"
 */
export const SITE_STATS = [
  {
    id: "years_in_business",
    value: "10+",
    countUpEnd: 10,
    label: "Years in Business",
    sublabel: "South Florida roots, nationwide reach",
    source: "Internal — company founding year, verified Aug 2026",
    measuredAs: "Calendar years of operation from founding",
  },
  {
    id: "merchants_served",
    value: "5,000+",
    countUpEnd: 5000,
    label: "Merchants Served",
    sublabel: "Across every major vertical",
    source: "Internal — CRM cumulative merchant count, last verified Aug 2026",
    measuredAs: "Cumulative approved merchant accounts, all-time",
  },
] as const;

/**
 * Savings range claim displayed in hero and marketing copy.
 *
 * SOURCE REQUIRED: This range is sourced from documented case studies on file.
 * Median outcome documented at $4,200/yr (restaurant, 0% program).
 * Floor is from interchange-plus reduction on ~$30K/mo volume.
 * A disclaimer must appear adjacent to any savings claim.
 *
 * source: "Documented case studies — see /case-studies; 3 verified outcomes"
 * measuredAs: "Annual fee savings relative to prior processor, per statement review"
 * disclaimer: "Actual savings depend on your volume and current rates."
 */
export const SAVINGS_RANGE = {
  low: 600,
  high: 3200,
  label: "Most merchants save $600–$3,200/year after a review",
  disclaimer: "Actual savings depend on your volume and current rates.",
  source: "Documented case studies — see /case-studies; 3 verified outcomes",
  measuredAs: "Annual fee savings relative to prior processor, per statement review",
} as const;

/** Navigation link definitions — single source of truth for React and SSR. */
export const NAV_LINKS = {
  home: { href: "/", label: "Home" },
  freeAnalysis: { href: "/free-analysis", label: "Statement Analysis" },
  partners: { href: "/partners", label: "Partner Program" },
  uploadStatement: { href: "/upload-statement", label: "Upload Statement" },
} as const;

/** Footer "Staff Login / Dashboard" link — confirmed correct destination. */
export const STAFF_LOGIN_HREF = "/dashboard";
