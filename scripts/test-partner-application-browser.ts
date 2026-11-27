import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";
import { buildLocalRehearsalEnvironment } from "./local-rehearsal-core";

/**
 * Partner program public journey in a real browser, against the REAL partner handlers and the compiled client.
 *
 *  - every hub call-to-action is clicked with a real pointer and lands on the right path;
 *  - ref/UTM values survive hub -> journey -> application navigation and are stored on the application;
 *  - the referral application is filled with real pointer and keyboard input, submitted, and the sales-agent application
 *    is completed with the keyboard alone (Tab, typing, Space, Enter), including visible focus;
 *  - an empty submit shows the error summary, moves focus to it and marks the fields invalid;
 *  - 200% browser zoom and reduced motion: no horizontal overflow, reachable controls, content visible, no running motion;
 *  - analytics: nothing is sent without consent; with consent only the allowlisted funnel events and properties are
 *    sent, none of them carrying a name, email, phone, company or referral code;
 *  - an administrator signed in through the real login page sees the pending applications in the CRM review panel,
 *    sees "terms pending", is refused an accept with no terms, and can decline with a note.
 *
 * Nothing is sent to a provider: external hosts (including the analytics script) are blocked by the private browser.
 * Chromium only. This is not a Safari/WebKit, real-phone or screen-reader run.
 */
const identity = await verifyCandidateIdentity();
const directory = "generated-artifacts/partner-application-browser";
const fixtureMeasurementId = "G-FIXTURE123";
const checks: string[] = [];
const ok = (message: string) => { checks.push(message); console.log(`✓ [PAB-${String(checks.length).padStart(2, "0")}] ${message}`); };

const fixtureBuild = await mkdtemp(path.join(tmpdir(), "liberty-partner-browser-"));
async function startFixture() {
  try {
    // Vite inlines the destinations. Compile a separate client so the loopback test
    // can exercise real consent logic while the verified release artifact stays intact.
    execFileSync(process.execPath, [
      "--require", "./scripts/certification-provider-deny-preload.cjs",
      "node_modules/vite/bin/vite.js", "build", "--outDir", fixtureBuild, "--logLevel", "warn",
    ], {
      env: {
        ...buildLocalRehearsalEnvironment(),
        NODE_ENV: "production",
        CERTIFICATION_COMPILER_ONLY: "1",
        VITE_GA4_MEASUREMENT_ID: fixtureMeasurementId,
        VITE_GOOGLE_TAG_ID: fixtureMeasurementId,
        VITE_GOOGLE_ADS_LEAD_CONVERSION: "",
        VITE_FB_PIXEL_ID: "",
      },
      stdio: "inherit",
    });
    return await stage3BHttpFixture(async app => {
      const { registerPartnersRoutes } = await import("../server/routes/partners.ts");
      const { registerPartnerProgramRoutes } = await import("../server/routes/partner-program.ts");
      registerPartnersRoutes(app); registerPartnerProgramRoutes(app);
      app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
      const { static: serveStatic } = await import("express");
      app.use(serveStatic(fixtureBuild));
      app.use((_req, res) => res.sendFile("index.html", { root: fixtureBuild }));
    });
  } catch (error) {
    await rm(fixtureBuild, { recursive: true, force: true });
    throw error;
  }
}
const h = await startFixture();

type Browser = Awaited<ReturnType<typeof privateStage3Browser>>;
const browsers: Browser[] = [];
const open = async (options: { zoom?: number } = {}) => {
  const browser = await privateStage3Browser(h.base, "", h.originalFetch, directory, { realInput: true, ...options });
  browsers.push(browser);
  return browser;
};
const until = async (browser: Browser, expression: string, label = expression) => {
  for (let n = 0; n < 300; n++) { if (await browser.evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`UI condition not reached: ${label}`);
};
const key = (browser: Browser, name: "Tab" | "Enter" | "Space" | "ArrowDown", extra: { shift?: boolean } = {}) => {
  const table = {
    Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
    Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  }[name];
  const modifiers = extra.shift ? 8 : 0;
  const nativeCodes = {Tab: 48, Enter: 36, Space: 49, ArrowDown: 125};
  const native = process.platform === "darwin" ? {nativeVirtualKeyCode: nativeCodes[name]} : {};
  return (async () => {
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers, ...native, ...table });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers, ...native, ...table });
  })();
};
const active = (browser: Browser) => browser.evaluate(`(()=>{const e=document.activeElement;if(!e)return null;
  const cs=getComputedStyle(e);
  return {id:e.id,tag:e.tagName,type:e.type||null,testid:e.getAttribute('data-testid'),role:e.getAttribute('role'),
    href:e.getAttribute('href'),inHero:!!e.closest('[data-testid="section-partner-hub-hero"]'),focusVisible:e.matches(':focus-visible'),
    ring:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0||cs.boxShadow!=='none'}})()`) as Promise<any>;
