/**
 * Server-versus-hydrated title and h1 parity (Chromium).
 *
 * A visitor or crawler first sees the server-rendered document; a moment later React replaces it. For each route this
 * check loads the page in Chromium, waits until the server markup has been replaced by the React tree, then compares the
 * hydrated document.title and h1 with the title and h1 of the server document (fetched from the same URL and parsed).
 * It fails on any difference, on a page that does not have exactly one h1 on either side, and on a title outside the
 * 30-70 character band that scripts/seo-audit.ts enforces (that limit counts the " | Liberty Bancard" suffix).
 *
 *   npx tsx scripts/check-public-server-hydrated-parity.ts [--base=http://127.0.0.1:5000] [--routes=/affiliate,/get-started]
 *
 * Exits non-zero when any route differs. PUBLIC_SITE_STRICT is accepted for symmetry with the other public-site checks;
 * this check has no advisory mode, so it is always strict.
 *
 * Crawler-branched pages (/free-smart-terminal, /blog, /blog/:slug) answer a known crawler with server HTML and a browser with
 * the React shell. For those, the "server document" is the crawler representation (fetched with a crawler user agent), so
 * the title and h1 a crawler indexes are compared with the title and h1 a visitor sees after hydration. Both cached
 * representations must also declare Vary: User-Agent, the crawler one must be publicly cacheable HTML, and the browser one
 * must not be publicly cacheable.
 *
 * Routes: the four pages that W-D recorded as "server and hydrated text differ" (/0-percent-processing, /affiliate,
 * /beat-square-stripe, /get-started), the terminal entrance of /get-started, /upload-statement, and every compare page.
 * The headline and title of each come from one shared module read by both renderers (shared/zero-percent-content.ts,
 * shared/public-affiliate.ts, shared/compare-content.ts, shared/public-get-started.ts,
 * shared/public-terminal-inquiry.ts, shared/free-statement-review-content.ts).
 */
import { COMPARE_SLUGS } from "../shared/compare-content";
import { launchBrowser } from "./lib/public-site-browser";

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = arg("base", process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");

/** Same band as scripts/seo-audit.ts (TITLE_MIN / TITLE_MAX); the limit counts the brand suffix. */
const TITLE_MIN = 30;
const TITLE_MAX = 70;
const HYDRATION_TIMEOUT_MS = 30_000;
const STABLE_POLLS = 4;
const POLL_MS = 250;

/**
 * A local development server sends no-store on every server-rendered page (PAGE_CACHE in server/routes/ssr-routes.ts), so
 * "publicly cacheable" can only be observed against a production-mode or published build. Vary: User-Agent is checked everywhere.
 */
const LOCAL_BASE = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base) && process.env.PUBLIC_SITE_EXPECT_PUBLIC_CACHE !== "1";
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Pages whose first response depends on the user agent. Slugs chosen because their server and React headlines once differed. */
const CRAWLER_BRANCHED_ROUTES = [
  "/free-smart-terminal",
  "/blog",
  "/blog/how-to-switch-payment-processors",
  "/blog/interchange-plus-vs-flat-rate",
  "/blog/cash-discount-vs-surcharging-what-is-legal",
];

const DEFAULT_ROUTES = [
  "/0-percent-processing",
  "/affiliate",
  "/beat-square-stripe",
  "/get-started",
  "/get-started?offer=free-terminal",
  "/upload-statement",
  ...COMPARE_SLUGS.map((slug) => `/compare/${slug}`),
  ...CRAWLER_BRANCHED_ROUTES,
];
const routes = arg("routes", DEFAULT_ROUTES.join(",")).split(",").filter(Boolean);
const BLOCK = ["leadconnectorhq.com", "google-analytics.com", "googletagmanager.com", "facebook.net", "clarity.ms"];

interface Observed {
  title: string;
  h1s: string[];
}

/** Whitespace is normalised the same way on both sides so a <br /> or a line break in markup is not a difference. */
function problemsFor(server: Observed, hydrated: Observed): string[] {
  const problems: string[] = [];
  if (server.h1s.length !== 1) problems.push(`server document has ${server.h1s.length} h1 elements, expected exactly 1`);
  if (hydrated.h1s.length !== 1) problems.push(`hydrated page has ${hydrated.h1s.length} h1 elements, expected exactly 1`);
  if (server.title !== hydrated.title) problems.push(`title differs: server "${server.title}" vs hydrated "${hydrated.title}"`);
  if (server.h1s.join(" | ") !== hydrated.h1s.join(" | ")) problems.push(`h1 differs: server "${server.h1s.join(" | ")}" vs hydrated "${hydrated.h1s.join(" | ")}"`);
  for (const [side, o] of [["server", server], ["hydrated", hydrated]] as const) {
    if (o.title.length < TITLE_MIN || o.title.length > TITLE_MAX) problems.push(`${side} title is ${o.title.length} characters, outside ${TITLE_MIN}-${TITLE_MAX}: "${o.title}"`);
  }
  return problems;
}

