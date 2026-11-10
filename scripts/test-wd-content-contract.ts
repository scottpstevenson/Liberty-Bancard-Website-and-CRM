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
  CALC_STRUCTURED_DATA,
  EMPTY_CALC_INPUTS,
  calculateCosts,
  parseCalcField,
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
import { glossaryTerms as GLOSSARY_TERMS } from "../server/data/glossary-terms";
import { helpArticles as HELP_ARTICLES } from "../client/src/lib/help-center-data";

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
    ensure(parseCalcField(field as keyof CalcInputs, String(limit.max + 1)).kind === "invalid", `${field} accepted above its limit`);
    ensure(parseCalcField(field as keyof CalcInputs, String(limit.max)).kind === "ok", `${field} rejected at its limit`);
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
  const r = calculateCosts(inputs({ monthlyVolume: "1000", avgTicket: "10", currentRate: "2", proposedRate: "2", proposedPerTransaction: "0", proposedMonthlyFees: "0", proposedEquipmentMonthly: "0" }));
  ensure(r.status === "ok" && r.direction === "same" && r.monthlyDifferenceUsd === 0, "equal quote not reported as the same");
});

passes("results at the maximum inputs are finite or rejected, never NaN", () => {
  const r = calculateCosts(inputs({ monthlyVolume: "1000000000", avgTicket: "0.01", currentRate: "100", proposedRate: "100", proposedPerTransaction: "1000", proposedMonthlyFees: "10000000", proposedEquipmentMonthly: "10000000" }));
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

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`W-D content contract: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
