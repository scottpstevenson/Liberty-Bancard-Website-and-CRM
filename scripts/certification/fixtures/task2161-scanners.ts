import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync,existsSync,mkdtempSync,cpSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
export function verifyDiscoveryScanners(){
 const root=mkdtempSync(path.join(os.tmpdir(),'task2161-scanner-workspace-'));
 try{
 for(const name of ['server','shared','scripts','migrations','.github'])cpSync(name,path.join(root,name),{recursive:true});
 mkdirSync(path.join(root,'client'));cpSync('client/src',path.join(root,'client/src'),{recursive:true});
 for(const name of ['package.json','tsconfig.json'])cpSync(name,path.join(root,name));
 symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),'dir');
 const mutation=path.join(root,'server/services/__task2161_unmanaged_fixture.ts');const roster=path.join(root,'scripts/pre-deploy.ts');
 assert(!existsSync(mutation),'Mutation fixture path must be exclusively owned');
 const original=readFileSync(roster,'utf8');
 const run=(script:string,args:string[]=[])=>spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',script,...args],{encoding:'utf8',env:process.env,cwd:root,timeout:120000});
 try{
  writeFileSync(mutation,"export const unmanaged = () => fetch('https://api.outscraper.com/google-maps-search');\n",{flag:'wx'});
  let result=run('scripts/scan-paid-provider-adapters.ts');assert.notEqual(result.status,0);assert.match(result.stderr,/__task2161_unmanaged_fixture/);
  writeFileSync(mutation,"export async function unmanaged(){return performOutscraperSearch({query:'fixture'});}\n");
  result=run('scripts/scan-paid-provider-adapters.ts');assert.notEqual(result.status,0);assert.match(result.stderr,/outside canonical manifest/);
  // The same guard is an actual mandatory pre-deploy suite, not an advisory extra.
  assert.match(original,/script:\s*["']scripts\/scan-paid-provider-adapters.ts["']/);
  writeFileSync(roster,original.replace('export const MANDATORY_SUITES: Suite[] = [','export const MANDATORY_SUITES: Suite[] = [\n{name:"Unmanaged fixture",script:"server/services/__task2161_unmanaged_fixture.ts",timeoutSecs:30},'));
  result=run('scripts/ci-suite-manifest.ts',['--check']);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/__task2161_unmanaged_fixture/);
 }finally{writeFileSync(roster,original);if(existsSync(mutation))unlinkSync(mutation);}
 const clean=run('scripts/scan-paid-provider-adapters.ts');assert.equal(clean.status,0,clean.stderr);
 const manifest=run('scripts/ci-suite-manifest.ts',['--check']);assert.equal(manifest.status,0,manifest.stdout+manifest.stderr);
 console.log('PASS TASK2161_SCANNER_MUTATIONS_PASS unmanagedUrl=true unmanagedWrapper=true mandatoryUnclassified=true restored=true');
 }finally{rmSync(root,{recursive:true,force:true});}
}
