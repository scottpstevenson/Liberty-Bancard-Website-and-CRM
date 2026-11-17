#!/usr/bin/env npx tsx
/**
 * test-partner-hub-react-media.ts
 *
 * Page-level check that the React hub (client/src/pages/ISOPartnerProgram.tsx) renders its registered body image, not
 * only that the manifest registers one. The page is rendered in-process with react-dom/server inside a query client and
 * a router; no server, database, network or provider I/O.
 *
 * What it proves
 *  - the rendered /partners page carries exactly one body image (data-testid img-partner-body) for the hub route, lazy and
 *    without fetchpriority, with the registered alt text, intrinsic dimensions, the partner-body derivative and the
 *    illustrative-scene caption;
 *  - the image sits inside the path-explanation section, after its heading and before the path cards, in the same lead row
 *    as the heading;
 *  - the hero is still the only eager, high-priority picture on the page.
 *
 * Every check family has a negative control.
 */
import { registerHooks } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PARTNER_ROUTES } from "../shared/partner-public-content";
import { PARTNER_MEDIA_CAPTION, partnerMediaFor } from "../shared/partner-page-media";

// The page imports bundler assets (logos, images); the browser build resolves them to URLs, so do the same here. The
// document head and the site chrome (Helmet, navigation bar, footer) are replaced by empty stand-ins: they are shared
// across the whole site, need providers this in-process render does not set up, and sit outside the hub's body.
const CHROME_STUBS: Record<string, string> = {
  "@/components/SEO": "export function SEO() { return null; } export default SEO;",
  "@/components/Navbar": "export function Navbar() { return null; } export default Navbar;",
  "@/components/Footer": "export function Footer() { return null; } export default Footer;",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = CHROME_STUBS[specifier];
    if (stub) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, format: "module", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (/\.(png|jpe?g|svg|webp|avif|gif|ico|woff2?)(\?.*)?$/.test(url)) return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    return nextLoad(url, context);
  },
});
// The page files use the classic JSX transform (no React import of their own), as the other in-process render suites do.
(globalThis as { React?: typeof React }).React = React;
const { default: ISOPartnerProgram } = await import("../client/src/pages/ISOPartnerProgram");

let checks = 0;
const failures: string[] = [];
function ok(cond: unknown, label: string) {
  checks++;
  if (!cond) { failures.push(label); console.log(`  FAIL ${label}`); } else console.log(`  ok   ${label}`);
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const entry = partnerMediaFor(PARTNER_ROUTES.hub, "body");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const html = renderToStaticMarkup(
  React.createElement(QueryClientProvider, { client }, React.createElement(Router, { ssrPath: PARTNER_ROUTES.hub }, React.createElement(ISOPartnerProgram))),
);

function problemsOf(page: string): string[] {
  const problems: string[] = [];
  const figures = [...page.matchAll(/<figure[^>]*data-testid="partner-media-body"[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  if (figures.length !== 1) return [`the hub renders ${figures.length} body figures, expected 1`];
  const figure = figures[0];
  if (!figure.includes(`data-partner-media-route="${PARTNER_ROUTES.hub}"`)) problems.push("the figure does not name the hub route");
  const img = figure.match(/<img [^>]*>/)?.[0] ?? "";
  if (!/<picture data-testid="img-partner-body">/.test(figure)) problems.push("the picture is not the body image");
  if (!img.includes(`alt="${esc(entry.alt)}"`)) problems.push("the image does not carry the registered alt text");
  if (!/loading="lazy"/.test(img) || /fetchpriority/i.test(img)) problems.push("the body image is not lazy");
  if (!/width="\d+"/.test(img) || !/height="\d+"/.test(img)) problems.push("the body image has no intrinsic dimensions");
  if (!new RegExp(`/images/public/${entry.imageId}-${entry.variant}-\\d+\\.(avif|webp|jpg)`).test(figure)) problems.push("the figure does not use the registered partner-body derivative");
  if (!figure.includes(esc(PARTNER_MEDIA_CAPTION))) problems.push("the illustrative-scene caption is missing");
  const section = page.match(/<section[^>]*data-testid="section-partner-paths"[\s\S]*?<\/section>/)?.[0] ?? "";
  if (!section.includes(figure)) problems.push("the image is not inside the path-explanation section");
  const heading = section.indexOf('id="partner-paths-heading"');
  const at = section.indexOf(figure);
  const cards = section.search(/data-testid="[^"]*path-card|data-partner-path-cards|partner-path-cards/);
  if (!(heading >= 0 && at > heading)) problems.push("the image does not follow the path heading");
  if (cards >= 0 && cards < at) problems.push("the image sits after the path cards");
  const lead = section.match(/<div[^>]*data-testid="partner-paths-lead"[\s\S]*?<\/figure>/)?.[0] ?? "";
  if (!(lead.includes('id="partner-paths-heading"') && lead.includes(figure))) problems.push("the heading and image are not composed as one lead row");
  return problems;
}

console.log("Hub body image in the rendered React page");
const problems = problemsOf(html);
ok(problems.length === 0, `hub: the registered body image (${entry.imageId}) is rendered once, lazy, in the path section ${problems.join("; ")}`);
const eager = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]).filter((t) => /loading="eager"/.test(t));
const heroEntry = partnerMediaFor(PARTNER_ROUTES.hub, "hero");
ok(eager.length === 1 && eager[0].includes(`/images/public/${heroEntry.imageId}-${heroEntry.variant}-`) && /fetchpriority="high"/i.test(eager[0]) && (html.match(/fetchpriority="high"/gi) ?? []).length === 1, "the hero is the only eager, high-priority picture");
ok(problemsOf(html.replace(/<figure[^>]*data-testid="partner-media-body"[\s\S]*?<\/figure>/, "")).length > 0, "negative control: a hub page without the body image is caught");
ok(problemsOf(html.replace(/(<figure[^>]*data-testid="partner-media-body"[\s\S]*?<img [^>]*?)loading="lazy"/, '$1loading="eager"')).length > 0, "negative control: an eager body image is caught");
ok(problemsOf(html.replace('data-testid="section-partner-paths"', 'data-testid="section-elsewhere"')).length > 0, "negative control: an image outside the path section is caught");

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
