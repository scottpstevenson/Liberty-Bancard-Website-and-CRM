// Content for the 14 /industries/:slug pages, read by the server documents (server/ssr/industries.ts)
// and the React page (client/src/pages/IndustryPage.tsx). It replaces two diverging copies, one with
// eight entries and one with fourteen, that both carried average rates, savings figures, uptime
// guarantees, certification statements and integration lists nobody had sourced (W-D, WD-R05).
//
// Rules for this file: no rate, dollar figure, savings estimate, speed or uptime promise, count,
// certification or named-integration list. Where a platform or funding question comes up the answer is
// an approved claim from shared/public-claims.ts, and a buyer who needs a specific integration is
// asked to tell us the platform so we can confirm it.

import { claimText } from "./public-claims";
import { ABOUT_CONTACT_PATH } from "./public-contact-content";
import { PUBLIC_INDUSTRIES } from "./public-industries";

export interface IndustryItem {
  title: string;
  description: string;
}

export interface IndustryFaq {
  question: string;
  answer: string;
}

export interface IndustryContent {
  slug: string;
  name: string;
  heroTitle: string;
  heroSubtitle: string;
  /** Without the brand suffix; each renderer appends it the same way. */
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  /** Where payment cost and friction usually show up for this kind of business. */
  considerations: readonly IndustryItem[];
  faqs: readonly IndustryFaq[];
}

const COMPAT = (platform: string): IndustryFaq => ({
  question: `Can I keep my current ${platform}?`,
  answer: claimText("compat.inquiry"),
});

const FUNDING = (question: string): IndustryFaq => ({ question, answer: claimText("funding.availability") });

const CONTRACT: IndustryFaq = {
  question: "What does the agreement say about equipment and ending it?",
  answer: claimText("equipment.agreement.summary"),
};

const PROGRAM: IndustryFaq = {
  question: "Is a cash discount or surcharge program an option?",
  answer: claimText("program.overview"),
};

