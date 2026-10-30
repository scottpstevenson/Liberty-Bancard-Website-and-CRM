
import type { Contact, Deal, Prospect } from "@shared/schema";
import { resolveContactTargetVertical, type ContactTargetVertical } from "@shared/contact-vertical-taxonomy";

/**
 * Assumption-model authority for every estimate export.
 *
 * Every estimator resolves its vertical through resolveVolumeModel(). A
 * vertical with no supported assumption model yields an explicit
 * `unavailable` model basis; it is never silently scored as "Other" and never
 * serialised as $0.00. Actual merchant facts (statement/proposal/entered
 * volume and ticket) keep precedence and never depend on a model.
 */
export const VOLUME_MODEL_VERSION = "volume-model-v1";

interface Assumptions { avgMonthlyVolume: number; avgTicket: number; ccRatio: number }

const LEGACY_ASSUMPTIONS: Record<string, Assumptions> = {
  "Restaurant": { avgMonthlyVolume: 45000, avgTicket: 35, ccRatio: 0.65 },
  "Retail": { avgMonthlyVolume: 35000, avgTicket: 50, ccRatio: 0.55 },
  "Professional Services": { avgMonthlyVolume: 25000, avgTicket: 200, ccRatio: 0.70 },
  "Healthcare": { avgMonthlyVolume: 40000, avgTicket: 150, ccRatio: 0.60 },
  "Auto": { avgMonthlyVolume: 60000, avgTicket: 500, ccRatio: 0.50 },
  "Salon/Spa": { avgMonthlyVolume: 20000, avgTicket: 80, ccRatio: 0.75 },
  "Construction": { avgMonthlyVolume: 80000, avgTicket: 2000, ccRatio: 0.40 },
  "Real Estate": { avgMonthlyVolume: 30000, avgTicket: 500, ccRatio: 0.35 },
  "E-commerce": { avgMonthlyVolume: 50000, avgTicket: 75, ccRatio: 0.95 },
  "Legal": { avgMonthlyVolume: 35000, avgTicket: 300, ccRatio: 0.65 },
  "Accounting": { avgMonthlyVolume: 20000, avgTicket: 250, ccRatio: 0.60 },
  "Other": { avgMonthlyVolume: 30000, avgTicket: 100, ccRatio: 0.55 },
};

/**
 * The five current canonical verticals. Each names the documented legacy
 * assumption it reuses (the same aliases the taxonomy already declares), or
 * null when no supportable model exists. Fitness/Recreation has none: no
 * defensible volume/ticket/card-ratio assumptions are on file, so the model
 * is unavailable rather than borrowed from another business type.
 */
const CANONICAL_MODEL_SOURCE: Record<ContactTargetVertical, string | null> = {
  "Automotive": "Auto",
  "Healthcare": "Healthcare",
  "Beauty/Spa": "Salon/Spa",
  "Construction/Trades/Home Services": "Construction",
  "Fitness/Recreation": null,
};

export type VolumeModelStatus = "available" | "unavailable";
export interface VolumeModelBasis {
  status: VolumeModelStatus;
  modelId: string | null;
  version: typeof VOLUME_MODEL_VERSION;
  resolvedVertical: string | null;
  basis: string;
  reason: "vertical_missing" | "vertical_unrecognized" | "no_supported_model" | null;
}
export interface ResolvedVolumeModel extends VolumeModelBasis { assumptions: Assumptions | null }

const legacyByLowerKey = new Map(Object.keys(LEGACY_ASSUMPTIONS).map((key) => [key.toLowerCase(), key]));

export function resolveVolumeModel(vertical: unknown): ResolvedVolumeModel {
  const raw = typeof vertical === "string" ? vertical.trim() : "";
  if (!raw) {
    return { status: "unavailable", modelId: null, version: VOLUME_MODEL_VERSION, resolvedVertical: null,
      basis: "No vertical recorded; no assumption model applies.", reason: "vertical_missing", assumptions: null };
  }
  const canonical = resolveContactTargetVertical(raw);
  if (canonical) {
    const source = CANONICAL_MODEL_SOURCE[canonical];
    if (!source) {
      return { status: "unavailable", modelId: null, version: VOLUME_MODEL_VERSION, resolvedVertical: canonical,
        basis: `No supported assumption model exists for ${canonical}.`, reason: "no_supported_model", assumptions: null };
    }
    return { status: "available", modelId: `${VOLUME_MODEL_VERSION}:${canonical}`, version: VOLUME_MODEL_VERSION,
      resolvedVertical: canonical, basis: `${canonical} uses the documented '${source}' assumptions.`,
      reason: null, assumptions: LEGACY_ASSUMPTIONS[source] };
  }
  const legacyKey = legacyByLowerKey.get(raw.toLowerCase());
  if (legacyKey) {
    return { status: "available", modelId: `${VOLUME_MODEL_VERSION}:legacy:${legacyKey}`, version: VOLUME_MODEL_VERSION,
      resolvedVertical: legacyKey, basis: `Legacy '${legacyKey}' assumptions.`, reason: null,
      assumptions: LEGACY_ASSUMPTIONS[legacyKey] };
  }
  return { status: "unavailable", modelId: null, version: VOLUME_MODEL_VERSION, resolvedVertical: null,
    basis: `Vertical '${raw.slice(0, 80)}' is not recognised; no assumption model applies.`,
    reason: "vertical_unrecognized", assumptions: null };
}

