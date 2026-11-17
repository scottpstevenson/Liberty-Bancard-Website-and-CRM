/**
 * Document title, description and page heading of /affiliate. The server document (server/ssr/pages.ts) and the React
 * page (client/src/pages/AffiliateProgram.tsx) both read this record, so the headline and title a visitor or crawler sees
 * before the page loads are the ones they see after it loads. Same pattern as shared/public-locations.ts.
 *
 * The page is the entry for existing affiliate accounts and sends new applicants to the referral-partner application.
 * It carries no compensation figure: referral compensation is set in a written agreement.
 *
 * No database or server imports: the client bundle imports this file.
 */

export const AFFILIATE_PATH = "/affiliate";

const HEADING_LEAD = "Introduce a business to";
const HEADING_ACCENT = "Liberty Bancard";

export const AFFILIATE_PAGE = {
  path: AFFILIATE_PATH,
  /** The complete document title, site name included. The React page passes brandSuffix={false}. */
  title: "Affiliate and Referral Accounts | Liberty Bancard",
  description: "Sign in to your Liberty Bancard affiliate account, or apply as a referral partner. Compensation is set in a written agreement.",
  /** Hero paragraph shared by the server document and the React page. */
  intro: "Existing affiliates can sign in to their dashboard. New to partnering with Liberty? Apply as a referral partner: you introduce a business with its permission, and our team handles the sales conversation and onboarding.",
  /** The page's one h1: the React hero renders headingLead and headingAccent in two colours, the server document renders heading. */
  headingLead: HEADING_LEAD,
  headingAccent: HEADING_ACCENT,
  heading: `${HEADING_LEAD} ${HEADING_ACCENT}`,
} as const;
