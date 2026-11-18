/** Private local acceptance preview. Never inherits an application/provider credential or DB URL. */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {buildLocalRehearsalEnvironment,launchLocalPostgres16} from './local-rehearsal-core';
import {launchSfp2060DisposableRedis} from './sfp2060-disposable-redis';
const cluster=await launchLocalPostgres16();
const env=buildLocalRehearsalEnvironment({PORT:'5188',APP_URL:'http://127.0.0.1:5188',BACKGROUND_JOB_PROFILE:'off',CRO03_PROVIDER_TRANSPORT_ENABLED:'false',CERTIFICATION_HTTP_HOST:'127.0.0.1',CERTIFICATION_HTTP_NONCE:randomBytes(32).toString('hex')});
env.SESSION_SECRET=randomBytes(32).toString('hex');env.MERCHANT_DATA_ENCRYPTION_KEY=randomBytes(32).toString('hex');
env.ADMIN_SEED_EMAIL='task2161-admin@liberty.test';env.ADMIN_SEED_PASSWORD=`local-${randomBytes(18).toString('hex')}`;
const redis=await launchSfp2060DisposableRedis(env);env.REDIS_URL=redis.url;env.TEST_REDIS_URL=redis.url;env.TEST_REDIS_PREFIX=redis.prefix;
const client=new pg.Client({host:cluster.socket.realpath,port:cluster.port,user:os.userInfo().username,database:'postgres'});await client.connect();
await client.query('CREATE DATABASE test_sfp2060_task2161_preview');await client.end();
env.DATABASE_URL=`postgresql://${os.userInfo().username}@localhost/test_sfp2060_task2161_preview?host=${encodeURIComponent(cluster.root+'/socket')}&port=${cluster.port}`;env.TEST_DATABASE_URL=env.DATABASE_URL;
const root=`${os.homedir()}/.local/share/liberty-dev/task2161`;await mkdir(root,{recursive:true,mode:0o700});await writeFile(`${root}/preview-environment.json`,JSON.stringify(env),{mode:0o600});
const run=(script:string)=>new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',script],{env,stdio:'inherit'});child.once('error',reject);child.once('exit',c=>resolve(c??1));});
try{
 if(await run('scripts/migrate.ts'))throw new Error('PREVIEW_MIGRATION_FAILED');
 const db=new pg.Client({connectionString:env.DATABASE_URL});await db.connect();
 const hash=await bcrypt.hash(env.ADMIN_SEED_PASSWORD!,12);
 for(const role of ['admin','manager'])await db.query("INSERT INTO users(id,email,first_name,last_name,role,password_hash,auth_provider) VALUES($1,$2,'Task2161','Local Acceptance',$3,$4,'local')",[`task2161-preview-${role}`,`task2161-${role}@liberty.test`,role,hash]);
 await db.query("INSERT INTO outbound_pause_control(id,state,reason,actor) VALUES(1,'paused','Private local acceptance','task2161-preview') ON CONFLICT(id) DO UPDATE SET state='paused'");
 await db.query("INSERT INTO system_settings(key,value) VALUES('outboundGlobalPaused','true') ON CONFLICT(key) DO UPDATE SET value='true'");
 await db.query(`INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
 VALUES('Task2161 private acceptance',ARRAY['12011','12086','12099'],ARRAY['Automotive','Healthcare','Beauty/Spa','Construction/Trades/Home Services','Fitness/Recreation'],2,true,'task2161-local')`);await db.end();
 if(await run('scripts/task2161-preview-fixture.ts'))throw new Error('PREVIEW_FIXTURE_FAILED');
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/task2161-preview-entry.ts'],{env,stdio:'inherit'});
 const cleanup=async()=>{child.kill('SIGTERM');await redis.stop();await cluster.stop();process.exit(0);};
 process.once('SIGINT',()=>void cleanup());process.once('SIGTERM',()=>void cleanup());
 await new Promise<void>(resolve=>child.once('exit',()=>resolve()));
}finally{await redis.stop();await cluster.stop();}