const CASH_DISCOUNT_MARGIN_BPS = 350;
const INTERCHANGE_PLUS_MARGIN_BPS = 35;

const STAGE_CONFIDENCE: Record<string, string> = {
  "New Lead": "low",
  "Statement Received": "medium",
  "Review In Progress": "medium",
  "Call Booked": "medium",
  "Proposal Sent": "high",
  "Negotiation / Follow-Up": "high",
  "Verbal Commit": "high",
  "Closed Won": "actual",
  "Closed Lost": "low",
};

export type VolumeEstimateSource = "actual" | "modeled" | "unavailable";

/**
 * Every derived value is null when it cannot be computed from actual facts or
 * an available model. Consumers must write only the non-null fields (see
 * definedFields) so an unavailable model never blanks or zeroes stored data.
 */
export interface VolumeEstimate {
  estimatedProcessingVolume: string | null;
  estimatedResidual: string | null;
  estimatedGrossProfitBps: number | null;
  estimatedGrossProfitMonthly: string | null;
  estimatedNetProfitMonthly: string | null;
  volumeConfidence: string | null;
  cashDiscountResidual: string | null;
  interchangePlusResidual: string | null;
  merchantTier: string | null;
  estimatedAvgTicket: string | null;
  /** Where the processing volume came from. */
  volumeSource: VolumeEstimateSource;
  model: VolumeModelBasis;
}

