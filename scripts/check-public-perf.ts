import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {launchBrowser} from "./lib/public-site-browser";
import {CLS_BUDGET,LCP_BUDGET_MS,PERF_OBSERVER_SOURCE,PERF_READINESS_SOURCE,classifySample,summarizeRoute,type SampleVerdict} from "./lib/public-perf-validity";

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
 * A sample counts only when it is valid (scripts/lib/public-perf-validity.ts): LCP finite and above 0,
 * CLS finite, the document ready with a rendered h1, no navigation timeout. A route with any invalid
 * sample is reported INVALID and fails the check whether or not `--enforce` is set.
 * Read-only: it never submits a form, books, uploads or messages anyone. A lab run is not a
 * field measurement and not a Safari/WebKit or real-iPhone result.
 */

const arg=(name:string,fallback:string)=>{
  const hit=process.argv.find(a=>a.startsWith(`--${name}=`));
  return hit?hit.slice(name.length+3):fallback;
};
const flag=(name:string)=>process.argv.includes(`--${name}`);

const PERF_ROUTES=[
  "/","/payment-processing","/pricing-and-programs","/about-contact","/industries",
  "/upload-statement","/faq","/0-percent-processing",
  "/industries/restaurant-payment-processing","/industries/retail-payment-processing",
];

const median=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};

type RouteStatus="within budget"|"over budget"|"invalid";
interface RouteResult{route:string;status:RouteStatus;lcpMs:number|null;cls:number|null;totalBytes:number;imageBytes:number;imageRequests:number;runs:number;invalidReasons:string[]}

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
      const verdicts:SampleVerdict[]=[];
      const transfer:{totalBytes:number;imageBytes:number;imageRequests:number}[]=[];
      for(let i=0;i<runs;i++){
        const session=await browser.newSession({width:390,height:844,mobile:true,deviceScaleFactor:2,colorScheme:"light",
          blockUrlParts:["leadconnectorhq.com","google-analytics","googletagmanager","facebook.net"],
          localStorage:{lb_cookie_consent:"essential",lb_cookie_prefs:JSON.stringify({necessary:true,analytics:false,marketing:false,functional:false})}});
        try{
          await session.cdp("Network.enable");
          await session.cdp("Network.setCacheDisabled",{cacheDisabled:true});
          await session.cdp("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:(1.6*1024*1024)/8,uploadThroughput:(750*1024)/8});
          await session.cdp("Emulation.setCPUThrottlingRate",{rate:4});
          await session.cdp("Page.addScriptToEvaluateOnNewDocument",{source:PERF_OBSERVER_SOURCE});
          let timedOut=false;
          try{await session.goto(`${base}${route}`,{settleMs:4000});}catch{timedOut=true;}
          const perf=timedOut?{lcp:null,cls:0,clsObserved:true}:await session.evaluate<{lcp:unknown;cls:unknown;clsObserved:unknown}>("window.__perf");
          const readiness=timedOut?{ready:false}:await session.evaluate<{ready:boolean}>(PERF_READINESS_SOURCE);
          verdicts.push(classifySample({lcp:perf.lcp,cls:perf.cls,clsObserved:perf.clsObserved,ready:readiness.ready,navigationTimedOut:timedOut}));
          const requests=session.requests();
          const images=requests.filter(r=>r.type==="Image"||/^image\//.test(r.mime??""));
          transfer.push({
            totalBytes:requests.reduce((sum,r)=>sum+(r.encodedBytes??0),0),
            imageBytes:images.reduce((sum,r)=>sum+(r.encodedBytes??0),0),
            imageRequests:images.length,
          });
        }finally{
          await session.close();
        }
      }
      const summary=summarizeRoute(verdicts,runs);
      results.push({
        route,runs,
        status:summary.status,
        lcpMs:summary.lcpMs,
        cls:summary.cls,
        totalBytes:Math.round(median(transfer.map(t=>t.totalBytes))),
        imageBytes:Math.round(median(transfer.map(t=>t.imageBytes))),
        imageRequests:Math.round(median(transfer.map(t=>t.imageRequests))),
        invalidReasons:summary.invalidReasons,
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
  let invalid=0;
  const kb=(n:number)=>`${Math.round(n/1024)}KB`;
  for(const r of results){
    const before=previous[r.route];
    if(r.status==="over budget")over++;
    if(r.status==="invalid")invalid++;
    const delta=before&&before.lcpMs!==null?` | before LCP ${before.lcpMs}ms CLS ${before.cls} total ${kb(before.totalBytes)} images ${kb(before.imageBytes)}`:"";
    const lcp=r.lcpMs===null?"  n/a":String(r.lcpMs).padStart(5);
    console.log(`${r.route.padEnd(52)} LCP ${lcp}ms CLS ${r.cls===null?"n/a":r.cls} total ${kb(r.totalBytes)} images ${kb(r.imageBytes)} (${r.imageRequests}) ${r.status.toUpperCase()}${delta}`);
    for(const reason of r.invalidReasons)console.log(`    invalid sample: ${reason}`);
  }
  console.log(`\n${results.length} routes, ${over} over budget, ${invalid} invalid. Report: ${file}`);
  // An invalid measurement is a failed check, never a pass, with or without --enforce.
  if(invalid)process.exit(1);
  if(enforce&&over)process.exit(1);
}

main().catch(error=>{console.error(error);process.exit(1);});
