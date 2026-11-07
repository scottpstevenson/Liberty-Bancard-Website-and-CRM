import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {INSPECTED_ROUTES,launchBrowser,PAGE_AUDIT,type ColorScheme} from "./lib/public-site-browser";

/**
 * Public-site mobile visibility acceptance check (Chromium only).
 *
 *   npx tsx scripts/check-public-site-mobile.ts [--base=http://127.0.0.1:5000]
 *     [--widths=390,768,1440] [--schemes=light,dark] [--routes=/,/faq]
 *     [--out=generated-artifacts/public-site/run] [--screenshots] [--strict]
 *
 * Pre-deploy gate form: BASE_URL, PUBLIC_SITE_WIDTHS, PUBLIC_SITE_SCHEMES and PUBLIC_SITE_STRICT=1
 * are read from the environment because the gate runner passes no arguments.
 *
 * Reads only. It never submits a form, books, uploads or messages anyone. Vendor
 * chat hosts are blocked so no chat/session is created. Results are Chromium
 * viewport evidence and are NOT a Safari/WebKit or real-iPhone pass.
 */

const arg=(name:string,fallback:string)=>{
  const hit=process.argv.find(a=>a.startsWith(`--${name}=`));
  return hit?hit.slice(name.length+3):fallback;
};
const flag=(name:string)=>process.argv.includes(`--${name}`);

async function main(){
  const base=arg("base",process.env.BASE_URL??"http://127.0.0.1:5000").replace(/\/$/,"");
  const widths=arg("widths",process.env.PUBLIC_SITE_WIDTHS??"390,768,1440").split(",").map(Number);
  const schemes=arg("schemes",process.env.PUBLIC_SITE_SCHEMES??"light,dark").split(",") as ColorScheme[];
  const routes=arg("routes",INSPECTED_ROUTES.join(",")).split(",");
  const out=arg("out","generated-artifacts/public-site/run");
  const strict=flag("strict")||process.env.PUBLIC_SITE_STRICT==="1";
  const browser=await launchBrowser();
  const rows:any[]=[];
  try{
    for(const scheme of schemes){
      for(const width of widths){
        const height=width<500?844:width<1100?1024:900;
        const session=await browser.newSession({width,height,mobile:width<500,colorScheme:scheme,
          blockUrlParts:["leadconnectorhq.com","google-analytics","googletagmanager","facebook.net"]});
        for(const route of routes){
          await session.goto(`${base}${route}`,{settleMs:1200});
          // Walk the page once so scroll-reveal / lazy sections are present for the audit.
          await session.evaluate(`(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=Math.max(300,innerHeight*0.7)){scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}scrollTo(0,0);await new Promise(r=>setTimeout(r,900));return h;})()`);
          const report=await session.evaluate<any>(PAGE_AUDIT);
          rows.push({scheme,width,route,...report});
          if(flag("screenshots")){
            await session.screenshot(path.join(out,"shots",`${scheme}-${width}${route.replace(/\//g,"_")||"_home"}.png`));
          }
        }
        await session.close();
      }
    }
  }finally{
    await browser.close();
  }
  await mkdir(out,{recursive:true});
  await writeFile(path.join(out,"report.json"),JSON.stringify(rows,null,2));
  let bad=0;
  for(const r of rows){
    const issues:string[]=[];
    if(r.contrast.failureCount)issues.push(`contrast:${r.contrast.failureCount}`);
    if(r.contrast.imageBackedCount)issues.push(`img-backed(visual):${r.contrast.imageBackedCount}`);
    if(r.nestedInteractive.count)issues.push(`nested:${r.nestedInteractive.count}`);
    if(r.landmarks.main!==1)issues.push(`main:${r.landmarks.main}`);
    if(r.landmarks.h1!==1)issues.push(`h1:${r.landmarks.h1}`);
    if(r.overflow.horizontal)issues.push(`overflow:${r.overflow.scrollWidth}>${r.overflow.innerWidth}`);
    if(r.width<500&&r.smallTargets.count)issues.push(`targets<44:${r.smallTargets.count}`);
    if(issues.length)bad++;
    console.log(`${r.scheme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.route.padEnd(52)} h=${String(r.height).padEnd(6)} ${issues.length?issues.join(" "):"ok"}`);
  }
  console.log(`\n${rows.length} page states, ${bad} with findings. Report: ${path.join(out,"report.json")}`);
  if(strict&&bad)process.exit(1);
}

main().catch(error=>{console.error(error);process.exit(1);});
