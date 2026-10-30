import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 4B mounted-browser acceptance: private admin session, compiled production client, real route handlers
// for cold leads and the canonical backlog on a disposable database. Unregistered APIs answer 501 so unregistered
// readers must render explicit unavailable states. The Provider Results response is a FIXTURE-SUPPLIED payload
// (the route itself is not mounted here): this proves the client renders null/zero/positive costs without
// crashing, not that the live provider-results endpoint returns those values.
await verifyCandidateIdentity();
const dir = "generated-artifacts/stage4b-browser";
const clientRoot = path.resolve("dist/public");
const h = await stage3BHttpFixture(async (app) => {
  const contacts = await import("../server/routes/contacts.ts");
  contacts.registerContactsRoutes(app);
  const canonical = await import("../server/routes/canonical-enrichment.ts");
  canonical.registerCanonicalEnrichmentRoutes(app);
  app.get("/api/lead-ops/sfp/provider-results", (_req, res) => res.json({
    candidateResults: [], validationResults: [], validationSummary: null,
    classificationResults: [
      { id: "c-null", created_at: new Date().toISOString(), business_id: 1, business_name: "Null Cost Co", outcome: "target",
        resolved_vertical_id: "Automotive", admission_tier: "resolved_high", confidence: 90, terminal_state: "completed",
        taxonomy_version: 2, reason_codes: ["X"], cost_micros: null },
      { id: "c-zero", created_at: new Date().toISOString(), business_id: 2, business_name: "Zero Cost Co", outcome: "target",
        resolved_vertical_id: "Healthcare", admission_tier: "resolved_high", confidence: 90, terminal_state: "completed",
        taxonomy_version: 2, reason_codes: ["X"], cost_micros: 0 },
      { id: "c-paid", created_at: new Date().toISOString(), business_id: 3, business_name: "Paid Cost Co", outcome: "target",
        resolved_vertical_id: "Beauty/Spa", admission_tier: "resolved_high", confidence: 90, terminal_state: "completed",
        taxonomy_version: 2, reason_codes: ["X"], cost_micros: 2_500_000 },
    ],
  }));
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated Stage 4B fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

let b: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
const checks: string[] = [];
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks.push(label); console.log(`✓ ${label}`); };
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn: () => Promise<boolean>, label: string, tries = 80) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await settle(250); }
  throw new Error(`Timed out: ${label}`);
};
try {
  const tag = `4b${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    SELECT 'Cold','Browser '||g, $1||'-'||g||'@example.test','+1998'||lpad((g+3100000)::text,7,'0'),'production','dashboard',NOW()-INTERVAL '70 days','valid'
      FROM generate_series(1,3) g`, [tag]);
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    SELECT 'Cold','Bulk '||g, $1||'-bulk-'||g||'@example.test','+1997'||lpad((g+2100000)::text,7,'0'),'production','dashboard',NOW()-((71+(g%5))||' days')::interval,'valid'
      FROM generate_series(1,520) g`, [tag]);
  await mkdirp(dir);
  b = await privateStage3Browser(h.base, h.sessions.get("admin")!.cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
  await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // The app's service worker answers /api/contacts itself; page-level fault injection cannot see those requests.
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  const count = (selector: string) => b!.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`) as Promise<number>;
  const bodyText = () => b!.evaluate("document.body.innerText") as Promise<string>;

  // 1. Cold leads: accurate copy, named controls, SQL-paged total.
  await b.navigate("/dashboard/cold-leads");
  await b.waitFor(/Cold Lead Re-engagement/);
  await until(async () => (await count('[data-testid^="cold-lead-row-"]')) >= 3, "cold lead rows");
  const text1 = await bodyText();
  check(!/warmest|form submission/i.test(text1) && /not consent or permission/i.test(text1), "cold-list copy is accurate and states membership is not send permission");
  check(await count('button[aria-label="Refresh cold leads"]') === 1, "the refresh button has an accessible name");
  check(await count('[aria-label="Select all cold leads on this page"]') === 1, "the select-all checkbox has an accessible name");
  check(await count('[data-testid^="checkbox-cold-lead-"][aria-label^="Select Cold"]') >= 3, "each row checkbox is named for its contact");
  check(Number(await b.evaluate(`document.querySelector('[data-testid="text-cold-leads-total"]')?.textContent`)) >= 3, "the total comes from the server aggregate");

  const totalText = String(await b.evaluate(`document.querySelector('[data-testid="text-cold-leads-total"]')?.textContent`));
  check(Number(totalText.replace(/[^0-9]/g, "")) > 500, "the cold-lead total exceeds 500 and is the server aggregate, not the visible row count");
  check(await count('[data-testid^="cold-lead-row-"]') === 100, "more than 500 cold leads render one bounded page of 100 rows");
  await b.evaluate(`document.querySelector('[data-testid="button-cold-leads-next"]').click()`);
  await until(async () => (await b!.evaluate(`document.querySelector('[data-testid="button-cold-leads-prev"]')?.disabled === false`)) === true, "second page");
  check(await count('[data-testid^="cold-lead-row-"]') === 100, "the next page shows the next 100 rows");

  // 2. Cold leads read failure is unavailable, never zero.
  b.failRead("/api/contacts/cold-leads", { exact: true });
  await b.navigate("/dashboard/cold-leads");
  await until(async () => /Unavailable/.test(await b!.evaluate(`document.querySelector('[data-testid="text-cold-leads-total"]')?.textContent||""`) as string), "unavailable total");
  check(!(await count('[data-testid="empty-cold-leads"]')), "a failed cold-lead read does not render the empty-list state");
  b.failRead(null);

  // 3. Backlog aggregate failure leaves the independent process and release panels mounted.
  b.failRead("/api/canonical-enrichment/backlog", { exact: true });
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="backlog-unavailable"]')) === 1, "backlog unavailable state");
  check(await count('[data-testid="independent-process-panel"]') === 1, "process history mounts outside the aggregate barrier");
  check(await count('[data-testid="release-panel"]') === 1, "the release panel mounts outside the aggregate barrier");
  check(!/\b0 contacts\b/i.test(await bodyText()), "a failed aggregate is not shown as zero");
  b.failRead(null);
  // 3b. History fault and stall are independent of the aggregate.
  b.failRead("/api/canonical-enrichment/backlog-process-history", { exact: true });
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="backlog-last-run-unavailable"]')) === 1, "history unavailable state");
  check((await count('[data-testid="backlog-unavailable"]')) === 0 && !/no previous run\b(?!")/i.test(await bodyText().then((t) => t.replace(/not "no previous run"/gi, ""))),
    "a failed history read is shown as unknown while the aggregate still renders and nothing says no previous run");
  b.failRead(null);
  b.delayRead("/api/canonical-enrichment/backlog-process-history", 6000);
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="release-panel"]')) === 1 && (await count('[data-testid="backlog-unavailable"]')) === 0 &&
    (await count('[data-testid="canonical-backlog-loading"]')) === 0, "aggregate renders while history is delayed");
  check(await count('[data-testid="independent-process-panel"]') === 1, "the aggregate and release panel render while the history read is still pending");
  b.delayRead(null);

  // 3b. R01: the release panel is an independent sibling of the launch inventory in every inventory state.
  b.delayRead("/api/canonical-enrichment/launch-inventory", 8000);
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="launch-inventory-loading"]')) === 1, "launch inventory skeleton while the read is stalled");
  await until(async () => (await count('[data-testid="release-panel"]')) === 1, "release panel while the inventory is loading");
  check(await count('[data-testid="release-panel"]') === 1 && await count('[data-testid="launch-inventory-loading"]') === 1,
    "the release panel is mounted while the stalled launch inventory still shows its loading skeleton");
  b.delayRead(null);
  b.failRead("/api/canonical-enrichment/launch-inventory", { exact: true });
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="launch-inventory-unavailable"]')) === 1, "launch inventory unavailable state");
  check(await count('[data-testid="release-panel"]') === 1, "the release panel stays mounted when the launch inventory read fails");
  check(await b.evaluate(`document.querySelector('[data-testid="launch-inventory-unavailable-diagnostics"]').tagName`) === "DETAILS" &&
    await b.evaluate(`document.querySelector('[data-testid="launch-inventory-unavailable-diagnostics"]').open`) === false &&
    await count('[data-testid="launch-inventory-unavailable"] button') >= 1,
    "the inventory failure shows a concise notice with Retry and closed diagnostics");
  b.failRead(null);

  // 4. Provider Results: null, zero and positive costs render without a crash.
  const before = b.exceptions.length;
  await b.navigate("/dashboard/lead-ops?tab=provider-results");
  await until(async () => /Null Cost Co/.test(await bodyText()), "classification rows");
  const text4 = await bodyText();
  check(b.exceptions.length === before, "Provider Results throws no uncaught browser exception");
  check(/Unpriced/.test(text4) && /\$0\.00/.test(text4) && /\$2\.50/.test(text4), "null cost reads Unpriced, zero reads $0.00, 2,500,000 micros reads $2.50");

  // 5. SFP tab: cohort tools are present but secondary; businesses count is truthful when its read fails.
  await b.navigate("/dashboard/lead-ops?tab=sfp");
  await until(async () => (await count('[data-testid="sfp-cohort-tools"]')) === 1, "cohort tools container");
  check(await b.evaluate(`document.querySelector('[data-testid="sfp-cohort-tools"]').tagName`) === "DETAILS", "cohort tools are a collapsible section");
  b.failRead("/api/lead-ops/businesses", { exact: true });
  await b.navigate("/dashboard/lead-ops?tab=businesses");
  await until(async () => /Business count unavailable/.test(await bodyText()), "business count unavailable");
  check(!/\b0 canonical businesses\b/.test(await bodyText()), "a failed business-count read is not shown as 0");
  b.failRead(null);

  // 6. Narrow viewport: the touched pages stay inside a 390px-wide screen (a desktop run does not prove this).
  await b.evaluate("localStorage.setItem('prefer_desktop','true')");
  await b.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const overflow = () => b!.evaluate("document.documentElement.scrollWidth - window.innerWidth") as Promise<number>;
  await b.navigate("/dashboard/cold-leads");
  await until(async () => (await count('[data-testid^="cold-lead-row-"]')) >= 3, "mobile cold lead rows");
  check(await count('button[aria-label="Refresh cold leads"]') === 1 && await count('[data-testid="button-cold-leads-next"]') === 1,
    "on a 390px screen the cold-lead refresh and paging controls are present");
  const coldOverflow = await overflow();
  check(coldOverflow <= 1, `the cold-lead page does not scroll sideways on a 390px screen (overflow ${coldOverflow}px)`);
  await b.navigate("/dashboard/lead-ops?tab=canonical&canonicalView=backlog");
  await until(async () => (await count('[data-testid="release-panel"]')) === 1 && (await count('[data-testid="canonical-backlog-loading"]')) === 0, "mobile backlog");
  const backlogOverflow = await overflow();
  check(backlogOverflow <= 1, `the backlog page does not scroll sideways on a 390px screen (overflow ${backlogOverflow}px)`);
  await b.navigate("/dashboard/lead-ops?tab=provider-results");
  await until(async () => /Null Cost Co/.test(await bodyText()), "mobile provider results");
  const providerOverflow = await overflow();
  check(/Unpriced/.test(await bodyText()), "Provider Results still reads Unpriced on a 390px screen");
  // Either the document does not overflow, or any horizontal scroll sits inside a labelled table container.
  const providerScrollOwner = await b.evaluate(`(() => {
    const doc = document.documentElement.scrollWidth - window.innerWidth;
    const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => el !== document.documentElement && el !== document.body &&
      el.scrollWidth > el.clientWidth + 1 && ['auto','scroll'].includes(getComputedStyle(el).overflowX));
    return { doc, unlabelled: scrollers.filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('role') === 'region' || el.getAttribute('data-testid') || el.closest('[aria-label],[data-testid]'))).length, scrollers: scrollers.length };
  })()`) as { doc: number; unlabelled: number; scrollers: number };
  check(providerOverflow <= 1 && providerScrollOwner.unlabelled === 0,
    `Provider Results does not scroll the document sideways on a 390px screen (overflow ${providerOverflow}px; ${providerScrollOwner.scrollers} inner scroll container(s), none unlabelled)`);
  await b.screenshot("mobile-390");

  check(b.exceptions.length === before, "no uncaught browser exceptions across the Stage 4B checks");
  console.log(`STAGE4B_BROWSER_PASS (${checks.length} checks); admin desktop (1280px) and mobile (390px) runs, fixture-supplied provider-results payload`);
} catch (error) {
  await b?.screenshot("failure").catch(() => undefined);
  console.error(`STAGE4B_BROWSER_FAIL after ${checks.length} checks: ${String(error)}`);
  throw error;
} finally {
  await h.pool.query(`DELETE FROM contacts WHERE email LIKE $1`, [`4b%${"-"}%@example.test`]).catch(() => undefined);
  await b?.close();
  await h.close();
}

async function mkdirp(target: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(target, { recursive: true });
}
