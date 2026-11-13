import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

/**
 * Phase 6 closure: real Chromium against the compiled client, real persisted sessions and the real contact, deal, task and
 * notification handlers on a disposable database. Unregistered APIs answer 501, so unregistered readers must render explicit
 * unavailable states. Not covered here (stated, not hidden): WebKit and real phones cannot run in this environment, Lead Ops
 * is audited with its sources unregistered (layout, headings and named controls only), and numbers are fixture-scale.
 */
await verifyCandidateIdentity();
const dir = "docs/certification/phase6-closure/browser";
const clientRoot = path.resolve("dist/public");
const h = await stage3BHttpFixture(async (app) => {
  for (const [file, fn] of [
    ["contacts", "registerContactsRoutes"], ["crm-operations", "registerCrmOperationsRoutes"],
    ["activity", "registerActivityRoutes"], ["tickets-tasks", "registerTicketsTasksRoutes"],
    ["notifications", "registerNotificationsRoutes"], ["deals", "registerDealsRoutes"],
    ["message-drafts", "registerMessageDraftRoutes"], ["daily-briefing", "registerDailyBriefingRoutes"],
    ["my-day", "registerMyDayRoutes"], ["toolkit", "registerToolkitRoutes"],
    ["inbox", "registerInboxRoutes"], ["live-chat", "registerLiveChatRoutes"],
    ["analytics", "registerAnalyticsRoutes"], ["conversation-ai-config", "registerConversationAiConfigRoutes"],
    ["nba", "registerNbaRoutes"],
  ]) { const module = await import(`../server/routes/${file}.ts`); module[fn](app); }
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated Phase 6 fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

type Browser = Awaited<ReturnType<typeof privateStage3Browser>>;
const results: Array<Record<string, unknown>> = [];
const checks: string[] = [];
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (ok) { checks.push(label); console.log(`✓ ${label}`); } else { failures.push(label); console.log(`✗ ${label}`); }
};
/** Run one scenario; a thrown error is recorded as that scenario's failure and the remaining scenarios still run. */
let requestMark = 0;
/** Counts of the page's own API requests by route shape since the previous mark, so a burst is visible in the evidence. */
function requestShapes() {
  const shapes = new Map<string, { count: number; statuses: Set<string> }>();
  const fresh = (browsers[0]?.requests ?? []).slice(requestMark);
  requestMark = (browsers[0]?.requests ?? []).length;
  for (const r of fresh) {
    const key = `${r.method} ${r.url.split("?")[0].replace(/\/\d+/g, "/:id")}`;
    const entry = shapes.get(key) ?? { count: 0, statuses: new Set<string>() };
    entry.count++; entry.statuses.add(String(r.status ?? r.failed ?? "pending")); shapes.set(key, entry);
  }
  return [...shapes].map(([key, v]) => `${key} x${v.count} [${[...v.statuses].join(",")}]`).sort();
}
async function section(name: string, run: () => Promise<void>) {
  await settleDatabase(name).catch(() => undefined);
  try { await run(); results.push({ label: `requests during ${name}`, shapes: requestShapes() }); } catch (error) { results.push({ label: `requests during ${name} (failed)`, shapes: requestShapes() });
    failures.push(`${name}: ${String((error as Error)?.message ?? error).slice(0, 600)}`); console.log(`✗ ${name}: ${String((error as Error)?.message ?? error).slice(0, 300)}`); }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const browsers: Browser[] = [];

async function open(cookie: string, zoom?: number): Promise<Browser> {
  const b = await privateStage3Browser(h.base, cookie, h.originalFetch, dir, { realInput: true, zoom, startupTimeoutMs: 40000 });
  browsers.push(b);
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  return b;
}
async function until(b: Browser, expression: string, label: string, tries = 160) {
  for (let n = 0; n < tries; n++) { if (await b.evaluate(expression)) return; await sleep(100); }
  const text = String(await b.evaluate("document.body?.innerText ?? ''")).replace(/\s+/g, " ").slice(0, 400);
  const failedReads = b.requests.filter((r) => (r.status ?? 0) >= 400 || r.failed).slice(-8).map((r) => `${r.method} ${r.url.split("?")[0]} ${r.status ?? r.failed}`);
  await b.screenshot(`unmet-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`).catch(() => undefined);
  throw new Error(`Condition not reached: ${label}; URL=${await b.evaluate("location.pathname+location.search")}; page text: "${text}"; failed reads: ${JSON.stringify(failedReads)}`);
}
async function prepare(b: Browser) {
  // First page load of the origin so storage can be written, then the app's own desktop preference (narrow widths otherwise
  // redirect to the dedicated mobile shell) and the already-dismissed tour/notice flags.
  await b.navigate("/login");
  await b.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')");
}
const setWidth = (b: Browser, width: number, height = 900) =>
  b.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

/** One page audit: layout, headings and named controls, measured on the rendered page. */
async function audit(b: Browser, label: string) {
  const facts = await b.evaluate(`(()=>{
    const named = el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
      if (el.tagName === 'INPUT' && (el.type === 'hidden')) return true;
      if (el.id && document.querySelector('label[for="'+CSS.escape(el.id)+'"]')) return true;
      if (el.closest('label')) return true;
      if ((el.textContent||'').trim().length) return true;
      if (el.querySelector('img[alt]:not([alt=""]),svg[aria-label],[aria-label]')) return true;
      return false;
    };
    const visible = el => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden' && !el.closest('details:not([open]):not(summary)');
    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"]')].filter(visible);
    return {
      width: innerWidth, dpr: devicePixelRatio, documentWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('h1').length, h1: [...document.querySelectorAll('h1')].map(e => e.textContent.trim().slice(0,60)),
      controls: controls.length,
      unnamed: controls.filter(el => !named(el)).slice(0,5).map(el => el.tagName + ':' + (el.getAttribute('data-testid')||el.className||'').toString().slice(0,60)),
      title: document.querySelector('[data-testid="workspace-title"]')?.getAttribute('data-area') ?? null,
      breadcrumb: document.querySelector('[data-testid="shell-breadcrumb"]')?.textContent?.trim() ?? null,
      mainPresent: !!document.querySelector('main'),
    };
  })()`) as any;
  const row = { label, ...facts };
  results.push(row);
  if (facts.documentWidth > facts.width + 1) failures.push(`${label}: horizontal overflow (${facts.documentWidth} > ${facts.width})`);
  if (facts.h1Count !== 1) failures.push(`${label}: expected exactly one h1, found ${JSON.stringify(facts.h1)}`);
  if (facts.unnamed.length) failures.push(`${label}: visible controls without an accessible name ${JSON.stringify(facts.unnamed)}`);
  if (b.exceptions.length) failures.push(`${label}: uncaught page exception ${JSON.stringify(b.exceptions.slice(0, 2))}`);
  return facts;
}

// Observation only: which statements wait on, and hold, advisory locks while real pages load. A separate connection is used so the
// observation is not itself starved when the application pool is busy.
const lockWaiting = new Map<string, number>();
const lockHolding = new Map<string, number>();
const watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
await watcher.connect();
let watching = false;
const lockWatch = setInterval(async () => {
  if (watching) return;
  watching = true;
  try {
    const waiting = await watcher.query(`SELECT left(regexp_replace(query,'\\s+',' ','g'),220) AS q, count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory' GROUP BY 1`);
    for (const row of waiting.rows) lockWaiting.set(row.q, Math.max(lockWaiting.get(row.q) ?? 0, row.n));
    const holding = await watcher.query(`SELECT left(regexp_replace(a.query,'\\s+',' ','g'),220) AS q, count(DISTINCT a.pid)::int AS n FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.granted AND a.datname=current_database() GROUP BY 1`);
    for (const row of holding.rows) lockHolding.set(row.q, Math.max(lockHolding.get(row.q) ?? 0, row.n));
  } catch { /* observation only */ } finally { watching = false; }
}, 400);

/** Waits until no application statement is running, so one scenario's leftover requests cannot starve the next scenario's pool. */
const settleLog: Array<{ before: string; waitedMs: number; settled: boolean }> = [];
async function settleDatabase(before: string) {
  const started = Date.now();
  let settled = false;
  while (Date.now() - started < 30000) {
    const busy = await watcher.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle' AND backend_type='client backend'`);
    if (busy.rows[0].n === 0) { settled = true; break; }
    await sleep(250);
  }
  settleLog.push({ before, waitedMs: Date.now() - started, settled });
}

try {
  await mkdir(dir, { recursive: true });
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  const phone = (n: number) => "+1908" + String((Date.now() + n) % 10000000).padStart(7, "0");
  const contactRow = async (first: string, last: string, assignedTo: string, n: number) =>
    Number((await h.pool.query(`INSERT INTO contacts(first_name,last_name,company_name,email,phone,record_class,assigned_to,email_status)
      VALUES($1,$2,'Phase6 Fixture Co',$3,$4,'production',$5,'valid') RETURNING id`,
    [first, last, `${h.prefix}-p6-${n}@example.test`, phone(n), assignedTo])).rows[0].id);
  const c1 = await contactRow("Alpha", "Phasesix", h.email("admin"), 1);
  const c2 = await contactRow("Bravo", "Phasesix", h.email("admin"), 2);
  const privateContact = await contactRow("Private", "OtherOwner", h.email("other"), 3);
  for (let n = 0; n < 24; n++) {
    await h.pool.query(`INSERT INTO deals(contact_id,name,pipeline,stage,owner,record_class) VALUES($1,$2,'sales','New Lead',$3,'production')`,
      [n % 2 ? c1 : c2, `Phase6 deal ${n}`, h.email("admin")]);
  }
  for (let n = 0; n < 40; n++) {
    await h.pool.query(`INSERT INTO notifications(channel,recipient_id,title,message,type,read) VALUES('in_app',$1,$2,$3,'info',false)`,
      [h.userId("admin"), `Phase6 notice ${n}`, "A fixture notification with enough text to wrap on a 320 pixel screen and prove the card layout holds."]);
  }
  const recordHref = (id: number) => `/dashboard/contacts/${id}?area=overview&section=overview`;
  const goInApp = (b: Browser, url: string) =>
    b.evaluate(`(()=>{history.pushState({},'',${JSON.stringify(url)});window.dispatchEvent(new PopStateEvent('popstate'));return true})()`);

  const admin = await open(h.sessions.get("admin")!.cookie);
  await prepare(admin);
  const destinations: Array<{ path: string; ready: string; name: string }> = [
    { path: recordHref(c1), ready: "!!document.querySelector('[data-testid=\"text-contact-name\"]')", name: "contact-record" },
    { path: "/dashboard/pipeline", ready: "!!document.querySelector('[data-testid^=\"card-deal-\"]')", name: "pipeline" },
    { path: "/dashboard/notifications", ready: "!!document.querySelector('[data-testid^=\"card-notification-\"]')", name: "notifications" },
    { path: "/dashboard/lead-ops", ready: "!!document.querySelector('main')", name: "lead-ops-unregistered-sources" },
  ];
  const timings: Record<string, number> = {};
  // ── 1. Layout, headings and named controls: five widths for each destination ───────────────────────────────────────────
  await section("layout-and-names", async () => {
  const failuresBefore = failures.length;
  for (const width of [1280, 768, 454, 390, 320]) {
    await setWidth(admin, width);
    for (const destination of destinations) {
      try {
        const started = Date.now();
        await admin.navigate(destination.path);
        await until(admin, destination.ready, `${destination.name} @${width}`, 300);
        await sleep(600);
        if (width === 1280) timings[destination.name] = Date.now() - started;
        await audit(admin, `${destination.name} @${width}px`);
      } catch (error) { failures.push(`${destination.name} @${width}px: ${String((error as Error).message).slice(0, 700)}`); }
    }
  }
  check(failures.length === failuresBefore, "contact record, Pipeline, Notifications and Lead Ops have no horizontal overflow, one h1, named controls or page exception at 1280, 768, 454, 390 and 320 px");
  await setWidth(admin, 1280);
  await admin.navigate("/dashboard/notifications");
  await until(admin, "!!document.querySelector('[data-testid^=\"card-notification-\"]')", "notifications populated");
  await admin.screenshot("notifications-1280");
  check(await admin.evaluate("document.querySelectorAll('[data-testid^=\"card-notification-\"]').length") >= 20, "the populated Notifications list renders its rows");
  check(timings.notifications < 8000 && timings.pipeline < 8000 && timings["contact-record"] < 8000,
    `populated pages reach visible records within 8 s on the fixture (contact ${timings["contact-record"]} ms, Pipeline ${timings.pipeline} ms, Notifications ${timings.notifications} ms; fixture scale, not production)`);

  });
  // ── 2. Native 200% browser zoom ──────────────────────────────────────────────────────────────────────────────────────
  await section("zoom-200", async () => {
  const zoomBefore = failures.length;
  const zoomed = await open(h.sessions.get("admin")!.cookie, 2);
  await prepare(zoomed);
  for (const destination of destinations.slice(0, 3)) {
    try {
      await zoomed.navigate(destination.path);
      await until(zoomed, destination.ready, `${destination.name} @200%`, 300);
      await sleep(600);
      const facts = await audit(zoomed, `${destination.name} @200% zoom`);
      if (!(facts.dpr >= 1.9 && facts.width <= 800)) failures.push(`${destination.name}: native 200% zoom not observed (dpr ${facts.dpr}, width ${facts.width})`);
    } catch (error) { failures.push(`${destination.name} @200%: ${String((error as Error).message).slice(0, 700)}`); }
  }
  await zoomed.screenshot("contact-200-percent");
  check(failures.length === zoomBefore, "contact record, Pipeline and Notifications hold at native 200% browser zoom (no overflow, one h1, named controls)");
  await zoomed.close();

  });
  // ── 3. Workspace identity: origin, Back, reload ──────────────────────────────────────────────────────────────────────
  await section("workspace-identity", async () => {
  await setWidth(admin, 1280);
  await admin.navigate("/dashboard/pipeline");
  await until(admin, "!!document.querySelector('[data-testid=\"workspace-title\"]')?.getAttribute('data-area')", "Pipeline workspace title");
  const pipelineArea = await admin.evaluate("document.querySelector('[data-testid=\"workspace-title\"]')?.getAttribute('data-area')");
  await goInApp(admin, recordHref(c1));
  await until(admin, "!!document.querySelector('[data-testid=\"text-contact-name\"]')", "record opened from Pipeline");
  const backText = String(await admin.evaluate("document.querySelector('[data-testid=\"button-back\"]')?.textContent?.trim()"));
  check(/^Back to /.test(backText) && !/Contacts$/.test(backText), `a record opened from the Pipeline offers Back to its area ("${backText}")`);
  check(await admin.evaluate("document.querySelectorAll('h1').length") === 1, "the record page has one h1");
  await admin.navigate(recordHref(c1));
  await until(admin, "!!document.querySelector('[data-testid=\"text-contact-name\"]')", "record after reload");
  check(String(await admin.evaluate("document.querySelector('[data-testid=\"button-back\"]')?.textContent?.trim()")) === backText,
    "after a full reload the record still offers the same Back destination");
  await admin.click('[data-testid="button-back"]');
  await until(admin, "location.pathname==='/dashboard/pipeline'", "Back returns to Pipeline");
  await until(admin, "!!document.querySelector('[data-testid=\"workspace-title\"]')?.getAttribute('data-area')", "Pipeline workspace title after Back");
  const areaAfterBack = await admin.evaluate("document.querySelector('[data-testid=\"workspace-title\"]')?.getAttribute('data-area')");
  check(pipelineArea === areaAfterBack, `Back lands in the same workspace area it left (${pipelineArea} -> ${areaAfterBack})`);
  await goInApp(admin, recordHref(c1));
  await until(admin, "!!document.querySelector('[data-testid=\"text-contact-name\"]')", "record again");
  await admin.evaluate("history.back()");
  await until(admin, "location.pathname==='/dashboard/pipeline'", "browser Back returns to Pipeline");
  check(true, "browser Back and the in-page Back control both return to the originating Pipeline");

  });
  // ── 3b. Breakpoint transition (CRM-05): the record address survives narrowing, the explicit choice and widening ─────────
  await section("breakpoint-continuity", async () => {
  const noticeUp = "!!document.querySelector('[data-testid=\"mobile-destination-notice\"]')";
  const recordUp = "!!document.querySelector('[data-testid=\"text-contact-name\"]')";
  const here = "location.pathname+location.search";
  const wanted = recordHref(c1);
  await admin.evaluate("localStorage.removeItem('prefer_desktop')");
  await setWidth(admin, 1280);
  await admin.navigate(wanted);
  await until(admin, recordUp, "record at desktop width without the desktop preference");
  await setWidth(admin, 390);
  await until(admin, noticeUp, "narrowing an open record shows the choice instead of replacing the page");
  check(await admin.evaluate(here) === wanted, `narrowing the window keeps the exact record address (${await admin.evaluate(here)})`);
  check(String(await admin.evaluate("document.querySelector('[data-testid=\"link-mobile-record\"]')?.getAttribute('href') ?? ''")).startsWith(`/mobile/contacts/${c1}`),
    "the notice offers the same contact on mobile knowingly, not the mobile home page");
  await setWidth(admin, 1280);
  await until(admin, recordUp, "widening again restores the record");
  check(await admin.evaluate(here) === wanted, "widening the window shows the same record at the same address (area and section kept)");
  await setWidth(admin, 390);
  await until(admin, noticeUp, "choice shown again at phone width");
  await admin.click('[data-testid="button-open-desktop-layout"]');
  await until(admin, recordUp, "desktop layout opened from the choice");
  check(await admin.evaluate(here) === wanted && await admin.evaluate("localStorage.getItem('prefer_desktop')") === "true",
    "choosing the desktop layout opens the same record at the same address and remembers the choice");
  await admin.evaluate("localStorage.removeItem('prefer_desktop')");
  await admin.navigate(`/dashboard/contacts/${c1}`);
  await until(admin, "location.pathname==='/mobile/contacts/" + c1 + "'", "a phone-width link without a record area opens the same contact on mobile", 200);
  check(true, "a phone-width link to a contact with no record area opens that same contact in the mobile app (not the mobile home page)");
  await admin.evaluate("localStorage.setItem('prefer_desktop','true')");
  await setWidth(admin, 1280);

  });
  // ── 4. Late response: a slow earlier record never replaces the record now on screen ────────────────────────────────────
  await section("late-response", async () => {
  await admin.navigate(recordHref(c2));
  await until(admin, "!!document.querySelector('[data-testid=\"text-contact-name\"]')", "record two loaded");
  admin.delayRead(`/api/contacts/${c1}`, 3500);
  await goInApp(admin, recordHref(c1));
  await sleep(300);
  await goInApp(admin, recordHref(c2));
  await sleep(4500);
  admin.delayRead(null);
  const shownName = String(await admin.evaluate("document.querySelector('[data-testid=\"text-contact-name\"]')?.textContent ?? ''"));
  check(/Bravo/.test(shownName) && !/Alpha/.test(shownName), `a late response for the earlier record did not replace the visible record ("${shownName.trim()}")`);

  });
  // ── 5. Actor separation in one browser profile, including offline ────────────────────────────────────────────────────
  await section("actor-separation", async () => {
  await admin.navigate(recordHref(c1));
  await until(admin, "!!document.querySelector('[data-testid=\"text-contact-name\"]')", "admin record before actor change");
  const agentCookie = h.sessions.get("other")!.cookie;
  await admin.call("Network.clearBrowserCookies");
  for (const entry of agentCookie.split("; ")) {
    const i = entry.indexOf("=");
    await admin.call("Network.setCookie", { name: entry.slice(0, i), value: entry.slice(i + 1), url: h.base });
  }
  await admin.navigate(recordHref(c1));
  await sleep(2500);
  const asAgent = String(await admin.evaluate("document.body.innerText"));
  check(!/Alpha\s+Phasesix/.test(asAgent), "after the actor changes in the same browser profile, the previous actor's record is not shown to the next actor");
  await admin.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await admin.evaluate("window.dispatchEvent(new Event('offline'))");
  await sleep(600);
  const offlineText = String(await admin.evaluate("document.body.innerText"));
  check(!/Alpha\s+Phasesix/.test(offlineText), "while offline, the previous actor's record does not reappear for the next actor");
  await admin.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  });
  // ── 6. Permission revocation: a manager demoted mid-session loses the manager-only page ───────────────────────────────
  await section("permission-revocation", async () => {
  const manager = await open(h.sessions.get("manager")!.cookie);
  await prepare(manager);
  await setWidth(manager, 1280);
  await manager.navigate("/dashboard/lead-ops");
  await until(manager, "!!document.querySelector('main')", "manager Lead Ops");
  check(await manager.evaluate("location.pathname") === "/dashboard/lead-ops", "a manager can open Lead Ops before revocation");
  await h.pool.query("UPDATE users SET role='agent' WHERE id=$1", [h.userId("manager")]);
  await manager.navigate("/dashboard/lead-ops");
  await sleep(2500);
  const afterRevocation = { path: String(await manager.evaluate("location.pathname")), h1: String(await manager.evaluate("document.querySelector('h1')?.textContent ?? ''")) };
  check(afterRevocation.path !== "/dashboard/lead-ops" || /not authorized|access|denied/i.test(String(await manager.evaluate("document.body.innerText"))),
    `after the role is revoked the manager-only page is no longer offered (now ${afterRevocation.path})`);
  await h.pool.query("UPDATE users SET role='manager' WHERE id=$1", [h.userId("manager")]);

  });
  // ── 7. Keyboard: focus moves through named controls and is never lost to the page body ──────────────────────────────
  await section("keyboard", async () => {
  await setWidth(admin, 1280);
  await admin.call("Network.clearBrowserCookies");
  for (const entry of h.sessions.get("admin")!.cookie.split("; ")) {
    const i = entry.indexOf("="); await admin.call("Network.setCookie", { name: entry.slice(0, i), value: entry.slice(i + 1), url: h.base });
  }
  await admin.navigate("/dashboard/notifications");
  await until(admin, "!!document.querySelector('[data-testid^=\"card-notification-\"]')", "notifications for keyboard pass");
  const focusTrail: string[] = [];
  for (let n = 0; n < 30; n++) {
    await admin.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await admin.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await admin.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    focusTrail.push(String(await admin.evaluate(`(()=>{const e=document.activeElement;if(!e||e===document.body)return 'BODY';
      const r=e.getBoundingClientRect();const named=!!(e.getAttribute('aria-label')||(e.textContent||'').trim()||e.getAttribute('title')||e.getAttribute('aria-labelledby')||e.querySelector('img[alt]:not([alt=""]),svg[aria-label],[aria-label]'));
      return e.tagName+'|'+(e.getAttribute('data-testid')||'')+'|'+(named?'named':'UNNAMED')+'|'+(r.width>0&&r.height>0?'box':'NOBOX');})()`)));
  }
  check(!focusTrail.some((entry) => entry === "BODY" && focusTrail.indexOf(entry) > 2), "Tab never drops focus back to the page body after the first controls");
  check(!focusTrail.some((entry) => /UNNAMED|NOBOX/.test(entry)),
    `every focused control is named and has a box (offending: ${JSON.stringify(focusTrail.filter((entry) => /UNNAMED|NOBOX/.test(entry)))})`);
  check(new Set(focusTrail).size >= 12, `keyboard focus visits ${new Set(focusTrail).size} distinct controls in 30 presses`);
  results.push({ label: "keyboard focus trail", trail: focusTrail });

  });
  // ── 8. Visibility and refusal: signed-in roles against the registered reads ─────────────────────────────────────────
  await section("visibility-matrix", async () => {
  const staff = ["admin", "manager", "agent"];
  const nonStaff = ["merchant", "affiliate", "partner"];
  const observed: Array<{ role: string; path: string; status: number; fixtureRowsReturned: boolean }> = [];
  for (const probePath of ["/api/contacts?limit=50", "/api/deals", "/api/notifications"]) {
    for (const role of [...staff, ...nonStaff]) {
      const response = await h.request(role, "GET", probePath);
      const text = JSON.stringify(response.body ?? {});
      const fixtureRowsReturned = /Phasesix|Phase6 deal|Phase6 notice|OtherOwner/.test(text);
      observed.push({ role, path: probePath, status: response.status, fixtureRowsReturned });
      if (nonStaff.includes(role)) {
        check(response.status === 401 || response.status === 403 || !fixtureRowsReturned,
          `${role} ${probePath}: refused (${response.status}) or returned none of the staff fixture rows`);
      } else if (role === "admin") {
        check(response.status === 200 && fixtureRowsReturned, `admin ${probePath}: allowed and returns the fixture rows (${response.status})`);
      } else {
        check(response.status === 200 || response.status === 403, `${role} ${probePath}: answered with a real status (${response.status}), not a failure`);
        if (probePath === "/api/notifications") check(!fixtureRowsReturned, `${role} ${probePath}: another actor's notifications are not returned`);
      }
    }
  }
  results.push({ label: "visibility and refusal matrix (HTTP, signed-in roles)", observed });
  const privateRead = await h.request("agent", "GET", `/api/contacts/${privateContact}`);
  check(privateRead.status === 403 || privateRead.status === 404, `an agent reading another agent's contact is refused (${privateRead.status}), not shown a blank record`);
  const ownRead = await h.request("other", "GET", `/api/contacts/${privateContact}`);
  check(ownRead.status === 200, "the owning agent reads the same contact");

  });
  // ── 9. Single-record claim of unassigned work: fenced, one winner, nothing assigned automatically ───────────────────────
  await section("claim-fencing", async () => {
    const unassignedTask = async (label: string) => (await h.pool.query(
      `INSERT INTO tasks(title,status,authority_state) VALUES($1,'pending','open') RETURNING id`, [`${h.prefix} ${label}`])).rows[0].id as number;
    const claimBody = (role: string, fence = 0) => ({ assignedTo: h.email(role), expectedFence: fence, commandId: randomUUID(), expectedActorId: h.userId(role) });
    const owner = async (id: number) => (await h.pool.query("SELECT assigned_to, authority_fence FROM tasks WHERE id=$1", [id])).rows[0];
    const edits = async (id: number) => Number((await h.pool.query("SELECT count(*) n FROM task_authority_events WHERE task_id=$1 AND event_type<>'created'", [id])).rows[0].n);
    const first = await unassignedTask("claim one");
    const won = await h.request("manager", "PUT", `/api/tasks/${first}`, claimBody("manager"));
    check(won.status === 200, `a manager claims one unassigned task with its current version (${won.status})`);
    check((await owner(first)).assigned_to === h.email("manager"), "the claimed task is assigned to the claiming manager only");
    const lost = await h.request("admin", "PUT", `/api/tasks/${first}`, claimBody("admin"));
    check(lost.status === 409, `a second claim made from the same stale version is refused (${lost.status})`);
    check((await owner(first)).assigned_to === h.email("manager") && await edits(first) === 1, "the refused claim changed nothing and wrote no second event");
    const race = await unassignedTask("claim race");
    const [a, b] = await Promise.all([
      h.request("manager", "PUT", `/api/tasks/${race}`, claimBody("manager")),
      h.request("admin", "PUT", `/api/tasks/${race}`, claimBody("admin")),
    ]);
    check([a.status, b.status].sort().join(",") === "200,409", `two simultaneous claims of one task have exactly one winner (${a.status}, ${b.status})`);
    check(await edits(race) === 1, "the simultaneous claim wrote exactly one event");
    const agentTask = await unassignedTask("claim by agent");
    const agentClaim = await h.request("agent", "PUT", `/api/tasks/${agentTask}`, claimBody("agent"));
    check(agentClaim.status >= 400 && (await owner(agentTask)).assigned_to === null, `an agent cannot claim unassigned work through the same command (${agentClaim.status})`);
    for (const role of ["merchant", "affiliate", "partner"]) {
      const refused = await h.request(role, "PUT", `/api/tasks/${agentTask}`, claimBody(role));
      check(refused.status === 401 || refused.status === 403, `${role} cannot claim work (${refused.status})`);
    }
    const bulkTask = await unassignedTask("claim bulk");
    const bulk = await h.request("agent", "POST", "/api/tasks/bulk-assign", { items: [{ id: bulkTask, expectedFence: 0 }], assignedTo: h.email("agent"), commandId: randomUUID() });
    check(bulk.status >= 400 && (await owner(bulkTask)).assigned_to === null, `an agent cannot assign work in bulk (${bulk.status})`);
  });

  clearInterval(lockWatch);
  results.push({ label: "advisory-lock observation (statements waiting on or holding advisory locks during the run; peak concurrent backends)",
    waiting: [...lockWaiting].map(([q, n]) => ({ n, q })), holding: [...lockHolding].map(([q, n]) => ({ n, q })), settledBetweenScenarios: settleLog });
  assert.deepEqual(failures, [], `Phase 6 browser failures:\n${failures.join("\n")}`);
  await writeFile(`${dir}/phase6-browser-results.json`, JSON.stringify({ checks, results, timingsMsFixtureScale: timings }, null, 2) + "\n");
  console.log(`PHASE6_BROWSER_PASS (${checks.length} named checks, ${results.length} audited states)`);
} catch (error) {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/phase6-browser-failure.json`, JSON.stringify({ error: String((error as Error)?.stack ?? error).slice(0, 4000), failures, checks, results }, null, 2) + "\n");
  throw error;
} finally {
  clearInterval(lockWatch);
  await watcher.end().catch(() => undefined);
  for (const b of browsers) { try { await b.close(); } catch { /* already closed */ } }
  await h.close();
}
process.exit(0);
