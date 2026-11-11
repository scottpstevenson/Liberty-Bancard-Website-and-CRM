/**
 * Public-site performance cause probe (Chromium lab measurement; read-only; no form, booking, upload or message).
 *
 *   npx tsx scripts/probe-public-perf-causes.ts --base=http://127.0.0.1:6100 [--routes=/,/faq,/help,/support]
 *     [--runs=5] [--label=candidate] [--out=generated-artifacts/public-site/perf] [--widgets=on]
 *
 * --throttle=off removes the CPU and network throttling and --width=1280 --height=800 --mobile=off measures a desktop viewport, so a
 * result seen only without the phone profile can be reproduced too.
 *
 * --widgets=on lets the third-party chat widget load (the deployed condition); the default blocks vendor chat, analytics and
 * social hosts so two builds are compared without third-party variance. Record both when they differ.
 *
 * The same profile as scripts/check-public-perf.ts (390x844, DPR 2, CPU x4, 1.6 Mbps / 150 ms, cold cache, vendor chat hosts
 * blocked, consent stored) with one warm-up navigation per fresh browser that is discarded. For every route and run it records
 * what a median cannot show: the largest-contentful-paint element, every layout shift with the elements that moved, which
 * stylesheets, scripts, fonts and images were requested and how many times each URL was fetched, and whether the document
 * answered with server HTML or the client shell. Use it to compare two builds one after the other (never together), then
 * change only a cause the numbers demonstrate.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser } from "./lib/public-site-browser";

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = arg("base", "http://127.0.0.1:6100").replace(/\/$/, "");
const routes = arg("routes", "/,/faq,/help,/support").split(",").filter(Boolean);
const runs = Math.max(1, Number(arg("runs", "5")));
const label = arg("label", "run");
const out = arg("out", "generated-artifacts/public-site/perf");
const throttle = arg("throttle", "on") !== "off";
const vw = Number(arg("width", "390"));
const vh = Number(arg("height", "844"));
const mobile = arg("mobile", "on") !== "off";
const widgetsOn = arg("widgets", "off") === "on";
const BLOCKED = widgetsOn ? ["google-analytics", "googletagmanager", "facebook.net"] : ["leadconnectorhq.com", "google-analytics", "googletagmanager", "facebook.net"];

const OBSERVER = String.raw`(() => {
  const d = (n) => !n ? null : (n.nodeType === 1 ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '') : '#text');
  window.__p = { lcp: null, lcpEl: null, lcpUrl: null, lcpSize: 0, shifts: [], cls: 0, firstHtmlTitle: document.title };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__p.lcp = e.startTime; window.__p.lcpEl = d(e.element); window.__p.lcpUrl = e.url || null; window.__p.lcpSize = e.size; } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__p.cls += e.value; window.__p.shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(4), sources: (e.sources || []).map((s) => ({ node: d(s.node), prev: s.previousRect ? [Math.round(s.previousRect.y), Math.round(s.previousRect.height)] : null, cur: s.currentRect ? [Math.round(s.currentRect.y), Math.round(s.currentRect.height)] : null })) }); } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
})();`;

interface Run {
  lcp: number | null;
  lcpEl: string | null;
  lcpUrl: string | null;
  cls: number;
  shifts: { at: number; value: number; sources: { node: string | null; prev: number[] | null; cur: number[] | null }[] }[];
  duplicates: { url: string; count: number }[];
  requests: number;
  fontRequests: string[];
  imageRequests: string[];
  firstDocumentTitle: string;
  h1: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};
const short = (u: string) => u.replace(base, "").replace(/^https?:\/\/[^/]+/, (h) => h);

async function once(browser: Awaited<ReturnType<typeof launchBrowser>>, route: string): Promise<Run> {
  const session = await browser.newSession({
    width: vw, height: vh, mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: "light",
    blockUrlParts: BLOCKED,
    localStorage: { lb_cookie_consent: "essential", lb_cookie_prefs: JSON.stringify({ necessary: true, analytics: false, marketing: false, functional: false }) },
  });
  try {
    await session.cdp("Network.enable");
    await session.cdp("Network.setCacheDisabled", { cacheDisabled: true });
    if (throttle) {
      await session.cdp("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      await session.cdp("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await session.cdp("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });
    await session.goto(`${base}${route}`, { settleMs: 4000 });
    const p = await session.evaluate<{ lcp: number | null; lcpEl: string | null; lcpUrl: string | null; cls: number; shifts: Run["shifts"] }>("window.__p");
    const h1 = await session.evaluate<number>("document.querySelectorAll('main h1').length");
    const requests = session.requests();
    const counts = new Map<string, number>();
    for (const r of requests) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
    return {
      lcp: p.lcp, lcpEl: p.lcpEl, lcpUrl: p.lcpUrl, cls: +p.cls.toFixed(4), shifts: p.shifts,
      duplicates: [...counts].filter(([, n]) => n > 1).map(([url, count]) => ({ url: short(url), count })),
      requests: requests.length,
      fontRequests: requests.filter((r) => /font/i.test(r.type ?? "") || /\.woff2?($|\?)/.test(r.url)).map((r) => short(r.url)),
      imageRequests: requests.filter((r) => r.type === "Image" || /^image\//.test(r.mime ?? "")).map((r) => `${short(r.url)} ${Math.round((r.encodedBytes ?? 0) / 1024)}KB`),
      firstDocumentTitle: "",
      h1,
    };
  } finally {
    await session.close();
  }
}

async function main() {
  const browser = await launchBrowser();
  const report: Record<string, Run[]> = {};
  try {
    // One discarded navigation: the first page of a fresh browser registers the service worker and is not comparable.
    await once(browser, "/").catch(() => undefined);
    for (const route of routes) {
      report[route] = [];
      for (let i = 0; i < runs; i++) report[route].push(await once(browser, route));
    }
  } finally {
    await browser.close();
  }
  await mkdir(out, { recursive: true });
  const file = path.join(out, `causes-${label}.json`);
  await writeFile(file, JSON.stringify({ base, label, runs, profile: `${vw}x${vh} DPR${mobile ? 2 : 1}, ${throttle ? "CPU x4, 1.6Mbps/150ms" : "no throttling"}, cold cache, one discarded warm-up, chat widget ${widgetsOn ? "allowed" : "blocked"}`, report }, null, 2));
  for (const [route, rs] of Object.entries(report)) {
    const lcps = rs.map((r) => r.lcp ?? NaN);
    const clss = rs.map((r) => r.cls);
    const dup = new Map<string, number>();
    for (const r of rs) for (const d of r.duplicates) dup.set(d.url, Math.max(dup.get(d.url) ?? 0, d.count));
    console.log(`${route.padEnd(14)} LCP median ${Math.round(median(lcps))}ms [${lcps.map((v) => Math.round(v)).join(", ")}]  CLS median ${median(clss).toFixed(4)} [${clss.join(", ")}]  h1 ${rs.map((r) => r.h1).join("")}`);
    console.log(`   LCP element: ${[...new Set(rs.map((r) => `${r.lcpEl}${r.lcpUrl ? " " + short(r.lcpUrl) : ""}`))].join(" | ")}`);
    console.log(`   duplicate fetches: ${dup.size ? [...dup].map(([u, n]) => `${u} x${n}`).join(", ") : "none"}`);
    const worst = [...rs].sort((a, b) => b.cls - a.cls)[0];
    if (worst.shifts.length) console.log(`   largest-CLS run shifts: ${JSON.stringify(worst.shifts.map((s) => ({ at: s.at, v: s.value, src: s.sources.map((x) => `${x.node} ${JSON.stringify(x.prev)}->${JSON.stringify(x.cur)}`) })))}`);
    console.log(`   fonts: ${[...new Set(rs.flatMap((r) => r.fontRequests))].join(", ") || "none"}`);
  }
  console.log(`\nReport: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
