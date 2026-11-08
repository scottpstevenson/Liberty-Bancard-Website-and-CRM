// Dated, sourced competitor price records. Every public competitor rate is read
// from this file; nothing else may state a competitor rate. A record carries the
// provider, product/plan, channel, currency, percentage, fixed fee, official
// source page and the date the page was checked. A rate that cannot be read from
// an official page is not recorded: the provider is shown with no rate and an
// inquiry question instead.
//
// This module is dependency-free so it can be imported by React, server renderers
// and static checks alike.

export type PriceChannel = "in-person" | "online" | "gateway";

export interface PriceRecord {
  id: string;
  /** Matches a comparison slug. */
  provider: string;
  product: string;
  plan: string;
  channel: PriceChannel;
  currency: "USD";
  /** Percentage of the transaction amount, for example 2.6 for 2.6%. Null when the model has none. */
  percent: number | null;
  /** Fixed fee per transaction, in cents. Null when the model has none. */
  fixedFeeCents: number | null;
  /** Recurring monthly fee in cents when the same page states one for this plan. Null when not stated. */
  monthlyFeeCents: number | null;
  /** True when the percentage is an interchange markup rather than an all-in rate. */
  interchangePlus?: boolean;
  /** Wording the official page puts in front of the rate, such as "as little as". It must stay attached to the rate wherever the rate is shown. */
  ratePrefix?: string;
  /**
   * Plain-language scope the page states for this rate: the card types, channel or volume tier it applies to.
   * It does not repeat the monthly fee, which has its own field.
   */
  qualifier?: string;
  /** Official page the figures were read from. */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the page was last read. */
  checkedOn: string;
}

/** Date the official pages below were read for this release. */
export const PRICE_CHECKED_ON = "2026-11-08";

export const PRICE_RECORDS: readonly PriceRecord[] = [
  {
    id: "square.free.in-person",
    provider: "square",
    product: "Square",
    plan: "Square Free",
    channel: "in-person",
    currency: "USD",
    percent: 2.6,
    fixedFeeCents: 15,
    monthlyFeeCents: 0,
    qualifier: "tap, dip or swipe, with the monthly fee charged per location",
    sourceUrl: "https://squareup.com/us/en/pricing",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "square.free.online",
    provider: "square",
    product: "Square",
    plan: "Square Free",
    channel: "online",
    currency: "USD",
    percent: 3.3,
    fixedFeeCents: 30,
    monthlyFeeCents: 0,
    qualifier: "online payments, with the monthly fee charged per location",
    sourceUrl: "https://squareup.com/us/en/pricing",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "stripe.standard.online",
    provider: "stripe",
    product: "Stripe Payments",
    plan: "Standard pricing",
    channel: "online",
    currency: "USD",
    percent: 2.9,
    fixedFeeCents: 30,
    monthlyFeeCents: null,
    qualifier: "per successful transaction for domestic cards",
    sourceUrl: "https://stripe.com/pricing",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "stripe.terminal.in-person",
    provider: "stripe",
    product: "Stripe Terminal",
    plan: "Standard pricing",
    channel: "in-person",
    currency: "USD",
    percent: 2.7,
    fixedFeeCents: 5,
    monthlyFeeCents: null,
    qualifier: "per successful transaction for domestic cards",
    sourceUrl: "https://stripe.com/pricing",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "clover.advertised.lowest",
    provider: "clover",
    product: "Clover",
    plan: "Lowest advertised plan rate",
    channel: "in-person",
    currency: "USD",
    percent: 2.3,
    fixedFeeCents: 10,
    monthlyFeeCents: null,
    ratePrefix: "as little as",
    qualifier: "the rate varies by plan and business type, and is shown only on Clover.com",
    sourceUrl: "https://www.clover.com/pricing",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "paypal.pos.card-present",
    provider: "paypal",
    product: "PayPal Point of Sale",
    plan: "Standard rate",
    channel: "in-person",
    currency: "USD",
    percent: 2.29,
    fixedFeeCents: 9,
    monthlyFeeCents: null,
    qualifier: "card-present transactions",
    sourceUrl: "https://www.paypal.com/us/business/paypal-business-fees",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "paypal.links.cards",
    provider: "paypal",
    product: "PayPal payment links",
    plan: "Standard rate",
    channel: "online",
    currency: "USD",
    percent: 2.99,
    fixedFeeCents: 49,
    monthlyFeeCents: null,
    qualifier: "standard credit and debit card payments, Apple Pay and other third-party wallets",
    sourceUrl: "https://www.paypal.com/us/business/paypal-business-fees",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "paypal.links.checkout",
    provider: "paypal",
    product: "PayPal payment links",
    plan: "Standard rate",
    channel: "online",
    currency: "USD",
    percent: 3.49,
    fixedFeeCents: 49,
    monthlyFeeCents: null,
    qualifier: "PayPal Checkout, Pay with Venmo, Pay Later offers or Guest Checkout",
    sourceUrl: "https://www.paypal.com/us/business/paypal-business-fees",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "helcim.interchange-plus.in-person",
    provider: "helcim",
    product: "Helcim",
    plan: "Interchange-plus, $0 to $50K monthly volume",
    channel: "in-person",
    currency: "USD",
    percent: 0.4,
    fixedFeeCents: 8,
    monthlyFeeCents: null,
    interchangePlus: true,
    qualifier: "added to interchange, and lower tiers apply at higher monthly volume",
    sourceUrl: "https://www.helcim.com/pricing/",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "helcim.interchange-plus.keyed",
    provider: "helcim",
    product: "Helcim",
    plan: "Interchange-plus, $0 to $50K monthly volume",
    channel: "online",
    currency: "USD",
    percent: 0.5,
    fixedFeeCents: 25,
    monthlyFeeCents: null,
    interchangePlus: true,
    qualifier: "keyed and online transactions, added to interchange, and lower tiers apply at higher monthly volume",
    sourceUrl: "https://www.helcim.com/pricing/",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "authorize-net.all-in-one.online",
    provider: "authorize-net",
    product: "Authorize.net",
    plan: "All-in-One (merchant account and gateway)",
    channel: "online",
    currency: "USD",
    percent: 2.9,
    fixedFeeCents: 30,
    monthlyFeeCents: 2500,
    sourceUrl: "https://www.authorize.net/sign-up/pricing.html",
    checkedOn: PRICE_CHECKED_ON,
  },
  {
    id: "authorize-net.gateway-only",
    provider: "authorize-net",
    product: "Authorize.net",
    plan: "Gateway Only",
    channel: "gateway",
    currency: "USD",
    percent: null,
    fixedFeeCents: 10,
    monthlyFeeCents: 2500,
    qualifier: "the gateway charge only, plus a 10¢ daily batch fee, and the merchant account is separate",
    sourceUrl: "https://www.authorize.net/sign-up/pricing.html",
    checkedOn: PRICE_CHECKED_ON,
  },
] as const;

