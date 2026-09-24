/**
 * sfp-cost-preview.ts
 *
 * Task #1999 (C8): billing-semantic cost preview for the SFP paid waterfall
 * and the pre-cohort classification bridge's own Serper/OpenAI usage.
 *
 * Reuses the EXISTING pricing/budget authority (getCurrentPricingSchedule,
 * currentSfpUnitPrice, the same $50 aggregate cap sfp-provider-operations.ts
 * already enforces at reservation time) rather than inventing a second price
 * source — this module is read-only and must never diverge from what
 * reserveSfpProviderOperation will actually charge.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getCurrentPricingSchedule, MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS, getAggregatePilotSpend } from "../mi09-pilot-authority";
import { currentSfpUnitPrice } from "./sfp-provider-operations";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export type SfpCostPreviewProvider = "serper" | "outscraper" | "apollo" | "openai_classification";

/**
 * Real per-provider billing units: Serper bills per REQUEST (up to 4 per
 * identity lookup — domain, phone, address, and a corroboration pass, per
 * the existing lookupBusinessIdentity call shape); OpenAI bills per TOKEN
 * (approximated here as a bounded classification-call token estimate, not a
 * flat per-business multiplier); Outscraper/Apollo bill per RESULT/unit
 * returned. This map is the single place that encodes "how many raw billing
 * units does one business cost this provider" so a flat per-business
 * multiplier can never silently creep back in.
 */
const ESTIMATED_UNITS_PER_BUSINESS: Record<SfpCostPreviewProvider, { estimated: number; worstCase: number; unitLabel: string }> = {
  serper: { estimated: 1, worstCase: 4, unitLabel: "requests" },
  outscraper: { estimated: 1, worstCase: 2, unitLabel: "results" },
  apollo: { estimated: 1, worstCase: 1, unitLabel: "units" },
  openai_classification: { estimated: 800, worstCase: 2000, unitLabel: "tokens" },
};

export interface SfpCostPreviewLine {
  provider: SfpCostPreviewProvider;
  controlProviderKey: string;
  gapCountDrivingCall: number;
  estimatedUnits: number;
  worstCaseUnits: number;
  unitLabel: string;
  priceScheduleVersion: string | number | null;
  unitAmountMicros: number;
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  remainingAggregateBudgetMicros: number;
  remainingProviderControlUnits: number | null;
}

export interface SfpCostPreview {
  generatedAt: string;
  lines: SfpCostPreviewLine[];
  totalEstimatedCostMicros: number;
  totalWorstCaseCostMicros: number;
  aggregateCapMicros: number;
  aggregateRemainingMicros: number;
  overCapIfWorstCase: boolean;
}

export interface SfpGapCounts {
  officialDomainGapCount: number; // drives serper
  businessIdentityGapCount: number; // drives outscraper
  decisionMakerGapCount: number; // drives apollo
  ambiguousVerticalGapCount: number; // drives openai_classification
}

async function currentSfpAggregateSpendMicros(): Promise<{ settledMicros: number; reservedMicros: number }> {
  const sfpSpend = rows(await db.execute(sql`
    SELECT COALESCE(SUM(reserved_cost_micros),0)::bigint AS reserved,
           COALESCE(SUM(settled_cost_micros),0)::bigint AS settled
      FROM sfp_stage_runs WHERE state IN ('authorized','running','completed','partial')
  `))[0];
  // Task #1999 Architecture correction: Phase A's own classification-bridge
  // spend (Serper domain discovery, cached OpenAI escalation) lands in
  // sfp_classification_evidence.cost_micros, a ledger sfp_stage_runs never
  // sees. Both ledgers must count against the same $50 cap, matching
  // reservePreCohortSfpProviderOperation's own combined-spend check.
  const classificationSpend = rows(await db.execute(sql`
    SELECT COALESCE(SUM(cost_micros),0)::bigint AS spent FROM sfp_classification_evidence
  `))[0];
  const pilotSpend = await getAggregatePilotSpend();
  return {
    settledMicros: Number(sfpSpend?.settled ?? 0) + Number(classificationSpend?.spent ?? 0) + pilotSpend.settledMicros,
    reservedMicros: Number(sfpSpend?.reserved ?? 0) + pilotSpend.reservedMicros,
  };
}

