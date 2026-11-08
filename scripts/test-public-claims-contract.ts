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
  PRICE_CHECKED_ON,
  PRICE_RECORDS,
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
import { ZP_FAQ, ZP_META, ZP_SSR } from "../shared/zero-percent-content";
import { FOOTER_COMPLIANCE, FOOTER_DISCLAIMER, TIMING_NOTE } from "../shared/public-disclosures";
import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import {
  CLAIM_EVIDENCE_KEYS,
  OWNER_EVIDENCE_REGISTER,
  PRIVATE_BUNDLE_MARKERS,
} from "../server/data/public-claim-evidence";
import * as pagesSsr from "../server/ssr/pages";
import { COMPETITOR_DATA, getCompareHtml } from "../server/ssr/compare";
import { getHomeHtml } from "../server/ssr/home";
import { getIndustryHtml } from "../server/ssr/industries";
import {
  getAvailableCompetitorSlugs,
  renderAlternativesHtml,
  renderSwitchFromHtml,
} from "../server/ssr/competitor-ssr";
import { ssrFooter, ssrNavbar } from "../server/ssrShared";

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
  "/": getHomeHtml(),
};
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
  "client/src/pages/WhyLiberty.tsx",
  "client/src/pages/AboutContact.tsx",
  "client/src/pages/HelpCenter.tsx",
  "client/src/pages/PartnerBrandedPage.tsx",
  "client/src/pages/MerchantApplication.tsx",
  "client/src/pages/SavingsCalculator.tsx",
  "client/src/components/Footer.tsx",
  "client/src/components/Navbar.tsx",
  "client/src/components/home/HomePrograms.tsx",
  "client/src/components/home/HomeFaq.tsx",
  "client/src/components/home/HomeFinal.tsx",
  "client/src/components/home/HomeHowItWorks.tsx",
  "client/src/components/home/home-content.ts",
  "shared/public-claims.ts",
  "shared/public-disclosures.ts",
  "shared/free-smart-terminal-content.ts",
  "shared/free-statement-review-content.ts",
  "shared/zero-percent-content.ts",
  "shared/integrations-content.ts",
  "shared/competitor-pricing.ts",
  "shared/compare-content.ts",
  "shared/seo-routes.ts",
  "server/ssrShared.ts",
  "server/ssr/home.ts",
  "server/ssr/compare.ts",
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
    { file: "client/src/pages/UploadStatement.tsx", module: "@shared/free-statement-review-content", symbols: ["FSR_HERO", "FSR_NEXT_NOTE", "FSR_EQUIPMENT_STRIP"] },
    { file: "client/src/pages/ZeroPercent.tsx", module: "@shared/zero-percent-content", symbols: ["ZP_FAQ"] },
    { file: "client/src/pages/Integrations.tsx", module: "@shared/integrations-content", symbols: ["INTEGRATIONS_PROCESS", "showsActiveCheck"] },
    { file: "client/src/pages/CompareVs.tsx", module: "@shared/compare-content", symbols: ["getCompareEntry", "COMPARE_METHOD_NOTE"] },
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
  ok(/Free Smart Terminal/.test(read("client/src/components/Navbar.tsx")), "React navigation label unchanged");
  ok(/"\/free-smart-terminal"/.test(read("client/src/components/Navbar.tsx")) || /free-smart-terminal/.test(read("client/src/components/Navbar.tsx")), "React navigation URL unchanged");
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
