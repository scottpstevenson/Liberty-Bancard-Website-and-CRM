import type { Contact, Deal, Prospect } from "@shared/schema";

const VERTICAL_VOLUME_DEFAULTS: Record<string, { avgMonthlyVolume: number; avgTicket: number; ccRatio: number }> = {
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

const CASH_DISCOUNT_MARGIN_BPS = 350;
const INTERCHANGE_PLUS_MARGIN_BPS = 35;

const STAGE_CONFIDENCE: Record<string, string> = {
  "New Lead": "low",
  "Statement Collected": "medium",
  "Statement Received": "medium",
  "Under Review": "medium",
  "Proposal Sent": "high",
  "Negotiation": "high",
  "Verbal Commit": "high",
  "Call Booked": "medium",
  "Closed Won": "actual",
  "Closed Lost": "low",
};

export interface VolumeEstimate {
  estimatedProcessingVolume: string;
  estimatedResidual: string;
  estimatedGrossProfitBps: number;
  estimatedGrossProfitMonthly: string;
  estimatedNetProfitMonthly: string;
  volumeConfidence: string;
  cashDiscountResidual: string;
  interchangePlusResidual: string;
  merchantTier: string;
  estimatedAvgTicket: string;
}

function parseMoney(val: string | null | undefined): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,\s]/g, "")) || 0;
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

function computeResiduals(ccVolume: number, avgTicket: number) {
  const cashDiscountMonthly = (ccVolume * CASH_DISCOUNT_MARGIN_BPS) / 10000;
  const interchangePlusMonthly = (ccVolume * INTERCHANGE_PLUS_MARGIN_BPS) / 10000;
  const netProfitMonthly = cashDiscountMonthly * 0.65;
  const bestResidual = Math.max(cashDiscountMonthly, interchangePlusMonthly);

  return {
    cashDiscountMonthly,
    interchangePlusMonthly,
    netProfitMonthly,
    bestResidual,
    grossProfitBps: CASH_DISCOUNT_MARGIN_BPS,
    merchantTier: determineTier(ccVolume),
    avgTicket,
  };
}

export function estimateFromVertical(vertical: string | null | undefined): VolumeEstimate {
  const v = vertical && VERTICAL_VOLUME_DEFAULTS[vertical] ? vertical : "Other";
  const defaults = VERTICAL_VOLUME_DEFAULTS[v];

  const ccVolume = defaults.avgMonthlyVolume * defaults.ccRatio;
  const r = computeResiduals(ccVolume, defaults.avgTicket);

  return {
    estimatedProcessingVolume: formatDollars(ccVolume),
    estimatedResidual: formatDollars(r.cashDiscountMonthly),
    estimatedGrossProfitBps: r.grossProfitBps,
    estimatedGrossProfitMonthly: formatDollars(r.cashDiscountMonthly),
    estimatedNetProfitMonthly: formatDollars(r.netProfitMonthly),
    volumeConfidence: "low",
    cashDiscountResidual: formatDollars(r.cashDiscountMonthly),
    interchangePlusResidual: formatDollars(r.interchangePlusMonthly),
    merchantTier: r.merchantTier,
    estimatedAvgTicket: formatDollars(defaults.avgTicket),
  };
}

export function estimateFromContact(contact: Contact): VolumeEstimate {
  const vertical = contact.vertical || "Other";
  const defaults = VERTICAL_VOLUME_DEFAULTS[vertical] || VERTICAL_VOLUME_DEFAULTS["Other"];
  const ccRatio = defaults.ccRatio;

  let monthlyVolume = parseMoney(contact.monthlyVolume);
  let avgTicket = parseMoney(contact.avgTicket);

  if (!monthlyVolume && avgTicket) {
    const estTransactionsPerMonth = Math.round(defaults.avgMonthlyVolume / defaults.avgTicket);
    monthlyVolume = avgTicket * estTransactionsPerMonth;
  }
  if (!monthlyVolume) {
    monthlyVolume = defaults.avgMonthlyVolume;
  }
  if (!avgTicket) {
    avgTicket = defaults.avgTicket;
  }

  const locationMultiplier = (contact.locationCount || 1);
  const totalVolume = monthlyVolume * locationMultiplier;
  const ccVolume = totalVolume * ccRatio;

  const r = computeResiduals(ccVolume, avgTicket);
  const confidence = contact.monthlyVolume ? "medium" : "low";

  return {
    estimatedProcessingVolume: formatDollars(ccVolume),
    estimatedResidual: formatDollars(r.cashDiscountMonthly),
    estimatedGrossProfitBps: r.grossProfitBps,
    estimatedGrossProfitMonthly: formatDollars(r.cashDiscountMonthly),
    estimatedNetProfitMonthly: formatDollars(r.netProfitMonthly),
    volumeConfidence: confidence,
    cashDiscountResidual: formatDollars(r.cashDiscountMonthly),
    interchangePlusResidual: formatDollars(r.interchangePlusMonthly),
    merchantTier: r.merchantTier,
    estimatedAvgTicket: formatDollars(avgTicket),
  };
}

