/**
 * Document title and page heading of /affiliate. The server document (server/ssr/pages.ts) and the React page
 * (client/src/pages/AffiliateProgram.tsx) both read this record, so the headline and title a visitor or crawler sees
 * before the page loads are the ones they see after it loads. Same pattern as shared/public-locations.ts.
 *
 * No database or server imports: the client bundle imports this file.
 */

export const AFFILIATE_PATH = "/affiliate";

const HEADING_LEAD = "Earn Residual Income Referring";
const HEADING_ACCENT = "Merchants";

export const AFFILIATE_PAGE = {
  path: AFFILIATE_PATH,
  /** The complete document title, site name included (52 characters). The React page passes brandSuffix={false}. */
  title: "Affiliate Program | Earn Residuals | Liberty Bancard",
  /** The page's one h1: the React hero renders headingLead and headingAccent in two colours, the server document renders heading. */
  headingLead: HEADING_LEAD,
  headingAccent: HEADING_ACCENT,
  heading: `${HEADING_LEAD} ${HEADING_ACCENT}`,
} as const;