/** Providers whose official pages do not publish a single rate. They are shown with no rate. */
export const UNPUBLISHED_RATE_PROVIDERS: Readonly<Record<string, string>> = {
  toast: "Toast does not publish a single processing rate on its pricing page; pricing is quoted.",
};

export function priceRecordsFor(provider: string): PriceRecord[] {
  return PRICE_RECORDS.filter((r) => r.provider === provider);
}

/** Customer-facing channel wording. A gateway record is a gateway charge, not a processing rate. */
export const CHANNEL_LABELS: Readonly<Record<PriceChannel, string>> = {
  "in-person": "in person",
  online: "online",
  gateway: "gateway fee",
};

/**
 * The rate exactly as the official page frames it: "as little as 2.3% + 10¢" keeps its qualifying
 * prefix, and a gateway record reads as a per-transaction gateway charge.
 */
export function formatRateLabel(record: Pick<PriceRecord, "percent" | "fixedFeeCents" | "interchangePlus" | "ratePrefix">): string {
  const rate = formatRate(record);
  return record.ratePrefix ? `${record.ratePrefix} ${rate}` : rate;
}

/** The record qualifier as a standalone sentence fragment ("Tap, dip or swipe, with..."), or an empty string. */
export function formatQualifier(record: Pick<PriceRecord, "qualifier">): string {
  const q = record.qualifier ?? "";
  return q ? `${q.charAt(0).toUpperCase()}${q.slice(1)}` : "";
}

/**
 * One complete statement of a record: product and plan, channel, the rate with its prefix, the monthly fee
 * when the page states one, and the qualifier. Every comparison surface (table, FAQ, schema, server HTML)
 * uses this so a rate never appears without its product, plan, channel or material qualifier.
 */
export function describePriceRecord(record: PriceRecord): string {
  const monthly = record.monthlyFeeCents === null ? "" : `, ${formatMonthly(record.monthlyFeeCents)}`;
  const qualifier = record.qualifier ? ` (${record.qualifier})` : "";
  return `${record.product} - ${record.plan} (${CHANNEL_LABELS[record.channel]}): ${formatRateLabel(record)}${monthly}${qualifier}`;
}

/** Render one rate as "2.6% + 15¢" (or "10¢ per transaction" when there is no percentage). */
export function formatRate(record: Pick<PriceRecord, "percent" | "fixedFeeCents" | "interchangePlus">): string {
  const pct = record.percent === null ? null : `${trimPercent(record.percent)}%`;
  const fixed = record.fixedFeeCents === null ? null : formatCents(record.fixedFeeCents);
  const lead = record.interchangePlus ? "Interchange + " : "";
  if (pct && fixed) return `${lead}${pct} + ${fixed}`;
  if (pct) return `${lead}${pct}`;
  if (fixed) return `${fixed} per transaction`;
  return "";
}

export function formatCents(cents: number): string {
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`;
}

export function formatMonthly(cents: number): string {
  return cents === 0 ? "$0 per month" : `$${(cents / 100).toFixed(2).replace(/\.00$/, "")} per month`;
}

function trimPercent(value: number): string {
  return String(value);
}

/** "November 8, 2026" for an ISO date. */
export function formatCheckedDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export interface PriceRecordProblem {
  id: string;
  problem: string;
}

/** Structural validation used by the static suite: every record must be complete and sourced. */
export function validatePriceRecords(records: readonly PriceRecord[] = PRICE_RECORDS): PriceRecordProblem[] {
  const problems: PriceRecordProblem[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) problems.push({ id: r.id, problem: "duplicate id" });
    seen.add(r.id);
    if (!r.provider || !r.product || !r.plan) problems.push({ id: r.id, problem: "missing provider, product or plan" });
    if (r.currency !== "USD") problems.push({ id: r.id, problem: "currency must be USD" });
    if (r.percent === null && r.fixedFeeCents === null) problems.push({ id: r.id, problem: "no percentage or fixed fee" });
    if (r.percent !== null && !(r.percent > 0 && r.percent < 100)) problems.push({ id: r.id, problem: "percentage out of range" });
    if (!/^https:\/\//.test(r.sourceUrl)) problems.push({ id: r.id, problem: "source must be an https URL" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn)) problems.push({ id: r.id, problem: "checkedOn must be an ISO date" });
  }
  return problems;
}
