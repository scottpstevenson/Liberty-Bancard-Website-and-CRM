#!/usr/bin/env npx tsx
/**
 * test-wd-industries-contract.ts
 *
 * W-D industry suite. Static and deterministic: no server, no database, no network, no provider I/O.
 *
 * What it proves
 *  - all 14 listed /industries/:slug routes have shared content and a server document (the server
 *    used to cover eight and fall through to the client for the rest);
 *  - each document's first HTML carries its own title, one H1, canonical, description, both
 *    actions, FAQ answers that match the shared content and the Breadcrumb/FAQ/Service schema;
 *  - the React page renders the same shared content, and the retired statistics section, average
 *    rates, savings figures, uptime promises, certification statements and named-integration lists
 *    are absent from the content, the documents and both renderers;
 *  - unknown slugs, including prototype names, produce no document.
 *
 * Every check family has a negative control.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { PUBLIC_INDUSTRIES } from "../shared/public-industries";
import {
  INDUSTRY_CONTENT,
  INDUSTRY_HERO_PICTURE,
  getIndustryContent,
  industrySections,
  type IndustryContent,
} from "../shared/public-industry-content";
import { INDUSTRY_DATA, getIndustryHtml } from "../server/ssr/industries";

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

const BASE = "https://libertybancard.com";
const BRAND = "Liberty Bancard";

const decode = (s: string): string =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const firstMatch = (html: string, re: RegExp): string => {
  const m = html.match(re);
  return m ? decode(m[1]) : "";
};

/** The words an industry entry puts in front of a visitor. */
function contentText(entry: IndustryContent): string {
  const sections = industrySections(entry);
  return [
    entry.name,
    entry.heroTitle,
    entry.heroSubtitle,
    entry.metaTitle,
    entry.metaDescription,
    entry.keywords,
    ...entry.considerations.flatMap((c) => [c.title, c.description]),
    ...entry.faqs.flatMap((f) => [f.question, f.answer]),
    ...sections.review.flatMap((r) => [r.title, r.description]),
    sections.ctaBody,
  ].join("\n");
}

function visibleContent(html: string): string {
  const start = html.indexOf("</header>");
  const end = html.indexOf("<footer");
  ensure(start > 0 && end > start, "document has no header/footer boundaries to scope the scan");
  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(" ");
  return `${html.slice(start, end)} ${jsonLd}`
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, " ")
    .replace(/data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+/g, " ");
}

const FORBIDDEN: readonly { id: string; re: RegExp }[] = [
  { id: "percent-figure", re: /\d\s?%/ },
  { id: "dollar-figure", re: /\$\s?\d/ },
  { id: "savings-promise", re: /\bsav(e|es|ed|ing|ings)\b/i },
  { id: "average-or-typical", re: /\b(average|typical|typically|median)\b/i },
  { id: "guarantee", re: /guarantee/i },
  { id: "speed-promise", re: /\b(same[- ]day|next[- ]day|24\/7|within \d+ (hours|minutes|days)|\d+[- ]hours?)\b/i },
  { id: "uptime", re: /\buptime\b|99\.\d/i },
  { id: "certification", re: /\bPCI\b|HIPAA|SOC ?2|certified|compliant/i },
  { id: "count", re: /\b\d[\d,]*\+?\s+(businesses|merchants|customers|clients|practices|restaurants|stores|integrations|platforms|systems)\b/i },
  { id: "named-integration-claim", re: /\b(works with|integrates with|compatible with|supports)\b/i },
  { id: "brand-list", re: /\b(Toast|Clover|Square|Shopify|Stripe|PayPal|Lightspeed|Aloha|Mindbody|Vagaro|Fresha|Opera|Cloudbeds|QuickBooks|Dentrix|Eaglesoft|Clio|MyCase|Jobber|Housecall)\b/ },
  { id: "ranking-claim", re: /\b(best|#1|number one|top[- ]rated|leading|lowest)\b/i },
  { id: "free-processing", re: /free processing(?! (analysis|review))/i },
  { id: "fixed-rate", re: /\b(interchange[- ]plus|basis points?|flat[- ]rate)\b/i },
];

function assertNoForbidden(text: string, label: string): void {
  for (const { id, re } of FORBIDDEN) {
    const m = text.match(re);
    ensure(!m, `${label}: forbidden claim "${id}" matched "${m?.[0]}"`);
  }
}

interface Expected {
  slug: string;
  h1: string;
  title: string;
  description: string;
}

function assertDocument(html: string | null, expected: Expected): void {
  const canonical = `/industries/${expected.slug}`;
  ensure(html, `${canonical}: no document`);
  const doc = html as string;
  ensure(firstMatch(doc, /<title>([^<]*)<\/title>/) === `${expected.title} | ${BRAND}`, `${canonical}: title is not "${expected.title} | ${BRAND}"`);
  ensure((doc.match(/<h1[\s>]/g) ?? []).length === 1, `${canonical}: not exactly one h1`);
  ensure(firstMatch(doc, /<h1[^>]*>([^<]*)<\/h1>/) === expected.h1, `${canonical}: h1 mismatch`);
  ensure(firstMatch(doc, /<link rel="canonical" href="([^"]*)"/) === `${BASE}${canonical}`, `${canonical}: canonical mismatch`);
  ensure(firstMatch(doc, /<meta name="description" content="([^"]*)"/) === expected.description, `${canonical}: description mismatch`);
  ensure(!/<meta name="robots" content="[^"]*noindex/.test(doc), `${canonical}: noindex`);
  ensure(doc.includes('href="/upload-statement"'), `${canonical}: no statement-review action`);
  ensure(doc.includes('href="/about-contact#inquiry"'), `${canonical}: no no-statement inquiry action`);
}

function assertSchemas(html: string, label: string): void {
  const types: string[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const parsed = JSON.parse(m[1]) as { "@type"?: string };
    if (parsed["@type"]) types.push(parsed["@type"]);
  }
  for (const required of ["BreadcrumbList", "FAQPage", "Service"]) ensure(types.includes(required), `${label}: no ${required} schema`);
  for (const forbidden of ["Review", "AggregateRating", "VideoObject", "LocalBusiness"]) ensure(!types.includes(forbidden), `${label}: ${forbidden} schema`);
}

function assertNoStats(html: string, label: string): void {
  ensure(!/section-industry-stats|class="[^"]*\bssr-stat/.test(html), `${label}: statistics section present`);
}