/** Read-only remaining local_budget_units headroom per control provider. */
async function remainingControlUnits(controlProvider: string): Promise<number | null> {
  const row = rows(await db.execute(sql`
    SELECT local_budget_units, reserved_units, consumed_units
      FROM provider_controls WHERE provider = ${controlProvider} LIMIT 1
  `))[0];
  if (!row || row.local_budget_units === null || row.local_budget_units === undefined) return null;
  return Math.max(0, Number(row.local_budget_units) - Number(row.reserved_units ?? 0) - Number(row.consumed_units ?? 0));
}

const CONTROL_KEY: Record<SfpCostPreviewProvider, string> = {
  serper: "serper", outscraper: "outscraper", apollo: "apollo", openai_classification: "openai",
};

/**
 * Read-only preview. Reservation/settlement (sfp-provider-operations.ts)
 * MUST reconcile to this same plan: it uses the identical
 * currentSfpUnitPrice()/getCurrentPricingSchedule() source and the identical
 * $50 aggregate-cap accounting, so a preview never promises headroom the
 * real reservation call would then deny.
 */
export async function buildSfpCostPreview(gapCounts: SfpGapCounts): Promise<SfpCostPreview> {
  const pricing = await getCurrentPricingSchedule();
  const { settledMicros, reservedMicros } = await currentSfpAggregateSpendMicros();
  const capMicros = MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS;
  const remainingMicros = Math.max(0, capMicros - settledMicros - reservedMicros);

  const gapByProvider: Record<SfpCostPreviewProvider, number> = {
    serper: gapCounts.officialDomainGapCount,
    outscraper: gapCounts.businessIdentityGapCount,
    apollo: gapCounts.decisionMakerGapCount,
    openai_classification: gapCounts.ambiguousVerticalGapCount,
  };

  const lines: SfpCostPreviewLine[] = [];
  for (const provider of Object.keys(gapByProvider) as SfpCostPreviewProvider[]) {
    const gapCount = gapByProvider[provider];
    const controlProviderKey = CONTROL_KEY[provider];
    const perBiz = ESTIMATED_UNITS_PER_BUSINESS[provider];
    let unitAmountMicros = 0;
    try {
      unitAmountMicros = await currentSfpUnitPrice(provider as any);
    } catch { /* pricing unavailable for this provider — surface as zero-cost/blocked line */ }
    const scheduleEntry = (pricing.priceSchedules as any)[controlProviderKey];
    const estimatedUnits = gapCount * perBiz.estimated;
    const worstCaseUnits = gapCount * perBiz.worstCase;
    lines.push({
      provider,
      controlProviderKey,
      gapCountDrivingCall: gapCount,
      estimatedUnits,
      worstCaseUnits,
      unitLabel: perBiz.unitLabel,
      priceScheduleVersion: scheduleEntry?.version ?? scheduleEntry?.effectiveAt ?? null,
      unitAmountMicros,
      estimatedCostMicros: estimatedUnits * unitAmountMicros,
      worstCaseCostMicros: worstCaseUnits * unitAmountMicros,
      remainingAggregateBudgetMicros: remainingMicros,
      remainingProviderControlUnits: await remainingControlUnits(controlProviderKey),
    });
  }

  const totalEstimatedCostMicros = lines.reduce((s, l) => s + l.estimatedCostMicros, 0);
  const totalWorstCaseCostMicros = lines.reduce((s, l) => s + l.worstCaseCostMicros, 0);

  return {
    generatedAt: new Date().toISOString(),
    lines,
    totalEstimatedCostMicros,
    totalWorstCaseCostMicros,
    aggregateCapMicros: capMicros,
    aggregateRemainingMicros: remainingMicros,
    overCapIfWorstCase: (settledMicros + reservedMicros + totalWorstCaseCostMicros) > capMicros,
  };
}
