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

const DEFAULT_ROUTES = [
  "/0-percent-processing",
  "/affiliate",
  "/beat-square-stripe",
  "/get-started",
  "/get-started?offer=free-terminal",
  "/upload-statement",
  ...COMPARE_SLUGS.map((slug) => `/compare/${slug}`),
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
  console.log(`PASS comparison self-test: ${5} controls`);

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

        const fetched = await session.evaluate<{ status: number; contentType: string } & Observed>(serverProbe(route));
        server = { title: fetched.title, h1s: fetched.h1s };
        if (fetched.status !== 200) problems.push(`server returned HTTP ${fetched.status}`);
        if (!/text\/html/i.test(fetched.contentType)) problems.push(`server content-type is "${fetched.contentType}", not HTML`);
        problems.push(...problemsFor(server, hydrated));
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
