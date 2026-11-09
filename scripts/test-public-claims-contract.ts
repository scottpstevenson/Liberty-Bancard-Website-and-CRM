#!/usr/bin/env npx tsx
/**
 * test-public-claims-contract.ts
 *
 * Static, deterministic contract suite for the public truth-and-terms claims
 * (equipment/contract terms, timing, statement review, 0% program,
 * integrations, competitor pricing).
 *
 * No server, no database, no provider I/O, no network. It loads the shared
 * claim modules, calls the server-side HTML builders directly, scans source
 * files and (when present) the built client bundle.
 *
 * Every check family has a negative control: a deliberately broken fixture
 * that the same check function must reject.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  PUBLIC_CLAIM_RECORDS,
  ALL_CLAIM_PLACEMENTS,
  ClaimLookupError,
  claimText,
  compareCosts,
  createClaimSelector,
  publicClaims,
  renderableSavingsUsd,
  validateClaimRecords,
  type CostInput,
  type PublicClaimRecord,
} from "../shared/public-claims";
import {
  CHANNEL_LABELS,
  PRICE_CHECKED_ON,
  PRICE_RECORDS,
  describePriceRecord,
  formatQualifier,
  formatRateLabel,
  priceRecordsFor,
  validatePriceRecords,
  type PriceRecord,
} from "../shared/competitor-pricing";
import {
  COMPARE_ENTRIES,
  COMPARE_METHOD_NOTE,
  COMPARE_SLUGS,
  RATES_PAGE,
  describeRecord,
} from "../shared/compare-content";
import {
  INTEGRATION_RECORDS,
  INTEGRATIONS_META,
  INTEGRATIONS_CALLOUT,
  INTEGRATIONS_HERO,
  INTEGRATIONS_PROCESS,
  showsActiveCheck,
  type IntegrationRecord,
} from "../shared/integrations-content";
import {
  FST_ELIGIBILITY,
  FST_EQUIPMENT_TERMS_DISCLOSURE,
  FST_PLACEMENT_CLAIM,
  FST_TIMING_NOTE,
  fstFaqItems,
} from "../shared/free-smart-terminal-content";
import {
  FSR_COST,
  FSR_HANDLING,
  FSR_META,
  FSR_SSR_CARDS,
  FSR_SSR_CTA,
} from "../shared/free-statement-review-content";
import {
  ZP_FAQ,
  ZP_HOME_DESCRIPTION,
  ZP_HOME_PROGRAMS,
  ZP_HOME_SSR,
  ZP_META,
  ZP_SSR,
  ZP_SURCHARGE,
} from "../shared/zero-percent-content";
import { EQUIPMENT_TERMS_LABEL, PROMO_ATTRIBUTION_CODE, REVIEW_OFFER, SHOP_TERMS_CARD } from "../shared/public-offers";
import { FOOTER_COMPLIANCE, FOOTER_DISCLAIMER, TIMING_NOTE } from "../shared/public-disclosures";
import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import {
  CLAIM_EVIDENCE,
  CLAIM_EVIDENCE_KEYS,
  OWNER_EVIDENCE_REGISTER,
  PRIVATE_BUNDLE_MARKERS,
} from "../server/data/public-claim-evidence";
import * as pagesSsr from "../server/ssr/pages";
import { COMPETITOR_DATA, getCompareHtml } from "../server/ssr/compare";
import { getHomeHtml } from "../server/ssr/home";
import { getAboutContactHtml } from "../server/ssr/about-contact";
import { getOverviewPageHtml } from "../server/ssr/overview-pages";
import { getIndustryHtml } from "../server/ssr/industries";
import { getIndustriesHubHtml } from "../server/ssr/industries-hub";
import {
  PUBLIC_NAV_CTA,
  PUBLIC_NAV_GROUPS,
  PUBLIC_NAV_UTILITIES,
  PUBLIC_NAV_UTILITY,
  isHomeAnchor,
} from "../shared/public-navigation";
import {
  HOME_FOUNDER,
  HOME_HERO,
  HOME_SAMPLE_REVIEW,
  HOME_SECTION_ORDER,
  HOME_SOLUTIONS,
  HOME_SOLUTIONS_ANCHOR,
  HOME_STARTING_POINTS,
} from "../shared/public-home-content";
import { INDUSTRIES_HUB, NAV_INDUSTRY_SLUGS, PUBLIC_INDUSTRIES, industryHref } from "../shared/public-industries";
import { ABOUT_CONTACT_BOOKING_LABEL, ABOUT_CONTACT_HERO, ABOUT_CONTACT_INTENTS, PUBLIC_CONTACT_CHANNELS } from "../shared/public-contact-content";
import { OVERVIEW_PAGES } from "../shared/public-overview-pages";
import { INDUSTRY_SLUGS } from "../shared/blog-slugs";
import {
  getAvailableCompetitorSlugs,
  renderAlternativesHtml,
  renderSwitchFromHtml,
} from "../server/ssr/competitor-ssr";
import { ssrFooter, ssrNavbar } from "../server/ssrShared";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Harness ──────────────────────────────────────────────────────────────────

let assertions = 0;
let negativeControls = 0;
const failures: string[] = [];
const families = new Map<string, { assertions: number; negatives: number }>();
let currentFamily = "";

function family(name: string, fn: () => void): void {
  currentFamily = name;
  families.set(name, { assertions: 0, negatives: 0 });
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: threw ${(error as Error).message}`);
    console.error(`  FAIL ${name}: threw ${(error as Error).stack ?? (error as Error).message}`);
  }
}

function ok(condition: boolean, message: string): void {
  assertions += 1;
  families.get(currentFamily)!.assertions += 1;
  if (!condition) {
    failures.push(`${currentFamily}: ${message}`);
    console.error(`  FAIL [${currentFamily}] ${message}`);
  }
}

/** A check function throws when its invariant is violated. */
function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function passes(name: string, check: () => void): void {
  let error: Error | null = null;
  try {
    check();
  } catch (e) {
    error = e as Error;
  }
  ok(error === null, `${name}${error ? ` — ${error.message}` : ""}`);
}

