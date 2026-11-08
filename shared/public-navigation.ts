// Single navigation model for the public header. The React Navbar and the server-rendered ssrNavbar()
// both read this file, so the five top-level entries, the dropdown contents and the header action can
// not drift between the two emitters.
//
// Destinations follow the owner's navigation map. Two proposed destinations (/payment-processing and
// /pricing-and-programs) have no approved page or terms yet; until they exist the entries point at the
// relevant Home section instead of a guessed or empty page. "Merchant login" is omitted: no owner-
// confirmed URL exists in this repository, and a URL must not be guessed. The equipment offer card keeps
// the published "Free Smart Terminal" label (the page and offer-parameter name recorded in W-A); its
// description stays neutral and the page itself carries the qualification wording.

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
    href: "/#solutions",
    links: [
      { label: "Payment processing", href: "/#solutions", description: "Where to start with processing, equipment and integrations" },
      { label: "POS & integrations", href: "/integrations", description: "Tell us your platform and we confirm what is supported" },
      { label: "Online payments", href: industryHref("ecommerce-payment-processing"), description: "Ecommerce checkout and payment links" },
      { label: "Pricing & programs", href: "/#processing-options", description: "Program options and how pricing is structured" },
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

/** Utility link beside the header action. */
export const PUBLIC_NAV_UTILITY: PublicNavLink = { label: "Support", href: "/support" };

/** True for same-document anchors on Home, which must navigate natively so the browser scrolls to them. */
export const isHomeAnchor = (href: string): boolean => href.startsWith("/#");

export const navTestId = (...parts: string[]): string =>
  parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).join("-");
