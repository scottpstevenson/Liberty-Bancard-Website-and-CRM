import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {userInfo} from "node:os";
import {buildLocalRehearsalEnvironment,launchLocalPostgres16,withLocalClient} from "./local-rehearsal-core";

const input=process.argv[2];
if(!input || !existsSync(input))throw new Error("RETAINED_INPUT_DIRECTORY_REQUIRED");
const cluster=await launchLocalPostgres16();
const env=buildLocalRehearsalEnvironment({NODE_ENV:"test",VG_PROVIDER_DENY_MODE:"1",
  BACKGROUND_JOB_PROFILE:"off",GHL_TRANSPORT_FAILFAST:"true",EMAIL_TRANSPORT_FAILFAST:"true",
  SMS_TRANSPORT_FAILFAST:"true",CREDENTIAL_ENCRYPTION_KEY:"retained-disposable-only",
  MERCHANT_DATA_ENCRYPTION_KEY:"retained-disposable-only",RETAINED_INPUT_DIR:input,
  XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME || "/tmp"});
const build=randomUUID();
Object.assign(env,{SFP_PUBLISH_BUILD_ID:build,SFP_PUBLISH_ARTIFACT_SHA:"e".repeat(40),
  RELEASE_SHA:"e".repeat(40),SFP_PUBLISH_BUILT_AT:new Date().toISOString()});
async function run(args:string[]){
  const code=await new Promise<number>((resolve,reject)=>{
    const child=spawn("npx",["tsx",...args],{env,stdio:"inherit"});
    child.on("error",reject);child.on("exit",code=>resolve(code ?? 1));
  });
  if(code!==0)throw new Error(`RETAINED_CERTIFICATION_FAILED:${args[0]}:${code}`);
}
function point(database:string){
  const url=`postgresql://${encodeURIComponent(userInfo().username)}@localhost/${database}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
  env.DATABASE_URL=url;env.TEST_DATABASE_URL=url;
}
try {
  await withLocalClient(cluster.admin,client=>client.query('CREATE DATABASE "test_retained_template"'));
  point("test_retained_template");
  await run(["scripts/migrate.ts"]);
  for(const [database,script] of [
    ["test_retained_publish","scripts/test-sfp-publish-handoff-disposable.ts"],
    ["test_retained_workbook","scripts/certification/test-canonical-workbook-intake.ts"],
    ["test_retained_leases","scripts/certification/test-canonical-transaction-leases.ts"],
  ]){
    if(process.argv.includes("--core-only"))continue;
    if(process.argv.includes("--skip-workbooks") && database==="test_retained_workbook")continue;
    await withLocalClient(cluster.admin,client=>client.query(`CREATE DATABASE "${database}" TEMPLATE "test_retained_template"`));
    point(database);
    if(database==="test_retained_leases")env.DB_POOL_MAX="1";
    await run([script]);
    delete env.DB_POOL_MAX;
  }
  await withLocalClient(cluster.admin,client=>client.query('CREATE DATABASE "test_retained_workload" TEMPLATE "test_retained_template"'));
  point("test_retained_workload");
  for(const phase of ["faults","restart","legacy","budget","seed","recover","replay"]){
    console.log(`RETAINED_CERTIFICATION_PHASE ${phase}`);
    await run(["scripts/certification/test-retained-canonical-import-recovery.ts",phase]);
  }
  console.log("RETAINED_CANONICAL_IMPORT_CERTIFICATION_PASS");
}finally{
  await cluster.stop();
  console.log("RETAINED_DISPOSABLE_CLUSTER_DESTROYED");
}
