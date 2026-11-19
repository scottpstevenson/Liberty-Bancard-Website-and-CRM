import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {assertDisposableTestInfrastructure} from '../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary} from '../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Phase8 historical backup CLI acceptance'});
applyCertificationProviderDenyBoundary({fatal:true});
const {pool}=await import('../../server/db');
const run=(file:string,args:string[]=[])=>new Promise<{code:number|null;output:string}>(resolve=>{let output='';const p=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',file,...args],{env:process.env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('exit',code=>resolve({code,output}));});
let checks=0;const check=(v:unknown,label:string)=>{assert(v,label);console.log('PASS '+label);checks++;};
try{
 const dry=await run('scripts/backfill-templates-dryrun.ts');assert.equal(dry.code,0,dry.output);
 const [,file,digest]=dry.output.match(/Bound fixture backup: (.+)\nSHA256: ([a-f0-9]{64})/)!;
 check(fs.statSync(file).isFile(),'Actual dry-run retains exact private backup');
 const args=[`--backup=${file}`,`--sha256=${digest}`];
 const apply=await run('scripts/backfill-templates-apply.ts',args);assert.equal(apply.code,0,apply.output);check(true,'Actual matching backup passes the historical apply CLI');
 const bad=await run('scripts/backfill-templates-apply.ts',[`--backup=${file}`,'--sha256='+ '0'.repeat(64)]);check(bad.code!==0&&bad.output.includes('BACKUP_DIGEST_MISMATCH'),'Wrong digest rejected by actual CLI');
 await pool.query("INSERT INTO follow_up_sequences(name,status) VALUES('Phase8 provenance drift','draft')");
 const drift=await run('scripts/backfill-templates-apply.ts',args);check(drift.code!==0&&drift.output.includes('BACKUP_TARGET_SOURCE_OR_CONTENT_CHANGED'),'Persisted content drift refuses actual apply');
 const missing=await run('scripts/backfill-templates-apply.ts');check(missing.code!==0&&missing.output.includes('EXACT_BACKUP_AND_SHA256_REQUIRED'),'Historical glob cannot substitute for exact backup');
 fs.unlinkSync(file);
 console.log(`PHASE8_BACKUP_PASS ${checks}`);
}finally{await pool.end();}
