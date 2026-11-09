import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { buildLocalRehearsalEnvironment } from "./local-rehearsal-core";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

/**
 * Public shell role-flow proof (W-B): the public header's two sign-in utilities reach the existing
 * authenticated entrances, real password sign-in from each lands where the role belongs, and the public
 * shell (markers, palette) stays on public pages and off the sign-in pages and portals.
 *
 * Disposable database and Redis, the compiled client, actual password sessions and CSRF, private empty-cookie
 * Chromium with real pointer input, and every non-loopback request denied. No production login, no provider
 * call, no form submission other than sign-in to this disposable fixture.
 */

await assertDisposableTestInfrastructure({ operation: "Public shell compiled browser role flows", requireRedis: true });
const buildEnv = buildLocalRehearsalEnvironment();
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "script/build.ts"], {
  env: { ...buildEnv, NODE_ENV: "production" },
  stdio: "pipe",
  timeout: 300000,
  maxBuffer: 12 * 1024 * 1024,
});

const h = await stage3BHttpFixture(async (app) => {
  const { registerPartnersRoutes } = await import("../server/routes/partners");
  registerPartnersRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered candidate fixture service" }));
  const { default: express } = await import("express");
  app.use(express.static(path.resolve("dist/public"), { index: false }));
  const { installC1CompiledSsrAssets } = await import("./fixtures/c1-compiled-ssr-assets");
  await installC1CompiledSsrAssets(app);
  const { registerGlossaryRoutes } = await import("../server/routes/glossary");
  registerGlossaryRoutes(app);
  const { registerSsrRoutes } = await import("../server/routes/ssr-routes");
  registerSsrRoutes(app);
  app.get(/.*/, (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
});
console.log(`Public shell private compiled candidate: ${h.base}; actual application sign-in only; no public proxy`);

const SHOTS = "generated-artifacts/public-shell-browser";
const receipts: Array<{ check: string; result: unknown }> = [];
const receipt = (check: string, result: unknown) => receipts.push({ check, result });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let browser: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;

const open = async (viewport?: { width: number; height: number; mobile?: boolean }) => {
  browser = await privateStage3Browser(h.base, "", h.originalFetch, SHOTS, { realInput: true, startupTimeoutMs: 30000 });
  const v = viewport ?? { width: 1440, height: 1000 };
  await browser.call("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.mobile ? 2 : 1, mobile: !!v.mobile });
  return browser;
};
const shut = async () => {
  await browser?.close();
  browser = undefined;
};
const until = async (expression: string, label: string, attempts = 150) => {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await browser!.evaluate(expression)) return;
    } catch {
      // Chromium discards the execution context while a full navigation replaces the document.
    }
    await sleep(100);
  }
  await browser!.screenshot("failure");
  assert.fail(`Timed out waiting for: ${label}`);
};
/** Waits until the document is quiet: fonts painted, the page heading mounted and the layout unchanged for a moment. */
const settle = async () => {
  await until("document.fonts.status==='loaded'&&!!document.querySelector('h1')", "fonts loaded and page heading mounted");
  await sleep(700);
};
/**
 * Real pointer click that retries when the control is replaced while the page finishes mounting (a lazy
 * route swapping in). Each attempt re-queries the control, so a click that lands is never repeated.
 */
const clickControl = async (selector: string) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await browser!.click(selector);
      return;
    } catch (error) {
      lastError = error;
      await sleep(600);
    }
  }
  throw lastError;
};
const markers = () =>
  browser!.evaluate("({body:document.body.classList.contains('marketing-theme'),html:document.documentElement.classList.contains('public-surface')})") as Promise<{ body: boolean; html: boolean }>;
const color = (expression: string) =>
  browser!.evaluate(`(()=>{const s=document.createElement('span');s.style.color=${JSON.stringify(expression)};document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c})()`) as Promise<string>;