interface Representation {
  status: number;
  vary: string;
  cacheControl: string;
}

/** Cache correctness of the two representations of one URL: both vary on User-Agent, only the crawler HTML is public. */
function representationProblems(crawler: Representation, browser: Representation, expectPublicCrawlerCache = true): string[] {
  const problems: string[] = [];
  const varies = (v: string) => /(^|,)\s*user-agent\s*(,|$)/i.test(v);
  if (!varies(crawler.vary)) problems.push(`crawler response Vary "${crawler.vary}" omits User-Agent`);
  if (!varies(browser.vary)) problems.push(`browser response Vary "${browser.vary}" omits User-Agent`);
  if (crawler.status !== 200) problems.push(`crawler response is HTTP ${crawler.status}`);
  if (expectPublicCrawlerCache && !/public/i.test(crawler.cacheControl)) problems.push(`crawler response is not publicly cacheable ("${crawler.cacheControl}")`);
  if (/public/i.test(browser.cacheControl)) problems.push(`browser response is publicly cacheable ("${browser.cacheControl}") but is the React shell`);
  return problems;
}

/** Title and h1 elements of a document, whitespace and common entities normalised (no DOM needed in Node). */
function observeDocument(html: string): Observed {
  const n = (t: string) =>
    t.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#0*39;|&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: n(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    h1s: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => n(m[1])),
  };
}

/** Negative controls: the comparison must catch a changed h1, a changed title, a doubled h1 and an over-long title. */
function selfTest(): string[] {
  const failures: string[] = [];
  const same: Observed = { title: "Affiliate Program | Earn Residuals | Liberty Bancard", h1s: ["Earn Residual Income Referring Merchants"] };
  const expectProblems = (label: string, hydrated: Observed, expected: boolean, server: Observed = same) => {
    const found = problemsFor(server, hydrated).length > 0;
    if (found !== expected) failures.push(`self-test "${label}": expected ${expected ? "a problem" : "no problem"}`);
  };
  expectProblems("identical documents pass", { ...same, h1s: [...same.h1s] }, false);
  expectProblems("changed h1 is caught", { ...same, h1s: ["Earn Money Referring Businesses"] }, true);
  expectProblems("changed title is caught", { ...same, title: "Affiliate Program — Earn Commissions Referring Merchants | Liberty Bancard" }, true);
  expectProblems("second h1 is caught", { ...same, h1s: [...same.h1s, "Another heading"] }, true);
  const long: Observed = { title: `${"A".repeat(TITLE_MAX)} | Liberty Bancard`, h1s: same.h1s };
  expectProblems("over-long title is caught even when both sides match", long, true, long);
  const ok: Representation = { status: 200, vary: "Origin, User-Agent", cacheControl: "public, max-age=3600" };
  const shell: Representation = { status: 200, vary: "Origin, User-Agent", cacheControl: "no-store, no-cache" };
  const expectRep = (label: string, crawler: Representation, browser: Representation, expected: boolean) => {
    if ((representationProblems(crawler, browser).length > 0) !== expected) failures.push(`self-test "${label}": expected ${expected ? "a problem" : "no problem"}`);
  };
  expectRep("correct crawler and browser representations pass", ok, shell, false);
  expectRep("a crawler response without Vary: User-Agent is caught", { ...ok, vary: "Origin" }, shell, true);
  expectRep("a browser response without Vary: User-Agent is caught", ok, { ...shell, vary: "" }, true);
  expectRep("a publicly cacheable app shell is caught", ok, { ...shell, cacheControl: "public, max-age=3600" }, true);
  expectRep("a crawler document that is not publicly cacheable is caught", { ...ok, cacheControl: "no-store" }, shell, true);
  const doc = observeDocument("<html><head><title>A &amp; B | Liberty Bancard</title></head><body><h1>Head <br/>line</h1><h1>Second</h1></body></html>");
  if (doc.title !== "A & B | Liberty Bancard" || doc.h1s.join("|") !== "Head line|Second") failures.push(`self-test "document observation": got ${JSON.stringify(doc)}`);
  return failures;
}

