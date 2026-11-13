/**
 * Website source-domain provenance (single owner).
 *
 * A directory, aggregator, profile or government host is where a business was *seen*, not evidence that the
 * business owns the site. Discovery rejection (Serper identity matching, contact-page stage) and recipient
 * advancement all use this one list so they cannot drift apart. It classifies a host by its registrable
 * domain only; it never looks at a person's or business's name and never reclassifies a record. A match means
 * "needs independent ownership evidence before it can advance", and the evidence stays in review.
 */

export const DIRECTORY_AND_PROFILE_DOMAINS: readonly string[] = [
  "google.com", "gstatic.com", "googleapis.com", "sunbiz.org",
  "wikipedia.org", "reddit.com", "pinterest.com", "tiktok.com",
  "apple.com", "amazon.com", "nextdoor.com", "dandb.com",
  "indeed.com", "glassdoor.com", "facebook.com", "linkedin.com",
  "yelp.com", "bbb.org", "yellowpages.com", "mapquest.com",
  "tripadvisor.com", "chamberofcommerce.com", "manta.com",
  "angi.com", "thumbtack.com", "homeadvisor.com", "instagram.com",
  "twitter.com", "x.com", "bing.com", "yahoo.com",
  "whitepages.com", "bizbuysell.com",
];

/** Government hosts: .gov, .mil, .gov.xx country forms and state-agency hosts (state.fl.us). */
const GOVERNMENT_HOST_PATTERNS: readonly RegExp[] = [
  /(^|\.)gov$/, /(^|\.)mil$/, /(^|\.)gov\.[a-z]{2}$/, /(^|\.)state\.[a-z]{2}\.us$/,
];

export type WebsiteSourceDomainKind = "government" | "directory";

/** Canonical lowercase host without scheme, path, port or leading "www."; null when it is not a plausible host. */
export function hostFromWebsite(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function classifyWebsiteSourceDomain(value: string | null | undefined): WebsiteSourceDomainKind | null {
  const host = hostFromWebsite(value);
  if (!host) return null;
  if (GOVERNMENT_HOST_PATTERNS.some(p => p.test(host))) return "government";
  if (DIRECTORY_AND_PROFILE_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "directory";
  return null;
}

/** True when the site is a directory/profile/government host (never proof the business owns it). */
export const isDirectoryOrGovernmentDomain = (value: string | null | undefined) => classifyWebsiteSourceDomain(value) !== null;

/**
 * Registry-owned or CRM-owned organization links are the independent evidence that a business exists apart from
 * where discovery saw it. A provider import by itself is not independent: it is the same observation again.
 *
 * This list names the link TYPES that can be independent. It is not, by itself, proof about a particular website: the
 * recipient gates and the review cohorts pass source types qualified by server/services/website-ownership-evidence-sql.ts,
 * which keeps an independent type only when the link's recorded evidence names the same website host as the business
 * (policy: domain ownership as recorded by an independent source; business existence or affiliation alone does not clear
 * the hold). An unrelated or silent organization link arrives as "<type>:website_not_confirmed" and is not recognised here.
 */
export const INDEPENDENT_OWNERSHIP_SOURCE_TYPES: readonly string[] = ["organization", "organization_location", "crm_organization"];

export const hasIndependentOwnershipEvidence = (sourceTypes: readonly (string | null | undefined)[]) =>
  sourceTypes.some(type => typeof type === "string" && INDEPENDENT_OWNERSHIP_SOURCE_TYPES.includes(type));

/** A business with a directory/government website advances only with independent ownership evidence. */
export function websiteSourceNeedsOwnershipReview(
  website: string | null | undefined, sourceTypes: readonly (string | null | undefined)[],
): boolean {
  return isDirectoryOrGovernmentDomain(website) && !hasIndependentOwnershipEvidence(sourceTypes);
}

/** Parameter-safe SQL pieces for bounded review reads: exact hosts and LIKE suffix patterns over a lowercase host column. */
export function sourceDomainSqlPatterns(): { exact: string[]; like: string[] } {
  return {
    exact: [...DIRECTORY_AND_PROFILE_DOMAINS],
    like: [
      ...DIRECTORY_AND_PROFILE_DOMAINS.map(d => `%.${d}`),
      "%.gov", "%.mil", "%.gov.__", "%.state.__.us", "gov.__", "state.__.us",
    ],
  };
}

export const WEBSITE_SOURCE_REVIEW_COPY = {
  government: "This website is a government host. A government site shows where the business was found, not that it owns the site.",
  directory: "This website is a directory or profile host. It shows where the business was found, not that it owns the site.",
  action: "It stays in review and cannot become an outreach recipient until independent business ownership evidence (a registry or CRM organization link) exists. A validated email address does not change that.",
} as const;
