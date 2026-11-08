// One dataset for every competitor comparison surface: the React comparison page,
// the server-rendered comparison pages, the rates overview page, route metadata
// and the SEO audit. Competitor rates are read only from dated price records.
// Liberty-side prices, savings, example costs and contract/termination
// assertions are not stated anywhere here: Liberty terms come from the written
// quote and agreement, and a like-for-like comparison comes from the merchant's
// own statement.

import { claimText } from "./public-claims";
import {
  PRICE_CHECKED_ON,
  UNPUBLISHED_RATE_PROVIDERS,
  formatCheckedDate,
  formatMonthly,
  formatRate,
  priceRecordsFor,
  type PriceRecord,
} from "./competitor-pricing";

export interface CompareRow {
  feature: string;
  provider: string;
  liberty: string;
}

export interface CompareFaq {
  question: string;
  answer: string;
}

export interface CompareEntry {
  slug: string;
  name: string;
  fullName: string;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroDescription: string;
  /** Dated rate records, empty when the provider publishes no single rate. */
  records: PriceRecord[];
  /** Shown when the provider has no published rate. */
  unpublishedNote: string | null;
  rows: CompareRow[];
  providerFit: string;
  libertyFit: string;
  faqs: CompareFaq[];
}

interface Seed {
  slug: string;
  name: string;
  fullName: string;
  model: string;
  fit: string;
  keywords: string;
}

const SEEDS: readonly Seed[] = [
  {
    slug: "square",
    name: "Square",
    fullName: "Square (Block, Inc.)",
    model: "Flat rate, published by channel and plan",
    fit: "Sellers who want an all-in-one point-of-sale app with a published flat rate and, on the Free plan, no monthly fee.",
    keywords: "square alternative, square vs liberty bancard, square payment processing fees, square competitor",
  },
  {
    slug: "stripe",
    name: "Stripe",
    fullName: "Stripe, Inc.",
    model: "Flat rate per successful transaction, published by channel",
    fit: "Teams building custom online payment flows with developer tools and platform features.",
    keywords: "stripe alternative, stripe vs liberty bancard, stripe payment processing fees, stripe competitor",
  },
  {
    slug: "clover",
    name: "Clover",
    fullName: "Clover (Fiserv)",
    model: "Plan-based; the rate varies by plan and business type",
    fit: "Businesses that want point-of-sale hardware, software and payments from one vendor.",
    keywords: "clover alternative, clover vs liberty bancard, clover payment processing fees, clover competitor",
  },
  {
    slug: "toast",
    name: "Toast",
    fullName: "Toast, Inc.",
    model: "Quoted; no single published rate",
    fit: "Restaurants that want an integrated restaurant point-of-sale and payments from one vendor.",
    keywords: "toast alternative, toast vs liberty bancard, toast payment processing fees, restaurant payment processing",
  },
  {
    slug: "paypal",
    name: "PayPal",
    fullName: "PayPal Holdings, Inc.",
    model: "Flat rate by payment type",
    fit: "Sellers whose customers expect PayPal or Venmo at checkout, or who want a simple in-person reader.",
    keywords: "paypal alternative, paypal vs liberty bancard, paypal business fees, paypal competitor",
  },
  {
    slug: "helcim",
    name: "Helcim",
    fullName: "Helcim Inc.",
    model: "Interchange-plus with published volume tiers",
    fit: "Businesses that want interchange-plus pricing with published volume tiers.",
    keywords: "helcim alternative, helcim vs liberty bancard, helcim pricing, helcim competitor",
  },
  {
    slug: "authorize-net",
    name: "Authorize.Net",
    fullName: "Authorize.Net (Visa)",
    model: "Gateway plans with a monthly fee",
    fit: "Online businesses that need a payment gateway with recurring billing and customer data management.",
    keywords: "authorize.net alternative, authorize.net vs liberty bancard, authorize.net fees, payment gateway comparison",
  },
];

export const COMPARE_LIBERTY_FIT =
  "Businesses that want their costs explained line by line from their own statement, with every fee, term and equipment arrangement stated in writing before they decide.";

export const COMPARE_METHOD_NOTE = claimText("price.comparison.method");

/** What a like-for-like comparison needs, so no figure is shown without its inputs. */
export const COMPARE_NEEDS = {
  heading: "What a Like-for-Like Comparison Needs",
  intro:
    "We do not publish a savings figure for any provider. A comparison is only meaningful with your own numbers, calculated for the same period.",
  items: [
    "Your monthly card volume and number of transactions (or average ticket) for the same period",
    "Every recurring charge, including monthly, gateway, statement, PCI and equipment fees",
    "Equipment, lease or rental costs, and any early termination terms in your current agreement",
    "Your card mix and how each card is accepted (in person, keyed or online)",
    "Any fee we cannot see on the statement, which we mark as unknown rather than assume",
  ],
  footnote:
    "If a material cost is unknown, we say so and do not state a complete all-in savings figure. " +
    claimText("review.effective-cost.definition"),
} as const;

