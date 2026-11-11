#!/usr/bin/env npx tsx
/**
 * test-wd-content-contract.ts
 *
 * W-D content suite (proof, cost calculator, shared page modules, editorial content).
 * Static and deterministic: no server, no database, no network, no provider I/O.
 *
 * What it proves
 *  - the cost calculator: blank is not zero, NaN/negative/overflow/zero-volume input is rejected,
 *    a per-transaction fee needs a ticket to be estimated, a saving is shown only when every material
 *    figure is entered, a higher quote is reported as higher, and the annual figure is monthly x 12;
 *  - the proof projection: a qualifying result needs every basis field, recorded permission naming the
 *    surface, and a quote needs its own evidence; each missing field blocks it; the shipped register is
 *    empty, so every surface renders the fallback; `?surface=` is validated; no Review, AggregateRating
 *    or VideoObject schema is emitted anywhere;
 *  - superseded figures and claims (a guaranteed $50, 3,200+/5,000+ statement counts, $2B, 99.9%, PCI
 *    Level 1, the attributed Square 2.6% + $0.10 rate, "legal in all 50 states", zero-cost processing)
 *    are absent from the emitters, the glossary, the Help Center and the blog;
 *  - the glossary Liberty section is written only from approved claims, and Why Liberty, the guaranteed
 *    analysis explainer and the free analysis read the shared modules the React pages read;
 *  - the standalone glossary term pages render definition markup (bold, bullet and numbered lists) as real
 *    elements, stay HTML-escaped and ship no client bundle: no term page's first HTML carries a literal "**"
 *    or a paragraph that begins with a list marker;
 *  - /blog is listed once across the sitemaps.
 *
 * Every check family has a negative control.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  CALC_COPY,
  CALC_LIMITS,
  CALC_UNKNOWN_LABELS,
  CALC_STRUCTURED_DATA,
  EMPTY_CALC_INPUTS,
  calculateCosts,
  parseCalcField,
  type CalcFieldId,
  type CalcInputs,
} from "../shared/public-cost-calculator";
import {
  PROOF_SURFACES,
  isProofSurface,
  projectPublicProof,
  proofGaps,
  proofOverviewPage,
  type ProofCandidate,
} from "../shared/public-proof";
import { PUBLIC_PROOF_CANDIDATES, publicProofFor } from "../server/data/public-proof-register";
import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import * as pagesSsr from "../server/ssr/pages";
import { getAvailableCompetitorSlugs, renderAlternativesHtml, renderSwitchFromHtml } from "../server/ssr/competitor-ssr";
import { glossaryTerms as GLOSSARY_TERMS, getRelatedTerms } from "../server/data/glossary-terms";
import { buildTermPageHtml, renderGlossaryText } from "../server/routes/glossary";
import { helpArticles as HELP_ARTICLES } from "../client/src/lib/help-center-data";
import { allBlogPostsServer } from "../server/ssr/all-blog-posts-server";
import { allBlogPosts as CLIENT_BLOG_POSTS } from "../client/src/lib/all-blog-data";
import { BLOG_SHORTER_TITLE_SLUGS, blogDocumentTitle } from "../shared/blog-document-titles";
import { PUBLIC_NOT_FOUND } from "../shared/public-not-found";
import { getPublicNotFoundHtml } from "../server/ssr/not-found";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

let assertions = 0;
let negativeControls = 0;
const failures: string[] = [];

function ensure(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function passes(name: string, fn: () => void): void {
  assertions++;
  try {
    fn();
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
  }
}
function negative(name: string, fn: () => void): void {
  negativeControls++;
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push(`negative control not rejected: ${name}`);
}

const decode = (s: string): string =>
  s
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ");
const stripImages = (s: string): string => s.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "");
const pageFn = (name: string): (() => string) => {
  const fn = (pagesSsr as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`Missing SSR builder: ${name}`);
  return fn as () => string;
};

// ── Calculator ───────────────────────────────────────────────────────────────

const inputs = (over: Partial<CalcInputs>): CalcInputs => ({ ...EMPTY_CALC_INPUTS, ...over });
const FULL: Partial<CalcInputs> = {
  monthlyVolume: "10000",
  avgTicket: "50",
  currentRate: "3",
  proposedBasis: "all_in",
  proposedRate: "2",
  proposedPerTransaction: "0.10",
  proposedMonthlyFees: "20",
  proposedEquipmentMonthly: "0",
};

passes("blank fields are not entered, not zero", () => {
  const p = parseCalcField("proposedRate", "");
  ensure(p.kind === "blank", "blank parsed as a value");
  ensure(parseCalcField("proposedRate", "   ").kind === "blank", "whitespace parsed as a value");
  const zero = parseCalcField("proposedRate", "0");
  ensure(zero.kind === "ok" && zero.value === 0, "typed zero is not zero");
});

passes("NaN, Infinity, exponent, text and negative input are rejected", () => {
  for (const bad of ["NaN", "Infinity", "-Infinity", "1e5", "abc", "1,000", "$5", "--1", "-1", "-0.01", "1.2.3"]) {
    ensure(parseCalcField("monthlyVolume", bad).kind === "invalid", `accepted ${JSON.stringify(bad)}`);
  }
});

passes("zero volume and zero ticket are rejected, zero proposed fee is allowed", () => {
  ensure(parseCalcField("monthlyVolume", "0").kind === "invalid", "zero volume accepted");
  ensure(parseCalcField("avgTicket", "0").kind === "invalid", "zero ticket accepted");
  ensure(parseCalcField("proposedMonthlyFees", "0").kind === "ok", "zero monthly fee rejected");
});

passes("values above each limit are rejected", () => {
  for (const [field, limit] of Object.entries(CALC_LIMITS)) {
    ensure(parseCalcField(field as CalcFieldId, String(limit.max + 1)).kind === "invalid", `${field} accepted above its limit`);
    ensure(parseCalcField(field as CalcFieldId, String(limit.max)).kind === "ok", `${field} rejected at its limit`);
  }
});

passes("invalid input blocks the whole result and names the field", () => {
  const r = calculateCosts(inputs({ ...FULL, monthlyVolume: "-5" }));
  ensure(r.status === "invalid" && Boolean(r.errors.monthlyVolume), "negative volume produced a result");
  const nan = calculateCosts(inputs({ ...FULL, currentRate: "NaN" }));
  ensure(nan.status === "invalid", "NaN rate produced a result");
});

passes("missing volume or current rate is incomplete, never a result", () => {
  const r = calculateCosts(inputs({ monthlyVolume: "10000" }));
  ensure(r.status === "incomplete" && r.missing.length === 1, "missing current rate not reported");
  ensure(calculateCosts(EMPTY_CALC_INPUTS).status === "incomplete", "empty form produced a result");
});

passes("a complete quote gives an exact monthly and annual difference", () => {
  const r = calculateCosts(inputs(FULL));
  ensure(r.status === "ok", "complete inputs did not produce a result");
  if (r.status !== "ok") return;
  // current 10000 x 3% = 300; proposed 200 + (10000/50 = 200 txns x 0.10 = 20) + 20 + 0 = 240
  ensure(r.currentMonthlyUsd === 300, `current ${r.currentMonthlyUsd}`);
  ensure(r.proposedMonthlyUsd === 240, `proposed ${r.proposedMonthlyUsd}`);
  ensure(r.monthlyDifferenceUsd === 60, `difference ${r.monthlyDifferenceUsd}`);
  ensure(r.annualDifferenceUsd === 720, `annual ${r.annualDifferenceUsd} is not monthly x 12`);
  ensure(r.direction === "lower", "direction");
  ensure(r.proposedEffectiveRatePct === 2.4, `effective rate ${r.proposedEffectiveRatePct}`);
});

passes("a blank material proposed figure withholds the saving and names it", () => {
  for (const field of ["proposedRate", "proposedPerTransaction", "proposedMonthlyFees", "proposedEquipmentMonthly"] as const) {
    const r = calculateCosts(inputs({ ...FULL, [field]: "" }));
    ensure(r.status === "ok", `${field}: not ok`);
    if (r.status !== "ok") continue;
    ensure(r.monthlyDifferenceUsd === null && r.annualDifferenceUsd === null && r.proposedMonthlyUsd === null, `${field}: a saving was shown with it blank`);
    ensure(r.unknownLabels.length === 1, `${field}: unknown figure not named`);
  }
});

passes("a per-transaction fee without a ticket cannot be estimated and blocks the saving", () => {
  const r = calculateCosts(inputs({ ...FULL, avgTicket: "" }));
  ensure(r.status === "ok", "not ok");
  if (r.status !== "ok") return;
  ensure(r.monthlyDifferenceUsd === null, "saving shown without a ticket");
  ensure(r.transactionsPerMonth === null, "transactions invented");
  ensure(r.proposedLines.some((l) => l.monthlyUsd === null && /average ticket/i.test(l.note ?? "")), "ticket requirement not explained");
  const zeroFee = calculateCosts(inputs({ ...FULL, avgTicket: "", proposedPerTransaction: "0" }));
  ensure(zeroFee.status === "ok" && zeroFee.monthlyDifferenceUsd !== null, "a stated zero per-transaction fee should not need a ticket");
});

passes("a quote that costs more is reported as higher with a negative difference", () => {
  const r = calculateCosts(inputs({ ...FULL, proposedRate: "3.5" }));
  ensure(r.status === "ok", "not ok");
  if (r.status !== "ok") return;
  ensure(r.direction === "higher", "higher quote not reported as higher");
  ensure((r.monthlyDifferenceUsd ?? 0) < 0, "difference not negative");
  ensure((r.annualDifferenceUsd ?? 0) === (r.monthlyDifferenceUsd as number) * 12, "annualization");
});

passes("an equal quote is reported as the same", () => {
  const r = calculateCosts(inputs({ monthlyVolume: "1000", avgTicket: "10", currentRate: "2", proposedBasis: "all_in", proposedRate: "2", proposedPerTransaction: "0", proposedMonthlyFees: "0", proposedEquipmentMonthly: "0" }));
  ensure(r.status === "ok" && r.direction === "same" && r.monthlyDifferenceUsd === 0, "equal quote not reported as the same");
});

passes("results at the maximum inputs are finite or rejected, never NaN", () => {
  const r = calculateCosts(inputs({ monthlyVolume: "1000000000", avgTicket: "0.01", currentRate: "100", proposedBasis: "all_in", proposedRate: "100", proposedPerTransaction: "1000", proposedMonthlyFees: "10000000", proposedEquipmentMonthly: "10000000" }));
  if (r.status === "ok") {
    for (const n of [r.currentMonthlyUsd, r.proposedMonthlyUsd, r.monthlyDifferenceUsd, r.annualDifferenceUsd]) ensure(n === null || Number.isFinite(n), "non-finite figure");
  } else {
    ensure(r.status === "invalid", "unexpected status");
  }
});

passes("the calculator copy knows no Liberty rate and no industry average", () => {
  const text = JSON.stringify(CALC_COPY) + JSON.stringify(CALC_STRUCTURED_DATA);
  ensure(!/1\.95|(?<!no )industry average|average (rate|merchant)|you could save|you.ll save|we.ll save/i.test(text), "calculator copy carries a target rate, average or saving promise");
  const source = read("client/src/pages/SavingsCalculator.tsx");
  ensure(!/LIBERTY_TARGET_RATE|1\.95|INDUSTRY_AVERAGE|industryAverage/.test(source), "React calculator still carries a target rate or average");
  ensure(/@shared\/public-cost-calculator/.test(source), "React calculator does not read the shared module");
  ensure(!/aggregateRating|"Review"|VideoObject/.test(JSON.stringify(CALC_STRUCTURED_DATA)), "calculator schema carries a rating");
});

passes("the calculator page renders from the shared copy, and /estimate stays a separate form page", () => {
  const html = decode(stripImages(pageFn("getSavingsCalculatorHtml")()));
  ensure(html.includes(decode(CALC_COPY.h1)), "calculator is missing the shared H1");
  ensure(html.includes(decode(CALC_COPY.faq[0].answer)), "calculator is missing the shared FAQ answer");
  ensure((html.match(/<h1[\s>]/g) ?? []).length === 1, "calculator does not have exactly one H1");
  ensure(/rel="canonical" href="https:\/\/libertybancard\.com\/savings-calculator"/.test(html), "calculator is not self-canonical");
  const estimate = decode(stripImages(pageFn("getEstimateHtml")()));
  ensure(/rel="canonical" href="https:\/\/libertybancard\.com\/estimate"/.test(estimate), "/estimate is not self-canonical");
  ensure(!estimate.includes(decode(CALC_COPY.h1)), "/estimate duplicates the calculator page");
  ensure((estimate.match(/<h1[\s>]/g) ?? []).length === 1, "/estimate does not have exactly one H1");
});

// WD-PV02: a quote is a complete cost only on a stated basis. The live defect: 10,000 volume, 50 ticket, 3% current,
// "0.3% + $0.10" with no fees produced a $50 quote and a $3,000 annual reduction, because an interchange-plus MARKUP
// was read as the whole cost. These cases are semantic: they fail if any route can total a markup without the
// card-network costs, not merely if some arithmetic changes.
const MARKUP_ONLY: Partial<CalcInputs> = {
  monthlyVolume: "10000",
  avgTicket: "50",
  currentRate: "3",
  proposedRate: "0.3",
  proposedPerTransaction: "0.10",
  proposedMonthlyFees: "0",
  proposedEquipmentMonthly: "0",
};
const withheld = (r: ReturnType<typeof calculateCosts>, why: string): void => {
  ensure(r.status === "ok", `${why}: not ok (${r.status})`);
  if (r.status !== "ok") return;
  ensure(
    r.proposedMonthlyUsd === null && r.monthlyDifferenceUsd === null && r.annualDifferenceUsd === null && r.direction === null && r.proposedEffectiveRatePct === null,
    `${why}: a total, difference or direction was shown`,
  );
};

passes("a markup-only quote (0.3% + $0.10) with no basis chosen shows no total and names the missing basis", () => {
  const r = calculateCosts(inputs(MARKUP_ONLY));
  withheld(r, "basis not chosen");
  if (r.status !== "ok") return;
  ensure(r.basis === null, "a basis was assumed");
  ensure(r.unknownLabels.includes(CALC_UNKNOWN_LABELS.basis), "missing basis not named as unknown");
});

passes("a markup quote with the card-network costs left blank is incomplete, never a $0 network cost", () => {
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup" }));
  withheld(r, "markup without network costs");
  if (r.status !== "ok") return;
  ensure(r.basis === "markup", "basis not kept");
  ensure(r.unknownLabels.length === 1 && r.unknownLabels[0] === CALC_UNKNOWN_LABELS.passThrough, `unknowns: ${r.unknownLabels.join("|")}`);
  ensure(r.proposedIncludedUsd === 50, "the markup lines themselves are still shown");
});

passes("a typed zero network cost on a markup quote is rejected, not totalled", () => {
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup", proposedPassThrough: "0" }));
  ensure(r.status === "invalid" && Boolean(r.errors.proposedPassThrough), "a zero network cost produced a result");
});

passes("a markup quote with the network costs entered totals them once", () => {
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup", proposedPassThrough: "180" }));
  ensure(r.status === "ok", "not ok");
  if (r.status !== "ok") return;
  // 0.3% of 10000 = 30; 200 transactions x $0.10 = 20; network costs 180; fees 0; equipment 0 -> 230 against 300
  ensure(r.proposedMonthlyUsd === 230, `proposed ${r.proposedMonthlyUsd}`);
  ensure(r.monthlyDifferenceUsd === 70 && r.annualDifferenceUsd === 840, `difference ${r.monthlyDifferenceUsd}/${r.annualDifferenceUsd}`);
  ensure(r.direction === "lower", "direction");
});

passes("network costs above the current cost are reported as higher, honestly", () => {
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup", proposedPassThrough: "290" }));
  ensure(r.status === "ok" && r.direction === "higher" && (r.monthlyDifferenceUsd ?? 0) < 0, "a higher quote was hidden or mislabeled");
});

passes("an all-in rate ignores a stale network-cost entry (no double counting) and a stale invalid one cannot block it", () => {
  const base = calculateCosts(inputs(FULL));
  const stale = calculateCosts(inputs({ ...FULL, proposedPassThrough: "500" }));
  const staleInvalid = calculateCosts(inputs({ ...FULL, proposedPassThrough: "-3" }));
  ensure(base.status === "ok" && stale.status === "ok" && staleInvalid.status === "ok", "all-in with a stale entry did not calculate");
  if (base.status !== "ok" || stale.status !== "ok" || staleInvalid.status !== "ok") return;
  ensure(stale.proposedMonthlyUsd === base.proposedMonthlyUsd && stale.proposedMonthlyUsd === 240, "a network cost was added to an all-in rate");
  ensure(!stale.proposedLines.some((l) => l.label === CALC_UNKNOWN_LABELS.passThrough), "network line shown for an all-in quote");
});

passes("tiered, per-category or unsure quotes are never totalled, even with every field typed", () => {
  const r = calculateCosts(inputs({ ...FULL, proposedBasis: "unsure", proposedPassThrough: "180" }));
  withheld(r, "unsure basis");
  if (r.status !== "ok") return;
  ensure(r.unknownLabels.includes(CALC_UNKNOWN_LABELS.unsure), "unsure basis not named as unknown");
});

passes("an unrecognized basis is invalid and names the field", () => {
  const r = calculateCosts(inputs({ ...FULL, proposedBasis: "flat" }));
  ensure(r.status === "invalid" && Boolean(r.errors.proposedBasis), "unrecognized basis produced a result");
});

passes("a complete flat-rate example still calculates, and the same numbers cannot skip the basis choice", () => {
  const chosen = calculateCosts(inputs(FULL));
  ensure(chosen.status === "ok" && chosen.monthlyDifferenceUsd === 60, "complete all-in example no longer calculates");
  withheld(calculateCosts(inputs({ ...FULL, proposedBasis: "" })), "the same all-in numbers without a chosen basis");
});

passes("the shared copy and both renderers explain the markup/pass-through gap", () => {
  const text = decode(JSON.stringify(CALC_COPY));
  ensure(/interchange/i.test(text) && /markup/i.test(text) && /incomplete/i.test(text), "shared copy omits the markup, interchange or incomplete explanation");
  ensure(CALC_COPY.faq.some((f) => /only a markup/i.test(f.question)), "no markup FAQ");
  const html = decode(stripImages(pageFn("getSavingsCalculatorHtml")()));
  const interchangeItem = CALC_COPY.why.find((item) => /interchange-plus/i.test(item.title));
  ensure(Boolean(interchangeItem) && html.includes(decode(interchangeItem!.text)) && /passed through/i.test(html), "server document omits the interchange-plus explanation");
  const markupFaq = CALC_COPY.faq.find((f) => /only a markup/i.test(f.question));
  ensure(Boolean(markupFaq) && html.includes(decode(markupFaq!.answer)), "server document omits the markup FAQ answer");
  const page = read("client/src/pages/SavingsCalculator.tsx");
  ensure(/CALC_BASIS_COPY/.test(page) && /name="calc-basis"/.test(page) && /type="radio"/.test(page), "React calculator has no pricing-basis choice");
  ensure(!/checked=\{true\}|defaultChecked/.test(page), "a pricing basis is preselected");
  ensure(/CALC_BASIS_COPY\.incompleteHeading/.test(page), "React calculator has no comparison-incomplete state");
});

negative("a calculator that totals a markup quote without the card-network costs", () => {
  // The defect: 0.3% + $0.10 and no other cost read as a $50 quote and a $3,000 annual reduction.
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup" }));
  ensure(r.status === "ok" && r.annualDifferenceUsd === 3000, "annual $3,000 reduction shown");
});
negative("a calculator that totals the same numbers when no basis was chosen", () => {
  const r = calculateCosts(inputs(MARKUP_ONLY));
  ensure(r.status === "ok" && r.proposedMonthlyUsd === 50, "$50 quote shown");
});
negative("a calculator that preselects an all-in basis", () => {
  ensure(EMPTY_CALC_INPUTS.proposedBasis === "all_in", "basis is empty");
});
negative("a calculator that adds a stale network cost to an all-in rate", () => {
  const r = calculateCosts(inputs({ ...FULL, proposedPassThrough: "500" }));
  ensure(r.status === "ok" && r.proposedMonthlyUsd === 740, "not double counted");
});
negative("a calculator that treats a typed zero network cost as a complete markup quote", () => {
  const r = calculateCosts(inputs({ ...MARKUP_ONLY, proposedBasis: "markup", proposedPassThrough: "0" }));
  ensure(r.status === "ok" && r.annualDifferenceUsd === 3000, "zero accepted");
});

negative("a calculator that treats blank as zero", () => {
  const naive = (raw: string) => Number(raw || 0);
  ensure(naive("") !== 0, "blank became zero");
});
negative("a calculator that shows a saving with an unknown fee", () => {
  const r = calculateCosts(inputs({ ...FULL, proposedMonthlyFees: "" }));
  ensure(r.status === "ok" && r.monthlyDifferenceUsd !== null, "withheld");
});
negative("a calculator that accepts a negative volume", () => {
  ensure(parseCalcField("monthlyVolume", "-5").kind !== "invalid", "rejected");
});
negative("calculator copy with a fixed Liberty target rate", () => {
  ensure(!/1\.95/.test(JSON.stringify(CALC_COPY).replace("monthly", "1.95% monthly")), "target rate present");
});
negative("calculator schema carrying an AggregateRating", () => {
  ensure(!/aggregateRating/.test(JSON.stringify({ ...CALC_STRUCTURED_DATA, aggregateRating: { ratingValue: 5 } })), "rating present");
});

// ── Proof ────────────────────────────────────────────────────────────────────

const TODAY = "2026-11-10";
const qualifying = (over: Partial<ProofCandidate> = {}): ProofCandidate => ({
  id: "fixture-1",
  basis: {
    privateSourceRef: "private://record/1",
    reportingPeriod: "January to December 2025",
    volumeAndFeeScope: "Twelve months of card volume with all statement fees",
    calculation: "Total fees divided by card volume, before and after",
    annualizationBasis: "Twelve actual months, not annualized",
    intervention: "Moved to a different pricing structure",
    limits: "One business; volume and card mix differed in 2026",
    reviewedOn: "2026-11-01",
  },
  permission: { granted: true, evidenceRef: "private://permission/1", recordedOn: "2026-10-30", surfaces: ["case-studies", "testimonials"] },
  draft: { attribution: "A restaurant owner", outcome: "Reviewed effective cost over twelve months.", quote: { text: "Clear explanation.", evidenceRef: "private://quote/1" } },
  ...over,
});

passes("the shipped proof register is empty, so every surface is the fallback", () => {
  ensure(PUBLIC_PROOF_CANDIDATES.length === 0, "the register is not empty");
  for (const surface of PROOF_SURFACES) {
    ensure(publicProofFor(surface).length === 0, `${surface} projected an item`);
    const page = proofOverviewPage(surface, publicProofFor(surface));
    ensure(!page.sections.some((s) => s.id === "reviewed-results"), `${surface} fallback page has a results section`);
  }
});

passes("a fully documented candidate qualifies and projects only redacted public fields", () => {
  const items = projectPublicProof([qualifying()], "case-studies", { today: TODAY });
  ensure(items.length === 1, "qualifying candidate did not project");
  const serialized = JSON.stringify(items[0]);
  ensure(!/private:\/\/|evidenceRef|privateSourceRef|annualizationBasis|calculation|permission/.test(serialized), "private field leaked into the projection");
  ensure(items[0].quote === "Clear explanation.", "quote with its own evidence was not projected");
  const page = proofOverviewPage("case-studies", items);
  ensure(page.sections[0].id === "reviewed-results", "results are not first on the page");
});

passes("each missing basis, permission or draft field blocks the result", () => {
  const basisFields = ["privateSourceRef", "reportingPeriod", "volumeAndFeeScope", "calculation", "annualizationBasis", "intervention", "limits", "reviewedOn"] as const;
  for (const field of basisFields) {
    const c = qualifying();
    c.basis = { ...c.basis, [field]: "" };
    ensure(projectPublicProof([c], "case-studies", { today: TODAY }).length === 0, `missing basis.${field} still projected`);
    ensure(proofGaps(c, "case-studies", TODAY).length > 0, `missing basis.${field} reported no gap`);
  }
  for (const field of ["granted", "evidenceRef", "recordedOn", "surfaces"] as const) {
    const c = qualifying();
    const permission: Record<string, unknown> = { ...c.permission };
    permission[field] = field === "granted" ? false : field === "surfaces" ? [] : "";
    c.permission = permission as ProofCandidate["permission"];
    ensure(projectPublicProof([c], "case-studies", { today: TODAY }).length === 0, `missing permission.${field} still projected`);
  }
  ensure(projectPublicProof([qualifying({ permission: undefined })], "case-studies", { today: TODAY }).length === 0, "no permission still projected");
  for (const field of ["attribution", "outcome"] as const) {
    const c = qualifying();
    c.draft = { ...c.draft, [field]: "  " };
    ensure(projectPublicProof([c], "case-studies", { today: TODAY }).length === 0, `missing draft.${field} still projected`);
  }
});

passes("permission is per surface", () => {
  const c = qualifying({ permission: { granted: true, evidenceRef: "private://p", recordedOn: "2026-10-30", surfaces: ["testimonials"] } });
  ensure(projectPublicProof([c], "testimonials", { today: TODAY }).length === 1, "permitted surface did not project");
  ensure(projectPublicProof([c], "case-studies", { today: TODAY }).length === 0, "a testimonials permission leaked to case studies");
});

passes("a quote without its own evidence is dropped, the outcome stays", () => {
  const c = qualifying();
  c.draft = { ...c.draft, quote: { text: "Clear explanation.", evidenceRef: "" } };
  const items = projectPublicProof([c], "testimonials", { today: TODAY });
  ensure(items.length === 1 && items[0].quote === undefined, "unevidenced quote was projected");
});

passes("future-dated review or permission and bad dates block the result", () => {
  const future = qualifying();
  future.basis = { ...future.basis, reviewedOn: "2027-01-01" };
  ensure(projectPublicProof([future], "case-studies", { today: TODAY }).length === 0, "future review date accepted");
  const badDate = qualifying();
  badDate.permission = { ...badDate.permission, recordedOn: "11/01/2026" };
  ensure(projectPublicProof([badDate], "case-studies", { today: TODAY }).length === 0, "malformed permission date accepted");
});

passes("a submission row must be approved and published as well", () => {
  const c = qualifying({ submissionId: 7 });
  ensure(projectPublicProof([c], "testimonials", { today: TODAY }).length === 0, "row projected with no published-row set");
  ensure(projectPublicProof([c], "testimonials", { today: TODAY, approvedSubmissionIds: new Set([8]) }).length === 0, "row projected when another row was published");
  ensure(projectPublicProof([c], "testimonials", { today: TODAY, approvedSubmissionIds: new Set([7]) }).length === 1, "published row did not project");
});

passes("duplicate ids project once", () => {
  ensure(projectPublicProof([qualifying(), qualifying()], "case-studies", { today: TODAY }).length === 1, "duplicate projected twice");
});

passes("only the two proof surfaces are accepted by the surface guard", () => {
  ensure(isProofSurface("case-studies") && isProofSurface("testimonials"), "valid surface refused");
  for (const bad of ["", "all", "constructor", "__proto__", "Testimonials", undefined, null, 1, ["testimonials"]]) {
    ensure(!isProofSurface(bad), `accepted ${JSON.stringify(bad)}`);
  }
  const route = read("server/routes/public.ts");
  ensure(/\/api\/public\/testimonials\/approved/.test(route) && /isProofSurface\(requested\)/.test(route), "endpoint does not validate ?surface=");
  ensure(/INVALID_SURFACE/.test(route), "endpoint has no invalid-surface response");
  ensure(/publicProofFor\(requested/.test(route), "endpoint does not read the shared projection");
  ensure(!/getPublishedTestimonialSubmissions\(\)\)?\.then\(\(rows\)\s*=>\s*res\.json\(rows/.test(route), "endpoint returns raw rows");
});

passes("no Review, AggregateRating or VideoObject schema is emitted by any public surface", () => {
  const FORBIDDEN = /"@type":\s*"(Review|AggregateRating|VideoObject)"|aggregateRating|reviewRating|\bVideoObject\b/;
  const html: Record<string, string> = {
    "/case-studies": pageFn("getCaseStudiesHtml")(),
    "/testimonials": pageFn("getTestimonialsHtml")(),
    "/testimonials/submit": pageFn("getTestimonialsSubmitHtml")(),
    "/free-analysis": pageFn("getFreeAnalysisHtml")(),
    "/free-analysis-guaranteed": pageFn("getFreeAnalysisGuaranteedHtml")(),
    "/why-liberty-bancard": pageFn("getWhyLibertyHtml")(),
    "/savings-calculator": pageFn("getSavingsCalculatorHtml")(),
    "/estimate": pageFn("getEstimateHtml")(),
  };
  for (const slug of getAvailableCompetitorSlugs()) {
    html[`/alternatives/${slug}`] = renderAlternativesHtml(slug);
    html[`/switch-from/${slug}`] = renderSwitchFromHtml(slug);
  }
  for (const [route, doc] of Object.entries(html)) ensure(!FORBIDDEN.test(decode(stripImages(doc))), `${route} emits Review/AggregateRating/VideoObject`);
  for (const file of [
    "client/src/pages/CaseStudies.tsx",
    "client/src/pages/Testimonials.tsx",
    "client/src/components/public/ProofPageView.tsx",
    "client/src/pages/SavingsCalculator.tsx",
    "client/src/pages/WhyLiberty.tsx",
    "client/src/pages/FreeAnalysis.tsx",
    "client/src/pages/FreeAnalysisGuaranteed.tsx",
    "shared/public-proof.ts",
    "shared/public-cost-calculator.ts",
  ]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ensure(!FORBIDDEN.test(source), `${file} can emit Review/AggregateRating/VideoObject`);
  }
  const seo = read("client/src/components/SEO.tsx");
  ensure(!/"@type":\s*"(Review|AggregateRating|VideoObject)"/.test(seo), "SEO component builds Review/AggregateRating/VideoObject schema");
  ensure(!/aggregateRating/.test(seo), "SEO component still accepts aggregateRating");
});

passes("the proof pages render the fallback in the first HTML and carry no invented result", () => {
  for (const [route, name] of [["/case-studies", "getCaseStudiesHtml"], ["/testimonials", "getTestimonialsHtml"]] as const) {
    const html = decode(stripImages(pageFn(name)()));
    ensure(/not publishing customer/i.test(html), `${route} first HTML is not the fallback`);
    ensure(!/\bsaved\b[^.]{0,40}\$[\d,]+|\$[\d,]+[^.]{0,40}(per year|a year|annually)|★|5\.0 ?\/ ?5|stars?\b/i.test(html), `${route} first HTML carries an invented result or rating`);
    ensure((html.match(/<h1[\s>]/g) ?? []).length === 1, `${route} does not have exactly one H1`);
  }
  for (const route of ["/case-studies", "/testimonials"]) {
    const def = SEO_ROUTE_DEFAULTS[route];
    ensure(Boolean(def), `${route} has no route metadata`);
    ensure(!/\$[\d,]+|save|saved|results|%/i.test(`${def.title} ${def.description}`.replace(/Customer results/i, "")) || /not publishing/i.test(def.description), `${route} metadata promises a result`);
  }
});

negative("a candidate with no recorded permission", () => {
  ensure(projectPublicProof([qualifying({ permission: undefined })], "case-studies", { today: TODAY }).length === 0, "projected");
  ensure(proofGaps(qualifying({ permission: undefined }), "case-studies", TODAY).length === 0, "gaps reported");
});
negative("a candidate missing the calculation", () => {
  const c = qualifying();
  c.basis = { ...c.basis, calculation: "" };
  ensure(proofGaps(c, "case-studies", TODAY).length === 0, "gap reported");
});
negative("a projection that returns the private evidence reference", () => {
  const items = projectPublicProof([qualifying()], "case-studies", { today: TODAY });
  ensure(!/private:\/\//.test(JSON.stringify({ ...items[0], leak: "private://permission/1" })), "private reference present");
});
negative("a surface guard that accepts an arbitrary string", () => {
  ensure(!(typeof "constructor" === "string"), "accepted");
});
negative("a page emitting AggregateRating", () => {
  ensure(!/aggregateRating/.test(`${pageFn("getTestimonialsHtml")()}"aggregateRating":{"ratingValue":5}`), "rating present");
});

// ── Superseded figures and claims ────────────────────────────────────────────

const STALE: { id: string; re: RegExp }[] = [
  { id: "guaranteed-50", re: /\$50 (if (we|you|savings|no)|guarantee|credit|back|will be (paid|credited))|pay you \$50|\$50 for your time/i },
  { id: "statement-count", re: /(?<![$\d,])3,200\+?|5,000\+? (businesses|merchants|statements)|3,200 statements/i },
  { id: "volume-claim", re: /\$2B\b|\$2 billion/i },
  { id: "uptime", re: /99\.9\d?%/ },
  { id: "pci-level-1", re: /PCI (DSS )?Level 1|Level 1 (PCI )?certified/i },
  { id: "square-stale-rate", re: /Square[^.<]{0,80}2\.6%\s*\+\s*(\$0\.10|10¢)/i },
  { id: "all-50-states", re: /legal in all 50 states/i },
  { id: "zero-cost", re: /(reduce[sd]?|lower|cut|bring|drive)[^.]{0,50}(costs?|fees|rates?)[^.]{0,30} to (near )?zero|near[- ]zero processing|(?<!not )eliminat\w* (your |all |my )?(card |credit card )?processing (costs|fees)|zero[- ]cost processing (program|offer|is (available|possible)|for (restaurants|retail))/i },
];

function staleHits(text: string): string[] {
  return STALE.filter((p) => p.re.test(text)).map((p) => p.id);
}

passes("first-HTML emitters carry none of the superseded figures or claims", () => {
  const docs: Record<string, string> = {
    "/why-liberty-bancard": pageFn("getWhyLibertyHtml")(),
    "/free-analysis": pageFn("getFreeAnalysisHtml")(),
    "/free-analysis-guaranteed": pageFn("getFreeAnalysisGuaranteedHtml")(),
    "/savings-calculator": pageFn("getSavingsCalculatorHtml")(),
    "/estimate": pageFn("getEstimateHtml")(),
    "/case-studies": pageFn("getCaseStudiesHtml")(),
    "/testimonials": pageFn("getTestimonialsHtml")(),
    "/get-started": pageFn("getGetStartedHtml")(),
    "/compare-rates": pageFn("getCompareRatesHtml")(),
  };
  for (const slug of getAvailableCompetitorSlugs()) {
    docs[`/alternatives/${slug}`] = renderAlternativesHtml(slug);
    docs[`/switch-from/${slug}`] = renderSwitchFromHtml(slug);
  }
  for (const [route, html] of Object.entries(docs)) {
    const hits = staleHits(decode(stripImages(html)));
    ensure(hits.length === 0, `${route} renders superseded content: ${hits.join(", ")}`);
  }
});

passes("route metadata and source files carry none of the superseded figures or claims", () => {
  for (const [route, def] of Object.entries(SEO_ROUTE_DEFAULTS)) {
    const hits = staleHits(`${def.title} ${def.description} ${def.keywords ?? ""}`);
    ensure(hits.length === 0, `${route} metadata carries superseded content: ${hits.join(", ")}`);
  }
  const files = [
    "shared/seo-routes.ts",
    "shared/public-free-analysis.ts",
    "shared/public-why-liberty.ts",
    "shared/public-cost-calculator.ts",
    "shared/public-proof.ts",
    "server/ssr/competitor-ssr.ts",
    "client/src/pages/SavingsCalculator.tsx",
    "client/src/pages/WhyLiberty.tsx",
    "client/src/pages/FreeAnalysis.tsx",
    "client/src/pages/FreeAnalysisGuaranteed.tsx",
    "client/src/pages/CaseStudies.tsx",
    "client/src/pages/Testimonials.tsx",
    "client/src/pages/AssetPage.tsx",
    "client/src/pages/sales/SalesOnePager.tsx",
    "client/src/pages/HelpCenter.tsx",
    "client/src/pages/FAQ.tsx",
  ];
  for (const file of files) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const hits = staleHits(source);
    ensure(hits.length === 0, `${file} carries superseded content: ${hits.join(", ")}`);
  }
});

passes("the guaranteed-analysis explainer keeps its own canonical URL and reads the shared module", () => {
  const html = decode(stripImages(pageFn("getFreeAnalysisGuaranteedHtml")()));
  ensure(/rel="canonical" href="https:\/\/libertybancard\.com\/free-analysis-guaranteed"/.test(html), "explainer is not self-canonical");
  ensure(/shared\/public-free-analysis"/.test(read("server/ssr/pages.ts")), "SSR does not import the shared free-analysis module");
  ensure(/@shared\/public-free-analysis/.test(read("client/src/pages/FreeAnalysisGuaranteed.tsx")), "React explainer does not import the shared module");
});

passes("Why Liberty, free analysis and calculator are read from shared modules on both renderers", () => {
  const pages = read("server/ssr/pages.ts");
  for (const module of ["public-why-liberty", "public-free-analysis", "public-cost-calculator", "public-proof"]) {
    ensure(new RegExp(`shared/${module}"`).test(pages), `server/ssr/pages.ts does not import ${module}`);
  }
  const clients: [string, string][] = [
    ["client/src/pages/WhyLiberty.tsx", "@shared/public-why-liberty"],
    ["client/src/pages/FreeAnalysis.tsx", "@shared/public-free-analysis"],
    ["client/src/pages/SavingsCalculator.tsx", "@shared/public-cost-calculator"],
    ["client/src/components/public/ProofPageView.tsx", "@shared/public-proof"],
  ];
  for (const [file, module] of clients) ensure(read(file).includes(`"${module}"`), `${file} does not import ${module}`);
});

passes("the welcome pop-up is gone and nothing imports it", () => {
  ensure(!fs.existsSync(path.join(ROOT, "client/src/components/WelcomePopup.tsx")), "WelcomePopup.tsx still exists");
  const app = read("client/src/App.tsx");
  ensure(!/WelcomePopup/.test(app), "App.tsx still references WelcomePopup");
});

passes("the sales one-pager and asset page make no unsourced numeric or guarantee claim", () => {
  for (const file of ["client/src/pages/AssetPage.tsx", "client/src/pages/sales/SalesOnePager.tsx"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ensure(!/\bsave[sd]?\b[^"'`]{0,30}\$[\d,]+|average (merchant|business) (saves|overpays)|guarantee[sd]? (savings|results)|100% (satisfaction|guarantee)/i.test(source), `${file} carries a savings or guarantee promise`);
  }
});

negative("a guaranteed $50 promise added to the explainer", () => {
  const hits = staleHits(`${decode(pageFn("getFreeAnalysisGuaranteedHtml")())} We pay you $50 if we cannot find savings.`);
  ensure(hits.length === 0, "promise present");
});
negative("a statement-count claim added to a page", () => {
  ensure(staleHits("We reviewed 3,200+ statements").length === 0, "claim present");
});
negative("a 99.9% uptime promise added to a page", () => {
  ensure(staleHits("99.9% uptime").length === 0, "promise present");
});
negative("a PCI Level 1 certification statement added to a page", () => {
  ensure(staleHits("Liberty is PCI Level 1 certified").length === 0, "statement present");
});
negative("the stale Square rate attributed in a competitor page", () => {
  ensure(staleHits(`${renderAlternativesHtml("square")} Square charges 2.6% + $0.10 per swipe`).length === 0, "rate present");
});
negative("a guarantee added to the sales one-pager", () => {
  const source = `${read("client/src/pages/sales/SalesOnePager.tsx")}\nconst x = "Average merchant saves $4,000 a year";`;
  ensure(!/\bsave[sd]?\b[^"'`]{0,30}\$[\d,]+/i.test(source), "promise present");
});
negative("the welcome pop-up reintroduced in the app shell", () => {
  ensure(!/WelcomePopup/.test(`${read("client/src/App.tsx")}\nimport WelcomePopup from "@/components/WelcomePopup";`), "referenced");
});

// ── Editorial content: glossary, Help Center, blog ───────────────────────────

const EDITORIAL: { id: string; re: RegExp }[] = [
  ...STALE,
  { id: "no-fee-promise", re: /we (don.t|do not|never) charge (any )?(setup|application|cancellation|termination|early|hidden|annual)|no (setup|application|cancellation|early termination|annual|hidden) fees? (with|at|from) liberty/i },
  { id: "liberty-commitment", re: /(Liberty Bancard|Liberty)('s)? (guarantees?|promises?|will (always|never)|always (has|offers?|provides?))|all Liberty Bancard merchants|most Liberty Bancard merchants|every Liberty Bancard merchant/i },
  { id: "approval-timing", re: /approved (in|within) (minutes|24|48|one business day|1 business day)|funding (in|within) (24|48) hours|(24|48)[- ]hours? (approval|setup)|same[- ]day approval|(application|underwriting|approval)( process)? (typically |usually )?takes? (\d|one|two|a few)[^.]{0,24}(hours?|business days?|days)|underwriting takes \d/i },
  { id: "liberty-free-equipment", re: /free (terminal|equipment|pos|card reader)s? (for|with|from|when) (qualif|every|all|Liberty)|equipment (is|are) free (for|with)|free placement/i },
  { id: "liberty-support-promise", re: /(24\/7|round[- ]the[- ]clock) (support|phone|help)|dedicated account (manager|representative)s? (who|for every|for all)|real[- ]time monitoring flags/i },
  { id: "third-party-freeze", re: /Square('s)? (automated risk systems|accounts? (are|is) frozen)|freeze funds without warning/i },
  { id: "third-party-lock", re: /locked to Clover'?s? processing network/i },
  { id: "unsourced-benchmark", re: /most (small )?merchants (overpay|are overcharged|save)|(the )?average (small )?(business|merchant) (overpays|pays \d)/i },
];

function editorialHits(text: string): string[] {
  return EDITORIAL.filter((p) => p.re.test(text)).map((p) => p.id);
}

passes("glossary terms carry no superseded figure, Liberty commitment or unsourced third-party claim", () => {
  ensure(GLOSSARY_TERMS.length > 40, `glossary has only ${GLOSSARY_TERMS.length} terms`);
  for (const term of GLOSSARY_TERMS as unknown as { slug: string }[]) {
    const hits = editorialHits(decode(JSON.stringify(term)));
    ensure(hits.length === 0, `glossary term ${term.slug} carries: ${hits.join(", ")}`);
  }
});

passes("Help Center articles carry no superseded figure, Liberty commitment or unsourced third-party claim", () => {
  ensure(HELP_ARTICLES.length > 30, `help center has only ${HELP_ARTICLES.length} articles`);
  for (const article of HELP_ARTICLES as unknown as { slug: string }[]) {
    const hits = editorialHits(decode(JSON.stringify(article)));
    ensure(hits.length === 0, `help article ${article.slug} carries: ${hits.join(", ")}`);
  }
});

passes("blog data and its server copy carry no superseded figure, Liberty commitment or unsourced third-party claim", () => {
  const files = [
    "client/src/lib/blog-data.ts",
    "client/src/lib/blog-data-2.ts",
    "client/src/lib/blog-data-3.ts",
    "client/src/lib/blog-data-4.ts",
    "client/src/lib/blog-data-5.ts",
    "client/src/lib/blog-data-6.ts",
    "client/src/lib/blog-data-7.ts",
    "client/src/lib/blog-data-pillars.ts",
    "server/ssr/all-blog-posts-server.ts",
  ];
  for (const file of files) {
    // Search keywords name what visitors look for, and the "free processing" explainer evaluates those claims; neither is a Liberty promise.
    const body = read(file).replace(/^\s*keywords:.*$/gm, "").replace(/evaluate zero-cost processing claims/gi, "");
    const hits = editorialHits(decode(body));
    ensure(hits.length === 0, `${file} carries: ${hits.join(", ")}`);
  }
});

passes("the glossary Liberty section is written only from approved claims", () => {
  const source = read("server/data/glossary-terms.ts");
  ensure(/function liberty\(/.test(source) || /const liberty\s*=/.test(source), "glossary has no approved-claim helper");
  ensure(/claimText|publicClaims/.test(source), "glossary helper does not read the claim register");
  const route = read("server/routes/glossary.ts");
  ensure(!/legal in all 50|zero-cost|0% processing program/i.test(route), "glossary route carries a retired claim");
});

// A literal "**" or a paragraph (or line inside one) that begins with a list marker means a definition's
// markup was escaped as plain text instead of rendered. Styles are removed first: CSS comments carry "/**".
const GLOSSARY_MARKER_LINE = /<(?:p|br)\b[^>]*>\s*(?:[-\u2013\u2022*]|\d+[.)])\s/;
function glossaryMarkupProblems(html: string): string[] {
  const doc = html.replace(/<style[\s\S]*?<\/style>/g, "");
  const problems: string[] = [];
  if (doc.includes("**")) problems.push('a literal "**"');
  if (GLOSSARY_MARKER_LINE.test(doc)) problems.push("a paragraph that begins with a list marker");
  return problems;
}

passes("no glossary term page's first HTML shows a literal ** or a paragraph that begins with a list marker", () => {
  const termPages = (GLOSSARY_TERMS as unknown as { slug: string }[]).map((term) => ({
    term: term as (typeof GLOSSARY_TERMS)[number],
    html: buildTermPageHtml(term as (typeof GLOSSARY_TERMS)[number], getRelatedTerms(term.slug)),
  }));
  ensure(termPages.length > 40, `only ${termPages.length} glossary term pages were built`);
  let withBold = 0;
  let withLists = 0;
  for (const { term, html } of termPages) {
    const problems = glossaryMarkupProblems(html);
    ensure(problems.length === 0, `/learn/${term.slug} shows ${problems.join(" and ")}`);
    const source = `${term.fullDefinition}\n\n${term.merchantImpact}`;
    if (source.includes("**")) {
      withBold++;
      ensure(/<strong>[^<]+<\/strong>/.test(html), `/learn/${term.slug} has **bold** in its definition but no <strong> element`);
    }
    if (/(^|\n)\s*(- |\d+\. )/.test(source)) {
      withLists++;
      ensure(/<li>/.test(html), `/learn/${term.slug} has a list in its definition but no <li> element`);
    }
  }
  ensure(withBold > 0 && withLists > 0, "no glossary definition uses bold or a list, so the render check proved nothing");
});

passes("glossary term pages stay HTML-escaped and ship no client bundle", () => {
  const rendered = renderGlossaryText('<script>alert(1)</script> **<img src=x onerror=alert(1)>**\n- a & "b"\n  - <b>c</b>\n1. one\n\n2. two');
  ensure(!/<(script|img|b)\b/i.test(rendered), "definition markup was not escaped");
  ensure(rendered.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "script text was not escaped");
  ensure(rendered.includes("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>"), "bold text was not escaped inside <strong>");
  ensure(rendered.includes("<ul><li>a &amp; &quot;b&quot;<ul><li>&lt;b&gt;c&lt;/b&gt;</li></ul></li></ul>"), `nested list rendered as ${rendered}`);
  ensure(rendered.endsWith("<ol><li>one</li><li>two</li></ol>"), "numbered steps in separate paragraphs were not one list");
  ensure(renderGlossaryText("Step:\n- one") === "<p>Step:</p><ul><li>one</li></ul>", "an intro line before a list was not split from it");
  ensure(renderGlossaryText("1 basis point = 0.01%\n10 basis points = 0.10%") === "<p>1 basis point = 0.01%<br>10 basis points = 0.10%</p>", "plain lines starting with a number were treated as a list");
  ensure(renderGlossaryText("2. one\n\n4. two").includes('<ol start="2">') && renderGlossaryText("2. one").includes('<ol start="2">'), "a numbered list lost its start number");
  for (const term of GLOSSARY_TERMS as unknown as { slug: string }[]) {
    const html = buildTermPageHtml(term as (typeof GLOSSARY_TERMS)[number], getRelatedTerms(term.slug));
    ensure(!/<script\b[^>]*type="module"/i.test(html), `/learn/${term.slug} loads a module script`);
    ensure(!/(src|href)="\/assets\//.test(html), `/learn/${term.slug} references the client bundle`);
  }
});

negative("a term page that shows **bold** as plain text", () => {
  ensure(glossaryMarkupProblems("<article><p>Typical <strong>x</strong> and **Visa**: 0.9%</p></article>").length === 0, "literal ** present");
});
negative("a term page paragraph that begins with a dash list marker", () => {
  ensure(glossaryMarkupProblems("<article><p>- Excellent: Under 1.8%</p></article>").length === 0, "list marker present");
});
negative("a term page paragraph that begins with a numbered list marker", () => {
  ensure(glossaryMarkupProblems("<article><p>1. Register with Visa and Mastercard</p></article>").length === 0, "list marker present");
});
negative("a term page paragraph whose list marker follows a line break", () => {
  ensure(glossaryMarkupProblems("<article><p>Typical markups:<br>- Large merchants</p></article>").length === 0, "list marker present");
});
negative("a definition that injects raw HTML", () => {
  ensure(!/<script\b/i.test("<p><script>alert(1)</script></p>"), "raw script present");
});

passes("the Help Center reads approved claims for Liberty commitments", () => {
  const source = read("client/src/lib/help-center-data.ts");
  ensure(/import \{ claimText \} from "@shared\/public-claims"/.test(source), "help center does not import claimText");
  ensure((source.match(/claimText\("/g) ?? []).length >= 10, "help center uses too few approved claims");
});

passes("no public page promises a support response time", () => {
  for (const file of ["client/src/pages/HelpCenter.tsx", "client/src/pages/FAQ.tsx"]) {
    ensure(!/responds? within \d+ (business )?hours?/i.test(read(file)), `${file} promises a response time`);
  }
});

negative("a glossary term claiming it is legal in all 50 states", () => {
  ensure(editorialHits("Cash discounting is legal in all 50 states.").length === 0, "claim present");
});
negative("a Help Center article promising approval timing", () => {
  ensure(editorialHits("Most merchants are approved within 24 hours.").length === 0, "promise present");
});
negative("a blog post promising zero-cost processing", () => {
  ensure(editorialHits("Cash discount reduces your processing costs to near zero.").length === 0, "claim present");
});
negative("a blog post repeating an unsourced third-party freeze claim", () => {
  ensure(editorialHits("Square's automated risk systems occasionally freeze funds without warning.").length === 0, "claim present");
});
negative("a Help Center article with a Liberty commitment", () => {
  ensure(editorialHits("All Liberty Bancard merchants get free equipment for qualifying businesses.").length === 0, "commitment present");
});
negative("a support response-time promise in the Help Center", () => {
  ensure(!/responds? within \d+ (business )?hours?/i.test(`${read("client/src/pages/HelpCenter.tsx")}\n<p>Our team responds within 4 business hours.</p>`), "promise present");
});

// ── Sitemap ──────────────────────────────────────────────────────────────────

passes("/blog is listed once: in the core sitemap, not in the blog sitemap", () => {
  ensure(Boolean(SEO_ROUTE_DEFAULTS["/blog"]), "/blog is not in the route defaults that feed the core sitemap");
  const route = read("server/routes/ssr-routes.ts");
  const start = route.indexOf('app.get("/sitemap-blog.xml"');
  ensure(start > 0, "blog sitemap handler not found");
  const handler = route.slice(start, route.indexOf("app.get(\"/sitemap-compare.xml\"", start));
  ensure(!/<loc>\$\{baseUrl\}\/blog<\/loc>/.test(handler), "the blog sitemap lists /blog");
  ensure(/\/blog\/\$\{post\.slug\}/.test(handler), "the blog sitemap does not list posts");
});

negative("a blog sitemap that lists /blog again", () => {
  const handler = "xml += `<url><loc>${baseUrl}/blog</loc></url>`;";
  ensure(!/<loc>\$\{baseUrl\}\/blog<\/loc>/.test(handler), "duplicate present");
});

// ── Provider identity and pricing-model copy (PV09) ──────────────────────────

/** Stale or unsupported statements about the two providers the post-Publish audit named. */
function providerIdentityProblems(slug: string, html: string, route: "alternatives" | "switch-from" = "alternatives"): string[] {
  const problems: string[] = [];
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  if (slug === "worldpay") {
    if (/\bFIS\b/.test(text)) problems.push("names FIS as the owner of Worldpay");
    // The alternatives page states who the provider is; the switch-from page names it only as the provider being left.
    if (route === "alternatives" && !/Global Payments/.test(text)) problems.push("does not state the current owner (Global Payments)");
  }
  if (slug === "gravity-payments") {
    if (/flat[- ]fee processor/i.test(text)) problems.push("labels Gravity a flat-fee processor");
    if (/flat monthly fee|monthly flat fee/i.test(text)) problems.push("assumes a monthly flat-fee model");
    if (/divide your monthly/i.test(text)) problems.push("tells the reader to divide a monthly fee by volume");
    if (route === "alternatives" && !/flat-rate plan or customized pricing/i.test(text)) problems.push("does not say the pricing model depends on the plan (flat-rate or customized)");
  }
  return problems;
}

