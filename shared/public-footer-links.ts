/**
 * Public footer link groups, shared by the React footer and the server-rendered footer so both
 * surfaces expose the same destinations. Six groups: Payment solutions, Equipment, Industries,
 * Resources, Company and Legal. Each of the first five carries a "View all" link to its hub; Legal
 * lists every legal and consent page because those must stay readable. Contact details and the
 * do-not-sell notice are rendered separately by each footer.
 *
 * Staff-only entrances (dashboard, residual calculator, sales discovery pages, affiliate and the
 * old partner portal login) are intentionally not in the public footer. Partner and account sign-in
 * live in the header utilities and the Company group.
 */
import { industryHref, NAV_INDUSTRY_SLUGS, PUBLIC_INDUSTRIES } from "./public-industries";

/** Footer brand line. Neutral by design: no savings, proof or guarantee statement. */
export const PUBLIC_FOOTER_TAGLINE = "Payment processing, equipment and integrations, explained plainly.";

/** ISO and bank-relationship disclosure shown in both footers. Unchanged legal wording. */
export const PUBLIC_FOOTER_ISO_DISCLOSURE =
  "Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. Liberty Bancard is not a bank. All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor. Liberty Bancard facilitates payment processing services on behalf of its acquiring bank partner(s) and does not directly process transactions, hold merchant funds, or bear settlement risk.";

export interface PublicFooterLink {
  label: string;
  href: string;
}

export type PublicFooterGroupId = "solutions" | "equipment" | "industries" | "resources" | "company" | "legal";

export interface PublicFooterGroup {
  id: PublicFooterGroupId;
  label: string;
  links: PublicFooterLink[];
  /** Hub link for the group. Absent for Legal, which lists every page. */
  viewAll?: PublicFooterLink;
}

const industryLabel = (slug: string): string => PUBLIC_INDUSTRIES.find((i) => i.slug === slug)?.label ?? slug;

export const PUBLIC_FOOTER_GROUPS: PublicFooterGroup[] = [
  {
    id: "solutions",
    label: "Payment solutions",
    links: [
      { label: "Payment processing", href: "/payment-processing" },
      { label: "Pricing & programs", href: "/pricing-and-programs" },
      { label: "POS & integrations", href: "/integrations" },
      { label: "Online payments", href: industryHref("ecommerce-payment-processing") },
      { label: "Liberty Zero", href: "/0-percent-processing" },
      { label: "Statement review", href: "/upload-statement" },
    ],
    viewAll: { label: "View all payment solutions", href: "/payment-processing" },
  },
  {
    id: "equipment",
    label: "Equipment",
    links: [
      { label: "Terminals & equipment", href: "/shop" },
      { label: "Free Smart Terminal", href: "/free-smart-terminal" },
      { label: "Equipment fit", href: "/integrations" },
    ],
    viewAll: { label: "View all equipment", href: "/shop" },
  },
  {
    id: "industries",
    label: "Industries",
    links: NAV_INDUSTRY_SLUGS.map((slug) => ({ label: industryLabel(slug), href: industryHref(slug) })),
    viewAll: { label: "View all industries", href: "/industries" },
  },
  {
    id: "resources",
    label: "Resources",
    links: [
      { label: "Guides", href: "/learn" },
      { label: "Blog", href: "/blog" },
      { label: "Compare processors", href: "/compare-rates" },
      { label: "FAQs", href: "/faq" },
      { label: "Help center", href: "/help" },
      { label: "Case studies", href: "/case-studies" },
      { label: "Areas we serve", href: "/areas-served" },
    ],
    viewAll: { label: "View all resources", href: "/learn" },
  },
  {
    id: "company",
    label: "Company",
    links: [
      { label: "Why Liberty", href: "/why-liberty-bancard" },
      { label: "About & contact", href: "/about-contact" },
      { label: "Support", href: "/support" },
      { label: "Partner program", href: "/partners" },
      { label: "Account sign in", href: "/login" },
      { label: "Partner sign in", href: "/partner-login" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookie Policy", href: "/cookie-policy" },
      { label: "Advertising Disclosure", href: "/advertising-disclosure" },
      { label: "Accessibility", href: "/accessibility" },
      { label: "SMS Terms", href: "/sms-terms" },
      { label: "E-Sign Consent", href: "/esign-consent" },
      { label: "Surcharging Disclosure", href: "/surcharging-disclosure" },
      { label: "Merchant Policies", href: "/merchant-policies" },
      { label: "Security & Compliance", href: "/security-compliance" },
      { label: "Regulatory Notices", href: "/regulatory-notices" },
      { label: "Data Processing Agreement", href: "/data-processing-agreement" },
      { label: "Responsible AI", href: "/responsible-ai" },
      { label: "Testimonials Disclosure", href: "/testimonials-disclosure" },
      { label: "Law Enforcement Guidelines", href: "/law-enforcement" },
      { label: "Dispute Resolution", href: "/dispute-resolution" },
      { label: "Data Retention", href: "/data-retention" },
      { label: "TCPA Consent", href: "/tcpa-consent" },
      { label: "Refund Policy", href: "/refund-policy" },
      { label: "California Privacy (CCPA)", href: "/california-privacy" },
      { label: "ADA Compliance", href: "/ada-compliance" },
    ],
  },
];
