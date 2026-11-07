import type { PublicImageId } from "@/lib/public-imagery";

/** Sample findings shown in the labelled example review. Illustrative figures only; no real account. */
export interface SampleFinding {
  label: string;
  value: string;
  chip: string;
  tone: "negative" | "neutral" | "positive";
  testId?: string;
}

export const SAMPLE_FINDINGS: SampleFinding[] = [
  { label: "Effective rate", value: "3.47%", chip: "Above benchmark", tone: "negative", testId: "text-statement-audit-effective-rate" },
  { label: "Monthly fixed fees", value: "$127/mo", chip: "Recurring", tone: "negative", testId: "text-statement-audit-fixed-fees" },
  { label: "Downgrades / card mix", value: "23%", chip: "Reducible", tone: "negative" },
  { label: "Add-on fees (PCI, batch)", value: "$38/mo", chip: "Itemized", tone: "negative" },
  { label: "Funding timeline", value: "Next-day*", chip: "Eligibility", tone: "neutral" },
  { label: "Savings opportunity", value: "Identified", chip: "On review", tone: "positive" },
];

export const COMPLIANCE_LINE = "Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.";

/** Industry entrances on Home. Every slug is an existing /industries/:slug template. */
export interface HomeIndustry {
  slug: string;
  image: PublicImageId;
  title: string;
  bestFor: string;
}

export const HOME_INDUSTRIES: HomeIndustry[] = [
  { slug: "restaurant-payment-processing", image: "industry-restaurant", title: "Restaurants", bestFor: "Tip-adjust + weekend volume" },
  { slug: "healthcare-payment-processing", image: "industry-healthcare", title: "Medical, Dental & Medspa", bestFor: "Front-desk speed + clean deposits" },
  { slug: "auto-repair-payment-processing", image: "industry-automotive", title: "Automotive", bestFor: "High-ticket + chargeback safety" },
  { slug: "retail-payment-processing", image: "industry-retail", title: "Retail", bestFor: "Fast lines + contactless" },
  { slug: "construction-payment-processing", image: "industry-home-services", title: "Contractors & Field Services", bestFor: "On-the-job mobile acceptance" },
];

export const COMPARE_LINKS = [
  { href: "/compare/square", label: "Liberty vs Square", testId: "link-compare-square" },
  { href: "/compare/stripe", label: "Liberty vs Stripe", testId: "link-compare-stripe" },
  { href: "/compare/clover", label: "Liberty vs Clover", testId: "link-compare-clover" },
  { href: "/compare/toast", label: "Liberty vs Toast", testId: "link-compare-toast" },
  { href: "/compare/paypal", label: "Liberty vs PayPal", testId: "link-compare-paypal" },
] as const;
