// Single navigation model for the public header. The React Navbar and the server-rendered ssrNavbar()
// both read this file, so the five top-level entries, the dropdown contents and the header action can
// not drift between the two emitters.
//
// Destinations follow the owner's navigation map. Solutions and Pricing & programs now point at their
// own overview pages (/payment-processing and /pricing-and-programs). Sign-in utilities use the two
// existing authenticated entrances: "Account sign in" (/login, the shared sign-in page) and "Partner sign
// in" (/partner-login). No "Merchant login" label is used because the repository does not prove a merchant-
// only journey at /login. The equipment offer card keeps the published "Free Smart Terminal" label (the
// page and offer-parameter name recorded in W-A); its description stays neutral and the page itself
// carries the qualification wording.

import { FST_NAV_DESCRIPTION } from "./free-smart-terminal-content";
import { industryHref, NAV_INDUSTRY_SLUGS, PUBLIC_INDUSTRIES } from "./public-industries";

export interface PublicNavLink {
  label: string;
  href: string;
  /** Neutral one-line description shown under the label in dropdowns. */
  description?: string;
}

export interface PublicNavOffer extends PublicNavLink {
  /**
   * Offer cards are secondary: shown only while the offer is current and approved. The wording
   * for each comes from shared contracts, never from a literal promotion in a component.
   */
  current: boolean;
}

export type PublicNavGroupId = "solutions" | "equipment" | "industries" | "resources" | "company";

export interface PublicNavGroup {
  id: PublicNavGroupId;
  label: string;
  /** Where the top-level label itself goes (also the crawlable target in the server-rendered header). */
  href: string;
  links: readonly PublicNavLink[];
  offer?: PublicNavOffer;
}

const industryLabel = (slug: string): string => PUBLIC_INDUSTRIES.find((i) => i.slug === slug)?.label ?? slug;

export const PUBLIC_NAV_GROUPS: readonly PublicNavGroup[] = [
  {
    id: "solutions",
    label: "Solutions",
    href: "/payment-processing",
    links: [
      { label: "Payment processing", href: "/payment-processing", description: "Where to start with processing, equipment and integrations" },
      { label: "POS & integrations", href: "/integrations", description: "Tell us your platform and we confirm what is supported" },
      { label: "Online payments", href: industryHref("ecommerce-payment-processing"), description: "Ecommerce checkout and payment links" },
      { label: "Pricing & programs", href: "/pricing-and-programs", description: "Program options and how pricing is structured" },
      { label: "Liberty Zero", href: "/0-percent-processing", description: "Cash discount and surcharging program review" },
    ],
  },
  {
    id: "equipment",
    label: "Equipment",
    href: "/shop",
    links: [
      { label: "Terminals & equipment", href: "/shop", description: "Terminal, POS and accessory options" },
      { label: "Equipment fit", href: "/integrations", description: "Check equipment against the systems you use" },
    ],
    offer: {
      label: "Free Smart Terminal",
      href: "/free-smart-terminal",
      description: FST_NAV_DESCRIPTION,
      current: true,
    },
  },
  {
    id: "industries",
    label: "Industries",
    href: "/industries",
    links: [
      ...NAV_INDUSTRY_SLUGS.map((slug) => ({ label: industryLabel(slug), href: industryHref(slug) })),
      { label: "All industries", href: "/industries" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    href: "/learn",
    links: [
      { label: "Guides", href: "/learn", description: "Plain-language payment processing guides" },
      { label: "Blog", href: "/blog", description: "Articles on fees, statements and equipment" },
      { label: "Compare processors", href: "/compare-rates", description: "Published pricing, with the source and date checked" },
      { label: "FAQs", href: "/faq", description: "Answers to common processing questions" },
      { label: "Case studies", href: "/case-studies", description: "How other merchants approached a change" },
      { label: "Tools", href: "/savings-calculator", description: "Calculators for your own numbers" },
      { label: "Help", href: "/help", description: "Help center for common questions and setup" },
    ],
    offer: {
      label: "Statement review",
      href: "/upload-statement",
      description: "Upload a statement to review your processing costs",
      current: true,
    },
  },
  {
    id: "company",
    label: "Company",
    href: "/about-contact",
    links: [
      { label: "Why Liberty", href: "/why-liberty-bancard" },
      { label: "About & contact", href: "/about-contact" },
      { label: "Partner program", href: "/partners" },
    ],
  },
];

/** Header action. One primary action keeps phone headers compact; offers live in the menus and Home. */
export const PUBLIC_NAV_CTA: PublicNavLink = { label: "Talk to Liberty", href: "/about-contact" };

/** Utility links beside the header action: support first, then the two sign-in entrances. */
export const PUBLIC_NAV_UTILITIES: readonly PublicNavLink[] = [
  { label: "Support", href: "/support" },
  { label: "Account sign in", href: "/login" },
  { label: "Partner sign in", href: "/partner-login" },
];

/** First utility (Support); kept for callers that name a single utility link. */
export const PUBLIC_NAV_UTILITY: PublicNavLink = PUBLIC_NAV_UTILITIES[0];

/** True for same-document anchors on Home, which must navigate natively so the browser scrolls to them. */
export const isHomeAnchor = (href: string): boolean => href.startsWith("/#");

/**
 * Public pages that exist only as server renders (the glossary hub and its term pages). The client router has no
 * route for them, so a client-side navigation would land on the not-found page; links to them must be native
 * anchors so the browser requests the server document.
 */
export const isServerOnlyPublicPath = (href: string): boolean => href === "/learn" || href.startsWith("/learn/") || href.startsWith("/learn?") || href.startsWith("/learn#");

/** True when a link must navigate natively instead of through the client router. */
export const needsNativeNavigation = (href: string): boolean => isHomeAnchor(href) || isServerOnlyPublicPath(href);

export const navTestId = (...parts: string[]): string =>
  parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).join("-");
