/**
 * Public font-delivery proof (Chromium). For each route it records the registered
 * @font-face faces and their load status, and uses DevTools' platform-font inspection
 * (what Chromium actually painted, not the computed font-family list) for the page
 * heading, a section heading, an h3, body copy and a control. It also records layout
 * shift (CLS) accumulated while the document and fonts settle, and requests to
 * third-party font hosts.
 *
 *   npx tsx scripts/check-public-fonts.ts [--base=http://127.0.0.1:5000] [--width=390] [--out=file.json] [--strict]
 *
 * --strict exits non-zero when an element that asks for the display face is not
 * painted with it (silent fallback), when the serif is used outside h1/.display-serif,
 * when a legacy family (Outfit/DM Sans) is requested, or when the web-font swap itself
 * adds more than 0.02 CLS (total CLS minus CLS with every font request aborted).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INSPECTED_ROUTES, launchBrowser } from "./lib/public-site-browser";

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = arg("base", process.env.BASE_URL ?? "http://127.0.0.1:5000");
const width = Number(arg("width", "390"));
const out = arg("out", "generated-artifacts/public-site/fonts/report.json");
const strict = process.argv.includes("--strict") || process.env.PUBLIC_SITE_STRICT === "1";
const routes = arg("routes", INSPECTED_ROUTES.join(",")).split(",");
const BLOCK = ["leadconnectorhq.com", "google-analytics.com", "googletagmanager.com", "facebook.net", "clarity.ms"];


const CLS_OBSERVER = `window.__cls=0;window.__shifts=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(!e.hadRecentInput){window.__cls+=e.value;window.__shifts.push({v:+e.value.toFixed(4),t:Math.round(e.startTime)});}}}).observe({type:'layout-shift',buffered:true});}catch(e){}`;
/** CLS with every web-font request aborted: the document lays out on fallback faces only. */
async function clsWithoutFonts(browser: Awaited<ReturnType<typeof launchBrowser>>, route: string): Promise<number> {
  const s = await browser.newSession({ width, height: 844, mobile: width < 800, colorScheme: "light", blockUrlParts: [...BLOCK, "/fonts/", "fonts.googleapis.com", "fonts.gstatic.com"] });
  await s.cdp("Page.addScriptToEvaluateOnNewDocument", { source: CLS_OBSERVER });
  await s.goto(base + route, { settleMs: 2500 });
  const v = await s.evaluate<number>("+window.__cls.toFixed(4)");
  await s.close();
  return v;
}

type Sample = { label: string; selector: string; fonts: Array<{ family: string; glyphs: number; custom: boolean }>; computed: string } | { label: string; selector: string; missing: true };

