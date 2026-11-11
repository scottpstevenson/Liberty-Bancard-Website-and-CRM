// Partner residual income estimator: pure arithmetic and the wording shown with it, used by the React component
// (client/src/components/public/PartnerResidualCalculator.tsx) and checked by scripts/test-partner-residual-calculator.ts.
//
// Monthly income = merchants x average monthly volume x (bps / 10,000) x partner split.
// Annualized income = monthly income x 12.
//
// The basis-point figure is the visitor's own assumption about the Liberty residual that is left after processor
// costs and the processor's share, before the partner split. Nothing here knows an approved yield, an approved split
// or a portfolio average, which is why the splits are labelled "subject to approved compensation terms" and the
// disclosure travels with every result.
//
// No database or server imports: the client bundle imports this file.

export const PARTNER_RESIDUAL_BPS = { min: 25, max: 150, step: 1, default: 100 } as const;

export type PartnerResidualTypeId = "sales_agent" | "referral_partner";

export const PARTNER_RESIDUAL_TYPES: readonly { id: PartnerResidualTypeId; label: string; splitPercent: number }[] = [
  { id: "sales_agent", label: "Sales Agent", splitPercent: 50 },
  { id: "referral_partner", label: "Referral Partner", splitPercent: 15 },
];

export const PARTNER_RESIDUAL_DEFAULTS = {
  merchants: "20",
  avgMonthlyVolume: "100000",
  partnerType: "sales_agent" as PartnerResidualTypeId,
} as const;

/** Upper bounds keep every product finite and well inside double precision. */
export const PARTNER_RESIDUAL_LIMITS = {
  merchants: { min: 1, max: 100_000, label: "Number of active merchants" },
  avgMonthlyVolume: { min: 1, max: 100_000_000, label: "Average monthly card volume per merchant" },
} as const;

export const PARTNER_RESIDUAL_COPY = {
  bpsExplanation:
    "100 bps = 1% of processing volume, payable to Liberty after processor costs and the processor’s share, before your split.",
  splitNote: "Sales Agent at 50% or Referral Partner at 15%, subject to approved compensation terms.",
  formula: "Monthly income = merchants × average monthly volume × (bps ÷ 10,000) × partner split. Annualized income = monthly income × 12.",
  disclosure:
    "Illustrative scenarios—not verified portfolio averages or guaranteed earnings. The default 100-bps assumption is a generous example. Actual residuals vary by merchant pricing, processing costs, activity, and agreement terms. Annualized income assumes the illustrated monthly level continues for 12 months.",
} as const;

export type PartnerResidualField = keyof typeof PARTNER_RESIDUAL_LIMITS;

export type ParsedPartnerResidualField =
  | { kind: "blank" }
  | { kind: "ok"; value: number }
  | { kind: "invalid"; message: string };

const WHOLE_NUMBER = /^\d+$/;
const DOLLAR_AMOUNT = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/;

/** Strict parse: a blank is "not entered", never zero, and anything that is not a plain number is rejected. */
export function parsePartnerResidualField(field: PartnerResidualField, raw: string): ParsedPartnerResidualField {
  const text = (raw ?? "").trim();
  if (text === "") return { kind: "blank" };
  const limit = PARTNER_RESIDUAL_LIMITS[field];
  if (text.startsWith("-")) return { kind: "invalid", message: `${limit.label} cannot be negative.` };
  const pattern = field === "merchants" ? WHOLE_NUMBER : DOLLAR_AMOUNT;
  if (!pattern.test(text)) {
    return {
      kind: "invalid",
      message: field === "merchants" ? `${limit.label} must be a whole number.` : `${limit.label} must be a plain dollar amount.`,
    };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return { kind: "invalid", message: `${limit.label} is not a valid number.` };
  if (value < limit.min) return { kind: "invalid", message: `${limit.label} must be at least ${limit.min.toLocaleString("en-US")}.` };
  if (value > limit.max) return { kind: "invalid", message: `${limit.label} cannot exceed ${limit.max.toLocaleString("en-US")}.` };
  return { kind: "ok", value };
}

export function partnerResidualSplitPercent(typeId: PartnerResidualTypeId): number {
  const type = PARTNER_RESIDUAL_TYPES.find((t) => t.id === typeId);
  if (!type) throw new Error(`Unknown partner type: ${typeId}`);
  return type.splitPercent;
}

/** Keeps a bps value inside the slider range; anything non-finite falls back to the default. */
export function clampPartnerResidualBps(bps: number): number {
  if (!Number.isFinite(bps)) return PARTNER_RESIDUAL_BPS.default;
  return Math.min(PARTNER_RESIDUAL_BPS.max, Math.max(PARTNER_RESIDUAL_BPS.min, bps));
}

export type PartnerResidualResult = { monthly: number; annualized: number };

/**
 * merchants x avgMonthlyVolume x (bps / 10,000) x (splitPercent / 100), computed as one division of the integer-valued
 * product so the documented check cases come out exact (20 x $100,000 x 100 bps x 50% = $10,000 a month).
 */
export function calculatePartnerResidual(input: {
  merchants: number;
  avgMonthlyVolume: number;
  bps: number;
  splitPercent: number;
}): PartnerResidualResult {
  const monthly = (input.merchants * input.avgMonthlyVolume * input.bps * input.splitPercent) / (10_000 * 100);
  return { monthly, annualized: monthly * 12 };
}

/** Whole dollars when the amount is whole, otherwise dollars and cents. */
export function formatPartnerResidualUsd(amount: number): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}
