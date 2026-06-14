export type ApprovalTier = "green" | "yellow" | "red";

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

export function calculatePayback(libertyCost: number, estimatedMonthlyGp: number): TerminalEconomics {
  const paybackMonths =
    estimatedMonthlyGp > 0 ? Math.round((libertyCost / estimatedMonthlyGp) * 10) / 10 : null;

  let approvalTier: ApprovalTier = "green";
  if (paybackMonths === null || paybackMonths > RED_THRESHOLD_MONTHS) {
    approvalTier = "red";
  } else if (paybackMonths > GREEN_THRESHOLD_MONTHS) {
    approvalTier = "yellow";
  }

  return {
    libertyCost,
    estimatedMonthlyGp,
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
  green:  { label: "Auto-Approve",        color: "text-green-700",  badgeClass: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300" },
  yellow: { label: "Rep Discretion",      color: "text-yellow-700", badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300" },
  red:    { label: "Manager Approval Required", color: "text-red-700",    badgeClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300" },
};
