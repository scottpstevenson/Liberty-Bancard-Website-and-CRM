// Single source of truth for the /integrations page and every other surface
// that talks about software or hardware compatibility (React page, server
// rendered HTML, route metadata, JSON-LD). Each product has an explicit
// compatibility state. A product is "confirmed" only when written evidence
// exists in the server-only register; otherwise it is "inquiry-required" and is
// shown without an active checkmark, without a supported-hardware list and
// without any fee, savings or "keep your system" assertion.

import { claimText } from "./public-claims";
import { TIMING_NOTE } from "./public-disclosures";

export type CompatibilityState = "confirmed" | "inquiry-required" | "unsupported";

export type IntegrationCategory =
  | "POS Systems"
  | "Accounting"
  | "eCommerce"
  | "Practice Management"
  | "Scheduling"
  | "CRM";

export interface IntegrationRecord {
  id: string;
  name: string;
  category: IntegrationCategory;
  state: CompatibilityState;
  /** Neutral description of the third-party product. Never a Liberty capability claim. */
  summary: string;
  /** What we need to know to confirm the path. */
  askAbout: string;
  /** Present only for a confirmed record: the integration path and any limitation. */
  path?: string;
  limitation?: string;
  /** Opaque key into the server-only evidence register. Required when state is "confirmed". */
  evidenceKey?: string;
  learnMoreUrl?: string;
}

export const INTEGRATION_RECORDS: readonly IntegrationRecord[] = [
  { id: "clover", name: "Clover POS", category: "POS Systems", state: "inquiry-required", summary: "A point-of-sale and payments platform with its own devices and plans.", askAbout: "Which Clover device and plan you use, and whether your agreement ties it to Clover payments." },
  { id: "dejavoo", name: "Dejavoo Terminals", category: "POS Systems", state: "inquiry-required", summary: "Countertop and wireless payment terminals.", askAbout: "Your Dejavoo model and how it is configured today." },
  { id: "pax", name: "PAX Terminals", category: "POS Systems", state: "inquiry-required", summary: "Smart payment terminals used in retail and multi-lane environments.", askAbout: "Your PAX model and how it is configured today." },
  { id: "toast", name: "Toast POS", category: "POS Systems", state: "inquiry-required", summary: "A restaurant point-of-sale platform with its own hardware and payments.", askAbout: "Your Toast hardware, plan and current payment agreement." },
  { id: "square", name: "Square (Migration)", category: "POS Systems", state: "inquiry-required", summary: "A point-of-sale and payments platform. Moving off Square affects hardware, software and payment terms.", askAbout: "Your Square hardware and any current agreement. Whether hardware can be reused is confirmed case by case.", learnMoreUrl: "/beat-square-stripe" },
  { id: "quickbooks", name: "QuickBooks", category: "Accounting", state: "inquiry-required", summary: "Accounting software used to reconcile card deposits and fees.", askAbout: "Which QuickBooks product you use and how you reconcile card deposits today." },
  { id: "xero", name: "Xero", category: "Accounting", state: "inquiry-required", summary: "Accounting software used to reconcile deposits and fees.", askAbout: "Which Xero plan you use and how you reconcile deposits today." },
  { id: "wave", name: "Wave Accounting", category: "Accounting", state: "inquiry-required", summary: "Accounting software for small businesses.", askAbout: "How you import transactions and match deposits today." },
  { id: "shopify", name: "Shopify / Shopify Payments", category: "eCommerce", state: "inquiry-required", summary: "An online store platform with its own payments option.", askAbout: "Your Shopify plan, your checkout setup, and which payment gateways your plan can use." },
  { id: "woocommerce", name: "WooCommerce", category: "eCommerce", state: "inquiry-required", summary: "A WordPress store plugin that connects to payment gateways through plugins.", askAbout: "Your WooCommerce version and which payment plugin you use today." },
  { id: "bigcommerce", name: "BigCommerce", category: "eCommerce", state: "inquiry-required", summary: "An online store platform that connects to payment gateways.", askAbout: "Your BigCommerce plan and which gateways it supports for your store." },
  { id: "authorize-net", name: "Authorize.net", category: "eCommerce", state: "inquiry-required", summary: "A payment gateway for online and recurring payments.", askAbout: "Whether you already have a gateway account and which gateway your platform supports." },
  { id: "mindbody", name: "Mindbody", category: "Practice Management", state: "inquiry-required", summary: "Booking and business software for fitness and wellness studios.", askAbout: "Your Mindbody plan and whether it supports outside payment processing." },
  { id: "jane-app", name: "Jane App", category: "Practice Management", state: "inquiry-required", summary: "Practice management software for health and wellness practices.", askAbout: "Your Jane plan and whether it supports outside payment processing." },
  { id: "drchrono", name: "DrChrono", category: "Practice Management", state: "inquiry-required", summary: "Electronic health record and practice software.", askAbout: "How front-desk card payments are collected today." },
  { id: "acuity", name: "Acuity Scheduling", category: "Scheduling", state: "inquiry-required", summary: "Appointment scheduling software that can collect payments at booking.", askAbout: "Your Acuity plan and how you collect payments or deposits today." },
  { id: "calendly", name: "Calendly", category: "Scheduling", state: "inquiry-required", summary: "Scheduling software that can collect payments at booking.", askAbout: "Your Calendly plan and how you collect payments today." },
  { id: "vagaro", name: "Vagaro", category: "Scheduling", state: "inquiry-required", summary: "Booking and business software for salons, spas and studios.", askAbout: "Your Vagaro plan and whether it supports outside payment processing." },
  { id: "salesforce", name: "Salesforce", category: "CRM", state: "inquiry-required", summary: "A customer relationship management platform.", askAbout: "What data you want in your CRM and how you would move it." },
  { id: "hubspot", name: "HubSpot", category: "CRM", state: "inquiry-required", summary: "A customer relationship management platform.", askAbout: "What data you want in your CRM and how you would move it." },
  { id: "zoho", name: "Zoho CRM", category: "CRM", state: "inquiry-required", summary: "A customer relationship management platform.", askAbout: "What data you want in your CRM and how you would move it." },
];

