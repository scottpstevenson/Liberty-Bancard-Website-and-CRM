// Industry index for the public navigation and the /industries hub. Every entry is an existing
// /industries/:slug page (shared/blog-slugs.ts INDUSTRY_SLUGS); the hub lists all of them so no
// industry page is reachable only through a shortcut. Labels and descriptions are navigational:
// they carry no pricing, savings, eligibility or compatibility statement.

import { INDUSTRY_SLUGS } from "./blog-slugs";

export interface PublicIndustryEntry {
  slug: (typeof INDUSTRY_SLUGS)[number];
  label: string;
  /** What the page covers, in navigational terms only. */
  summary: string;
}

export const PUBLIC_INDUSTRIES: readonly PublicIndustryEntry[] = [
  { slug: "restaurant-payment-processing", label: "Restaurants", summary: "Tips, table service and peak-hour checkout." },
  { slug: "retail-payment-processing", label: "Retail", summary: "Counter checkout, contactless and multiple locations." },
  { slug: "ecommerce-payment-processing", label: "Ecommerce", summary: "Online checkout, payment links and gateway questions." },
  { slug: "healthcare-payment-processing", label: "Healthcare", summary: "Front-desk payments and patient billing." },
  { slug: "professional-services-payment-processing", label: "Professional services", summary: "Invoices, payment links and retainer billing." },
  { slug: "auto-repair-payment-processing", label: "Auto repair", summary: "Higher-ticket repair and parts payments." },
  { slug: "salon-spa-payment-processing", label: "Salon & spa", summary: "Appointments, tips and cards on file." },
  { slug: "construction-payment-processing", label: "Construction", summary: "On-site and invoice-based payments." },
  { slug: "dental-payment-processing", label: "Dental", summary: "Practice payments and patient balances." },
  { slug: "med-spa-payment-processing", label: "Med spa", summary: "Treatment packages and recurring payments." },
  { slug: "legal-payment-processing", label: "Legal", summary: "Retainers and client payment handling." },
  { slug: "accounting-payment-processing", label: "Accounting", summary: "Client invoices and recurring billing." },
  { slug: "fitness-payment-processing", label: "Fitness", summary: "Memberships and recurring payments." },
  { slug: "hospitality-payment-processing", label: "Hospitality", summary: "Front-desk, on-site and event payments." },
];

/** The six shortcuts shown in the Industries menu; the hub lists the rest. */
export const NAV_INDUSTRY_SLUGS: readonly string[] = [
  "restaurant-payment-processing",
  "retail-payment-processing",
  "ecommerce-payment-processing",
  "healthcare-payment-processing",
  "professional-services-payment-processing",
  "auto-repair-payment-processing",
];

export const industryHref = (slug: string): string => `/industries/${slug}`;

export const INDUSTRIES_HUB = {
  path: "/industries",
  title: "Payment Processing by Industry",
  description:
    "Browse Liberty Bancard payment processing pages by industry, from restaurants and retail to healthcare, professional services and ecommerce.",
  keywords: "payment processing by industry, merchant services industries, restaurant payment processing, retail payment processing",
  heading: "Payment processing by industry",
  intro:
    "Choose your industry to see how payments typically work for it and what to ask before changing processors.",
} as const;
