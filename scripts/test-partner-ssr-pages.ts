#!/usr/bin/env npx tsx
/**
 * test-partner-ssr-pages.ts
 *
 * The six partnership routes (/partners, /partners/referrals, /partners/sales-agents, /partners/cpa, /partners/bookkeeper,
 * /partners/insurance) and /affiliate must send a real document before any script runs: the route's own title,
 * description, canonical, one h1, hero photograph, sections, FAQ and structured data.
 *
 * Deterministic and offline: the real route module (server/routes/partner-pages.ts) is mounted on an unlistened-network
 * Express app on an ephemeral loopback port with an injected policy reader. No database, no provider, no external host.
 *
 * What it proves
 *  - the raw HTML of each route is identical for a browser user agent, a crawler user agent and a request with tracking
 *    query strings, and is a full document (not the 2.7 KB generic shell);
 *  - title, description, keywords, canonical and the single h1 equal the shared record the React page reads;
 *  - one hero image per document, eager with fetchpriority high and a visible illustrative caption; body images lazy;
 *  - the section tone rhythm of each page family, with at least one navy section before the footer;
 *  - WebPage, BreadcrumbList and FAQPage structured data parse, and the FAQ schema equals the FAQ visible on the page;
 *  - every in-page anchor has a target, `#apply` is unique, and no stale or unsupported claim appears;
 *  - UNAPPROVED policy: no referral percentage anywhere, the written-agreement sentence and the gated calculator message
 *    show, no dollar result is computed for the referral path;
 *  - APPROVED policy (a private fixture share that lives only in this file): the approved sentence and a computed result
 *    appear, and a revocation shows on the very next request (the response is `Cache-Control: no-cache`, never a public
 *    lifetime), a throwing policy reader falls back to the written agreement rather than failing or publishing a number.
 *
 * Every check family has a negative control.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { registerPartnerPageRoutes, PARTNER_PAGE_CACHE_CONTROL } from "../server/routes/partner-pages";
import { getPartnerPageHtml, getAffiliatePageHtml, partnerRouteFaqs } from "../server/ssr/partners";
import { PARTNER_PAGE_SEO, PARTNER_SSR_ROUTES } from "../shared/partner-page-seo";
import {
  DEFAULT_REFERRAL_POLICY,
  PARTNER_ROUTES,
  REFERRAL_RESULT_GATED_MESSAGE,
  REFERRAL_WRITTEN_AGREEMENT_SENTENCE,
  parseReferralPolicy,
  type PartnerReferralPolicy,
} from "../shared/partner-public-content";
import { PARTNER_MEDIA_CAPTION } from "../shared/partner-page-media";
import { AFFILIATE_PAGE } from "../shared/public-affiliate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Private fixture share used only to exercise the approved branch. It is not a recommendation or a term.
const FIXTURE_SHARE = 17;
const APPROVED = parseReferralPolicy({ state: "approved", version: 4, sharePercent: FIXTURE_SHARE });

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let checks = 0;
const failures: string[] = [];
function ok(cond: unknown, label: string) {
  checks++;
  if (!cond) { failures.push(label); console.log(`  FAIL ${label}`); } else console.log(`  ok   ${label}`);
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

let currentPolicy: PartnerReferralPolicy = DEFAULT_REFERRAL_POLICY;
let readerMode: "policy" | "throws" = "policy";
const reader = async (): Promise<PartnerReferralPolicy> => {
  if (readerMode === "throws") throw new Error("policy store unavailable");
  return currentPolicy;
};

const app = express();
registerPartnerPageRoutes(app, reader);
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;

async function get(route: string, ua = BROWSER_UA): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { "user-agent": ua } });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

const meta = (html: string, attr: string, name: string) => decode(html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1] ?? "");
const jsonLd = (html: string): Array<Record<string, unknown>> => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
const toneSequence = (html: string) => [...html.matchAll(/<section class="ssr-section ssr-section-(canvas|warm|light|ink)\b/g)].map((m) => m[1]);

const EXPECTED_TONES: Record<string, string[]> = {
  [PARTNER_ROUTES.hub]: ["canvas", "light", "ink", "canvas", "light", "warm"],
  [PARTNER_ROUTES.referral]: ["canvas", "warm", "ink", "light", "warm"],
  [PARTNER_ROUTES.salesAgent]: ["canvas", "ink", "light", "warm"],
  [PARTNER_ROUTES.cpa]: ["canvas", "light", "ink", "canvas"],
  [PARTNER_ROUTES.bookkeeper]: ["canvas", "light", "ink", "canvas"],
  [PARTNER_ROUTES.insurance]: ["canvas", "light", "ink", "canvas"],
};
const UNSUPPORTED = /(\b20\s?[–-]\s?40\s?%|\bin minutes\b|(?<!not )\bguaranteed (income|earnings|approval)\b|\bpassive income\b|\bget paid\b|\b(25|30)\s?%)/i;
const SHARE_SENTENCE = /Earn \d+% of eligible/;

try {
  console.log("Raw documents: browser, crawler and tracking query strings");
  const pages = new Map<string, string>();
  for (const route of PARTNER_SSR_ROUTES) {
    const browser = await get(route, BROWSER_UA);
    const crawler = await get(route, CRAWLER_UA);
    const tracked = await get(`${route}?utm_source=newsletter&utm_campaign=q4&ref=abc123&profession=cpa`, BROWSER_UA);
    pages.set(route, browser.body);
    ok(browser.status === 200 && /text\/html/.test(browser.headers.get("content-type") ?? ""), `${route}: 200 text/html`);
    ok(browser.body.length > 20_000 && browser.body.length < 160_000, `${route}: a full document, not the generic shell (${browser.body.length} bytes)`);
    ok(browser.body === crawler.body, `${route}: identical for a browser and a crawler user agent`);
    ok(browser.body === tracked.body, `${route}: tracking query strings do not change the document`);
    ok(browser.headers.get("cache-control") === PARTNER_PAGE_CACHE_CONTROL && PARTNER_PAGE_CACHE_CONTROL === "no-cache", `${route}: Cache-Control is no-cache (never a public lifetime)`);
    ok(!/max-age|s-maxage|public/.test(browser.headers.get("cache-control") ?? ""), `${route}: no shared-cache lifetime is advertised`);
  }
  ok(!/<h1/.test(await (await fetch(`http://127.0.0.1:${port}/partners/not-a-page`)).text()), "negative control: an unregistered partnership path is not served by these routes");

  console.log("Title, description, canonical, h1 and keywords equal the shared record");
  for (const route of PARTNER_SSR_ROUTES) {
    const html = pages.get(route)!;
    const seo = PARTNER_PAGE_SEO[route];
    ok(decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "") === seo.title, `${route}: title`);
    ok(seo.title.length >= 30 && seo.title.length <= 70, `${route}: title length ${seo.title.length} is 30-70`);
    ok(meta(html, "name", "description") === seo.description, `${route}: description`);
    ok(seo.description.length >= 100 && seo.description.length <= 170, `${route}: description length ${seo.description.length} is 100-170`);
    ok(meta(html, "name", "keywords") === seo.keywords, `${route}: keywords`);
    ok(new RegExp(`<link rel="canonical" href="https://libertybancard\\.com${route}"`).test(html), `${route}: canonical`);
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => textOf(m[1]));
    ok(h1s.length === 1 && h1s[0] === seo.h1, `${route}: exactly one h1 equal to the shared heading`);
  }
  const titles = PARTNER_SSR_ROUTES.map((r) => PARTNER_PAGE_SEO[r].title);
  const descriptions = PARTNER_SSR_ROUTES.map((r) => PARTNER_PAGE_SEO[r].description);
  const heads = PARTNER_SSR_ROUTES.map((r) => PARTNER_PAGE_SEO[r].h1);
  ok(new Set(titles).size === 6 && new Set(descriptions).size === 6 && new Set(heads).size === 6, "every route has its own title, description and h1");
  ok(new Set([...titles, titles[0]]).size === titles.length, "negative control: a repeated title would not add a distinct entry");

  console.log("Hero photograph, caption, body images");
  for (const route of PARTNER_SSR_ROUTES) {
    const html = pages.get(route)!;
    const hero = html.match(/<section class="ssr-hero[^"]*" data-partner-hero="([^"]+)">([\s\S]*?)<\/section>/);
    ok(hero && hero[1] === route, `${route}: the hero section is present and names its route`);
    const heroImages = hero ? [...hero[2].matchAll(/<img [^>]*>/g)].map((m) => m[0]) : [];
    ok(heroImages.length === 1, `${route}: exactly one hero image`);
    ok(heroImages[0]?.includes('loading="eager"') && heroImages[0]?.includes('fetchpriority="high"'), `${route}: the hero image is eager with fetchpriority high`);
    ok(/<picture>[\s\S]*type="image\/avif"[\s\S]*type="image\/webp"/.test(hero?.[2] ?? ""), `${route}: AVIF and WebP sources precede the JPEG fallback`);
    ok(/width="\d+" height="\d+"/.test(heroImages[0] ?? ""), `${route}: the hero image has intrinsic dimensions`);
    ok(/alt="[^"]{25,}"/.test(heroImages[0] ?? ""), `${route}: the hero image has descriptive alt text`);
    ok((hero?.[2] ?? "").includes(escHtml(PARTNER_MEDIA_CAPTION)), `${route}: the hero shows the illustrative-scene caption`);
    const bodyImages = [...html.matchAll(/<figure class="ssr-partner-media ssr-partner-media--body"[\s\S]*?<\/figure>/g)].map((m) => m[0]);
    for (const figure of bodyImages) ok(/loading="lazy"/.test(figure) && !/fetchpriority/.test(figure), `${route}: body image is lazy`);
    const high = (html.match(/fetchpriority="high"/g) ?? []).length;
    ok(high <= 2, `${route}: at most the logo and the hero ask for high priority (${high})`);
  }
  ok(PARTNER_SSR_ROUTES.slice(3).every((r) => /partner-media--body/.test(pages.get(r)!)), "the three profession pages carry an editorial body image");

  console.log("Section rhythm, navy band, anchors");
  for (const route of PARTNER_SSR_ROUTES) {
    const html = pages.get(route)!;
    const tones = toneSequence(html);
    ok(JSON.stringify(tones) === JSON.stringify(EXPECTED_TONES[route]), `${route}: section tones ${tones.join(" > ")}`);
    ok(tones.includes("ink"), `${route}: at least one navy section before the footer`);
    const lastInk = html.lastIndexOf("ssr-section-ink");
    const footer = html.search(/<footer/);
    ok(footer === -1 || lastInk < footer, `${route}: the navy section sits before the footer`);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) ok(ids.includes(anchor), `${route}: in-page link #${anchor} has a target`);
    ok(ids.filter((i) => i === "apply").length <= 1, `${route}: #apply is not duplicated`);
    ok(ids.length === new Set(ids).size, `${route}: ids are unique`);
  }
  ok(toneSequence(`<section class="ssr-section ssr-section-warm"><section class="ssr-section ssr-section-canvas">`).join() === "warm,canvas", "negative control: the tone reader reads a different order");

  console.log("Structured data and FAQ");
  for (const route of PARTNER_SSR_ROUTES) {
    const html = pages.get(route)!;
    const blocks = jsonLd(html);
    const types = blocks.map((b) => b["@type"]);
    ok(types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("FAQPage"), `${route}: WebPage, BreadcrumbList and FAQPage structured data (${types.join(", ")})`);
    const faq = blocks.find((b) => b["@type"] === "FAQPage") as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    const expected = partnerRouteFaqs(route, DEFAULT_REFERRAL_POLICY);
    ok(faq.mainEntity.length === expected.length && faq.mainEntity.every((q, i) => q.name === expected[i].question && q.acceptedAnswer.text === expected[i].answer), `${route}: FAQ schema equals the shared FAQ (${expected.length})`);
    const visible = textOf(html);
    ok(expected.every((q) => visible.includes(q.question) && visible.includes(q.answer)), `${route}: every FAQ question and answer is visible text`);
    const page = blocks.find((b) => b["@type"] === "WebPage") as { url: string; name: string };
    ok(page.url === `https://libertybancard.com${route}` && page.name === PARTNER_PAGE_SEO[route].name, `${route}: WebPage url and name`);
  }
  ok(jsonLd(`<script type="application/ld+json">{"@type":"WebPage"}</script>`).every((b) => b["@type"] !== "FAQPage"), "negative control: a page without FAQ schema is detected");

  console.log("No stale or unsupported claim");
  for (const route of PARTNER_SSR_ROUTES) ok(!UNSUPPORTED.test(textOf(pages.get(route)!)), `${route}: no unsupported claim or proposed rate in the text`);
  ok(UNSUPPORTED.test("Earn 25% of residuals"), "negative control: a proposed percentage would be flagged");
  ok(UNSUPPORTED.test("Start earning in minutes"), "negative control: a speed claim would be flagged");

  console.log("Unapproved policy: no referral percentage, gated calculator");
  currentPolicy = DEFAULT_REFERRAL_POLICY;
  const referralRoutes = [PARTNER_ROUTES.hub, PARTNER_ROUTES.referral, PARTNER_ROUTES.cpa, PARTNER_ROUTES.bookkeeper, PARTNER_ROUTES.insurance];
  for (const route of referralRoutes) {
    const { body } = await get(route);
    const text = textOf(body);
    ok(!SHARE_SENTENCE.test(text), `${route}: no referral share sentence`);
    ok(text.includes(REFERRAL_WRITTEN_AGREEMENT_SENTENCE), `${route}: the written-agreement sentence is shown`);
    if (route !== PARTNER_ROUTES.referral) {
      ok(/data-partner-calculator-result="gated"/.test(body) && text.includes(REFERRAL_RESULT_GATED_MESSAGE), `${route}: the calculator shows the gated message`);
      ok(!/data-partner-calculator-result="amount"/.test(body), `${route}: no computed referral result`);
    }
  }
  const agentText = textOf((await get(PARTNER_ROUTES.salesAgent)).body);
  ok(!SHARE_SENTENCE.test(agentText), `${PARTNER_ROUTES.salesAgent}: no referral share sentence`);

  console.log("Approved policy: sentence and result appear, revocation shows on the next request");
  currentPolicy = APPROVED;
  for (const route of referralRoutes) {
    const { body } = await get(route);
    const text = textOf(body);
    ok(text.includes(`Earn ${FIXTURE_SHARE}% of eligible`), `${route}: the approved share appears (from the projection only)`);
    if (route !== PARTNER_ROUTES.referral) {
      ok(/data-partner-calculator-result="amount"/.test(body) && text.includes("$3,400"), `${route}: the calculator computes 20 x $100,000 x 100 bps x ${FIXTURE_SHARE}% = $3,400`);
      ok(!/data-partner-calculator-result="gated"/.test(body), `${route}: the gated message is gone while the policy is approved`);
    }
  }
  currentPolicy = DEFAULT_REFERRAL_POLICY;
  for (const route of referralRoutes) {
    const text = textOf((await get(route)).body);
    ok(!SHARE_SENTENCE.test(text) && !text.includes(`${FIXTURE_SHARE}%`), `${route}: after revocation the very next request carries no share`);
  }
  readerMode = "throws";
  for (const route of referralRoutes) {
    const res = await get(route);
    const text = textOf(res.body);
    ok(res.status === 200 && !SHARE_SENTENCE.test(text) && text.includes(REFERRAL_WRITTEN_AGREEMENT_SENTENCE), `${route}: a policy reader that throws serves the written agreement, never a number or a 500`);
  }
  readerMode = "policy";
  ok(SHARE_SENTENCE.test(textOf(getPartnerPageHtml(PARTNER_ROUTES.hub, APPROVED))), "negative control: the share test detects an approved render");
  let refused = false;
  try { getPartnerPageHtml("/partners/unknown", DEFAULT_REFERRAL_POLICY); } catch { refused = true; }
  ok(refused, "negative control: an unregistered route is refused rather than rendered with another page's copy");

  console.log("/affiliate");
  const affiliate = getAffiliatePageHtml();
  const affiliateH1 = [...affiliate.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => textOf(m[1]));
  ok(decode(affiliate.match(/<title>([^<]*)<\/title>/)?.[1] ?? "") === AFFILIATE_PAGE.title, "/affiliate: title");
  ok(affiliateH1.length === 1 && affiliateH1[0] === AFFILIATE_PAGE.heading, "/affiliate: one h1 equal to the shared heading");
  ok((affiliate.match(/<img [^>]*loading="eager"[^>]*fetchpriority="high"/g) ?? []).length >= 1 && affiliate.includes(escHtml(PARTNER_MEDIA_CAPTION)), "/affiliate: a hero photograph with the illustrative caption");
  ok(JSON.stringify(toneSequence(affiliate)) === JSON.stringify(["canvas", "ink"]), `/affiliate: tones ${toneSequence(affiliate).join(" > ")}`);
  ok(!UNSUPPORTED.test(textOf(affiliate)) && !SHARE_SENTENCE.test(textOf(affiliate)), "/affiliate: no rate or unsupported claim");

  console.log("Source guards");
  const source = fs.readFileSync(path.join(root, "server/ssr/partners.ts"), "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*(import|export)\b[^;]*\bfrom\b/.test(line) || /^\} from /.test(line));
  ok(importLines.length > 5 && !importLines.some((line) => /\/db"|partner-public-policy|storage"/.test(line)), "the document module imports no database, storage or policy service (the policy is an argument)");
  ok(/\/db"/.test('import { db } from "../db";'), "negative control: a database import would be detected");
  ok(!/\b(25|30)\s?%/.test(source), "the document module contains no proposed referral percentage");
  const routeSource = fs.readFileSync(path.join(root, "server/routes/ssr-routes.ts"), "utf8");
  ok(/registerPartnerPageRoutes\(app\)/.test(routeSource), "the production SSR route table registers the partnership routes");
  ok(!/PAGE_CACHE[\s\S]{0,80}getPartnerPageHtml/.test(routeSource), "negative control: the partnership documents never use the public page cache");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