export function describeRecord(record: PriceRecord): string {
  const rate = formatRate(record);
  const monthly = record.monthlyFeeCents === null ? "" : `, ${formatMonthly(record.monthlyFeeCents)}`;
  return `${record.plan} (${record.channel}): ${rate}${monthly}`;
}

function recordSummary(records: PriceRecord[]): string {
  return records.map(describeRecord).join("; ");
}

function buildEntry(seed: Seed): CompareEntry {
  const records = priceRecordsFor(seed.slug);
  const unpublishedNote = UNPUBLISHED_RATE_PROVIDERS[seed.slug] ?? null;
  const checked = formatCheckedDate(PRICE_CHECKED_ON);

  const rateCell = records.length
    ? records.map((r) => `${formatRate(r)} (${r.channel})`).join(" · ")
    : (unpublishedNote ?? "No single rate published; see the provider's current pricing page");
  const monthlyRecord = records.find((r) => r.monthlyFeeCents !== null);
  const monthlyCell = monthlyRecord
    ? formatMonthly(monthlyRecord.monthlyFeeCents as number) + ` (${monthlyRecord.plan})`
    : "See the provider's current pricing page";

  const rows: CompareRow[] = [
    {
      feature: "Published processing rate",
      provider: records.length ? `${rateCell}. Checked ${checked}.` : rateCell,
      liberty: "Quoted for your business after statement review and shown in writing",
    },
    {
      feature: "Pricing model",
      provider: seed.model,
      liberty: "Interchange-plus; cash discount and surcharging programs reviewed where they fit*",
    },
    {
      feature: "Monthly fee",
      provider: monthlyCell,
      liberty: "Stated in your written quote",
    },
    {
      feature: "Contract, termination and equipment terms",
      provider: "Set by your agreement with the provider",
      liberty: "Set by your written processing agreement; review it before you sign",
    },
    {
      feature: "How cost is compared",
      provider: "Depends on your volume, card mix, ticket size and the plan you are on",
      liberty: "Your own statement, with the inputs shown",
    },
  ];

  const rateAnswer = records.length
    ? `As of ${checked}, ${seed.name}'s official pricing page lists: ${recordSummary(records)}. ${COMPARE_METHOD_NOTE}`
    : `${unpublishedNote ?? `${seed.name} does not publish a single rate we can cite.`} Ask ${seed.name} for your current quote, or upload your statement and we will show the fees it already charges you.`;

  const faqs: CompareFaq[] = [
    { question: `What does ${seed.name} publish for processing rates?`, answer: rateAnswer },
    {
      question: `How does Liberty Bancard compare with ${seed.name}?`,
      answer:
        `A fair comparison needs your own statement: your volume, card mix, ticket size and every fee ${seed.name} charges. ` +
        `We calculate your effective cost for the same period and show the inputs. We do not publish a general savings figure for ${seed.name}.`,
    },
    {
      question: `Can I switch from ${seed.name} to Liberty Bancard?`,
      answer: `${claimText("compat.inquiry")} Check your current agreement for any termination or equipment terms before you change anything.`,
    },
    {
      question: "Does Liberty Bancard charge monthly fees?",
      answer:
        "Any recurring fees, equipment terms and other costs are stated in your written quote and processing agreement before you decide.",
    },
  ];

  return {
    slug: seed.slug,
    name: seed.name,
    fullName: seed.fullName,
    tagline: "Published Rates vs. a Statement-Based Quote",
    metaTitle: `Liberty Bancard vs ${seed.name} - Payment Processing Comparison`,
    metaDescription: records.length
      ? `Compare Liberty Bancard and ${seed.name}: dated, sourced ${seed.name} rates and how a like-for-like comparison is calculated from your own statement.`
      : `Compare Liberty Bancard and ${seed.name}: what ${seed.name} publishes and how a like-for-like comparison is calculated from your own statement.`,
    metaKeywords: seed.keywords,
    heroDescription: `${seed.name} publishes its pricing by plan and channel. Liberty Bancard quotes from your own statement. Here is how to compare the two like for like.`,
    records,
    unpublishedNote,
    rows,
    providerFit: seed.fit,
    libertyFit: COMPARE_LIBERTY_FIT,
    faqs,
  };
}

export const COMPARE_ENTRIES: Readonly<Record<string, CompareEntry>> = Object.freeze(
  Object.fromEntries(SEEDS.map((seed) => [seed.slug, buildEntry(seed)])),
);

export const COMPARE_SLUGS: readonly string[] = SEEDS.map((s) => s.slug);

