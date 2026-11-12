import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {cpus,totalmem} from "node:os";
import path from "node:path";
import {privateStage3Browser} from "./private-stage3-browser";
import {c4PerformanceBaselineRoot,verifyC4PerformanceBaseline} from "./c4-performance-baseline";
import type {stage3BHttpFixture} from "./stage3-b-http";

/** Same owned API, records and machine; only production client assets vary.
 * Portfolio authority is unchanged in this repair, verified by source hash.
 * This certifies that reader/client rollback, not every native server feature. */
export async function runC4MatchedPerformance(
  h:Awaited<ReturnType<typeof stage3BHttpFixture>>,
  identity:any,selectClient:(root:string)=>void,
) {
  const candidate=path.resolve("dist/public");
  const baseline=c4PerformanceBaselineRoot();
  // Names the recorded reference commit and re-hashes the baseline's actual emitted files, not an
  // index-only existence check. Build it with scripts/build-c4-performance-baseline.ts.
  const baselineIdentity=await verifyC4PerformanceBaseline(baseline);
  // The reference commit predates later unrelated work in shared/schema.ts and server/storage.ts, so
  // whole-file equality cannot hold. The Portfolio reader (routes/portfolio.ts) issues raw SQL through
  // the pool and imports neither file; what it can observe of them is the definitions of the tables
  // it reads, so require its source and exactly those definitions to be unchanged.
  assert.deepEqual(await readFile("server/routes/portfolio.ts"),await readFile(path.join(baseline,"server/routes/portfolio.ts")),
    "Matched API/source rollback requires unchanged server/routes/portfolio.ts");
  const tableDefinition=(source:string,name:string)=>{
    const start=source.search(new RegExp(`^export const ${name} = pgTable\\(`,"m"));
    assert.ok(start>=0,`Table ${name} must be defined in shared/schema.ts`);
    const end=source.indexOf("\n});",start);
    assert.ok(end>start,`Table ${name} definition must be terminated`);
    return source.slice(start,end);
  };
  const candidateSchema=await readFile("shared/schema.ts","utf8");
  const baselineSchema=await readFile(path.join(baseline,"shared/schema.ts"),"utf8");
  for(const table of ["contacts","merchantMids","deals","merchantHealthScores","tickets","tasks"])
    assert.equal(tableDefinition(candidateSchema,table),tableDefinition(baselineSchema,table),
      `Matched API/source rollback requires unchanged ${table} table definition`);
  const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
  const snapshot=async()=>{
    const {rows}=await h.pool.query(`SELECT 'contacts' AS kind, row_to_json(c)::text AS value
      FROM contacts c WHERE c.email LIKE $1
      UNION ALL SELECT 'mids',row_to_json(m)::text FROM merchant_mids m WHERE m.mid LIKE $1
      ORDER BY kind,value`,[`${h.prefix}%`]);
    return {count:rows.length,hash:hash(JSON.stringify(rows))};
  };
  const before=await snapshot();
  assert.ok(before.count>=220,"Nonempty useful fixture: 110 eligible contacts plus 110 active MIDs");
  const trials:any[]=[];
  const visible=`Array.from(document.querySelectorAll('main a[href*="/dashboard/contacts/"]')).filter(e=>{
    const r=e.getBoundingClientRect();return /C4 Useful Business/.test(e.textContent||"")&&
    r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;
  })`;
  try{
    // Alternate order rather than giving candidate every warmed second run.
    for(const version of ["baseline","candidate","candidate","baseline"] as const){
      selectClient(version==="candidate"?candidate:path.join(baseline,"dist/public"));
      const b=await privateStage3Browser(h.base,h.sessions.get("admin")!.cookie,h.originalFetch,
        "docs/certification/stage3-c4/browser",{realInput:true,startupTimeoutMs:30000});
      try{
        await b.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
        await b.navigate("/mobile");await b.waitFor(/Switch to desktop view/);
        await b.waitFor(/Native appointments are unavailable/);
        await b.click('[data-testid="button-switch-to-desktop"]');
        // The switch reloads to /dashboard. The reference client lists Portfolio in its flat sidebar, but the
        // candidate's grouped sidebar nests it under a collapsed group, so wait for the shell, not that label.
        assert.equal(await b.evaluate(`(async()=>{for(let i=0;i<250;i++){
          if(location.pathname.startsWith("/dashboard")&&document.readyState==="complete"&&document.querySelector("main"))return true;
          await new Promise(r=>setTimeout(r,10));
        }return false;})()`),true,"Switching to desktop must reach the dashboard shell");
        const started=performance.now();
        await b.navigate("/dashboard/portfolio");
        assert.equal(await b.evaluate(`(async()=>{for(let i=0;i<250;i++){
          if((${visible}).length)return true;await new Promise(r=>setTimeout(r,10));
        }return false;})()`),true,"A hydrated business must actually be visible");
        const usefulListMs=performance.now()-started;
        // Time the genuine input event and subsequent painted feedback in the
        // renderer. Node/CDP round trips are recorded separately, not charged
        // to the UI's retained 200ms response target.
        await b.evaluate(`(()=>{
          const input=document.querySelector('main input[placeholder^="Search by name"]');
          window.__c4LocalFeedback=null;
          input.addEventListener("input",()=>{
            const started=performance.now();
            requestAnimationFrame(()=>requestAnimationFrame(()=>{
              window.__c4LocalFeedback={elapsed:performance.now()-started,value:input.value};
            }));
          },{once:true});
        })()`);
        let inputStarted=0;
        await b.set('main input[placeholder^="Search by name"]',"C4 Useful Business 1",()=>{inputStarted=performance.now();});
        const feedback=await b.evaluate(`(async()=>{for(let n=0;n<120;n++){
          if(window.__c4LocalFeedback)return window.__c4LocalFeedback;
          await new Promise(resolve=>setTimeout(resolve,10));
        }return null;})()`);
        assert.ok(feedback,"Physical input must reach two actual browser animation frames");
        assert.equal(feedback.value,"C4 Useful Business 1","Physical input must produce visible local feedback");
        const localResponseMs=feedback.elapsed;
        const controlRoundTripMs=performance.now()-inputStarted;
        assert.equal(await b.evaluate(`(async()=>{for(let i=0;i<250;i++){
          const rows=(${visible});if(rows.length&&rows.every(e=>/C4 Useful Business 1/.test(e.textContent)))return true;
          await new Promise(r=>setTimeout(r,10));
        }return false;})()`),true,"Actual scoped reader must subsequently provide matching visible records");
        trials.push({version,usefulListMs,localResponseMs,controlRoundTripMs,
          responseClock:"browser input event to two animation frames",visibleRecords:await b.evaluate(`(${visible}).length`),
          viewport:await b.evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})")});
        if(version==="candidate"){
          assert.ok(usefulListMs<=2500,`Useful-list target failed: ${usefulListMs}ms`);
          assert.ok(localResponseMs<=200,`Local-response target failed: ${localResponseMs}ms`);
        }
      }finally{await b.close();}
      assert.deepEqual(await snapshot(),before,"Client/source rollback must preserve owned durable data");
    }
    // Chromium's native persisted page-zoom preference, not CSS zoom or pinch.
    selectClient(candidate);
    const zoom=await privateStage3Browser(h.base,h.sessions.get("admin")!.cookie,h.originalFetch,
      "docs/certification/stage3-c4/browser",{realInput:true,zoom:2,startupTimeoutMs:30000});
    try{
      await zoom.navigate("/mobile");await zoom.waitFor(/Switch to desktop view/);
      await zoom.waitFor(/Native appointments are unavailable/);
      await zoom.click('[data-testid="button-switch-to-desktop"]');
      await zoom.navigate("/dashboard/portfolio");await zoom.waitFor(/C4 Useful Business/);
      const geometry=await zoom.evaluate(`({dpr:devicePixelRatio,width:innerWidth,
        overflow:document.documentElement.scrollWidth>innerWidth+1,cssZoom:getComputedStyle(document.body).zoom})`);
      assert.ok(Math.abs(geometry.dpr-2)<0.01,"Genuine browser 200% zoom must change DPR");
      assert.equal(geometry.cssZoom,"1","Do not simulate native zoom with CSS");
      assert.equal(geometry.overflow,false);
      await zoom.screenshot("portfolio-native-200-percent");
      trials.push({phase:"native 200% zoom",geometry});
    }finally{await zoom.close();}
    assert.deepEqual(await snapshot(),before);
    assert.equal(h.externalCalls(),0);
    await writeFile("docs/certification/stage3-c4/performance-rollback.json",JSON.stringify({
      status:"passed",identity,baselineIdentity:{sourceHead:baselineIdentity.sourceHead,outputHash:baselineIdentity.outputHash},
      machine:{cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
      conditions:"Same owned API and 110 eligible businesses; production Vite clients, same locked Node/npm dependencies; private Chromium, fresh profiles and disabled HTTP cache; loopback, reduced motion; DB warmed by identical mobile prerequisite. Local response measures physical input feedback; subsequent server-filtered records verified separately",
      rollback:"baseline→candidate→candidate→baseline→candidate client with unchanged actual Portfolio reader/source and latest disposable schema; no down-migration",
      before,after:await snapshot(),trials,
      qualification:"Portfolio reader/client source rollback and local targets only; not whole bundled-server or production/native rollback acceptance",
    },null,2)+"\n");
  }finally{selectClient(candidate);}
}