export const INTEGRATION_CATEGORIES: readonly { name: IntegrationCategory; description: string }[] = [
  { name: "POS Systems", description: "Terminals, registers, and point-of-sale systems" },
  { name: "Accounting", description: "Bookkeeping and financial reporting software" },
  { name: "eCommerce", description: "Online stores and payment gateways" },
  { name: "Practice Management", description: "Healthcare and professional services platforms" },
  { name: "Scheduling", description: "Appointment and booking management tools" },
  { name: "CRM", description: "Customer relationship management platforms" },
];

export const COMPAT_STATE_LABEL: Record<CompatibilityState, string> = {
  confirmed: "Confirmed",
  "inquiry-required": "Inquiry required",
  unsupported: "Not supported",
};

/** The only states that may show an active checkmark. */
export function showsActiveCheck(record: IntegrationRecord): boolean {
  return record.state === "confirmed" && Boolean(record.evidenceKey) && Boolean(record.path);
}

export const INTEGRATIONS_PATH = "/integrations";

export const INTEGRATIONS_META = {
  title: "Software Integrations & Compatibility | Liberty Bancard",
  description: `Tell us your POS, accounting or eCommerce software. ${claimText("compat.inquiry.meta", "meta")}`,
  keywords:
    "payment processing compatibility, POS compatibility, QuickBooks payment processing, Shopify payment gateway, Clover payment processing, merchant software compatibility",
  schemaDescription: claimText("compat.inquiry", "schema"),
  schemaAbout: "Compatibility review for payment processing and business software",
} as const;

export const INTEGRATIONS_HERO = {
  badge: "Software Compatibility",
  headingLead: "Check Compatibility",
  headingAccent: "With Your Software",
  sub: claimText("compat.inquiry"),
  primaryCta: "Get My Free Analysis",
  browseCta: "Browse the Directory",
} as const;

export const INTEGRATIONS_CALLOUT = {
  title: "Confirmed before you change anything",
  text: "Each product below is listed as inquiry required until we have confirmed the path, any hardware limits and any costs for your setup. Listing a product here is not a statement that it is compatible.",
} as const;

export function integrationStats(records: readonly IntegrationRecord[] = INTEGRATION_RECORDS): { stat: string; label: string }[] {
  const categories = new Set(records.map((r) => r.category));
  return [
    { stat: String(records.length), label: "Products listed" },
    { stat: String(categories.size), label: "Categories" },
  ];
}

export const INTEGRATIONS_DIRECTORY = {
  heading: "Integration Directory",
  subheading:
    "Organized by category. Each entry shows what we would need to know to confirm compatibility. Don't see your software? Ask us during your free statement review.",
} as const;

export const INTEGRATIONS_PROCESS = {
  heading: "How Compatibility Is Confirmed",
  steps: [
    { title: "You tell us your setup", text: "Your platform, product or version, and how you take payments today." },
    { title: "We check the path", text: "We confirm supported options, hardware limits and any limitations for your setup." },
    { title: "You decide", text: "We tell you what is confirmed and what is not, and what it would cost, before you change anything." },
  ],
  footnote: "Eligibility, underwriting, card brand rules, and applicable laws apply.",
} as const;

export const INTEGRATIONS_REQUEST = {
  heading: "Don't See Your Software?",
  sub: `Tell us which POS, EHR, booking tool, or accounting system you use. ${TIMING_NOTE}`,
  toastTitle: "Request received",
  toastBody: "Thanks. We'll review your request and contact you about next steps.",
  successBody: "A Liberty Bancard specialist will review your request and follow up about your software. Need it sooner? Call",
} as const;

export const INTEGRATIONS_CTA = {
  heading: "Check Compatibility With Your Software",
  body: "Tell us what you use during your free statement review. We'll confirm what is supported, and any limitations, before you switch anything.",
} as const;
