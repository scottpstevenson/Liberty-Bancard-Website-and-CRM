import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {launchBrowser} from "./lib/public-site-browser";

/**
 * Public-site mobile performance check (Chromium only, lab measurement).
 *
 *   npx tsx scripts/check-public-perf.ts [--base=http://127.0.0.1:6000]
 *     [--routes=/,/faq] [--runs=3] [--label=after] [--out=generated-artifacts/public-site/perf]
 *     [--compare=generated-artifacts/public-site/perf/before.json] [--enforce]
 *
 * Emulates a phone (390x844, DPR 2) with 4x CPU slowdown and a 1.6 Mbps / 150 ms
 * round-trip network, cold cache, vendor chat hosts blocked. For every route it records the
 * median over `--runs` of: largest contentful paint, cumulative layout shift, total
 * transferred bytes, image bytes, and the number of image requests.
 *
 * The thresholds from the audit are LCP <= 2.5 s and CLS <= 0.1. They are only meaningful
 * against a production build (the Vite dev server serves hundreds of unbundled modules), so
 * `--enforce` should be used with the isolated production preview, never the dev server.
 * Read-only: it never submits a form, books, uploads or messages anyone. A lab run is not a
 * field measurement and not a Safari/WebKit or real-iPhone result.
 */

const arg=(name:string,fallback:string)=>{
  const hit=process.argv.find(a=>a.startsWith(`--${name}=`));
  return hit?hit.slice(name.length+3):fallback;
};
const flag=(name:string)=>process.argv.includes(`--${name}`);

const PERF_ROUTES=[
  "/","/upload-statement","/faq","/0-percent-processing",
  "/industries/restaurant-payment-processing","/industries/retail-payment-processing",
];
const LCP_BUDGET_MS=2500;
const CLS_BUDGET=0.1;

const OBSERVERS=String.raw`(()=>{
  window.__perf={lcp:0,cls:0};
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__perf.lcp=e.startTime;}).observe({type:"largest-contentful-paint",buffered:true});}catch(e){}
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__perf.cls+=e.value;}).observe({type:"layout-shift",buffered:true});}catch(e){}
})();`;

const median=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};

interface RouteResult{route:string;lcpMs:number;cls:number;totalBytes:number;imageBytes:number;imageRequests:number;runs:number}

async function main(){
  const base=arg("base","http://127.0.0.1:6000").replace(/\/$/,"");
  const routes=arg("routes",PERF_ROUTES.join(",")).split(",");
  const runs=Math.max(1,Number(arg("runs","3")));
  const label=arg("label","run");
  const out=arg("out","generated-artifacts/public-site/perf");
  const compare=arg("compare","");
  const enforce=flag("enforce");
  const browser=await launchBrowser();
  const results:RouteResult[]=[];
  try{
    for(const route of routes){
      const samples:Omit<RouteResult,"route"|"runs">[]=[];
      for(let i=0;i<runs;i++){
        const session=await browser.newSession({width:390,height:844,mobile:true,deviceScaleFactor:2,colorScheme:"light",
          blockUrlParts:["leadconnectorhq.com","google-analytics","googletagmanager","facebook.net"],
          localStorage:{lb_cookie_consent:"essential",lb_cookie_prefs:JSON.stringify({necessary:true,analytics:false,marketing:false,functional:false})}});
        await session.cdp("Network.enable");
        await session.cdp("Network.setCacheDisabled",{cacheDisabled:true});
        await session.cdp("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:(1.6*1024*1024)/8,uploadThroughput:(750*1024)/8});
        await session.cdp("Emulation.setCPUThrottlingRate",{rate:4});
        await session.cdp("Page.addScriptToEvaluateOnNewDocument",{source:OBSERVERS});
        await session.goto(`${base}${route}`,{settleMs:4000});
        const perf=await session.evaluate<{lcp:number;cls:number}>("window.__perf");
        const requests=session.requests();
        const images=requests.filter(r=>r.type==="Image"||/^image\//.test(r.mime??""));
        samples.push({
          lcpMs:Math.round(perf.lcp),
          cls:Number(perf.cls.toFixed(4)),
          totalBytes:requests.reduce((sum,r)=>sum+(r.encodedBytes??0),0),
          imageBytes:images.reduce((sum,r)=>sum+(r.encodedBytes??0),0),
          imageRequests:images.length,
        });
        await session.close();
      }
      results.push({
        route,runs,
        lcpMs:Math.round(median(samples.map(s=>s.lcpMs))),
        cls:Number(median(samples.map(s=>s.cls)).toFixed(4)),
        totalBytes:Math.round(median(samples.map(s=>s.totalBytes))),
        imageBytes:Math.round(median(samples.map(s=>s.imageBytes))),
        imageRequests:Math.round(median(samples.map(s=>s.imageRequests))),
      });
    }
  }finally{
    await browser.close();
  }
  await mkdir(out,{recursive:true});
  const file=path.join(out,`${label}.json`);
  await writeFile(file,JSON.stringify({base,label,runs,budgets:{lcpMs:LCP_BUDGET_MS,cls:CLS_BUDGET},profile:"390x844 DPR2, CPU x4, 1.6Mbps/150ms, cold cache",results},null,2));
  const previous:Record<string,RouteResult>={};
  if(compare){
    const prior=JSON.parse(await readFile(compare,"utf8"));
    for(const r of prior.results as RouteResult[])previous[r.route]=r;
  }
  let over=0;
  const kb=(n:number)=>`${Math.round(n/1024)}KB`;
  for(const r of results){
    const before=previous[r.route];
    const verdict=r.lcpMs>LCP_BUDGET_MS||r.cls>CLS_BUDGET?"OVER BUDGET":"within budget";
    if(verdict==="OVER BUDGET")over++;
    const delta=before?` | before LCP ${before.lcpMs}ms CLS ${before.cls} total ${kb(before.totalBytes)} images ${kb(before.imageBytes)}`:"";
    console.log(`${r.route.padEnd(52)} LCP ${String(r.lcpMs).padStart(5)}ms CLS ${r.cls} total ${kb(r.totalBytes)} images ${kb(r.imageBytes)} (${r.imageRequests}) ${verdict}${delta}`);
  }
  console.log(`\n${results.length} routes, ${over} over budget. Report: ${file}`);
  if(enforce&&over)process.exit(1);
}

main().catch(error=>{console.error(error);process.exit(1);});
