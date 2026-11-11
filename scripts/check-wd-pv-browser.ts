/**
 * W-D post-publish correction browser checks (Chromium only; reads and types into local fields, never submits).
 *
 *   npx tsx scripts/check-wd-pv-browser.ts [--base=http://127.0.0.1:6100] [--out=file.json] [--strict]
 *
 * PV01  Home hero at 320, 390, 768, 1024, 1100, 1180, 1280 and 1440 px, and with the root text size doubled at 320, 390, 768,
 *       1024 and 1280 px: both CTAs sit inside the copy column, do not
 *       overlap the photograph, and the element under each CTA's centre point is the CTA itself (hit test). The
 *       hero heading is painted with IBM Plex Sans (what Chromium painted, not the computed family list) while
 *       another public page title keeps the serif.
 * PV02  Calculator: a markup-only quote (0.3% + $0.10) with no pricing basis chosen, with "markup" chosen and no
 *       card-network costs, and with "tiered/not sure" chosen shows "Comparison incomplete", no quoted total and
 *       no saving; only an all-in quote or a markup quote with network costs entered shows a total.
 * PV04  Public application: primary fields are at least 44 px tall, the main actions at least 52 px, and the
 *       select triggers, step controls, checkboxes and error text are measured at 320, 390, 768 and 1280 px, in the dark
 *       colour scheme and with the root text size doubled (steps 1 and 6), from a synthetic local draft.
 *
 * PV06  Unknown dynamic URLs (industry, city, city+industry, compare, alternatives, switch-from) answer 404 with a branded,
 *       noindex document that has the heading, Home/Industries/Areas Served/contact links and the shared header and
 *       footer; the requested path is not echoed; client-side navigation shows the same words.
 *
 * Every family has a negative control that must be rejected by the same predicate. Results are Chromium evidence,
 * not Safari/WebKit and not a real device. No form is submitted; vendor chat hosts are blocked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./lib/public-site-browser";

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = arg("base", process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const out = arg("out", "generated-artifacts/public-site/wd-pv/report.json");
const strict = process.argv.includes("--strict") || process.env.PUBLIC_SITE_STRICT === "1";
const BLOCK = ["leadconnectorhq.com", "google-analytics.com", "googletagmanager.com", "facebook.net", "clarity.ms"];

const failures: string[] = [];
const report: Record<string, unknown> = {};
const note = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
};

/** In-page geometry: CTA containment, overlap with the photo, and hit testing. Returns problems (empty = pass). */
const HERO_GEOMETRY = `(() => {
  const q = (s) => document.querySelector(s);
  const column = q('[data-testid="hero-cta-block"]')?.parentElement;
  const photo = q('[data-testid="hero-visual"]');
  const ctas = ['link-hero-explore', 'link-hero-talk'].map((id) => q('[data-testid="' + id + '"]'));
  const problems = [];
  if (!column || !photo || ctas.some((c) => !c)) return { problems: ['hero column, photo or CTA missing'], boxes: {} };
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const colBox = box(column);
  const photoBox = box(photo);
  const boxes = { column: colBox, photo: photoBox };
  // Measure everything first, from one scroll position, then scroll for the hit tests.
  ctas.forEach((cta, i) => { boxes[i === 0 ? 'primary' : 'secondary'] = box(cta); });
  ctas.forEach((cta, i) => {
    const name = i === 0 ? 'primary' : 'secondary';
    const b = boxes[name];
    if (b.l < colBox.l - 0.5 || b.r > colBox.r + 0.5) problems.push(name + ' CTA leaves its column (' + b.l + '-' + b.r + ' vs ' + colBox.l + '-' + colBox.r + ')');
    const overlaps = !(b.r <= photoBox.l || b.l >= photoBox.r || b.b <= photoBox.t || b.t >= photoBox.b);
    if (overlaps && photoBox.l >= colBox.r - 1) problems.push(name + ' CTA overlaps the photograph');
    if (b.h < 44) problems.push(name + ' CTA is ' + b.h + ' px tall (< 44)');
  });
  ctas.forEach((cta, i) => {
    const name = i === 0 ? 'primary' : 'secondary';
    cta.scrollIntoView({ block: 'center' });
    const r = cta.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === cta || cta.contains(hit))) problems.push(name + ' CTA centre is covered by ' + (hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 40) : 'nothing'));
  });
  const a = boxes.primary, c = boxes.secondary;
  if (!(c.r <= a.l || c.l >= a.r || c.b <= a.t || c.t >= a.b)) problems.push('the two CTAs overlap each other');
  if (document.documentElement.scrollWidth > innerWidth) problems.push('page scrolls horizontally (' + document.documentElement.scrollWidth + ' > ' + innerWidth + ')');
  return { problems, boxes };
})()`;

