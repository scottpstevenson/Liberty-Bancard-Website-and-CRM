import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, type ColorScheme } from "./lib/public-site-browser";

/**
 * Public shell and hubs (W-B) design check. Chromium only, reads only.
 *
 *   npx tsx scripts/check-public-shell-design.ts [--base=http://127.0.0.1:5000]
 *     [--widths=320,390,768,1024,1440] [--schemes=light,dark] [--routes=/,/industries] [--no-auth]
 *     [--out=generated-artifacts/public-site/shell-design]
 *
 * Gate form: BASE_URL is read from the environment because the gate runner passes no arguments.
 *
 * For each page, width and colour scheme it proves, in the rendered document:
 *   - exactly one h1 and one main landmark, and no horizontal overflow;
 *   - Talk to Liberty, Support, Account sign in and Partner sign in are reachable (visible in the header
 *     from 1280px, otherwise inside the opened menu), with Talk to Liberty also in the bar from 400px;
 *   - on the hydrated public pages the public token cascade resolves to the Liberty palette
 *     (navy primary, brand red, light surface, slate secondary text), the public markers are set, and the
 *     canvas stays light under OS dark mode;
 *   - the sign-in pages do NOT receive the public markers or palette, so CRM and portal tokens are intact.
 *
 * It never submits a form, signs in, books or messages anyone. Vendor chat hosts are blocked. Results are
 * Chromium viewport evidence and are not a Safari/WebKit or real-iPhone pass.
 */

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PUBLIC_ROUTES: Array<{ route: string; hydrated: boolean }> = [
  { route: "/", hydrated: true },
  { route: "/payment-processing", hydrated: true },
  { route: "/pricing-and-programs", hydrated: true },
  { route: "/industries", hydrated: true },
  { route: "/about-contact", hydrated: true },
  { route: "/learn", hydrated: false },
  { route: "/learn/interchange-plus-pricing", hydrated: false },
];
const AUTH_ROUTES = ["/login", "/partner-login"];

/** Evaluated in the page. Returns plain data only; every judgement is made by the caller. */
const PUBLIC_PROBE = (expectHydrated: boolean) => String.raw`(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  if(${expectHydrated}){for(let i=0;i<60&&!document.body.classList.contains("marketing-theme");i++)await wait(100);}
  await wait(300);
  const visible=el=>{
    if(!el)return false;
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    return r.width>0&&r.height>0&&cs.visibility!=="hidden"&&cs.display!=="none"&&r.right>0&&r.left<innerWidth;
  };
  const within=el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;};
  const linksNamed=(label)=>[...document.querySelectorAll("a")].filter(a=>a.textContent.trim().replace(/\s+/g," ")===label);
  const reachable=(label,href)=>linksNamed(label).some(a=>a.getAttribute("href")===href&&visible(a)&&within(a));
  const headerNav=document.querySelector('[data-testid="navbar"]')||document.querySelector("header.ssr-navbar");
  const inHeader=(label,href)=>linksNamed(label).some(a=>headerNav&&headerNav.contains(a)&&a.getAttribute("href")===href&&visible(a)&&within(a)&&!a.closest('[data-testid="mobile-nav-drawer"]')&&!a.closest(".ssr-menu-panel"));
  const probe=expr=>{const s=document.createElement("span");s.style.color=expr;document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c;};
  const barBefore={
    talk:inHeader("Talk to Liberty","/about-contact"),
    support:inHeader("Support","/support"),
    account:inHeader("Account sign in","/login"),
    partner:inHeader("Partner sign in","/partner-login"),
  };
  const opener=document.querySelector('[data-testid="button-mobile-menu"]')||document.querySelector("details.ssr-menu > summary");
  let menu={opener:!!opener&&visible(opener),talk:false,support:false,account:false,partner:false,call:false};
  if(opener&&visible(opener)){
    opener.click();
    // The drawer slides in; poll until every entry has settled inside the viewport (or the time budget ends).
    const read=()=>({opener:true,
      talk:reachable("Talk to Liberty","/about-contact"),
      support:reachable("Support","/support"),
      account:reachable("Account sign in","/login"),
      partner:reachable("Partner sign in","/partner-login"),
      call:[...document.querySelectorAll('a[href^="tel:"]')].some(a=>visible(a)&&within(a)),
    });
    menu=read();
    for(let i=0;i<30&&!Object.values(menu).every(Boolean);i++){await wait(100);menu=read();}
  }
  const bodyBg=getComputedStyle(document.body).backgroundColor;
  return {
    h1:document.querySelectorAll("h1").length,
    main:document.querySelectorAll("main").length,
    overflow:{scrollWidth:document.documentElement.scrollWidth,innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth+1},
    barBefore,menu,
    markers:{body:document.body.classList.contains("marketing-theme"),html:document.documentElement.classList.contains("public-surface")},
    tokens:{navy:probe("hsl(var(--primary))"),red:probe("hsl(var(--brand-red))"),surface:probe("hsl(var(--muted))"),secondary:probe("hsl(var(--muted-foreground))")},
    bodyBg,
    callText:/Call\s*\/\s*Text|Text us/i.test(document.body.innerText),
  };
})()`;

