// Payment processing cost calculator: pure arithmetic and the page copy, shared by the React page
// (client/src/pages/SavingsCalculator.tsx) and the server document (server/ssr/pages.ts).
//
// The earlier calculator compared the visitor's rate with a fixed "Liberty target rate" of 1.95% and with
// invented industry averages. Neither has an approved source, so a saving was being quoted against a price
// nobody had agreed to. This calculator knows no Liberty price and no industry average. It subtracts the
// pricing in a written quote the visitor holds from the cost the visitor already pays, using only numbers the
// visitor typed. A total is shown only when every material figure on both sides is entered, which is the rule
// renderableSavingsUsd() already enforces. A higher proposed cost is reported as higher, not hidden.
//
// A quote can price card processing in three ways and only one of them is a complete cost in one rate:
//   all_in  - a flat or single all-in rate: the percentage and per-transaction fee are the whole processing cost.
//   markup  - interchange-plus or cost-plus: the quote lists only the processor's markup; card-network costs
//             (interchange, network and assessment fees) are charged on top. Those costs are a separate figure the
//             visitor enters from a statement. Without it the quote is incomplete, never "$0 of network cost".
//   unsure  - tiered, per-category or unclear: one rate cannot total it, so no comparison is made.
// The visitor must choose the basis; nothing is preselected and no network cost is estimated from an average.

import { claimText, compareCosts, renderableSavingsUsd, type CostInput } from "./public-claims";

export const CALC_PATH = "/savings-calculator";

export type CalcFieldId =
  | "monthlyVolume"
  | "avgTicket"
  | "currentRate"
  | "proposedRate"
  | "proposedPerTransaction"
  | "proposedPassThrough"
  | "proposedMonthlyFees"
  | "proposedEquipmentMonthly";

/** How the quote prices card processing. "" means the visitor has not chosen. */
export type CalcBasis = "all_in" | "markup" | "unsure";
export const CALC_BASIS_VALUES: readonly CalcBasis[] = ["all_in", "markup", "unsure"];

export type CalcInputs = Record<CalcFieldId, string> & { proposedBasis: string };

export const EMPTY_CALC_INPUTS: CalcInputs = {
  monthlyVolume: "",
  avgTicket: "",
  currentRate: "",
  proposedBasis: "",
  proposedRate: "",
  proposedPerTransaction: "",
  proposedPassThrough: "",
  proposedMonthlyFees: "",
  proposedEquipmentMonthly: "",
};

/** Upper bounds keep every product finite and well inside double precision. */
export const CALC_LIMITS: Record<CalcFieldId, { max: number; positiveOnly: boolean; label: string }> = {
  monthlyVolume: { max: 1_000_000_000, positiveOnly: true, label: "Monthly card volume" },
  avgTicket: { max: 1_000_000, positiveOnly: true, label: "Average ticket" },
  currentRate: { max: 100, positiveOnly: false, label: "Current effective rate" },
  proposedRate: { max: 100, positiveOnly: false, label: "Proposed rate" },
  proposedPerTransaction: { max: 1_000, positiveOnly: false, label: "Per-transaction fee" },
  // Validated only for a markup quote (see calculateCosts). Card-network cost on real volume is never zero.
  proposedPassThrough: { max: 10_000_000, positiveOnly: true, label: "Card-network costs" },
  proposedMonthlyFees: { max: 10_000_000, positiveOnly: false, label: "Monthly and recurring fees" },
  proposedEquipmentMonthly: { max: 10_000_000, positiveOnly: false, label: "Equipment charges" },
};

export type ParsedField = { kind: "blank" } | { kind: "ok"; value: number } | { kind: "invalid"; message: string };

