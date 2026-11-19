/** Historical content tools are disposable-fixture utilities, never a production content writer. */
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {sql} from 'drizzle-orm';
type Executor={execute:(query:any)=>Promise<any>};
const canonical=(value:any):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
export const backupDigest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type BackupPurpose='vertical-template'|'sdr-campaign';
function purpose():BackupPurpose{
 const value=process.argv.find(a=>a.startsWith('--purpose='))?.slice(10)??'vertical-template';
 if(!['vertical-template','sdr-campaign'].includes(value))throw Error('BACKUP_PURPOSE_INVALID');return value as BackupPurpose;
}
export async function currentBackupBinding(executor:Executor,kind:BackupPurpose=purpose()){
 const query=await executor.execute(sql`SELECT current_database() AS database,inet_server_addr()::text AS server,inet_server_port() AS port,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM follow_up_sequences s) AS sequences,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM sequence_steps s) AS sequence_steps,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM campaigns s) AS campaigns,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM campaign_steps s) AS campaign_steps`);
 return {version:1,purpose:kind,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceFiles: Object.fromEntries(["scripts/backfill-templates-dryrun.ts","scripts/backfill-templates-apply.ts","scripts/backfill-sdr-campaigns.ts","scripts/phase8/legacy-backup.ts","server/services/vertical-email-sms-templates.ts","shared/schema.ts","package-lock.json"].map(file=>[file,createHash("sha256").update(fs.readFileSync(file)).digest("hex")])),
  options:{includeActive:process.argv.includes('--include-active'),force:process.argv.includes('--force')},snapshot:query.rows[0]};
}
export function validateBoundBackup(envelope:any,binding:unknown,expectedDigest:string,now=Date.now()){
 if(!/^[0-9a-f]{64}$/.test(expectedDigest)||backupDigest(envelope)!==expectedDigest)throw Error('BACKUP_DIGEST_MISMATCH');
 if(envelope?.version!==1||!envelope.generatedAt||!envelope.binding)throw Error('BACKUP_ENVELOPE_INVALID');
 const age=now-Date.parse(envelope.generatedAt);
 if(!Number.isFinite(age)||age< -60000||age>86400000)throw Error('BACKUP_EXPIRED');
 if(backupDigest(envelope.binding)!==backupDigest(binding))throw Error('BACKUP_TARGET_SOURCE_OR_CONTENT_CHANGED');
}
export function retainBoundBackup(binding:unknown,payload:unknown){
 const directory=path.resolve('generated-artifacts/legacy-backups');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const envelope={version:1,generatedAt:new Date().toISOString(),binding,payload};const file=path.join(directory,randomUUID()+'.json');
 fs.writeFileSync(file,canonical(envelope)+'\n',{flag:'wx',mode:0o600});return {file,digest:backupDigest(envelope)};
}
export async function requireBoundBackup(executor:Executor,kind:BackupPurpose){
 const file=process.argv.find(a=>a.startsWith('--backup='))?.slice(9),digest=process.argv.find(a=>a.startsWith('--sha256='))?.slice(9);
 if(!file||!digest)throw Error('EXACT_BACKUP_AND_SHA256_REQUIRED');
 const resolved=path.resolve(file),root=path.resolve('generated-artifacts/legacy-backups')+path.sep;
 if(!resolved.startsWith(root))throw Error('BACKUP_LOCATION_INVALID');
 const stat=fs.lstatSync(resolved);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('BACKUP_FILE_INVALID');
 const envelope=JSON.parse(fs.readFileSync(resolved,'utf8'));
 validateBoundBackup(envelope,await currentBackupBinding(executor,kind),digest);
}
