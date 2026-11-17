#!/usr/bin/env npx tsx
/**
 * test-partner-residual-calculator.ts
 *
 * Partner compensation illustration on /partners and the profession pages. Static and deterministic: no server, no
 * database, no network, no provider I/O.
 *
 * What it proves
 *  - monthly = merchants x average monthly volume x (bps / 10,000) x share, annualized = monthly x 12, including the
 *    documented check case (20 x $100,000 x 100 bps x 50% = $10,000 a month, $120,000 a year);
 *  - the slider range is 25-150 bps and defaults to 100;
 *  - the only share the module itself knows is the qualified sales-agent 50%; the referral share exists only inside a
 *    published-policy projection handed in by the caller. With no approved projection the referral path returns the
 *    written-agreement message and NO amount (never zero, never a hidden number);
 *  - a malformed, revoked, out-of-range or non-integer projection collapses to the safe default;
 *  - blank, negative, fractional, zero, non-numeric and oversized inputs are rejected rather than read as zero;
 *  - first render of the component shows the gated referral message without a dollar figure, the agent check case,
 *    the disclosure and the formula, and an approved projection (a private fixture rate that lives only in this file)
 *    produces an amount;
 *  - no proposed rate (25, 30) and no old fixed estimator appears in client-reachable code.
 *
 * Every check family has a negative control.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

import {
  PARTNER_AGENT_SHARE_PERCENT,
  PARTNER_RESIDUAL_BPS,
  PARTNER_RESIDUAL_COPY,
  PARTNER_RESIDUAL_LIMITS,
  calculatePartnerResidual,
  clampPartnerResidualBps,
  formatPartnerResidualUsd,
  illustratePartnerResidual,
  illustrationShareForPath,
  parsePartnerResidualField,
  validatePartnerResidualBps,
} from "../shared/partner-residual-calculator";
import { DEFAULT_REFERRAL_POLICY, REFERRAL_RESULT_GATED_MESSAGE, parseReferralPolicy } from "../shared/partner-public-content";

// The client build compiles JSX with the automatic runtime; tsx here uses the classic factory, which needs React in scope.
(globalThis as { React?: typeof React }).React = React;
const { PartnerResidualCalculator } = await import("../client/src/components/public/PartnerResidualCalculator");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let checks = 0;

function ok(condition: boolean, name: string, detail = ""): void {
  checks++;
  if (condition) console.log(`  ok   ${name}`);
  else {
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

// Private fixture rate used only to exercise the approved-projection branch. It is not a recommendation or a term.
const FIXTURE_APPROVED_SHARE = 17;
const fixturePolicy = parseReferralPolicy({ state: "approved", version: 3, sharePercent: FIXTURE_APPROVED_SHARE });

/** wouter reads window.location in a browser; the server render needs an explicit path. */
const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(Router as React.ComponentType<Record<string, unknown>>, { ssrPath: "/partners" }, React.createElement(PartnerResidualCalculator, props)));

const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "’").replace(/&amp;/g, "&").replace(/\s+/g, " ");

console.log("Partner residual calculator suite");

console.log("arithmetic");
{
  const base = { merchants: 20, avgMonthlyVolume: 100_000, bps: 100 };
  const agent = calculatePartnerResidual({ ...base, sharePercent: 50 });
  ok(agent.monthly === 10_000, "20 merchants x $100,000 x 100 bps x 50% = $10,000 a month", String(agent.monthly));
  ok(agent.annualized === 120_000, "annualized is monthly x 12 = $120,000", String(agent.annualized));
  ok(calculatePartnerResidual({ ...base, bps: 25, sharePercent: 50 }).monthly === 2_500, "25 bps lowers the result");
  ok(calculatePartnerResidual({ ...base, bps: 150, sharePercent: 50 }).monthly === 15_000, "150 bps raises the result");
  ok(calculatePartnerResidual({ merchants: 1, avgMonthlyVolume: 1_000, bps: 25, sharePercent: 50 }).monthly === 1.25, "small portfolios keep fractional dollars");
  let worst = 0;
  for (const merchants of [1, 3, 20, 250]) {
    for (const avgMonthlyVolume of [1_000, 12_345, 100_000, 2_500_000]) {
      for (const bps of [25, 37, 100, 149, 150]) {
        for (const sharePercent of [1, 17, 50, 100]) {
          const literal = merchants * avgMonthlyVolume * (bps / 10_000) * (sharePercent / 100);
          const got = calculatePartnerResidual({ merchants, avgMonthlyVolume, bps, sharePercent });
          worst = Math.max(worst, Math.abs(got.monthly - literal) / Math.max(1, literal));
          ensure(Math.abs(got.annualized - literal * 12) <= 1e-6 * Math.max(1, literal * 12), "annualized grid mismatch");
        }
      }
    }
  }
  ok(worst < 1e-9, "matches the literal formula across the input grid", String(worst));
  negative("a wrong share changes the check case", () => ensure(calculatePartnerResidual({ ...base, sharePercent: 40 }).monthly === 10_000, "share ignored"));
  negative("bps is not ignored", () => ensure(calculatePartnerResidual({ ...base, bps: 30, sharePercent: 50 }).monthly === 10_000, "bps ignored"));
}

