#!/usr/bin/env npx tsx
/**
 * test-public-shell-contract.ts
 *
 * Static, deterministic contract for the public shell and hubs (W-B): navigation model, overview pages,
 * server/React parity, metadata lengths, the public token cascade, the imagery registry and the
 * performance-measurement validity rules.
 *
 * No server, no database, no network, no provider I/O. It loads the shared content modules, calls the
 * server-side HTML builders directly and reads source files. Every check family carries a negative
 * control: a deliberately broken fixture that the same assertion function must reject.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { isServerOnlyPublicPath, needsNativeNavigation, PUBLIC_NAV_CTA, PUBLIC_NAV_GROUPS, PUBLIC_NAV_UTILITIES, type PublicNavGroup } from "../shared/public-navigation";
import { PUBLIC_FOOTER_GROUPS } from "../shared/public-footer-links";
import { HOME_META, HOME_SECTION_ORDER } from "../shared/public-home-content";
import { ABOUT_CONTACT_META, ABOUT_CONTACT_INQUIRY, PUBLIC_CONTACT_CHANNELS } from "../shared/public-contact-content";
import { INDUSTRIES_HUB, PUBLIC_INDUSTRIES } from "../shared/public-industries";
import { OVERVIEW_PAGES } from "../shared/public-overview-pages";
import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import { getHomeHtml } from "../server/ssr/home";
import { getAboutContactHtml } from "../server/ssr/about-contact";
import { getIndustriesHubHtml } from "../server/ssr/industries-hub";
import { getOverviewPageHtml } from "../server/ssr/overview-pages";
import { ssrFooter, ssrHtmlShell, ssrNavbar } from "../server/ssrShared";
import {
  CLS_BUDGET,
  LCP_BUDGET_MS,
  PERF_OBSERVER_SOURCE,
  classifySample,
  summarizeRoute,
  type SampleVerdict,
} from "./lib/public-perf-validity";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const decode = (html: string): string => html.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "DATA");

let assertions = 0;
let negatives = 0;
const failures: string[] = [];
let currentFamily = "";

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function ok(condition: unknown, message: string): void {
  assertions++;
  if (!condition) failures.push(`[${currentFamily}] ${message}`);
}
function passes(name: string, fn: () => void): void {
  assertions++;
  try {
    fn();
  } catch (error) {
    failures.push(`[${currentFamily}] ${name}: ${(error as Error).message}`);
  }
}
function negative(name: string, fn: () => void): void {
  negatives++;
  try {
    fn();
  } catch {
    return;
  }
  failures.push(`[${currentFamily}] negative control "${name}" was accepted by the check it should fail`);
}
function family(name: string, fn: () => void): void {
  currentFamily = name;
  const before = { assertions, negatives };
  try {
    fn();
  } catch (error) {
    failures.push(`[${name}] threw: ${(error as Error).message}`);
  }
  console.log(`  ${name}: ${assertions - before.assertions} assertions, ${negatives - before.negatives} negative controls`);
}

// ── Rendered documents ───────────────────────────────────────────────────────

const PAGES: Record<string, string> = {
  "/": getHomeHtml(),
  "/about-contact": getAboutContactHtml(),
  "/industries": getIndustriesHubHtml(),
};
for (const page of OVERVIEW_PAGES) PAGES[page.path] = getOverviewPageHtml(page);

const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;
const titleOf = (html: string): string => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const descriptionOf = (html: string): string => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
const unescape = (value: string): string => value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

console.log("Public shell contract suite\n");

// ── Navigation model ─────────────────────────────────────────────────────────

family("navigation-model", () => {
  const assertGroupTargets = (groups: readonly PublicNavGroup[]): void => {
    for (const g of groups) {
      ensure(g.links.some((l) => l.href === g.href), `${g.label} top-level target ${g.href} is not also listed in its own dropdown`);
      const hrefs = g.links.map((l) => l.href + "|" + l.label);
      ensure(new Set(hrefs).size === hrefs.length, `${g.label} lists the same destination and label twice`);
    }
  };
  passes("every top-level target also appears in its group", () => assertGroupTargets(PUBLIC_NAV_GROUPS));
  negative("top-level target missing from its own links", () =>
    assertGroupTargets([{ ...PUBLIC_NAV_GROUPS[0], href: "/not-in-the-links" }]),
  );

  const byId = (id: string): PublicNavGroup => PUBLIC_NAV_GROUPS.find((g) => g.id === id)!;
  ok(byId("solutions").href === "/payment-processing", "Solutions opens the Payment processing overview");
  ok(byId("solutions").links.some((l) => l.label === "Pricing & programs" && l.href === "/pricing-and-programs"), "Pricing & programs opens its overview page");
  ok(byId("resources").links.some((l) => l.label === "Help" && l.href === "/help"), "Help sits under Resources");
  ok(!PUBLIC_NAV_GROUPS.some((g) => g.id !== "resources" && g.links.some((l) => l.href === "/help")), "Help appears only under Resources");
  ok(PUBLIC_NAV_UTILITIES.map((u) => u.label).join("|") === "Support|Account sign in|Partner sign in", "utilities are Support, Account sign in, Partner sign in");

  const nav = read("client/src/components/Navbar.tsx");
  ok(/hidden items-center gap-6 xl:flex/.test(nav) && /xl:hidden/.test(nav), "desktop navigation starts at xl and the menu button covers everything below it");
  ok(/min-\[400px\]:inline-flex/.test(nav), "the header action is shown from 400px and is reachable in the menu below that");
  ok(/PUBLIC_NAV_UTILITIES/.test(nav) && /link-mobile-talk/.test(nav), "the mobile drawer lists the utilities and Talk to Liberty");
  ok(/Menu/.test(nav), "the menu control carries a text label");

  const server = decode(ssrNavbar());
  ok(server.includes(`href="${PUBLIC_NAV_CTA.href}" class="ssr-cta-btn ssr-menu-cta">${PUBLIC_NAV_CTA.label}</a>`), "server menu repeats Talk to Liberty so it is reachable at 320px");
  for (const u of PUBLIC_NAV_UTILITIES) {
    ok(count(server, new RegExp(`href="${u.href}">${u.label}</a>`, "g")) === 2, `server header lists ${u.label} in the bar and in the menu`);
  }
  ok(server.includes(PUBLIC_CONTACT_CHANNELS.phone.href) && server.includes(PUBLIC_CONTACT_CHANNELS.email.href), "server menu carries the verified phone and email channels");
  ok(!/Call\s*\/\s*Text|Text us/i.test(server + decode(ssrFooter())), "server shell never offers a text channel");
});

// ── Metadata and landmarks ───────────────────────────────────────────────────

family("metadata-and-landmarks", () => {
  const assertMeta = (route: string, title: string, description: string): void => {
    ensure(title.length >= 30 && title.length <= 70, `${route} title is ${title.length} characters (30-70)`);
    ensure(description.length >= 100 && description.length <= 165, `${route} description is ${description.length} characters (100-165)`);
    ensure(title.endsWith("| Liberty Bancard"), `${route} title does not end with the brand`);
  };
  for (const [route, html] of Object.entries(PAGES)) {
    passes(`${route} title and description fit search results`, () => assertMeta(route, unescape(titleOf(html)), unescape(descriptionOf(html))));
  }
  negative("title that is too short", () => assertMeta("fixture", "Home | Liberty Bancard", descriptionOf(PAGES["/"])));
  negative("description that is too long", () => assertMeta("fixture", titleOf(PAGES["/"]), "x".repeat(166)));

  ok(unescape(titleOf(PAGES["/"])) === HOME_META.title, "server Home title is the shared title");
  ok(unescape(titleOf(PAGES["/about-contact"])) === ABOUT_CONTACT_META.title, "server About & Contact title is the shared title");
  ok(unescape(titleOf(PAGES["/industries"])) === `${INDUSTRIES_HUB.title} | Liberty Bancard`, "server Industries hub title is the shared title");
  for (const page of OVERVIEW_PAGES) ok(unescape(titleOf(PAGES[page.path])) === page.title, `${page.path} server title is the shared title`);
  for (const route of ["/", "/payment-processing", "/pricing-and-programs", "/about-contact", "/industries"]) {
    ok(SEO_ROUTE_DEFAULTS[route]?.inSitemap === true, `${route} is registered for the sitemap`);
  }

  const assertLandmarks = (route: string, html: string): void => {
    ensure(count(html, /<h1\b/g) === 1, `${route} renders ${count(html, /<h1\b/g)} h1 elements`);
    ensure(count(html, /<main\b/g) === 1, `${route} renders ${count(html, /<main\b/g)} main landmarks`);
    ensure(!/Call\s*\/\s*Text|Text us/i.test(decode(html)), `${route} offers a text channel that has no owner evidence`);
  };
  for (const [route, html] of Object.entries(PAGES)) passes(`${route} has one h1 and one main`, () => assertLandmarks(route, html));
  negative("second h1 in a page", () => assertLandmarks("fixture", PAGES["/"].replace("</main>", "<h1>Another</h1></main>")));
  negative("nested second main", () => assertLandmarks("fixture", PAGES["/about-contact"].replace("<main>", "<main><main>")));
  negative("Call/Text label", () => assertLandmarks("fixture", PAGES["/about-contact"].replace("</main>", "<a>Call / Text</a></main>")));

  // Glossary pages are static documents inside the shared shell: one main (supplied by the shell), no hydration.
  const glossary = read("server/routes/glossary.ts");
  ok(count(glossary, /ssrHtmlShell\(\{/g) === 2 && count(glossary, /hydrate:\s*false/g) === 2, "glossary hub and term pages use the shared shell without hydrating");
  ok(!/<main\b/.test(glossary), "glossary builders do not add a second main landmark");
  const shell = ssrHtmlShell({ title: "Glossary check | Liberty Bancard", description: "d".repeat(110), canonical: "/learn/x", body: "<h1>Term</h1>", hydrate: false });
  ok(count(shell, /<main\b/g) === 1 && count(shell, /<h1\b/g) === 1, "static shell wraps a glossary body in exactly one main");
  ok(!/\/src\/main\.tsx|\/assets\/index-[A-Za-z0-9_-]+\.js/.test(shell), "static shell does not load the React bundle");
  // Without the client stylesheet a static page must declare the public faces itself, from existing same-origin files.
  const assertStaticFaces = (html: string): void => {
    const urls = [...html.matchAll(/data-ssr-static-fonts[\s\S]*?<\/style>/g)].flatMap((m) => [...m[0].matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map((u) => u[1]));
    ensure(urls.includes("/fonts/source-serif-4-latin-wght.woff2"), "static page does not declare the Source Serif 4 display face");
    ensure(["400", "500", "600", "700"].every((w) => urls.includes(`/fonts/ibm-plex-sans-${w}.ttf`)), "static page does not declare every IBM Plex Sans weight");
    for (const url of urls) ensure(fs.existsSync(path.join(ROOT, "client/public", url)), `declared font file is missing: ${url}`);
  };
  passes("static glossary shell declares the self-hosted public faces", () => assertStaticFaces(shell));
  negative("static page without font faces", () => assertStaticFaces(shell.replace(/data-ssr-static-fonts/g, "data-removed")));
  negative("static page declaring a font file that does not exist", () => assertStaticFaces(shell.replace("ibm-plex-sans-500.ttf", "ibm-plex-sans-501.ttf")));
  // The client router has no route for the glossary, so every hydrated link to it must be a native anchor.
  const appRoutes = read("client/src/App.tsx");
  ok(!/path="\/learn/.test(appRoutes), "client router still has no glossary route (the native-anchor rule below is why that is safe)");
  const linkedHrefs: string[] = [];
  const collectHrefs = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.href === "string") linkedHrefs.push(record.href);
    for (const nested of Object.values(record)) collectHrefs(nested);
  };
  collectHrefs(PUBLIC_NAV_GROUPS);
  collectHrefs(PUBLIC_FOOTER_GROUPS);
  const serverOnlyLinks = linkedHrefs.filter((href) => isServerOnlyPublicPath(href));
  ok(serverOnlyLinks.length >= 2 && serverOnlyLinks.every((href) => needsNativeNavigation(href)), "navigation and footer link to the glossary and mark it for native navigation");
  const assertNativeRenderers = (navbar: string, footer: string): void => {
    ensure(/needsNativeNavigation\(href\)/.test(navbar) && /<a href=\{href\}/.test(navbar), "header does not render native anchors for server-only pages");
    ensure(/needsNativeNavigation\(href\)/.test(footer) && /<FooterLink\s+href=\{link\.href\}/.test(footer) && /<FooterLink\s+href=\{viewAll\.href\}/.test(footer), "footer does not render native anchors for server-only pages");
  };
  passes("hydrated header and footer render glossary links as native anchors", () => assertNativeRenderers(read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx")));
  negative("header that routes server-only pages through the client router", () => assertNativeRenderers(read("client/src/components/Navbar.tsx").replace("needsNativeNavigation(href)", "isHomeAnchor(href)"), read("client/src/components/Footer.tsx")));
  negative("footer that routes the glossary through the client router", () => assertNativeRenderers(read("client/src/components/Navbar.tsx"), read("client/src/components/Footer.tsx").replace("<FooterLink\n              href={viewAll.href}", "<Link\n              href={viewAll.href}")));
  ok(!/data-ssr-static-fonts/.test(ssrHtmlShell({ title: "Hydrated check | Liberty Bancard", description: "d".repeat(110), canonical: "/x", body: "<h1>T</h1>" })), "hydrating pages take their faces from the app stylesheet, not a second declaration");
});

// ── Home section order in both emitters ──────────────────────────────────────

family("home-section-order", () => {
  const assertOrder = (html: string): void => {
    let last = -1;
    for (const id of HOME_SECTION_ORDER) {
      const at = html.indexOf(`data-home-section="${id}"`);
      ensure(at > last, `Home section ${id} is missing or out of contract order`);
      last = at;
    }
  };
  passes("server Home renders every section in the contract order", () => assertOrder(PAGES["/"]));
  negative("Home with two sections swapped", () =>
    assertOrder(PAGES["/"].replace('data-home-section="faq"', "X").replace('data-home-section="process"', 'data-home-section="faq"').replace("X", 'data-home-section="process"')),
  );
  negative("Home missing the final section", () => assertOrder(PAGES["/"].replace('data-home-section="final"', "")));

  const homePage = read("client/src/pages/Home.tsx");
  const componentFor: Record<string, string> = {
    hero: "HomeHero",
    solutions: "HomeSolutions",
    industries: "HomeIndustries",
    "starting-points": "HomeStartingPoints",
    founder: "HomeFounder",
    process: "HomeProcess",
    faq: "HomeFaq",
    final: "HomeFinal",
  };
  let last = -1;
  for (const id of HOME_SECTION_ORDER) {
    const at = homePage.lastIndexOf(`<${componentFor[id]}`);
    ok(at > last, `hydrated Home mounts ${componentFor[id]} in the contract order`);
    last = at;
    const source = read(`client/src/components/home/${componentFor[id]}.tsx`);
    ok(source.includes(`data-home-section="${id}"`), `${componentFor[id]} carries data-home-section="${id}"`);
  }
});

// ── Industries hub ───────────────────────────────────────────────────────────

family("industries-hub", () => {
  const hub = PAGES["/industries"];
  ok(PUBLIC_INDUSTRIES.length === 14, `all fourteen industry routes remain (found ${PUBLIC_INDUSTRIES.length})`);
  ok(hub.includes(`${INDUSTRIES_HUB.heading}</h1>`) && INDUSTRIES_HUB.heading === "Payment solutions for your industry.", "hub h1 is the specified heading");
  for (const industry of PUBLIC_INDUSTRIES) ok(hub.includes(`href="/industries/${industry.slug}"`), `hub links ${industry.slug}`);
  ok(!/Payment processing by industry/.test(hub + read("client/src/pages/Industries.tsx")), "retired hub heading is gone from both emitters");
});

// ── Public token cascade ─────────────────────────────────────────────────────

family("public-tokens", () => {
  const css = read("client/src/index.css");
  const contract = read("client/src/styles/public-contract.css");
  const blockOf = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    ensure(start >= 0, `${selector} block not found`);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const assertPublicBlock = (name: string, block: string): void => {
    for (const [token, value] of [
      ["--primary", "var(--liberty-navy)"],
      ["--sidebar-primary", "var(--liberty-navy)"],
      ["--secondary", "var(--liberty-surface)"],
      ["--muted", "var(--liberty-surface)"],
      ["--muted-foreground", "var(--public-ink-secondary)"],
      ["--brand-red", "var(--liberty-red)"],
    ] as const) {
      ensure(new RegExp(`${token}:\\s*${value.replace(/[()]/g, "\\$&")}`).test(block), `${name} does not set ${token} to ${value}`);
    }
  };
  passes(".marketing-theme sets the public palette from the contract tokens", () => assertPublicBlock(".marketing-theme", blockOf(".marketing-theme")));
  passes(".dark .marketing-theme re-asserts the same palette", () => assertPublicBlock(".dark .marketing-theme", blockOf(".dark .marketing-theme")));
  negative("public block still using the retired primary", () =>
    assertPublicBlock(".marketing-theme", blockOf(".marketing-theme").replace("--primary: var(--liberty-navy)", "--primary: 222 47% 11%")),
  );
  negative("public block missing the brand red", () =>
    assertPublicBlock(".marketing-theme", blockOf(".marketing-theme").replace("--brand-red: var(--liberty-red)", "")),
  );
  ok(/--primary:\s*222 47% 11%/.test(css.slice(0, css.indexOf(".marketing-theme {"))), "CRM :root primary token is untouched");
  ok(!/overflow-x:\s*hidden/.test(contract), "public contract does not mask horizontal overflow");

  // Secondary text colour must keep 4.5:1 on white and on the light surface.
  const channel = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = (hex: string): number => [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16))).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const assertSecondaryInk = (hex: string): void => {
    ensure(contrast(hex, "#ffffff") >= 4.5, `secondary ink ${hex} fails 4.5:1 on white`);
    ensure(contrast(hex, "#F4F6FA") >= 4.5, `secondary ink ${hex} fails 4.5:1 on the light surface`);
  };
  ok(/--public-ink-secondary:\s*215 19% 34\.5%/.test(contract), "secondary ink token is the #475569 value");
  passes("secondary ink meets contrast on white and the light surface", () => assertSecondaryInk("#475569"));
  negative("lighter grey that fails the light-surface contrast", () => assertSecondaryInk("#94a3b8"));
});

// ── Imagery registry ─────────────────────────────────────────────────────────

family("imagery", () => {
  const registry = read("client/src/lib/public-imagery.ts");
  const builder = read("scripts/build-public-images.ts");
  const manifest = read("client/src/lib/public-imagery.manifest.json");
  const homeContent = read("client/src/components/home/home-content.ts");
  const industries = read("client/src/components/home/HomeIndustries.tsx");
  const assertNoUnlicensedFieldServicesImage = (sources: readonly string[]): void => {
    ensure(!sources.some((s) => /industry-home-services/.test(s)), "the unsuitable field-services image is still registered");
  };
  passes("no field-services photo is registered, built or in the manifest", () => assertNoUnlicensedFieldServicesImage([registry, builder, manifest, homeContent]));
  negative("field-services image re-registered", () => assertNoUnlicensedFieldServicesImage([registry, builder, manifest, `${homeContent}\nconst x = "industry-home-services";`]));
  ok(/PUBLIC_IMAGE_RECORDS/.test(homeContent), "Home resolves every card photograph through the imagery registry");
  ok(!/icon-vertical-|HardHat/.test(industries), "Home renders a registered photograph on every industry card, with no icon-tile branch");
  ok(!fs.existsSync(path.join(ROOT, "client/src/assets/images/public")) || !fs.readdirSync(path.join(ROOT, "client/src/assets/images/public")).some((f) => /industry-home-services/.test(f)), "no derivative files for the removed image remain");
  ok(/unverified/.test(registry), "remaining product-image provenance is still recorded as unverified until the owner supplies licence evidence");
  ok(/generated/.test(registry) && /owner-review-pending/.test(registry), "supplied generated artwork is recorded as generated and owner-review-pending, never licensed");
});

// ── Inquiry anchor (W-C mount point) ─────────────────────────────────────────

family("inquiry-anchor", () => {
  ok(ABOUT_CONTACT_INQUIRY.id === "inquiry", "the stable inquiry anchor id is unchanged");
  ok(PAGES["/about-contact"].includes(`id="${ABOUT_CONTACT_INQUIRY.id}"`), "server About & Contact exposes the #inquiry anchor");
  ok(read("client/src/pages/AboutContact.tsx").includes("ABOUT_CONTACT_INQUIRY"), "hydrated About & Contact exposes the same anchor");
  ok(!/<form\b/.test(PAGES["/about-contact"]), "About & Contact carries no inquiry form until W-C mounts one");
});

// ── Performance-measurement validity ─────────────────────────────────────────

family("perf-validity", () => {
  const valid = (lcp: number, cls = 0.01): SampleVerdict => classifySample({ lcp, cls, clsObserved: true, ready: true });
  ok(valid(1200).valid === true, "a painted, ready page is a valid sample");
  ok(PERF_OBSERVER_SOURCE.includes("lcp:null"), "the in-page observer starts LCP at null, never 0");

  const assertInvalid = (raw: Parameters<typeof classifySample>[0], why: RegExp): void => {
    const verdict = classifySample(raw);
    ensure(verdict.valid === false, "an unmeasured page was accepted as a sample");
    ensure(why.test((verdict as { reason: string }).reason), `wrong rejection reason: ${(verdict as { reason: string }).reason}`);
  };
  passes("missing LCP is invalid", () => assertInvalid({ lcp: null, cls: 0, clsObserved: true, ready: true }, /no largest-contentful-paint/));
  passes("zero LCP is invalid", () => assertInvalid({ lcp: 0, cls: 0, clsObserved: true, ready: true }, /greater than 0/));
  passes("non-finite LCP is invalid", () => assertInvalid({ lcp: Number.NaN, cls: 0, clsObserved: true, ready: true }, /not a finite/));
  passes("negative CLS is invalid", () => assertInvalid({ lcp: 900, cls: -0.2, clsObserved: true, ready: true }, /cannot be negative/));
  passes("missing layout-shift observer is invalid", () => assertInvalid({ lcp: 900, cls: 0, clsObserved: false, ready: true }, /layout-shift observer/));
  passes("an unready document is invalid", () => assertInvalid({ lcp: 900, cls: 0, clsObserved: true, ready: false }, /not ready/));
  passes("a navigation timeout is invalid", () => assertInvalid({ lcp: 900, cls: 0, clsObserved: true, ready: true, navigationTimedOut: true }, /timed out/));
  negative("a failed measurement accepted as 0 ms", () => assertInvalid({ lcp: 900, cls: 0, clsObserved: true, ready: true }, /anything/));

  ok(summarizeRoute([valid(1000), valid(1100), valid(1200)], 3).status === "within budget", "three valid samples inside budget are within budget");
  ok(summarizeRoute([valid(LCP_BUDGET_MS + 600), valid(LCP_BUDGET_MS + 700), valid(LCP_BUDGET_MS + 800)], 3).status === "over budget", "valid samples above the LCP budget are over budget");
  ok(summarizeRoute([valid(900, CLS_BUDGET + 0.05), valid(900, CLS_BUDGET + 0.06), valid(900, CLS_BUDGET + 0.07)], 3).status === "over budget", "valid samples above the CLS budget are over budget");
  const invalidSample = classifySample({ lcp: null, cls: 0, clsObserved: true, ready: true });
  const assertWithinBudget = (samples: readonly SampleVerdict[], runs: number): void =>
    ensure(summarizeRoute(samples, runs).status === "within budget", `route status was ${summarizeRoute(samples, runs).status}`);
  negative("one invalid sample among valid samples", () => assertWithinBudget([valid(900), valid(900), invalidSample], 3));
  negative("all samples invalid", () => assertWithinBudget([invalidSample, invalidSample, invalidSample], 3));
  negative("fewer valid samples than the required runs", () => assertWithinBudget([valid(900), valid(900)], 3));
  negative("over-budget route reported as within budget", () => assertWithinBudget([valid(LCP_BUDGET_MS + 900)], 1));
  ok(summarizeRoute([invalidSample], 1).lcpMs === null, "an invalid route reports no LCP number");

  const runner = read("scripts/check-public-perf.ts");
  ok(/if\(invalid\)process\.exit\(1\)/.test(runner), "the runner fails whenever any route is invalid, with or without enforcement");
  ok(!/lcp\s*\?\?\s*0|\|\|\s*0\)/.test(runner.replace(/\/\/.*$/gm, "")), "the runner never falls back to 0 for an unmeasured LCP");
  for (const route of ["/payment-processing", "/pricing-and-programs", "/about-contact", "/industries"]) {
    ok(runner.includes(`"${route}"`) || runner.includes(`'${route}'`) || runner.includes(route), `the default perf routes include ${route}`);
  }
});

console.log(`\nTotal: ${assertions} assertions, ${negatives} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