/** The same predicate against a deliberately broken layout, to prove it can fail. */
const HERO_NEGATIVE_FIXTURE = `(() => {
  const photo = document.querySelector('[data-testid="hero-visual"]');
  const cta = document.querySelector('[data-testid="link-hero-explore"]');
  if (!photo || !cta) return false;
  const pr = photo.getBoundingClientRect();
  cta.style.position = 'fixed';
  cta.style.left = (pr.left + 10) + 'px';
  cta.style.top = (pr.top + 10) + 'px';
  cta.style.zIndex = '-1';
  return true;
})()`;

/** Poll for a selector: a cold dev or preview server can take several seconds to hydrate a lazy route. */
async function waitFor(s: { evaluate<T = unknown>(expression: string): Promise<T> }, selector: string, ms = 20000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await s.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function paintedFamilies(s: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newSession"]>>, selector: string): Promise<string[]> {
  await s.cdp("DOM.enable");
  await s.cdp("CSS.enable");
  const doc = await s.cdp("DOM.getDocument", { depth: 0 });
  const q = await s.cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) return [];
  const pf = await s.cdp("CSS.getPlatformFontsForNode", { nodeId: q.nodeId });
  return (pf.fonts as Array<{ familyName: string }>).map((f) => f.familyName);
}

(async () => {
  const browser = await launchBrowser();
  try {
    // ── PV01: Home hero ────────────────────────────────────────────────────────────────────────────────────
    const widths = [320, 390, 768, 1024, 1100, 1180, 1280, 1440];
    const hero: Record<string, unknown> = {};
    for (const width of widths) {
      const s = await browser.newSession({ width, height: width < 500 ? 844 : 900, mobile: width < 500, colorScheme: "light", blockUrlParts: BLOCK });
      await s.goto(`${base}/`, { settleMs: 1500 });
      await waitFor(s, '[data-testid="hero-cta-block"]');
      const g = await s.evaluate<{ problems: string[]; boxes: unknown }>(HERO_GEOMETRY);
      const painted = await paintedFamilies(s, '[data-testid="text-hero-heading"]');
      const computed = await s.evaluate<string>(`getComputedStyle(document.querySelector('[data-testid="text-hero-heading"]')).fontFamily`);
      hero[String(width)] = { ...g, painted, computed };
      note(g.problems.length === 0, `PV01 hero geometry at ${width}px`, g.problems.join("; "));
      note(painted.length > 0 && painted.every((f) => f === "IBM Plex Sans"), `PV01 hero heading painted with IBM Plex Sans at ${width}px`, `painted=[${painted.join(",")}] computed=${computed}`);
      if (width === 1024) {
        const bad = await s.evaluate<boolean>(HERO_NEGATIVE_FIXTURE);
        const g2 = await s.evaluate<{ problems: string[] }>(HERO_GEOMETRY);
        note(bad && g2.problems.length > 0, "PV01 negative control (a CTA moved under the photo) is rejected by the same predicate", g2.problems.join("; "));
        // The reported defect itself: the two CTAs in one non-wrapping row wider than the copy column.
        await s.goto(`${base}/`, { settleMs: 1500 });
        await waitFor(s, '[data-testid="hero-cta-block"]');
        await s.evaluate(`(() => { const b = document.querySelector('[data-testid="hero-cta-block"]'); b.style.flexWrap = 'nowrap'; b.querySelectorAll('a').forEach((x) => { x.style.whiteSpace = 'nowrap'; x.style.maxWidth = 'none'; x.style.flexShrink = '0'; }); })()`);
        const g3 = await s.evaluate<{ problems: string[] }>(HERO_GEOMETRY);
        note(g3.problems.some((p) => /leaves its column|overlaps the photograph/.test(p)), "PV01 negative control (non-wrapping CTA row, the reported defect) is rejected by the same predicate", g3.problems.join("; "));
      }
      await s.close();
    }
    // Text enlargement: the root text size doubled (the browser's 200% text-size setting) at the widths where the copy column is narrowest.
    for (const width of [320, 390, 768, 1024, 1280]) {
      // The cookie notice is a fixed overlay that legitimately grows with the text size and would cover the page centre until
      // it is answered, so consent is stored first (the same keys the performance harness stores); this isolates the hero layout.
      const s = await browser.newSession({
        width, height: width < 500 ? 844 : 900, mobile: width < 500, colorScheme: "light", blockUrlParts: BLOCK,
        localStorage: { lb_cookie_consent: "essential", lb_cookie_prefs: JSON.stringify({ necessary: true, analytics: false, marketing: false, functional: false }) },
      });
      await s.goto(`${base}/`, { settleMs: 1500 });
      await waitFor(s, '[data-testid="hero-cta-block"]');
      await s.evaluate(`document.documentElement.style.fontSize = '200%'`);
      await new Promise((r) => setTimeout(r, 400));
      const g = await s.evaluate<{ problems: string[]; boxes: unknown }>(HERO_GEOMETRY);
      hero[`${width}-text200`] = g;
      note(g.problems.length === 0, `PV01 hero geometry at ${width}px with text enlarged to 200%`, g.problems.join("; "));
      await s.close();
    }
    report.hero = hero;

    // Other public page titles keep the serif; the sans treatment is the Home hero only.
    for (const route of ["/faq", "/industries"]) {
      const s = await browser.newSession({ width: 1280, height: 900, colorScheme: "light", blockUrlParts: BLOCK });
      await s.goto(`${base}${route}`, { settleMs: 1800 });
      const painted = await paintedFamilies(s, "h1");
      note(painted.includes("Source Serif 4"), `PV01 ${route} title keeps the serif (Home-only font change)`, `painted=[${painted.join(",")}]`);
      await s.close();
    }

    // ── PV02: calculator unknown / incomplete state ────────────────────────────────────────────────────────
    const calc = await browser.newSession({ width: 1280, height: 1000, colorScheme: "light", blockUrlParts: BLOCK });
    await calc.goto(`${base}/savings-calculator`, { settleMs: 1500 });
    await waitFor(calc, '[data-testid="input-calc-monthlyVolume"]');
    const FILL = (id: string, value: string) => `(() => {
      const el = document.querySelector('[data-testid="input-calc-${id}"]');
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`;
    const CHOOSE = (basis: string) => `(() => { const el = document.querySelector('[data-testid="radio-calc-basis-${basis}"]'); if (!el) return false; el.click(); return true; })()`;
    const STATE = `(() => {
      const text = (id) => document.querySelector('[data-testid="' + id + '"]')?.textContent ?? null;
      return {
        withheld: !!document.querySelector('[data-testid="result-difference-withheld"]'),
        summary: !!document.querySelector('[data-testid="result-difference-summary"]'),
        incomplete: text('text-comparison-incomplete'),
        proposedTotal: text('text-proposed-monthly'),
        annual: text('text-annual-difference'),
        unknown: Array.from(document.querySelectorAll('[data-testid="list-unknown-costs"] li')).map((li) => li.textContent),
        preselected: Array.from(document.querySelectorAll('input[name="calc-basis"]')).filter((r) => r.checked).length,
        passThroughField: !!document.querySelector('[data-testid="input-calc-proposedPassThrough"]'),
      };
    })()`;
    type CalcState = { withheld: boolean; summary: boolean; incomplete: string | null; proposedTotal: string | null; annual: string | null; unknown: string[]; preselected: number; passThroughField: boolean };
    const fill = async (pairs: Record<string, string>) => {
      for (const [id, v] of Object.entries(pairs)) await calc.evaluate(FILL(id, v));
      await new Promise((r) => setTimeout(r, 250));
    };
    await fill({ monthlyVolume: "10000", avgTicket: "50", currentRate: "3", proposedRate: "0.3", proposedPerTransaction: "0.10", proposedMonthlyFees: "0", proposedEquipmentMonthly: "0" });
    let st = await calc.evaluate<CalcState>(STATE);
    report.calcNoBasis = st;
    note(st.preselected === 0, "PV02 no pricing basis is preselected", `checked radios=${st.preselected}`);
    note(st.withheld && !st.summary && st.proposedTotal === null && st.annual === null, "PV02 markup-only quote with no basis chosen shows no total and no saving", JSON.stringify(st));
    note(/Comparison incomplete/.test(st.incomplete ?? "") && st.unknown.length >= 1, "PV02 the incomplete state names what is missing", st.unknown.join(" | "));

    await calc.evaluate(CHOOSE("markup"));
    await new Promise((r) => setTimeout(r, 250));
    st = await calc.evaluate<CalcState>(STATE);
    report.calcMarkupNoNetwork = st;
    note(st.passThroughField, "PV02 a markup quote asks for the card-network costs");
    note(st.withheld && !st.summary && st.proposedTotal === null && st.annual === null, "PV02 markup quote without card-network costs shows no total and no saving", JSON.stringify(st));
    note(st.unknown.some((u) => /card-network costs/i.test(u)), "PV02 card-network costs are named as the unknown", st.unknown.join(" | "));

    await calc.evaluate(CHOOSE("unsure"));
    await new Promise((r) => setTimeout(r, 250));
    st = await calc.evaluate<CalcState>(STATE);
    report.calcUnsure = st;
    note(st.withheld && !st.summary && st.proposedTotal === null, "PV02 tiered / not-sure quote is never totalled", JSON.stringify(st));

    await calc.evaluate(CHOOSE("markup"));
    await fill({ proposedPassThrough: "180" });
    st = await calc.evaluate<CalcState>(STATE);
    report.calcMarkupWithNetwork = st;
    note(st.summary && st.proposedTotal !== null && /230/.test(st.proposedTotal) && /840/.test(st.annual ?? ""), "PV02 markup quote with network costs entered totals them once ($230 a month, $840 a year)", JSON.stringify(st));

    // The defect predicate, applied to every state captured above and to a synthetic copy of the reported defect.
    const isMarkupOnlyDefect = (x: { proposedTotal: string | null; annual: string | null }) => /\$50(?!\d)/.test(x.proposedTotal ?? "") || /3,000/.test(x.annual ?? "");
    const captured = [report.calcNoBasis, report.calcMarkupNoNetwork, report.calcUnsure, report.calcMarkupWithNetwork] as Array<{ proposedTotal: string | null; annual: string | null }>;
    note(captured.every((x) => !isMarkupOnlyDefect(x)), "PV02 no captured state shows the markup-only defect ($50 quote / $3,000 a year)");
    note(isMarkupOnlyDefect({ proposedTotal: "$50", annual: "$3,000 per year" }), "PV02 negative control: the defect predicate recognises the reported $50 / $3,000 result");
    await calc.close();

    // ── PV04: public merchant application control sizing ───────────────────────────────────────────────────
    // A synthetic local draft (clearly fake values, no EIN/SSN/bank data) restores each step without typing real data.
    // Every /api request is aborted, so nothing is autosaved or submitted. Heights are measured on rendered boxes.
    const SYNTH = (step: number) => JSON.stringify({
      currentStep: step,
      lastSaved: new Date().toISOString(),
      formData: {
        legalBusinessName: "Example Test Fixture LLC", businessType: "LLC", businessAddress: "1 Example Way", businessCity: "Example",
        businessState: "FL", businessZip: "33000", businessPhone: "5555550100", businessEmail: "fixture@example.invalid", vertical: "Retail",
        ownerFirstName: "Example", ownerLastName: "Fixture", ownerEmail: "fixture@example.invalid", ownerPhone: "5555550100",
        ownerAddress: "1 Example Way", ownerCity: "Example", ownerState: "FL", ownerZip: "33000", ownershipPercent: "100",
        estimatedMonthlyVolume: "10000", estimatedAvgTicket: "50", highestTicket: "200", currentProcessor: "Example", currentRate: "2.9",
        acceptedCardTypes: ["Visa"], terminalNeeded: true, terminalType: "", terminalQuantity: "1", ecommerceNeeded: false, preferredProgram: "",
      },
    });
    const MEASURE = `(() => {
      const root = document.querySelector('.public-application');
      if (!root) return { missingRoot: true, rows: [] };
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const rows = [];
      const add = (kind, el) => { if (!vis(el)) return; const r = el.getBoundingClientRect(); rows.push({ kind, id: el.getAttribute('data-testid') || el.id || el.tagName.toLowerCase(), h: +r.height.toFixed(1), w: +r.width.toFixed(1), fs: parseFloat(getComputedStyle(el).fontSize) }); };
      root.querySelectorAll('main input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), main textarea').forEach((e) => add('field', e));
      root.querySelectorAll('main [role=combobox]').forEach((e) => add('select', e));
      root.querySelectorAll('[data-testid=button-next], [data-testid=button-back], [data-testid=button-submit-application]').forEach((e) => add('action', e));
      root.querySelectorAll('[data-testid^=button-terminal-], [data-testid^=button-ecommerce-], [data-testid=button-restore-draft], [data-testid=button-discard-draft]').forEach((e) => add('choice', e));
      root.querySelectorAll('label.public-application-check').forEach((e) => add('check-row', e));
      root.querySelectorAll('main [role=checkbox]').forEach((e) => add('check-box', e));
      root.querySelectorAll('[data-testid=text-step-missing], [data-testid=text-recovery-warning], [data-testid=text-saved-submission-result]').forEach((e) => add('status-text', e));
      return { missingRoot: false, rows, overflow: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth };
    })()`;
    type Row = { kind: string; id: string; h: number; w: number; fs: number };
    const MIN: Record<string, number> = { field: 47.5, select: 47.5, action: 51.5, choice: 47.5, "check-row": 43.5, "check-box": 23.5 };
    const sizeProblems = (rows: Row[]) =>
      rows.flatMap((r) => {
        const min = MIN[r.kind];
        const out: string[] = [];
        if (min !== undefined && r.h < min) out.push(`${r.kind} ${r.id} is ${r.h}px tall (< ${Math.ceil(min)})`);
        if (r.kind === "status-text" && r.fs < 14) out.push(`${r.kind} ${r.id} is ${r.fs}px text (< 14)`);
        return out;
      });
    const appReport: Record<string, unknown> = {};
    type AppProfile = { width: number; scheme: "light" | "dark"; zoom: boolean; steps: number[] };
    const profiles: AppProfile[] = [
      { width: 320, scheme: "light", zoom: false, steps: [1, 4, 5, 6] },
      { width: 390, scheme: "light", zoom: false, steps: [1, 4, 5, 6] },
      { width: 768, scheme: "light", zoom: false, steps: [1, 4, 5, 6] },
      { width: 1280, scheme: "light", zoom: false, steps: [1, 4, 5, 6] },
      { width: 390, scheme: "dark", zoom: false, steps: [1, 6] },
      { width: 390, scheme: "light", zoom: true, steps: [1, 6] },
    ];
    for (const { width, scheme, zoom, steps } of profiles) {
      const tag = `${width}px${scheme === "dark" ? " dark" : ""}${zoom ? " text200" : ""}`;
      for (const step of steps) {
        const s = await browser.newSession({
          width, height: width < 500 ? 844 : 900, mobile: width < 500, colorScheme: scheme,
          blockUrlParts: [...BLOCK, "/api/"], localStorage: { merchant_app_draft: SYNTH(step) },
        });
        await s.goto(`${base}/merchant-application`, { settleMs: 1500 });
        await waitFor(s, '[data-testid="button-restore-draft"]');
        const banner = await s.evaluate<{ rows: Row[] }>(MEASURE);
        // The page's own autosave rewrites the draft on mount, so the synthetic draft is put back just before "Continue Draft".
        const clicked = await s.evaluate<boolean>(`(() => { const b = document.querySelector('[data-testid="button-restore-draft"]'); if (!b) return false; localStorage.setItem('merchant_app_draft', ${JSON.stringify(SYNTH(step))}); b.click(); return true; })()`);
        await new Promise((r) => setTimeout(r, 900));
        if (zoom) {
          await s.evaluate(`document.documentElement.style.fontSize = '200%'`);
          await new Promise((r) => setTimeout(r, 400));
        }
        const m = await s.evaluate<{ missingRoot: boolean; rows: Row[]; overflow: boolean; scrollWidth: number }>(MEASURE);
        const currentStep = await s.evaluate<string>(`document.querySelector('[data-testid^="step-"]:not([data-testid^="step-indicator"]):not([data-testid="step-indicators"])')?.getAttribute('data-testid') ?? ''`);
        const rows = [...banner.rows.filter((r) => /restore|discard/.test(r.id)), ...m.rows];
        const problems = sizeProblems(rows);
        appReport[`${tag}-step${step}`] = { clicked, currentStep, rows, problems, overflow: m.overflow };
        const expected = { 1: "step-business-info", 4: "step-processing-details", 5: "step-equipment-program", 6: "step-review-submit" }[step as 1 | 4 | 5 | 6];
        note(!m.missingRoot && clicked && rows.length > 0 && currentStep === expected, `PV04 application step ${step} restored at ${tag}`, `step=${currentStep} expected=${expected} measured=${rows.length}`);
        note(problems.length === 0, `PV04 application control sizes, step ${step}, ${tag}`, problems.join("; ") || `${rows.length} controls measured`);
        note(!m.overflow, `PV04 application has no horizontal overflow, step ${step}, ${tag}`, `scrollWidth=${m.scrollWidth}`);
        if (tag === "390px" && step === 1) {
          // Negative control: a 36 px input (the shared default) inside the same wrapper must be flagged.
          await s.evaluate(`(() => { const i = document.createElement('input'); i.setAttribute('data-testid', 'negative-control-input'); i.style.cssText = 'display:block;height:36px;min-height:0;width:200px'; document.querySelector('.public-application main').prepend(i); })()`);
          const neg = await s.evaluate<{ rows: Row[] }>(MEASURE);
          // The wrapper's own min-height rule would lift it, so assert on the predicate with an inline override in force.
          const negProblems = sizeProblems(neg.rows.filter((r) => r.id === "negative-control-input"));
          note(negProblems.length > 0, "PV04 negative control (an inline 36px field) is rejected by the same predicate", negProblems.join("; "));
        }
        await s.close();
      }
    }
    report.application = appReport;

    // ── PV06: unknown dynamic URLs show a branded not-found page with a real 404 ───────────────────────────────
    const UNKNOWN = ["/industries/not-an-industry", "/locations/not-a-city", "/locations/miami/not-an-industry", "/compare/not-a-competitor", "/alternatives/not-a-provider", "/switch-from/not-a-provider"];
    const notFoundProblems = (r: { status: number; body: string; robots: string | null; path: string }): string[] => {
      const out: string[] = [];
      if (r.status !== 404) out.push(`status ${r.status}, not 404`);
      if (r.body.trim().length < 2000) out.push(`body is ${r.body.length} bytes`);
      if (!/<h1[^>]*>We couldn&#39;t find that page|<h1[^>]*>We couldn't find that page/.test(r.body)) out.push("no not-found heading");
      for (const href of ["/", "/industries", "/areas-served", "/about-contact", "/support"]) if (!r.body.includes(`href="${href}"`)) out.push(`no ${href} link`);
      if (!/<meta name="robots" content="noindex/.test(r.body)) out.push("no noindex meta");
      if (/noindex/.test(r.robots ?? "") === false) out.push("no noindex header");
      if (/rel="canonical"/.test(r.body)) out.push("a not-found page must not declare a canonical");
      const last = r.path.split("/").pop() ?? "";
      if (last && r.body.includes(last)) out.push("the requested path is echoed into the markup");
      return out;
    };
    const pv06: Record<string, unknown> = {};
    for (const u of UNKNOWN) {
      const res = await fetch(`${base}${u}`, { redirect: "manual" });
      const body = await res.text();
      const probs = notFoundProblems({ status: res.status, body, robots: res.headers.get("x-robots-tag"), path: u });
      pv06[u] = { status: res.status, bytes: body.length, problems: probs };
      note(probs.length === 0, `PV06 direct load of ${u} is a branded 404`, probs.join("; ") || `404, ${body.length} bytes`);
    }
    // Real routes still return 200 and are not replaced by the not-found document.
    for (const u of ["/industries/restaurant-payment-processing", "/compare/square", "/alternatives/square"]) {
      const res = await fetch(`${base}${u}`);
      const body = await res.text();
      note(res.status === 200 && !/We couldn(&#39;|')t find that page/.test(body), `PV06 valid ${u} still returns its page`, `status ${res.status}`);
    }
    // Negative controls: the same predicate rejects an empty 404, a 200 soft 404 and a page that echoes the path.
    const goodBody = await (await fetch(`${base}${UNKNOWN[0]}`)).text();
    note(notFoundProblems({ status: 404, body: "", robots: "noindex, follow", path: "/x/y" }).length > 0, "PV06 negative control (the old empty 404 body) is rejected");
    note(notFoundProblems({ status: 200, body: goodBody, robots: "noindex, follow", path: "/x/y" }).some((p) => /not 404/.test(p)), "PV06 negative control (a 200 soft 404) is rejected");
    note(notFoundProblems({ status: 404, body: goodBody + "<p>not-an-industry</p>", robots: "noindex", path: UNKNOWN[0] }).some((p) => /echoed/.test(p)), "PV06 negative control (path echoed into markup) is rejected");

    // Visible result in a browser, at phone and desktop widths, plus client-side navigation to the same URLs.
    for (const width of [390, 1280]) {
      const s = await browser.newSession({ width, height: width < 500 ? 844 : 900, mobile: width < 500, colorScheme: "light", blockUrlParts: BLOCK });
      await s.goto(`${base}/locations/not-a-city`, { settleMs: 1200 });
      const v = await s.evaluate<{ h1: string; links: number; overflow: boolean; homeHit: boolean; chrome: boolean }>(`(() => {
        const home = document.querySelector('[data-testid="link-404-home"]');
        let homeHit = false;
        if (home) { home.scrollIntoView({ block: 'center' }); const r = home.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); homeHit = !!hit && (hit === home || home.contains(hit)); }
        return { h1: document.querySelector('h1')?.textContent ?? '', links: document.querySelectorAll('[data-testid="page-not-found"] a').length, overflow: document.documentElement.scrollWidth > innerWidth, homeHit, chrome: !!document.querySelector('.ssr-navbar') && !!document.querySelector('footer') };
      })()`);
      note(/couldn.t find that page/.test(v.h1) && v.links >= 8 && v.homeHit && v.chrome && !v.overflow, `PV06 not-found page renders, links work, header/footer present at ${width}px`, JSON.stringify(v));
      await s.close();
    }
    {
      const s = await browser.newSession({ width: 1280, height: 900, colorScheme: "light", blockUrlParts: BLOCK });
      await s.goto(`${base}/faq`, { settleMs: 1500 });
      await waitFor(s, "h1");
      const nav = await s.evaluate<{ found: boolean; h1: string; links: number }>(`(async () => {
        history.pushState({}, '', '/industries/not-an-industry');
        dispatchEvent(new PopStateEvent('popstate'));
        for (let i = 0; i < 40 && !document.querySelector('[data-testid="page-not-found"]'); i++) await new Promise((r) => setTimeout(r, 150));
        return { found: !!document.querySelector('[data-testid="page-not-found"]'), h1: document.querySelector('[data-testid="text-404-title"]')?.textContent ?? '', links: document.querySelectorAll('[data-testid="page-not-found"] a').length };
      })()`);
      note(nav.found && /couldn.t find that page/.test(nav.h1) && nav.links >= 8, "PV06 client-side navigation to an unknown industry shows the same not-found page", JSON.stringify(nav));
      await s.close();
    }
    report.notFound = pv06;
  } finally {
    await browser.close();
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base, generatedAt: new Date().toISOString(), failures, report }, null, 2));
  console.log(`\n${failures.length} failure(s). report: ${out}`);
  if (strict && failures.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