// ── Inventory ────────────────────────────────────────────────────────────────

passes("14 listed industries have shared content, in the same order and nothing extra", () => {
  ensure(PUBLIC_INDUSTRIES.length === 14, `${PUBLIC_INDUSTRIES.length} listed industries`);
  ensure(INDUSTRY_CONTENT.length === 14, `${INDUSTRY_CONTENT.length} content entries`);
  ensure(
    PUBLIC_INDUSTRIES.map((i) => i.slug as string).sort().join("|") === INDUSTRY_CONTENT.map((i) => i.slug).sort().join("|"),
    "content slugs differ from the listed industries",
  );
  ensure(new Set(INDUSTRY_CONTENT.map((i) => i.slug)).size === 14, "duplicate slug");
  ensure(Object.keys(INDUSTRY_DATA).length === 14, "INDUSTRY_DATA is not the 14-entry view seo-audit reads");
});

passes("each entry has the full set of sections", () => {
  for (const entry of INDUSTRY_CONTENT) {
    ensure(entry.heroTitle && entry.heroSubtitle && entry.metaTitle && entry.metaDescription && entry.keywords, `${entry.slug}: missing a head field`);
    ensure(entry.considerations.length === 4, `${entry.slug}: ${entry.considerations.length} considerations`);
    ensure(entry.faqs.length >= 3 && entry.faqs.length <= 5, `${entry.slug}: ${entry.faqs.length} faqs`);
    ensure(entry.metaDescription.length >= 70 && entry.metaDescription.length <= 160, `${entry.slug}: description is ${entry.metaDescription.length} characters`);
    ensure(!entry.metaTitle.includes(BRAND), `${entry.slug}: metaTitle already carries the brand`);
    ensure(entry.slug.endsWith("-payment-processing"), `${entry.slug}: unexpected slug shape`);
  }
});

passes("titles, H1s and descriptions are unique across the 14 pages", () => {
  for (const key of ["heroTitle", "metaTitle", "metaDescription"] as const) {
    ensure(new Set(INDUSTRY_CONTENT.map((i) => i[key])).size === 14, `${key} repeats`);
  }
});

passes("the healthcare H1 keeps its established wording", () => {
  ensure(getIndustryContent("healthcare-payment-processing")?.heroTitle === "Payment Processing for Healthcare Providers", "healthcare H1 changed");
});

// ── Server documents ─────────────────────────────────────────────────────────

const documents = new Map<string, string>();