console.log("controls");
{
  ok(PARTNER_RESIDUAL_BPS.min === 25 && PARTNER_RESIDUAL_BPS.max === 150 && PARTNER_RESIDUAL_BPS.default === 100, "slider runs 25-150 bps and defaults to 100");
  ok(clampPartnerResidualBps(10) === 25 && clampPartnerResidualBps(999) === 150 && clampPartnerResidualBps(70) === 70, "bps is kept inside the range");
  ok(clampPartnerResidualBps(Number.NaN) === 100, "a non-finite bps falls back to the default");
  ok(validatePartnerResidualBps(100).ok && !validatePartnerResidualBps(24).ok && !validatePartnerResidualBps(151).ok && !validatePartnerResidualBps(100.5).ok && !validatePartnerResidualBps(Number.NaN).ok, "typed bps is validated");
  ok(formatPartnerResidualUsd(10_000) === "$10,000" && formatPartnerResidualUsd(120_000) === "$120,000", "whole dollars show without cents");
  ok(formatPartnerResidualUsd(0.375) === "$0.38" && formatPartnerResidualUsd(1234.5) === "$1,234.50", "fractional dollars show cents");
  negative("an out-of-range bps is not accepted", () => ensure(validatePartnerResidualBps(500).ok, "accepted"));
}

console.log("input validation");
{
  const merchants = (raw: string) => parsePartnerResidualField("merchants", raw);
  const volume = (raw: string) => parsePartnerResidualField("avgMonthlyVolume", raw);
  ok(merchants("20").kind === "ok" && volume("100000").kind === "ok", "typical input is accepted");
  ok(merchants("").kind === "blank" && volume("   ").kind === "blank", "blank is not entered, never zero");
  ok(merchants("-5").kind === "invalid" && volume("-1").kind === "invalid", "negative input is rejected");
  ok(merchants("2.5").kind === "invalid", "a fractional merchant count is rejected");
  ok(merchants("1e3").kind === "invalid" && volume("abc").kind === "invalid" && volume("1,000").kind === "invalid", "non-plain numbers are rejected");
  ok(merchants(String(PARTNER_RESIDUAL_LIMITS.merchants.max + 1)).kind === "invalid", "an oversized merchant count is rejected");
  ok(volume(String(PARTNER_RESIDUAL_LIMITS.avgMonthlyVolume.max + 1)).kind === "invalid", "an oversized volume is rejected");
  ok(volume("12345.67").kind === "ok" && volume("12345.678").kind === "invalid", "volume accepts cents only");
  negative("a blank merchant count is not accepted as a number", () => ensure(merchants("").kind === "ok", "blank accepted"));
}

