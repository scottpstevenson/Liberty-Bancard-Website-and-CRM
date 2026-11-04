/**
 * Stage 5 CP3 — underwriting engine required-evidence certification (S5-07).
 * Runs the REAL engine with the rules reader replaced by a fixed rule set; no database writes, no provider, no deal change.
 *
 * Missing, invalid, nonfinite or contradictory evidence/rules must produce review (never approve/100); valid documented
 * low-risk evidence still approves; threshold boundaries and disabled auto-approval are unchanged.
 */
import assert from "node:assert/strict";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "Stage 5 underwriting evidence certification" });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { runUnderwritingEngine } = await import("../../server/services/underwriting-engine");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-UW-${String(checks).padStart(2, "0")}] ${message}`); };

const baseRules = {
  minMonthlyVolume: "5000", maxMonthlyVolume: "500000", effectiveRateCeiling: "3.5",
  chargebackRateLimit: "1.0", chargebackRateHardLimit: "2.0", volumeHardDeviationPct: "50",
  blockedProcessors: [] as string[], autoApproveEnabled: true,
};
let rules: any = { ...baseRules };
(storage as any).getUnderwritingRules = async () => rules;

const deal = (over: Record<string, unknown> = {}) => ({ id: 1, totalVolume: null, effectiveRate: null, dealBlueprint: null, savingsProposal: null, ...over }) as any;
const good = { monthlyVolume: 50000, effectiveRatePct: 2.5, chargebackRatePct: 0.3 };
const run = (input: Record<string, unknown> = {}, d = deal()) => runUnderwritingEngine({ deal: d, ...input } as any);

// Valid documented low-risk evidence still approves (positive control).
{
  const r = await run(good);
  check(r.decision === "approve" && r.score === 100, "complete low-risk evidence approves");
}
// Negative control: the original behaviour approved with NO evidence at all.
{
  const r = await run({});
  check(r.decision === "review" && r.score <= 50, "no evidence at all is review, never approve/100");
  check(r.reasons.some((x) => /Monthly volume evidence is missing/.test(x)) && r.reasons.some((x) => /Chargeback rate evidence is missing/.test(x)), "reasons name each missing evidence item");
}
// Each absence individually.
for (const [k, label] of [["monthlyVolume", "volume"], ["effectiveRatePct", "rate"], ["chargebackRatePct", "chargeback"]] as const) {
  const r = await run({ ...good, [k]: null });
  check(r.decision === "review", `missing ${label} evidence alone requires review`);
}
// Invalid / nonfinite / negative values.
for (const bad of [NaN, Infinity, -5, "abc", "Infinity"] as any[]) {
  const r = await run({ ...good, monthlyVolume: bad });
  check(r.decision === "review" && r.reasons.some((x) => /invalid/.test(x)), `invalid volume ${String(bad)} requires review`);
}
{
  const r = await run({}, deal({ dealBlueprint: { chargebackRate: "not-a-number" }, totalVolume: "50000", effectiveRate: "2.5" }));
  check(r.decision === "review", "present-but-invalid blueprint chargeback value is not silently skipped");
}
// Deal-field evidence is honoured.
{
  const r = await run({}, deal({ totalVolume: "50000", effectiveRate: "2.5", dealBlueprint: { chargebackRate: "0.3" } }));
  check(r.decision === "approve", "documented deal-field evidence approves");
}
// Rules: unusable or contradictory rule values do not fall back to hard-coded thresholds.
for (const [name, over] of [
  ["unparseable min volume", { minMonthlyVolume: "n/a" }],
  ["missing ceiling", { effectiveRateCeiling: null }],
  ["min greater than max", { minMonthlyVolume: "900000" }],
  ["soft chargeback limit above hard limit", { chargebackRateLimit: "3" }],
] as const) {
  rules = { ...baseRules, ...over };
  const r = await run(good);
  check(r.decision === "review" && /rules are missing, invalid or contradictory/.test(r.reasons.join(" ")), `${name} routes to review, no invented threshold`);
}
rules = { ...baseRules };
// Blocked-processor list configured => processor evidence required.
{
  rules = { ...baseRules, blockedProcessors: ["badpay"] };
  check((await run(good)).decision === "review", "blocked-list configured but processor unknown requires review");
  check((await run({ ...good, processorName: "GoodPay" })).decision === "approve", "known allowed processor approves");
  check((await run({ ...good, processorName: "BadPay Inc" })).decision === "hold", "blocked processor still holds");
  rules = { ...baseRules };
}
// Threshold boundaries unchanged.
{
  check((await run({ ...good, monthlyVolume: 5000 })).decision === "approve", "volume exactly at minimum approves");
  check((await run({ ...good, monthlyVolume: 4999 })).decision === "review", "volume just below minimum is a soft review");
  check((await run({ ...good, monthlyVolume: 1000 })).decision === "hold", "volume far below minimum holds");
  check((await run({ ...good, effectiveRatePct: 3.5 })).decision === "approve", "rate exactly at ceiling approves");
  check((await run({ ...good, chargebackRatePct: 2.5 })).decision === "hold", "chargeback above hard limit holds");
  check((await run({ ...good, chargebackRatePct: 1.5 })).decision === "review", "chargeback above soft limit reviews");
}
// Disabled auto-approval.
{
  rules = { ...baseRules, autoApproveEnabled: false };
  check((await run(good)).decision === "review", "disabled auto-approval sends complete evidence to review");
}

console.log(`\nStage 5 underwriting evidence certification: ${checks} checks passed`);
await pool.end();