/** The check must reject the broken fixture; if it does not, the check is not effective. */
function negative(name: string, check: () => void): void {
  negativeControls += 1;
  families.get(currentFamily)!.negatives += 1;
  let rejected = false;
  try {
    check();
  } catch {
    rejected = true;
  }
  ok(rejected, `negative control not detected: ${name}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function decode(html: string): string {
  return html
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ");
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Remove full-line comments and block comments so documentation never trips a scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ── Rendered public output ───────────────────────────────────────────────────

const pageFn = (name: string): (() => string) => {
  const fn = (pagesSsr as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`Missing SSR builder: ${name}`);
  return fn as () => string;
};

/** Routes this work owns, with their server-rendered output. */
const OWNED_HTML: Record<string, string> = {
  "/free-smart-terminal": pageFn("getFreeSmartTerminalHtml")(),
  "/upload-statement": pageFn("getUploadStatementHtml")(),
  "/0-percent-processing": pageFn("getZeroPercentHtml")(),
  "/integrations": pageFn("getIntegrationsHtml")(),
  "/compare-rates": pageFn("getCompareRatesHtml")(),
  "/beat-square-stripe": pageFn("getBeatSquareStripeHtml")(),
  "/faq": pageFn("getFaqHtml")(),
  "/get-started": pageFn("getGetStartedHtml")(),
  "/why-liberty": pageFn("getWhyLibertyHtml")(),
  "/free-analysis": pageFn("getFreeAnalysisHtml")(),
  "/": getHomeHtml(),
  "/about-contact": getAboutContactHtml(),
  "/industries": getIndustriesHubHtml(),
};
for (const page of OVERVIEW_PAGES) OWNED_HTML[page.path] = getOverviewPageHtml(page);
for (const slug of COMPARE_SLUGS) {
  const html = getCompareHtml(slug);
  if (html) OWNED_HTML[`/compare/${slug}`] = html;
}
for (const slug of getAvailableCompetitorSlugs()) {
  OWNED_HTML[`/alternatives/${slug}`] = renderAlternativesHtml(slug);
  OWNED_HTML[`/switch-from/${slug}`] = renderSwitchFromHtml(slug);
}
OWNED_HTML["/industries/restaurant-payment-processing"] = getIndustryHtml("restaurant-payment-processing") ?? "";

const OWNED_ROUTES_META = [
  "/upload-statement",
  "/0-percent-processing",
  "/integrations",
  "/free-smart-terminal",
  "/compare-rates",
  "/beat-square-stripe",
  "/compare/square",
  "/compare/stripe",
  "/compare/clover",
  "/compare/toast",
  "/compare/paypal",
];

// ── Retired assertions ───────────────────────────────────────────────────────

interface RetiredPattern {
  id: string;
  re: RegExp;
}

const RETIRED_PATTERNS: readonly RetiredPattern[] = [
  { id: "month-to-month", re: /month-to-month/i },
  { id: "no-etf", re: /early termination fee:?\s*none/i },
  { id: "own-equipment", re: /you own your equipment/i },
  { id: "zero-lock-in", re: /0 lock-?in|no ecosystem lock-?in|no lock-?in\b/i },
  { id: "48-hours", re: /\b48[- ]hours?\b|ready to go in 48/i },
  { id: "same-day", re: /same[- ](business[- ])?day (review|analysis|results)|usually the same day|the same business day|completed the same day/i },
  { id: "one-business-day", re: /\b(one|1)[- ]business[- ]day|\b\d[–-]\d business days|within 24[–-]48 hours/i },
  { id: "all-50-states", re: /legal in all 50 states/i },
  { id: "never-shared", re: /never (be )?(sold|shared)|do not share your statement outside/i },
  { id: "square-stale-rate", re: /2\.6%\s*\+\s*(\$0\.10|10¢)/ },
  { id: "invented-liberty-rate", re: /0\.15[-–]0\.40%|0\.20% markup|\+ \$0\.07|interchange \+ 0\.15/i },
  { id: "savings-range", re: /\$2,000[-–]\$6,000|\$600[-–]\$3,200|\$3,000[-–]\$8,000|\$3,000[-–]\$7,000|\$2,000[-–]\$5,000/ },
  { id: "no-upfront", re: /no upfront cost|at no upfront/i },
  {
    id: "contract-term-assertion",
    re: /most programs have no long-term|no long-term contracts? (required|needed)|no contract (required|lock-?in)|early termination fee \(\$|no-etf options|no early termination risk/i,
  },
  {
    id: "free-equipment-assertion",
    re: /free for qualifying merchants|free equipment (for|with)|no terminal lease required|equipment at no additional cost|terminal (equipment )?is free/i,
  },
  { id: "platform-count", re: /20\+ (compatible )?platforms/i },
  { id: "next-day-universal", re: /qualified merchants (can )?receive next-day|receive deposits by the next business day|wholesale pricing, next-day funding|>\s*next-day funding\s*<|name: "next-day funding"|cash discount programs, next-day funding|what is next-day funding|following business day, instead of the standard/i },
  { id: "pay-zero", re: /pay \$0 to (process|accept)|\$0 out of your revenue/i },
  { id: "fee-bypass", re: /bypass shopify payments/i },
  { id: "liberty-assumed-savings", re: /saves? (you |merchants )?\$[\d,]+/i },
  { id: "review-schema", re: /"@type":\s*"(Review|AggregateRating)"|aggregateRating|reviewRating/ },
  { id: "free-processing-offer", re: /qualify for free processing|free processing(?! (analysis|review|savings))/i },
  {
    id: "eliminate-processing-fees",
    re: /eliminat\w* (your |all |my )?(card |credit card )?processing (costs|fees)|eliminat\w* (my |your )?credit card fees|eliminate card processing fees/i,
  },
  { id: "near-zero-processing", re: /near[- ]zero processing|processing (costs? )?(to )?near zero|net processing to near zero/i },
  { id: "no-lease-assertion", re: /no leases\.?\s*ever|never lease|we never lease/i },
  { id: "free-placement", re: /free placement/i },
  { id: "zero-monthly-equipment", re: /\$0\s*\/\s*mo\b/i },
  { id: "authorize-two-vendors", re: /two vendors|two billing relationships|requires a separate payment processor/i },
  { id: "single-gateway-billing", re: /one billing relationship|single provider for processing and gateway|no separate gateway layer/i },
  { id: "debit-ambiguous", re: /debit cards? (are|is) treated differently|credit, debit and prepaid cards are treated differently/i },
  { id: "internal-margin", re: /liberty margin|auto-approve|mgr approval|rep discretion/i },
];

/** Files and rendered routes that must be free of every retired assertion. */
const CONSUMER_SOURCES: readonly string[] = [
  "client/src/pages/FreeSmartTerminal.tsx",
  "client/src/pages/UploadStatement.tsx",
  "client/src/pages/ZeroPercent.tsx",
  "client/src/pages/Integrations.tsx",
  "client/src/pages/CompareVs.tsx",
  "client/src/pages/RateComparison.tsx",
  "client/src/pages/BeatSquareStripe.tsx",
  "client/src/pages/FAQ.tsx",
  "client/src/pages/GetStarted.tsx",
  "client/src/pages/TerminalShop.tsx",
  "client/src/pages/ThanksStatement.tsx",
  "client/src/pages/MerchantStatementUpload.tsx",
  "client/src/pages/IndustryPage.tsx",
  "client/src/pages/FreeAnalysis.tsx",
  "client/src/components/SEO.tsx",
  "client/src/components/PromoBanner.tsx",
  "client/src/pages/WhyLiberty.tsx",
  "client/src/pages/AboutContact.tsx",
  "client/src/pages/HelpCenter.tsx",
  "client/src/pages/PartnerBrandedPage.tsx",
  "client/src/pages/MerchantApplication.tsx",
  "client/src/pages/SavingsCalculator.tsx",
  "client/src/components/Footer.tsx",
  "client/src/components/Navbar.tsx",
  "client/src/components/home/HomeProcess.tsx",
  "client/src/components/public/OverviewPageView.tsx",
  "client/src/pages/PaymentProcessing.tsx",
  "client/src/pages/PricingPrograms.tsx",
  "shared/public-overview-pages.ts",
  "server/ssr/overview-pages.ts",
  "server/ssr/about-contact.ts",
  "client/src/components/home/HomeFaq.tsx",
  "client/src/components/home/HomeFinal.tsx",
  "client/src/components/home/home-content.ts",
  "client/src/components/home/HomeHero.tsx",
  "client/src/components/home/HomeSolutions.tsx",
  "client/src/components/home/HomeFounder.tsx",
  "client/src/components/home/HomeStartingPoints.tsx",
  "client/src/components/home/HomeIndustries.tsx",
  "client/src/components/home/SampleReviewCard.tsx",
  "client/src/pages/Industries.tsx",
  "shared/public-home-content.ts",
  "shared/public-navigation.ts",
  "shared/public-industries.ts",
  "shared/public-contact-content.ts",
  "server/ssr/industries-hub.ts",
  "shared/public-claims.ts",
  "shared/public-disclosures.ts",
  "shared/free-smart-terminal-content.ts",
  "shared/free-statement-review-content.ts",
  "shared/zero-percent-content.ts",
  "shared/integrations-content.ts",
  "shared/competitor-pricing.ts",
  "shared/compare-content.ts",
  "shared/public-offers.ts",
  "shared/seo-routes.ts",
  "server/ssrShared.ts",
  "server/ssr/home.ts",
  "server/ssr/compare.ts",
  "server/ssr/competitor-ssr.ts",
  "server/ssr/industries.ts",
];

/**
 * Per-site allowlist. Each entry names a file, the pattern id and the exact
 * substring that may remain, with the reason. Everything else fails.
 */
const ALLOWLIST: readonly { file: string; pattern: string; contains: string; reason: string }[] = [
  {
    file: "client/src/components/SEO.tsx",
    pattern: "review-schema",
    contains: "aggregateRating?:",
    reason: "Optional prop type on the shared SEO component; owned routes do not pass it (checked by the rendered-output scans).",
  },
  {
    file: "client/src/pages/FreeAnalysis.tsx",
    pattern: "eliminate-processing-fees",
    contains: "completely eliminated my credit card fees",
    reason: "Customer testimonial quote on the Free Analysis page. Testimonials, their outcomes and their consent are the W-D proof work (OE-08) and remain a documented handoff; Liberty-voice copy on the page is clean.",
  },
  {
    file: "client/src/pages/IndustryPage.tsx",
    pattern: "savings-range",
    contains: "orthodontics can run",
    reason: "Dental ticket-size example in an industry narrative; a transaction amount, not a savings or Liberty cost claim.",
  },
];

function scanText(text: string): { id: string; excerpt: string }[] {
  const hits: { id: string; excerpt: string }[] = [];
  for (const pattern of RETIRED_PATTERNS) {
    const match = pattern.re.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 30);
      hits.push({ id: pattern.id, excerpt: text.slice(start, match.index + match[0].length + 30).replace(/\s+/g, " ") });
    }
  }
  return hits;
}

function allowed(file: string, hit: { id: string; excerpt: string }): boolean {
  return ALLOWLIST.some(
    (entry) => entry.file === file && entry.contains !== "" && (entry.pattern === "*" || entry.pattern === hit.id) && hit.excerpt.includes(entry.contains),
  );
}

/** Claim ids are identifiers, not published wording; remove them before scanning the register itself. */
function withoutIdentifiers(file: string, source: string): string {
  return file === "shared/public-claims.ts" ? source.replace(/"[a-z0-9-]+(\.[a-z0-9-]+)+"/g, '""') : source;
}

function assertSourceClean(file: string, source: string): void {
  const hits = scanText(withoutIdentifiers(file, stripComments(source))).filter((hit) => !allowed(file, hit));
  ensure(hits.length === 0, `${file} contains retired assertion(s): ${hits.map((h) => `${h.id} «${h.excerpt}»`).join("; ")}`);
}

function assertHtmlClean(route: string, html: string): void {
  const hits = scanText(decode(html).replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, ""));
  ensure(hits.length === 0, `${route} renders retired assertion(s): ${hits.map((h) => `${h.id} «${h.excerpt}»`).join("; ")}`);
}

// ═════════════════════════════════════════════════════════════════════════════

console.log("Public claims contract suite");

family("claim-register", () => {
  const problems = validateClaimRecords(PUBLIC_CLAIM_RECORDS, CLAIM_EVIDENCE_KEYS);
  ok(problems.length === 0, `register problems: ${JSON.stringify(problems)}`);
  ok(PUBLIC_CLAIM_RECORDS.some((r) => r.disposition === "approved"), "register has approved claims");
  ok(PUBLIC_CLAIM_RECORDS.some((r) => r.disposition === "withheld"), "register has withheld claims");
  ok(PUBLIC_CLAIM_RECORDS.some((r) => r.disposition === "retired"), "register has retired claims");

  const check = (records: readonly PublicClaimRecord[]) => {
    const found = validateClaimRecords(records, CLAIM_EVIDENCE_KEYS);
    ensure(found.length === 0, JSON.stringify(found));
  };
  negative("approved claim without evidence key", () =>
    check([{ id: "x.y", version: 1, family: "equipment", disposition: "approved", text: "Wording", placements: ["page"], evidenceKey: "", reviewedOn: "2026-11-08" }]),
  );
  negative("approved claim with unknown evidence key", () =>
    check([{ id: "x.y", version: 1, family: "equipment", disposition: "approved", text: "Wording", placements: ["page"], evidenceKey: "EV-NOPE", reviewedOn: "2026-11-08" }]),
  );
  negative("held claim carrying wording", () =>
    check([{ id: "x.y", version: 1, family: "equipment", disposition: "retired", fallbackId: null, text: "Old promise", reviewedOn: "2026-11-08" } as unknown as PublicClaimRecord]),
  );
  negative("fallback that does not exist", () =>
    check([{ id: "x.y", version: 1, family: "equipment", disposition: "withheld", fallbackId: "missing.id", reviewedOn: "2026-11-08" }]),
  );
});

family("selector-suppression", () => {
  const records: PublicClaimRecord[] = [
    { id: "t.safe", version: 1, family: "equipment", disposition: "approved", text: "Safe wording", placements: ["page", "faq"], evidenceKey: "EV-WA-CONTRACT-SAFE-WORDING", reviewedOn: "2026-11-08" },
    { id: "t.withheld", version: 1, family: "equipment", disposition: "withheld", fallbackId: null, reviewedOn: "2026-11-08" },
    { id: "t.retired", version: 1, family: "equipment", disposition: "retired", fallbackId: "t.safe", reviewedOn: "2026-11-08" },
  ];
  const selector = createClaimSelector(records);
  for (const placement of ALL_CLAIM_PLACEMENTS) {
    ok(selector.textOrNull("t.withheld", placement) === null, `withheld claim shows nothing at ${placement}`);
  }
  ok(selector.textOrNull("t.retired", "page") === "Safe wording", "retired claim resolves to its approved fallback");
  ok(selector.textOrNull("t.retired", "meta") === null, "fallback honours the approved placements");
  ok(selector.textOrNull("t.safe", "footer") === null, "approved claim hidden at a placement it is not approved for");
  let threw = false;
  try {
    selector.text("t.withheld");
  } catch (error) {
    threw = error instanceof ClaimLookupError;
  }
  ok(threw, "required copy lookup of a withheld claim throws");

  // Production register: no held id can ever resolve to anything but its approved fallback.
  for (const record of PUBLIC_CLAIM_RECORDS) {
    if (record.disposition === "approved") continue;
    for (const placement of ALL_CLAIM_PLACEMENTS) {
      const resolved = publicClaims.textOrNull(record.id, placement);
      const fallback = record.fallbackId ? publicClaims.textOrNull(record.fallbackId, placement) : null;
      ok(resolved === fallback, `${record.id} at ${placement} resolves only to its fallback`);
    }
  }

  ok(publicClaims.disposition("equipment.placement.no-upfront") === "withheld", "no-upfront placement stays withheld");
  ok(FST_PLACEMENT_CLAIM === null, "terminal page shows no placement claim while withheld");
  ok(!/\bfree\b|upfront/i.test(FST_EQUIPMENT_TERMS_DISCLOSURE), "equipment disclosure makes no free/no-upfront assertion");

  // Negative control: a selector that ignores disposition must be detected.
  const leaky = (id: string) => (records.find((r) => r.id === id) as { text?: string } | undefined)?.text ?? "LEAKED";
  negative("selector that renders withheld wording", () => ensure(leaky("t.withheld") === null, "withheld claim rendered"));
});

family("no-internal-labels", () => {
  const INTERNAL = /EV-WA-|evidenceKey|fallbackId|disposition|originalWording|OE-\d\d|LB-CS-0\d|withheld claim|retired claim/;
  const check = (label: string, text: string) => ensure(!INTERNAL.test(decode(text)), `${label} exposes an internal label`);
  for (const [route, html] of Object.entries(OWNED_HTML)) {
    passes(`${route} has no internal labels`, () => check(route, html.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "")));
  }
  for (const claim of PUBLIC_CLAIM_RECORDS) {
    if (claim.disposition === "approved") {
      passes(`${claim.id} wording has no internal label`, () => check(claim.id, claim.text));
    }
  }
  negative("rendered page carrying an evidence key", () => check("fixture", `${OWNED_HTML["/upload-statement"]}<p>EV-WA-CONTRACT-SAFE-WORDING</p>`));
  negative("rendered page carrying a disposition word", () => check("fixture", `<p>claim disposition: retired</p>`));
});

family("renderer-parity", () => {
  const html = (route: string) => decode(OWNED_HTML[route] ?? "");
  const mustContain = (route: string, text: string, label: string, source = html(route)) =>
    ensure(source.includes(decode(norm(text))), `${route} server HTML is missing ${label}`);

  const expectations: { route: string; label: string; text: string }[] = [
    ...fstFaqItems.map((item, i) => ({ route: "/free-smart-terminal", label: `terminal FAQ answer ${i + 1}`, text: item.answer })),
    { route: "/free-smart-terminal", label: "terminal eligibility intro", text: FST_ELIGIBILITY.intro },
    { route: "/free-smart-terminal", label: "terminal timing note", text: FST_TIMING_NOTE },
    { route: "/upload-statement", label: "statement handling text", text: FSR_HANDLING.text },
    { route: "/upload-statement", label: "statement cost text", text: FSR_COST.text },
    { route: "/upload-statement", label: "statement CTA body", text: FSR_SSR_CTA.body },
    ...FSR_SSR_CARDS.map((card, i) => ({ route: "/upload-statement", label: `statement card ${i + 1}`, text: card.text })),
    ...ZP_FAQ.map((item, i) => ({ route: "/0-percent-processing", label: `program FAQ answer ${i + 1}`, text: item.answer })),
    { route: "/0-percent-processing", label: "program heading", text: ZP_SSR.h1 },
    { route: "/integrations", label: "hero text", text: INTEGRATIONS_HERO.sub },
    { route: "/integrations", label: "callout text", text: INTEGRATIONS_CALLOUT.text },
    ...INTEGRATIONS_PROCESS.steps.map((step, i) => ({ route: "/integrations", label: `process step ${i + 1}`, text: step.text })),
    { route: "/compare/square", label: "comparison method note", text: COMPARE_METHOD_NOTE },
    ...COMPARE_ENTRIES["square"].records.map((record) => ({ route: "/compare/square", label: `Square record ${record.id}`, text: describeRecord(record) })),
    { route: "/compare-rates", label: "rates page title", text: RATES_PAGE.title },
  ];
  for (const e of expectations) passes(`${e.route} · ${e.label}`, () => mustContain(e.route, e.text, e.label));

  // Shared footer disclosure is emitted by the server shell exactly as the React footer reads it.
  const footerHtml = decode(ssrFooter());
  for (const line of [...FOOTER_DISCLAIMER_LINES(), ...FOOTER_COMPLIANCE_LINES()]) {
    passes(`server footer carries "${line.slice(0, 40)}…"`, () => ensure(footerHtml.includes(decode(norm(line))), "missing"));
  }

  // The React side must read the same shared selectors.
  const reactImports: { file: string; module: string; symbols: string[] }[] = [
    { file: "client/src/pages/FreeSmartTerminal.tsx", module: "@shared/free-smart-terminal-content", symbols: ["fstFaqItems"] },
    { file: "client/src/pages/UploadStatement.tsx", module: "@shared/free-statement-review-content", symbols: ["FSR_HERO", "FSR_NEXT_NOTE", "FSR_FAQ", "FSR_PROCESS"] },
    { file: "client/src/pages/ZeroPercent.tsx", module: "@shared/zero-percent-content", symbols: ["ZP_FAQ"] },
    { file: "client/src/pages/Integrations.tsx", module: "@shared/integrations-content", symbols: ["INTEGRATIONS_PROCESS", "showsActiveCheck"] },
    { file: "client/src/pages/CompareVs.tsx", module: "@shared/compare-content", symbols: ["getCompareEntry", "methodNote"] },
    { file: "client/src/pages/RateComparison.tsx", module: "@shared/compare-content", symbols: ["RATES_PAGE"] },
    { file: "client/src/components/Footer.tsx", module: "@shared/public-disclosures", symbols: ["FOOTER_DISCLAIMER", "FOOTER_COMPLIANCE"] },
  ];
  for (const { file, module, symbols } of reactImports) {
    const source = read(file);
    passes(`${file} imports ${module}`, () => ensure(source.includes(`"${module}"`), `no import of ${module}`));
    for (const symbol of symbols) passes(`${file} uses ${symbol}`, () => ensure(new RegExp(`\\b${symbol}\\b`).test(source), `${symbol} not referenced`));
  }
  const ssrImports = [
    { file: "server/ssr/pages.ts", modules: ["free-smart-terminal-content", "free-statement-review-content", "zero-percent-content", "integrations-content", "compare-content"] },
    { file: "server/ssr/compare.ts", modules: ["compare-content", "competitor-pricing"] },
    { file: "server/ssr/competitor-ssr.ts", modules: ["compare-content", "competitor-pricing", "public-disclosures"] },
    { file: "server/ssrShared.ts", modules: ["public-disclosures"] },
  ];
  for (const { file, modules } of ssrImports) {
    const source = read(file);
    for (const module of modules) passes(`${file} imports shared ${module}`, () => ensure(new RegExp(`shared/${module}"`).test(source), "no import"));
  }

  // Negative controls: alter one renderer's string and the parity check must fail.
  negative("server HTML with a different statement-handling sentence", () =>
    mustContain("/upload-statement", FSR_HANDLING.text, "handling", decode(OWNED_HTML["/upload-statement"]).split(decode(norm(FSR_HANDLING.text))).join("Your statement is never sold or shared.")),
  );
  negative("server HTML with an altered terminal FAQ answer", () =>
    mustContain("/free-smart-terminal", fstFaqItems[0].answer, "faq", decode(OWNED_HTML["/free-smart-terminal"]).split(decode(norm(fstFaqItems[0].answer))).join("Month-to-month, no contracts.")),
  );
});