console.log("published-policy gating");
{
  ok(PARTNER_AGENT_SHARE_PERCENT === 50, "the qualified sales-agent share is 50%");
  ok(illustrationShareForPath("sales_agent") === 50, "the agent path always has its qualified share");
  ok(illustrationShareForPath("referral") === null, "the referral path has no share without a published policy");
  ok(illustrationShareForPath("referral", DEFAULT_REFERRAL_POLICY) === null, "the written-agreement default has no share");
  ok(illustrationShareForPath("referral", fixturePolicy) === FIXTURE_APPROVED_SHARE, "an approved projection supplies the share");

  const ok20 = { kind: "ok", value: 20 } as const;
  const okVol = { kind: "ok", value: 100_000 } as const;
  const gated = illustratePartnerResidual({ path: "referral", merchants: ok20, avgMonthlyVolume: okVol, bps: 100 });
  ok(gated.kind === "gated" && gated.message === REFERRAL_RESULT_GATED_MESSAGE, "referral without a projection is the written-agreement message, not an amount");
  ok(!("monthly" in gated) && !("annualized" in gated), "the gated result carries no number at all");
  const gatedBlank = illustratePartnerResidual({ path: "referral", merchants: { kind: "blank" }, avgMonthlyVolume: okVol, bps: 100 });
  ok(gatedBlank.kind === "gated", "an incomplete referral input is still gated, never a fabricated value");
  const agent = illustratePartnerResidual({ path: "sales_agent", merchants: ok20, avgMonthlyVolume: okVol, bps: 100 });
  ok(agent.kind === "amount" && agent.monthly === 10_000 && agent.annualized === 120_000 && agent.sharePercent === 50, "the agent path shows the check case");
  const approved = illustratePartnerResidual({ path: "referral", merchants: ok20, avgMonthlyVolume: okVol, bps: 100, policy: fixturePolicy });
  ok(approved.kind === "amount" && Math.abs(approved.monthly - 3_400) < 1e-9, "an approved projection yields the arithmetic result");
  ok(illustratePartnerResidual({ path: "sales_agent", merchants: { kind: "blank" }, avgMonthlyVolume: okVol, bps: 100 }).kind === "incomplete", "a blank agent input is incomplete, not zero");
  ok(illustratePartnerResidual({ path: "sales_agent", merchants: ok20, avgMonthlyVolume: okVol, bps: 5 }).kind === "incomplete", "an invalid bps is incomplete");
  negative("the referral path never silently uses the agent share", () => ensure(gated.kind === "amount", "gated result was an amount"));

  const collapsed = [
    null, undefined, "approved", 17, [], {}, { state: "written_agreement" }, { state: "revoked", sharePercent: 20, version: 1 },
    { state: "approved" }, { state: "approved", sharePercent: 0, version: 1 }, { state: "approved", sharePercent: 101, version: 1 },
    { state: "approved", sharePercent: 12.5, version: 1 }, { state: "approved", sharePercent: "20", version: 1 }, { state: "approved", sharePercent: 20, version: 0 },
    { state: "approved", sharePercent: 20, version: 1.5 }, { state: "approved", sharePercent: Number.NaN, version: 1 },
  ];
  ok(collapsed.every((value) => parseReferralPolicy(value).state === "written_agreement"), "every malformed or revoked projection collapses to the safe default");
  ok(parseReferralPolicy({ state: "approved", sharePercent: 20, version: 2 }).state === "approved", "a well-formed projection is accepted");
  negative("a malformed projection is not treated as approved", () => ensure(parseReferralPolicy({ state: "approved", sharePercent: 0, version: 1 }).state === "approved", "treated as approved"));
}

console.log("approved wording and first render");
{
  const defaultHtml = render();
  const defaultText = textOf(defaultHtml);
  ok(defaultHtml.includes('data-testid="text-calc-gated"') && defaultText.includes(REFERRAL_RESULT_GATED_MESSAGE), "first render (referral, no policy) shows the written-agreement message");
  ok(!/data-testid="text-calc-monthly"/.test(defaultHtml) && !/data-testid="text-calc-annual"/.test(defaultHtml), "first render shows no monthly or annual figure for referral without a policy");
  ok(!/\$\d/.test(defaultText), "no dollar figure appears anywhere in the gated first render");
  ok(defaultText.includes(PARTNER_RESIDUAL_COPY.disclosure), "the disclosure is rendered on first render, not behind an interaction");
  ok(defaultText.includes(PARTNER_RESIDUAL_COPY.formula), "the formula is rendered");
  ok(defaultText.includes(PARTNER_RESIDUAL_COPY.yieldLabel) && defaultText.includes(PARTNER_RESIDUAL_COPY.yieldHelper), "the residual-yield label and helper are rendered");
  ok(/data-testid="text-calc-bps"[^>]*>\s*100/.test(defaultHtml), "first render shows the 100 bps default");
  ok(
    defaultHtml.includes('role="slider"') && defaultHtml.includes('aria-valuemin="25"') && defaultHtml.includes('aria-valuemax="150"') && defaultHtml.includes("right:40%"),
    "the slider is named, spans 25-150 and sits at 100",
  );
  ok(defaultText.includes("Number of active merchants") && defaultText.includes("Average monthly card volume per merchant"), "both portfolio inputs are labelled");
  ok(defaultText.includes("Referral partner") && defaultText.includes("Sales agent"), "both paths are offered");

  const agentHtml = render({ initialPath: "sales_agent" });
  ok(/data-testid="text-calc-monthly"[^>]*>\$10,000</.test(agentHtml), "agent first render shows $10,000 a month for the check case");
  ok(/data-testid="text-calc-annual"[^>]*>\$120,000</.test(agentHtml), "agent first render shows $120,000 annualized for the check case");
  ok(textOf(agentHtml).includes(PARTNER_RESIDUAL_COPY.agentQualification), "the agent qualification sits beside the result");

  const approvedHtml = render({ policy: fixturePolicy });
  ok(/data-testid="text-calc-monthly"[^>]*>\$3,400</.test(approvedHtml), "an approved projection produces the arithmetic amount on the referral path");
  ok(!approvedHtml.includes('data-testid="text-calc-gated"'), "an approved projection removes the gated message");
  negative("a missing disclosure would be caught", () => ensure(textOf(defaultHtml).replace(PARTNER_RESIDUAL_COPY.disclosure, "").includes(PARTNER_RESIDUAL_COPY.disclosure), "disclosure present"));
  negative("a gated render containing an amount would be caught", () => ensure(!/data-testid="text-calc-monthly"/.test(approvedHtml), "amount present"));
}

