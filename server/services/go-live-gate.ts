/**
 * Thrown by advanceDealStage when a go-live stage transition is blocked by the gate
 * and no valid override context was provided.
 *
 * Callers that do NOT want to crash on a blocked gate should catch this specifically:
 *
 *   try {
 *     await advanceDealStage(id, stage, trigger);
 *   } catch (err) {
 *     if (err instanceof GoLiveGateError) { ... handle block ... }
 *     else throw err;
 *   }
 */
export class GoLiveGateError extends Error {
  readonly name = "GoLiveGateError";
  constructor(
    public readonly dealId: number,
    public readonly attemptedStage: string,
    public readonly missing: string[],
    public readonly trigger: string,
  ) {
    super(
      `Go-live gate blocked stage "${attemptedStage}" for onboarding deal #${dealId} ` +
      `(trigger: ${trigger}): ${missing.join("; ")}`,
    );
  }
}

/**
 * Go-Live Gate — shared service module.
 *
 * Imported by:
 *   - server/routes/onboarding-stages.ts  (readiness endpoint)
 *   - server/routes/deals.ts              (PUT /api/deals/:id user override logging)
 *   - server/services/deal-stage-service  (advanceDealStage central path)
 *   - server/services/ghl-sync.ts         (inbound GHL opportunity stage writes)
 *
 * Keeping this in a service file (not a route file) avoids circular imports.
 */

import { storage } from "../storage";
import {
  ONBOARDING_CHECKLIST_ITEM_KEYS,
  ONBOARDING_CHECKLIST_ITEM_LABELS,
} from "@shared/schema";

/** Onboarding pipeline stages that require the gate to pass before advancement. */
export const GO_LIVE_GATE_STAGES = [
  "Go-Live Scheduled",
  "Live (First Batch)",
  "Active (7 Days)",
  "Active (30 Days)",
] as const;

export type GoLiveGateStage = typeof GO_LIVE_GATE_STAGES[number];

/** Terminal statuses that satisfy the equipment-confirmed requirement. */
const TERMINAL_OK_STATUSES = [
  "shipped",
  "delivered",
  "installed",
  "n/a - virtual",
  "gateway only",
];

export interface GoLiveReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface GoLiveReadinessResult {
  ready: boolean;
  checks: GoLiveReadinessCheck[];
  missing: string[];
}

/**
 * Evaluates readiness from already-fetched, locked row data.
 * Used inside DB transactions where we can't call storage methods.
 */
export function evaluateReadinessFromRawRows(
  dealRow: { mid?: string | null; terminal_status?: string | null },
  checklistRows: Array<{ item_key: string; status: string | null }>,
): GoLiveReadinessResult {
  const checks: GoLiveReadinessCheck[] = [];

  const midPassed = Boolean(dealRow.mid && String(dealRow.mid).trim().length > 0);
  checks.push({ key: "mid", label: "MID Assigned", passed: midPassed, detail: dealRow.mid || undefined });

  for (const key of ONBOARDING_CHECKLIST_ITEM_KEYS) {
    const item = checklistRows.find((r) => r.item_key === key);
    const passed = item?.status === "approved";
    checks.push({
      key: `checklist_${key}`,
      label: ONBOARDING_CHECKLIST_ITEM_LABELS[key as keyof typeof ONBOARDING_CHECKLIST_ITEM_LABELS] ?? key,
      passed,
      detail: item?.status || "not_requested",
    });
  }

  const termStatus = (dealRow.terminal_status || "").toLowerCase().trim();
  const termPassed = TERMINAL_OK_STATUSES.includes(termStatus);
  checks.push({
    key: "terminal",
    label: "Terminal Status",
    passed: termPassed,
    detail: dealRow.terminal_status || "Not set",
  });

  const missing = checks
    .filter((c) => !c.passed)
    .map((c) => {
      if (c.key === "mid") return "MID not assigned";
      if (c.key === "terminal")
        return `Terminal status must be Shipped, Delivered, Installed, or N/A-Virtual (currently: ${c.detail})`;
      return `${c.label} not approved (status: ${c.detail})`;
    });

  return { ready: missing.length === 0, checks, missing };
}

/**
 * Returns a full readiness report for advancing an onboarding deal to Go-Live or later.
 *
 * Checks:
 *   1. MID is assigned on the deal
 *   2. All onboarding checklist items (voided check, ID, signed agreement, bank letter,
 *      business license) have status "approved"
 *   3. Terminal status is Shipped / Delivered / Installed / N/A-Virtual / Gateway Only
 */
export async function checkGoLiveReadiness(deal: any): Promise<GoLiveReadinessResult> {
  const checks: GoLiveReadinessCheck[] = [];

  // 1 — MID assigned
  const midPassed = Boolean(deal.mid && String(deal.mid).trim().length > 0);
  checks.push({
    key: "mid",
    label: "MID Assigned",
    passed: midPassed,
    detail: deal.mid || undefined,
  });

  // 2 — Checklist items (all must be "approved")
  const checklistItems = await storage.getOnboardingChecklistItems(deal.id);
  for (const key of ONBOARDING_CHECKLIST_ITEM_KEYS) {
    const item = checklistItems.find((i: any) => i.itemKey === key);
    const passed = item?.status === "approved";
    checks.push({
      key: `checklist_${key}`,
      label: ONBOARDING_CHECKLIST_ITEM_LABELS[key as keyof typeof ONBOARDING_CHECKLIST_ITEM_LABELS] ?? key,
      passed,
      detail: item?.status || "not_requested",
    });
  }

  // 3 — Terminal status is confirmed or not required
  const termStatus = (deal.terminalStatus || "").toLowerCase().trim();
  const termPassed = TERMINAL_OK_STATUSES.includes(termStatus);
  checks.push({
    key: "terminal",
    label: "Terminal Status",
    passed: termPassed,
    detail: deal.terminalStatus || "Not set",
  });

  const missing = checks
    .filter((c) => !c.passed)
    .map((c) => {
      if (c.key === "mid") return "MID not assigned";
      if (c.key === "terminal")
        return `Terminal status must be Shipped, Delivered, Installed, or N/A-Virtual (currently: ${c.detail})`;
      return `${c.label} not approved (status: ${c.detail})`;
    });

  return { ready: missing.length === 0, checks, missing };
}
