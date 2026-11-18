/** Isolated Postgres/Redis runtime. Every suite receives its own migrated DB and no inherited provider credentials. */
import {spawn} from 'node:child_process';
import pg from 'pg';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {buildLocalRehearsalEnvironment,launchLocalPostgres16} from './local-rehearsal-core';
import {launchSfp2060DisposableRedis} from './sfp2060-disposable-redis';
const run=(script:string,env:NodeJS.ProcessEnv,args:string[]=[])=>new Promise<number>((resolve,reject)=>{
 const forceAfterModule=script.endsWith('test-scheduled-discovery.ts')||script.endsWith('test-canonical-provider-import.ts')||script.includes('test-provider-upload-')||script.endsWith('test-sfp-provider-contracts.ts')||script.endsWith('test-cro03c-provider-manifest-coverage.ts');
 const p=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',...(forceAfterModule?['scripts/task2161-suite-entry.ts',script]:[script]),...args],{env,stdio:'inherit'});p.on('error',reject);p.on('exit',c=>resolve(c??1));
});
const cluster=await launchLocalPostgres16();let admin:pg.Client|undefined;let redis:Awaited<ReturnType<typeof launchSfp2060DisposableRedis>>|undefined;
try{
 const env=buildLocalRehearsalEnvironment({NODE_ENV:'test',BACKGROUND_JOB_PROFILE:'off',CRO03_PROVIDER_TRANSPORT_ENABLED:'true',VG_PROVIDER_DENY_MODE:'1',GHL_TRANSPORT_FAILFAST:'true',EMAIL_TRANSPORT_FAILFAST:'true',SMS_TRANSPORT_FAILFAST:'true'});
 env.SESSION_SECRET='task2161-isolated-test-secret-never-production';
 env.MERCHANT_DATA_ENCRYPTION_KEY='task2161-disposable-encryption-key-never-production';
 redis=await launchSfp2060DisposableRedis(env);env.REDIS_URL=redis.url;env.TEST_REDIS_URL=redis.url;env.TEST_REDIS_PREFIX=redis.prefix;
 admin=new pg.Client({host:cluster.socket.realpath,port:cluster.port,user:os.userInfo().username,database:'postgres'});await admin.connect();
 const args=process.argv.slice(2);const suites=args.length?args:['scripts/test-scheduled-discovery.ts','scripts/certification/test-scheduled-discovery.ts'];
 const failures:string[]=[];
 for(const script of suites){
  if(!/^scripts\/[a-zA-Z0-9_./-]+\.ts$/.test(script)||script.includes('..'))throw new Error('INVALID_SUITE_PATH');
  const name=`test_sfp2060_task2161_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url=`postgresql://${os.userInfo().username}@localhost/${name}?host=${encodeURIComponent(cluster.root+'/socket')}&port=${cluster.port}`;
  const childEnv={...env,DATABASE_URL:url,TEST_DATABASE_URL:url};
  if(script.endsWith('test-retained-canonical-import-recovery.ts'))Object.assign(childEnv,{SFP_PUBLISH_BUILD_ID:randomUUID(),SFP_PUBLISH_ARTIFACT_SHA:'e'.repeat(40),RELEASE_SHA:'e'.repeat(40),SFP_PUBLISH_BUILT_AT:new Date().toISOString()});
  if(await run('scripts/migrate.ts',childEnv))throw new Error('TASK2161_MIGRATION_FAILED');
  console.log(`TASK2161_SUITE ${script}`);
  const phases=script.endsWith('test-retained-canonical-import-recovery.ts')?['faults','restart','legacy','budget']:[''];
  for(const phase of phases){const code=await run(script,childEnv,phase?[phase]:[]);console.log(`TASK2161_SUITE_RESULT ${script} ${phase} exit=${code}`);if(code){failures.push(`${script}:${phase}`);break;}}
 }
 console.log('TASK2161_RUN_RESULT',JSON.stringify({failures}));if(failures.length)process.exitCode=1;
 await admin.end();admin=undefined;
}finally{await admin?.end();await redis?.stop();await cluster.stop();}