function FOOTER_DISCLAIMER_LINES(): string[] {
  return Array.isArray(FOOTER_DISCLAIMER) ? (FOOTER_DISCLAIMER as readonly string[]).map(String) : [String(FOOTER_DISCLAIMER)];
}
function FOOTER_COMPLIANCE_LINES(): string[] {
  return Array.isArray(FOOTER_COMPLIANCE) ? (FOOTER_COMPLIANCE as readonly string[]).map(String) : [String(FOOTER_COMPLIANCE)];
}

family("inventory-scan", () => {
  for (const file of CONSUMER_SOURCES) {
    passes(`${file} has no retired assertion`, () => assertSourceClean(file, read(file)));
  }
  for (const [route, html] of Object.entries(OWNED_HTML)) {
    passes(`${route} server HTML has no retired assertion`, () => assertHtmlClean(route, html));
  }
  passes("server navigation has no retired assertion", () => assertHtmlClean("ssrNavbar", ssrNavbar()));

  // Negative controls: an old hardcoded assertion added anywhere in the inventory must be caught.
  negative("old 48-hour assertion added to a React consumer", () =>
    assertSourceClean("client/src/pages/FreeSmartTerminal.tsx", `${read("client/src/pages/FreeSmartTerminal.tsx")}\nconst x = "Setup in as little as 48 hours";`),
  );
  negative("no-long-term-contract assertion added to a React consumer", () =>
    assertSourceClean("client/src/pages/GetStarted.tsx", `${read("client/src/pages/GetStarted.tsx")}\nconst z = "Most Programs Have No Long-Term Contract.";`),
  );
  negative("free-equipment assertion added to a React consumer", () =>
    assertSourceClean("client/src/pages/SavingsCalculator.tsx", `${read("client/src/pages/SavingsCalculator.tsx")}\nconst w = "Free equipment for qualifying merchants";`),
  );
  negative("site-wide schema description with a universal next-day funding claim", () =>
    assertSourceClean("client/src/components/SEO.tsx", `${read("client/src/components/SEO.tsx")}\nconst d = "Wholesale pricing, next-day funding, and real human support.";`),
  );
  negative("month-to-month assertion added to a shared module", () =>
    assertSourceClean("shared/compare-content.ts", `${read("shared/compare-content.ts")}\nexport const y = "Month-to-month agreement";`),
  );
  negative("stale Square rate added to rendered HTML", () => assertHtmlClean("/compare/square", `${OWNED_HTML["/compare/square"]}<p>Square charges 2.6% + $0.10</p>`));
  negative("invented Liberty markup added to rendered HTML", () => assertHtmlClean("/compare-rates", `${OWNED_HTML["/compare-rates"]}<td>Interchange + 0.15-0.40%</td>`));
  negative("never-shared assertion added to rendered HTML", () => assertHtmlClean("/upload-statement", `${OWNED_HTML["/upload-statement"]}<p>Your statement is never sold or shared.</p>`));
  negative("savings range added to metadata text", () => ensure(scanText("saves $2,000-$6,000/year over Square").length === 0, "retired savings range"));
});

family("square-record", () => {
  const square = priceRecordsFor("square");
  ok(square.length >= 2, "Square has in-person and online records");
  ok(validatePriceRecords().length === 0, `price records valid: ${JSON.stringify(validatePriceRecords())}`);

  const assertSquareCurrent = (records: readonly PriceRecord[]) => {
    const inPerson = records.find((r) => r.provider === "square" && r.channel === "in-person");
    ensure(Boolean(inPerson), "no Square in-person record");
    const r = inPerson as PriceRecord;
    ensure(r.percent === 2.6 && r.fixedFeeCents === 15, "Square in-person rate is not the checked 2.6% + 15¢");
    ensure(r.currency === "USD", "currency missing");
    ensure(Boolean(r.plan) && Boolean(r.product), "plan/product missing");
    ensure(/^https:\/\/(www\.)?squareup\.com\//.test(r.sourceUrl), "source is not an official Square URL");
    ensure(/^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn), "checked date missing");
    ensure(r.checkedOn === PRICE_CHECKED_ON, "record checked date differs from the release check date");
  };
  passes("Square in-person record is complete and current", () => assertSquareCurrent(PRICE_RECORDS));
  passes("every price record is dated and has an https source", () => ensure(validatePriceRecords().length === 0, "invalid"));

  const base = square.find((r) => r.channel === "in-person") as PriceRecord;
  negative("Square record without a source", () => assertSquareCurrent([{ ...base, sourceUrl: "" }]));
  negative("Square record without a checked date", () => assertSquareCurrent([{ ...base, checkedOn: "" }]));
  negative("Square record with the stale 10¢ fee", () => assertSquareCurrent([{ ...base, fixedFeeCents: 10 }]));
  negative("price record validator on an unsourced record", () => {
    const problems = validatePriceRecords([{ ...base, id: "bad", sourceUrl: "" }]);
    ensure(problems.length === 0, "unsourced record accepted");
  });

  ok(COMPARE_SLUGS.length === 7, "seven comparison slugs");
  for (const slug of COMPARE_SLUGS) {
    const entry = COMPARE_ENTRIES[slug];
    ok(entry.records.length > 0 || Boolean(entry.unpublishedNote), `${slug} has dated records or an explicit unpublished note`);
  }
  ok(COMPARE_ENTRIES["toast"].records.length === 0 && Boolean(COMPARE_ENTRIES["toast"].unpublishedNote), "Toast shows no unverifiable rate");
});

family("unknown-cost-handling", () => {
  const known: CostInput[] = [
    { label: "Processing", monthlyUsd: 300, material: true },
    { label: "Monthly fee", monthlyUsd: 25, material: true },
  ];
  const withUnknown: CostInput[] = [...known, { label: "PCI fee", monthlyUsd: null, material: true }];
  ok(compareCosts(known).complete, "all-known inputs are complete");
  ok(!compareCosts(withUnknown).complete, "an unknown material cost makes the comparison incomplete");
  ok(compareCosts(withUnknown).unknownLabels.includes("PCI fee"), "the unknown cost is named");
  ok(renderableSavingsUsd(compareCosts(withUnknown), compareCosts(known)) === null, "no savings figure with an unknown cost on either side");
  ok(renderableSavingsUsd(compareCosts(known), compareCosts(withUnknown)) === null, "no savings figure when the other side is unknown");
  ok(renderableSavingsUsd(compareCosts(known), compareCosts([{ label: "Processing", monthlyUsd: 250, material: true }])) === 75, "complete inputs produce an exact figure");
  ok(compareCosts([{ label: "Optional", monthlyUsd: null, material: false }]).complete, "an unknown non-material cost does not block");

  const assertNoCompleteSavings = (render: (a: CostInput[], b: CostInput[]) => number | null) =>
    ensure(render(withUnknown, known) === null, "a complete savings figure was rendered with an unknown cost");
  passes("production renderer withholds the figure", () => assertNoCompleteSavings((a, b) => renderableSavingsUsd(compareCosts(a), compareCosts(b))));
  negative("renderer that ignores unknown costs", () => assertNoCompleteSavings((a, b) => compareCosts(a).includedUsd - compareCosts(b).includedUsd));
});