const PLAIN_NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/** Strict parse: a blank is "not entered", never zero, and anything that is not a plain number is rejected. */
export function parseCalcField(field: CalcFieldId, raw: string): ParsedField {
  const text = (raw ?? "").trim();
  if (text === "") return { kind: "blank" };
  const limit = CALC_LIMITS[field];
  if (text.startsWith("-")) return { kind: "invalid", message: `${limit.label} cannot be negative.` };
  if (!PLAIN_NUMBER.test(text)) return { kind: "invalid", message: `${limit.label} must be a plain number.` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { kind: "invalid", message: `${limit.label} is not a valid number.` };
  if (limit.positiveOnly && value <= 0) return { kind: "invalid", message: `${limit.label} must be greater than zero.` };
  if (value > limit.max) return { kind: "invalid", message: `${limit.label} cannot exceed ${limit.max.toLocaleString("en-US")}.` };
  return { kind: "ok", value };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CalcLine {
  label: string;
  monthlyUsd: number | null;
  /** Why a line is unknown, shown beside it. */
  note?: string;
}

export type CalcDirection = "lower" | "higher" | "same";

export type CalcErrors = Partial<Record<CalcFieldId | "proposedBasis", string>>;

export type CalcResult =
  | { status: "incomplete"; missing: string[] }
  | { status: "invalid"; errors: CalcErrors }
  | {
      status: "ok";
      /** The pricing basis the visitor chose for the quote, or null when none was chosen. */
      basis: CalcBasis | null;
      currentMonthlyUsd: number;
      transactionsPerMonth: number | null;
      proposedLines: CalcLine[];
      proposedIncludedUsd: number;
      unknownLabels: string[];
      proposedMonthlyUsd: number | null;
      proposedEffectiveRatePct: number | null;
      monthlyDifferenceUsd: number | null;
      annualDifferenceUsd: number | null;
      direction: CalcDirection | null;
    };

/** Labels of the lines that stand for "this quote cannot be totalled yet" (shown beside the unknown). */
export const CALC_UNKNOWN_LABELS = {
  basis: "How the quote prices card processing",
  passThrough: "Card-network costs (interchange and assessments)",
  unsure: "A single-rate total (tiered or unclear quotes need the statement)",
} as const;

/**
 * Current cost = monthly volume x current effective rate (the effective rate already includes every fee).
 * Proposed cost depends on the chosen basis:
 *   all_in : rate x volume + per-transaction fee x transactions + monthly fees + equipment charges
 *   markup : the same lines read as the processor's markup, plus the card-network costs the visitor enters
 *   unsure / not chosen : no total; the missing basis is an unknown material line like any other.
 * The annual figure is the monthly difference x 12, assuming the same volume and fees each month.
 */
export function calculateCosts(inputs: CalcInputs): CalcResult {
  const errors: CalcErrors = {};
  const basisRaw = (inputs.proposedBasis ?? "").trim();
  if (basisRaw !== "" && !(CALC_BASIS_VALUES as readonly string[]).includes(basisRaw)) {
    errors.proposedBasis = "Choose one of the listed pricing types.";
  }
  const basis: CalcBasis | null = basisRaw === "" || errors.proposedBasis ? null : (basisRaw as CalcBasis);

  const parsed = {} as Record<CalcFieldId, ParsedField>;
  (Object.keys(CALC_LIMITS) as CalcFieldId[]).forEach((field) => {
    // The network-cost field only exists for a markup quote; a stale entry left over from switching the
    // basis must neither fail validation nor be added to an all-in rate (that would count fees twice).
    if (field === "proposedPassThrough" && basis !== "markup") {
      parsed[field] = { kind: "blank" };
      return;
    }
    parsed[field] = parseCalcField(field, inputs[field]);
    const p = parsed[field];
    if (p.kind === "invalid") errors[field] = p.message;
  });
  if (Object.keys(errors).length > 0) return { status: "invalid", errors };

  const value = (field: CalcFieldId): number | null => {
    const p = parsed[field];
    return p.kind === "ok" ? p.value : null;
  };

  const volume = value("monthlyVolume");
  const currentRate = value("currentRate");
  const missing: string[] = [];
  if (volume === null) missing.push(CALC_LIMITS.monthlyVolume.label);
  if (currentRate === null) missing.push(CALC_LIMITS.currentRate.label);
  if (volume === null || currentRate === null) return { status: "incomplete", missing };

  const ticket = value("avgTicket");
  const transactions = ticket === null ? null : volume / ticket;
  const currentMonthlyUsd = round2(volume * (currentRate / 100));

  const rate = value("proposedRate");
  const perTransaction = value("proposedPerTransaction");
  const passThrough = value("proposedPassThrough");
  const monthlyFees = value("proposedMonthlyFees");
  const equipment = value("proposedEquipmentMonthly");

  let perTransactionUsd: number | null;
  let perTransactionNote: string | undefined;
  if (perTransaction === null) perTransactionUsd = null;
  else if (perTransaction === 0) perTransactionUsd = 0;
  else if (transactions === null) {
    perTransactionUsd = null;
    perTransactionNote = "Enter your average ticket so the number of transactions can be estimated.";
  } else perTransactionUsd = round2(perTransaction * transactions);

  const markup = basis === "markup";
  const proposedLines: CalcLine[] = [];
  if (basis === null) {
    proposedLines.push({ label: CALC_UNKNOWN_LABELS.basis, monthlyUsd: null, note: "Choose it above to compare." });
  } else if (basis === "unsure") {
    proposedLines.push({ label: CALC_UNKNOWN_LABELS.unsure, monthlyUsd: null, note: "Not calculated." });
  }
  proposedLines.push(
    { label: markup ? "Processor markup (percentage)" : "Percentage fees", monthlyUsd: rate === null ? null : round2(volume * (rate / 100)) },
    { label: markup ? "Per-transaction markup" : "Per-transaction fees", monthlyUsd: perTransactionUsd, note: perTransactionNote },
  );
  if (markup) {
    proposedLines.push({
      label: CALC_UNKNOWN_LABELS.passThrough,
      monthlyUsd: passThrough === null ? null : round2(passThrough),
      note: "Not in the markup. Enter it from your statement.",
    });
  }
  proposedLines.push(
    { label: "Monthly and recurring fees", monthlyUsd: monthlyFees === null ? null : round2(monthlyFees) },
    { label: "Equipment charges (monthly)", monthlyUsd: equipment === null ? null : round2(equipment) },
  );

  const currentComparison = compareCosts([{ label: "Current total fees", monthlyUsd: currentMonthlyUsd, material: true }]);
  const proposedInputs: CostInput[] = proposedLines.map((line) => ({ label: line.label, monthlyUsd: line.monthlyUsd, material: true }));
  const proposedComparison = compareCosts(proposedInputs);

  const difference = renderableSavingsUsd(currentComparison, proposedComparison);
  const proposedMonthlyUsd = proposedComparison.complete ? round2(proposedComparison.includedUsd) : null;
  const annual = difference === null ? null : round2(difference * 12);
  const finite = [currentMonthlyUsd, proposedComparison.includedUsd, difference, annual].every((n) => n === null || Number.isFinite(n));
  if (!finite) return { status: "invalid", errors: { monthlyVolume: "These numbers are too large to calculate. Check each entry." } };

  return {
    status: "ok",
    basis,
    currentMonthlyUsd,
    transactionsPerMonth: transactions === null ? null : Math.round(transactions),
    proposedLines,
    proposedIncludedUsd: round2(proposedComparison.includedUsd),
    unknownLabels: proposedComparison.unknownLabels,
    proposedMonthlyUsd,
    proposedEffectiveRatePct: proposedMonthlyUsd === null ? null : round2((proposedMonthlyUsd / volume) * 100),
    monthlyDifferenceUsd: difference,
    annualDifferenceUsd: annual,
    direction: difference === null ? null : difference > 0 ? "lower" : difference < 0 ? "higher" : "same",
  };
}

/** The pricing-type choice shown above the quote fields, shared by the page and the server document. */
export const CALC_BASIS_COPY = {
  legend: "How does the quote price card processing?",
  hint: "Choose one. Nothing is chosen for you, because the choice decides whether the quote can be totalled.",
  options: [
    {
      value: "all_in" as const,
      label: "One all-in rate",
      detail: "A flat rate, or a single rate that already includes card-network costs (interchange and assessments).",
    },
    {
      value: "markup" as const,
      label: "A markup over card-network costs",
      detail: "Interchange-plus or cost-plus. The quote lists a markup, and the card networks' own costs are charged on top.",
    },
    {
      value: "unsure" as const,
      label: "Tiered, per-category or not sure",
      detail: "One rate cannot total these quotes.",
    },
  ],
  percentage: {
    all_in: { label: "Percentage rate (%)", hint: "The all-in rate on the quote. Enter 0 if it states none" },
    markup: { label: "Processor markup (%)", hint: "The percentage the quote adds to card-network costs. Enter 0 if it states none" },
  },
  perTransaction: {
    all_in: { label: "Per-transaction fee ($)", hint: "Per authorization or transaction. Enter 0 if none" },
    markup: { label: "Per-transaction markup ($)", hint: "The fee the quote adds per transaction. Enter 0 if none" },
  },
  passThrough: {
    label: "Card-network costs per month ($)",
    hint: "Interchange, network and assessment charges for the same volume and card mix, from a recent statement. Leave blank if you do not know; no total is shown.",
  },
  monthlyFeesHint: "Statement, gateway, PCI and similar fees not already inside the rate above. Enter 0 if none",
  incompleteHeading: "Comparison incomplete",
  incompleteIntro: "A comparison needs every cost on both sides. No saving or total is shown until these are known:",
  unsureNote: "A tiered or unclear quote cannot be totalled from one rate. A statement review reads the fees on your own statement.",
  markupNote: "A markup is only part of the cost. The card networks' own charges are added on top, and they are not in the quote's markup.",
} as const;

export const CALC_COPY = {
  title: "Payment Processing Cost Calculator",
  description:
    "Compare what you pay for card processing today with a written quote you hold. Every figure is one you enter; a statement review gives your actual costs.",
  keywords: "payment processing cost calculator, effective rate calculator, compare processing quotes, processing fee calculator",
  breadcrumbLabel: "Cost calculator",
  badge: "Cost comparison",
  h1: "Payment Processing Cost Calculator",
  subtitle:
    "Compare what you pay today with a written quote you hold. Every figure comes from numbers you enter. The calculator knows no Liberty Bancard price and promises no saving.",
  disclaimer:
    "Illustrative arithmetic on your own entries. It leaves out one-time charges and any change in volume or card mix, and it shows no total while a cost is unknown. A statement review shows your actual costs.",
  steps: [
    { title: "Enter what you pay today", text: "Your monthly card volume and your effective rate: total monthly fees divided by monthly card volume. Both are on your statement." },
    { title: "Enter the quote you hold", text: "From a written quote: choose how it prices card processing, then enter the percentage rate, any per-transaction fee, monthly and recurring fees, and equipment charges. Enter 0 where the quote says 0. For a markup quote, also enter the card-network costs from your statement." },
    { title: "Read the difference", text: "You see the monthly difference and the annual figure. If the quote costs more, the calculator says so. If a cost is still unknown, it says the comparison is incomplete and shows no total." },
  ],
  whyHeading: "Why a quoted rate and an effective rate can differ",
  whyIntro: "The rate in a quote is one line of the cost. Your effective rate includes every fee on the statement.",
  why: [
    { title: "Monthly and statement fees", text: "Statement, gateway, batch, PCI and other monthly charges can raise your total cost above the quoted rate." },
    { title: "Pricing categories", text: "Tiered plans group transactions into categories. Ask which category your transactions fall into and what each one costs." },
    { title: "Interchange-plus and pass-through costs", text: "A quote that lists only a markup, such as a percentage plus a few cents, is not a total. Interchange, network and assessment charges are passed through on top of the markup and depend on your volume and card mix." },
    { title: "Flat-rate plans", text: "Flat-rate plans charge a published rate by plan and channel. Compare it with the fees on your own statement." },
    { title: "Rate changes", text: "Ask when your rates can change and how you will be told." },
    { title: "Equipment charges", text: "Ask whether equipment is leased, rented or purchased, and what the agreement says if you leave." },
  ],
  helpHeading: "What a statement review adds",
  help: [
    { title: "Your actual statement", text: claimText("review.process.summary") },
    { title: "How effective cost is figured", text: claimText("review.effective-cost.definition") },
    { title: "Where each charge goes", text: claimText("review.taxonomy.summary") },
    { title: "Cost of the review", text: claimText("review.cost.free") },
  ],
  exactHeading: "Want your actual costs?",
  exactText: "This calculator does arithmetic on numbers you type. A statement review works from the fees on your statement.",
  exactCta: "Upload a statement for a free review",
  faqHeading: "Frequently asked questions",
  faq: [
    {
      question: "What does this calculator do?",
      answer:
        "It does arithmetic on the numbers you enter: what you pay today and the pricing in a quote you hold. It uses no industry averages, knows no Liberty Bancard price and does not predict savings.",
    },
    {
      question: "What is an effective rate?",
      answer: claimText("review.effective-cost.definition"),
    },
    {
      question: "Where do I find the proposed figures?",
      answer:
        "In the written quote or proposal you received: how it prices card processing, the percentage rate, any per-transaction fee, monthly and recurring fees, and equipment charges. A total appears only when every figure is entered, so enter 0 where the quote says 0 and leave a field blank if the quote does not say.",
    },
    {
      question: "What if the quote lists only a markup?",
      answer:
        "Choose the markup option and enter the card-network costs (interchange, network and assessment charges) from a recent statement. They are charged on top of a markup and are not in it. If you do not know them, leave the field blank: the calculator then says the comparison is incomplete and shows no total, and it estimates nothing for you.",
    },
    {
      question: "What if I don't know my current rate?",
      answer: `Upload your most recent processing statement. ${claimText("review.process.summary")}`,
    },
    {
      question: "What does the calculator leave out?",
      answer:
        "One-time charges such as setup, application, equipment purchase and early termination fees, and any change in volume or card mix. The annual figure is the monthly difference multiplied by 12 and assumes the same volume and fees every month.",
    },
    {
      question: "Are there contract or cancellation terms?",
      answer: claimText("equipment.agreement.summary"),
    },
  ],
  finalHeading: "Start with your statement",
  finalText: claimText("review.cost.free"),
} as const;

/** WebApplication structured data: no offer price claims, no rating, no Liberty rate. */
export const CALC_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: CALC_COPY.title,
  description: CALC_COPY.description,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  provider: { "@type": "Organization", name: "Liberty Bancard" },
} as const;
