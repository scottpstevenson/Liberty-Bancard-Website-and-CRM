// Partner residual illustration: pure arithmetic and the wording shown with it. Used by the React component
// (client/src/components/public/PartnerResidualCalculator.tsx), the server-rendered pages and
// scripts/test-partner-residual-calculator.ts.
//
// Eligible monthly portfolio residual = merchants x average monthly card volume x (bps / 10,000).
// Monthly illustrative partner compensation = eligible residual x approved illustration share / 100.
// Annualized illustration = monthly x 12.
//
// The basis-point figure is the visitor's own assumption about the eligible Liberty residual yield after upstream
// processor costs and share, before partner allocation. Nothing here knows an approved yield or a portfolio average.
//
// The share used for a result comes only from two places: the qualified sales-agent 50% term (approved for public
// use) and the published referral policy projection (shared/partner-public-content.ts). This module contains no
// proposed or unapproved referral share. With no approved projection a referral result is the gated message, never
// a number, a zero or a hidden value. Private fixture rates live only in the test script.
//
// No database or server imports: the client bundle imports this file.

import {
  DEFAULT_REFERRAL_POLICY,
  REFERRAL_RESULT_GATED_MESSAGE,
  type PartnerPathId,
  type PartnerReferralPolicy,
} from "./partner-public-content";

export const PARTNER_RESIDUAL_BPS = { min: 25, max: 150, step: 1, default: 100 } as const;

/** Qualified self-sourced full-cycle sales-agent share: the one numeric term approved for public use. */
export const PARTNER_AGENT_SHARE_PERCENT = 50;

export const PARTNER_RESIDUAL_PATHS: readonly { id: PartnerPathId; label: string }[] = [
  { id: "referral", label: "Referral partner" },
  { id: "sales_agent", label: "Sales agent (qualifying self-sourced, full-cycle business)" },
];

export const PARTNER_RESIDUAL_DEFAULTS = {
  merchants: "20",
  avgMonthlyVolume: "100000",
  path: "referral" as PartnerPathId,
} as const;

/** Upper bounds keep every product finite and well inside double precision. Zero is a valid input and gives $0. */
export const PARTNER_RESIDUAL_LIMITS = {
  merchants: { min: 0, max: 100_000, label: "Number of active merchants" },
  avgMonthlyVolume: { min: 0, max: 100_000_000, label: "Average monthly card volume per merchant" },
} as const;

export const PARTNER_RESIDUAL_COPY = {
  heading: "Explore a hypothetical portfolio.",
  yieldLabel: "Eligible Liberty residual yield after upstream processor costs/share, before partner allocation.",
  yieldHelper: "Basis points describe residual yield here, not a quoted merchant processing rate.",
  monthlyLabel: "Illustrative monthly compensation",
  annualLabel: "Illustrative annualized compensation",
  agentQualification: "Qualifying self-sourced, full-cycle business under a signed compensation schedule.",
  formula: "Monthly = merchants × average monthly volume × (bps ÷ 10,000) × share. Annualized = monthly × 12.",
  disclosure:
    "These figures are hypothetical, not guaranteed earnings or a verified portfolio average. The default 100-basis-point assumption is a generous illustration, not evidence of Liberty’s actual average yield. Actual eligible residual varies with merchant mix, pricing, processor costs/share, activity, eligibility and your agreement. Annualized figures assume the same activity for 12 months and do not model churn or growth. This is not an estimate of Liberty’s net profit.",
  cta: "Discuss your partnership",
  gated: REFERRAL_RESULT_GATED_MESSAGE,
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

/** Keeps a bps value inside the slider range; anything non-finite falls back to the default. */
export function clampPartnerResidualBps(bps: number): number {
  if (!Number.isFinite(bps)) return PARTNER_RESIDUAL_BPS.default;
  return Math.min(PARTNER_RESIDUAL_BPS.max, Math.max(PARTNER_RESIDUAL_BPS.min, bps));
}

/** Explicit validation of an editable bps value (the slider constrains itself; a typed value does not). */
export function validatePartnerResidualBps(bps: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(bps)) return { ok: false, message: "Enter a number of basis points." };
  if (!Number.isInteger(bps)) return { ok: false, message: "Basis points must be a whole number." };
  if (bps < PARTNER_RESIDUAL_BPS.min || bps > PARTNER_RESIDUAL_BPS.max) {
    return { ok: false, message: `Basis points must be between ${PARTNER_RESIDUAL_BPS.min} and ${PARTNER_RESIDUAL_BPS.max}.` };
  }
  return { ok: true };
}

export type PartnerResidualResult = { monthly: number; annualized: number };

/**
 * merchants x avgMonthlyVolume x (bps / 10,000) x (sharePercent / 100), at full precision as one division of the
 * product so the documented check cases come out exact (20 x $100,000 x 100 bps x 50% = $10,000 a month).
 */
export function calculatePartnerResidual(input: {
  merchants: number;
  avgMonthlyVolume: number;
  bps: number;
  sharePercent: number;
}): PartnerResidualResult {
  const monthly = (input.merchants * input.avgMonthlyVolume * input.bps * input.sharePercent) / (10_000 * 100);
  return { monthly, annualized: monthly * 12 };
}

/** The partner share the illustration may use for a path, or null when no publishable share exists for it. */
export function illustrationShareForPath(path: PartnerPathId, policy: PartnerReferralPolicy = DEFAULT_REFERRAL_POLICY): number | null {
  if (path === "sales_agent") return PARTNER_AGENT_SHARE_PERCENT;
  return policy.state === "approved" ? policy.sharePercent : null;
}

export type PartnerIllustration =
  | { kind: "incomplete" }
  | { kind: "gated"; message: string }
  | { kind: "amount"; monthly: number; annualized: number; sharePercent: number; bps: number };

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

/**
 * One decision for the whole illustration. A referral path without an approved projection returns the gated message
 * (no amount at all); an incomplete or invalid input returns "incomplete" rather than a fabricated value.
 */
export function illustratePartnerResidual(input: {
  path: PartnerPathId;
  merchants: ParsedPartnerResidualField;
  avgMonthlyVolume: ParsedPartnerResidualField;
  bps: number;
  policy?: PartnerReferralPolicy;
}): PartnerIllustration {
  const share = illustrationShareForPath(input.path, input.policy ?? DEFAULT_REFERRAL_POLICY);
  if (share === null) return { kind: "gated", message: PARTNER_RESIDUAL_COPY.gated };
  if (input.merchants.kind !== "ok" || input.avgMonthlyVolume.kind !== "ok") return { kind: "incomplete" };
  if (!validatePartnerResidualBps(input.bps).ok) return { kind: "incomplete" };
  const { monthly, annualized } = calculatePartnerResidual({
    merchants: input.merchants.value,
    avgMonthlyVolume: input.avgMonthlyVolume.value,
    bps: input.bps,
    sharePercent: share,
  });
  return { kind: "amount", monthly, annualized, sharePercent: share, bps: input.bps };
}