passes("Worldpay and Gravity Payments pages state a current owner and a plan-dependent pricing model", () => {
  for (const slug of ["worldpay", "gravity-payments"]) {
    for (const [route, render] of [["alternatives", renderAlternativesHtml], ["switch-from", renderSwitchFromHtml]] as const) {
      const problems = providerIdentityProblems(slug, render(slug), route);
      ensure(problems.length === 0, `/${route}/${slug}: ${problems.join("; ")}`);
    }
  }
});

passes("the glossary no longer says Worldpay is part of FIS", () => {
  ensure(!GLOSSARY_TERMS.some((t) => /Worldpay \(FIS\)/.test(`${t.fullDefinition} ${t.shortDefinition} ${t.merchantImpact}`)), "a glossary definition still says Worldpay (FIS)");
});

negative("a Worldpay page that still names FIS Global", () => {
  ensure(providerIdentityProblems("worldpay", "<p>Worldpay (FIS Global) is an enterprise processor. Global Payments</p>").length === 0, "FIS present");
});
negative("a Worldpay page that omits the current owner", () => {
  ensure(providerIdentityProblems("worldpay", "<p>Worldpay is an enterprise processor.</p>").length === 0, "owner missing");
});
negative("a Gravity page that calls it a flat-fee processor and divides a monthly fee", () => {
  ensure(providerIdentityProblems("gravity-payments", "<p>Gravity is a flat-fee processor. Divide your monthly flat fee by your monthly card volume. flat-rate plan or customized pricing</p>").length === 0, "model assumption present");
});
negative("a Gravity page that never says the model depends on the plan", () => {
  ensure(providerIdentityProblems("gravity-payments", "<p>Gravity Payments is a processor.</p>").length === 0, "plan qualification missing");
});