family("metadata-and-schema", () => {
  for (const route of OWNED_ROUTES_META) {
    const def = SEO_ROUTE_DEFAULTS[route];
    ok(Boolean(def), `${route} has route metadata`);
    if (!def) continue;
    ok(def.title.length >= 30 && def.title.length <= 70, `${route} title length ${def.title.length}`);
    ok(def.description.length >= 100 && def.description.length <= 165, `${route} description length ${def.description.length}`);
    const hits = scanText(`${def.title} ${def.description} ${def.keywords ?? ""}`);
    ok(hits.length === 0, `${route} metadata carries a retired assertion: ${hits.map((h) => h.id).join(",")}`);
  }
  ok(SEO_ROUTE_DEFAULTS["/upload-statement"].description === FSR_META.description, "upload metadata derives from the shared record");
  ok(SEO_ROUTE_DEFAULTS["/0-percent-processing"].description === ZP_META.description, "program metadata derives from the shared record");
  ok(SEO_ROUTE_DEFAULTS["/integrations"].description === INTEGRATIONS_META.description, "integrations metadata derives from the shared record");

  const reviewFree = (label: string, text: string) => ensure(!/"@type":\s*"(Review|AggregateRating)"|aggregateRating|reviewRating|"@type":\s*"Review"/i.test(text), `${label} emits Review/AggregateRating schema`);
  for (const [route, html] of Object.entries(OWNED_HTML)) passes(`${route} server HTML has no Review/AggregateRating`, () => reviewFree(route, decode(html)));
  for (const file of ["FreeSmartTerminal", "UploadStatement", "ZeroPercent", "Integrations", "CompareVs", "RateComparison", "BeatSquareStripe", "FAQ"]) {
    passes(`${file}.tsx emits no Review/AggregateRating`, () => reviewFree(file, read(`client/src/pages/${file}.tsx`)));
  }
  negative("Review schema added to a React page", () => reviewFree("fixture", `${read("client/src/pages/CompareVs.tsx")}\nconst s = { "@type": "Review", reviewRating: 5 };`));
  negative("AggregateRating added to server HTML", () => reviewFree("fixture", `${decode(OWNED_HTML["/compare/square"])}"aggregateRating":{"ratingValue":"5.0"}`));
  negative("withdrawn phrase reintroduced in metadata only", () => {
    const hits = scanText(`${SEO_ROUTE_DEFAULTS["/compare/square"].description} saves businesses $2,000-$6,000/year`);
    ensure(hits.length === 0, "withdrawn phrase present in metadata");
  });
});

family("compatibility-states", () => {
  ok(INTEGRATION_RECORDS.length > 0, "integration records exist");
  const validate = (records: readonly IntegrationRecord[]) => {
    for (const record of records) {
      if (record.state === "confirmed") ensure(Boolean(record.evidenceKey) && Boolean(record.path), `${record.id} is confirmed without evidence or path`);
      else ensure(!showsActiveCheck(record), `${record.id} shows an active check while ${record.state}`);
      ensure(!/bypass|avoid .*fees|save \$|keep (the|your) .* interface/i.test(`${record.summary} ${record.askAbout} ${record.path ?? ""} ${record.limitation ?? ""}`), `${record.id} carries fee-bypass or keep-your-system wording`);
    }
  };
  passes("every shipped record is valid", () => validate(INTEGRATION_RECORDS));
  ok(INTEGRATION_RECORDS.every((r) => r.state === "inquiry-required"), "every record defaults to inquiry required until evidence exists");
  ok(INTEGRATION_RECORDS.every((r) => !showsActiveCheck(r)), "no record shows an active checkmark");

  const sample = INTEGRATION_RECORDS[0];
  negative("record marked confirmed without evidence", () => validate([{ ...sample, state: "confirmed" }]));
  negative("record with fee-bypass wording", () => validate([{ ...sample, summary: "Bypass Shopify Payments fees and save $3,000 a year." }]));
  passes("integrations HTML shows no platform count or lock-in tile", () => {
    const html = decode(OWNED_HTML["/integrations"]).replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "");
    ensure(!/20\+|lock-?in contracts|bypass/i.test(html), "platform count, lock-in or bypass wording present");
  });
});

// ── Promotion, shop and comparison consumers (post-publish review R01–R03) ───

(globalThis as unknown as { React: typeof React }).React = React;
const { PromoBanner, PromoList } = await import("../client/src/components/PromoBanner");
const renderInRouter = (element: React.ReactElement): string =>
  renderToStaticMarkup(React.createElement(Router, { ssrPath: "/shop" }, element));
const visibleText = (html: string): string => decode(html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'"));

function faqJsonLdAnswers(html: string): string[] {
  const answers: string[] = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes as { "@type"?: string; mainEntity?: { acceptedAnswer?: { text?: string } }[] }[]) {
      if (node?.["@type"] === "FAQPage") for (const q of node.mainEntity ?? []) if (q.acceptedAnswer?.text) answers.push(q.acceptedAnswer.text);
    }
  }
  return answers;
}