export function getCompareEntry(slug: string): CompareEntry | null {
  return Object.prototype.hasOwnProperty.call(COMPARE_ENTRIES, slug) ? COMPARE_ENTRIES[slug] : null;
}

export const COMPARE_HERO_DISCLAIMER =
  "Actual cost depends on your statement, card mix, volume, and eligibility. No savings claims without a statement review.";

export const COMPARE_TABLE_FOOTNOTE =
  "*Eligibility, underwriting, card brand rules, and applicable laws apply. Provider rates are published list rates and may change.";

// ── Rates overview page (/compare-rates) ────────────────────────────────────

export const RATES_PAGE_PROVIDERS: readonly string[] = ["square", "stripe", "clover", "toast", "paypal", "helcim", "authorize-net"];

export const RATES_PAGE = {
  path: "/compare-rates",
  title: "Compare Payment Processor Rates",
  schemaName: "Published Payment Processor Rates - Liberty Bancard",
  description:
    "Published processing rates from official provider pages, dated, and how Liberty Bancard builds a like-for-like comparison from your own statement.",
  keywords: "payment processor comparison, published processing rates, credit card processing rates comparison",
  heading: "Published Processor Rates",
  subheading:
    "Rates below are copied from each provider's official pricing page and dated. They are list rates, not a quote for your business.",
  disclaimer: "No savings claims without a statement review. A provider's published rate is not your effective cost.",
  libertyRowNote: "Liberty Bancard quotes after reviewing your statement; the quote and agreement state every fee in writing.",
  faq: [
    {
      question: "Why does this page not show a Liberty Bancard rate?",
      answer:
        "Your cost depends on your volume, card mix, ticket size and the services you choose. We quote after a statement review and state every fee in writing, so a single advertised figure would not describe your account.",
    },
    {
      question: "Is a published flat rate the same as my effective cost?",
      answer:
        "No. A published rate is a list price for a plan and channel. Your effective cost is your total processing charges divided by your card volume for the same period, and it includes every recurring and per-item fee.",
    },
    {
      question: "How do I compare my own cost?",
      answer: `${COMPARE_NEEDS.intro} Upload your current processing statement and we will show a line-by-line breakdown with the inputs used. You keep the analysis whether or not you switch.`,
    },
    {
      question: "Why are some providers shown without a rate?",
      answer:
        "We only show a rate when an official provider page states it. When a provider quotes pricing individually, the table says so instead of estimating.",
    },
  ] as CompareFaq[],
} as const;

export interface RatesPageRow {
  provider: string;
  slug: string;
  detail: string;
  rate: string;
  monthly: string;
  channel: string;
  sourceUrl: string | null;
  checkedOn: string | null;
}

/** Rows for the rates overview table, one per dated record plus a row for each provider with no published rate. */
export function ratesPageRows(): RatesPageRow[] {
  const rows: RatesPageRow[] = [];
  for (const slug of RATES_PAGE_PROVIDERS) {
    const entry = COMPARE_ENTRIES[slug];
    if (!entry) continue;
    if (entry.records.length === 0) {
      rows.push({
        provider: entry.name,
        slug,
        detail: "Pricing quoted by the provider",
        rate: entry.unpublishedNote ?? "No single published rate",
        monthly: "-",
        channel: "-",
        sourceUrl: null,
        checkedOn: null,
      });
      continue;
    }
    for (const r of entry.records) {
      rows.push({
        provider: entry.name,
        slug,
        detail: `${r.product} - ${r.plan}${r.qualifier ? ` (${r.qualifier})` : ""}`,
        rate: formatRate(r),
        monthly: r.monthlyFeeCents === null ? "Not stated on the page" : formatMonthly(r.monthlyFeeCents),
        channel: r.channel,
        sourceUrl: r.sourceUrl,
        checkedOn: r.checkedOn,
      });
    }
  }
  return rows;
}

// ── Beat Square/Stripe page ─────────────────────────────────────────────────

export const BEAT_SQUARE_STRIPE = {
  path: "/beat-square-stripe",
  title: "Switching from Square or Stripe",
  description:
    "What Square and Stripe publish for processing rates, with dates and sources, and how Liberty Bancard builds a like-for-like comparison from your own statement.",
  keywords: "switch from square, switch from stripe, flat rate vs interchange plus, square alternative, stripe alternative",
  serviceDescription:
    "Interchange-plus payment processing, quoted from your own statement and stated in writing.",
  heading: "Switching from Square or Stripe",
  sub: "See what each provider publishes, dated and sourced, then compare it with your own statement before you change anything.",
} as const;

export function beatSquareStripeRecords(): PriceRecord[] {
  return [...priceRecordsFor("square"), ...priceRecordsFor("stripe")];
}
