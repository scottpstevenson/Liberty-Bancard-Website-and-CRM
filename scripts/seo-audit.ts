/**
 * scripts/seo-audit.ts — CI script.
 *
 * Audits every URL the site emits, not a sample. The roster is the union of
 *   - SEO_ROUTE_DEFAULTS (static routes),
 *   - the generated families (compare, city hubs, city x industry, industries, partners, conversion pages), and
 *   - EVERY URL listed in /sitemap.xml and the sitemaps it indexes (core, blog, locations, compare, glossary,
 *     including the alternatives, switch-from and glossary-term families).
 * The sitemap is read from the running server, so a family added to a sitemap is audited without editing this file.
 * A sitemap that cannot be read, lists a URL twice, or lists a URL that does not answer 200 fails the audit.
 *
 * First-HTML checks (server-rendered pages):
 *   - <title> 30-70 characters (decoded; counts the " | Liberty Bancard" suffix) and the site name not doubled
 *   - <meta name="description"> 100-165 characters, <link rel="canonical">, og:title, og:image
 *   - at least one <script type="application/ld+json">, exactly one <h1> on indexable pages
 *   - <meta name="robots"> noindex on auth/thank-you routes, never on conversion pages
 *
 * Client-rendered pages (the first response is the React app shell with an empty <title>) are not "missing metadata":
 * they are classified separately and their metadata is read AFTER hydration in private Chromium, then held to the same
 * title budget, a single h1, a canonical that names the page, and a page-specific description. The first-HTML versus
 * hydrated difference is printed for every such page family instead of being passed silently. /blog, /blog/:slug and
 * /free-smart-terminal also answer known crawlers with server HTML; that representation is audited too, and both
 * representations must carry Vary: User-Agent.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more routes failed validation
 *
 * Run:   tsx scripts/seo-audit.ts
 *        BASE_URL=https://libertybancard.com tsx scripts/seo-audit.ts
 */

import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import { CITIES, VERTICALS } from "../server/ssr/location-data";
import { COMPETITOR_DATA } from "../server/ssr/compare";
import { INDUSTRY_DATA } from "../server/ssr/industries";
import { launchBrowser } from "./lib/public-site-browser";

const BASE = process.env.SEO_AUDIT_BASE_URL || process.env.BASE_URL || "http://localhost:5000";
const SITE = "https://libertybancard.com";
const BRAND = "Liberty Bancard";
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const AUDIT_UA = "LibertyBancardSeoAudit/1.0";
const BLOCKED_VENDORS = ["leadconnectorhq.com", "google-analytics.com", "googletagmanager.com", "facebook.net", "clarity.ms"];

interface RouteSpec {
  path: string;
  noindex?: boolean;
  dynamic?: true; // set for generated/dynamic routes not in SEO_ROUTE_DEFAULTS
  noindexForbidden?: true; // conversion pages that must NOT have noindex
  requireCanonical?: true; // Wave 12: explicitly verify canonical tag present
  fromSitemap?: true; // listed in a sitemap: a non-200 is always an error
  sitemap?: string; // which sitemap file lists it
}

interface AuditResult {
  path: string;
  family: string;
  status: number;
  errors: string[];
  warnings: string[];
  /** The first response was the React app shell (empty title), not server HTML. */
  clientRendered: boolean;
  noindex: boolean;
}

const TITLE_MIN = 30;
const TITLE_MAX = 70; // 70 accounts for page-specific title + " | Liberty Bancard" suffix
const DESC_MIN = 100;
const DESC_MAX = 165;

// ── Pure helpers (also exercised by the self-test below) ──────────────────────