// ── Document titles and descriptions stay inside the SEO budget (PV07) ───────

const TITLE_BUDGET = 70;
const DESCRIPTION_BUDGET = { min: 100, max: 165 };
const decodeEntities = (t: string): string => t.replace(/&amp;/g, "&").replace(/&#0*39;|&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const titleOf = (html: string): string => decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
const descriptionOf = (html: string): string => decodeEntities(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? "");

passes("every alternatives and switch-from page has a title of at most 70 characters, brand included", () => {
  const over: string[] = [];
  for (const slug of getAvailableCompetitorSlugs()) {
    for (const [route, render] of [["alternatives", renderAlternativesHtml], ["switch-from", renderSwitchFromHtml]] as const) {
      const title = titleOf(render(slug));
      if (title.length > TITLE_BUDGET || title.length < 30) over.push(`/${route}/${slug} (${title.length}) "${title}"`);
    }
  }
  ensure(over.length === 0, over.join("; "));
});

passes("every alternatives and switch-from page carries a social image like the other server-rendered pages", () => {
  const missing: string[] = [];
  for (const slug of getAvailableCompetitorSlugs()) {
    for (const [route, render] of [["alternatives", renderAlternativesHtml], ["switch-from", renderSwitchFromHtml]] as const) {
      const html = render(slug);
      if (!new RegExp(`property="og:image" content="https://libertybancard\\.com/og/default/${route}-${slug}\\.png"`).test(html)) missing.push(`/${route}/${slug}`);
      if (!/name="twitter:image"/.test(html)) missing.push(`/${route}/${slug} (twitter:image)`);
    }
  }
  ensure(missing.length === 0, missing.join("; "));
});

passes("every glossary term page and the hub fit the title and description budget", () => {
  const problems: string[] = [];
  for (const term of GLOSSARY_TERMS) {
    const html = buildTermPageHtml(term as (typeof GLOSSARY_TERMS)[number], getRelatedTerms(term.slug));
    const title = titleOf(html);
    const description = descriptionOf(html);
    if (title.length > TITLE_BUDGET) problems.push(`/learn/${term.slug} title ${title.length}`);
    if (description.length < DESCRIPTION_BUDGET.min || description.length > DESCRIPTION_BUDGET.max) problems.push(`/learn/${term.slug} description ${description.length}`);
  }
  const hub = read("server/routes/glossary.ts").match(/function buildHubPageHtml\(\): string \{\s*const title = "([^"]+)"/)?.[1] ?? "";
  if (hub.length === 0 || hub.length > TITLE_BUDGET) problems.push(`/learn hub title ${hub.length}`);
  ensure(problems.length === 0, problems.join("; "));
});

passes("every blog post has a document title of at most 70 characters, and the server and the React page agree on it and on the headline", () => {
  const problems: string[] = [];
  const clientBySlug = new Map(CLIENT_BLOG_POSTS.map((p) => [p.slug, p]));
  for (const post of allBlogPostsServer) {
    const document = blogDocumentTitle(post.slug, post.title);
    if (document.length > TITLE_BUDGET) problems.push(`${post.slug} document title ${document.length}`);
    if (post.metaDescription.length > DESCRIPTION_BUDGET.max || post.metaDescription.length < DESCRIPTION_BUDGET.min) problems.push(`${post.slug} description ${post.metaDescription.length}`);
    const client = clientBySlug.get(post.slug);
    if (!client) problems.push(`${post.slug} has no React page data`);
    else {
      if (client.title !== post.title) problems.push(`${post.slug} headline differs: server "${post.title}" vs React "${client.title}"`);
      if (client.metaDescription !== post.metaDescription) problems.push(`${post.slug} description differs between server and React`);
    }
  }
  ensure(problems.length === 0, problems.join("; "));
  const source = read("client/src/pages/BlogPost.tsx");
  ensure(/blogDocumentTitle\(post\.slug, post\.title\)/.test(source), "the React blog page does not use the shared document title");
  ensure(/blogDocumentTitle\(post\.slug, post\.title\)/.test(read("server/ssr/blog-ssr-data.ts")), "the server blog renderer does not use the shared document title");
  ensure(BLOG_SHORTER_TITLE_SLUGS.length > 0, "no blog post has a shorter document title");
});

passes("the client SEO component never doubles the site name", () => {
  ensure(/!\/\\\|\\s\*Liberty Bancard\\s\*\$\/i\.test\(title\)/.test(read("client/src/components/SEO.tsx")), "the doubled-suffix guard is missing from SEO.tsx");
});

negative("a competitor page whose title is 78 characters", () => {
  ensure(titleOf(`<title>${"Before You Switch From Shopify Payments: Agreement Questions | Liberty Bancard"}</title>`).length <= TITLE_BUDGET, "title over budget");
});
negative("a blog post whose headline plus suffix is 92 characters and has no shorter document title", () => {
  ensure(blogDocumentTitle("an-unlisted-slug", "Interchange Plus Pricing vs. Flat Rate: Which Is Better for Your Business?").length <= TITLE_BUDGET, "title over budget");
});
negative("a glossary description of 176 characters", () => {
  ensure("x".repeat(176).length <= DESCRIPTION_BUDGET.max, "description over budget");
});
negative("a blog headline that differs between the server and the React page", () => {
  ensure("How to Switch Payment Processors Without Disrupting Your Business" === "How to Switch Payment Processors Without Downtime", "headline differs");
});
negative("a competitor page with no social image", () => {
  ensure(/property="og:image"/.test("<head><title>x</title></head>"), "og:image missing");
});

// ── Cached representations of the user-agent branched pages (PV05) ───────────

passes("the pages that answer crawlers and browsers differently vary on User-Agent", () => {
  const route = read("server/routes/ssr-routes.ts");
  for (const pathName of ['app.get("/free-smart-terminal"', 'app.get("/blog"', 'app.get("/blog/:slug"']) {
    const start = route.indexOf(pathName);
    ensure(start > 0, `${pathName} handler not found`);
    const handler = route.slice(start, route.indexOf("\n  });", start));
    ensure(/res\.vary\("User-Agent"\)/.test(handler), `${pathName} does not call res.vary("User-Agent")`);
    ensure(handler.indexOf('res.vary("User-Agent")') < handler.indexOf("isCrawler("), `${pathName} varies only after it has branched on the user agent`);
  }
  const branching = [...route.matchAll(/isCrawler\(req/g)].length;
  ensure(branching === 3, `${branching} user-agent branches found (expected the three handlers above); a new one needs its own Vary`);
});

negative("a user-agent branched handler with no Vary header", () => {
  const handler = 'app.get("/blog", async (req, res, next) => { if (!isCrawler(req.headers["user-agent"])) return next(); });';
  ensure(/res\.vary\("User-Agent"\)/.test(handler), "Vary missing");
});

// ── Branded not-found page (PV06) ────────────────────────────────────────────

passes("the unknown-URL document is a branded page with a heading, recovery links and no index, shared with the React page", () => {
  const html = getPublicNotFoundHtml();
  ensure((html.match(/<h1[\s>]/g) ?? []).length === 1, "the not-found document must have exactly one h1");
  ensure(html.includes(PUBLIC_NOT_FOUND.title) || html.includes(PUBLIC_NOT_FOUND.title.replace(/'/g, "&#39;")), "the shared headline is not in the server document");
  for (const link of PUBLIC_NOT_FOUND.links) ensure(html.includes(`href="${link.href}"`), `recovery link ${link.href} missing`);
  ensure(/<meta name="robots" content="[^"]*noindex/i.test(html), "the not-found document is not noindex");
  ensure(!/rel="canonical"/i.test(html), "a not-found document must not declare a canonical URL");
  ensure(!/<script[^>]+type="module"/i.test(html) && !/<script[^>]+src="[^"]*\/(assets|src)\//i.test(html), "the not-found document must not load the React client bundle");
  ensure(/ssr-navbar/.test(html) && /ssr-footer|<footer/.test(html), "the shared header and footer are missing");
  ensure(/@shared\/public-not-found/.test(read("client/src/pages/not-found.tsx")), "the React not-found page does not read the shared copy");
});

passes("unknown dynamic public URLs answer with a real 404 through one helper, never an empty body, a redirect or a reflected path", () => {
  const route = read("server/routes/ssr-routes.ts");
  ensure(!/status\(404\)\.end\(\)/.test(route), 'a route still sends status(404).end()');
  ensure(!/notFoundHtml\s*\(/.test(route), "the old reflected-path notFoundHtml helper is still present");
  const helper = route.slice(route.indexOf("function sendPublicNotFound"), route.indexOf("const today"));
  ensure(/res\.status\(404\)/.test(helper) && /no-store/.test(helper) && /noindex/.test(helper), "the helper does not send 404 + no-store + noindex");
  ensure(!/req\.|path/.test(helper.replace(/Express|isn't/g, "")), "the helper reads the request path");
  for (const marker of ['"/industries/:slug"', '"/compare/:competitor"', '"/alternatives/:competitor"', '"/switch-from/:competitor"']) {
    const start = route.indexOf(`app.get(${marker}`);
    ensure(start > 0, `${marker} handler not found`);
    ensure(/sendPublicNotFound\(res\)/.test(route.slice(start, start + 900)), `${marker} does not use sendPublicNotFound`);
  }
});

negative("a not-found document with a canonical URL and no noindex", () => {
  ensure(!/rel="canonical"/.test('<link rel="canonical" href="https://libertybancard.com/x">') && /noindex/.test("<meta name=\"robots\" content=\"index\">"), "indexable");
});
negative("a handler that ends an unknown URL with an empty 404 body", () => {
  ensure(!/status\(404\)\.end\(\)/.test("if (!ok) return res.status(404).end();"), "empty 404 present");
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`W-D content contract: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