export const INDUSTRY_CONTENT: readonly IndustryContent[] = [
  {
    slug: "restaurant-payment-processing",
    name: "Restaurant",
    heroTitle: "Payment Processing Built for Restaurants",
    heroSubtitle:
      "Tips, split checks, table service and busy hours shape how a restaurant takes payments. Start by seeing what you pay today, then compare your options.",
    metaTitle: "Restaurant Payment Processing",
    metaDescription:
      "Payment processing for restaurants: what to ask about tips, split checks and your point of sale. Start with a free statement review.",
    keywords: "restaurant payment processing, restaurant credit card processing, restaurant merchant services, restaurant POS payments",
    considerations: [
      { title: "Tips and split checks", description: "Ask how tip adjustments and split checks are priced, and how each appears on the statement." },
      { title: "Processing bundled with your POS", description: "Some point-of-sale companies bundle processing. Ask which fees come from the POS and which from processing." },
      { title: "Deposits and cash flow", description: "Ask when sales are deposited and what can delay a deposit." },
      { title: "Support during service", description: "Ask who you reach when a terminal stops working at the busiest hour, and when they are available." },
    ],
    faqs: [
      COMPAT("POS system"),
      { question: "How do tip adjustments affect what I pay?", answer: "Pricing for tips depends on your pricing model and your terminal settings. A statement review shows how tips appear on your current statement." },
      PROGRAM,
      FUNDING("How fast will I receive my deposits?"),
      CONTRACT,
    ],
  },
  {
    slug: "retail-payment-processing",
    name: "Retail",
    heroTitle: "Payment Processing for Retail Businesses",
    heroSubtitle:
      "Whether you run one storefront or several, your costs depend on the mix of cards your customers use and the terms of your agreement. Start with your statement.",
    metaTitle: "Retail Payment Processing",
    metaDescription:
      "Payment processing for retail stores: card mix, equipment terms and multiple locations. Start with a free statement review.",
    keywords: "retail payment processing, retail credit card processing, store payment processing, retail merchant services",
    considerations: [
      { title: "How card types are priced", description: "Debit, credit and rewards cards cost different amounts. Ask how each is charged under the pricing model you are offered." },
      { title: "Equipment terms", description: claimText("equipment.agreement.summary") },
      { title: "Slow months", description: "Ask whether any monthly minimum or fixed fee applies when sales are low." },
      { title: "Disputes and chargebacks", description: "Ask how a chargeback is handled, what it costs and what evidence you will be asked for." },
    ],
    faqs: [
      COMPAT("point of sale or terminals"),
      { question: "What if I have more than one store?", answer: "Bring a statement for each location if they are billed separately. We will note how each is set up." },
      { question: "What equipment can I use?", answer: claimText("equipment.options.summary") },
      CONTRACT,
    ],
  },
  {
    slug: "ecommerce-payment-processing",
    name: "Ecommerce",
    heroTitle: "Payment Processing for Online Stores",
    heroSubtitle:
      "Online sales add a gateway, card-not-present pricing and disputes to the picture. See which charges come from which provider before you change anything.",
    metaTitle: "Ecommerce Payment Processing",
    metaDescription:
      "Payment processing for online stores: gateway charges, card-not-present pricing and platform questions. Start with a free statement review.",
    keywords: "ecommerce payment processing, online payment processing, payment gateway, online store merchant account",
    considerations: [
      { title: "Gateway and processor charges", description: claimText("review.taxonomy.summary") },
      { title: "Card-not-present pricing", description: "Online payments are priced differently from in-person ones. Ask how each channel is charged." },
      { title: "Your platform", description: "Your store platform or cart may limit which gateways and processors work with it. Check before you commit." },
      { title: "Disputes and fraud checks", description: "Ask how disputes are handled, what they cost and what tools are available to review risky orders." },
    ],
    faqs: [
      COMPAT("store platform or gateway"),
      { question: "Do I need a separate gateway?", answer: "That depends on your platform and the processor you choose. Tell us your platform and we will confirm what is needed." },
      FUNDING("When are online sales deposited?"),
      CONTRACT,
    ],
  },
  {
    slug: "healthcare-payment-processing",
    name: "Healthcare",
    heroTitle: "Payment Processing for Healthcare Providers",
    heroSubtitle:
      "Front-desk payments, balances after insurance and payment plans each show up differently on a statement. See what you pay today before you compare options.",
    metaTitle: "Healthcare Payment Processing",
    metaDescription:
      "Payment processing for healthcare practices: front-desk payments, balances and payment plans. Start with a free statement review.",
    keywords: "healthcare payment processing, medical practice payment processing, medical billing payments, patient payments",
    considerations: [
      { title: "Front-desk and balance payments", description: "Ask how in-office, phone and online balance payments are priced and reported." },
      { title: "Payment plans", description: "If you collect on a schedule, ask how cards are stored and how a failed payment is handled." },
      { title: "Your billing software", description: "Ask how payment reports reconcile with your practice or billing software, and which fees come from that software." },
      { title: "Your own obligations", description: "Payment card security and patient-record privacy are separate obligations. Ask your compliance advisor what applies to your practice." },
    ],
    faqs: [
      COMPAT("practice management or billing software"),
      { question: "Is a statement review a compliance review?", answer: "No. A statement review looks at processing charges. Questions about patient-record privacy rules go to your own compliance advisor." },
      FUNDING("How fast will my deposits arrive?"),
      CONTRACT,
    ],
  },
  {
    slug: "professional-services-payment-processing",
    name: "Professional Services",
    heroTitle: "Payment Processing for Professional Services",
    heroSubtitle:
      "Invoices, retainers and recurring billing move money differently from retail checkout. See how your current setup charges for each.",
    metaTitle: "Professional Services Payment Processing",
    metaDescription:
      "Payment processing for professional services firms: invoices, payment links and recurring billing. Start with a free statement review.",
    keywords: "professional services payment processing, invoice payments, payment links, recurring billing, consultant payment processing",
    considerations: [
      { title: "Invoice and payment-link payments", description: "Ask how a payment taken from an emailed invoice or link is priced compared with one taken in person." },
      { title: "Retainers and deposits", description: "Ask how larger advance payments are priced and whether they can be held." },
      { title: "Recurring billing", description: "Ask who runs the schedule, your software or the processor, and what each one charges." },
      { title: "Your invoicing software", description: "Your invoicing or practice software may add its own payment fees. Ask which fees come from it." },
    ],
    faqs: [
      COMPAT("invoicing or billing software"),
      { question: "Can clients pay by card from an invoice?", answer: "That depends on your invoicing software and the processor behind it. Tell us how you invoice today and we will confirm what is available." },
      FUNDING("Will large payments be held?"),
      CONTRACT,
    ],
  },
  {
    slug: "auto-repair-payment-processing",
    name: "Auto Repair",
    heroTitle: "Payment Processing for Auto Repair Shops",
    heroSubtitle:
      "Repair invoices run larger than most retail tickets, so the percentage and any per-transaction fee matter more. See how they appear on your statement.",
    metaTitle: "Auto Repair Payment Processing",
    metaDescription:
      "Payment processing for auto repair shops: larger invoices, keyed-in payments and commercial cards. Start with a free statement review.",
    keywords: "auto repair payment processing, auto shop credit card processing, mechanic payment processing, garage merchant services",
    considerations: [
      { title: "Larger invoices", description: "A percentage fee adds up on a large repair bill. Ask how both the percentage and any per-transaction fee apply." },
      { title: "Keyed-in and phone payments", description: "Ask how payments taken by phone or keyed in are priced compared with card-present ones." },
      { title: "Commercial and fleet cards", description: "Ask how commercial and fleet cards are handled and whether extra invoice data is needed." },
      { title: "Deposits before parts are ordered", description: "Ask whether card deposits are available on your account and how they are priced." },
    ],
    faqs: [
      COMPAT("shop management software"),
      FUNDING("Will large repair invoices be held?"),
      { question: "Can I take payments away from the counter?", answer: "Mobile and remote payment options depend on your account and equipment. Tell us how you take payments today and we will confirm what is available." },
      CONTRACT,
    ],
  },
  {
    slug: "salon-spa-payment-processing",
    name: "Salon & Spa",
    heroTitle: "Payment Processing for Salons and Spas",
    heroSubtitle:
      "Appointments, tips, retail sales and cards kept on file all pass through your processor. See which charges come from processing and which from your booking software.",
    metaTitle: "Salon and Spa Payment Processing",
    metaDescription:
      "Payment processing for salons and spas: tips, retail sales and cards on file. Start with a free statement review.",
    keywords: "salon payment processing, spa payment processing, barbershop payment processing, beauty salon credit card processing",
    considerations: [
      { title: "Tips at checkout", description: "Ask when the tip is entered and how tip adjustments after the card is read are priced." },
      { title: "Cards on file", description: "If you charge for late cancellations, ask how stored cards are handled and what your clients agree to." },
      { title: "Booking software fees", description: "Your booking and payment tools may be bundled. Ask which fees come from the software." },
      { title: "Chair and booth rental", description: "If chairs are rented, ask who is responsible for each stylist's payments and how they are reported." },
    ],
    faqs: [
      COMPAT("booking software"),
      PROGRAM,
      { question: "Can I charge a no-show fee?", answer: "That depends on your booking software, your client agreement and your account setup. Tell us how you handle cancellations today and we will confirm what applies." },
      CONTRACT,
    ],
  },
  {
    slug: "construction-payment-processing",
    name: "Construction",
    heroTitle: "Payment Processing for Construction Companies",
    heroSubtitle:
      "Construction payments are large, often invoiced and sometimes made with commercial cards. Know how each is charged before you take the next progress payment.",
    metaTitle: "Construction Payment Processing",
    metaDescription:
      "Payment processing for contractors: deposits, progress payments and invoices paid by card. Start with a free statement review.",
    keywords: "construction payment processing, contractor credit card processing, home services payment processing, contractor merchant services",
    considerations: [
      { title: "Deposits and progress payments", description: "Ask how a large deposit or progress payment is priced and whether it can be held." },
      { title: "Commercial cards", description: "Ask how commercial cards are priced and whether extra invoice data changes the charge." },
      { title: "Payments in the field", description: "Ask what mobile options exist and how a payment taken by phone is priced." },
      { title: "Invoice payments", description: "If clients pay invoices online, ask how the payment link or portal is provided and what it costs." },
    ],
    faqs: [
      COMPAT("estimating or invoicing software"),
      FUNDING("Will a large deposit be held?"),
      { question: "Can I take payments on a job site?", answer: "Mobile payment options depend on your account and equipment. Tell us how you take payments today and we will confirm what is available." },
      CONTRACT,
    ],
  },
  {
    slug: "dental-payment-processing",
    name: "Dental",
    heroTitle: "Payment Processing for Dental Practices",
    heroSubtitle:
      "Treatment payments, balances after insurance and deposits before larger procedures each affect your statement. See how your current processor charges for them.",
    metaTitle: "Dental Practice Payment Processing",
    metaDescription:
      "Payment processing for dental practices: treatment payments, patient balances and payment plans. Start with a free statement review.",
    keywords: "dental payment processing, dental practice credit card processing, dentist merchant services, patient payment plans",
    considerations: [
      { title: "Larger treatment payments", description: "Ask how fees apply to one large payment compared with several smaller ones." },
      { title: "Patient payment plans", description: "If you split larger balances, ask how stored cards are used and who sets the schedule." },
      { title: "Reconciliation with practice software", description: "Ask for a sample report and compare it with how your front desk reconciles today." },
      { title: "Third-party patient financing", description: "Patient financing programs are separate from card processing. Tell us what you use so we can say what a review does and does not cover." },
    ],
    faqs: [
      COMPAT("practice management software"),
      FUNDING("How fast will my deposits arrive?"),
      { question: "Is a statement review a compliance review?", answer: "No. A statement review looks at processing charges. Questions about patient-record privacy rules go to your own compliance advisor." },
      CONTRACT,
    ],
  },
  {
    slug: "med-spa-payment-processing",
    name: "Med Spa",
    heroTitle: "Payment Processing for Med Spas",
    heroSubtitle:
      "Treatment packages, memberships and prepaid sessions make a med spa's payments different from a retail counter. See how they appear on your statement.",
    metaTitle: "Med Spa Payment Processing",
    metaDescription:
      "Payment processing for med spas: treatment packages, memberships and cards on file. Start with a free statement review.",
    keywords: "med spa payment processing, medical spa merchant services, aesthetics clinic credit card processing, treatment package payments",
    considerations: [
      { title: "Packages and prepaid sessions", description: "Ask how a payment for several future treatments is priced and what happens if a client asks for a refund." },
      { title: "Memberships and cards on file", description: "Ask how recurring charges and stored cards are handled and what clients agree to." },
      { title: "Deposits for appointments", description: "Ask whether card deposits are available on your account and how they are priced." },
      { title: "What an application asks", description: claimText("equipment.eligibility.questions") },
    ],
    faqs: [
      COMPAT("booking or clinic software"),
      PROGRAM,
      FUNDING("How fast will my deposits arrive?"),
      CONTRACT,
    ],
  },
  {
    slug: "legal-payment-processing",
    name: "Legal",
    heroTitle: "Payment Processing for Law Firms",
    heroSubtitle:
      "Retainers, hourly invoices and funds held for clients raise questions most retail processors never address. Start with how your current setup charges and reports.",
    metaTitle: "Law Firm Payment Processing",
    metaDescription:
      "Payment processing for law firms: retainers, invoices and client payments. Start with a free statement review.",
    keywords: "law firm payment processing, attorney credit card processing, legal retainer payments, lawyer merchant services",
    considerations: [
      { title: "Retainers and advance payments", description: "Ask how larger advance payments are priced and whether they can be held." },
      { title: "Client funds and your own rules", description: "Rules on funds held for clients come from your own regulator. Ask your advisor how card payments should be handled; a statement review does not give legal or ethics advice." },
      { title: "Invoice and link payments", description: "Ask how a payment taken from an emailed invoice or link is priced compared with one taken in person." },
      { title: "Your billing software", description: "Your practice or billing software may add payment fees. Ask which fees come from it." },
    ],
    faqs: [
      COMPAT("practice management or billing software"),
      { question: "Does a statement review cover trust-account rules?", answer: "No. A statement review looks at processing charges. Questions about handling client funds go to your own advisor or regulator." },
      FUNDING("Will large payments be held?"),
      CONTRACT,
    ],
  },
  {
    slug: "accounting-payment-processing",
    name: "Accounting",
    heroTitle: "Payment Processing for Accounting Firms",
    heroSubtitle:
      "Client invoices, recurring billing and busy-season spikes all pass through your processor. See how your current setup charges for each.",
    metaTitle: "Accounting Firm Payment Processing",
    metaDescription:
      "Payment processing for accounting firms: client invoices, recurring billing and seasonal volume. Start with a free statement review.",
    keywords: "accounting firm payment processing, CPA credit card processing, bookkeeping payment processing, client invoice payments",
    considerations: [
      { title: "Client invoice payments", description: "Ask how a payment taken from an emailed invoice or link is priced compared with one taken in person." },
      { title: "Recurring billing", description: "Ask who runs recurring charges, your software or the processor, and what each one charges." },
      { title: "Busy-season volume", description: "Ask whether any monthly minimum or fixed fee applies in quiet months and whether volume spikes change pricing." },
      { title: "Your billing software", description: "Your practice or billing software may add payment fees. Ask which fees come from it." },
    ],
    faqs: [
      COMPAT("practice management or accounting software"),
      FUNDING("Will large payments be held?"),
      { question: "Can clients set up recurring payments?", answer: "That depends on your billing software and the processor behind it. Tell us how you bill today and we will confirm what is available." },
      CONTRACT,
    ],
  },
  {
    slug: "fitness-payment-processing",
    name: "Fitness",
    heroTitle: "Payment Processing for Gyms and Fitness Studios",
    heroSubtitle:
      "Memberships, class packs and failed recurring payments are the center of a gym's billing. See which charges come from processing and which from your membership software.",
    metaTitle: "Gym and Fitness Payment Processing",
    metaDescription:
      "Payment processing for gyms and fitness studios: memberships, recurring billing and failed payments. Start with a free statement review.",
    keywords: "gym payment processing, fitness studio credit card processing, membership billing, recurring payment processing",
    considerations: [
      { title: "Recurring billing", description: "Ask who runs the recurring charges, your software or the processor, and what each charges." },
      { title: "Failed payments", description: "Ask how declined membership payments are retried and what your staff can see." },
      { title: "Membership software fees", description: "Membership software often adds its own payment fees. Ask which fees come from the software." },
      { title: "Front-desk sales", description: "Ask how retail and drop-in payments at the desk are priced compared with membership charges." },
    ],
    faqs: [
      COMPAT("membership software"),
      { question: "Can members update their card online?", answer: "That depends on your membership software and the gateway it uses. Tell us your platform and we will confirm what is supported." },
      FUNDING("How fast will my deposits arrive?"),
      CONTRACT,
    ],
  },
  {
    slug: "hospitality-payment-processing",
    name: "Hospitality",
    heroTitle: "Payment Processing for Hotels and Hospitality",
    heroSubtitle:
      "Check-in holds, final charges, group billing and remote reservations are priced differently. See how your current statement treats each.",
    metaTitle: "Hotel and Hospitality Payment Processing",
    metaDescription:
      "Payment processing for hotels and hospitality businesses: holds, group billing and reservations. Start with a free statement review.",
    keywords: "hotel payment processing, hospitality credit card processing, group billing payments, reservation payments",
    considerations: [
      { title: "Holds and final charges", description: "Ask how a hold at check-in becomes the final charge and what happens when the amounts differ." },
      { title: "Remote reservations", description: "Cards that are not present at the desk are priced differently. Ask how each channel is charged." },
      { title: "Group and event billing", description: "Ask how deposits, master billing and event payments are handled and reported." },
      { title: "Your property system", description: "Your property management system may limit which processors connect to it. Check before you commit." },
    ],
    faqs: [
      COMPAT("property management system"),
      FUNDING("How fast will my deposits arrive?"),
      { question: "Can I take deposits for group bookings?", answer: "That depends on your account and your property system. Tell us how you take group deposits today and we will confirm what is available." },
      CONTRACT,
    ],
  },
];