type AnalyticsCommand = [string, string, Record<string, unknown>];
const analyticsQueue = (browser: Browser) => browser.evaluate(`(window.dataLayer||[]).map(a=>Array.from(a))`) as Promise<AnalyticsCommand[]>;
const setConsent = (browser: Browser, analytics: boolean) => browser.evaluate(`(()=>{
  localStorage.setItem('lb_cookie_consent', ${analytics ? "'custom'" : "'essential'"});
  localStorage.setItem('lb_cookie_prefs', JSON.stringify({necessary:true,analytics:${analytics},marketing:false,functional:false}));
  localStorage.setItem('prefer_desktop','true');return true})()`);
/** Click an inline link that may wrap over several lines: aim at the middle of its first line box, as a person would. */
const clickInline = async (browser: Browser, selector: string) => {
  const point = await browser.evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const r=e.getClientRects()[0];if(!r)return null;const x=r.x+Math.min(r.width/2,40),y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    return hit&&(hit===e||e.contains(hit))?{x,y}:{blocked:hit?hit.tagName+':'+(hit.getAttribute('data-testid')||''):'none'}})()`) as { x: number; y: number; blocked?: string } | null;
  assert.ok(point && point.blocked === undefined, `${selector}: first line of the link is reachable by pointer (${JSON.stringify(point)})`);
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point!.x, y: point!.y });
  await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point!.x, y: point!.y });
  await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point!.x, y: point!.y });
};
const pathAndSearch = (browser: Browser) => browser.evaluate(`location.pathname+location.search`) as Promise<string>;
const layout = (browser: Browser) => browser.evaluate(`({h1:document.querySelectorAll('h1').length,main:document.querySelectorAll('main').length,
  overflow:document.documentElement.scrollWidth>window.innerWidth+1,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth})`) as Promise<any>;
const unreadable = (browser: Browser, prefix: string) => browser.evaluate(`(()=>{const form=document.querySelector('[data-testid="${prefix}-form"]');if(!form)return ['no form'];
  const problems=[];
  for(const e of form.querySelectorAll('input,select,textarea,button[role="checkbox"]')){
    if(e.type==='hidden'||e.getAttribute('aria-hidden')==='true')continue; // the checkbox widget's own hidden form mirror is not a control
    const named=(e.id&&document.querySelector('label[for="'+e.id+'"]'))||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby');
    if(!named)problems.push('unlabelled:'+(e.id||e.name||e.tagName));
  }
  return problems})()`) as Promise<string[]>;

const tag = h.prefix.slice(-12).toLowerCase();
const mail = (label: string) => `${tag}-${label}@example.test`;
const PII = {
  referral: { name: "Rhea Marquette", email: mail("ref"), phone: "305-555-0142", company: "Marquette Tax Group", network: "Small business clients and restaurants" },
  agent: { name: "Kendall Oyelaran", email: mail("agent"), phone: "786-555-0178", company: "Oyelaran Payments", region: "Florida" },
  zoom: { name: "Zephyr Ashgrove", email: mail("zoom"), phone: "954-555-0166", company: "Ashgrove Advisory" },
};
const CAMPAIGN_QUERY = "utm_source=newsletter&utm_medium=email&utm_campaign=fall";
const ATTRIBUTION = `ref=pab9f2c&${CAMPAIGN_QUERY}`;
const ALLOWED_EVENTS = ["partner_path_selected", "partner_application_started", "partner_application_submitted", "partner_calculator_used"];
const ALLOWED_PROPS = ["event_category", "path", "profession", "source_page", "calculator_path"];
const applicationFor = async (email: string) => (await h.pool.query(
  `SELECT a.path, a.profession, a.review_status, a.source_page, a.acquisition, a.answers, a.marketing_opt_in, p.status partner_status,
          p.password_hash, p.commission_percent, p.affiliate_code, (SELECT count(*)::int FROM users u WHERE lower(u.email)=a.mailbox) users
     FROM partner_applications a JOIN partners p ON p.id=a.partner_id WHERE a.mailbox=$1`, [email])).rows;

try {
  await mkdir(directory, { recursive: true });
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  const browser = await open();

  // ── 1. No analytics consent: the tag stays unconfigured and no event is queued ──────────────────────────────────────
  await browser.navigate("/partners");
  await setConsent(browser, false);
  await browser.navigate(`/partners?${ATTRIBUTION}`);
  await until(browser, `!!document.querySelector('[data-testid="section-partner-hub-hero"]')`, "hub hero");
  const consentDefault = (await analyticsQueue(browser)).filter(([command, name]) => command === "consent" && name === "default");
  assert.deepEqual(consentDefault, [["consent", "default", {
    analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
  }]], "The analytics queue starts with every consent signal denied");
  await browser.click(`[data-testid="section-partner-hub-hero"] a[href^="/partners/referrals"]`);
  await until(browser, `location.pathname==='/partners/referrals'`, "referral journey");
  await until(browser, `!!document.getElementById('partner-referral-fullName')`, "referral form");
  await browser.click("#partner-referral-fullName");
  assert.ok(!(await analyticsQueue(browser)).some(([command]) => command === "config" || command === "event"),
    "Without analytics consent there is no tag configuration or event after the hub click and form focus");
  ok("Without analytics consent every signal starts denied and neither tag configuration nor events are queued");

  // ── 2. Every hub call-to-action, by real click, lands on its path and keeps ref/UTM values ──────────────────────────
  await setConsent(browser, true);
  const hubCtas: Array<[string, string, string]> = [
    ["hero: referral", `[data-testid="section-partner-hub-hero"] a[href^="/partners/referrals"]`, "/partners/referrals"],
    ["hero: sales agent", `[data-testid="section-partner-hub-hero"] a[href^="/partners/sales-agents"]`, "/partners/sales-agents"],
    ["path card: referral", `[data-testid="partner-card-referral"] a[href^="/partners/referrals"]`, "/partners/referrals"],
    ["path card: sales agent", `[data-testid="partner-card-sales_agent"] a[href^="/partners/sales-agents"]`, "/partners/sales-agents"],
    ["final: referral", `[data-testid="partner-final-cta-referral"]`, "/partners/referrals"],
    ["final: sales agent", `[data-testid="partner-final-cta-agent"]`, "/partners/sales-agents"],
  ];
  for (const [label, selector, expected] of hubCtas) {
    await browser.navigate(`/partners?${ATTRIBUTION}`);
    await until(browser, `!!document.querySelector(${JSON.stringify(selector)})`, `hub CTA ${label}`);
    await browser.click(selector);
    await until(browser, `location.pathname===${JSON.stringify(expected)}`, `${label} lands on ${expected}`);
    const landed = await pathAndSearch(browser);
    for (const pair of ATTRIBUTION.split("&")) assert.ok(landed.includes(pair), `${label}: ${pair.split("=")[0]} survives the hub click (landed on ${landed})`);
    await until(browser, `!!document.querySelector('main h1')`, `${label}: landing page rendered`);
    const shape = await layout(browser);
    assert.ok(shape.h1 === 1 && shape.main === 1, `${label}: the landing page has one h1 and one main (${JSON.stringify(shape)})`);
  }
  ok("All six hub calls-to-action land on the right path with exactly one h1 and main, and keep ref and UTM values");

  // The journey pages keep the values when moving to the other path or back to the hub.
  for (const [from, selector, expected] of [
    ["/partners/referrals", `[data-testid="partner-journey-other-path-inline"]`, "/partners/sales-agents"],
    ["/partners/sales-agents", `[data-testid="partner-journey-other-path-inline"]`, "/partners/referrals"],
  ] as const) {
    await browser.navigate(`${from}?${ATTRIBUTION}`);
    await until(browser, `!!document.querySelector(${JSON.stringify(selector)})`, "other-path link");
    await clickInline(browser, selector);
    await until(browser, `location.pathname===${JSON.stringify(expected)}`, `other path from ${from}`);
    const landed = await pathAndSearch(browser);
    for (const pair of ATTRIBUTION.split("&")) assert.ok(landed.includes(pair), `Switching path from ${from} keeps ${pair.split("=")[0]} (landed on ${landed})`);
  }
  ok("Switching between the two journey pages keeps ref and UTM values");

  // ── 3. Referral application: real pointer and typing; empty submit first ────────────────────────────────────────────
  await browser.navigate(`/partners?${ATTRIBUTION}`);
  await until(browser, `!!document.querySelector('[data-testid="partner-final-cta-referral"]')`);
  await browser.click(`[data-testid="section-partner-hub-hero"] a[href^="/partners/referrals"]`);
  await until(browser, `!!document.getElementById('partner-referral-fullName')`, "referral form");
  const referralLayout = await layout(browser);
  assert.ok(!referralLayout.overflow, `The referral page has no horizontal overflow (${referralLayout.scrollWidth} > ${referralLayout.innerWidth})`);
  assert.deepEqual(await unreadable(browser, "partner-referral"), [], "Every referral form control has an accessible label");
  await browser.click(`[data-testid="partner-referral-submit"]`);
  await until(browser, `!!document.querySelector('[data-testid="partner-referral-error-summary"]')`, "error summary");
  const summaryFocus = await active(browser);
  assert.equal(summaryFocus.testid, "partner-referral-error-summary", `An empty submit moves focus to the error summary (focus is on ${summaryFocus.testid ?? summaryFocus.tag})`);
  const invalid = await browser.evaluate(`[...document.querySelectorAll('[data-testid="partner-referral-form"] [aria-invalid="true"]')].map(e=>e.id)`) as string[];
  for (const id of ["partner-referral-fullName", "partner-referral-email", "partner-referral-profession", "partner-referral-referralNetwork"])
    assert.ok(invalid.includes(id), `${id} is marked aria-invalid after an empty submit (${invalid.join(",")})`);
  const described = await browser.evaluate(`(()=>{const e=document.getElementById('partner-referral-email');const d=e.getAttribute('aria-describedby');return !!d&&!!document.getElementById(d.split(' ')[0])})()`);
  assert.ok(described, "An invalid field points at its error message");
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="partner-referral-success"]')`), false, "An empty submit saves nothing");
  assert.equal((await h.pool.query(`SELECT count(*)::int n FROM partner_applications WHERE mailbox LIKE $1`, [`${tag}-%`])).rows[0].n, 0, "No application row exists after the empty submit");
  await browser.screenshot("referral-errors");
  ok("An empty referral submit shows the error summary, moves focus to it, marks fields invalid and saves nothing");

  const selectByKeyboard = async (browserRef: Browser, id: string, value: string) => {
    const label = await browserRef.evaluate(`(()=>{const s=document.getElementById(${JSON.stringify(id)});s.focus();return [...s.options].find(o=>o.value===${JSON.stringify(value)})?.textContent})()`) as string;
    assert.ok(label, `option ${value} exists in ${id}`);
    // Native select popups are OS-owned on macOS. Type-ahead selects the
    // actual option without opening that popup or assigning a DOM value.
    await browserRef.call("Page.bringToFront");
    await browserRef.call("Emulation.setFocusEmulationEnabled", {enabled:true});
    const macCodes: Record<string,number> = {a:0,s:1,d:2,f:3,h:4,g:5,z:6,x:7,c:8,v:9,b:11,q:12,w:13,e:14,r:15,y:16,t:17,o:31,u:32,i:34,p:35,l:37,j:38,k:40,n:45,m:46};
    for (const letter of label.trim().toLowerCase().slice(0,3)) {
      const event = {key:letter,code:`Key${letter.toUpperCase()}`,text:letter,unmodifiedText:letter,
        windowsVirtualKeyCode:letter.toUpperCase().charCodeAt(0),
        ...(process.platform === "darwin" ? {nativeVirtualKeyCode:macCodes[letter] ?? 0} : {})};
      await browserRef.call("Input.dispatchKeyEvent", {type:"keyDown",...event});
      await browserRef.call("Input.dispatchKeyEvent", {type:"keyUp",...event});
    }

    assert.equal(await browserRef.evaluate(`document.getElementById(${JSON.stringify(id)}).value`), value, `${id} selected ${value}`);
  };
  await browser.set("#partner-referral-fullName", PII.referral.name);
  await browser.set("#partner-referral-email", PII.referral.email);
  await browser.set("#partner-referral-phone", PII.referral.phone);
  await browser.set("#partner-referral-company", PII.referral.company);
  await selectByKeyboard(browser, "partner-referral-profession", "cpa");
  await browser.set("#partner-referral-referralNetwork", PII.referral.network);
  await browser.click(`[data-testid="partner-referral-checkbox-contact-permission"]`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid="partner-referral-checkbox-contact-permission"]').getAttribute('aria-checked')`), "true", "Contact permission is checked by a click");
  assert.notEqual(await browser.evaluate(`document.getElementById('partner-referral-marketing')?.getAttribute('aria-checked') ?? 'absent'`), "true", "Marketing email permission stays unchecked");
  await browser.click(`[data-testid="partner-referral-submit"]`);
  await until(browser, `!!document.querySelector('[data-testid="partner-referral-success"]')`, "referral success");
  const successFocus = await active(browser);
  assert.equal(successFocus.testid, "partner-referral-success-heading", "After a save, focus moves to the confirmation heading");
  const successText = await browser.evaluate(`document.querySelector('[data-testid="partner-referral-success"]').innerText`) as string;
  assert.ok(/Reference/.test(successText), "The confirmation shows a reference");
  assert.ok(!/approved|accepted|active account|commission|percent|%/i.test(successText), `The confirmation does not claim approval, an account or compensation (${successText.replace(/\s+/g, " ")})`);
  await browser.screenshot("referral-success");
  const referralRows = await applicationFor(PII.referral.email);
  assert.equal(referralRows.length, 1, "Exactly one application is stored");
  const r = referralRows[0];
  assert.deepEqual([r.path, r.profession, r.review_status, r.partner_status, r.password_hash, r.commission_percent, r.users, r.marketing_opt_in], ["referral", "cpa", "pending_review", "pending", null, null, 0, false],
    "The stored application is a pending referral with no password, no commission, no login and no marketing permission");
  assert.deepEqual(r.acquisition, { ref: "pab9f2c", utm_source: "newsletter", utm_medium: "email", utm_campaign: "fall" }, `Attribution carried from the hub is stored (${JSON.stringify(r.acquisition)})`);
  assert.equal(r.source_page, "/partners/referrals", "The source page is the referral journey");
  ok("The referral application is completed by real pointer and typing and stored pending, with ref/UTM attribution from the hub");

  // ── 4. Analytics with consent: only allowlisted events and properties, no personal or commercial values ──────────────
  const queue = await analyticsQueue(browser);
  assert.deepEqual(queue.filter(([command]) => command === "config").map(([, id]) => id), [fixtureMeasurementId],
    "Consent configures only the fixture measurement ID");
  const events = queue.filter(([command]) => command === "event");
  assert.ok(events.some(([, name]) => name === "page_view"), "The consented route queues a page view");
  const partnerEvents = events.filter(([, name]) => name !== "page_view");
  const names = partnerEvents.map(([, name]) => name);
  for (const name of ["partner_path_selected", "partner_application_started", "partner_application_submitted"]) {
    assert.equal(names.filter(event => event === name).length, 1, `${name} is queued once (${names.join(",")})`);
  }
  for (const [, name, props] of partnerEvents) {
    assert.ok(ALLOWED_EVENTS.includes(name), `${name} is an allowlisted event`);
    const { send_to, page_path, page_title, page_location, ...partnerProps } = props;
    assert.equal(send_to, fixtureMeasurementId, `${name} routes only to the fixture measurement ID`);
    assert.ok(page_path === "/partners" || page_path === "/partners/referrals", `${name} has a public partner path`);
    assert.equal(page_title, SEO_ROUTE_DEFAULTS[page_path].title, `${name} uses the canonical page title`);
    assert.equal(page_location, `${h.base}${page_path}?${CAMPAIGN_QUERY}`, `${name} includes only allowlisted campaign parameters in its URL`);
    for (const [prop, value] of Object.entries(partnerProps)) {
      assert.ok(ALLOWED_PROPS.includes(prop), `${name} carries only allowlisted properties (${prop})`);
      assert.ok(typeof value === "string" && /^[a-z0-9_/\-]{1,60}$/.test(value), `${name}.${prop} is a short slug (${String(value)})`);
    }
  }
  const submitted = partnerEvents.find(([, name]) => name === "partner_application_submitted")![2];
  assert.deepEqual(submitted, {
    event_category: "partner_program", path: "referral", profession: "cpa", source_page: "/partners/referrals",
    send_to: fixtureMeasurementId, page_path: "/partners/referrals", page_title: SEO_ROUTE_DEFAULTS["/partners/referrals"].title,
    page_location: `${h.base}/partners/referrals?${CAMPAIGN_QUERY}`,
  }, "The submitted event carries only the expected partner and public page fields");
  const serialized = JSON.stringify(queue);
  for (const secret of [PII.referral.name, PII.referral.email, PII.referral.phone, PII.referral.company, "Marquette", "pab9f2c", "5550142", PII.referral.network]) {
    assert.ok(!serialized.includes(secret), `No analytics event contains ${secret.length > 12 ? "a form value" : secret}`);
  }
  ok("With analytics consent the fixture queues allowlisted partner events and a page view, with no applicant data or referral code in the queue");

  // ── 5. Sales-agent application with the keyboard alone ──────────────────────────────────────────────────────────────
  await browser.navigate(`/partners?utm_source=keyboard`);
  await until(browser, `!!document.querySelector('[data-testid="section-partner-hub-hero"]')`);
  const visited: string[] = [];
  const tabTo = async (predicate: (a: any) => boolean, label: string, limit = 400) => {
    let previous = "", repeats = 0;
    for (let step = 0; step < limit; step++) {
      await key(browser, "Tab");
      const a = await active(browser);
      const stop = `${a.tag}#${a.id}|${a.testid}|${a.href}`;
      repeats = stop === previous ? repeats + 1 : 0;
      assert.ok(repeats < 3, `Keyboard trap: focus stayed on ${stop}`);
      previous = stop;
      visited.push(a.id || a.testid || a.tag);
      if (predicate(a)) return a;
    }
    throw new Error(`Keyboard focus never reached ${label} within ${limit} Tab presses`);
  };
  const heroAgent = await tabTo(a => a.tag === "A" && a.inHero && (a.href ?? "").startsWith("/partners/sales-agents"), "the hero sales-agent link");
  assert.ok(heroAgent.focusVisible && heroAgent.ring, "The hero sales-agent link shows a visible focus indicator");
  await key(browser, "Enter");
  await until(browser, `location.pathname==='/partners/sales-agents'`, "keyboard navigation to the sales-agent journey");
  assert.ok((await pathAndSearch(browser)).includes("utm_source=keyboard"), "Keyboard navigation from the hub keeps the UTM value");
  await until(browser, `!!document.getElementById('partner-agent-fullName')`, "agent form");
  await tabTo(a => a.id === "partner-agent-fullName", "the first form field");
  assert.ok((await active(browser)).focusVisible && (await active(browser)).ring, "The first form field shows a visible focus indicator");
  const typeIt = async (text: string) => { await browser.call("Input.insertText", { text }); };
  const fillStep = async (expectedId: string, text: string | null) => {
    const a = await tabTo(x => x.id === expectedId || x.testid === expectedId, expectedId, 12);
    if (text !== null) await typeIt(text);
    return a;
  };
  await typeIt(PII.agent.name);
  await fillStep("partner-agent-email", PII.agent.email);
  await fillStep("partner-agent-phone", PII.agent.phone);
  await fillStep("partner-agent-company", PII.agent.company);
  await fillStep("partner-agent-region", PII.agent.region);
  await fillStep("partner-agent-experience", "Five years selling merchant services to restaurants and retailers.");
  await fillStep("partner-agent-prospectingApproach", "Warm introductions from existing accounting clients and local business groups.");
  const interestOptions = (await browser.evaluate(`[...document.getElementById('partner-agent-leadSourceInterest').options].map(o=>o.value)`)) as string[];
  await fillStep("partner-agent-leadSourceInterest", null);
  await selectByKeyboard(browser, "partner-agent-leadSourceInterest", interestOptions[1]);
  assert.equal(await browser.evaluate(`document.getElementById('partner-agent-leadSourceInterest').value`), interestOptions[1], "A native select is changed with the keyboard");
  await tabTo(a => a.testid === "partner-agent-checkbox-contact-permission", "the contact-permission checkbox");
  await key(browser, "Space");
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid="partner-agent-checkbox-contact-permission"]').getAttribute('aria-checked')`), "true", "Space checks the contact-permission box");
  const submitButton = await tabTo(a => a.testid === "partner-agent-submit", "the submit button");
  assert.ok(submitButton.focusVisible && submitButton.ring, "The submit button shows a visible focus indicator");
  await key(browser, "Enter");
  await until(browser, `!!document.querySelector('[data-testid="partner-agent-success"]')`, "agent success");
  assert.equal((await active(browser)).testid, "partner-agent-success-heading", "After a keyboard submit, focus moves to the confirmation heading");
  assert.ok(visited.length < 400, "The whole journey needed no pointer");
  const agentRows = await applicationFor(PII.agent.email);
  assert.equal(agentRows.length, 1, "Exactly one sales-agent application is stored");
  const a = agentRows[0];
  assert.deepEqual([a.path, a.profession, a.review_status, a.partner_status, a.password_hash, a.commission_percent, a.users], ["sales_agent", null, "pending_review", "pending", null, null, 0], "The stored sales-agent application is pending with no password, commission or login");
  assert.deepEqual(a.acquisition, { utm_source: "keyboard" }, "Keyboard-journey attribution is stored");
  await browser.screenshot("agent-success");
  ok(`The sales-agent application is completed with the keyboard alone (${visited.length} Tab stops, visible focus, Space and Enter, no trap) and stored pending`);
  const afterAgentEvents = (await analyticsQueue(browser)).filter(([command, name]) => command === "event" && name === "partner_application_submitted");
  assert.equal(afterAgentEvents.length, 1, "The sales-agent submission queues one event");
  assert.equal(afterAgentEvents[0][2].path, "sales_agent", "The sales-agent submit event carries the path");
  assert.ok(!("profession" in afterAgentEvents[0][2]), "The sales-agent submit event has no referral profession");

  // ── 6. Reduced motion ───────────────────────────────────────────────────────────────────────────────────────────────
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const route of ["/partners", "/partners/referrals", "/partners/sales-agents"]) {
    await browser.navigate(route);
    await until(browser, `!!document.querySelector('main h1')`, `${route} rendered`);
    await new Promise(r => setTimeout(r, 600));
    const motion = await browser.evaluate(`(()=>{
      const hidden=[...document.querySelectorAll('main .reveal')].filter(e=>getComputedStyle(e).opacity!=='1').length;
      const moving=document.querySelector('main').getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect&&a.effect.getTiming().iterations===Infinity).length;
      return {reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,hidden,moving}})()`) as any;
    assert.ok(motion.reduce, "The browser reports reduced motion");
    assert.equal(motion.hidden, 0, `${route}: no content is left hidden by a reveal animation (${motion.hidden})`);
    assert.equal(motion.moving, 0, `${route}: no infinite animation runs under reduced motion (${motion.moving})`);
  }
  await browser.call("Emulation.setEmulatedMedia", { features: [] });
  ok("With reduced motion requested, no partner page leaves content hidden or runs an endless animation");

  // ── 7. 200% zoom ────────────────────────────────────────────────────────────────────────────────────────────────────
  const zoomed = await open({ zoom: 2 });
  await zoomed.navigate("/partners");
  await setConsent(zoomed, false);
  // First touch: this session arrives on the hub with a campaign link, then reaches the journey by a full page load with
  // NO query string. The allowlisted values must come from the session's first touch, and nothing else may be stored.
  await zoomed.navigate("/partners?ref=zmfirst1&utm_source=zoomtouch&token=must-not-be-kept&utm_extra=nope");
  await until(zoomed, `!!document.querySelector('[data-testid="section-partner-hub-hero"]')`, "zoom hub");
  assert.deepEqual(JSON.parse(await zoomed.evaluate(`sessionStorage.getItem('lb_partner_first_touch')||'null'`) as string), { ref: "zmfirst1", utm_source: "zoomtouch" }, "The session keeps only the allowlisted first-touch values");
  await zoomed.navigate("/partners/referrals");
  await until(zoomed, `!!document.getElementById('partner-referral-fullName')`, "zoomed referral form");
  const zoomShape = await zoomed.evaluate(`({ratio:window.devicePixelRatio,width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth})`) as any;
  assert.ok(zoomShape.width <= 760, `The browser really is zoomed (CSS viewport ${zoomShape.width}px)`);
  assert.ok(zoomShape.scrollWidth <= zoomShape.width + 1, `No horizontal scrolling at 200% (${zoomShape.scrollWidth} > ${zoomShape.width})`);
  await zoomed.click(`[data-testid="partner-referral-submit"]`);
  await until(zoomed, `!!document.querySelector('[data-testid="partner-referral-error-summary"]')`, "zoomed error summary");
  assert.equal((await active(zoomed)).testid, "partner-referral-error-summary", "At 200% an empty submit still moves focus to the error summary");
  const unclipped = await zoomed.evaluate(`(()=>{const out=[];for(const id of ['partner-referral-fullName','partner-referral-email','partner-referral-referralNetwork']){
    const r=document.getElementById(id).getBoundingClientRect();if(r.left<0||r.right>window.innerWidth+1)out.push(id)}
    const b=document.querySelector('[data-testid="partner-referral-submit"]').getBoundingClientRect();if(b.right>window.innerWidth+1||b.width<44||b.height<44)out.push('submit');return out})()`) as string[];
  assert.deepEqual(unclipped, [], "At 200% fields stay inside the viewport and the submit button stays at least 44px");
  await zoomed.set("#partner-referral-fullName", PII.zoom.name);
  await zoomed.set("#partner-referral-email", PII.zoom.email);
  await zoomed.set("#partner-referral-phone", PII.zoom.phone);
  await zoomed.set("#partner-referral-company", PII.zoom.company);
  await selectByKeyboard(zoomed, "partner-referral-profession", "bookkeeper");
  await zoomed.set("#partner-referral-referralNetwork", "Clients who reconcile card statements each month");
  await zoomed.click(`[data-testid="partner-referral-checkbox-contact-permission"]`);
  await zoomed.click(`[data-testid="partner-referral-submit"]`);
  await until(zoomed, `!!document.querySelector('[data-testid="partner-referral-success"]')`, "zoomed success");
  await zoomed.screenshot("zoom-success");
  const zoomRows = await applicationFor(PII.zoom.email);
  assert.equal(zoomRows.length, 1, "The 200% application is stored once");
  assert.deepEqual(zoomRows[0].acquisition, { ref: "zmfirst1", utm_source: "zoomtouch" }, `An application submitted from a page with no query string stores the session's first touch, and nothing outside the allowlist (${JSON.stringify(zoomRows[0].acquisition)})`);
  ok("At 200% zoom the page has no horizontal scrolling, errors and controls stay usable, and an application can be submitted; with no query string it stores the session's first touch (allowlisted keys only)");

  // ── 8. The same applications in the CRM review panel, signed in through the real login page ─────────────────────────
  await browser.navigate("/login"); await browser.waitFor(/Sign In/);
  await browser.set('[data-testid="input-email"]', h.email("admin")); await browser.set('[data-testid="input-password"]', h.password);
  await browser.click('[data-testid="button-login"]'); await browser.waitFor(/Dashboard|Today|My Day/);
  await browser.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')");
  await browser.navigate("/dashboard/referral-program?tab=applications");
  await until(browser, `!!document.querySelector('[data-testid="partner-applications-panel"]')`, "review panel");
  await until(browser, `document.body.innerText.includes(${JSON.stringify(PII.referral.name)})`, "referral applicant listed");
  const panelText = await browser.evaluate(`document.querySelector('[data-testid="partner-applications-panel"]').innerText`) as string;
  for (const name of [PII.referral.name, PII.agent.name, PII.zoom.name]) assert.ok(panelText.includes(name), `The review panel lists ${name}`);
  const tableText = await browser.evaluate(`document.querySelector('[data-testid="applications-table-desktop"]')?.innerText ?? ''`) as string;
  assert.ok(/Pending review/.test(tableText) && /Referral partner/.test(tableText) && /Sales agent/.test(tableText), `The table rows show the pending review status and both paths (${tableText.replace(/\s+/g, " ").slice(0, 200)})`);
  assert.ok(/Pending/.test(tableText) && !/Recorded/.test(tableText), "Every row shows its terms as pending, none as recorded");
  assert.ok(!/password|hash|\$2[aby]\$/i.test(panelText), "The review panel shows no credential material");
  await browser.screenshot("crm-panel");
  const referralId = (await h.pool.query(`SELECT a.id FROM partner_applications a WHERE a.mailbox=$1`, [PII.referral.email])).rows[0].id as string;
  await browser.click(`[data-testid="button-open-application-${referralId}"]`);
  await until(browser, `!!document.querySelector('[data-testid="application-detail"]')`, "application detail");
  const detail = await browser.evaluate(`document.querySelector('[data-testid="application-detail"]').innerText`) as string;
  assert.ok(/Terms pending: none recorded/.test(await browser.evaluate(`document.querySelector('[data-testid="application-terms-state"]').innerText`) as string), "The detail shows terms as pending, not a number");
  assert.ok(detail.includes(PII.referral.email) && /Marquette Tax Group/.test(detail), "The detail shows the applicant's contact and company to the reviewer");
  assert.ok(!/\d\s*%/.test(detail), "The detail shows no commission or percentage figure for an application with no recorded terms");
  await browser.screenshot("crm-detail");
  // Accept with no terms is refused in the panel; nothing changes.
  await browser.click(`[data-testid="application-decision-accept"]`);
  await browser.click(`[data-testid="application-decision-submit"]`);
  await until(browser, `!!document.querySelector('[data-testid="application-decision-error"]')`, "terms-required message");
  assert.ok(/commission percentage/i.test(await browser.evaluate(`document.querySelector('[data-testid="application-decision-error"]').innerText`) as string), "Accepting with no terms is refused with the terms message");
  assert.equal((await applicationFor(PII.referral.email))[0].review_status, "pending_review", "The refused accept changed nothing");
  // Decline with a note.
  await browser.click(`[data-testid="application-decision-decline"]`);
  await browser.click(`[data-testid="application-decision-submit"]`);
  await until(browser, `/note is required/i.test(document.querySelector('[data-testid="application-decision-error"]')?.innerText||'')`, "note-required message");
  await browser.set('[data-testid="application-note-input"]', "Not a fit for the referral program right now.");
  await browser.click(`[data-testid="application-decision-submit"]`);
  await until(browser, `!!document.querySelector('[data-testid="application-decision-confirm"]')`, "confirm step");
  await browser.click(`[data-testid="application-decision-confirm"]`);
  await until(browser, `!!document.querySelector('[data-testid="application-decision-closed"]')`, "closed decision");
  assert.ok(/Declined/.test(await browser.evaluate(`document.querySelector('[data-testid="application-decision-closed"]').innerText`) as string), "The panel shows the application as declined");
  const decided = (await applicationFor(PII.referral.email))[0];
  assert.deepEqual([decided.review_status, decided.partner_status, decided.password_hash, decided.users], ["declined", "inactive", null, 0], "A decline leaves the partner inactive (not approved) with no password and creates no login");
  assert.equal((await applicationFor(PII.agent.email))[0].review_status, "pending_review", "The other applications stay pending");
  await browser.screenshot("crm-declined");
  ok("A signed-in administrator sees the three applications as pending with terms pending, is refused an accept without terms, and can decline with a note");

  const apiCalls = browser.requests.filter(r => r.url.startsWith("/api/partner-apply"));
  assert.ok(apiCalls.length === 2 && apiCalls.every(c => c.status === 201 && c.method === "POST"), `The anonymous browser made two application submissions, both 201 (${JSON.stringify(apiCalls)})`);
  assert.equal(zoomed.requests.filter(r => r.url.startsWith("/api/partner-apply") && r.status === 201).length, 1, "The zoomed browser made one 201 submission");
  assert.equal(browser.exceptions.length + zoomed.exceptions.length, 0, `No uncaught page exception (${[...browser.exceptions, ...zoomed.exceptions].join(" || ")})`);
  ok("Exactly three submissions were made (all 201) and no page raised an uncaught exception");

  await writeFile(`${directory}/receipt.json`, JSON.stringify({
    status: "passed", candidate: { sourceHead: identity.sourceHead, inputHash: identity.inputHash }, checks, notExercised: [],
    scope: "Chromium only; real handlers and a production-mode fixture client with a dummy measurement ID; external hosts blocked; not Safari/WebKit, a real phone or a screen reader",
  }, null, 2));
  console.log(`Partner application browser: ${checks.length} checks passed`);
} finally {
  try {
    for (const browser of browsers) await browser.close().catch(() => undefined);
    await h.close();
  } finally {
    await rm(fixtureBuild, { recursive: true, force: true });
  }
}