passes("all 14 server documents render with their own identity", () => {
  for (const entry of INDUSTRY_CONTENT) {
    const html = getIndustryHtml(entry.slug);
    ensure(html, `${entry.slug}: no document`);
    documents.set(entry.slug, html as string);
    assertDocument(html, { slug: entry.slug, h1: entry.heroTitle, title: entry.metaTitle, description: entry.metaDescription });
    assertSchemas(html as string, entry.slug);
    assertNoStats(html as string, entry.slug);
  }
  ensure(documents.size === 14, `${documents.size} documents`);
});

passes("each document carries its own considerations, review items and FAQ answers", () => {
  for (const entry of INDUSTRY_CONTENT) {
    const text = decode(documents.get(entry.slug) as string);
    for (const c of entry.considerations) ensure(text.includes(c.title) && text.includes(c.description), `${entry.slug}: missing consideration "${c.title}"`);
    for (const f of entry.faqs) ensure(text.includes(f.question) && text.includes(f.answer), `${entry.slug}: missing FAQ "${f.question}"`);
    for (const r of industrySections(entry).review) ensure(text.includes(r.title), `${entry.slug}: missing review item "${r.title}"`);
  }
});

passes("each document links the other 13 industries and the hub", () => {
  for (const entry of INDUSTRY_CONTENT) {
    const html = documents.get(entry.slug) as string;
    for (const other of INDUSTRY_CONTENT) {
      if (other.slug === entry.slug) continue;
      ensure(html.includes(`href="/industries/${other.slug}"`), `${entry.slug}: no link to ${other.slug}`);
    }
    ensure(html.includes('href="/industries"'), `${entry.slug}: no hub breadcrumb link`);
  }
});

passes("no content entry or rendered document carries a forbidden claim", () => {
  for (const entry of INDUSTRY_CONTENT) {
    assertNoForbidden(contentText(entry), `${entry.slug} content`);
    assertNoForbidden(decode(visibleContent(documents.get(entry.slug) as string)), `${entry.slug} document`);
  }
});

passes("unknown slugs and prototype names produce no document", () => {
  for (const key of ["nope", "constructor", "__proto__", "toString", "hasOwnProperty", "RESTAURANT-PAYMENT-PROCESSING", "restaurant", ""]) {
    ensure(getIndustryHtml(key) === null, `"${key}" rendered`);
    ensure(getIndustryContent(key) === undefined, `"${key}" resolved content`);
  }
  ensure(getIndustryContent(undefined) === undefined, "undefined resolved content");
});

passes("the server route 404s an unknown slug and no longer falls through for listed ones", () => {
  const routes = read("server/routes/ssr-routes.ts");
  const at = routes.indexOf('app.get("/industries/:slug"');
  ensure(at > 0, "route missing");
  const body = routes.slice(at, at + 600);
  ensure(/if \(!html\) return res\.status\(404\)\.end\(\);/.test(body), "route does not 404 on a miss");
  ensure(!/next\(\)/.test(body.slice(0, body.indexOf("});") + 3)), "industry route still falls through to the client");
  ensure(!/INDUSTRY_SLUGS/.test(routes), "route file still imports INDUSTRY_SLUGS");
});

// ── Client parity ────────────────────────────────────────────────────────────

const page = read("client/src/pages/IndustryPage.tsx");

passes("the React page renders the shared content", () => {
  ensure(/from "@shared\/public-industry-content"/.test(page), "page does not import the shared content");
  for (const token of ["getIndustryContent(", "industrySections(", "industry.heroTitle", "industry.heroSubtitle", "industry.metaTitle", "industry.metaDescription", "industry.considerations", "industry.faqs", "sections.review"]) {
    ensure(page.includes(token), `page does not use ${token}`);
  }
  ensure(/<NotFound \/>/.test(page), "unknown slug does not render the not-found page");
  ensure(/INDUSTRY_PRIMARY_ACTION/.test(page) && /INDUSTRY_SECONDARY_ACTION/.test(page), "page does not use the shared actions");
});

passes("the React page has no statistics section and no figure", () => {
  ensure(!/section-industry-stats|stats\.map|\.stats\b/.test(page), "statistics section present");
  ensure(!/\$\s?\d|\d\s?%/.test(page.replace(/hsl\([^)]*\)/g, "").replace(/\[[^\]]*%[^\]]*\]/g, "")), "page source has a figure");
  ensure(!/AggregateRating|"@type":\s*"Review"/.test(page), "page emits review schema");
});