export function estimateFromDeal(deal: Deal, contact?: Contact | null): VolumeEstimate {
  const stage = deal.stage || "New Lead";
  const confidence = STAGE_CONFIDENCE[stage] || "low";

  const vertical = contact?.vertical || "Other";
  const defaults = VERTICAL_VOLUME_DEFAULTS[vertical] || VERTICAL_VOLUME_DEFAULTS["Other"];
  let avgTicket = parseMoney(deal.avgTicket) || parseMoney(contact?.avgTicket) || defaults.avgTicket;

  let ccVolume = 0;
  let hasStatementData = false;

  if (deal.savingsProposal && typeof deal.savingsProposal === "object") {
    const proposal = deal.savingsProposal as any;
    const totalVol = parseMoney(proposal.currentTotalVolume || proposal.monthlyVolume);
    if (totalVol > 0) {
      ccVolume = totalVol;
      hasStatementData = true;
    }
    const propAvgTicket = parseMoney(proposal.avgTicket);
    if (propAvgTicket > 0) avgTicket = propAvgTicket;
  }

  if (!ccVolume) {
    const dealVol = parseMoney(deal.totalVolume);
    if (dealVol > 0) {
      ccVolume = dealVol;
      hasStatementData = true;
    }
  }

  if (!ccVolume && contact) {
    const contactVol = parseMoney(contact.monthlyVolume);
    if (contactVol > 0) {
      ccVolume = contactVol * defaults.ccRatio;
    }
  }

  if (!ccVolume) {
    ccVolume = defaults.avgMonthlyVolume * defaults.ccRatio;
  }

  const r = computeResiduals(ccVolume, avgTicket);

  const effectiveConfidence = hasStatementData && (confidence === "low") ? "medium" : confidence;

  return {
    estimatedProcessingVolume: formatDollars(ccVolume),
    estimatedResidual: formatDollars(r.bestResidual),
    estimatedGrossProfitBps: r.grossProfitBps,
    estimatedGrossProfitMonthly: formatDollars(r.cashDiscountMonthly),
    estimatedNetProfitMonthly: formatDollars(r.netProfitMonthly),
    volumeConfidence: effectiveConfidence,
    cashDiscountResidual: formatDollars(r.cashDiscountMonthly),
    interchangePlusResidual: formatDollars(r.interchangePlusMonthly),
    merchantTier: r.merchantTier,
    estimatedAvgTicket: formatDollars(avgTicket),
  };
}

export function estimateFromProspect(prospect: Prospect): VolumeEstimate {
  const vertical = prospect.vertical || "Other";
  const defaults = VERTICAL_VOLUME_DEFAULTS[vertical] || VERTICAL_VOLUME_DEFAULTS["Other"];

  let volume = parseMoney(prospect.estimatedVolume);
  if (!volume && prospect.estimatedRevenue) {
    volume = parseMoney(prospect.estimatedRevenue) * 0.5;
  }
  if (!volume) {
    volume = defaults.avgMonthlyVolume;
  }

  const ccVolume = volume * defaults.ccRatio;
  const avgTicket = parseMoney(prospect.estimatedAvgTicket) || defaults.avgTicket;
  const r = computeResiduals(ccVolume, avgTicket);

  return {
    estimatedProcessingVolume: formatDollars(ccVolume),
    estimatedResidual: formatDollars(r.cashDiscountMonthly),
    estimatedGrossProfitBps: r.grossProfitBps,
    estimatedGrossProfitMonthly: formatDollars(r.cashDiscountMonthly),
    estimatedNetProfitMonthly: formatDollars(r.netProfitMonthly),
    volumeConfidence: prospect.estimatedVolume ? "medium" : "low",
    cashDiscountResidual: formatDollars(r.cashDiscountMonthly),
    interchangePlusResidual: formatDollars(r.interchangePlusMonthly),
    merchantTier: r.merchantTier,
    estimatedAvgTicket: formatDollars(avgTicket),
  };
}
