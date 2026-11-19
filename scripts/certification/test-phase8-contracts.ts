import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {nextEasternMidnight,previousEasternDate,createDailyTimer} from '../../shared/daily-schedule';
import {isUsableSenderIdentity,remainingDailyCapacity,effectiveSenderDailyLimit} from '../../shared/sender-identity-state';
import {backupDigest,validateBoundBackup} from '../phase8/legacy-backup';
import {decodeWorkerRuntime,workerObservationLabel} from '../../shared/worker-runtime-state';
let checks=0;const check=(v:unknown,label:string)=>{assert(v,label);checks++;console.log('PASS '+label);};
for(const [input,expected] of [
 ['2026-03-08T05:00:00Z','2026-03-09T04:00:00.000Z'], // 23-hour local day
 ['2026-11-01T04:00:00Z','2026-11-02T05:00:00.000Z'], // 25-hour local day
 ['2026-12-31T23:59:59Z','2027-01-01T05:00:00.000Z'],
 ['2026-11-19T04:59:59Z','2026-11-19T05:00:00.000Z'],
] as const)check(nextEasternMidnight(new Date(input)).toISOString()===expected,'IANA midnight '+input);
check(previousEasternDate(new Date('2026-03-09T04:30:00Z'))==='2026-03-08','Previous aggregation period is a calendar date across short DST day');
let pending=new Map<number,()=>Promise<void>>(),n=0,runs=0,resolveRun:()=>void=()=>{};
const timer=createDailyTimer(async()=>{runs++;await new Promise<void>(r=>{resolveRun=r;});},{now:()=>new Date('2026-11-19T04:59:59Z'),setTimeout:((fn:any)=>{pending.set(++n,fn);return n;}) as any,clearTimeout:((id:number)=>pending.delete(id)) as any});
timer.start();timer.start();check(pending.size===1,'Double start owns one timeout');
const callback=[...pending.values()][0];pending.clear();const inFlight=callback();timer.stop();resolveRun();await inFlight;
check(runs===1&&pending.size===0&&!timer.isRunning(),'Stop during in-flight callback prevents rearming');
timer.start();const stale=[...pending.values()][0];timer.stop();await stale();check(runs===1&&pending.size===0,'Stop invalidates an already queued callback');
timer.start();check(pending.size===1,'Timer can restart after stop');timer.stop();
for(const identity of [{},{isActive:null,warmupStatus:'warm'},{isActive:false,warmupStatus:'warm'},{isActive:true,warmupStatus:null},{isActive:true,warmupStatus:'paused'}])check(!isUsableSenderIdentity(identity),'Unknown/disabled sender state fails closed');
for(const state of ['warm','warming'])check(isUsableSenderIdentity({isActive:true,warmupStatus:state}),'Explicit enabled '+state+' identity usable');
check(remainingDailyCapacity({dailyLimit:3,sentToday:5})===0,'Capacity cannot be negative');
check(effectiveSenderDailyLimit({isActive:true,warmupStatus:'warming',dailyLimit:35,warmupStartedAt:'2026-11-19T00:00:00Z'},new Date('2026-11-19T03:00:00Z'))===5,'Warmup capacity uses native day-zero ceiling');
check(remainingDailyCapacity({isActive:false,warmupStatus:'warm',dailyLimit:35})===0,'Disabled identity never displays usable capacity');
const binding={version:1,purpose:'fixture',sourceSha:'a'.repeat(40),snapshot:{database:'test_sfp2060_fixture',ids:[1,2],content:'approved fixture'}};
const envelope={version:1,generatedAt:new Date().toISOString(),binding,payload:{steps:[]}},digest=backupDigest(envelope);
validateBoundBackup(envelope,binding,digest);check(true,'Exact source/target/content-bound backup accepted');
for(const [badBinding,badDigest,time] of [[{...binding,sourceSha:'b'.repeat(40)},digest,Date.now()],[{...binding,snapshot:{...binding.snapshot,ids:[1,3]}},digest,Date.now()],[{...binding,snapshot:{...binding.snapshot,database:'neondb'}},digest,Date.now()],[binding,'0'.repeat(64),Date.now()],[binding,digest,Date.now()+86400001]] as any[]){
 assert.throws(()=>validateBoundBackup(envelope,badBinding,badDigest,time));check(true,'Backup rejects drift/wrong target/digest/expired timestamp');
}
const manifest=JSON.parse(readFileSync('docs/certification/phase8/archive-manifest.json','utf8'));
const {createHash}=await import('node:crypto');
for(const item of manifest){if(item.archivePath){check(existsSync(item.archivePath)&&createHash('sha256').update(readFileSync(item.archivePath)).digest('hex')===item.sha256,'Archived bytes recover '+item.originalPath);}else check(!existsSync(item.originalPath)&&!!item.restoreSource,'Completed unused script removed with Git restore source');}
const observation={queueName:'fixture',expectedSelected:true,workerActive:true,stale:false,lastSeenAt:null,freshnessModel:'interval',backlogAvailable:true,queuePaused:false};
const runtime={asOf:new Date().toISOString(),backgroundProfile:'off',selectedGroups:[],pauseReason:{state:'paused'},heartbeats:[observation]};
check(!!decodeWorkerRuntime(runtime),'Complete runtime DTO accepted');
for(const value of [null,{}, {...runtime,asOf:'invalid'}, {...runtime,heartbeats:[{...observation,queuePaused:'false'}]}, {...runtime,heartbeats:[{...observation,workerActive:undefined}]}])check(decodeWorkerRuntime(value)===null,'Partial/malformed runtime is unavailable');
for(const [delta,label] of [[{expectedSelected:false},'Not selected'],[{workerActive:false},'Selected, not ready'],[{backlogAvailable:false},'Queue unavailable'],[{queuePaused:true},'Queue paused'],[{stale:true},'Heartbeat stale'],[{},'Awaiting heartbeat']] as const)check(workerObservationLabel({...observation,...delta})===label,'Runtime state '+label);
console.log(`PHASE8_CONTRACTS_PASS ${checks}`);
