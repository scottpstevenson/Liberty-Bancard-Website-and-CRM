/**
 * Execute the supported stock capability commands against launcher-owned
 * infrastructure. Never reads or copies a customer connection/credential.
 * Failing lanes remain failures; independent lanes still execute.
 */
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { userInfo } from "node:os";
import { writeFile } from "node:fs/promises";
import {
  buildLocalRehearsalEnvironment, launchLocalPostgres16,
  createLocalRehearsalDatabases,
} from "./local-rehearsal-core";
import { launchSfp2060DisposableRedis } from "./sfp2060-disposable-redis";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { spawnCertificationTsx, terminateCertificationChild } from "./certification-child-process";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

let identity = await verifyCandidateIdentity();
const initialIdentity = identity;
const cluster = await launchLocalPostgres16();
let redis: Awaited<ReturnType<typeof launchSfp2060DisposableRedis>> | undefined;
let reservation: Awaited<ReturnType<typeof assertDisposableTestInfrastructure>> | undefined;
const rows: Array<{command: string; exit: number; elapsedMs: number; inputHash: string; outputHash: string}> = [];
const receiptPath = `docs/certification/stage3-c2/supported-lanes${process.argv.includes("--integration-only")?"-integration":""}.json`;
try {
  const targets = await createLocalRehearsalDatabases(cluster, {namePrefix:"test_sfp2060_"});
  redis = await launchSfp2060DisposableRedis(buildLocalRehearsalEnvironment());
  const target = targets.reference;
  const url = `postgresql://${encodeURIComponent(userInfo().username)}@localhost/${target.database}?host=${encodeURIComponent(target.host)}&port=${target.port}`;
  const env = Object.assign(buildLocalRehearsalEnvironment(), {
    NODE_ENV:"test", DATABASE_URL:url, TEST_DATABASE_URL:url,
    REDIS_URL:redis.url, TEST_REDIS_PREFIX:redis.prefix,
    CERTIFICATION_RUN_ID:randomUUID(),
    SESSION_SECRET:randomUUID()+randomUUID(),
    CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
    MERCHANT_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
    ADMIN_SEED_EMAIL:"admin@c2-capability.test",
    ADMIN_SEED_PASSWORD:randomUUID()+randomUUID(),
    RELEASE_SHA:identity.sourceHead,
    BACKGROUND_JOB_PROFILE:"off",
  });
  reservation = await assertDisposableTestInfrastructure({
    operation:"C2 supported capability lanes",requireRedis:true,
    reserveRedisNamespace:true,env,
  });
  const commands = [
    ["scripts/test-dependency-policy-evidence.ts"],
    ["scripts/test-inventory-artifact-dependencies.ts"],
    ["scripts/ci-suite-manifest.ts","--check"],
    ["scripts/run-ci-suites.ts","--capability","deterministic-static"],
    ["scripts/run-ci-suites.ts","--capability","external-security"],
    ["scripts/run-ci-suites.ts","--capability","writable-build"],
    ["scripts/test-certification-process-env.ts"],
    ["scripts/test-certification-provider-deny.ts"],
    ["scripts/test-certification-server-readiness.ts"],
    ["scripts/test-certification-redis-reservation.ts"],
    ["scripts/run-guarded-canonical-migration.ts"],
    ["scripts/run-guarded-canonical-migration.ts"],
    ["scripts/run-ci-suites.ts","--capability","deterministic-integration"],
  ].filter(args=>!process.argv.includes("--integration-only") ||
    args[0]==="scripts/run-guarded-canonical-migration.ts" ||
    args.includes("deterministic-integration"));
  for (const args of commands) {
    const started = performance.now();
    const command = `node node_modules/tsx/dist/cli.mjs ${args.join(" ")}`;
    console.log(`\nC2 supported command: ${command}`);
    const exit = await new Promise<number>((resolve,reject)=>{
      const child = spawn(process.execPath,["node_modules/tsx/dist/cli.mjs",...args],
        {env,stdio:"inherit"});
      child.once("error",reject);
      child.once("exit",code=>resolve(code??1));
    });
    identity = await verifyCandidateIdentity();
    if(identity.inputHash!==initialIdentity.inputHash || identity.sourceHead!==initialIdentity.sourceHead)
      throw new Error("Effective candidate source changed during supported lanes");
    rows.push({command,exit,elapsedMs:Math.round(performance.now()-started),
      inputHash:identity.inputHash,outputHash:identity.outputHash});
    await writeFile(receiptPath,JSON.stringify({
      identity:{sourceHead:identity.sourceHead,inputHash:identity.inputHash,outputHash:identity.outputHash},
      status:rows.some(row=>row.exit!==0)?"failed lanes retained; no readiness waiver":"executed commands passed; not whole-task acceptance",
      infrastructure:"launcher-owned PostgreSQL/Redis; replacement environment; actual stock commands",
      construction:"one private capability database; pre-deploy per-suite clone lane is separate",
      rows,
    },null,2)+"\n");
  }
  // Run the actual server-required capability after proving that this listener
  // is ours. The normal application listener and customer infrastructure are
  // never used, even if they happen to return a successful health response.
  const port = await new Promise<number>((resolve,reject)=>{
    const listener=createServer();
    listener.once("error",reject);
    listener.listen(0,"127.0.0.1",()=>{
      const address=listener.address();
      if(!address || typeof address==="string")return listener.close(()=>reject(new Error("NO_PRIVATE_PORT")));
      listener.close(error=>error?reject(error):resolve(address.port));
    });
  });
  Object.assign(env,{PORT:String(port),BASE_URL:`http://127.0.0.1:${port}`,
    TEST_BASE_URL:`http://127.0.0.1:${port}`,CERTIFICATION_HTTP_HOST:"127.0.0.1",
    CERTIFICATION_HTTP_NONCE:randomBytes(32).toString("hex"),EMAIL_TRANSPORT_FAILFAST:"true",SMS_TRANSPORT_FAILFAST:"true"});
  const server=spawnCertificationTsx("scripts/run-denied-certification-server.ts",[],{sourceEnv:env});
  try{
    let ready=false;
    for(let attempt=0;attempt<120;attempt++){
      if(server.exitCode!==null)throw new Error("Private denied application exited before readiness");
      try{
        const response=await fetch(`${env.BASE_URL}/api/health`,{signal:AbortSignal.timeout(1000)});
        if(response.ok){
          const body=await response.json();
          ready=body.env==="test" && body.ghlTransportFailFast===true &&
            body.certificationHttpNonce===env.CERTIFICATION_HTTP_NONCE &&
            body.certificationHttpListenerAddress==="127.0.0.1" &&
            body.certificationHttpListenerPort===port && body.certificationHttpReusePort===false;
        }
      }catch{/* Bounded startup only; a mismatched listener is never accepted. */}
      if(ready)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error("Private denied application did not prove owned readiness");
    const started=performance.now();
    const command="node node_modules/tsx/dist/cli.mjs scripts/run-ci-suites.ts --capability server-required";
    console.log(`\nC2 supported command: ${command}`);
    const exit=await new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/run-ci-suites.ts","--capability","server-required"],{env,stdio:"inherit"});
      child.once("error",reject);child.once("exit",code=>resolve(code??1));
    });
    identity = await verifyCandidateIdentity();
    if(identity.inputHash!==initialIdentity.inputHash || identity.sourceHead!==initialIdentity.sourceHead)
      throw new Error("Effective candidate source changed during server-required lane");
    rows.push({command,exit,elapsedMs:Math.round(performance.now()-started),
      inputHash:identity.inputHash,outputHash:identity.outputHash});
  }finally{
    await terminateCertificationChild(server);
    await writeFile(receiptPath,JSON.stringify({
      identity:{sourceHead:identity.sourceHead,inputHash:identity.inputHash,outputHash:identity.outputHash},
      status:rows.some(row=>row.exit!==0)?"failed lanes retained; no readiness waiver":"executed commands passed; not whole-task acceptance",
      infrastructure:"launcher-owned PostgreSQL/Redis and nonce-verified denied application; replacement environment",
      rows,
    },null,2)+"\n");
  }
  process.exitCode = rows.some(row=>row.exit!==0)?1:0;
} finally {
  await reservation?.releaseRedisReservation();
  await redis?.stop();
  await cluster.stop();
}