/** Titles are measured as a browser tab shows them: entities decoded, whitespace collapsed. */
export function decodeTitle(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** The project title rule: 30-70 characters including the brand suffix, and the site name never doubled. */
export function titleProblems(title: string): string[] {
  const problems: string[] = [];
  if (title.length < TITLE_MIN) problems.push(`title short (${title.length}<${TITLE_MIN})`);
  if (title.length > TITLE_MAX) problems.push(`title long (${title.length}>${TITLE_MAX})`);
  const brandCount = (title.match(new RegExp(BRAND, "gi")) ?? []).length;
  if (brandCount > 1 && /\|\s*Liberty Bancard\s*\|\s*Liberty Bancard\s*$/i.test(title)) problems.push("site name doubled in title");
  return problems;
}

/** A first response is a client-rendered app shell when it has no <title> text and carries the React mount point. */
export function isAppShell(html: string): boolean {
  const title = decodeTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return title === "" && /vite\/client|@react-refresh|id=["']root["']/.test(html);
}

export function familyOf(path: string): string {
  const seg = path.split("/")[1] ?? "";
  if (!seg) return "home";
  if (path.startsWith("/locations/")) return path.split("/").length > 3 ? "locations (city x industry)" : "locations (city hub)";
  return seg;
}

/** Families the server always renders as HTML: a bare app shell there is a regression, not a client-rendered page. */
const SERVER_RENDERED_FAMILIES = new Set(["alternatives", "switch-from", "learn", "compare", "locations (city hub)", "locations (city x industry)", "industries"]);

/** Union of the code-defined roster and the sitemap roster; a sitemap URL is never dropped. */
export function mergeRoster(base: RouteSpec[], sitemap: { path: string; sitemap: string }[]): RouteSpec[] {
  const byPath = new Map<string, RouteSpec>();
  for (const spec of base) if (!byPath.has(spec.path)) byPath.set(spec.path, spec);
  for (const entry of sitemap) {
    const existing = byPath.get(entry.path);
    if (existing) {
      existing.fromSitemap = true;
      existing.sitemap = entry.sitemap;
    } else {
      const spec: RouteSpec = { path: entry.path, fromSitemap: true, sitemap: entry.sitemap };
      if (SERVER_RENDERED_FAMILIES.has(familyOf(entry.path))) spec.dynamic = true;
      byPath.set(entry.path, spec);
    }
  }
  return [...byPath.values()];
}

export function duplicates(paths: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of paths) (seen.has(p) ? dup : seen).add(p);
  return [...dup];
}

function pickAttr(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  return m ? (m[1] || "").trim() : null;
}

// Static routes from the central defaults map
const STATIC_ROUTES: RouteSpec[] = Object.entries(SEO_ROUTE_DEFAULTS).map(([path, def]) => ({
  path,
  noindex: !!def.noindex,
}));

// All competitor compare pages — sourced from COMPETITOR_DATA (single source of truth)
const COMPARE_ROUTES: RouteSpec[] = Object.values(COMPETITOR_DATA).map((d) => ({
  path: `/compare/${d.slug}`,
  dynamic: true,
}));

// All city hub pages
const CITY_HUB_ROUTES: RouteSpec[] = CITIES.map((c) => ({
  path: `/locations/${c.slug}`,
  dynamic: true,
}));

// All city × vertical routes (full cross-product)
const CITY_VERTICAL_ROUTES: RouteSpec[] = CITIES.flatMap((c) =>
  VERTICALS.map((v) => ({
    path: `/locations/${c.slug}/${v.slug}`,
    dynamic: true,
  }))
);

// All industry hub pages — sourced from INDUSTRY_DATA (owns the slug format)
const INDUSTRY_ROUTES: RouteSpec[] = Object.keys(INDUSTRY_DATA).map((slug) => ({
  path: `/industries/${slug}`,
  dynamic: true,
}));

// ── Wave 12: Partner pages — verify 200, unique title, description, canonical
// NOTE: /partners/insurance-agent does NOT exist — use /partners/insurance.
const PARTNER_ROUTES: RouteSpec[] = [
  { path: "/partners",            requireCanonical: true },
  { path: "/partners/cpa",        requireCanonical: true },
  { path: "/partners/bookkeeper", requireCanonical: true },
  { path: "/partners/insurance",  requireCanonical: true },
];

// ── Wave 12: Conversion pages that must NOT have noindex ─────────────────────
const NOINDEX_FORBIDDEN_ROUTES: RouteSpec[] = [
  { path: "/upload-statement",    noindexForbidden: true },
  { path: "/get-started",         noindexForbidden: true },
  { path: "/free-analysis",       noindexForbidden: true },
  { path: "/free-smart-terminal", noindexForbidden: true },
  { path: "/beat-square-stripe",  noindexForbidden: true },
];

const CODE_ROSTER: RouteSpec[] = [
  ...STATIC_ROUTES,
  ...COMPARE_ROUTES,
  ...CITY_HUB_ROUTES,
  ...CITY_VERTICAL_ROUTES,
  ...INDUSTRY_ROUTES,
  ...PARTNER_ROUTES,
  ...NOINDEX_FORBIDDEN_ROUTES,
];

// ── Sitemap roster ────────────────────────────────────────────────────────────

const locsOf = (xml: string): string[] => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const pathOf = (loc: string): string => {
  const url = new URL(loc, SITE);
  return url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
};

async function loadSitemapRoster(errors: string[]): Promise<{ path: string; sitemap: string }[]> {
  const roster: { path: string; sitemap: string }[] = [];
  let indexXml = "";
  try {
    const res = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) {
      errors.push(`/sitemap.xml answered HTTP ${res.status}; the roster cannot be completed`);
      return roster;
    }
    indexXml = await res.text();
  } catch (e: unknown) {
    errors.push(`/sitemap.xml could not be read (${e instanceof Error ? e.message : String(e)}); the roster cannot be completed`);
    return roster;
  }
  const children = /<sitemapindex/i.test(indexXml) ? locsOf(indexXml).map(pathOf) : [];
  if (children.length === 0) {
    // A plain urlset: the index itself lists the URLs.
    for (const loc of locsOf(indexXml)) roster.push({ path: pathOf(loc), sitemap: "sitemap.xml" });
  }
  for (const child of children) {
    try {
      const res = await fetch(`${BASE}${child}`, { signal: AbortSignal.timeout(15_000) });
      if (res.status !== 200) {
        errors.push(`${child} answered HTTP ${res.status}`);
        continue;
      }
      const locs = locsOf(await res.text());
      if (locs.length === 0) errors.push(`${child} lists no URLs`);
      for (const loc of locs) roster.push({ path: pathOf(loc), sitemap: child.replace(/^\//, "") });
    } catch (e: unknown) {
      errors.push(`${child} could not be read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  for (const dup of duplicates(roster.map((r) => r.path))) errors.push(`sitemap lists ${dup} more than once`);
  return roster;
}

// ── First-HTML audit ──────────────────────────────────────────────────────────

/** Head checks on a server-rendered document. Pure: used for the live pages, the crawler documents and the self-test. */
function checkServerHead(html: string, spec: RouteSpec): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const titleRaw = pickAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleRaw === null) {
    errors.push("missing <title>");
  } else {
    errors.push(...titleProblems(decodeTitle(titleRaw)));
  }

  const desc = pickAttr(html, /<meta\s+name=["']description["']\s+content="([^"]*)"/i);
  if (!desc) {
    errors.push("missing meta description");
  } else {
    if (desc.length < DESC_MIN) errors.push(`description short (${desc.length}<${DESC_MIN})`);
    if (desc.length > DESC_MAX) errors.push(`description long (${desc.length}>${DESC_MAX})`);
  }

  const canonical = pickAttr(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!canonical) errors.push("missing canonical link");

  const ogTitle = pickAttr(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (!ogTitle) errors.push("missing og:title");

  const ogImage = pickAttr(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (!ogImage) errors.push("missing og:image");

  const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
  if (!jsonLdMatches || jsonLdMatches.length === 0) {
    errors.push("missing JSON-LD structured data");
  }

  // H1 check: every indexable SSR page must have exactly one <h1>
  // Conversion pages (noindexForbidden) must have exactly one H1 — multiple is a hard FAIL.
  const h1Matches = html.match(/<h1[\s>]/gi);
  if (!spec.noindex) {
    if (!h1Matches || h1Matches.length === 0) {
      errors.push("missing <h1> — indexable page has no primary heading");
    } else if (h1Matches.length > 1) {
      if (spec.noindexForbidden) {
        // Conversion pages must have exactly one H1 — multiple H1 degrades SEO clarity on lead-gen pages
        errors.push(`conversion page has ${h1Matches.length} <h1> tags — must have exactly one; remove extras`);
      } else {
        warnings.push(`multiple <h1> tags (${h1Matches.length}) — only one recommended per page`);
      }
    }
  }

  const robots = pickAttr(html, /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  if (spec.noindex) {
    if (!robots || !/noindex/i.test(robots)) {
      errors.push("expected noindex on auth/thank-you route");
    }
  } else if (spec.noindexForbidden) {
    // Wave 12: conversion pages must NOT have a noindex directive
    if (robots && /noindex/i.test(robots)) {
      errors.push(`conversion page has noindex (robots="${robots}") — this blocks organic indexing and must be removed`);
    }
  } else if (robots && /noindex/i.test(robots)) {
    warnings.push("public route is noindex — verify intent");
  }

  // Wave 12: partner pages must have canonical
  if (spec.requireCanonical && !canonical) {
    errors.push("partner page missing canonical link — required for Wave 12 SEO compliance");
  }
  return { errors, warnings };
}

async function auditRoute(spec: RouteSpec): Promise<AuditResult> {
  const url = `${BASE}${spec.path}`;
  const errors: string[] = [];
  const warnings: string[] = [];
  const family = familyOf(spec.path);
  const base = { path: spec.path, family, noindex: !!spec.noindex };
  let status = 0;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": AUDIT_UA },
    });
    status = res.status;
    if (status >= 400) {
      // In default mode, 404s on dynamic routes (location×vertical, compare,
      // industry) that the sitemap does not list are warnings. A URL that a
      // sitemap lists must answer 200, and in strict mode (STRICT=1) every 404
      // is a CI failure so the full public route surface is verified before any deploy.
      const isStrict = process.env.STRICT === "1";
      const msg = `HTTP ${status}`;
      if (!isStrict && spec.dynamic && !spec.fromSitemap && status === 404) {
        warnings.push(msg);
      } else {
        errors.push(msg);
      }
      return { ...base, status, errors, warnings, clientRendered: false };
    }
    const html = await res.text();

    // A client-rendered page answers with the React shell: an empty <title>, filled by react-helmet-async after mount.
    if (isAppShell(html)) {
      // Dynamic SSR routes (compare, location, industry) should NEVER be SPA shells —
      // flag as error so regression is caught immediately.
      if (spec.dynamic) {
        errors.push("SSR route returned a bare SPA shell — server-side rendering is broken for this path");
        return { ...base, status, errors, warnings, clientRendered: false };
      }
      // Static SPA routes: SEO_ROUTE_DEFAULTS is the source of truth the shell falls back to.
      const def = SEO_ROUTE_DEFAULTS[spec.path];
      if (def && !spec.noindex) {
        const tl = def.title.length;
        const dl = def.description.length;
        if (tl < TITLE_MIN) errors.push(`SPA defaults: title short (${tl}<${TITLE_MIN})`);
        if (tl > TITLE_MAX) errors.push(`SPA defaults: title long (${tl}>${TITLE_MAX})`);
        if (dl < DESC_MIN) errors.push(`SPA defaults: description short (${dl}<${DESC_MIN})`);
        if (dl > DESC_MAX) errors.push(`SPA defaults: description long (${dl}>${DESC_MAX})`);
      } else if (def) {
        // noindex routes (auth, dashboard, thank-you) are not crawled: length violations are advisory only.
        const tl = def.title.length;
        const dl = def.description.length;
        if (tl < TITLE_MIN || tl > TITLE_MAX) warnings.push(`noindex route title length advisory (${tl})`);
        if (dl < DESC_MIN || dl > DESC_MAX) warnings.push(`noindex route description length advisory (${dl})`);
        warnings.push("noindex applied via client-side Helmet (verify in source)");
      } else if (!spec.fromSitemap) {
        errors.push("SPA shell: route absent from SEO_ROUTE_DEFAULTS — no guaranteed title/description");
      }
      // Sitemap-listed client-rendered pages without a defaults entry are checked after hydration (see below).
      return { ...base, status, errors, warnings, clientRendered: true };
    }

    const head = checkServerHead(html, spec);
    errors.push(...head.errors);
    warnings.push(...head.warnings);
  } catch (e: unknown) {
    errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { ...base, status, errors, warnings, clientRendered: false };
}

async function waitForServer(maxWaitMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      return; // server is up
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`Server at ${BASE} did not become ready within ${maxWaitMs / 1000}s`);
}

/** Runs `fn` over `items` with a bounded number in flight; results keep input order. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ── Crawler representation (user-agent branched pages) ───────────────────────

const CRAWLER_BRANCHED = (p: string): boolean => p === "/blog" || p === "/free-smart-terminal" || p.startsWith("/blog/");

interface CrawlerResult {
  path: string;
  errors: string[];
}

async function auditCrawlerRepresentation(spec: RouteSpec): Promise<CrawlerResult> {
  const errors: string[] = [];
  try {
    const crawler = await fetch(`${BASE}${spec.path}`, { headers: { "User-Agent": CRAWLER_UA }, redirect: "follow" });
    const browser = await fetch(`${BASE}${spec.path}`, { headers: { "User-Agent": AUDIT_UA, Accept: "text/html" }, redirect: "follow" });
    if (crawler.status !== 200) errors.push(`crawler representation answered HTTP ${crawler.status}`);
    const html = await crawler.text();
    await browser.text();
    if (isAppShell(html)) errors.push("crawler representation is the bare app shell");
    else errors.push(...checkServerHead(html, { ...spec, noindex: false, noindexForbidden: spec.noindexForbidden }).errors.map((e) => `crawler HTML: ${e}`));
    for (const [label, res] of [["crawler", crawler], ["browser", browser]] as const) {
      const vary = res.headers.get("vary") ?? "";
      if (!/(^|,)\s*user-agent\s*(,|$)/i.test(vary)) errors.push(`${label} response has Vary "${vary}" without User-Agent, so a shared cache can serve the wrong representation`);
    }
    const crawlerCache = crawler.headers.get("cache-control") ?? "";
    const browserCache = browser.headers.get("cache-control") ?? "";
    if (/public/i.test(browserCache)) errors.push(`browser response is publicly cacheable (${browserCache}) while it is the app shell`);
    if (!crawlerCache) errors.push("crawler response has no Cache-Control");
  } catch (e: unknown) {
    errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { path: spec.path, errors };
}

// ── Hydrated metadata (client-rendered pages) ────────────────────────────────

interface HydratedObservation {
  title: string;
  helmetDescription: string | null;
  descriptionTags: number;
  canonicals: string[];
  robots: string | null;
  h1s: number;
}

const HYDRATED_PROBE = `(() => ({
  title: document.title.replace(/\\s+/g, ' ').trim(),
  helmetDescription: (document.head.querySelector('meta[name="description"][data-rh]') || {}).content ?? null,
  descriptionTags: document.head.querySelectorAll('meta[name="description"]').length,
  canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.href),
  robots: (document.head.querySelector('meta[name="robots"]') || {}).content ?? null,
  h1s: document.querySelectorAll('h1').length,
}))()`;

/** Strict problems and advisory notes for one hydrated page. Pure so the self-test can exercise it. */
export function hydratedFindings(path: string, o: HydratedObservation): { errors: string[]; advisories: string[] } {
  const errors: string[] = [];
  const advisories: string[] = [];
  if (!o.title) errors.push("hydrated title is empty");
  else errors.push(...titleProblems(o.title).map((p) => `hydrated ${p}`));
  if (o.h1s !== 1) errors.push(`hydrated page has ${o.h1s} h1 elements, expected exactly 1`);
  const expected = `${SITE}${path}`;
  if (o.canonicals.length !== 1) errors.push(`hydrated page has ${o.canonicals.length} canonical links, expected 1`);
  else if (o.canonicals[0].replace(/\/$/, "") !== expected.replace(/\/$/, "")) errors.push(`hydrated canonical ${o.canonicals[0]} does not name ${expected}`);
  if (o.robots && /noindex/i.test(o.robots)) errors.push(`hydrated robots "${o.robots}" blocks an indexable page`);
  if (!o.helmetDescription) errors.push("no page-specific description after hydration (only the shell default)");
  else if (o.helmetDescription.length < DESC_MIN || o.helmetDescription.length > DESC_MAX) {
    advisories.push(`description is ${o.helmetDescription.length} characters, outside ${DESC_MIN}-${DESC_MAX}`);
  }
  if (o.descriptionTags > 1) advisories.push(`head carries ${o.descriptionTags} description tags (the shell default stays beside the page description)`);
  return { errors, advisories };
}

interface HydratedResult {
  path: string;
  family: string;
  errors: string[];
  advisories: string[];
  title: string;
}

/** One navigation: load the page in a fresh private session and read its head once it has stopped changing. */
async function observeHydrated(browser: Awaited<ReturnType<typeof launchBrowser>>, path: string): Promise<{ observed: HydratedObservation; settled: boolean }> {
  const session = await browser.newSession({ width: 1280, height: 900, colorScheme: "light", blockUrlParts: BLOCKED_VENDORS });
  try {
    await session.goto(`${BASE}${path}`, { settleMs: 300 });
    let observed: HydratedObservation = { title: "", helmetDescription: null, descriptionTags: 0, canonicals: [], robots: null, h1s: 0 };
    let stable = 0;
    let last = "";
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      observed = await session.evaluate<HydratedObservation>(HYDRATED_PROBE);
      const key = JSON.stringify(observed);
      const ready = observed.title !== "" && observed.h1s > 0 && observed.helmetDescription !== null;
      stable = ready && key === last ? stable + 1 : 0;
      last = key;
      if (stable >= 3) return { observed, settled: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { observed, settled: false };
  } finally {
    await session.close();
  }
}

async function auditHydrated(paths: string[]): Promise<HydratedResult[]> {
  const browser = await launchBrowser();
  try {
    return await pool(paths, 3, async (path) => {
      try {
        // A page that never produces a head in 20 seconds is retried once in a fresh session (a cold development server
        // compiling several routes at once can miss the window); a page that fails both attempts is reported as it was seen.
        let attempt = await observeHydrated(browser, path);
        if (!attempt.settled) attempt = await observeHydrated(browser, path);
        const { errors, advisories } = hydratedFindings(path, attempt.observed);
        return { path, family: familyOf(path), errors, advisories, title: attempt.observed.title };
      } catch (e: unknown) {
        return { path, family: familyOf(path), errors: [`hydrated probe failed: ${e instanceof Error ? e.message : String(e)}`], advisories: [], title: "" };
      }
    });
  } finally {
    await browser.close();
  }
}

// ── Self-test: the checks must reject what they claim to reject ──────────────

function selfTest(): string[] {
  const failures: string[] = [];
  const expect = (label: string, condition: boolean) => {
    if (!condition) failures.push(label);
  };
  const spec: RouteSpec = { path: "/switch-from/zzz", fromSitemap: true };
  const doc = (title: string) =>
    `<html><head><title>${title}</title><meta name="description" content="${"d".repeat(120)}"><link rel="canonical" href="${SITE}/x"><meta property="og:title" content="t"><meta property="og:image" content="https://x/y.png"><script type="application/ld+json">{}</script></head><body><h1>x</h1></body></html>`;

  // Over-budget titles in families the old roster never visited are rejected.
  for (const [family, title] of [
    ["switch-from", "Before You Switch From Shopify Payments: Agreement Questions | Liberty Bancard"],
    ["alternatives", `Alternatives to ${"Very Long Provider Name ".repeat(3)}: What to Compare | Liberty Bancard`],
    ["glossary", "Payment Processing Glossary — Terms Every Merchant Should Know | Liberty Bancard"],
  ] as const) {
    expect(`over-budget ${family} title is rejected`, checkServerHead(doc(title), spec).errors.some((e) => /title long/.test(e)));
  }
  expect("a compliant switch-from title passes", checkServerHead(doc("Switching From Shopify Payments: Agreement Questions | Liberty Bancard"), spec).errors.length === 0);
  expect("entities are decoded before measuring", decodeTitle("Pricing &amp; Programs") === "Pricing & Programs");
  expect("a doubled site name is rejected", titleProblems("Privacy Policy | Liberty Bancard | Liberty Bancard").some((p) => /doubled/.test(p)));

  // The roster cannot silently omit a sitemap URL, and a duplicate or a missing sitemap fails.
  const merged = mergeRoster([{ path: "/compare/square", dynamic: true }], [
    { path: "/compare/square", sitemap: "sitemap-compare.xml" },
    { path: "/switch-from/zzz", sitemap: "sitemap-compare.xml" },
    { path: "/learn/zzz", sitemap: "sitemap-glossary.xml" },
  ]);
  expect("a sitemap-only switch-from URL joins the roster", merged.some((r) => r.path === "/switch-from/zzz" && r.fromSitemap));
  expect("a sitemap-only switch-from URL must be server HTML, so a bare shell fails", merged.some((r) => r.path === "/switch-from/zzz" && r.dynamic === true));
  expect("a sitemap-only glossary URL joins the roster", merged.some((r) => r.path === "/learn/zzz" && r.fromSitemap));
  expect("a URL in both rosters appears once", merged.filter((r) => r.path === "/compare/square").length === 1);
  expect("a duplicate sitemap URL is detected", duplicates(["/a", "/b", "/a"]).join() === "/a");

  // Server HTML versus the client-rendered shell.
  expect("an empty-title React shell is client-rendered", isAppShell('<html><head><title></title></head><body><div id="root"></div></body></html>'));
  expect("a titled server document is not a shell", !isAppShell(doc("A Page Title That Is Long Enough To Pass | Liberty Bancard")));
  expect("a server document without a title is an error, not a shell", checkServerHead("<html><body><h1>x</h1></body></html>", spec).errors.includes("missing <title>"));

  // Hydrated metadata findings.
  const good: HydratedObservation = {
    title: "Help Center - Payment Processing | Liberty Bancard",
    helmetDescription: "d".repeat(120),
    descriptionTags: 1,
    canonicals: [`${SITE}/help`],
    robots: "index, follow",
    h1s: 1,
  };
  expect("a complete hydrated page passes", hydratedFindings("/help", good).errors.length === 0);
  expect("an over-budget hydrated title is rejected", hydratedFindings("/help", { ...good, title: "T".repeat(80) }).errors.some((e) => /title long/.test(e)));
  expect("a hydrated canonical for another page is rejected", hydratedFindings("/help", { ...good, canonicals: [`${SITE}/other`] }).errors.length > 0);
  expect("a hydrated page with no page-specific description is rejected", hydratedFindings("/help", { ...good, helmetDescription: null }).errors.length > 0);
  expect("two h1 elements are rejected", hydratedFindings("/help", { ...good, h1s: 2 }).errors.length > 0);
  expect("a noindex hydrated page is rejected", hydratedFindings("/help", { ...good, robots: "noindex" }).errors.length > 0);
  expect("a short hydrated description is recorded as an advisory", hydratedFindings("/help", { ...good, helmetDescription: "short" }).advisories.length === 1);
  return failures;
}

async function main() {
  const selfFailures = selfTest();
  for (const f of selfFailures) console.error(`✗ self-test: ${f}`);
  if (selfFailures.length) {
    console.error(`\nSEO audit self-test FAILED (${selfFailures.length}).`);
    process.exit(1);
  }
  console.log("✓ self-test: over-budget titles in switch-from, alternatives and glossary families, roster completeness, shell classification and hydrated findings are all rejected correctly\n");

  console.log(`SEO audit against ${BASE}\n`);
  console.log("Waiting for server to be ready…");
  await waitForServer(45_000);
  console.log("Server ready.\n");

  // ── Roster: code-defined families plus every sitemap URL ─────────────────────
  const rosterErrors: string[] = [];
  const sitemapRoster = await loadSitemapRoster(rosterErrors);
  const ROUTES = mergeRoster(CODE_ROSTER, sitemapRoster);
  const perSitemap = new Map<string, number>();
  for (const r of sitemapRoster) perSitemap.set(r.sitemap, (perSitemap.get(r.sitemap) ?? 0) + 1);
  console.log(`Roster: ${ROUTES.length} routes = ${sitemapRoster.length} sitemap URLs (${[...perSitemap].map(([k, v]) => `${k.replace(/^sitemap-?|\.xml$/g, "") || "index"} ${v}`).join(", ")}) + ${ROUTES.length - sitemapRoster.length} code-defined routes the sitemap does not list\n`);
  for (const e of rosterErrors) console.error(`✗ roster: ${e}`);

  // ── First response of every route ────────────────────────────────────────────
  const results = await pool(ROUTES, 8, auditRoute);
  for (const r of results) {
    const ok = r.errors.length === 0;
    const symbol = ok ? "✓" : "✗";
    const shell = r.clientRendered ? " [client-rendered]" : "";
    const warnSuffix = r.warnings.length ? `  warn: ${r.warnings.join("; ")}` : "";
    const errSuffix = r.errors.length ? `  errors: ${r.errors.join("; ")}` : "";
    // Passing server-rendered rows are summarised by family below; failing rows and client-rendered rows are listed.
    if (!ok || r.warnings.length || r.clientRendered) console.log(`${symbol} [${r.status}] ${r.path}${shell}${warnSuffix}${errSuffix}`);
  }

  const failed = results.filter((r) => r.errors.length > 0);
  const warned = results.filter((r) => r.warnings.length > 0);
  const sitemapPaths = new Set(sitemapRoster.map((r) => r.path));
  const auditedSitemap = results.filter((r) => sitemapPaths.has(r.path)).length;

  console.log("\n── Coverage by family (first response) ──");
  const families = new Map<string, { total: number; server: number; client: number; failed: number }>();
  for (const r of results) {
    const f = families.get(r.family) ?? { total: 0, server: 0, client: 0, failed: 0 };
    f.total += 1;
    if (r.clientRendered) f.client += 1;
    else f.server += 1;
    if (r.errors.length) f.failed += 1;
    families.set(r.family, f);
  }
  for (const [name, f] of [...families].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${name.padEnd(30)} ${String(f.total).padStart(4)} routes  server HTML ${String(f.server).padStart(4)}  client-rendered ${String(f.client).padStart(3)}  failing ${f.failed}`);
  }
  const clientRendered = results.filter((r) => r.clientRendered);
  console.log(
    `\nSummary: ${results.length} routes, ${failed.length} failed, ${warned.length} with warnings; ` +
      `${results.length - clientRendered.length} answered with server HTML, ${clientRendered.length} with the client-rendered shell; ` +
      `${auditedSitemap}/${sitemapRoster.length} sitemap URLs audited`,
  );

  // ── Crawler representation of user-agent branched pages ─────────────────────
  console.log("\n── Crawler vs browser representation (Vary: User-Agent) ──");
  const branched = ROUTES.filter((r) => CRAWLER_BRANCHED(r.path));
  const crawlerResults = await pool(branched, 4, auditCrawlerRepresentation);
  for (const c of crawlerResults) if (c.errors.length) console.log(`✗ ${c.path}  errors: ${c.errors.join("; ")}`);
  const crawlerFailed = crawlerResults.filter((c) => c.errors.length > 0);
  console.log(`${crawlerFailed.length === 0 ? "✓" : "✗"} ${branched.length - crawlerFailed.length}/${branched.length} user-agent branched routes serve crawler server HTML, the app shell to browsers, and Vary: User-Agent on both`);

  // ── Hydrated metadata of the client-rendered pages ──────────────────────────
  console.log("\n── Hydrated metadata of client-rendered pages (private Chromium) ──");
  const hydratedTargets = clientRendered.filter((r) => !r.noindex).map((r) => r.path);
  let hydrated: HydratedResult[] = [];
  let hydratedLaunchError: string | null = null;
  try {
    hydrated = await auditHydrated(hydratedTargets);
  } catch (e: unknown) {
    hydratedLaunchError = e instanceof Error ? e.message : String(e);
  }
  if (hydratedLaunchError) console.error(`✗ hydrated pass could not run: ${hydratedLaunchError}`);
  for (const h of hydrated) if (h.errors.length) console.log(`✗ ${h.path}  errors: ${h.errors.join("; ")}`);
  const hydratedFailed = hydrated.filter((h) => h.errors.length > 0);
  const advisoryPages = hydrated.filter((h) => h.advisories.length > 0);
  const byFamily = new Map<string, { pages: number; advisories: Map<string, number> }>();
  for (const h of hydrated) {
    const entry = byFamily.get(h.family) ?? { pages: 0, advisories: new Map<string, number>() };
    entry.pages += 1;
    for (const a of h.advisories) {
      const key = a.replace(/\d+ characters/, "N characters").replace(/carries \d+/, "carries N");
      entry.advisories.set(key, (entry.advisories.get(key) ?? 0) + 1);
    }
    byFamily.set(h.family, entry);
  }
  console.log(
    `${hydratedLaunchError || hydratedFailed.length ? "✗" : "✓"} ${hydrated.length - hydratedFailed.length}/${hydratedTargets.length} indexable client-rendered pages carry a compliant hydrated title, one h1, a self-canonical and a page-specific description`,
  );
  console.log("  First HTML versus hydrated, by family (the first HTML of every one of these pages has an empty <title> by design):");
  for (const [name, e] of [...byFamily].sort((a, b) => b[1].pages - a[1].pages)) {
    const notes = [...e.advisories].map(([k, v]) => `${v}× ${k}`).join("; ") || "no differences beyond the empty first-HTML title";
    console.log(`    ${name.padEnd(28)} ${String(e.pages).padStart(3)} pages  ${notes}`);
  }
  console.log(`  Advisory (not failing): ${advisoryPages.length} hydrated pages have description-length or duplicate-description notes.`);

  // ── Wave 12: Sitemap check ───────────────────────────────────────────────────
  console.log("\n── Sitemap check ──");
  console.log(`${rosterErrors.length ? "✗" : "✓"} /sitemap.xml: ${sitemapRoster.length} URLs, ${new Set(sitemapRoster.map((r) => r.path)).size} unique, ${auditedSitemap} audited`);

  // ── Wave 12: Partner page title + meta-description uniqueness check ──────────
  console.log("\n── Partner page SEO uniqueness check ──");
  const PARTNER_PATHS = ["/partners", "/partners/cpa", "/partners/bookkeeper", "/partners/insurance"];
  const partnerTitles: string[] = [];
  const partnerDescs: string[] = [];
  let partnerUniquenessOk = true;
  for (const p of PARTNER_PATHS) {
    const def = SEO_ROUTE_DEFAULTS[p];
    if (!def) {
      console.error(`✗ SEO_ROUTE_DEFAULTS missing entry for partner page ${p}`);
      partnerUniquenessOk = false;
    } else {
      partnerTitles.push(def.title);
      partnerDescs.push(def.description);
    }
  }
  const uniqueTitles = new Set(partnerTitles);
  const uniqueDescs = new Set(partnerDescs);
  if (uniqueTitles.size < partnerTitles.length) {
    const dups = partnerTitles.filter((t, i) => partnerTitles.indexOf(t) !== i);
    console.error(`✗ Partner pages have duplicate title(s): ${JSON.stringify(dups)}`);
    partnerUniquenessOk = false;
  } else {
    console.log("✓ Partner page titles are all unique");
  }
  if (uniqueDescs.size < partnerDescs.length) {
    const dups = partnerDescs.filter((d, i) => partnerDescs.indexOf(d) !== i);
    console.error(`✗ Partner pages have duplicate meta description(s): ${JSON.stringify(dups)}`);
    partnerUniquenessOk = false;
  } else {
    console.log("✓ Partner page meta descriptions are all unique");
  }

  const problemCount =
    failed.length +
    rosterErrors.length +
    crawlerFailed.length +
    hydratedFailed.length +
    (hydratedLaunchError ? 1 : 0) +
    (partnerUniquenessOk ? 0 : 1) +
    (auditedSitemap === sitemapRoster.length ? 0 : 1);
  if (problemCount > 0) {
    console.error(`\nSEO audit FAILED: ${problemCount} check(s) had errors.`);
    process.exit(1);
  }
  console.log(
    `\nSEO audit PASSED: ${results.length} routes (${sitemapRoster.length} sitemap URLs, all audited), ` +
      `${results.length - clientRendered.length} first-HTML documents, ${hydrated.length} hydrated client-rendered pages, ${branched.length} crawler representations.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