family("promotion-consumers", () => {
  const rendered: Record<string, string> = {};
  for (const variant of ["bar", "inline", "card"] as const) {
    rendered[`PromoBanner ${variant}`] = renderInRouter(React.createElement(PromoBanner, { variant, promoId: REVIEW_OFFER.id }));
  }
  rendered["PromoList"] = renderInRouter(React.createElement(PromoList, {}));

  /** The final rendered promotion output: no retired assertion, no visible promotion code. */
  const assertPromoOutput = (label: string, html: string) => {
    const text = visibleText(html);
    const hits = scanText(text);
    ensure(hits.length === 0, `${label} renders retired assertion(s): ${hits.map((h) => `${h.id} «${h.excerpt}»`).join("; ")}`);
    ensure(!new RegExp(PROMO_ATTRIBUTION_CODE, "i").test(text), `${label} displays the promotion code as visible text`);
    ensure(/\$0\s*\/\s*mo|free placement|no leases|never lease/i.test(text) === false, `${label} renders a retired equipment term`);
  };
  for (const [label, html] of Object.entries(rendered)) {
    passes(`${label} renders the shared review offer without retired wording or a visible code`, () => assertPromoOutput(label, html));
    ok(visibleText(html).includes(REVIEW_OFFER.title), `${label} shows the review offer title`);
  }
  ok(rendered["PromoBanner bar"].includes(`href="${REVIEW_OFFER.ctaHref}"`), "bar CTA keeps the attributed free-analysis route");
  ok(rendered["PromoList"].includes('href="/free-analysis?promo=FREE30"'), "list CTA keeps /free-analysis?promo=FREE30 for attribution");
  ok(visibleText(rendered["PromoList"]).includes(claimText("offer.review.inquiry")), "list shows the approved inquiry wording");
  ok(visibleText(rendered["PromoBanner bar"]).includes(claimText("offer.review.short")), "bar shows the approved short wording");

  // Negative controls: each assertion the earlier release missed must be caught when injected into rendered output.
  const injected: [string, string][] = [
    ["free-processing promise in the banner", "See If You Qualify for Free Processing"],
    ["fee-elimination promise in the banner", "Eligible businesses can eliminate card processing fees entirely."],
    ["no-lease assertion in the shop strip", "No Leases. Ever."],
    ["free-placement assertion", "We never lease equipment. Buy outright or qualify for free placement with your processing agreement."],
    ["zero monthly fee with processing", "$0/mo with processing"],
    ["zero monthly fee", "$0/mo"],
    ["promotion code badge", `Use code: ${PROMO_ATTRIBUTION_CODE}`],
  ];
  for (const [name, text] of injected) {
    negative(`${name} injected into rendered output`, () => assertPromoOutput("fixture", `${rendered["PromoList"]}<p>${text}</p>`));
  }

  // Source wiring: shared offer and terms label; routes, attribution and intake preserved.
  const promoSource = stripComments(read("client/src/components/PromoBanner.tsx"));
  ok(promoSource.includes("@shared/public-offers"), "PromoBanner reads the shared offer record");
  ok(!/FREE30|promo\.code|Use code/.test(promoSource), "PromoBanner has no hard-coded code or code badge");
  const shop = stripComments(read("client/src/pages/TerminalShop.tsx"));
  ok(shop.includes("EQUIPMENT_TERMS_LABEL") && shop.includes("SHOP_TERMS_CARD"), "shop reads the shared equipment-terms label and card");
  ok(!/monthlyFee:\s*"\$0/.test(shop) && !/free-processing/.test(shop), "shop carries no zero-fee price label or retired promotion id");
  ok(shop.includes('priceLabel: "$299"') && shop.includes('priceLabel: "$249"') && shop.includes('priceLabel: "From $49"'), "retained shop prices are unchanged");
  const analysis = stripComments(read("client/src/pages/FreeAnalysis.tsx"));
  ok(analysis.includes("lb_promo_code") && /get\("promo"\)/.test(analysis), "Free Analysis keeps the promo query and lb_promo_code intake attribution");
  ok(analysis.includes("REVIEW_OFFER") && !/free-processing/.test(analysis), "Free Analysis reads the shared offer id");
  ok(EQUIPMENT_TERMS_LABEL === "Terms confirmed in your quote", "equipment price label comes from the approved claim");
  ok(!/free|no lease|never/i.test(SHOP_TERMS_CARD.text + SHOP_TERMS_CARD.title), "shop terms card makes no free, no-lease or absolute statement");
  for (const id of ["offer.free-processing", "offer.eliminate-processing-fees", "equipment.contract.no-lease", "equipment.placement.free-with-processing", "equipment.monthly-fee.zero"]) {
    ok(publicClaims.disposition(id) === "retired", `${id} stays retired`);
  }
  for (const id of ["equipment.contract.no-lease", "equipment.placement.free-with-processing"]) {
    ok(publicClaims.textOrNull(id, "page") === claimText("equipment.agreement.summary"), `${id} resolves only to the agreement summary`);
  }
  ok(publicClaims.textOrNull("equipment.monthly-fee.zero", "page") === EQUIPMENT_TERMS_LABEL, "zero monthly fee resolves only to the quote wording");
  for (const route of ["/why-liberty", "/free-analysis", "/get-started"]) {
    passes(`${route} server HTML carries no free-processing or fee-elimination promise`, () => assertHtmlClean(route, OWNED_HTML[route]));
  }
});

family("comparison-qualifiers", () => {
  const norms = (text: string) => norm(decode(text));
  interface Surface {
    label: string;
    text: string;
  }
  const surfacesFor = (slug: string): Surface[] => {
    const entry = COMPARE_ENTRIES[slug];
    const html = OWNED_HTML[`/compare/${slug}`];
    // The React page emits getFAQSchema(data.faqs); the SEO module cannot load under Node (Helmet interop), so its mapping is pinned by source below.
    const reactAnswers = entry.faqs.map((faq) => faq.answer);
    const serverAnswers = faqJsonLdAnswers(html);
    return [
      { label: "table rate cell", text: entry.rows[0].provider },
      { label: "FAQ answer", text: entry.faqs[0].answer },
      { label: "React FAQ JSON-LD", text: reactAnswers[0] },
      { label: "server FAQ JSON-LD", text: serverAnswers[0] ?? "" },
      { label: "server HTML", text: html },
    ];
  };
  const requireAll = (surfaces: Surface[], needles: string[]) => {
    for (const surface of surfaces) {
      const haystack = norms(surface.text).toLowerCase();
      for (const needle of needles) ensure(haystack.includes(norms(needle).toLowerCase()), `${surface.label} is missing "${needle}"`);
    }
  };

  const NEEDLES: Record<string, string[]> = {
    clover: ["Clover - Lowest advertised plan rate (in person): as little as 2.3% + 10¢", "the rate varies by plan and business type"],
    "authorize-net": [
      "Authorize.net - All-in-One (merchant account and gateway) (online): 2.9% + 30¢, $25 per month",
      "Authorize.net - Gateway Only (gateway fee): 10¢ per transaction, $25 per month",
      "plus a 10¢ daily batch fee",
      "the merchant account is separate",
    ],
    paypal: [
      "PayPal Point of Sale - Standard rate (in person): 2.29% + 9¢ (card-present transactions)",
      "PayPal payment links - Standard rate (online): 2.99% + 49¢ (standard credit and debit card payments, Apple Pay and other third-party wallets)",
      "PayPal payment links - Standard rate (online): 3.49% + 49¢ (PayPal Checkout, Pay with Venmo, Pay Later offers or Guest Checkout)",
    ],
  };
  for (const [slug, needles] of Object.entries(NEEDLES)) {
    passes(`${slug} table, FAQ, FAQ JSON-LD (React and server) and server HTML keep product, plan, channel and qualifiers`, () => requireAll(surfacesFor(slug), needles));
    for (const record of COMPARE_ENTRIES[slug].records) {
      passes(`${record.id} appears in full on every surface`, () => requireAll(surfacesFor(slug), [describePriceRecord(record)]));
    }
  }

  // The monthly fee is stated once per record, and a gateway charge is labelled as a gateway charge.
  for (const record of COMPARE_ENTRIES["authorize-net"].records) {
    passes(`${record.id} states its monthly fee once`, () => {
      const text = describePriceRecord(record);
      ensure((text.match(/\$25/g) ?? []).length === 1, `monthly fee repeated: ${text}`);
    });
  }
  const gateway = COMPARE_ENTRIES["authorize-net"].records.find((r) => r.channel === "gateway");
  ok(Boolean(gateway) && CHANNEL_LABELS.gateway === "gateway fee" && /gateway fee/.test(describePriceRecord(gateway as PriceRecord)), "the gateway-only record reads as a gateway fee");
  ok(Boolean(gateway) && !/\d%/.test(formatRateLabel(gateway as PriceRecord)), "the gateway-only record shows no processing percentage");
  ok(COMPARE_ENTRIES["clover"].records[0].ratePrefix === "as little as" && formatRateLabel(COMPARE_ENTRIES["clover"].records[0]).startsWith("as little as"), "Clover rate keeps its advertised prefix");
  ok(COMPARE_ENTRIES["authorize-net"].records.every((r) => r.sourceUrl === "https://www.authorize.net/sign-up/pricing.html"), "Authorize.net records cite the canonical sign-up pricing page");

  // Authorize.net server pages: no universal two-vendor claim and no confirmed single-provider claim.
  for (const route of ["/alternatives/authorize-net", "/switch-from/authorize-net", "/compare/authorize-net"]) {
    passes(`${route} makes no universal separate-processor or single-provider statement`, () => assertHtmlClean(route, OWNED_HTML[route]));
  }
  ok(decode(OWNED_HTML["/alternatives/authorize-net"]).includes(decode(norm(claimText("compat.inquiry")))), "Authorize.net alternatives page uses the confirmed-setup inquiry wording");
  ok(/Gateway Only plan the merchant account is separate/.test(decode(OWNED_HTML["/alternatives/authorize-net"])), "Authorize.net alternatives page qualifies the separate merchant account to the Gateway Only plan");
  ok(/All-in-One plan includes the merchant account and gateway/.test(decode(OWNED_HTML["/switch-from/authorize-net"])), "Authorize.net switch-from page states that All-in-One includes the merchant account");

  // Toast publishes no single rate: nothing may introduce its content as published list rates.
  const toast = COMPARE_ENTRIES["toast"];
  const toastHtml = decode(OWNED_HTML["/compare/toast"]);
  const introFor = (entry: typeof toast, html: string) => `${entry.tagline} ${entry.heroDescription} ${entry.tableIntro} ${entry.ratesHeading} ${html}`;
  const assertNoPublishedIntro = (text: string) =>
    ensure(!/published list rates|toast published rates|toast figures are published|publishes its pricing by plan and channel|published rates vs/i.test(text), "Toast content is introduced as published list rates");
  ok(toast.records.length === 0 && !toast.ratesPublished, "Toast has no price records");
  passes("Toast tagline, hero, table introduction, rates heading and server HTML make no published-rate claim", () => assertNoPublishedIntro(introFor(toast, toastHtml)));
  ok(/does not publish a single processing rate/.test(toastHtml), "Toast server HTML states that no single rate is published");
  ok(!/published list rates/i.test(toastHtml.replace(/Where a provider rate is shown, it is a published list rate and may change\./, "")), "Toast table footnote is the only list-rate wording and is conditional");
  for (const slug of ["square", "stripe", "clover", "paypal", "helcim", "authorize-net"]) {
    ok(COMPARE_ENTRIES[slug].ratesPublished && COMPARE_ENTRIES[slug].ratesHeading === `${COMPARE_ENTRIES[slug].name} Published Rates`, `${slug} keeps its published-rates heading`);
  }
  const compareVs = read("client/src/pages/CompareVs.tsx");
  ok(/acceptedAnswer:\s*\{[^}]*text:\s*faq\.answer/.test(read("client/src/components/SEO.tsx")) && /getFAQSchema\(data\.faqs\)/.test(compareVs), "React FAQ JSON-LD is built directly from the shared FAQ answers");
  const compareSsr = read("server/ssr/compare.ts");
  for (const [file, source] of [["CompareVs.tsx", compareVs], ["server/ssr/compare.ts", compareSsr]] as const) {
    ok(source.includes("data.tableIntro") && source.includes("data.ratesHeading"), `${file} reads the conditional table introduction and rates heading`);
    ok(!/figures are published list rates|\} Published Rates</.test(source), `${file} has no unconditional published-rate wording`);
    ok(source.includes("describePriceRecord"), `${file} renders each record with its product, plan, channel and qualifier`);
  }

  // Negative controls: remove a qualification and the checks must fail.
  const dropFrom = (slug: string, remove: RegExp | string) => surfacesFor(slug).map((s) => ({ ...s, text: s.text.split(remove as string).join("") }));
  negative("Clover FAQ without 'as little as'", () => requireAll(dropFrom("clover", "as little as "), NEEDLES["clover"]));
  negative("Clover rate without the plan and business-type variation", () => requireAll(dropFrom("clover", " (the rate varies by plan and business type, and is shown only on Clover.com)"), NEEDLES["clover"]));
  negative("Authorize.net gateway fee shown as a plain rate", () => requireAll(dropFrom("authorize-net", "(gateway fee)"), NEEDLES["authorize-net"]));
  negative("Authorize.net without the separate merchant account note", () => requireAll(dropFrom("authorize-net", ", and the merchant account is separate"), NEEDLES["authorize-net"]));
  negative("PayPal Checkout rate without its payment-link context", () => requireAll(dropFrom("paypal", "PayPal payment links - Standard rate (online): "), NEEDLES["paypal"]));
  negative("PayPal Checkout rate without Venmo and Guest Checkout", () => requireAll(dropFrom("paypal", " (PayPal Checkout, Pay with Venmo, Pay Later offers or Guest Checkout)"), NEEDLES["paypal"]));
  negative("old simplified record summary (plan, channel and rate only)", () => {
    const simplified = COMPARE_ENTRIES["authorize-net"].records.map((r) => `${r.plan} (${r.channel}): ${formatRateLabel(r)}`).join("; ");
    requireAll([{ label: "simplified FAQ", text: simplified }], NEEDLES["authorize-net"]);
  });
  negative("Toast introduced as published list rates", () => assertNoPublishedIntro(introFor({ ...toast, tableIntro: "Toast figures are published list rates, dated and sourced below." }, toastHtml)));
  negative("Toast rates heading 'Toast Published Rates'", () => assertNoPublishedIntro(introFor({ ...toast, ratesHeading: "Toast Published Rates" }, toastHtml)));
  negative("Authorize.net universal two-vendor statement", () => assertHtmlClean("fixture", `${OWNED_HTML["/alternatives/authorize-net"]}<li>Requires a separate payment processor — two vendors, two billing relationships</li>`));
  negative("Liberty single-provider claim on the Authorize.net page", () => assertHtmlClean("fixture", `${OWNED_HTML["/alternatives/authorize-net"]}<li>Single provider for processing and gateway — one billing relationship</li>`));
  negative("monthly fee repeated in a record", () => {
    const record = { ...COMPARE_ENTRIES["authorize-net"].records[0], qualifier: "plus a $25 monthly fee" } as PriceRecord;
    ensure((describePriceRecord(record).match(/\$25/g) ?? []).length === 1, "monthly fee repeated");
  });
  ok(formatQualifier({ qualifier: "tap, dip or swipe" }) === "Tap, dip or swipe", "qualifier helper sentence-cases without changing meaning");
});

family("surcharge-card-types", () => {
  const EXCLUSION = /credit card surcharging does not apply to debit or prepaid cards/i;
  const surcharging = ZP_HOME_PROGRAMS.find((p) => p.value === "surcharging");
  const debitFaq = ZP_FAQ.find((item) => /debit/i.test(item.question));
  ok(Boolean(surcharging) && Boolean(debitFaq), "program records for the surcharging card and the debit FAQ exist");
  const programHtml = OWNED_HTML["/0-percent-processing"];
  const programLd = faqJsonLdAnswers(programHtml);
  const surfaces: { label: string; text: string }[] = [
    { label: "program.card-types claim", text: claimText("program.card-types") },
    { label: "credit-only claim", text: claimText("program.surcharge.credit-only") },
    { label: "program page surcharging card", text: ZP_SURCHARGE.body },
    { label: "Home surcharging card", text: (surcharging as { body: string }).body },
    { label: "program FAQ answer", text: (debitFaq as { answer: string }).answer },
    { label: "Home program description", text: ZP_HOME_DESCRIPTION },
    { label: "Home server summary", text: ZP_HOME_SSR.text },
    { label: "program page server HTML", text: programHtml },
    { label: "program FAQ JSON-LD", text: programLd.find((a) => /debit/i.test(a)) ?? "" },
    { label: "Home server HTML", text: OWNED_HTML["/"] },
  ];
  const assertExclusion = (items: { label: string; text: string }[]) => {
    for (const item of items) ensure(EXCLUSION.test(decode(item.text)), `${item.label} does not state that credit surcharging excludes debit and prepaid cards`);
  };
  passes("every program surface states that credit surcharging does not apply to debit or prepaid cards", () => assertExclusion(surfaces));
  ok(/without a PIN/.test(claimText("program.card-types")) && /without a PIN/.test(claimText("program.surcharge.credit-only")), "claims cover a debit card run without a PIN");
  ok(programLd.some((a) => EXCLUSION.test(a)), "program FAQ JSON-LD carries the exclusion");
  ok((decode(programHtml).match(/credit card surcharging does not apply to debit or prepaid cards/gi) ?? []).length >= 2, "program page states the exclusion in the explanatory card and the FAQ");
  ok(/surcharg/i.test(ZP_SURCHARGE.body) && /cash discount is a separate program/i.test(claimText("program.card-types")), "cash discount stays a separate program");
  const sentences = surfaces.map((s) => decode(s.text)).join(" ");
  ok(!/legal in (all|every) (50 )?states|all 50 states|uniform (cap|rate|fee)|costs? (disappear|vanish)|no cost to (you|your)/i.test(sentences), "no blanket legality, uniform cap or cost-disappears wording");
  ok(scanText(sentences).length === 0, "program surfaces carry no retired assertion");

  const card = CLAIM_EVIDENCE.find((e) => e.key === "EV-WA-CARD-NETWORK-DEBIT-PREPAID");
  const record = PUBLIC_CLAIM_RECORDS.find((r) => r.id === "program.card-types") as { evidenceKey?: string } | undefined;
  ok(record?.evidenceKey === "EV-WA-CARD-NETWORK-DEBIT-PREPAID", "program.card-types cites the card-network evidence");
  ok(card?.kind === "official-source" && /usa\.visa\.com/.test(card.source) && /Mastercard/.test(card.summary) && /no state-law or legality/i.test(card.summary), "evidence is the official Visa source and records the Mastercard/state-law limits");

  // Negative controls: replacing the exclusion with the old ambiguous wording must be detected on each surface.
  const ambiguous = (text: string) => decode(text).replace(/credit card surcharging does not apply to debit or prepaid cards,? (including a debit card run without a PIN)?\.?/gi, "Debit cards are treated differently.");
  for (const item of surfaces) {
    negative(`${item.label} reverted to "treated differently"`, () => assertExclusion([{ label: item.label, text: ambiguous(item.text) }]));
  }
  negative("old combined wording 'credit, debit and prepaid cards are treated differently'", () =>
    ensure(scanText("Credit, debit and prepaid cards are treated differently under card brand rules and state law.").length === 0, "ambiguous wording present"),
  );
  negative("blanket legality statement added", () => ensure(!/legal in all 50 states|all 50 states/i.test(`${sentences} Surcharging is legal in all 50 states.`), "blanket legality present"));
});

