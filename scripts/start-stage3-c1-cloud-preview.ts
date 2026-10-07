/**
 * Temporary authenticated C1 candidate. Owns private DB/Redis and an ordinary
 * reverse proxy only: no injected cookies, sessions, role override or auto-login.
 * The one permitted incoming secret seeds dedicated synthetic fixture accounts.
 */
import assert from "node:assert/strict";
import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {randomBytes,createHash} from "node:crypto";
import {createServer,request} from "node:http";
import {readFile,writeFile,unlink,stat,rename} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {buildLocalRehearsalEnvironment,launchLocalPostgres16} from "./local-rehearsal-core";
import {launchSfp2060DisposableRedis} from "./sfp2060-disposable-redis";
import {isPrivateDisposableGateEnvironment} from "./pre-deploy";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
import {installC1CompiledSsrAssets} from "./fixtures/c1-compiled-ssr-assets";

const readyFile=path.resolve(".local/tasks/c1-cloud-preview-ready.json");
const tsx=path.resolve("node_modules/tsx/dist/cli.mjs");
async function verifyReusableBuild(){
  const inputs=execFileSync("git",["ls-files","-z","client","server","shared",
    "package.json","package-lock.json","vite.config.ts","tailwind.config.ts",
    "tailwind-legacy-theme.json","tsconfig.json","script/build.ts"],{encoding:"utf8"})
    .split("\0").filter(Boolean).sort();
  const html=await stat("dist/public/index.html");
  await stat("dist/index.cjs");
  const hash=createHash("sha256");
  for(const file of inputs){
    assert.ok((await stat(file)).mtimeMs<=html.mtimeMs,
      `Compiled candidate is older than ${file}; a fresh build is required`);
    hash.update(file+"\0");hash.update(await readFile(file));hash.update("\0");
  }
  const outputs=createHash("sha256");
  outputs.update(await readFile("dist/public/index.html"));
  outputs.update(await readFile("dist/index.cjs"));
  return {inputHash:hash.digest("hex"),entryOutputsHash:outputs.digest("hex"),
    compiledHtmlAt:html.mtime.toISOString(),qualification:"Compiled client; registered source handlers; not deployed"};
}
async function childServer(){
  const password=process.env.C1_BROWSER_FIXTURE_PASSWORD;
  assert.ok(password,"Temporary test password is not available to this workflow");
  assert.ok(password.length>=16,"Temporary test password must have at least 16 characters");
  const h=await stage3BHttpFixture(async app=>{
    for(const [file,registration] of [
      ["contacts","registerContactsRoutes"],["crm-operations","registerCrmOperationsRoutes"],
      ["notifications","registerNotificationsRoutes"],["tickets-tasks","registerTicketsTasksRoutes"],
      ["message-drafts","registerMessageDraftRoutes"],["residuals","registerResidualsRoutes"],
      ["analytics","registerAnalyticsRoutes"],["terminal-economics","registerTerminalEconomicsRoutes"],
      ["admin","registerAdminRoutes"],["permissions-audit","registerPermissionsAuditRoutes"],
    ]){
      console.log(`C1 registering ${file}`);
      const module=await import(`../server/routes/${file}.ts`);
      await module[registration](app);
    }
    app.use("/api",(_req,res)=>res.status(501).json({message:"Unregistered isolated candidate service"}));
    const {default:express}=await import("express");
     // Match the real static server's immutable compiled-asset policy. Forcing
     // every hashed JS/CSS chunk to no-store made WAN reload timings measure a
     // fixture-only full bundle download rather than the application behavior.
     app.use("/assets",express.static(path.resolve("dist/public/assets"),{maxAge:"1y",immutable:true}));
    app.use(express.static(path.resolve("dist/public"),{index:false}));
     await installC1CompiledSsrAssets(app);
    const {registerSsrRoutes}=await import("../server/routes/ssr-routes");
    registerSsrRoutes(app);
    app.get(/.*/,(_req,res)=>res.sendFile(path.resolve("dist/public/index.html")));
  },undefined,{interactivePassword:password,emailPrefix:"c1-cloud"});
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1",[h.prefix+"%"]);
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to,email_status)
    SELECT 'C1 Synthetic '||n,'Person',$1||n||'@example.test','','production',$2,'active'
    FROM generate_series(1,61) AS n`,[h.prefix,h.email("agent")]);
   const pendingReadyFile=readyFile+".pending";
   await writeFile(pendingReadyFile,JSON.stringify({base:h.base,isolated:true,syntheticVolume:61,
    sourceHead:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()}),{mode:0o600});
   await rename(pendingReadyFile,readyFile);
  console.log("C1 isolated candidate ready; synthetic accounts; real login; provider transports denied");
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;
    await h.close();await unlink(readyFile).catch(()=>{});
    process.exit(0);
  };
  process.once("SIGTERM",()=>void stop());process.once("SIGINT",()=>void stop());
}

async function launch(){
  const password=process.env.C1_BROWSER_FIXTURE_PASSWORD;
  assert.ok(password,"Temporary test password is not available to this workflow");
  assert.ok(password.length>=16,"Temporary test password must have at least 16 characters");
  await unlink(readyFile).catch(()=>{});
  let target:string|undefined,child:ChildProcess|undefined;
  const proxy=createServer((req,res)=>{
    const host=req.headers.host?.split(":")[0];
    const allowed=[process.env.REPLIT_DEV_DOMAIN,"127.0.0.1","localhost"].filter(Boolean);
    if(!host || !allowed.includes(host)){res.writeHead(403);res.end("Unrecognized preview host");return;}
    res.setHeader("Cache-Control","no-store");
    if(!target){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end("<!doctype html><title>Isolated C1 candidate</title><h1>Preparing the isolated test candidate</h1><p>No production data or services are connected.</p>");return;}
    const upstream=request(new URL(req.url??"/",target),{method:req.method,headers:{
      ...req.headers,"x-forwarded-for":req.socket.remoteAddress??"127.0.0.1",
      "x-forwarded-proto":host===process.env.REPLIT_DEV_DOMAIN?"https":"http",
    }},response=>{
       const compiledAsset=new URL(req.url??"/","http://candidate.invalid").pathname.startsWith("/assets/");
       res.writeHead(response.statusCode??502,{...response.headers,
         "cache-control":compiledAsset?(response.headers["cache-control"]??"no-store"):"no-store"});
      response.pipe(res);
    });
    upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end("Isolated candidate unavailable");});
    req.on("aborted",()=>upstream.destroy());req.pipe(upstream);
  });
  await new Promise<void>((resolve,reject)=>{proxy.once("error",reject);proxy.listen(5000,"0.0.0.0",resolve);});
  const env=buildLocalRehearsalEnvironment();
  const cluster=await launchLocalPostgres16(env);
  let redis:Awaited<ReturnType<typeof launchSfp2060DisposableRedis>>|undefined;
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;target=undefined;proxy.closeAllConnections();
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
    if(child && child.exitCode===null && child.signalCode===null){
      const owned=child;
      await new Promise<void>(resolve=>{
        const timer=setTimeout(()=>owned.kill("SIGKILL"),10000);
        owned.once("exit",()=>{clearTimeout(timer);resolve();});owned.kill("SIGTERM");
      });
    }
    await redis?.stop();await cluster.stop();await unlink(readyFile).catch(()=>{});
  };
  process.once("SIGTERM",()=>{void stop().then(()=>process.exit(0));});
  process.once("SIGINT",()=>{void stop().then(()=>process.exit(0));});
  try{
    // The existing disposable HTTP guard requires this exact namespace.
    const name=`test_sfp2060_c1_cloud_${randomBytes(6).toString("hex")}`,user=os.userInfo().username;
    const admin=new pg.Client({host:cluster.socket.realpath,port:cluster.port,user,database:"postgres"});
    await admin.connect();try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
    redis=await launchSfp2060DisposableRedis(env,{startupTimeoutMs:30000});
    const url=`postgresql://${encodeURIComponent(user)}@localhost/${name}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    Object.assign(env,{DATABASE_URL:url,TEST_DATABASE_URL:url,REDIS_URL:redis.url,TEST_REDIS_PREFIX:redis.prefix,
      PORT:"5000",CERTIFICATION_HTTP_HOST:"127.0.0.1",CERTIFICATION_HTTP_NONCE:randomBytes(32).toString("hex"),
      SESSION_SECRET:randomBytes(32).toString("hex"),CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
      MERCHANT_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),EMAIL_TRANSPORT_FAILFAST:"true",SMS_TRANSPORT_FAILFAST:"true",
      BASE_URL:"http://127.0.0.1:5000",TEST_BASE_URL:"http://127.0.0.1:5000",
      BACKGROUND_JOB_PROFILE:"off",OPENAI_API_KEY:"sfp2060-disposable-constructor-only",AI_INTEGRATIONS_OPENAI_API_KEY:"sfp2060-disposable-constructor-only",
      OPENAI_BASE_URL:"http://127.0.0.1:1/v1",AI_INTEGRATIONS_OPENAI_BASE_URL:"http://127.0.0.1:1/v1"});
    assert.ok(process.env.REPLIT_DEV_DOMAIN,"An owned development preview host is required");
    env.APP_URL=`https://${process.env.REPLIT_DEV_DOMAIN}`;
    env.ADMIN_SEED_EMAIL="c1-cloud-admin@example.test";
    env.ADMIN_SEED_PASSWORD=password;
    assert.ok(isPrivateDisposableGateEnvironment(env),"Private candidate isolation invariants are mandatory");
    const run=async(args:string[],childEnv=env)=>{
      const code=await new Promise<number>((resolve,reject)=>{
        const owned=spawn(process.execPath,[tsx,...args],{env:childEnv,stdio:"inherit"});
        child=owned;owned.once("error",reject);owned.once("exit",code=>resolve(code??1));
      });child=undefined;assert.equal(code,0,"Candidate preparation failed");
    };
    await run(["-e",'import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(()=>{console.error("Private migration failed");process.exit(1);})']);
    if(!process.argv.includes("--reuse-build"))await run(["script/build.ts"],{...env,NODE_ENV:"production",
      ADMIN_SEED_PASSWORD:undefined});
    const build=await verifyReusableBuild();
    await writeFile(path.resolve(".local/tasks/c1-cloud-build.json"),JSON.stringify(build),{mode:0o600});
    child=spawn(process.execPath,[tsx,"scripts/start-stage3-c1-cloud-preview.ts","--serve"],{
      env:{...env,C1_BROWSER_FIXTURE_PASSWORD:password},stdio:"inherit"});
    for(let n=0;n<2400;n++){
      if(child.exitCode!==null)throw new Error("Isolated candidate exited before readiness");
      const ready=JSON.parse(await readFile(readyFile,"utf8").catch(()=>"{}"));
      if(ready.isolated && /^http:\/\/127\.0\.0\.1:\d+$/.test(ready.base)){target=ready.base;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(target,"Isolated candidate readiness unavailable");
    console.log("Authenticated isolated preview available on port 5000; no session injection");
    await new Promise<void>(resolve=>child!.once("exit",()=>resolve()));
  }finally{await stop();}
}
await (process.argv.includes("--serve")?childServer():launch());
