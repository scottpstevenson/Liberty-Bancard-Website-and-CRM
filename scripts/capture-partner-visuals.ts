import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser } from "./lib/public-site-browser";

/**
 * Partnership pages: candidate screenshots and computed visual checks (Chromium only, read-only).
 *
 *   npx tsx scripts/capture-partner-visuals.ts [--base=http://127.0.0.1:6100] [--out=generated-artifacts/partner-visuals]
 *
 * For each of the seven partnership routes:
 *   - 390 and 1440: a first-screen (hero) screenshot and a full-page screenshot; 768: first screen and full page.
 *   - 320, 375, 390, 768, 1024, 1440: computed checks on the rendered page, not the screenshot -
 *       one h1, no horizontal overflow, no control clipped by the viewport or by its card (F07), the hero image is
 *       decoded and visible, it is not lazy-loaded, the desktop hero has no vacant column, at least one navy section sits
 *       before the footer with readable inverse text, and the section H2s are in the marketing serif.
 * It never submits a form, signs in, books or messages anyone. Vendor hosts are blocked. This is Chromium viewport
 * evidence, not Safari/WebKit and not a real phone. Exit code is non-zero when any computed check fails.
 */
const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = arg("base", "http://127.0.0.1:6100").replace(/\/$/, "");
const out = arg("out", "generated-artifacts/partner-visuals");