family("bundle-leak", () => {
  const SERVER_ONLY = /public-claim-evidence/;
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(rel, out);
      } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  const browserFiles = [...walk("client/src"), ...walk("shared")];
  const importers = browserFiles.filter((f) => SERVER_ONLY.test(stripComments(read(f))));
  ok(importers.length === 0, `server-only evidence register imported by browser-reachable files: ${importers.join(", ")}`);
  const markerFiles = browserFiles.filter((f) => PRIVATE_BUNDLE_MARKERS.some((m) => stripComments(read(f)).includes(m)));
  ok(markerFiles.length === 0, `private markers found in browser-reachable source: ${markerFiles.join(", ")}`);

  const scanDir = (dir: string): string[] => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const hits: string[] = [];
    const visit = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) visit(p);
        else if (/\.(js|css|html|json|map)$/.test(entry.name)) {
          const body = fs.readFileSync(p, "utf8");
          for (const marker of PRIVATE_BUNDLE_MARKERS) if (body.includes(marker)) hits.push(`${path.relative(ROOT, p)} contains a private marker`);
        }
      }
    };
    visit(abs);
    return hits;
  };
  const bundleDir = "dist/public";
  if (fs.existsSync(path.join(ROOT, bundleDir))) {
    const hits = scanDir(bundleDir);
    ok(hits.length === 0, `built client bundle leaks private evidence: ${hits.join("; ")}`);
  } else if (process.env.PUBLIC_CLAIMS_REQUIRE_BUNDLE === "1") {
    ok(false, "built client bundle not found at dist/public but PUBLIC_CLAIMS_REQUIRE_BUNDLE=1");
  } else {
    console.log("  note: dist/public not present; built-bundle marker scan skipped (source-level leak checks ran)");
  }

  const planted = (source: string) => ensure(!PRIVATE_BUNDLE_MARKERS.some((m) => source.includes(m)), "private marker present");
  negative("private marker planted in a client-importable file", () => planted(`${read("shared/public-disclosures.ts")}\nexport const leak = "${PRIVATE_BUNDLE_MARKERS[0]}";`));
  negative("evidence register imported from shared code", () => ensure(!SERVER_ONLY.test(`import { CLAIM_EVIDENCE } from "../server/data/public-claim-evidence";`), "import present"));
});

family("legacy-wrappers", () => {
  const slugs = Object.keys(COMPETITOR_DATA).sort();
  ok(JSON.stringify(slugs) === JSON.stringify([...COMPARE_SLUGS].sort()), "COMPETITOR_DATA keeps the seven comparison slugs");
  ok(COMPARE_SLUGS.length === 7, "seven slugs");
  const wrapperMatches = (slug: string, name: string) => ensure(COMPETITOR_DATA[slug].name === name && COMPETITOR_DATA[slug].records === COMPARE_ENTRIES[slug].records, `${slug} wrapper diverges from the record`);
  for (const slug of COMPARE_SLUGS) passes(`${slug} wrapper matches its record`, () => wrapperMatches(slug, COMPARE_ENTRIES[slug].name));
  negative("wrapper that no longer matches a changed record", () => wrapperMatches("square", "A different name"));
  ok(Array.isArray(fstFaqItems) && fstFaqItems.length > 0 && fstFaqItems.every((i) => i.question && i.answer), "terminal FAQ wrapper export is intact");
  ok(typeof getHomeHtml === "function" && typeof getCompareHtml === "function", "server builders keep their exports");
});

family("route-and-offer-preservation", () => {
  const getStarted = read("client/src/pages/GetStarted.tsx");
  ok(getStarted.includes("/upload-statement?terminal=yes"), "quiz keeps the terminal flag link");
  ok(read("shared/seo-routes.ts").includes('"/free-smart-terminal"'), "terminal route URL unchanged");
  ok(OWNED_HTML["/free-smart-terminal"].includes("/free-smart-terminal"), "terminal route emitted by its server page");
  const equipmentOffer = PUBLIC_NAV_GROUPS.find((g) => g.id === "equipment")?.offer;
  ok(equipmentOffer?.label === "Free Smart Terminal", "navigation label unchanged (shared navigation model)");
  ok(equipmentOffer?.href === "/free-smart-terminal", "navigation URL unchanged (shared navigation model)");
  ok(/PUBLIC_NAV_GROUPS/.test(read("client/src/components/Navbar.tsx")) && /PUBLIC_NAV_GROUPS/.test(read("server/ssrShared.ts")), "React and server headers both read the shared navigation model");
  ok(read("client/src/pages/FreeSmartTerminal.tsx").includes("offer=free-terminal") || read("server/services/offer-router.ts").includes("free-terminal"), "free-terminal offer parameter handling kept");
  for (const route of ["/upload-statement", "/0-percent-processing", "/integrations", "/compare/square"]) {
    ok(Boolean(SEO_ROUTE_DEFAULTS[route]), `${route} route metadata kept`);
  }
});

family("statistics-labels", () => {
  const source = read("client/src/lib/site-content.ts");
  ok(!/verified Aug 2026|3 verified outcomes/i.test(source), "statistics no longer claim a verification that has no evidence");
  ok(/evidenceState/.test(source), "statistics carry an evidence state");
});

family("owner-evidence-register", () => {
  ok(OWNER_EVIDENCE_REGISTER.length >= 10, "owner-evidence register lists the open evidence items");
  ok(OWNER_EVIDENCE_REGISTER.every((i) => i.needed && i.unlocks && i.safeFallbackNow), "every owner-evidence item names the fallback in force");
  const approvedWithUnsafeWording = PUBLIC_CLAIM_RECORDS.filter((r) => r.disposition === "approved" && /\balways\b|\bnever\b|all 50|\bfree equipment\b|no upfront/i.test(r.text));
  ok(approvedWithUnsafeWording.length === 0, `approved claims with absolute wording: ${approvedWithUnsafeWording.map((r) => r.id).join(", ")}`);
  ok(claimText("timing.staged-process") === TIMING_NOTE, "timing note comes from the claim record");
});