const AUTH_PROBE = String.raw`(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<60&&!document.querySelector("form");i++)await wait(100);
  const probe=expr=>{const s=document.createElement("span");s.style.color=expr;document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c;};
  return {
    markers:{body:document.body.classList.contains("marketing-theme"),html:document.documentElement.classList.contains("public-surface")},
    primary:probe("hsl(var(--primary))"),
    hasForm:!!document.querySelector("form"),
  };
})()`;

const near = (actual: string, expected: [number, number, number], tolerance = 2): boolean => {
  const m = actual.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return !!m && [1, 2, 3].every((i) => Math.abs(Number(m[i]) - expected[i - 1]) <= tolerance);
};
const luminance = (css: string): number => {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : -1;
};

async function main() {
  const base = arg("base", process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
  const widths = arg("widths", "320,390,768,1024,1440").split(",").map(Number);
  const schemes = arg("schemes", "light,dark").split(",") as ColorScheme[];
  const out = arg("out", "generated-artifacts/public-site/shell-design");
  const routeFilter = arg("routes", "").split(",").filter(Boolean);
  const publicRoutes = routeFilter.length ? PUBLIC_ROUTES.filter((r) => routeFilter.includes(r.route)) : PUBLIC_ROUTES;
  if (routeFilter.length && publicRoutes.length !== routeFilter.length) throw new Error(`Unknown --routes entry in ${routeFilter.join(",")}`);
  const checkAuth = !process.argv.includes("--no-auth");
  const browser = await launchBrowser();
  const rows: Array<{ scheme: string; width: number; route: string; kind: string; issues: string[]; data: unknown }> = [];
  try {
    for (const scheme of schemes) {
      for (const width of widths) {
        const height = width < 500 ? 844 : width < 1100 ? 1024 : 900;
        const session = await browser.newSession({
          width,
          height,
          mobile: width < 500,
          colorScheme: scheme,
          blockUrlParts: ["leadconnectorhq.com", "google-analytics", "googletagmanager", "facebook.net"],
        });
        for (const { route, hydrated } of publicRoutes) {
          await session.goto(`${base}${route}`, { settleMs: 1200 });
          const data = await session.evaluate<any>(PUBLIC_PROBE(hydrated));
          const issues: string[] = [];
          if (data.h1 !== 1) issues.push(`h1:${data.h1}`);
          if (data.main !== 1) issues.push(`main:${data.main}`);
          if (data.overflow.horizontal) issues.push(`overflow:${data.overflow.scrollWidth}>${data.overflow.innerWidth}`);
          if (data.callText) issues.push("call-text-label");
          if (width >= 1280) {
            for (const key of ["talk", "support", "account", "partner"] as const) if (!data.barBefore[key]) issues.push(`header-missing:${key}`);
          } else {
            if (!data.menu.opener) issues.push("menu-button-not-visible");
            for (const key of ["talk", "support", "account", "partner"] as const) if (!data.menu[key]) issues.push(`menu-missing:${key}`);
            if (!data.menu.call) issues.push("menu-missing:phone");
            if (width >= 400 && !data.barBefore.talk) issues.push("header-missing:talk (>=400px)");
          }
          if (hydrated) {
            if (!data.markers.body || !data.markers.html) issues.push("public-markers-missing");
            if (!near(data.tokens.navy, [7, 29, 87])) issues.push(`primary:${data.tokens.navy}`);
            if (!near(data.tokens.red, [200, 16, 46])) issues.push(`brand-red:${data.tokens.red}`);
            if (!near(data.tokens.surface, [244, 246, 250])) issues.push(`surface:${data.tokens.surface}`);
            if (!near(data.tokens.secondary, [71, 85, 105], 3)) issues.push(`secondary-text:${data.tokens.secondary}`);
            if (luminance(data.bodyBg) < 200) issues.push(`canvas-not-light:${data.bodyBg}`);
          }
          rows.push({ scheme, width, route, kind: hydrated ? "public-hydrated" : "public-static", issues, data });
        }
        if (checkAuth && (width === 390 || width === 1440)) {
          for (const route of AUTH_ROUTES) {
            await session.goto(`${base}${route}`, { settleMs: 1200 });
            const data = await session.evaluate<any>(AUTH_PROBE);
            const issues: string[] = [];
            if (!data.hasForm) issues.push("sign-in-form-missing");
            if (data.markers.body || data.markers.html) issues.push("public-markers-present-on-sign-in");
            if (near(data.primary, [7, 29, 87], 1)) issues.push(`public-navy-leaked-into-sign-in:${data.primary}`);
            if (scheme === "light" && !near(data.primary, [15, 23, 42], 2)) issues.push(`crm-primary-changed:${data.primary}`);
            rows.push({ scheme, width, route, kind: "sign-in", issues, data });
          }
        }
        await session.close();
      }
    }
  } finally {
    await browser.close();
  }
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), JSON.stringify(rows, null, 2));
  let bad = 0;
  for (const r of rows) {
    if (r.issues.length) bad++;
    console.log(`${r.scheme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.route.padEnd(36)} ${r.kind.padEnd(15)} ${r.issues.length ? r.issues.join(" ") : "ok"}`);
  }
  console.log(`\n${rows.length} page states, ${bad} with findings. Report: ${path.join(out, "report.json")}`);
  if (bad) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