const CONTENT_BY_SLUG = new Map(INDUSTRY_CONTENT.map((entry) => [entry.slug, entry]));

export function getIndustryContent(slug: string | undefined): IndustryContent | undefined {
  return slug === undefined ? undefined : CONTENT_BY_SLUG.get(slug);
}

// Fail loudly at import time if the navigation inventory and this content ever disagree: every listed
// industry route must have content, and content must not exist for a route nobody links to.
{
  const listed = new Set(PUBLIC_INDUSTRIES.map((entry) => entry.slug as string));
  const missing = [...listed].filter((slug) => !CONTENT_BY_SLUG.has(slug));
  const extra = INDUSTRY_CONTENT.map((entry) => entry.slug).filter((slug) => !listed.has(slug));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Industry content out of sync with PUBLIC_INDUSTRIES. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
  }
}

// ── Shared page sections ───────────────────────────────────────────────────

export const INDUSTRY_PRIMARY_ACTION = { label: "Get a free statement review", href: "/upload-statement" } as const;
export const INDUSTRY_SECONDARY_ACTION = { label: "Ask a question without a statement", href: `${ABOUT_CONTACT_PATH}#inquiry` } as const;

/**
 * Illustrative hero photograph per industry template (public imagery registry ids, see
 * client/src/lib/public-imagery.ts). Both the React page and the server document read this map, so a route
 * shows the same picture in the first HTML and after hydration. A slug with no entry has a text-only
 * hero: no registered image fits it honestly, and none is forced.
 */