const rgb = (css: string): [number, number, number] => {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(m, `not a colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const closeTo = (css: string, expected: [number, number, number], tolerance = 2) => rgb(css).every((v, i) => Math.abs(v - expected[i]) <= tolerance);
const PUBLIC_NAVY: [number, number, number] = [7, 29, 87];
const PUBLIC_RED: [number, number, number] = [200, 16, 46];
const CRM_PRIMARY: [number, number, number] = [15, 23, 42];

const assertPublicShell = async (label: string) => {
  await until("document.body.classList.contains('marketing-theme')", `${label}: public markers`);
  const m = await markers();
  assert.deepEqual(m, { body: true, html: true }, `${label}: public markers present`);
  assert.ok(closeTo(await color("hsl(var(--primary))"), PUBLIC_NAVY), `${label}: public navy primary`);
  assert.ok(closeTo(await color("hsl(var(--brand-red))"), PUBLIC_RED), `${label}: brand red`);
  assert.ok(closeTo(await color("hsl(var(--muted))"), [244, 246, 250]), `${label}: light surface`);
  await settle();
};
const assertNoPublicShell = async (label: string) => {
  assert.deepEqual(await markers(), { body: false, html: false }, `${label}: no public markers`);
  const primary = await color("hsl(var(--primary))");
  assert.ok(!closeTo(primary, PUBLIC_NAVY, 1), `${label}: public navy must not leak (${primary})`);
};
const signIn = async (emailSelector: string, passwordSelector: string, buttonSelector: string, email: string) => {
  await browser!.set(emailSelector, email);
  await browser!.set(passwordSelector, h.password);
  await clickControl(buttonSelector);
};

try {
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  // The real partner sign-in form authenticates against the partners table; seed one record for the fixture partner user.
  await h.pool.query(
    `INSERT INTO partners(company_name,contact_name,email,password_hash,status,affiliate_code,partner_type)
     VALUES('Public shell fixture partner','Fixture Partner',$1,$2,'active',$3,'referral')`,
    [h.email("partner").toLowerCase(), h.passwordHash, `${h.prefix}-aff`],
  );

  // ── Server-rendered header carries both utilities before any script runs ──────────────────────────
  for (const route of ["/", "/payment-processing", "/pricing-and-programs", "/about-contact", "/industries"]) {
    const response = await h.originalFetch(`${h.base}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${route} server response`);
    assert.ok(html.includes('href="/login">Account sign in</a>'), `${route} server header: Account sign in -> /login`);
    assert.ok(html.includes('href="/partner-login">Partner sign in</a>'), `${route} server header: Partner sign in -> /partner-login`);
    assert.ok(html.includes('href="/about-contact" class="ssr-cta-btn">Talk to Liberty</a>'), `${route} server header: Talk to Liberty`);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${route} one h1`);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, `${route} one main`);
    assert.ok(!/Call\s*\/\s*Text/i.test(html), `${route} no Call/Text label`);
  }
  receipt("server-header-utilities", { routes: 5, accountSignIn: "/login", partnerSignIn: "/partner-login" });

  // Static glossary pages (no client bundle) carry the same shell: one main, one h1, both utilities and their own faces.
  for (const route of ["/learn", "/learn/interchange-plus-pricing"]) {
    const response = await h.originalFetch(`${h.base}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${route} server response`);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${route} one h1`);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, `${route} one main`);
    assert.ok(html.includes('href="/login">Account sign in</a>') && html.includes('href="/partner-login">Partner sign in</a>'), `${route} static header utilities`);
    assert.ok(html.includes("data-ssr-static-fonts") && !/<script[^>]+src="\/assets\//.test(html), `${route} static page declares its faces and loads no client bundle`);
  }
  receipt("static-glossary-server-html", { routes: ["/learn", "/learn/interchange-plus-pricing"], oneMain: true, oneH1: true, utilities: true, ownFonts: true, noBundle: true });

  // ── Anonymous: desktop header sign-in utilities, real pointer clicks, marker cleanup and restore ─────────
  await open();
  await browser!.navigate("/");
  await assertPublicShell("desktop Home");
  assert.equal(await browser!.evaluate("document.querySelectorAll('h1').length"), 1);
  await clickControl('[data-testid="link-nav-account-sign-in"]');
  await until("location.pathname==='/login'", "Account sign in reaches /login");
  await until("!!document.querySelector('[data-testid=\"input-email\"]')", "login form mounted");
  await until("!document.body.classList.contains('marketing-theme')", "markers removed after leaving the public shell");
  await assertNoPublicShell("/login after client navigation");
  assert.ok(closeTo(await color("hsl(var(--primary))"), CRM_PRIMARY), "/login keeps the CRM primary token");
  await browser!.evaluate("history.back()");
  await until("location.pathname==='/'", "history returns to Home");
  await assertPublicShell("Home after returning from /login");
  await clickControl('[data-testid="link-nav-partner-sign-in"]');
  await until("location.pathname==='/partner-login'", "Partner sign in reaches /partner-login");
  await until("!!document.querySelector('[data-testid=\"input-partner-email\"]')", "partner sign-in form mounted");
  await assertNoPublicShell("/partner-login");
  await browser!.screenshot("partner-login-desktop");
  receipt("desktop-utilities", { accountSignIn: "/login", partnerSignIn: "/partner-login", markersCleanedAndRestored: true, crmPrimaryIntact: true });

  // Wrong passwords never sign in and never redirect, on either entrance.
  await browser!.set('[data-testid="input-partner-email"]', h.email("partner"));
  await browser!.set('[data-testid="input-partner-password"]', "definitely-not-the-password");
  await clickControl('[data-testid="button-partner-login"]');
  await until("!!document.querySelector('[data-testid=\"text-partner-login-error\"]')", "partner wrong-password error");
  assert.equal(await browser!.evaluate("location.pathname"), "/partner-login", "wrong partner password stays on /partner-login");
  await browser!.navigate("/login");
  await browser!.set('[data-testid="input-email"]', h.email("merchant"));
  await browser!.set('[data-testid="input-password"]', "definitely-not-the-password");
  await clickControl('[data-testid="button-login"]');
  await until("!!document.querySelector('[data-testid=\"text-login-error\"]')", "account wrong-password error");
  assert.equal(await browser!.evaluate("location.pathname"), "/login", "wrong account password stays on /login");
  assert.equal(await browser!.evaluate("fetch('/api/auth/user').then(r=>r.status)"), 401, "wrong password created no session");
  receipt("wrong-password-rejected", { login: "stays on /login, no session", partnerLogin: "stays on /partner-login" });
  await shut();

  // ── Real sign-in destinations by role ─────────────────────────────────────────────────────────────────
  const roleFlows: Array<{ label: string; role: "admin" | "merchant" | "partner"; entry: "login" | "partner-login"; expect: RegExp }> = [
    { label: "admin via Account sign in", role: "admin", entry: "login", expect: /^\/dashboard(\/|$)/ },
    { label: "merchant via Account sign in", role: "merchant", entry: "login", expect: /^\/dashboard\/merchant-portal/ },
    { label: "partner account via Account sign in", role: "partner", entry: "login", expect: /^\/partner-portal/ },
    { label: "partner via Partner sign in", role: "partner", entry: "partner-login", expect: /^\/partner-portal/ },
  ];
  for (const flow of roleFlows) {
    await open();
    await browser!.navigate("/");
    await assertPublicShell(`${flow.label}: starting on Home`);
    await clickControl(flow.entry === "login" ? '[data-testid="link-nav-account-sign-in"]' : '[data-testid="link-nav-partner-sign-in"]');
    await until(`location.pathname==='/${flow.entry}'`, `${flow.label}: header link reaches /${flow.entry}`);
    if (flow.entry === "login") {
      await until("!!document.querySelector('[data-testid=\"input-email\"]')", `${flow.label}: form`);
      await signIn('[data-testid="input-email"]', '[data-testid="input-password"]', '[data-testid="button-login"]', h.email(flow.role));
    } else {
      await until("!!document.querySelector('[data-testid=\"input-partner-email\"]')", `${flow.label}: form`);
      await signIn('[data-testid="input-partner-email"]', '[data-testid="input-partner-password"]', '[data-testid="button-partner-login"]', h.email(flow.role));
    }
    await until(`${flow.expect}.test(location.pathname)`, `${flow.label}: lands where the role belongs`);
    const landed = await browser!.evaluate("location.pathname");
    assert.equal(await browser!.evaluate("fetch('/api/auth/user').then(r=>r.json()).then(u=>u.role)"), flow.role, `${flow.label}: actual session role`);
    await sleep(600);
    assert.match(await browser!.evaluate("location.pathname"), flow.expect, `${flow.label}: stays on the role's destination`);
    await assertNoPublicShell(`${flow.label}: destination`);
    await browser!.screenshot(`${flow.role}-${flow.entry}-landed`);
    receipt(flow.label, { landed, publicShellAbsent: true, actualPasswordSession: true });
    // The public shell is unaffected by the signed-in session when the visitor returns to a public page.
    await browser!.navigate("/payment-processing");
    await assertPublicShell(`${flow.label}: public page after sign-in`);
    assert.equal(await browser!.evaluate("document.querySelectorAll('h1').length"), 1, `${flow.label}: one h1 on the public page`);
    await shut();
  }

  // ── Hydrated public pages reach the server-only glossary by real clicks (the client router has no /learn route) ──────
  const isStaticGlossaryDocument = "!!document.querySelector('header.ssr-navbar')&&!document.querySelector('[data-testid=\"navbar\"]')&&document.querySelectorAll('h1').length===1";
  const assertGlossaryHub = async (label: string) => {
    await until("location.pathname==='/learn'", `${label}: reaches /learn`);
    await until(isStaticGlossaryDocument, `${label}: the server glossary document, not the client not-found page`);
    assert.equal(await browser!.evaluate("document.querySelector('h1').textContent.trim()"), "Payment Processing Glossary", `${label}: glossary hub heading`);
    assert.equal(await browser!.evaluate("/page not found|404/i.test(document.body.innerText)"), false, `${label}: not the not-found page`);
  };
  {
    await open({ width: 1440, height: 1000 });
    await browser!.navigate("/");
    await assertPublicShell("desktop Home before the Guides click");
    // A real pointer first hovers the trigger (which opens the panel) and the click then toggles it; open it for certain.
    for (let attempt = 0; attempt < 3; attempt++) {
      await clickControl('[data-testid="button-nav-resources"]');
      await sleep(400);
      if ((await browser!.evaluate("document.querySelector('[data-testid=\"button-nav-resources\"]').getAttribute('aria-expanded')")) === "true") break;
    }
    await until("document.querySelector('[data-testid=\"button-nav-resources\"]').getAttribute('aria-expanded')==='true'", "Resources dropdown is open");
    await clickControl('[data-testid="link-nav-resources-guides"]');
    await assertGlossaryHub("desktop Resources > Guides");
    const termHref = (await browser!.evaluate("(()=>{const a=[...document.querySelectorAll('main a')].find(x=>/^\\/learn\\/[a-z0-9-]+$/.test(x.getAttribute('href')||''));return a?a.getAttribute('href'):''})()")) as string;
    assert.match(termHref, /^\/learn\/[a-z0-9-]+$/, "glossary hub links to a term page");
    await clickControl(`main a[href="${termHref}"]`);
    await until(`location.pathname==='${termHref}'`, "hub term link reaches its term page");
    await until(isStaticGlossaryDocument, "term page is the server glossary document");
    await shut();

    await open({ width: 1440, height: 1000 });
    await browser!.navigate("/payment-processing");
    await assertPublicShell("desktop Pay processing before the footer Guides click");
    await browser!.evaluate("document.querySelector('[data-testid=\"link-footer-resources-guides\"]').scrollIntoView({block:'center'})");
    await sleep(400);
    await clickControl('[data-testid="link-footer-resources-guides"]');
    await assertGlossaryHub("footer Guides");
    await shut();

    await open({ width: 390, height: 844, mobile: true });
    await browser!.navigate("/");
    await assertPublicShell("phone Home before the drawer Guides click");
    await clickControl('[data-testid="button-mobile-menu"]');
    await until("!!document.querySelector('[data-testid=\"mobile-nav-drawer\"]')", "menu drawer opens");
    await clickControl('[data-testid="accordion-trigger-resources"]');
    await until("document.querySelector('[data-testid=\"link-mobile-resources-guides\"]')?.getClientRects().length>0", "drawer Resources shows Guides");
    await clickControl('[data-testid="link-mobile-resources-guides"]');
    await assertGlossaryHub("phone drawer Resources > Guides");
    receipt("hydrated-to-glossary-click-through", { desktopDropdown: "/learn then a term page", footer: "/learn", phoneDrawer: "/learn", serverDocument: true, notFoundPage: false });
    await shut();
  }

  // ── Static glossary pages on the compiled build: painted faces, header geometry and real sign-in hand-off ───────
  await open({ width: 1440, height: 1000 });
  await browser!.navigate("/learn");
  await until("document.fonts.status==='loaded'", "glossary fonts loaded");
  assert.equal(await browser!.evaluate("getComputedStyle(document.querySelector('h1')).fontFamily.startsWith('\"Source Serif 4\"')"), true, "glossary h1 asks for the display face");
  assert.equal(await browser!.evaluate("document.fonts.check('700 40px \"Source Serif 4\"')&&[...document.fonts].some(f=>f.family.replace(/[\"']/g,'')==='Source Serif 4'&&f.status==='loaded')"), true, "glossary display face actually loaded");
  const logoWidth = (await browser!.evaluate("document.querySelector('header img').getBoundingClientRect().width")) as number;
  assert.ok(logoWidth >= 70 && logoWidth <= 220, `glossary header logo width is sane (${logoWidth})`);
  assert.equal(await browser!.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "glossary 1440px: no horizontal overflow");
  await clickControl('header.ssr-navbar .ssr-nav-utilities a[href="/partner-login"]');
  await until("location.pathname==='/partner-login'", "static glossary Partner sign in reaches /partner-login");
  await until("!!document.querySelector('[data-testid=\"input-partner-email\"]')", "partner sign-in form mounted from the static page");
  await assertNoPublicShell("/partner-login from a static glossary page");
  receipt("static-glossary-desktop", { logoWidth: Math.round(logoWidth), displayFaceLoaded: true, partnerSignIn: "/partner-login", noOverflow: true });
  await shut();

  await open({ width: 390, height: 844, mobile: true });
  await browser!.navigate("/learn/interchange-plus-pricing");
  await until("document.fonts.status==='loaded'", "glossary term fonts loaded");
  assert.equal(await browser!.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "glossary term 390px: no horizontal overflow");
  await clickControl("header.ssr-navbar .ssr-menu summary");
  await until("document.querySelector('header.ssr-navbar .ssr-menu').open===true", "static menu opens without script");
  assert.equal(await browser!.evaluate("(()=>{const a=document.querySelector('header.ssr-navbar .ssr-menu-panel a[href=\"/about-contact\"]');return !!a&&a.getClientRects().length>0})()"), true, "static menu carries Talk to Liberty");
  await clickControl('header.ssr-navbar .ssr-menu-panel a[href="/login"]');
  await until("location.pathname==='/login'", "static menu Account sign in reaches /login");
  await until("!!document.querySelector('[data-testid=\"input-email\"]')", "login form mounted from the static page");
  await assertNoPublicShell("/login from a static glossary page");
  receipt("static-glossary-phone", { menu: "details opens without script", accountSignIn: "/login", noOverflow: true });
  await shut();

  // ── Phone width: the labelled Menu button reaches both utilities and Talk to Liberty ──────────────────────
  for (const target of [
    { testid: "link-mobile-account-sign-in", path: "/login", form: "input-email" },
    { testid: "link-mobile-partner-sign-in", path: "/partner-login", form: "input-partner-email" },
  ]) {
    await open({ width: 390, height: 844, mobile: true });
    await browser!.navigate("/");
    await assertPublicShell(`390px ${target.testid}: Home`);
    assert.equal(await browser!.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "390px: no horizontal overflow");
    assert.equal(await browser!.evaluate("document.querySelector('[data-testid=\"link-nav-talk\"]').getClientRects().length"), 0, "390px: the bar action is folded into the menu below 400px");
    await clickControl('[data-testid="button-mobile-menu"]');
    await until("!!document.querySelector('[data-testid=\"mobile-nav-drawer\"]')", "menu drawer opens");
    assert.equal(await browser!.evaluate("!!document.querySelector('[data-testid=\"link-mobile-talk\"]')"), true, "drawer carries Talk to Liberty");
    await clickControl(`[data-testid="${target.testid}"]`);
    await until(`location.pathname==='${target.path}'`, `${target.testid} reaches ${target.path}`);
    await until(`!!document.querySelector('[data-testid="${target.form}"]')`, `${target.path} form mounted`);
    await assertNoPublicShell(`390px ${target.path}`);
    receipt(`mobile-menu-${target.testid}`, { reaches: target.path, publicShellAbsent: true });
    await shut();
  }

  // 430px: wide enough for Talk to Liberty to sit in the bar next to the Menu button.
  await open({ width: 430, height: 932, mobile: true });
  await browser!.navigate("/");
  await assertPublicShell("430px Home");
  assert.equal(await browser!.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "430px: no horizontal overflow");
  assert.ok((await browser!.evaluate("document.querySelector('[data-testid=\"link-nav-talk\"]').getClientRects().length")) as number > 0, "430px: Talk to Liberty is in the bar");
  receipt("430px-talk-to-liberty", { inBar: true, noOverflow: true });
  await shut();

  // 320px: Talk to Liberty is inside the menu because the bar hides it below 400px.
  await open({ width: 320, height: 640, mobile: true });
  await browser!.navigate("/about-contact");
  await assertPublicShell("320px About & Contact");
  assert.equal(await browser!.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "320px: no horizontal overflow");
  await clickControl('[data-testid="button-mobile-menu"]');
  await until("!!document.querySelector('[data-testid=\"link-mobile-talk\"]')", "320px drawer carries Talk to Liberty");
  await clickControl('[data-testid="link-mobile-talk"]');
  await until("location.pathname==='/about-contact'", "Talk to Liberty reaches About & Contact");
  receipt("320px-talk-to-liberty", { reachable: "inside menu", noOverflow: true });
  await shut();

  // ── Dark mode: the public shell stays light and portalled menus follow it; sign-in pages keep CRM dark ────────
  await open({ width: 390, height: 844, mobile: true });
  await browser!.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await browser!.navigate("/");
  await assertPublicShell("OS dark mode Home");
  const luminance = (css: string) => rgb(css).reduce((a, b) => a + b, 0) / 3;
  assert.ok(luminance(await browser!.evaluate("getComputedStyle(document.body).backgroundColor") as string) > 200, "OS dark mode: public canvas stays light");
  await clickControl('[data-testid="button-mobile-menu"]');
  await until("!!document.querySelector('[data-testid=\"mobile-nav-drawer\"]')", "dark menu drawer opens");
  assert.ok(luminance(await browser!.evaluate("getComputedStyle(document.querySelector('[data-testid=\"mobile-nav-drawer\"]')).backgroundColor") as string) > 200, "OS dark mode: portalled drawer is light");
  await browser!.evaluate("localStorage.setItem('liberty-theme','dark')");
  await browser!.navigate("/pricing-and-programs");
  await assertPublicShell("stored dark Pricing & programs");
  assert.ok(luminance(await browser!.evaluate("getComputedStyle(document.body).backgroundColor") as string) > 200, "stored dark: public canvas stays light");
  await browser!.navigate("/login");
  await until("!!document.querySelector('[data-testid=\"input-email\"]')", "dark login form");
  await assertNoPublicShell("stored dark /login");
  receipt("dark-mode", { publicCanvasLight: true, portalledDrawerLight: true, signInKeepsCrmTheme: true });
  await shut();

  assert.equal(h.externalCalls(), 0, "no external call from the browser fixture");
  await fs.mkdir(SHOTS, { recursive: true });
  await fs.writeFile(path.join(SHOTS, "receipts.json"), JSON.stringify({ status: "passed", candidateUrl: h.base, receipts }, null, 2));
  console.log(`Public shell compiled role flows: ${receipts.length} receipt groups; Chromium only, not a Safari or real-iPhone pass.`);
} finally {
  await browser?.close();
  await h.pool.query("DELETE FROM partners WHERE affiliate_code=$1", [`${h.prefix}-aff`]).catch(() => undefined);
  await h.close();
}
