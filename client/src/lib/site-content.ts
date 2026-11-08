/**
 * Public-site content module (headline, calls to action, navigation links).
 *
 * Claim wording and claim approval live in shared/public-claims.ts, which
 * requires an evidence key before any claim can render. Statistics and the
 * savings range below carry an explicit evidence state. Nothing marked
 * "unverified" or "withheld" may be rendered publicly until an owner
 * evidence record exists (see docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md).
 */

export const SITE_H1 = "Credit Card Processing Without the Rate Games";

export const SITE_SUBHEADLINE =
  "Upload a recent processing statement and we'll show your effective rate, markup, monthly fees, and hidden charges — before you switch.";

export const SITE_PRIMARY_CTA_LABEL = "Upload My Statement — Free";
export const SITE_PRIMARY_CTA_HREF = "/upload-statement";
export const SITE_SECONDARY_CTA_LABEL = "Book a review call";

export const SITE_HERO_BADGE = "South Florida Merchant Services";

/**
 * Company statistics. Evidence state for every record is "unverified": no
 * founding, merchant-count or processing-volume record is on file in this
 * repository, so none may be rendered as a public claim until the owner
 * supplies one. Hardcoded copies elsewhere are listed in the public claims
 * record for the site-wide statistics workstream.
 */
export const SITE_STATS = [
  {
    id: "years_in_business",
    value: "10+",
    countUpEnd: 10,
    label: "Years in Business",
    sublabel: "South Florida roots, nationwide reach",
    evidenceState: "unverified",
    source: "No verification record on file; owner evidence required before public use",
    measuredAs: "Calendar years of operation from founding",
  },
  {
    id: "merchants_served",
    value: "5,000+",
    countUpEnd: 5000,
    label: "Merchants Served",
    sublabel: "Across every major vertical",
    evidenceState: "unverified",
    source: "No verification record on file; owner evidence required before public use",
    measuredAs: "Cumulative approved merchant accounts, all-time",
  },
  {
    id: "processing_volume_annual_m",
    value: "$2.4B+",
    countUpEnd: 2400,
    label: "Annual Processing Volume",
    sublabel: "Across merchant processing programs",
    evidenceState: "unverified",
    source: "No verification record on file; owner evidence required before public use",
    measuredAs: "Annual card processing volume in US dollars, billions",
  },
] as const;

/**
 * General savings range: withheld. The earlier range was derived from case
 * figures that are historical customer facts, not a benchmark, and the case
 * records disagree between the React page and the server-rendered page.
 * A savings claim needs a documented source and population; until then no
 * page may state a range.
 */
export const SAVINGS_RANGE = {
  state: "withheld",
  reason: "No documented benchmark or realized-savings population on file.",
  disclaimer: "Actual cost depends on your statement, card mix, volume and eligibility.",
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