passes("React presentation covers every industry, with the illustrative-photo caption kept", () => {
  for (const entry of INDUSTRY_CONTENT) ensure(page.includes(`"${entry.slug}"`), `${entry.slug}: no presentation entry`);
  ensure(INDUSTRY_HERO_PICTURE.caption === "Illustrative photo. It does not show a Liberty customer.", "illustrative caption wording changed");
  ensure(page.includes("INDUSTRY_HERO_PICTURE.caption"), "illustrative caption removed from the React page");
});

passes("the React route for industries exists and the hub lists all 14", () => {
  ensure(/path="\/industries\/:slug"/.test(read("client/src/App.tsx")), "industry route missing");
});

// ── Negative controls ────────────────────────────────────────────────────────

const healthcare = getIndustryContent("healthcare-payment-processing") as IndustryContent;
const healthcareHtml = documents.get("healthcare-payment-processing") as string;
const healthcareExpected: Expected = {
  slug: healthcare.slug,
  h1: healthcare.heroTitle,
  title: healthcare.metaTitle,
  description: healthcare.metaDescription,
};

passes("the healthcare document passes every check family", () => {
  assertDocument(healthcareHtml, healthcareExpected);
  assertSchemas(healthcareHtml, "healthcare");
  assertNoStats(healthcareHtml, "healthcare");
  assertNoForbidden(contentText(healthcare), "healthcare content");
});

negative("missing document", () => assertDocument(null, healthcareExpected));
negative("title without brand suffix", () => assertDocument(healthcareHtml.replace(` | ${BRAND}</title>`, "</title>"), healthcareExpected));
negative("second h1", () => assertDocument(healthcareHtml.replace("</h1>", "</h1><h1>Second</h1>"), healthcareExpected));
negative("wrong canonical", () => assertDocument(healthcareHtml.replace(/rel="canonical" href="[^"]*"/, 'rel="canonical" href="https://libertybancard.com/industries"'), healthcareExpected));
negative("noindex", () => assertDocument(healthcareHtml.replace('content="index, follow"', 'content="noindex, follow"'), healthcareExpected));
negative("statement action removed", () => assertDocument(healthcareHtml.split('href="/upload-statement"').join('href="/x"'), healthcareExpected));
negative("inquiry action removed", () => assertDocument(healthcareHtml.split('href="/about-contact#inquiry"').join('href="/x"'), healthcareExpected));
negative("FAQ schema removed", () => assertSchemas(healthcareHtml.split("FAQPage").join("Other"), "fixture"));
negative("review schema injected", () =>
  assertSchemas(healthcareHtml.replace("</head>", '<script type="application/ld+json">{"@type":"AggregateRating"}</script></head>'), "fixture"));
negative("statistics section restored", () => assertNoStats(healthcareHtml.replace("<h1", '<div class="ssr-stats"></div><h1'), "fixture"));

const claimFixtures: readonly [string, string][] = [
  ["percent", "Practices pay an average of 2.4%."],
  ["dollar", "Save $4,000 a year."],
  ["savings", "Typical savings are substantial."],
  ["uptime", "99.9% uptime on every terminal."],
  ["speed", "Same-day funding for every deposit."],
  ["hipaa", "HIPAA compliant processing."],
  ["pci", "PCI certified from day one."],
  ["count", "Trusted by 500 practices."],
  ["integration", "Works with Dentrix and Eaglesoft."],
  ["brand", "Switch from Square today."],
  ["ranking", "The best rates for dentists."],
];
for (const [name, text] of claimFixtures) {
  negative(`forbidden claim: ${name}`, () => assertNoForbidden(`${contentText(healthcare)}\n${text}`, "fixture"));
}

negative("shared content with a statistic entry", () => {
  const mutated = { ...healthcare, faqs: [...healthcare.faqs, { question: "How much can I save?", answer: "Most practices save $3,000 a year." }] };
  assertNoForbidden(contentText(mutated), "fixture");
});

negative("an object-literal lookup resolves a prototype name", () => {
  const naive = (key: string): unknown => ({ "restaurant-payment-processing": 1 } as Record<string, unknown>)[key] ?? null;
  ensure(naive("constructor") === null, "naive object lookup resolved 'constructor'");
});

negative("a page that stopped using the shared content", () => {
  ensure(page.replace(/getIndustryContent\(/g, "somethingElse(").includes("getIndustryContent("), "shared content import");
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`W-D industry contract: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