const ROUTES = ["/partners", "/partners/referrals", "/partners/sales-agents", "/partners/cpa", "/partners/bookkeeper", "/partners/insurance", "/affiliate"];
const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const SHOTS: Record<number, "both" | "hero"> = { 390: "both", 1440: "both", 768: "both" };
const slug = (route: string) => route.replace(/^\//, "").replace(/\//g, "-") || "home";

const CHECK = String.raw`(async()=>{
  const lum=(c)=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    if(p.length>3&&p[3]===0)return null;const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(p[0])+0.7152*f(p[1])+0.0722*f(p[2])};
  const ratio=(a,b)=>{const hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05)};
  const bgOf=(el)=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;const l=lum(c);if(l!==null)return l}return 1};
  const vw=window.innerWidth;
  const main=document.querySelector('main');
  const result={h1:document.querySelectorAll('h1').length,overflow:document.documentElement.scrollWidth>vw+1,scrollWidth:document.documentElement.scrollWidth,vw};
  const problems=[];
  // F07: no control clipped by the viewport, by its own box, or by the card that holds it.
  const clipped=[];
  for(const el of main?main.querySelectorAll('a,button'):[]){
    const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;
    const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')continue;
    const label=(el.getAttribute('data-testid')||el.textContent||el.tagName).trim().slice(0,40);
    if(r.left<-0.5||r.right>vw+0.5)clipped.push(label+': outside viewport');
    else if(el.scrollWidth>el.clientWidth+1&&cs.overflowX!=='visible')clipped.push(label+': own text clipped');
    else{const card=el.closest('article,li,[class*="rounded"],[class*="card"]');
      if(card&&card!==el){const c=card.getBoundingClientRect();const co=getComputedStyle(card);
        if(co.overflowX!=='visible'&&(r.right>c.right+0.5||r.left<c.left-0.5))clipped.push(label+': clipped by its card')}}
  }
  result.clipped=clipped;
  // Hero image.
  const hero=document.querySelector('[data-testid^="section-partner-"][data-testid$="-hero"]')||main?.querySelector('section');
  const img=hero?[...hero.querySelectorAll('img')].find(i=>{const r=i.getBoundingClientRect();return r.width>0&&r.height>0}):null;
  if(img){
    const r=img.getBoundingClientRect();const h1=document.querySelector('h1').getBoundingClientRect();
    result.hero={complete:img.complete,naturalWidth:img.naturalWidth,decoded:img.complete&&img.naturalWidth>0,loading:img.getAttribute('loading'),fetchpriority:img.getAttribute('fetchpriority'),
      alt:img.getAttribute('alt'),src:(img.currentSrc||'').split('/').pop(),width:Math.round(r.width),height:Math.round(r.height),top:Math.round(r.top+scrollY),
      inFirstScreen:r.top<innerHeight,beforeActions:null,rightOfHeading:r.left>=h1.right-2||r.top>=h1.bottom-2};
  }else result.hero=null;
  // Navy sections before the footer, with readable inverse text.
  const footer=document.querySelector('footer');const footerTop=footer?footer.getBoundingClientRect().top+scrollY:Infinity;
  const navy=[...(main?main.querySelectorAll('section'):[])].filter(s=>{const l=lum(getComputedStyle(s).backgroundColor);return l!==null&&l<0.06&&s.getBoundingClientRect().height>60});
  result.navySections=navy.length;
  let minContrast=21;const lowContrast=[];
  for(const s of navy){const bg=lum(getComputedStyle(s).backgroundColor);
    for(const el of s.querySelectorAll('h1,h2,h3,h4,p,li,a,span,dt,dd,summary')){
      if(!el.childNodes.length||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
      const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;
      const cl=lum(getComputedStyle(el).color);if(cl===null)continue;
      const against=bgOf(el)??bg; // the nearest painted background: a light chip or button inside a navy band is judged against itself
      const cr=ratio(cl,against);minContrast=Math.min(minContrast,cr);
      if(cr<4.5)lowContrast.push((el.tagName+':'+el.textContent.trim().slice(0,24))+' '+cr.toFixed(2));
    }}
  result.navyMinContrast=navy.length?Math.round(minContrast*100)/100:null;result.lowContrast=lowContrast.slice(0,5);
  result.navyBeforeFooter=navy.some(s=>s.getBoundingClientRect().top+scrollY<footerTop);
  // Section headings (the shared public-h2 class) carry the marketing serif. A heading that is semantically an h2 but styled
  // as a card title (public-h3 / public-card-title) is a deliberate sans card heading and is listed, not failed.
  const h2s=[...(main?main.querySelectorAll('h2'):[])].filter(h=>h.getBoundingClientRect().width>0);
  const sectionH2=h2s.filter(h=>h.classList.contains('public-h2'));
  result.h2Total=h2s.length;result.sectionH2=sectionH2.length;
  result.h2NonSerif=sectionH2.filter(h=>!/Source Serif/i.test(getComputedStyle(h).fontFamily)).map(h=>h.textContent.trim().slice(0,30));
  result.cardH2=h2s.filter(h=>!h.classList.contains('public-h2')).map(h=>h.textContent.trim().slice(0,30));
  result.h1Serif=/Source Serif/i.test(getComputedStyle(document.querySelector('h1')).fontFamily);
  // Editorial body image (lazy, below the first screen): decoded and visible once scrolled to, inside its own section, and on the
  // hub placed beside the path-explanation heading from 768 px (the composition added in the closeout).
  const bodyFig=main?main.querySelector('figure[data-testid="partner-media-body"]'):null;
  if(bodyFig){const bi=bodyFig.querySelector('img');const br=bodyFig.getBoundingClientRect();const sec=bodyFig.closest('section');
    const head=sec?sec.querySelector('h2'):null;const hr=head?head.getBoundingClientRect():null;
    result.body={decoded:!!bi&&bi.complete&&bi.naturalWidth>0,loading:bi?bi.getAttribute('loading'):null,fetchpriority:bi?bi.getAttribute('fetchpriority'):null,
      src:bi?(bi.currentSrc||'').split('/').pop():null,alt:bi?bi.getAttribute('alt'):null,width:Math.round(br.width),height:Math.round(br.height),
      captionVisible:!!bodyFig.querySelector('figcaption')&&bodyFig.querySelector('figcaption').getBoundingClientRect().height>0,
      inSection:!!sec,sectionId:sec?sec.getAttribute('data-testid'):null,
      besideHeading:hr?(br.left>=hr.right-2||Math.abs((br.top+br.height/2)-(hr.top+hr.height/2))<br.height):null,
      inline:hr?br.left>=hr.right-2:null};
  }else result.body=null;
  result.docHeight=document.documentElement.scrollHeight;
  return result})()`;

const SCROLL_ALL = String.raw`(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}
  window.scrollTo(0,0);await new Promise(r=>setTimeout(r,300));
  const imgs=[...document.images].filter(i=>i.getBoundingClientRect().width>0);return {images:imgs.length,undecoded:imgs.filter(i=>!(i.complete&&i.naturalWidth>0)).map(i=>(i.currentSrc||i.src).split('/').pop())}})()`;

interface Row { route: string; width: number; failures: string[]; hero: any; body?: any; navySections: number | null; navyMinContrast: number | null; docHeight: number }
const rows: Row[] = [];

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await launchBrowser();
  try {
    for (const width of WIDTHS) {
      const height = width < 500 ? 844 : width < 1100 ? 1024 : 900;
      const session = await browser.newSession({
        width, height, mobile: width < 500, deviceScaleFactor: 1,
        blockUrlParts: ["leadconnectorhq.com", "google-analytics", "googletagmanager", "facebook.net"],
        localStorage: { prefer_desktop: "true", lb_cookie_consent: "essential" },
      });
      for (const route of ROUTES) {
        await session.goto(`${base}${route}`, { settleMs: 1500 });
        const scrolled = await session.evaluate<{ images: number; undecoded: string[] }>(SCROLL_ALL);
        const r = await session.evaluate<any>(CHECK);
        const failures: string[] = [];
        if (r.h1 !== 1) failures.push(`${r.h1} h1 elements`);
        if (r.overflow) failures.push(`horizontal overflow (${r.scrollWidth} > ${r.vw})`);
        if (r.clipped.length) failures.push(`clipped controls: ${r.clipped.slice(0, 4).join("; ")}`);
        if (!r.hero) failures.push("no visible hero image");
        else {
          if (!r.hero.decoded) failures.push(`hero image not decoded (${r.hero.src})`);
          if (r.hero.loading === "lazy") failures.push("hero image is lazy-loaded");
          if (!r.hero.inFirstScreen) failures.push(`hero image starts below the first screen (top ${r.hero.top}px)`);
          if (!r.hero.alt && r.hero.alt !== "") failures.push("hero image has no alt decision");
          if (width >= 1024 && r.hero.width < 360) failures.push(`desktop hero image is only ${r.hero.width}px wide`);
          if (width >= 1024 && !r.hero.rightOfHeading) failures.push("desktop hero image is not beside the heading");
          if (width < 768 && (r.hero.height < 150 || r.hero.height > 320)) failures.push(`phone hero image is ${r.hero.height}px tall (expected about 180-260)`);
        }
        const expectsBody = route !== "/partners/referrals" && route !== "/partners/sales-agents" && route !== "/affiliate";
        if (expectsBody && !r.body) failures.push("no editorial body image on this page");
        if (r.body) {
          if (!r.body.decoded) failures.push(`body image not decoded (${r.body.src})`);
          if (r.body.loading !== "lazy" || r.body.fetchpriority) failures.push("body image is not lazy");
          if (!r.body.alt) failures.push("body image has no alt text");
          if (!r.body.captionVisible) failures.push("body image has no visible illustrative-scene caption");
          if (width < 500 && r.body.width > width) failures.push(`body image is wider than the viewport (${r.body.width})`);
          if (route === "/partners") {
            if (r.body.sectionId !== "section-partner-paths") failures.push(`hub body image is in ${r.body.sectionId}, not the path-explanation section`);
            if (width >= 768 && !r.body.inline) failures.push("hub body image is not beside the path-explanation heading");
            if (width >= 768 && r.body.width < 280) failures.push(`hub body image is only ${r.body.width}px wide`);
          }
        }
        if (scrolled.undecoded.length) failures.push(`undecoded images after scrolling the page: ${scrolled.undecoded.slice(0, 3).join(", ")}`);
        if (!r.navyBeforeFooter) failures.push("no navy section before the footer");
        if (r.navyMinContrast !== null && r.navyMinContrast < 4.5) failures.push(`inverse text contrast ${r.navyMinContrast} on navy (${r.lowContrast.join("; ")})`);
        if (r.sectionH2 === 0) failures.push("no section heading uses the shared marketing H2 class");
        if (r.h2NonSerif.length) failures.push(`H2 not in the marketing serif: ${r.h2NonSerif.slice(0, 3).join(" | ")}`);
        if (!r.h1Serif) failures.push("h1 is not in the marketing serif");
        const errors = session.consoleErrors().filter((e) => !/Failed to load resource|net::ERR/i.test(e));
        if (errors.length) failures.push(`console errors: ${errors.slice(0, 2).join(" | ").slice(0, 160)}`);
        rows.push({ route, width, failures, hero: r.hero, body: r.body, navySections: r.navySections, navyMinContrast: r.navyMinContrast, sectionH2: r.sectionH2, cardH2: r.cardH2, docHeight: r.docHeight });
        if (SHOTS[width]) {
          await session.evaluate("window.scrollTo(0,0)");
          await session.screenshot(path.join(out, `${slug(route)}-${width}-hero.png`));
          await session.screenshot(path.join(out, `${slug(route)}-${width}-full.png`), { fullPage: true });
        }
        console.log(`${failures.length ? "FAIL" : "ok  "} ${String(width).padStart(4)} ${route}${failures.length ? "  <- " + failures.join(" | ") : ""}`);
      }
      await session.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(out, "report.json"), JSON.stringify({ base, widths: WIDTHS, routes: ROUTES, rows }, null, 1));
  const failed = rows.filter((r) => r.failures.length);
  console.log(`\n${rows.length} page states checked, ${failed.length} with findings`);
  if (failed.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });
