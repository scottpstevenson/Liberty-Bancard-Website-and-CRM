import { SEO_ROUTE_DEFAULTS } from "./seo-routes";
import { STATIC_BLOG_SLUGS } from "./blog-slugs";
import { PUBLIC_INDUSTRIES } from "./public-industries";
import { LOCATION_HUB_PATHS, LOCATION_DETAIL_PATHS } from "./public-locations";
import { COMPARE_ENTRIES } from "./compare-content";

const PUBLIC_DYNAMIC_PATHS = new Set<string>([...STATIC_BLOG_SLUGS.map(slug => `/blog/${slug}`), ...PUBLIC_INDUSTRIES.map(row => `/industries/${row.slug}`), ...LOCATION_HUB_PATHS, ...LOCATION_DETAIL_PATHS, ...Object.keys(COMPARE_ENTRIES).map(slug => `/compare/${slug}`)]);

const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
// Campaigns use machine-readable labels; free text, addresses, tokens and arbitrary queries are not attribution.
export function safeCampaignValue(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.+ -]{0,119}$/.test(value) &&
    (!/\d{7,}/.test(value) || /^(?:gads|campaign|ad|ag|kw)_[0-9]{4,24}$/.test(value))
    ? value
    : undefined;
}

export function publicTrackingContext(
  pathname: string,
  search = "",
  origin = "https://libertybancard.com",
) {
  const safePath = pathname;
  const route = SEO_ROUTE_DEFAULTS[safePath] ?? (PUBLIC_DYNAMIC_PATHS.has(safePath) ? { title: "Payment Processing | Liberty Bancard", noindex: false } : null);
  if (
    !route ||
    route.noindex ||
    /^\/(?:dashboard|mobile|api|sales|merchant-application|statement-upload|proposal)(?:\/|$)/.test(
      pathname,
    )
  )
    return null;
  const params = new URLSearchParams(search),
    clean = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = safeCampaignValue(params.get(key));
    if (value) clean.set(key, value);
  }
  return {
    page_path: safePath,
    page_title: route.title,
    page_location: origin + safePath + (clean.size ? `?${clean}` : ""),
  };
}

export function safeReferrer(value: string): string {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin + "/" : "";
  } catch {
    return "";
  }
}