/** Positive finite dollars only; malformed, negative, NaN and Infinity read as "absent". */
function parseMoney(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const parsed = typeof val === "number" ? val : parseFloat(String(val).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function determineTier(volume: number): string {
  if (volume >= 100000) return "Enterprise";
  if (volume >= 50000) return "Premium";
  if (volume >= 20000) return "Standard";
  if (volume >= 5000) return "Small";
  return "Micro";
}

function computeResiduals(ccVolume: number) {
  const cashDiscountMonthly = (ccVolume * CASH_DISCOUNT_MARGIN_BPS) / 10000;
  const interchangePlusMonthly = (ccVolume * INTERCHANGE_PLUS_MARGIN_BPS) / 10000;
  return {
    cashDiscountMonthly,
    interchangePlusMonthly,
    netProfitMonthly: cashDiscountMonthly * 0.65,
    bestResidual: Math.max(cashDiscountMonthly, interchangePlusMonthly),
    grossProfitBps: CASH_DISCOUNT_MARGIN_BPS,
    merchantTier: determineTier(ccVolume),
  };
}

function unavailableEstimate(model: VolumeModelBasis, avgTicket: number | null = null): VolumeEstimate {
  return {
    estimatedProcessingVolume: null, estimatedResidual: null, estimatedGrossProfitBps: null,
    estimatedGrossProfitMonthly: null, estimatedNetProfitMonthly: null, volumeConfidence: null,
    cashDiscountResidual: null, interchangePlusResidual: null, merchantTier: null,
    estimatedAvgTicket: avgTicket && avgTicket > 0 ? formatDollars(avgTicket) : null,
    volumeSource: "unavailable", model: publicBasis(model),
  };
}

function publicBasis(model: ResolvedVolumeModel | VolumeModelBasis): VolumeModelBasis {
  const { status, modelId, version, resolvedVertical, basis, reason } = model;
  return { status, modelId, version, resolvedVertical, basis, reason };
}

function buildEstimate(opts: {
  ccVolume: number; avgTicket: number | null; confidence: string; residual: "cash" | "best";
  source: VolumeEstimateSource; model: VolumeModelBasis;
}): VolumeEstimate {
  if (!Number.isFinite(opts.ccVolume) || opts.ccVolume <= 0) return unavailableEstimate(opts.model, opts.avgTicket);
  const r = computeResiduals(opts.ccVolume);
  const residual = opts.residual === "best" ? r.bestResidual : r.cashDiscountMonthly;
  return {
    estimatedProcessingVolume: formatDollars(opts.ccVolume),
    estimatedResidual: formatDollars(residual),
    estimatedGrossProfitBps: r.grossProfitBps,
    estimatedGrossProfitMonthly: formatDollars(r.cashDiscountMonthly),
    estimatedNetProfitMonthly: formatDollars(r.netProfitMonthly),
    volumeConfidence: opts.confidence,
    cashDiscountResidual: formatDollars(r.cashDiscountMonthly),
    interchangePlusResidual: formatDollars(r.interchangePlusMonthly),
    merchantTier: r.merchantTier,
    estimatedAvgTicket: opts.avgTicket && opts.avgTicket > 0 ? formatDollars(opts.avgTicket) : null,
    volumeSource: opts.source,
    model: publicBasis(opts.model),
  };
}

/** Drop null/undefined so an unavailable value can never overwrite stored data. */
export function definedFields<T extends Record<string, unknown>>(values: T): { [K in keyof T]?: NonNullable<T[K]> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) out[key] = value;
  return out as { [K in keyof T]?: NonNullable<T[K]> };
}

export function estimateFromVertical(vertical: string | null | undefined): VolumeEstimate {
  const model = resolveVolumeModel(vertical);
  if (!model.assumptions) return unavailableEstimate(model);
  const a = model.assumptions;
  return buildEstimate({ ccVolume: a.avgMonthlyVolume * a.ccRatio, avgTicket: a.avgTicket, confidence: "low",
    residual: "cash", source: "modeled", model });
}

export function estimateFromContact(contact: Contact): VolumeEstimate {
  const model = resolveVolumeModel(contact.vertical);
  const actualAvgTicket = parseMoney(contact.avgTicket);
  const actualMonthlyVolume = parseMoney(contact.monthlyVolume);
  // Converting a monthly volume to card volume needs the model's card ratio;
  // without a model the actual facts stay untouched and no estimate is made.
  if (!model.assumptions) return unavailableEstimate(model, actualAvgTicket || null);
  const defaults = model.assumptions;

  let monthlyVolume = actualMonthlyVolume;
  let avgTicket = actualAvgTicket;
  if (!monthlyVolume && avgTicket) {
    monthlyVolume = avgTicket * Math.round(defaults.avgMonthlyVolume / defaults.avgTicket);
  }
  if (!monthlyVolume) monthlyVolume = defaults.avgMonthlyVolume;
  if (!avgTicket) avgTicket = defaults.avgTicket;

  const locations = Number(contact.locationCount);
  const locationMultiplier = Number.isFinite(locations) && locations >= 1 ? locations : 1;
  const ccVolume = monthlyVolume * locationMultiplier * defaults.ccRatio;
  return buildEstimate({ ccVolume, avgTicket, confidence: actualMonthlyVolume ? "medium" : "low", residual: "cash",
    source: actualMonthlyVolume ? "actual" : "modeled", model });
}

export function estimateFromDeal(deal: Deal, contact?: Contact | null): VolumeEstimate {
  const stage = deal.stage || "New Lead";
  const confidence = STAGE_CONFIDENCE[stage] || "low";
  const model = resolveVolumeModel(contact?.vertical);
  const defaults = model.assumptions;

  let avgTicket = parseMoney(deal.avgTicket) || parseMoney(contact?.avgTicket) || (defaults?.avgTicket ?? 0);
  let ccVolume = 0;
  let hasStatementData = false;
  let source: VolumeEstimateSource = "actual";

  if (deal.savingsProposal && typeof deal.savingsProposal === "object") {
    const proposal = deal.savingsProposal as any;
    const totalVol = parseMoney(proposal.currentTotalVolume || proposal.monthlyVolume);
    if (totalVol > 0) { ccVolume = totalVol; hasStatementData = true; }
    const propAvgTicket = parseMoney(proposal.avgTicket);
    if (propAvgTicket > 0) avgTicket = propAvgTicket;
  }
  if (!ccVolume) {
    const dealVol = parseMoney(deal.totalVolume);
    if (dealVol > 0) { ccVolume = dealVol; hasStatementData = true; }
  }
  if (!ccVolume && contact && defaults) {
    const contactVol = parseMoney(contact.monthlyVolume);
    if (contactVol > 0) { ccVolume = contactVol * defaults.ccRatio; source = "modeled"; }
  }
  if (!ccVolume && defaults) {
    ccVolume = defaults.avgMonthlyVolume * defaults.ccRatio;
    source = "modeled";
  }
  if (!ccVolume) return unavailableEstimate(model, avgTicket || null);

  const effectiveConfidence = hasStatementData && confidence === "low" ? "medium" : confidence;
  return buildEstimate({ ccVolume, avgTicket: avgTicket || null, confidence: effectiveConfidence, residual: "best", source, model });
}

export function estimateFromProspect(prospect: Prospect): VolumeEstimate {
  const model = resolveVolumeModel(prospect.vertical);
  const actualAvgTicket = parseMoney(prospect.estimatedAvgTicket);
  if (!model.assumptions) return unavailableEstimate(model, actualAvgTicket || null);
  const defaults = model.assumptions;

  let volume = parseMoney(prospect.estimatedVolume);
  const hadVolume = volume > 0;
  if (!volume && prospect.estimatedRevenue) volume = parseMoney(prospect.estimatedRevenue) * 0.5;
  if (!volume) volume = defaults.avgMonthlyVolume;

  return buildEstimate({ ccVolume: volume * defaults.ccRatio, avgTicket: actualAvgTicket || defaults.avgTicket,
    confidence: hadVolume ? "medium" : "low", residual: "cash", source: hadVolume ? "actual" : "modeled", model });
}
