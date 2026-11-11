/**
 * Browser-tab / search-result titles for blog posts, shared by the server renderer (server/ssr/blog-ssr-data.ts) and the
 * React page (client/src/pages/BlogPost.tsx) so a crawler and a hydrated visitor see the same <title>.
 *
 * The page headline (h1) is not affected. The whole document title, including the " | Liberty Bancard" suffix, stays within
 * the 70-character budget that scripts/seo-audit.ts enforces. Headlines that would push it past 70 get a shorter document
 * title here; every other post uses its headline unchanged.
 */
export const BLOG_BRAND_SUFFIX = " | Liberty Bancard";
export const BLOG_DOCUMENT_TITLE_MAX = 70;

const SHORTER_DOCUMENT_TITLES: Record<string, string> = {
  "good-credit-card-processing-rate-for-my-business": "What's a Good Card Processing Rate for a Business?",
  "interchange-plus-vs-flat-rate-pricing-comparison": "Interchange Plus vs. Flat Rate: Which Is Better?",
  "cash-discount-vs-surcharging-what-is-legal": "Cash Discount vs. Surcharging: What Is Legal?",
  "how-to-implement-cash-discount-program": "How to Implement a Legal Cash Discount Program",
  "best-credit-card-terminals-small-business-2025": "Best Credit Card Terminals for Small Business 2025",
  "square-vs-dedicated-merchant-account-when-to-upgrade": "Square vs. Merchant Account: When to Upgrade",
};

export function blogDocumentTitle(slug: string, headline: string): string {
  return `${SHORTER_DOCUMENT_TITLES[slug] ?? headline}${BLOG_BRAND_SUFFIX}`;
}

/** Slugs whose document title differs from the headline (read by the content contract check). */
export const BLOG_SHORTER_TITLE_SLUGS: readonly string[] = Object.keys(SHORTER_DOCUMENT_TITLES);