family("w-b-design-consumers", () => {
  const nav = read("client/src/components/Navbar.tsx");
  const ssrNav = decode(ssrNavbar());
  const homeFull = decode(OWNED_HTML["/"]);
  const homeHtml = homeFull.slice(homeFull.indexOf("<main>"), homeFull.indexOf("</main>"));
  const hubFull = decode(getIndustriesHubHtml());
  const hubHtml = hubFull.slice(hubFull.indexOf("<main>"), hubFull.indexOf("</main>"));
  ok(homeHtml.length > 1000 && hubHtml.length > 500, "Home and hub assertions run against the page body, not the shared header");
  const appSource = read("client/src/App.tsx");
  const glossaryRoutes = read("server/routes/glossary.ts");

  // ── Navigation model and both emitters ─────────────────────────────────────
  ok(PUBLIC_NAV_GROUPS.map((g) => g.label).join("|") === "Solutions|Equipment|Industries|Resources|Company", "five top-level entries in the owner's order");
  ok(PUBLIC_NAV_CTA.label === "Talk to Liberty" && PUBLIC_NAV_CTA.href === "/about-contact", "single header action is Talk to Liberty");
  ok(PUBLIC_NAV_UTILITY.label === "Support" && PUBLIC_NAV_UTILITY.href === "/support", "Support is the first utility link");

  const routeExists = (href: string): boolean => {
    if (isHomeAnchor(href)) return true;
    if (SEO_ROUTE_DEFAULTS[href]) return true;
    if (href === "/learn") return /["']\/learn["']/.test(glossaryRoutes);
    const industry = href.match(/^\/industries\/([a-z0-9-]+)$/);
    if (industry) return (INDUSTRY_SLUGS as readonly string[]).includes(industry[1]);
    return appSource.includes(`path="${href}"`);
  };
  const assertNavResolves = (groups: typeof PUBLIC_NAV_GROUPS): void => {
    for (const g of groups) {
      ensure(routeExists(g.href), `${g.label} top-level target ${g.href} has no built route`);
      for (const l of [...g.links, ...(g.offer ? [g.offer] : [])]) ensure(routeExists(l.href), `${g.label} → ${l.label} target ${l.href} has no built route`);
    }
  };
  passes("every navigation destination resolves to a built route or Home anchor", () => assertNavResolves(PUBLIC_NAV_GROUPS));
  negative("navigation entry pointing at an unbuilt proposed page", () =>
    assertNavResolves([{ ...PUBLIC_NAV_GROUPS[0], links: [...PUBLIC_NAV_GROUPS[0].links, { label: "Proposed page", href: "/proposed-unbuilt-page" }] }]),
  );

  // Sign-in utilities: exactly the two existing authenticated entrances. A "Merchant login" or "Merchant portal"
  // label is rejected because the repository does not prove a merchant-only journey at /login.
  const assertSignInUtilities = (utilities: readonly { label: string; href: string }[], groups: typeof PUBLIC_NAV_GROUPS, html: string): void => {
    ensure(
      utilities.map((u) => `${u.label}=${u.href}`).join("|") === "Support=/support|Account sign in=/login|Partner sign in=/partner-login",
      "utilities are not Support, Account sign in (/login) and Partner sign in (/partner-login)",
    );
    ensure(!/merchant[- ]login|merchant[- ]portal|\/signin\b|\/merchant-login/i.test(JSON.stringify([utilities, groups]) + html), "navigation names a merchant login destination that has no owner-confirmed URL");
    ensure(!groups.some((g) => g.links.some((l) => /\/login\b|\/partner-login\b/.test(l.href))), "sign-in destinations belong to the utilities, not to a dropdown group");
  };
  passes("navigation carries the two confirmed sign-in entrances and no guessed Merchant login", () => assertSignInUtilities(PUBLIC_NAV_UTILITIES, PUBLIC_NAV_GROUPS, ssrNav));
  negative("guessed Merchant login added to the utilities", () =>
    assertSignInUtilities([...PUBLIC_NAV_UTILITIES, { label: "Merchant login", href: "/login" }], PUBLIC_NAV_GROUPS, ssrNav),
  );
  negative("sign-in link hidden in a dropdown group", () =>
    assertSignInUtilities(PUBLIC_NAV_UTILITIES, [{ ...PUBLIC_NAV_GROUPS[4], links: [...PUBLIC_NAV_GROUPS[4].links, { label: "Sign in", href: "/login" }] }], ssrNav),
  );
  negative("Account sign in pointed at an unrelated page", () =>
    assertSignInUtilities(PUBLIC_NAV_UTILITIES.map((u) => (u.label === "Account sign in" ? { ...u, href: "/support" } : u)), PUBLIC_NAV_GROUPS, ssrNav),
  );

  const assertSsrNavParity = (html: string): void => {
    for (const g of PUBLIC_NAV_GROUPS) {
      ensure(html.includes(`href="${g.href}">${g.label}</a>`), `server header is missing top-level ${g.label}`);
      for (const l of g.links) ensure(html.includes(`href="${l.href}">${l.label}</a>`), `server menu is missing ${g.label} → ${l.label}`);
      if (g.offer?.current) ensure(html.includes(`href="${g.offer.href}">${g.offer.label}</a>`), `server menu is missing the ${g.label} offer`);
    }
    ensure(html.includes(`href="${PUBLIC_NAV_CTA.href}" class="ssr-cta-btn">${PUBLIC_NAV_CTA.label}</a>`), "server header is missing its action");
    for (const u of PUBLIC_NAV_UTILITIES) ensure(html.includes(`href="${u.href}">${u.label}</a>`), `server header is missing the ${u.label} utility`);
    ensure(/<details class="ssr-menu"/.test(html), "server header has no no-JavaScript menu");
  };
  passes("server header and menu list every model entry", () => assertSsrNavParity(ssrNav));
  negative("server header missing a model group", () => assertSsrNavParity(ssrNav.replace(/href="\/learn">Resources<\/a>/, "")));
  negative("server header without its menu", () => assertSsrNavParity(ssrNav.replace('<details class="ssr-menu"', "<div")));
  negative("server header missing Partner sign in", () => assertSsrNavParity(ssrNav.split('<a href="/partner-login">Partner sign in</a>').join("")));

  const navLiterals = nav.match(/href=["']\/[^"']*["']/g) ?? [];
  ok(navLiterals.every((l) => l === 'href="/"'), `React header hardcodes destinations: ${navLiterals.join(", ")}`);
  ok(/PUBLIC_NAV_CTA/.test(nav) && /PUBLIC_NAV_UTILITIES/.test(nav), "React header reads the shared action and utility links");
  ok(!/Book a call|Upload Statement|Free Analysis/.test(nav), "React header carries no retired action labels");
  ok(/h-14[^"]*md:h-16/.test(nav), "React header height is 56px on phones and 64px from 768px");
  ok(/<img src=\{logoBlue\}[^>]*max-w-\[200px\]/.test(nav), "React logo is width-constrained on phones");

  // ── Home: both emitters render the shared content ──────────────────────────
  const assertHomeParity = (html: string): void => {
    ensure(new RegExp(`<h1>${HOME_HERO.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`).test(html), "Home h1 is not the shared heading");
    ensure(html.includes(HOME_HERO.body), "Home hero body is not the shared body");
    ensure(html.includes(`href="${HOME_HERO.primary.href}"`) && html.includes(HOME_HERO.primary.label), "Home primary action missing");
    ensure(html.includes(`href="${HOME_HERO.secondary.href}"`) && html.includes(HOME_HERO.secondary.label), "Home secondary action missing");
    ensure(html.includes(`id="${HOME_SOLUTIONS_ANCHOR}"`), "Home has no #solutions target");
    for (const id of HOME_SECTION_ORDER) ensure(html.includes(`data-home-section="${id}"`), `Home has no ${id} section`);
    ensure(html.indexOf('data-home-section="hero"') < html.indexOf('data-home-section="solutions"') && html.indexOf('data-home-section="process"') < html.indexOf('data-home-section="final"'), "Home sections are out of contract order");
    for (const c of HOME_SOLUTIONS.cards) ensure(html.includes(`href="${c.href}"`) && html.includes(c.title), `Home solution card ${c.id} missing`);
    ensure(html.includes(HOME_FOUNDER.heading) && html.includes(HOME_FOUNDER.body), "Home founder note missing");
    for (const c of HOME_STARTING_POINTS.cards) ensure(html.includes(c.body) && html.includes(c.note) && html.includes(c.ctaLabel), `Home starting point ${c.id} missing or off-contract`);
    ensure(html.includes('href="/industries"'), "Home has no All industries link");
  };
  passes("server Home renders the shared hero, solutions, founder and starting points", () => assertHomeParity(homeHtml));
  negative("Home with a different heading", () => assertHomeParity(homeHtml.replace(HOME_HERO.heading, "Credit Card Processing Without the Rate Games")));
  negative("Home without the #solutions target", () => assertHomeParity(homeHtml.replace(`id="${HOME_SOLUTIONS_ANCHOR}"`, "")));
  negative("Home without its process section", () => assertHomeParity(homeHtml.replace('data-home-section="process"', "")));
  negative("Home starting point with a hardcoded terminal promotion", () =>
    assertHomeParity(homeHtml.split(HOME_STARTING_POINTS.cards[1].body).join("Free terminal for everyone")),
  );

  const homeHero = read("client/src/components/home/HomeHero.tsx");
  const homeSolutions = read("client/src/components/home/HomeSolutions.tsx");
  const homeFounder = read("client/src/components/home/HomeFounder.tsx");
  const homeStarting = read("client/src/components/home/HomeStartingPoints.tsx");
  ok(/HOME_HERO/.test(homeHero) && !homeHero.includes(HOME_HERO.heading), "React hero reads the shared hero rather than a literal heading");
  ok(/HOME_SOLUTIONS/.test(homeSolutions) && /HOME_SOLUTIONS_ANCHOR/.test(homeSolutions), "React solutions section reads shared cards and anchor");
  ok(/HOME_FOUNDER/.test(homeFounder), "React founder section reads the shared note");
  ok(/HOME_STARTING_POINTS/.test(homeStarting), "React starting points read the shared cards");
  ok(/HOME_PROCESS\b/.test(read("client/src/components/home/HomeProcess.tsx")), "React process section reads the shared process content");
  ok(!fs.existsSync(path.join(ROOT, "client/src/components/home/HomePrograms.tsx")) && !fs.existsSync(path.join(ROOT, "client/src/components/home/HomeHowItWorks.tsx")), "retired Home programs and how-it-works sections are not left behind");

  const assertNoPortraitInvented = (source: string): void => {
    ensure(!/<img\b|<PublicImage\b|\.jpg|\.png|\.webp/.test(source), "founder section renders an image although no approved portrait exists");
  };
  passes("founder section is text only (no approved portrait asset)", () => assertNoPortraitInvented(homeFounder));
  negative("founder section with a stock person image", () => assertNoPortraitInvented(`${homeFounder}\n<img src="/stock-man.jpg" />`));

  const assertReviewWorksheet = (rows: readonly { label: string; note: string }[], card: string): void => {
    ensure(rows.every((r) => !/[\d$%]/.test(r.label + r.note)), "review layout shows a figure");
    ensure(!/\$\s?\d|\d\s?%/.test(stripComments(card)), "review card source renders a currency or percent value");
    ensure(/Illustrative/i.test(HOME_SAMPLE_REVIEW.label), "review layout is not labelled illustrative");
  };
  passes("sample review is a labelled worksheet with no figures", () => assertReviewWorksheet(HOME_SAMPLE_REVIEW.rows, read("client/src/components/home/SampleReviewCard.tsx")));
  negative("review layout row with a rate", () => assertReviewWorksheet([...HOME_SAMPLE_REVIEW.rows, { label: "Effective rate", note: "3.47% blended" }], read("client/src/components/home/SampleReviewCard.tsx")));
  negative("review card source with a savings figure", () => assertReviewWorksheet(HOME_SAMPLE_REVIEW.rows, `${read("client/src/components/home/SampleReviewCard.tsx")}\nconst v = "$1,250/mo";`));

  // ── Industries hub ─────────────────────────────────────────────────────────
  const assertHub = (html: string, entries: readonly { slug: string }[]): void => {
    for (const slug of INDUSTRY_SLUGS) {
      ensure(entries.some((e) => e.slug === slug), `hub list omits ${slug}`);
      ensure(html.includes(`href="${industryHref(slug)}"`), `hub HTML omits ${slug}`);
    }
    ensure(entries.length === INDUSTRY_SLUGS.length, "hub lists an industry that has no page");
    ensure(html.match(/<h1[^>]*>/g)?.length === 1 && html.includes(`${INDUSTRIES_HUB.heading}</h1>`), "hub has no single h1 with the specified heading");
  };
  passes("hub lists every existing industry page and no other", () => assertHub(hubHtml, PUBLIC_INDUSTRIES));
  negative("hub missing an industry", () => assertHub(hubHtml.split(`href="${industryHref(INDUSTRY_SLUGS[0])}"`).join(""), PUBLIC_INDUSTRIES));
  negative("hub list with an invented industry", () => assertHub(hubHtml, [...PUBLIC_INDUSTRIES, { slug: "made-up-industry" }]));
  ok(NAV_INDUSTRY_SLUGS.every((slug) => PUBLIC_INDUSTRIES.some((i) => i.slug === slug)), "navigation industries are drawn from the hub list");
  ok(SEO_ROUTE_DEFAULTS["/industries"]?.inSitemap === true, "hub is registered for the sitemap");
  ok(/url: "\/industries"/.test(read("server/routes/imports.ts")), "hub is in the generated sitemap list");
  ok(/path="\/industries" component=/.test(appSource), "hub has a React route");
  ok(read("server/routes/ssr-routes.ts").indexOf('app.get("/industries",') > 0 && read("server/routes/ssr-routes.ts").indexOf('app.get("/industries",') < read("server/routes/ssr-routes.ts").indexOf('app.get("/industries/:slug"'), "hub server route is registered before the slug route");
  ok(!/\d+(\.\d+)?\s*%|\$\s?\d/.test(INDUSTRIES_HUB.description + INDUSTRIES_HUB.intro + PUBLIC_INDUSTRIES.map((i) => i.summary).join(" ")), "hub copy states no rate or price");

  // ── About & Contact ────────────────────────────────────────────────────────
  const about = read("client/src/pages/AboutContact.tsx");
  const assertAbout = (intents: readonly { id: string; label: string; href: string }[], source: string): void => {
    const expected: Record<string, [string, string]> = {
      statement: ["Review my statement", "/upload-statement"],
      terminal: ["Discuss checkout fit", "/free-smart-terminal"],
      support: ["Get support", "/support"],
    };
    ensure(intents.length === 3, "three intent cards expected");
    for (const i of intents) ensure(expected[i.id]?.[0] === i.label && expected[i.id]?.[1] === i.href, `intent ${i.id} is not the specified label and destination`);
    ensure(/PUBLIC_CONTACT_CHANNELS/.test(source) && PUBLIC_CONTACT_CHANNELS.phone.href === "tel:+19542668214" && PUBLIC_CONTACT_CHANNELS.email.href === "mailto:support@libertybancard.com", "phone or email channel missing or not read from the shared contact channels");
    ensure(!/Call\s*\/\s*Text|Text us|text us|SMS/.test(source), "page offers a text channel that has no owner evidence");
    ensure(!/hero-team|team of payment processing professionals/.test(source), "page still claims a team photo with no provenance");
    ensure(!/within \d+|24\/7|same[- ]day|business hours|open (mon|tue)|office address/i.test(source + JSON.stringify(ABOUT_CONTACT_HERO)), "page states hours, response time or address that has no owner evidence");
  };
  passes("About & Contact routes to the three specified starting points", () => assertAbout(ABOUT_CONTACT_INTENTS, about));
  ok(ABOUT_CONTACT_HERO.heading === "Let's talk about your business." && ABOUT_CONTACT_BOOKING_LABEL === "Book a processing conversation", "About & Contact heading and booking label match the specification");
  ok(/ABOUT_CONTACT_INTENTS/.test(about) && /ABOUT_CONTACT_HERO/.test(about), "About & Contact reads the shared contact content");
  negative("About & Contact with a changed card destination", () => assertAbout(ABOUT_CONTACT_INTENTS.map((i) => (i.id === "support" ? { ...i, href: "/help" } : i)), about));
  negative("About & Contact with a response-time promise", () => assertAbout(ABOUT_CONTACT_INTENTS, `${about}\nconst r = "We reply within 15 minutes";`));
  negative("About & Contact with the unverified team photo", () => assertAbout(ABOUT_CONTACT_INTENTS, `${about}\nimport heroTeam from "@/assets/images/hero-team.jpg";`));

  // ── Visual tokens (extend-only) and contrast ───────────────────────────────
  const css = read("client/src/styles/public-contract.css");
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number): number => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const lum = ([r, g, b]: [number, number, number]): number => {
    const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: [number, number, number], b: [number, number, number]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const token = (name: string): [number, number, number] => {
    const m = css.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%`));
    if (!m) throw new Error(`token --${name} is not defined in the public contract`);
    return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  };
  const white: [number, number, number] = [255, 255, 255];
  const assertTokens = (navy: [number, number, number], red: [number, number, number], surface: [number, number, number]): void => {
    ensure(contrast(navy, white) >= 7, `navy on white contrast ${contrast(navy, white).toFixed(2)} is below 7:1`);
    ensure(contrast(red, white) >= 4.5, `red on white contrast ${contrast(red, white).toFixed(2)} is below 4.5:1`);
    ensure(contrast(red, surface) >= 4.5, `red on surface contrast ${contrast(red, surface).toFixed(2)} is below 4.5:1`);
    ensure(contrast(navy, surface) >= 7, `navy on surface contrast ${contrast(navy, surface).toFixed(2)} is below 7:1`);
  };
  passes("brand navy and red meet contrast on white and the light surface", () => assertTokens(token("liberty-navy"), token("liberty-red"), token("liberty-surface")));
  negative("a lighter red that fails contrast", () => assertTokens(token("liberty-navy"), hslToRgb(350, 85, 60), token("liberty-surface")));
  ok(/--primary:\s*222 47% 11%/.test(read("client/src/index.css")), "existing primary token is untouched (palette extends, never replaces)");
  ok(/#071D57/.test(read("server/ssrShared.ts")) && /#C8102E/.test(read("server/ssrShared.ts")) && !/#1e3a5f/i.test(read("server/ssrShared.ts")), "server chrome uses the same navy and red");
  ok(!/overflow-x:\s*hidden/.test(css), "public contract does not mask horizontal overflow");

  // B5: terminal product imagery is served as responsive derivatives, never as the raw 0.7-1.1 MB PNGs.
  const IMAGE_PAGES = [
    "client/src/pages/FreeSmartTerminal.tsx",
    "client/src/pages/ZeroPercent.tsx",
    "client/src/pages/BeatSquareStripe.tsx",
    "client/src/pages/GetStarted.tsx",
    "client/src/pages/TerminalShop.tsx",
  ];
  const assertResponsiveImagery = (file: string, source: string): void => {
    ensure(!/@\/assets\/images\/terminal-[a-z0-9-]+\.png/.test(source), `${file} imports a raw terminal PNG`);
    ensure(/<PublicImage\b/.test(source), `${file} does not use PublicImage`);
    ensure(!/<PublicImage[^>]*\bpriority\b/.test(source), `${file} marks secondary product imagery as high priority`);
    ensure(!/<img\b[^>]*\bsrc=\{(img|terminal\.image|detail\.image|t\.image)/.test(source), `${file} renders a raw <img> for a terminal`);
  };
  for (const file of IMAGE_PAGES) passes(`${file} serves terminals through responsive derivatives`, () => assertResponsiveImagery(file, read(file)));
  negative("raw terminal PNG import added to a public page", () =>
    assertResponsiveImagery("fixture", `${read("client/src/pages/FreeSmartTerminal.tsx")}\nimport imgX from "@/assets/images/terminal-pax-a920.png";`),
  );
  negative("raw <img> of an imported terminal asset", () =>
    assertResponsiveImagery("fixture", `${read("client/src/pages/ZeroPercent.tsx")}\n<img src={imgCloverFlex3} alt="" />`),
  );
  negative("secondary product image marked as the high-priority image", () =>
    assertResponsiveImagery("fixture", `${read("client/src/pages/GetStarted.tsx")}\n<PublicImage id="product-pax-a920" variant="product" priority sizes="160px" />`),
  );

  const manifest = JSON.parse(read("client/src/lib/public-imagery.manifest.json")) as {
    entries: { id: string; variants: { name: string; files: { format: string; file: string; width: number; bytes: number }[] }[] }[];
  };
  const registrySource = read("client/src/lib/public-imagery.ts");
  const usedIds = new Set(IMAGE_PAGES.flatMap((file) => [...read(file).matchAll(/product-[a-z0-9-]+/g)].map((m) => m[0])));
  const shopIds = [...read("client/src/pages/TerminalShop.tsx").matchAll(/imageId: "(product-[a-z0-9-]+)"/g)].map((m) => m[1]);
  ok(shopIds.length === 6, `shop lists six terminals with registry image ids (found ${shopIds.length})`);
  for (const id of [...usedIds, ...shopIds]) usedIds.add(id);
  const assertProductEntry = (entry: { id: string; variants: { name: string; files: { format: string; file: string; width: number; bytes: number }[] }[] } | undefined, id: string): void => {
    ensure(!!entry, `${id} is missing from the imagery manifest`);
    const variant = entry!.variants.find((v) => v.name === "product");
    ensure(!!variant, `${id} has no product variant`);
    const widths = new Set(variant!.files.map((f) => f.width));
    ensure(widths.size >= 2, `${id} offers fewer than two widths`);
    for (const format of ["avif", "webp", "jpg"]) ensure(variant!.files.some((f) => f.format === format), `${id} has no ${format} derivative`);
    const biggest = Math.max(...variant!.files.map((f) => f.bytes));
    ensure(biggest <= 60 * 1024, `${id} has a ${biggest}-byte derivative (limit 60 KB; the PNG original was about 1 MB)`);
    ensure(new RegExp(`"${id}":\\s*\\{`).test(registrySource), `${id} has no registry record (alt, usage, provenance)`);
  };
  for (const id of usedIds) passes(`${id} is a registered, budgeted product image`, () => assertProductEntry(manifest.entries.find((e) => e.id === id), id));
  negative("product image whose derivative is the raw-size file", () =>
    assertProductEntry(
      { id: "product-x", variants: [{ name: "product", files: [{ format: "avif", file: "a", width: 320, bytes: 900 }, { format: "avif", file: "b", width: 640, bytes: 1_050_000 }, { format: "webp", file: "c", width: 320, bytes: 900 }, { format: "jpg", file: "d", width: 320, bytes: 900 }] }] },
      "product-x",
    ),
  );
  negative("product image offered at a single width", () =>
    assertProductEntry(
      { id: "product-clover-flex-3", variants: [{ name: "product", files: [{ format: "avif", file: "a", width: 320, bytes: 900 }, { format: "webp", file: "c", width: 320, bytes: 900 }, { format: "jpg", file: "d", width: 320, bytes: 900 }] }] },
      "product-clover-flex-3",
    ),
  );

  // B5: the shared header and footer logos ship at display size (about 8 KB), not as the 3360 px, 75 KB originals,
  // in the React shell and inline in every server page.
  const pngSize = (rel: string): { width: number; height: number; bytes: number } => {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
  };
  const assertShellLogos = (ssrSource: string, navbarSource: string, footerSource: string, logos: Record<string, { width: number; height: number; bytes: number }>): void => {
    for (const [name, size] of Object.entries(logos)) {
      ensure(size.width <= 480 && size.bytes <= 16 * 1024, `${name} is ${size.width}px and ${size.bytes} bytes`);
      ensure(Math.abs(size.width / size.height - 3360 / 697) < 0.05, `${name} does not keep the brand aspect ratio`);
    }
    ensure(/logo-white-420\.png/.test(ssrSource) && /logo-blue-420\.png/.test(ssrSource), "server shell does not read the display-size logos");
    ensure(!/assets\/logo-(white|blue)\.png/.test(ssrSource), "server shell still inlines a full-size logo");
    ensure(/logo-blue-420\.png/.test(navbarSource) && !/assets\/logo-blue\.png/.test(navbarSource), "React navbar does not use the display-size logo");
    ensure(/logo-white-420\.png/.test(footerSource) && !/assets\/logo-white\.png/.test(footerSource), "React footer does not use the display-size logo");
  };
  const shellLogos = { "logo-blue-420.png": pngSize("client/src/assets/logo-blue-420.png"), "logo-white-420.png": pngSize("client/src/assets/logo-white-420.png") };
  passes("shared header and footer logos are display-size derivatives", () =>
    assertShellLogos(read("server/ssrShared.ts"), read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx"), shellLogos),
  );
  passes("server header and footer together stay small", () => {
    const bytes = Buffer.byteLength(ssrNavbar() + ssrFooter());
    ensure(bytes < 48 * 1024, `server shell is ${bytes} bytes`);
  });
  negative("server shell inlining the 3360 px original", () =>
    assertShellLogos(read("server/ssrShared.ts").split("logo-blue-420.png").join("logo-blue.png"), read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx"), shellLogos),
  );
  negative("React footer importing the original logo", () =>
    assertShellLogos(read("server/ssrShared.ts"), read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx").split("logo-white-420.png").join("logo-white.png"), shellLogos),
  );
  negative("a 76 KB logo derivative", () =>
    assertShellLogos(read("server/ssrShared.ts"), read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx"), { "logo-blue-420.png": pngSize("client/src/assets/logo-blue.png") }),
  );

  // B1/B2: server-only comparison pages use the shared tokens (no light-blue text/buttons below 4.5:1) and the
  // terminal CTAs wrap rather than overflow at 320px.
  const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const competitorCss = read("server/ssr/competitor-ssr.ts");
  const assertComparisonColors = (source: string): void => {
    ensure(!/#3b82f6/i.test(source), "comparison pages still use the #3b82f6 text/button colour");
    const rule = (selector: string, prop: string): string => {
      const m = new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*?${prop}:\\s*(#[0-9a-fA-F]{6})`).exec(source);
      ensure(!!m, `no ${prop} on ${selector}`);
      return m![1];
    };
    ensure(contrast(hexRgb("#ffffff"), hexRgb(rule(".btn-primary", "background"))) >= 4.5, "primary button background fails 4.5:1 with white text");
    ensure(contrast(hexRgb(rule(".internal-link", "color")), hexRgb("#f8fafc")) >= 4.5, "in-page links fail 4.5:1 on the light surface");
    ensure(contrast(hexRgb(rule("nav.breadcrumb a", "color")), hexRgb("#f8fafc")) >= 4.5, "breadcrumb links fail 4.5:1 on the light surface");
    ensure(contrast(hexRgb("#ffffff"), hexRgb(rule(".step-number", "background"))) >= 4.5, "step numbers fail 4.5:1");
  };
  passes("comparison page colours meet 4.5:1", () => assertComparisonColors(competitorCss));
  negative("old light-blue button colour restored", () => assertComparisonColors(competitorCss.replace(".btn-primary { display: inline-block; background: #C8102E;", ".btn-primary { display: inline-block; background: #3b82f6;")));
  negative("old light-blue link colour restored", () => assertComparisonColors(competitorCss.split("color: #1d4ed8").join("color: #3b82f6")));

  const fstSource = read("client/src/pages/FreeSmartTerminal.tsx");
  const assertCtaWraps = (source: string): void => {
    const buttons = source.match(/<Button\b[^>]*asChild>/g) ?? [];
    ensure(buttons.length >= 3, "terminal page buttons not found");
    for (const b of buttons) ensure(/whitespace-normal/.test(b) && /\bh-auto\b/.test(b) && /max-w-full/.test(b), `button can overflow at 320px: ${b.slice(0, 80)}`);
  };
  passes("terminal page CTAs wrap and stay inside the viewport", () => assertCtaWraps(fstSource));
  negative("nonwrapping terminal CTA", () => assertCtaWraps(fstSource.replace("public-cta h-auto max-w-full gap-2 whitespace-normal", "public-cta gap-2 whitespace-nowrap")));
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log("");
for (const [name, counts] of families) {
  console.log(`  ${name}: ${counts.assertions} assertions, ${counts.negatives} negative controls`);
}
console.log(`\nTotal: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length})`);
  process.exit(1);
}
console.log("PASS");