export const INDUSTRY_HERO_IMAGES: Readonly<Record<string, string>> = {
  "restaurant-payment-processing": "industry-restaurant",
  "retail-payment-processing": "industry-retail",
  "auto-repair-payment-processing": "industry-automotive",
  "dental-payment-processing": "industry-dental",
  "med-spa-payment-processing": "industry-med-spa",
  "construction-payment-processing": "industry-field-services",
  "ecommerce-payment-processing": "industry-ecommerce",
  "professional-services-payment-processing": "industry-professional-services",
};

export const INDUSTRY_HERO_PICTURE = {
  variant: "card",
  sizes: "(min-width: 1024px) 380px, 100vw",
  caption: "Illustrative photo. It does not show a Liberty customer.",
} as const;

export interface IndustrySections {
  considerationsHeading: string;
  considerationsIntro: string;
  reviewHeading: string;
  reviewIntro: string;
  review: readonly IndustryItem[];
  faqHeading: string;
  faqIntro: string;
  ctaHeading: string;
  ctaBody: string;
  crosslinksHeading: string;
}

export function industrySections(content: IndustryContent): IndustrySections {
  const lower = content.name.toLowerCase();
  return {
    considerationsHeading: `What to ask about ${lower} payment processing`,
    considerationsIntro: `Questions worth answering before you change processors, whatever you decide.`,
    reviewHeading: "What a statement review covers",
    reviewIntro: "A review starts from your own statement, so it reflects what you pay today.",
    review: [
      { title: "Charges sorted by type", description: claimText("review.taxonomy.summary") },
      { title: "A defined effective cost", description: claimText("review.effective-cost.definition") },
      { title: "Free, with no obligation", description: claimText("review.cost.free") },
      { title: "A follow-up from our team", description: claimText("review.process.summary") },
    ],
    faqHeading: `${content.name} payment processing: questions`,
    faqIntro: `Questions ${lower} owners ask before they change processors.`,
    ctaHeading: "See what you are paying",
    ctaBody: `${claimText("review.cost.free", "page")} ${claimText("review.process.summary", "page")}`,
    crosslinksHeading: "Payment processing for other industries",
  };
}
