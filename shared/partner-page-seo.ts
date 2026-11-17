/**
 * Document metadata for the six partnership routes that carry a server-rendered document (and /affiliate, which has its own
 * record in shared/public-affiliate.ts). The React pages (SEO component), the server documents (server/ssr/partners.ts),
 * the route registry (shared/seo-routes.ts) and the tests read this one record, so the title, description, canonical and
 * h1 a crawler indexes are the ones the page shows after it loads.
 *
 * No commercial figure lives here. No database or server imports: the client bundle imports this file.
 */
import { PARTNER_HUB_HERO, PARTNER_REFERRAL_JOURNEY, PARTNER_AGENT_JOURNEY, PARTNER_ROUTES } from "./partner-public-content";
import { PARTNER_PROFESSION_PAGES } from "./partner-profession-content";

export interface PartnerPageSeo {
  route: string;
  /** Complete document title, site name included (the React SEO component does not append it twice). */
  title: string;
  description: string;
  keywords: string;
  /** The page's one h1 text. */
  h1: string;
  /** Short label for the breadcrumb and the WebPage schema name. */
  name: string;
}

export const PARTNER_SSR_ROUTES = [
  PARTNER_ROUTES.hub,
  PARTNER_ROUTES.referral,
  PARTNER_ROUTES.salesAgent,
  PARTNER_ROUTES.cpa,
  PARTNER_ROUTES.bookkeeper,
  PARTNER_ROUTES.insurance,
] as const;
export type PartnerSsrRoute = (typeof PARTNER_SSR_ROUTES)[number];

export const PARTNER_PAGE_SEO: Record<PartnerSsrRoute, PartnerPageSeo> = {
  [PARTNER_ROUTES.hub]: {
    route: PARTNER_ROUTES.hub,
    title: "Partnerships — Referral Partners & Sales Agents | Liberty Bancard",
    description: "Introduce a business that needs payment processing, or build your own portfolio as a sales agent. Compare the two Liberty Bancard partnership paths and apply.",
    keywords: "payment processing referral partner, merchant services sales agent, Liberty Bancard partnerships",
    h1: PARTNER_HUB_HERO.heading,
    name: "Liberty partnerships",
  },
  [PARTNER_ROUTES.referral]: {
    route: PARTNER_ROUTES.referral,
    title: "Referral Partner Program | Liberty Bancard",
    description: "Introduce businesses that agreed to hear from Liberty Bancard. Our team handles the sales, onboarding and support. Apply as a referral partner.",
    keywords: "referral partner, payment processing referral",
    h1: PARTNER_REFERRAL_JOURNEY.heading,
    name: "Referral partner program",
  },
  [PARTNER_ROUTES.salesAgent]: {
    route: PARTNER_ROUTES.salesAgent,
    title: "Become a Sales Agent | Liberty Bancard",
    description: "Build your own merchant portfolio with Liberty Bancard. Prospect, guide the sale and coordinate onboarding with our team. Apply as a sales agent.",
    keywords: "merchant services sales agent, payment processing agent",
    h1: PARTNER_AGENT_JOURNEY.heading,
    name: "Sales agent program",
  },
  [PARTNER_ROUTES.cpa]: professionSeo("cpa", "CPA referral partners"),
  [PARTNER_ROUTES.bookkeeper]: professionSeo("bookkeeper", "Bookkeeper referral partners"),
  [PARTNER_ROUTES.insurance]: professionSeo("insurance", "Insurance agent referral partners"),
};

function professionSeo(id: "cpa" | "bookkeeper" | "insurance", name: string): PartnerPageSeo {
  const page = PARTNER_PROFESSION_PAGES[id];
  return { route: page.route, title: page.seo.title, description: page.seo.description, keywords: page.seo.keywords, h1: page.heading, name };
}

export function isPartnerSsrRoute(path: string): path is PartnerSsrRoute {
  return (PARTNER_SSR_ROUTES as readonly string[]).includes(path);
}
