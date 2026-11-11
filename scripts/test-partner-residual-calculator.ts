#!/usr/bin/env npx tsx
/**
 * test-partner-residual-calculator.ts
 *
 * Partner income estimator on /partners. Static and deterministic: no server, no database, no network, no provider I/O.
 *
 * What it proves
 *  - monthly income = merchants x average monthly volume x (bps / 10,000) x partner split, and annualized = monthly x 12,
 *    including the documented check case (20 x $100,000 x 100 bps x 50% = $10,000 a month, $120,000 a year, and $3,000
 *    a month at 15%);
 *  - the slider range is 25-150 bps and defaults to 100; the partner types are Sales Agent 50% and Referral Partner 15%;
 *  - a blank, negative, fractional-merchant, zero, non-numeric or oversized input is rejected instead of read as zero;
 *  - the explanation beside the slider and the disclosure are the approved wording, and the first render of the page
 *    component shows them with the check-case result;
 *  - the page uses the new component and no longer carries the previous fixed ~30 bps estimator.
 *
 * Every check family has a negative control.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PARTNER_RESIDUAL_BPS,
  PARTNER_RESIDUAL_COPY,
  PARTNER_RESIDUAL_LIMITS,
  PARTNER_RESIDUAL_TYPES,
  calculatePartnerResidual,
  clampPartnerResidualBps,
  formatPartnerResidualUsd,
  parsePartnerResidualField,
  partnerResidualSplitPercent,
} from "../shared/partner-residual-calculator";

// The client build compiles JSX with the automatic runtime; tsx here uses the classic factory, which needs React in scope.
(globalThis as { React?: typeof React }).React = React;
const { PartnerResidualCalculator } = await import("../client/src/components/public/PartnerResidualCalculator");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let checks = 0;

function ok(condition: boolean, name: string, detail = ""): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function negative(name: string, fn: () => void): void {
  checks++;
  try {
    fn();
  } catch {
    console.log(`  ok   negative control: ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL negative control did not fail: ${name}`);
}

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const APPROVED_BPS_EXPLANATION =
  "100 bps = 1% of processing volume, payable to Liberty after processor costs and the processor’s share, before your split.";
const APPROVED_DISCLOSURE =
  "Illustrative scenarios—not verified portfolio averages or guaranteed earnings. The default 100-bps assumption is a generous example. Actual residuals vary by merchant pricing, processing costs, activity, and agreement terms. Annualized income assumes the illustrated monthly level continues for 12 months.";

console.log("Partner residual calculator suite");

console.log("arithmetic");
{
  const base = { merchants: 20, avgMonthlyVolume: 100_000, bps: 100 };
  const agent = calculatePartnerResidual({ ...base, splitPercent: 50 });
  ok(agent.monthly === 10_000, "20 merchants x $100,000 x 100 bps x 50% = $10,000 a month", String(agent.monthly));
  ok(agent.annualized === 120_000, "annualized income is monthly x 12 = $120,000", String(agent.annualized));
  const referral = calculatePartnerResidual({ ...base, splitPercent: 15 });
  ok(referral.monthly === 3_000, "the same portfolio at 15% = $3,000 a month", String(referral.monthly));
  ok(referral.annualized === 36_000, "the 15% portfolio annualizes to $36,000", String(referral.annualized));
  ok(calculatePartnerResidual({ ...base, bps: 25, splitPercent: 50 }).monthly === 2_500, "25 bps lowers the result immediately");
  ok(calculatePartnerResidual({ ...base, bps: 150, splitPercent: 50 }).monthly === 15_000, "150 bps raises the result immediately");
  ok(calculatePartnerResidual({ merchants: 1, avgMonthlyVolume: 1_000, bps: 25, splitPercent: 15 }).monthly === 0.375, "small portfolios keep fractional dollars");
  // Cross-check against the documented formula written out literally, over a grid of inputs.
  let worst = 0;
  for (const merchants of [1, 3, 20, 250]) {
    for (const avgMonthlyVolume of [1_000, 12_345, 100_000, 2_500_000]) {
      for (const bps of [25, 37, 100, 149, 150]) {
        for (const splitPercent of [15, 50]) {
          const literal = merchants * avgMonthlyVolume * (bps / 10_000) * (splitPercent / 100);
          const got = calculatePartnerResidual({ merchants, avgMonthlyVolume, bps, splitPercent });
          worst = Math.max(worst, Math.abs(got.monthly - literal) / Math.max(1, literal));
          ensure(Math.abs(got.annualized - literal * 12) <= 1e-6 * Math.max(1, literal * 12), "annualized grid mismatch");
        }
      }
    }
  }
  ok(worst < 1e-9, "matches the literal formula across the input grid", String(worst));
  negative("a wrong split changes the check case", () => ensure(calculatePartnerResidual({ ...base, splitPercent: 40 }).monthly === 10_000, "split ignored"));
  negative("bps is not ignored", () => ensure(calculatePartnerResidual({ ...base, bps: 30, splitPercent: 50 }).monthly === 10_000, "bps ignored"));
}

console.log("controls and partner types");
{
  ok(PARTNER_RESIDUAL_BPS.min === 25 && PARTNER_RESIDUAL_BPS.max === 150, "slider runs 25-150 bps");
  ok(PARTNER_RESIDUAL_BPS.default === 100, "slider defaults to 100 bps");
  ok(clampPartnerResidualBps(10) === 25 && clampPartnerResidualBps(999) === 150 && clampPartnerResidualBps(70) === 70, "bps is kept inside the range");
  ok(clampPartnerResidualBps(Number.NaN) === 100, "a non-finite bps falls back to the default");
  ok(PARTNER_RESIDUAL_TYPES.map((t) => `${t.label}:${t.splitPercent}`).join("|") === "Sales Agent:50|Referral Partner:15", "partner types are Sales Agent 50% and Referral Partner 15%");
  ok(partnerResidualSplitPercent("sales_agent") === 50 && partnerResidualSplitPercent("referral_partner") === 15, "split lookup follows the partner type");
  negative("unknown partner type", () => partnerResidualSplitPercent("iso" as never));
  ok(formatPartnerResidualUsd(10_000) === "$10,000" && formatPartnerResidualUsd(120_000) === "$120,000", "whole dollars show without cents");
  ok(formatPartnerResidualUsd(0.375) === "$0.38" && formatPartnerResidualUsd(1234.5) === "$1,234.50", "fractional dollars show cents");
}

console.log("input validation");
{
  const merchants = (raw: string) => parsePartnerResidualField("merchants", raw);
  const volume = (raw: string) => parsePartnerResidualField("avgMonthlyVolume", raw);
  ok(merchants("20").kind === "ok" && volume("100000").kind === "ok", "typical input is accepted");
  ok(merchants("").kind === "blank" && volume("   ").kind === "blank", "blank is not entered, never zero");
  ok(merchants("-5").kind === "invalid" && volume("-1").kind === "invalid", "negative input is rejected");
  ok(merchants("2.5").kind === "invalid", "a fractional merchant count is rejected");
  ok(merchants("0").kind === "invalid" && volume("0").kind === "invalid", "zero is rejected");
  ok(merchants("1e3").kind === "invalid" && volume("abc").kind === "invalid" && volume("1,000").kind === "invalid", "non-plain numbers are rejected");
  ok(merchants(String(PARTNER_RESIDUAL_LIMITS.merchants.max + 1)).kind === "invalid", "an oversized merchant count is rejected");
  ok(volume(String(PARTNER_RESIDUAL_LIMITS.avgMonthlyVolume.max + 1)).kind === "invalid", "an oversized volume is rejected");
  ok(volume("12345.67").kind === "ok" && volume("12345.678").kind === "invalid", "volume accepts cents only");
  negative("a blank merchant count is not accepted as a number", () => ensure(merchants("").kind === "ok", "blank accepted"));
}

console.log("approved wording and first render");
{
  ok(PARTNER_RESIDUAL_COPY.bpsExplanation === APPROVED_BPS_EXPLANATION, "slider explanation is the approved wording");
  ok(PARTNER_RESIDUAL_COPY.disclosure === APPROVED_DISCLOSURE, "disclosure is the approved wording");
  ok(PARTNER_RESIDUAL_COPY.splitNote.includes("subject to approved compensation terms"), "split note keeps the approved-terms condition");

  const html = renderToStaticMarkup(React.createElement(PartnerResidualCalculator));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "’").replace(/\s+/g, " ");
  const decoded = text.replace(/&amp;/g, "&");
  ok(decoded.includes(APPROVED_BPS_EXPLANATION), "the explanation is rendered beside the slider");
  ok(decoded.includes(APPROVED_DISCLOSURE), "the disclosure is rendered on first render, not behind an interaction");
  ok(/data-testid="text-calc-monthly"[^>]*>\$10,000</.test(html), "first render shows $10,000 a month for the check case");
  ok(/data-testid="text-calc-annual"[^>]*>\$120,000</.test(html), "first render shows $120,000 annualized for the check case");
  ok(/data-testid="text-calc-bps"[^>]*>\s*100/.test(html), "first render shows the 100 bps default");
  // The slider's own value attribute is set after mount (Radix measures the thumb first), so the first render is checked
  // by its name, its bounds and the filled share of the track (150 - 100 of a 25-150 range leaves 40% unfilled).
  ok(
    html.includes('role="slider"') && html.includes('aria-valuemin="25"') && html.includes('aria-valuemax="150"') && html.includes("right:40%"),
    "the slider is named, spans 25-150 and sits at 100",
  );
  ok(html.includes("Sales Agent") && html.includes("Referral Partner"), "both partner types are offered");
  ok(html.includes("Number of active merchants") && html.includes("Average monthly card volume per merchant"), "both portfolio inputs are labelled");
  negative("a missing disclosure would be caught", () => ensure(decoded.replace(APPROVED_DISCLOSURE, "").includes(APPROVED_DISCLOSURE), "disclosure present"));
}

console.log("page wiring");
{
  const page = fs.readFileSync(path.join(root, "client/src/pages/ISOPartnerProgram.tsx"), "utf8");
  const component = fs.readFileSync(path.join(root, "client/src/components/public/PartnerResidualCalculator.tsx"), "utf8");
  ok(/<PartnerResidualCalculator\s*\/>/.test(page), "/partners renders the new calculator");
  ok(page.includes('id="calculator"'), "the #calculator anchor the hero links to is kept");
  ok(!/function ResidualCalculator\(/.test(page) && !/estimatedMonthlyNetBps/.test(page), "the previous fixed ~30 bps estimator is gone");
  ok(!/Estimates based on ~30 bps/.test(page), "the previous ~30 bps footnote is gone");
  ok(component.includes("PARTNER_RESIDUAL_COPY.disclosure") && !/\{\s*result\s*&&[^}]*PARTNER_RESIDUAL_COPY\.disclosure/.test(component), "the disclosure is not conditional on a result");
  negative("old estimator would be flagged", () => ensure(!/estimatedMonthlyNetBps/.test("const estimatedMonthlyNetBps = 0.0030;"), "old estimator present"));

  // The rest of the page must tell the same compensation story as the calculator.
  const STALE_CLAIMS: [string, RegExp][] = [
    ["30–50% share claim", /30[–-]50%/],
    ["$200–$500 flat bonus claim", /\$200[–-]\$500|flat bonus/i],
    ["fixed ~30 bps / 40% example", /~30 bps|40% partner split|~\$720|\$8,640/],
    ["30% lifetime / monthly residual claim", /30% (lifetime|monthly)/],
  ];
  for (const [label, pattern] of STALE_CLAIMS) {
    ok(!pattern.test(page), `the page no longer carries the ${label}`);
  }
  ok(
    page.includes("calculatePartnerResidual(") && page.includes("partnerResidualSplitPercent(") && page.includes("PARTNER_RESIDUAL_BPS.default"),
    "the worked example is computed with the calculator's own arithmetic, split and default bps",
  );
  const exampleAgent = calculatePartnerResidual({ merchants: 20, avgMonthlyVolume: 100_000, bps: PARTNER_RESIDUAL_BPS.default, splitPercent: partnerResidualSplitPercent("sales_agent") });
  const exampleReferral = calculatePartnerResidual({ merchants: 20, avgMonthlyVolume: 100_000, bps: PARTNER_RESIDUAL_BPS.default, splitPercent: partnerResidualSplitPercent("referral_partner") });
  ok(
    formatPartnerResidualUsd(exampleAgent.monthly) === "$10,000" && formatPartnerResidualUsd(exampleAgent.annualized) === "$120,000" &&
      formatPartnerResidualUsd(exampleReferral.monthly) === "$3,000" && formatPartnerResidualUsd(exampleReferral.annualized) === "$36,000",
    "the worked example reads $10,000 / $120,000 at 50% and $3,000 / $36,000 at 15%",
  );
  const approvedTerms = (page.match(/subject to approved (compensation )?terms/g) ?? []).length;
  ok(approvedTerms >= 5, "every compensation statement carries the approved-terms condition", String(approvedTerms));
  ok(page.includes("Sales Agents are shown at 50% and Referral Partners at 15%"), "the page copy names the 50% and 15% splits");
  ok(page.includes("${SALES_AGENT_SPLIT}% for Sales Agents") && page.includes("${REFERRAL_SPLIT}% for Referral Partners"), "the tier cards take their splits from the calculator's partner types");
  negative("a stale 30–50% claim would be caught", () => ensure(!/30[–-]50%/.test("Earn 30–50% residual income"), "stale claim present"));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
