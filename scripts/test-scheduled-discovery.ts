import assert from 'node:assert/strict';
import {assertDisposableTestInfrastructure} from './test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from './certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Task 2161 contracts'});applyCertificationProviderDenyBoundary({fatal:true});
process.env.OUTSCRAPER_API_KEY='task2161-disposable-only';
const {performOutscraperSearch,performOutscraperTaskResults}=await import('../server/services/sdr/outscraper');
const {decideOrganizationIdentity}=await import('../server/services/organization-resolution-policy');
const {normalizeDiscoveryRow}=await import('../server/services/scheduled-discovery/policy');
const {isQueueSelectedByBackgroundProfile}=await import('../server/services/background-profile');
let checks=0;const check=(v:unknown,m:string)=>{assert(v,m);checks++;};
const signal=async()=>{};
const exchange=(status:number,body:unknown)=>({fetchImpl:(async()=>new Response(status===204?null:typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}})) as typeof fetch,recordCreditSignal:signal});
try{
 for(const [status,body] of [[202,{}],[200,'not JSON'],[200,{}]] as const){await assert.rejects(performOutscraperSearch({query:'dentist in Miami',async:true,resultLimit:100},exchange(status,body)),/UNVERIFIABLE/);checks++;}
 for(const body of ['not JSON',{}, {id:'fixture-id',status:'Success'}]){await assert.rejects(performOutscraperTaskResults('fixture-id',exchange(200,body)),/UNVERIFIABLE/);checks++;}
 const failure=await performOutscraperTaskResults('fixture-id',exchange(204,null));check(!failure.ok&&failure.task?.state==='failed','T07 204 is terminal failure');
 const zero=await performOutscraperTaskResults('fixture-id',exchange(200,{id:'fixture-id',status:'Success',data:[[]]}));check(zero.ok&&zero.consideredResultCount===0&&!zero.task?.state.includes('pending'),'T07 explicit zero-result success');
 let path='';await performOutscraperSearch({query:'dentist in Miami',async:true,resultLimit:100,endpointVersion:'google-maps-v2'},
  {fetchImpl:(async(url)=>{path=String(url);return new Response(JSON.stringify({id:'safe-id',status:'Pending'}));}) as typeof fetch,recordCreditSignal:signal});
 check(new URL(path).pathname==='/google-maps-search'&&new URL(path).searchParams.get('limit')==='100','T15 explicit versioned endpoint and result bound');
 const response=await performOutscraperSearch({query:'a',resultLimit:1},exchange(200,{status:'Success',data:[[{name:'A',google_id:'google-not-place'}]]}));
 check(response.results[0].placeId===null,'T06 google_id never relabels place_id');
 const base={id:1,canonicalName:'Alpha Dental LLC',googlePlaceId:'place',websiteDomain:'alpha.example',mainPhone:'3055550123',city:'Miami',state:'FL',streetAddress:'123 Main St'};
 const policy={...base,matchingPolicy:'scheduled-discovery-v1' as const};
 check(decideOrganizationIdentity({...policy,canonicalName:'New display name'},[base]).kind==='matched','T05 exact place accepts display-name change');
 check(decideOrganizationIdentity({...policy,googlePlaceId:null,canonicalName:'New display name',streetAddress:null},[base]).kind==='matched','T05 unique domain tolerates missing secondary metadata');
 check(decideOrganizationIdentity({...policy,googlePlaceId:null,websiteDomain:null,mainPhone:'(305) 555-0123'},[base]).kind==='matched','T05 phone formatting');
 check(decideOrganizationIdentity({...policy,googlePlaceId:null,websiteDomain:null,mainPhone:null,canonicalName:'Alpha Dental Inc'},[base]).kind==='matched','T05 suffix-insensitive name with precise address');
 check(decideOrganizationIdentity({...policy,canonicalName:'Display changed',matchingPolicy:undefined},[base]).kind==='deferred','T10 default manual policy unchanged');
 check(decideOrganizationIdentity({...policy,googlePlaceId:'different',city:'Fort Lauderdale',streetAddress:'567 Other St'},[base]).kind==='create','T05 separate branch stays distinct');
 check(decideOrganizationIdentity({canonicalName:'Unknown',city:'Miami',state:'FL',matchingPolicy:'scheduled-discovery-v1'},[]).kind==='deferred','T05 name alone remains unresolved');
 check(decideOrganizationIdentity(policy,[base,{...base,id:2,googlePlaceId:'place'}]).kind==='deferred','T05 indistinguishable owned IDs held');
 const row=normalizeDiscoveryRow({name:'A dentist',type:'dentist',site:'https://dentist.example',full_address:'123 Main St',city:'Miami',state:'Florida',postal_code:'33130',place_id:'place',google_id:'google',emails:['one@example.test','two@example.test']},{county_fips:['12086'],vertical_ids:['Healthcare']});
 check(row.state==='eligible'&&row.mapped.website==='https://dentist.example'&&row.mapped.address==='123 Main St','T06 API website/address survive explicit mapping and real scope');
 check(row.mapped.email_1!==row.mapped.email_2&&!!row.mapped.email_2,'T06 all emails retained');
 check(normalizeDiscoveryRow({...row.raw,state:'GA',city:'Atlanta',postal_code:'30301'},{county_fips:['12086'],vertical_ids:['Healthcare']}).state==='out_of_scope','T09 query labels cannot manufacture location');
 const named=normalizeDiscoveryRow({...row.raw,contacts:[{name:'Pat Jones',title:'Owner',emails:['pat@example.test','pat.other@example.test']}],emails:[]},{county_fips:['12086'],vertical_ids:['Healthcare']});
 check(named.mapped.email_1==='pat@example.test'&&named.mapped.email_2==='pat.other@example.test'&&named.mapped.email_1_full_name==='Pat Jones'&&named.mapped.email_2_title==='Owner','T06 nested contacts preserve all names, titles and mailboxes');
 check(normalizeDiscoveryRow(row.raw,{county_fips:['12086'],vertical_ids:['Healthcare'],definition_county_fips:'12011'}).state==='out_of_scope','T09 returned county must match the definition');
 check(normalizeDiscoveryRow(row.raw,{county_fips:['12086'],vertical_ids:['Healthcare'],area_type:'zip',area_key:'33301'}).state==='out_of_scope','T09 returned ZIP must match the exact slice');
 check(decideOrganizationIdentity({...policy,canonicalName:'Updated display',city:'Updated locality',streetAddress:null},[base]).kind==='matched','T05 uniquely owned place survives changed weak metadata');
 check(decideOrganizationIdentity({...policy,googlePlaceId:'PLACE'},[base]).kind!=='matched','T05 opaque place IDs remain case-sensitive');
 const googleSource={sourceSystem:'outscraper',sourceType:'google_id',stableKey:'opaque-google-id'};
 check(decideOrganizationIdentity({canonicalName:'Updated source name',matchingPolicy:'scheduled-discovery-v1',sourceIdentity:googleSource},[{id:1,canonicalName:'Original',sourceIdentity:googleSource}]).kind==='matched','T08 overlay and persisted resolver share exact source-namespace identity');
 const conflicts=[{...base,id:1,websiteDomain:'alpha.example',googlePlaceId:null},{...base,id:2,websiteDomain:'other.example',mainPhone:'3055550999',googlePlaceId:'place'}];
 check(decideOrganizationIdentity({...policy,mainPhone:null},conflicts).kind==='deferred','T05 competing owned domain and place stay held');
 check(decideOrganizationIdentity({...policy,googlePlaceId:null,websiteDomain:null,mainPhone:'+1 (305) 555-0123'},[base]).kind==='matched','T05 US country prefix normalizes consistently');
 check(decideOrganizationIdentity({...policy,googlePlaceId:null,websiteDomain:null,mainPhone:null,streetAddress:null},[base]).kind==='deferred','T05 name and city alone cannot merge');
 const previous=process.env.BACKGROUND_JOB_PROFILE;process.env.BACKGROUND_JOB_PROFILE='selective:scheduled-discovery';
 check(isQueueSelectedByBackgroundProfile('scheduled-discovery')&&!isQueueSelectedByBackgroundProfile('sfp-continuous-discovery')&&!isQueueSelectedByBackgroundProfile('sequences'),'T15 narrow worker capability');process.env.BACKGROUND_JOB_PROFILE=previous;
 const {selectMandatorySuites}=await import('./pre-deploy');
 for(const script of ['scripts/test-scheduled-discovery.ts','scripts/certification/test-scheduled-discovery.ts','scripts/test-sfp-paid-waterfall-apollo-outscraper.ts','scripts/test-sfp-validation-handoff-repair-certification.ts'])check(selectMandatorySuites(['--only',script]).suites.length===1,'T14 exact mandatory fixture selection is unambiguous');
 assert.throws(()=>selectMandatorySuites(['--only','duplicate'],[{name:'one',script:'duplicate',timeoutSecs:1},{name:'two',script:'duplicate',timeoutSecs:1}]),/Ambiguous/);checks++;
 const {verifyDiscoveryScanners}=await import('./certification/fixtures/task2161-scanners');verifyDiscoveryScanners();checks++;
 check(getBlockedCertificationNetworkAttemptCount()===0,'No real provider/network calls');
 console.log(`PASS TASK2161_CONTRACTS_PASS ${checks}`);
}finally{const {pool}=await import('../server/db');await pool.end();}

process.exit(0);