(async () => {
  const browser = await launchBrowser();
  const results: any[] = [];
  let failed = 0;
  try {
    for (const route of routes) {
      const s = await browser.newSession({ width, height: 844, mobile: width < 800, colorScheme: "light", blockUrlParts: BLOCK });
      // Layout-shift observer must exist before the document paints.
      await s.cdp("Page.addScriptToEvaluateOnNewDocument", { source: CLS_OBSERVER });
      await s.goto(base + route, { settleMs: 2500 });
      await s.cdp("DOM.enable");
      await s.cdp("CSS.enable");
      const doc = await s.cdp("DOM.getDocument", { depth: 0 });
      const targets: Array<[string, string]> = [
        ["h1", "h1"],
        ["h2 (section)", "main h2"],
        ["h3 (card/accordion)", "main h3"],
        ["body copy", "main p"],
        ["control", "main button, main a[class*=btn], main a[data-testid]"],
      ];
      const samples: Sample[] = [];
      for (const [label, selector] of targets) {
        const q = await s.cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
        if (!q.nodeId) { samples.push({ label, selector, missing: true }); continue; }
        const pf = await s.cdp("CSS.getPlatformFontsForNode", { nodeId: q.nodeId });
        const computed = await s.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontFamily`);
        samples.push({ label, selector, computed, fonts: (pf.fonts as any[]).map((f) => ({ family: f.familyName, glyphs: f.glyphCount, custom: !!f.isCustomFont })) });
      }
      const faces = await s.evaluate<any[]>(`Array.from(document.fonts).map(f=>({family:f.family.replace(/["']/g,''),weight:f.weight,status:f.status}))`);
      const surface = await s.evaluate<boolean>(`!!document.querySelector('.marketing-surface')`);
      const cls = await s.evaluate<{ cls: number; shifts: any[] }>(`({cls:+window.__cls.toFixed(4),shifts:window.__shifts.slice(0,10)})`);
      const fontRequests = s.requests().filter((r) => /fonts\.g(oogleapis|static)\.com|\/fonts\//.test(r.url)).map((r) => ({ url: r.url.replace(base, ""), status: r.status, bytes: r.encodedBytes }));
      const problems: string[] = [];
      const fam = (x: Sample | undefined) => (x && !("missing" in x) ? x.fonts.map((f) => f.family) : []);
      const h1 = samples[0];
      // Every element that asks for the display face must actually be painted with it (no silent
      // Tinos/Times fallback) and must be a deliberate display moment (h1 or .display-serif).
      const serifNodes = await s.cdp("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "h1,h2,h3,h4,h5,h6,p,a,button,label,li,span,blockquote,figcaption,.display-serif" });
      const serifAudit: Array<{ tag: string; text: string; painted: string[]; ok: boolean }> = [];
      for (const nodeId of serifNodes.nodeIds as number[]) {
        const { object } = await s.cdp("DOM.resolveNode", { nodeId });
        const res = await s.cdp("Runtime.callFunctionOn", {
          objectId: object.objectId,
          returnByValue: true,
          functionDeclaration: `function(){const cs=getComputedStyle(this);if(!/^"?Source Serif 4/.test(cs.fontFamily))return null;const r=this.getBoundingClientRect();if(r.width<1||r.height<1||cs.display==='none')return null;return {tag:this.tagName.toLowerCase(),text:(this.textContent||'').trim().slice(0,50),deliberate:!!this.closest('h1,.display-serif')};}`,
        });
        const v = res.result.value;
        if (!v) continue;
        const pf = await s.cdp("CSS.getPlatformFontsForNode", { nodeId });
        const painted = (pf.fonts as any[]).map((f) => f.familyName);
        const ok = v.deliberate && painted.length > 0 && painted.every((f) => f === "Source Serif 4");
        serifAudit.push({ tag: v.tag, text: v.text, painted, ok });
        if (!v.deliberate) problems.push(`<${v.tag}> "${v.text}" uses the display serif but is not a display moment`);
        else if (!painted.every((f) => f === "Source Serif 4")) problems.push(`<${v.tag}> "${v.text}" is painted with ${painted.join("/")} instead of Source Serif 4`);
      }
      for (const x of samples.slice(2)) if (fam(x).includes("Source Serif 4")) problems.push(`${x.label} renders the serif`);
      if (fontRequests.some((r) => /fonts\.googleapis\.com\/css2\?[^"]*(Outfit|DM\+Sans|Source\+Serif)/.test(r.url))) problems.push("requests Outfit/DM Sans/Source Serif from Google");
      if (fontRequests.some((r) => r.status && r.status >= 400)) problems.push("font request failed");
      // Font-attributable shift = CLS with web fonts minus CLS on fallback faces only. The remaining
      // CLS is the server-rendered shell being replaced by the hydrated app (reported, not a font fault).
      const clsFallbackOnly = await clsWithoutFonts(browser, route);
      const fontShift = +(cls.cls - clsFallbackOnly).toFixed(4);
      if (fontShift > 0.02) problems.push(`web-font swap adds CLS ${fontShift} (> 0.02)`);
      if (problems.length) failed++;
      results.push({ route, width, marketingSurface: surface, samples, serifAudit, faces, cls, clsFallbackOnly, fontShift, fontRequests, problems });
      console.log(`${problems.length ? "FAIL" : "ok  "} ${route} surface=${surface} h1=[${fam(h1).join(",")}] serifNodes=${serifAudit.length} cls=${cls.cls} fontShift=${fontShift}${problems.length ? " :: " + problems.join("; ") : ""}`);
      await s.close();
    }
  } finally {
    await browser.close();
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base, width, generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`report: ${out}`);
  if (strict && failed) process.exit(1);
})();
