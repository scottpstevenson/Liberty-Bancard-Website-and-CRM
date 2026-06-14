import { storage } from "../storage";

// ── Synchronous tier helpers (used by TerminalEconomicsCard and order-time logic) ──

export type ApprovalTier = "green" | "yellow" | "red";
export type PaybackTier = ApprovalTier;

export interface TerminalEconomics {
  libertyCost: number;
  estimatedMonthlyGp: number;
  paybackMonths: number | null;
  approvalTier: ApprovalTier;
  requiresApproval: boolean;
}

const GREEN_THRESHOLD_MONTHS = 6;
const RED_THRESHOLD_MONTHS = 12;

export const TERMINAL_CATALOG: Record<string, { libertyCost: number; msrp: number; label: string }> = {
  "Clover Flex 3":        { libertyCost: 299, msrp: 499,  label: "Clover Flex 3" },
  "Clover Mini 3":        { libertyCost: 249, msrp: 399,  label: "Clover Mini 3" },
  "Clover Station Duo":   { libertyCost: 799, msrp: 1299, label: "Clover Station Duo" },
  "Dejavoo QD4":          { libertyCost: 149, msrp: 249,  label: "Dejavoo QD4" },
  "PAX A920":             { libertyCost: 199, msrp: 349,  label: "PAX A920" },
  "SwipeSimple B250":     { libertyCost: 79,  msrp: 149,  label: "SwipeSimple B250" },
  "Virtual Terminal":     { libertyCost: 0,   msrp: 0,    label: "Virtual Terminal (software)" },
};

const DEFAULT_TERMINAL_COST = 200;
const DEFAULT_MARGIN_BPS = 20;

export function lookupTerminalCost(terminalName: string): number {
  if (!terminalName) return DEFAULT_TERMINAL_COST;
  const key = Object.keys(TERMINAL_CATALOG).find(
    (k) => terminalName.toLowerCase().includes(k.toLowerCase())
  );
  return key ? TERMINAL_CATALOG[key].libertyCost : DEFAULT_TERMINAL_COST;
}

export function estimateMonthlyGp(monthlyVolumeDollars: number, marginBps = DEFAULT_MARGIN_BPS): number {
  if (!monthlyVolumeDollars || monthlyVolumeDollars <= 0) return 0;
  return Math.round(((monthlyVolumeDollars * marginBps) / 10000) * 100) / 100;
}

export function calculatePayback(libertyCost: number, estimatedMonthlyGp: number): TerminalEconomics;
export function calculatePayback(
  terminalCost: number,
  estimatedMonthlyGrossProfit: number,
  greenThreshold: number,
  yellowThreshold: number
): { paybackMonths: number | null; tier: PaybackTier };
export function calculatePayback(
  cost: number,
  monthlyGp: number,
  greenThreshold?: number,
  yellowThreshold?: number
): any {
  if (greenThreshold !== undefined && yellowThreshold !== undefined) {
    if (monthlyGp <= 0) return { paybackMonths: null, tier: "red" as PaybackTier };
    const paybackMonths = Math.ceil(cost / monthlyGp);
    const tier: PaybackTier =
      paybackMonths <= greenThreshold ? "green" : paybackMonths <= yellowThreshold ? "yellow" : "red";
    return { paybackMonths, tier };
  }

  const paybackMonths =
    monthlyGp > 0 ? Math.round((cost / monthlyGp) * 10) / 10 : null;
  let approvalTier: ApprovalTier = "green";
  if (paybackMonths === null || paybackMonths > RED_THRESHOLD_MONTHS) {
    approvalTier = "red";
  } else if (paybackMonths > GREEN_THRESHOLD_MONTHS) {
    approvalTier = "yellow";
  }
  return {
    libertyCost: cost,
    estimatedMonthlyGp: monthlyGp,
    paybackMonths,
    approvalTier,
    requiresApproval: approvalTier === "red",
  };
}

export function computeOrderEconomics(
  equipmentType: string,
  monthlyVolumeDollars: number | null
): Omit<TerminalEconomics, "requiresApproval"> & { requiresApproval: boolean } {
  const libertyCost = lookupTerminalCost(equipmentType);
  const monthlyGp = estimateMonthlyGp(monthlyVolumeDollars ?? 0);
  return calculatePayback(libertyCost, monthlyGp);
}

export const TIER_CONFIG: Record<ApprovalTier, { label: string; color: string; badgeClass: string }> = {
  green:  { label: "Auto-Approve",             color: "text-green-700",  badgeClass: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300" },
  yellow: { label: "Rep Discretion",           color: "text-yellow-700", badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300" },
  red:    { label: "Manager Approval Required", color: "text-red-700",   badgeClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300" },
};

// ── DB-backed async service (deal-level economics, configurable thresholds) ──

export interface TerminalEconomicsConfig {
  greenThresholdMonths: number;
  yellowThresholdMonths: number;
}

export interface PaybackResult {
  terminalModel: string;
  terminalCost: number;
  msrp: number;
  estimatedMonthlyGrossProfit: number;
  paybackMonths: number | null;
  tier: PaybackTier;
  greenThreshold: number;
  yellowThreshold: number;
  leaseComparison: {
    competitorMonthlyLease: number;
    savingsVsLease3Year: number;
  };
}

const DEFAULT_CONFIG: TerminalEconomicsConfig = {
  greenThresholdMonths: GREEN_THRESHOLD_MONTHS,
  yellowThresholdMonths: RED_THRESHOLD_MONTHS,
};

export async function getEconomicsConfig(): Promise<TerminalEconomicsConfig> {
  const raw = await storage.getSystemSetting("terminal_economics_config");
  if (raw && typeof raw === "object") {
    return {
      greenThresholdMonths: Number((raw as any).greenThresholdMonths) || DEFAULT_CONFIG.greenThresholdMonths,
      yellowThresholdMonths: Number((raw as any).yellowThresholdMonths) || DEFAULT_CONFIG.yellowThresholdMonths,
    };
  }
  return { ...DEFAULT_CONFIG };
}

export async function computeDealTerminalEconomics(dealId: number): Promise<PaybackResult | null> {
  const deal = await storage.getDeal(dealId);
  if (!deal || !deal.terminalRecommendation) return null;

  const models = await storage.getEquipmentModels();
  const model = models.find(
    (m) => m.name.toLowerCase() === deal.terminalRecommendation!.toLowerCase() && m.isActive
  ) || models.find(
    (m) => deal.terminalRecommendation!.toLowerCase().includes(m.name.toLowerCase().split(" ")[0].toLowerCase()) && m.isActive
  );

  if (!model) return null;

  const config = await getEconomicsConfig();

  const monthlyGP = deal.estimatedGrossProfitMonthly
    ? parseFloat(deal.estimatedGrossProfitMonthly.replace(/[^0-9.-]/g, ""))
    : 0;

  const { paybackMonths, tier } = calculatePayback(
    model.libertyCost,
    monthlyGP,
    config.greenThresholdMonths,
    config.yellowThresholdMonths
  );

  const competitorMonthlyLease = Math.round(model.msrp * 0.025);
  const savingsVsLease3Year = competitorMonthlyLease * 36;

  return {
    terminalModel: model.name,
    terminalCost: model.libertyCost,
    msrp: model.msrp,
    estimatedMonthlyGrossProfit: monthlyGP,
    paybackMonths,
    tier,
    greenThreshold: config.greenThresholdMonths,
    yellowThreshold: config.yellowThresholdMonths,
    leaseComparison: {
      competitorMonthlyLease,
      savingsVsLease3Year,
    },
  };
}