console.log("page wiring and unapproved-rate scan");
{
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const hub = read("client/src/pages/ISOPartnerProgram.tsx");
  const profession = read("client/src/components/public/PartnerProfessionPage.tsx");
  const component = read("client/src/components/public/PartnerResidualCalculator.tsx");
  ok(/<PartnerResidualCalculator\s+policy=\{policy\}/.test(hub) && hub.includes('id="calculator"'), "/partners renders the calculator with the published policy and keeps #calculator");
  ok(/<PartnerResidualCalculator\s+policy=\{policy\}/.test(profession), "profession pages render the calculator with the published policy");
  ok(component.includes("PARTNER_RESIDUAL_COPY.disclosure") && !/\{\s*illustration[^}]*&&[^}]*PARTNER_RESIDUAL_COPY\.disclosure/.test(component), "the disclosure is not conditional on a result");

  const OLD_ESTIMATOR = /estimatedMonthlyNetBps|~30 bps|40% partner split|~\$720|\$8,640|splitPercent|PARTNER_RESIDUAL_TYPES|partnerResidualSplitPercent/;
  const STALE_CLAIMS: [string, RegExp][] = [
    ["30–50% share claim", /30[–-]50%/],
    ["$200–$500 flat bonus claim", /\$200[–-]\$500|flat bonus/i],
    ["30% lifetime / monthly residual claim", /30% (lifetime|monthly)/],
    ["unconditional lifetime promise", /lifetime residuals?|residuals? for life|paid for life/i],
  ];
  const clientReachable = [
    "shared/partner-residual-calculator.ts", "shared/partner-public-content.ts", "shared/partner-profession-content.ts", "shared/public-affiliate.ts",
    "client/src/pages/ISOPartnerProgram.tsx", "client/src/pages/AffiliateProgram.tsx", "client/src/components/public/PartnerProfessionPage.tsx",
    "client/src/components/public/PartnerResidualCalculator.tsx", "client/src/components/public/PartnerPageSections.tsx",
    "client/src/components/public/PartnerJourneyPage.tsx", "client/src/components/public/PartnerApplicationForm.tsx",
  ];
  for (const file of clientReachable) {
    const source = read(file);
    ok(!OLD_ESTIMATOR.test(source), `${file}: no old fixed estimator`);
    for (const [label, pattern] of STALE_CLAIMS) ok(!pattern.test(source), `${file}: no ${label}`);
    // A referral share of 25 or 30 (the owner's proposals) must not appear as a percentage literal next to referral wording.
    ok(!/referral[^\n]{0,80}\b(25|30)\s*%|\b(25|30)\s*%[^\n]{0,80}referral/i.test(source), `${file}: no proposed referral percentage`);
  }
  negative("an old estimator would be flagged", () => ensure(!OLD_ESTIMATOR.test("const estimatedMonthlyNetBps = 0.0030;"), "old estimator present"));
  negative("a stale 30–50% claim would be caught", () => ensure(!/30[–-]50%/.test("Earn 30–50% residual income"), "stale claim present"));
  negative("a proposed referral percentage would be caught", () => ensure(!/referral[^\n]{0,80}\b(25|30)\s*%/i.test("Referral partners earn 25% of residuals"), "rate present"));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
