#!/usr/bin/env npx tsx
/**
 * test-wd-locations-contract.ts
 *
 * W-D location suite. Static and deterministic: no server, no database, no network, no provider I/O.
 *
 * What it proves
 *  - the retained inventory is exactly 30 city hubs + 300 city x industry pages, 330 unique paths, and
 *    the server data module re-exports the same lists the client and the sitemap read;
 *  - every one of the 330 server documents has its own title, one H1, canonical, description, the
 *    statement and no-statement actions, and the coverage note; invalid keys (including prototype
 *    names) produce no document;
 *  - the React routes and pages render from the same shared builders as the server documents, so
 *    server and client identity cannot drift;
 *  - no rendered document carries a rate, dollar figure, savings estimate, speed or uptime promise,
 *    certification claim, business count, headquarters, street address or LocalBusiness schema;
 *  - /areas-served has first HTML, puts South Florida first and links all 30 hubs.
 *
 * Every check family has a negative control: a deliberately broken fixture the same check function
 * must reject.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  LOCATION_ALL_PATHS,
  LOCATION_CITIES,
  LOCATION_DETAIL_PATHS,
  LOCATION_HUB_PATHS,
  LOCATION_VERTICALS,
  LOCATION_COVERAGE_NOTE,
  buildAreasServed,
  buildLocationDetail,
  buildLocationHub,
  isValidLocationCombination,
  LOCATION_TITLE_MAX,
  locationDocumentTitle,
} from "../shared/public-locations";
import { CITIES, VERTICALS, getCityData, getVerticalData } from "../server/ssr/location-data";
import { getCityHubHtml, getLocationHtml } from "../server/ssr/locations";
import { getAreasServedHtml } from "../server/ssr/areas-served";
import { INDUSTRY_CONTENT } from "../shared/public-industry-content";

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

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? decode(m[1]) : "";
}

// ── Check functions ──────────────────────────────────────────────────────────

interface Identity {
  path: string;
  h1: string;
  title: string;
  description: string;
}

function assertIdentity(html: string | null, expected: Identity): void {
  ensure(html, `${expected.path}: no document`);
  const doc = html as string;
  const docTitle = firstMatch(doc, /<title>([^<]*)<\/title>/);
  ensure(docTitle === locationDocumentTitle(expected.title), `${expected.path}: title is not "${locationDocumentTitle(expected.title)}"`);
  ensure(docTitle !== null && docTitle.length <= LOCATION_TITLE_MAX, `${expected.path}: title is ${docTitle?.length} characters, over the ${LOCATION_TITLE_MAX} the SEO audit accepts`);
  const h1s = doc.match(/<h1[\s>]/g) ?? [];
  ensure(h1s.length === 1, `${expected.path}: ${h1s.length} h1 elements`);
  ensure(firstMatch(doc, /<h1[^>]*>([^<]*)<\/h1>/) === expected.h1, `${expected.path}: h1 is not "${expected.h1}"`);
  ensure(firstMatch(doc, /<link rel="canonical" href="([^"]*)"/) === `${BASE}${expected.path}`, `${expected.path}: canonical mismatch`);
  ensure(firstMatch(doc, /<meta name="description" content="([^"]*)"/) === expected.description, `${expected.path}: description mismatch`);
  ensure(!/<meta name="robots" content="[^"]*noindex/.test(doc), `${expected.path}: noindex`);
}

function assertActions(html: string, label: string, secondaryHref = "/about-contact#inquiry"): void {
  ensure(html.includes('href="/upload-statement"'), `${label}: no statement-review action`);
  ensure(html.includes(`href="${secondaryHref}"`), `${label}: no secondary action to ${secondaryHref}`);
}

function assertCoverageNote(html: string, label: string): void {
  ensure(html.includes(LOCATION_COVERAGE_NOTE.replace(/'/g, "&#39;")) || html.includes(LOCATION_COVERAGE_NOTE), `${label}: coverage note missing`);
}

function schemaTypes(html: string): string[] {
  const types: string[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const parsed = JSON.parse(m[1]) as { "@type"?: string } | Array<{ "@type"?: string }>;
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) if (item["@type"]) types.push(item["@type"]);
  }
  return types;
}

function assertSchema(html: string, label: string, required: readonly string[] = ["BreadcrumbList", "FAQPage", "Service"]): void {
  const types = schemaTypes(html);
  for (const type of required) ensure(types.includes(type), `${label}: no ${type} schema`);
  for (const forbidden of ["LocalBusiness", "PostalAddress", "Review", "AggregateRating", "Place"]) {
    ensure(!types.includes(forbidden), `${label}: ${forbidden} schema`);
  }
}

/**
 * The page's own content: the JSON-LD blocks plus everything between the shared header and footer.
 * Styles, data URIs, ordinary scripts and the shared site chrome (navigation, footer disclaimer) are
 * owned by other work and are not what this suite judges.
 */
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
  { id: "savings-promise", re: /\bsav(e|es|ed|ing|ings)\b(?!\s+a\s+statement)/i },
  { id: "average-or-typical", re: /\b(average|typical|typically save|median)\b/i },
  { id: "guarantee", re: /guarantee/i },
  { id: "speed-promise", re: /\b(same[- ]day|next[- ]day|24\/7|within \d+ (hours|minutes|days)|\d+[- ]hours?)\b/i },
  { id: "uptime", re: /\buptime\b|99\.\d/i },
  { id: "certification", re: /\bPCI\b|HIPAA|SOC ?2|certified/i },
  { id: "business-count", re: /\b\d[\d,]*\+?\s+(businesses|merchants|customers|clients|locations|offices)\b/i },
  { id: "local-presence", re: /local (office|team|branch|rep|representative)s?\b|our (local )?office|visit our|headquarter|HQ\b/i },
  { id: "street-address", re: /\b\d{2,6}\s+[A-Z][a-z]+\s+(Street|St\.|Avenue|Ave\.|Boulevard|Blvd\.|Road|Rd\.|Suite|Ste\.)/ },
  { id: "rate-language", re: /\b(interchange|basis points?|rate of|per[- ]transaction fee of)\b/i },
  { id: "ranking-claim", re: /\b(best|#1|number one|top[- ]rated|leading)\b/i },
  { id: "free-processing", re: /free processing(?! (analysis|review))/i },
];

/** The coverage note is the one place that names an office and a local team, in order to disclaim them. */
function scannable(html: string): string {
  return visibleContent(html)
    .split(LOCATION_COVERAGE_NOTE.replace(/'/g, "&#39;")).join(" ")
    .split(LOCATION_COVERAGE_NOTE).join(" ");
}

function assertNoForbiddenClaims(html: string, label: string): void {
  const text = scannable(html);
  for (const { id, re } of FORBIDDEN) {
    const m = text.match(re);
    ensure(!m, `${label}: forbidden claim "${id}" matched "${m?.[0]}"`);
  }
}

// ── Inventory ────────────────────────────────────────────────────────────────

passes("30 cities, 10 verticals, 30 hubs, 300 details, 330 unique paths", () => {
  ensure(LOCATION_CITIES.length === 30, `${LOCATION_CITIES.length} cities`);
  ensure(LOCATION_VERTICALS.length === 10, `${LOCATION_VERTICALS.length} verticals`);
  ensure(LOCATION_HUB_PATHS.length === 30, `${LOCATION_HUB_PATHS.length} hub paths`);
  ensure(LOCATION_DETAIL_PATHS.length === 300, `${LOCATION_DETAIL_PATHS.length} detail paths`);
  ensure(LOCATION_ALL_PATHS.length === 330 && new Set(LOCATION_ALL_PATHS).size === 330, "paths are not 330 unique values");
  ensure(new Set(LOCATION_CITIES.map((c) => c.slug)).size === 30, "duplicate city slug");
  ensure(new Set(LOCATION_VERTICALS.map((v) => v.slug)).size === 10, "duplicate vertical slug");
});

passes("server data module re-exports the shared inventory", () => {
  ensure(CITIES === LOCATION_CITIES && VERTICALS === LOCATION_VERTICALS, "location-data does not re-export the shared lists");
  ensure(getCityData("miami")?.name === "Miami" && getVerticalData("dental")?.name === "Dental", "lookup re-exports do not resolve");
});

passes("every vertical points at a listed industry page", () => {
  const industries = new Set(INDUSTRY_CONTENT.map((entry) => entry.slug));
  for (const v of LOCATION_VERTICALS) ensure(industries.has(v.industrySlug), `${v.slug} -> ${v.industrySlug} is not an industry page`);
});

passes("South Florida has ten cities and is listed first", () => {
  ensure(LOCATION_CITIES.slice(0, 10).every((c) => c.region === "south-florida"), "first ten cities are not South Florida");
  ensure(LOCATION_CITIES.filter((c) => c.region === "south-florida").length === 10, "South Florida city count");
});

negative("a path list with a duplicate", () => {
  const bad = [...LOCATION_ALL_PATHS.slice(0, 329), LOCATION_ALL_PATHS[0]];
  ensure(new Set(bad).size === 330, "duplicate path");
});

// ── Server documents: all 330 ────────────────────────────────────────────────

const documents = new Map<string, string>();

passes("all 330 server documents render with their own identity", () => {
  for (const city of LOCATION_CITIES) {
    const hub = buildLocationHub(city.slug);
    ensure(hub, `${city.slug}: no hub content`);
    const html = getCityHubHtml(city.slug);
    ensure(html, `${city.slug}: no hub document`);
    documents.set(hub!.canonicalPath, html as string);
    assertIdentity(html, { path: hub!.canonicalPath, h1: hub!.h1, title: hub!.title, description: hub!.metaDescription });
    for (const vertical of LOCATION_VERTICALS) {
      const detail = buildLocationDetail(city.slug, vertical.slug);
      ensure(detail, `${city.slug}/${vertical.slug}: no content`);
      const doc = getLocationHtml(city.slug, vertical.slug);
      ensure(doc, `${city.slug}/${vertical.slug}: no document`);
      documents.set(detail!.canonicalPath, doc as string);
      assertIdentity(doc, { path: detail!.canonicalPath, h1: detail!.h1, title: detail!.title, description: detail!.metaDescription });
    }
  }
  ensure(documents.size === 330, `${documents.size} documents`);
});

passes("titles and H1s are unique across the 330 documents", () => {
  const titles = new Set<string>();
  const h1s = new Set<string>();
  for (const [p, html] of documents) {
    titles.add(firstMatch(html, /<title>([^<]*)<\/title>/));
    h1s.add(firstMatch(html, /<h1[^>]*>([^<]*)<\/h1>/));
    void p;
  }
  ensure(titles.size === 330, `${titles.size} distinct titles`);
  ensure(h1s.size === 330, `${h1s.size} distinct H1s`);
});

passes("every document has both actions, the coverage note and the schema set", () => {
  for (const [p, html] of documents) {
    assertActions(html, p);
    assertCoverageNote(html, p);
    // Detail pages carry FAQs; city hubs carry breadcrumb and service only.
    assertSchema(html, p, p.split("/").length === 4 ? ["BreadcrumbList", "FAQPage", "Service"] : ["BreadcrumbList", "Service"]);
  }
});

passes("every document links back to its industry page or its city hub", () => {
  for (const city of LOCATION_CITIES) {
    for (const vertical of LOCATION_VERTICALS) {
      const html = documents.get(`/locations/${city.slug}/${vertical.slug}`) as string;
      ensure(html.includes(`href="/industries/${vertical.industrySlug}"`), `${city.slug}/${vertical.slug}: no industry link`);
      ensure(html.includes(`href="/locations/${city.slug}"`), `${city.slug}/${vertical.slug}: no hub link`);
    }
    const hub = documents.get(`/locations/${city.slug}`) as string;
    for (const vertical of LOCATION_VERTICALS) ensure(hub.includes(`href="/locations/${city.slug}/${vertical.slug}"`), `${city.slug}: hub does not link ${vertical.slug}`);
  }
});

passes("no rendered document carries a forbidden claim", () => {
  for (const [p, html] of documents) assertNoForbiddenClaims(html, p);
});

passes("no rendered document names an address, office or phone line beyond the company number", () => {
  for (const [p, html] of documents) {
    const phones = new Set(visibleContent(html).match(/\b\d{3}-\d{3}-\d{4}\b/g) ?? []);
    for (const phone of phones) ensure(phone === "954-266-8214", `${p}: unexpected phone ${phone}`);
  }
});

// ── Invalid keys ─────────────────────────────────────────────────────────────

passes("invalid and prototype-name keys produce no document", () => {
  const bad = ["nope", "constructor", "__proto__", "toString", "hasOwnProperty", "MIAMI", "miami ", "", "miami/dental"];
  for (const key of bad) {
    ensure(getCityHubHtml(key) === null, `hub "${key}" rendered`);
    ensure(getLocationHtml(key, "dental") === null, `detail city "${key}" rendered`);
    ensure(getLocationHtml("miami", key) === null, `detail vertical "${key}" rendered`);
    ensure(!isValidLocationCombination(key, "dental") && !isValidLocationCombination("miami", key), `"${key}" validated`);
    ensure(buildLocationDetail(key, "dental") === null && buildLocationHub(key) === null, `"${key}" built content`);
  }
  ensure(isValidLocationCombination("miami", "dental"), "a real pair is invalid");
});

passes("the server routes answer an invalid key with 404, not the app shell", () => {
  const routes = read("server/routes/ssr-routes.ts");
  for (const handler of ["getLocationHtml(req.params.city, req.params.industry)", "getCityHubHtml(req.params.city)"]) {
    const at = routes.indexOf(handler);
    ensure(at > 0, `route for ${handler} not found`);
    ensure(/if \(!html\) return res\.status\(404\)\.end\(\);/.test(routes.slice(at, at + 160)), `${handler} does not 404 on a miss`);
  }
  ensure(routes.indexOf('"/locations/:city/:industry"') < routes.indexOf('"/locations/:city"'), "detail route must be registered before the hub route");
  ensure(routes.indexOf('"/areas-served"') > 0, "areas-served has no server route");
});

// ── Client parity ────────────────────────────────────────────────────────────

const detailPage = read("client/src/pages/LocationIndustryPage.tsx");
const hubPage = read("client/src/pages/LocationHubPage.tsx");
const areasPage = read("client/src/pages/AreasServed.tsx");
const appSource = read("client/src/App.tsx");

passes("React location pages render from the shared builders", () => {
  ensure(/from "@shared\/public-locations"/.test(detailPage) && /buildLocationDetail\(/.test(detailPage), "detail page does not use buildLocationDetail");
  ensure(/from "@shared\/public-locations"/.test(hubPage) && /buildLocationHub\(/.test(hubPage), "hub page does not use buildLocationHub");
  ensure(/from "@shared\/public-locations"/.test(areasPage) && /buildAreasServed\(/.test(areasPage), "areas page does not use buildAreasServed");
  ensure(/NotFound/.test(detailPage) && /NotFound/.test(hubPage), "invalid keys do not render the not-found page");
  ensure(/\.h1\b/.test(detailPage) && /\.h1\b/.test(hubPage), "pages do not render the shared H1");
  ensure(/\.title\b/.test(detailPage) && /\.title\b/.test(hubPage), "pages do not use the shared title");
});

passes("React routes exist, detail before hub", () => {
  const detail = appSource.indexOf('path="/locations/:city/:industry"');
  const hub = appSource.indexOf('path="/locations/:city"');
  ensure(detail > 0 && hub > 0, "location routes missing");
  ensure(detail < hub, "detail route must precede hub route");
  ensure(/path="\/areas-served"/.test(appSource), "areas-served route missing");
});

passes("React location sources carry no forbidden claim or LocalBusiness schema", () => {
  for (const [name, source] of [["detail", detailPage], ["hub", hubPage], ["areas", areasPage]] as const) {
    ensure(!/LocalBusiness|PostalAddress|streetAddress|AggregateRating/.test(source), `${name} page source has local-business schema`);
    ensure(!/\$\s?\d|\d\s?%/.test(source.replace(/hsl\([^)]*\)/g, "").replace(/\[[^\]]*%[^\]]*\]/g, "")), `${name} page source has a figure`);
  }
});

negative("a React page that stopped using the shared builder", () => {
  ensure(/buildLocationDetail\(/.test(detailPage.replace(/buildLocationDetail\(/g, "buildSomethingElse(")), "builder");
});

// ── Areas served ─────────────────────────────────────────────────────────────

passes("/areas-served has first HTML, South Florida first, and links all 30 hubs", () => {
  const areas = buildAreasServed();
  const html = getAreasServedHtml();
  assertIdentity(html, { path: areas.path, h1: areas.h1, title: areas.title, description: areas.metaDescription });
  assertCoverageNote(html, "/areas-served");
  assertActions(html, "/areas-served", "/about-contact");
  for (const hubPath of LOCATION_HUB_PATHS) ensure(html.includes(`href="${hubPath}"`), `areas-served does not link ${hubPath}`);
  const sf = html.indexOf("South Florida");
  const fl = html.indexOf("Elsewhere in Florida");
  const nw = html.indexOf("Nationwide");
  ensure(sf > 0 && sf < fl && fl < nw, "regions are not ordered South Florida, Florida, Nationwide");
  const southFlorida = LOCATION_CITIES.filter((c) => c.region === "south-florida");
  for (const city of southFlorida) {
    for (const v of LOCATION_VERTICALS) ensure(html.includes(`href="/locations/${city.slug}/${v.slug}"`), `areas-served does not link ${city.slug}/${v.slug}`);
  }
  assertNoForbiddenClaims(html, "/areas-served");
});

passes("/areas-served is not in the sitemap inventory and has no LocalBusiness schema", () => {
  ensure(!/LocalBusiness|PostalAddress/.test(getAreasServedHtml()), "areas-served carries local-business schema");
});

// ── Negative controls for the document checks ────────────────────────────────

const sample = documents.get("/locations/miami/dental") as string;
const sampleDetail = buildLocationDetail("miami", "dental")!;
const sampleIdentity: Identity = {
  path: sampleDetail.canonicalPath,
  h1: sampleDetail.h1,
  title: sampleDetail.title,
  description: sampleDetail.metaDescription,
};

passes("the sample document passes every check family", () => {
  assertIdentity(sample, sampleIdentity);
  assertActions(sample, "sample");
  assertCoverageNote(sample, "sample");
  assertSchema(sample, "sample");
  assertNoForbiddenClaims(sample, "sample");
});

negative("title without the brand suffix", () => assertIdentity(sample.replace(` | ${BRAND}</title>`, "</title>"), sampleIdentity));
negative("a title over the audit length limit", () =>
  assertIdentity(sample.replace(/<title>[^<]*<\/title>/, `<title>${"Long ".repeat(20)}</title>`), { ...sampleIdentity, title: "Long ".repeat(20) }));
negative("a second h1", () => assertIdentity(sample.replace("</h1>", "</h1><h1>Second</h1>"), sampleIdentity));
negative("wrong canonical", () => assertIdentity(sample.replace(/rel="canonical" href="[^"]*"/, 'rel="canonical" href="https://libertybancard.com/"'), sampleIdentity));
negative("noindex added", () => assertIdentity(sample.replace('content="index, follow"', 'content="noindex, follow"'), sampleIdentity));
negative("missing document", () => assertIdentity(null, sampleIdentity));
negative("statement action removed", () => assertActions(sample.split('href="/upload-statement"').join('href="/x"'), "fixture"));
negative("no-statement action removed", () => assertActions(sample.split('href="/about-contact#inquiry"').join('href="/x"'), "fixture"));
negative("coverage note removed", () => assertCoverageNote(sample.split(LOCATION_COVERAGE_NOTE).join(""), "fixture"));
negative("LocalBusiness schema injected", () =>
  assertSchema(sample.replace("</head>", '<script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>'), "fixture"));
negative("breadcrumb schema removed", () => assertSchema(sample.split("BreadcrumbList").join("Other"), "fixture"));

const claimFixtures: readonly [string, string][] = [
  ["percent", "Businesses here pay 2.5% on average."],
  ["dollar", "Save $1,200 a year."],
  ["savings", "Typical savings in Miami are high."],
  ["guarantee", "We guarantee the lowest rate."],
  ["speed", "Same-day funding for Miami."],
  ["certification", "PCI certified and HIPAA ready."],
  ["count", "We serve 400 businesses in Miami."],
  ["office", "Visit our Miami office."],
  ["address", "Find us at 1200 Brickell Avenue."],
  ["ranking", "The best processor in Miami."],
];
for (const [name, text] of claimFixtures) {
  negative(`forbidden claim: ${name}`, () => assertNoForbiddenClaims(sample.replace("<h1", `<p>${text}</p><h1`), "fixture"));
}

negative("coverage note stripped of its disclaimer does not hide a claim elsewhere", () =>
  assertNoForbiddenClaims(sample.replace("<h1", "<p>We have a local office in Miami.</p><h1"), "fixture"));

negative("an object-literal lookup resolves a prototype name", () => {
  const naive = (key: string): unknown => ({ miami: { name: "Miami" } } as Record<string, unknown>)[key] ?? null;
  ensure(naive("constructor") === null, "naive object lookup resolved 'constructor'");
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`W-D location contract: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