/** Evaluated in the page: the hydrated title and h1, and whether the React tree has replaced the server markup. */
const HYDRATED_PROBE = `(() => {
  const n = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const root = document.getElementById('root');
  const serverMarkup = !!root && !!root.querySelector('.ssr-navbar, .ssr-hero');
  return { replaced: !!root && !serverMarkup, title: n(document.title), h1s: [...document.querySelectorAll('h1')].map((e) => n(e.textContent)) };
})()`;

/** Evaluated in the page: fetches the server document for the same URL and parses its title and h1 elements. */
const serverProbe = (route: string) => `fetch(${JSON.stringify(route)}, { cache: 'no-store', headers: { Accept: 'text/html' } }).then(async (r) => {
  const n = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const html = await r.text();
  const d = new DOMParser().parseFromString(html, 'text/html');
  return { status: r.status, contentType: r.headers.get('content-type') || '', title: n(d.title), h1s: [...d.querySelectorAll('h1')].map((e) => n(e.textContent)) };
})`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const selfFailures = selfTest();
  for (const f of selfFailures) console.log(`FAIL ${f}`);
  if (selfFailures.length) process.exit(1);
  console.log(`PASS comparison self-test: ${11} controls`);
  if (LOCAL_BASE) console.log("NOTE local development server: crawler public-cacheability is not asserted (development sends no-store); Vary: User-Agent is.");

  const browser = await launchBrowser();
  let failed = 0;
  try {
    for (const route of routes) {
      const session = await browser.newSession({ width: 1280, height: 900, blockUrlParts: BLOCK });
      const problems: string[] = [];
      let server: Observed = { title: "", h1s: [] };
      let hydrated: Observed = { title: "", h1s: [] };
      try {
        await session.goto(base + route, { settleMs: 500 });

        // Wait until the server markup has been replaced and the title and h1 have stopped changing.
        let last = "";
        let stable = 0;
        let replaced = false;
        const deadline = Date.now() + HYDRATION_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const probe = await session.evaluate<{ replaced: boolean; title: string; h1s: string[] }>(HYDRATED_PROBE);
          replaced = probe.replaced;
          hydrated = { title: probe.title, h1s: probe.h1s };
          const key = JSON.stringify(probe);
          stable = probe.replaced && probe.h1s.length > 0 && key === last ? stable + 1 : 0;
          last = key;
          if (stable >= STABLE_POLLS) break;
          await sleep(POLL_MS);
        }
        if (stable < STABLE_POLLS) {
          problems.push(replaced ? "hydrated title/h1 did not settle" : `page did not hydrate within ${HYDRATION_TIMEOUT_MS / 1000}s (server markup still present or no h1)`);
        }

        if (CRAWLER_BRANCHED_ROUTES.includes(route)) {
          // The document a crawler indexes (crawler user agent) against what a visitor sees after hydration.
          const get = (ua: string) => fetch(base + route, { headers: { "User-Agent": ua, Accept: "text/html" }, redirect: "follow" });
          const [crawlerRes, browserRes] = await Promise.all([get(CRAWLER_UA), get(BROWSER_UA)]);
          const crawlerHtml = await crawlerRes.text();
          await browserRes.text();
          const describe = (r: Response): Representation => ({ status: r.status, vary: r.headers.get("vary") ?? "", cacheControl: r.headers.get("cache-control") ?? "" });
          problems.push(...representationProblems(describe(crawlerRes), describe(browserRes), !LOCAL_BASE));
          if (!/text\/html/i.test(crawlerRes.headers.get("content-type") ?? "")) problems.push("crawler content-type is not HTML");
          server = observeDocument(crawlerHtml);
          problems.push(...problemsFor(server, hydrated));
        } else {
          const fetched = await session.evaluate<{ status: number; contentType: string } & Observed>(serverProbe(route));
          server = { title: fetched.title, h1s: fetched.h1s };
          if (fetched.status !== 200) problems.push(`server returned HTTP ${fetched.status}`);
          if (!/text\/html/i.test(fetched.contentType)) problems.push(`server content-type is "${fetched.contentType}", not HTML`);
          problems.push(...problemsFor(server, hydrated));
        }
      } catch (error) {
        problems.push(`probe error: ${(error as Error).message}`);
      } finally {
        await session.close();
      }
      if (problems.length) {
        failed += 1;
        console.log(`FAIL ${route}`);
        for (const p of problems) console.log(`     ${p}`);
      } else {
        console.log(`PASS ${route} — "${hydrated.h1s[0]}" / "${hydrated.title}" (${hydrated.title.length})`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${routes.length - failed}/${routes.length} routes show the same title and h1 before and after hydration`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
