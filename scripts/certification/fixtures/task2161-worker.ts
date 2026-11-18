/** Test process boundary, not a production worker or network endpoint. */
import pg from 'pg';
import {assertDisposableTestInfrastructure} from '../../test-infrastructure-guard';
import {applyCertificationProviderDenyBoundary} from '../../certification-provider-deny';
await assertDisposableTestInfrastructure({operation:'Task2161 restart worker',requireRedis:true});
applyCertificationProviderDenyBoundary({fatal:true});process.env.OUTSCRAPER_API_KEY='task2161-disposable-only';
if(process.env.TASK2161_CRASH_POINT==='mid-import'){
 const original=pg.Client.prototype.query;let contactInserted=false;
 (pg.Client.prototype.query as any)=function(...args:any[]){
  const text=typeof args[0]==='string'?args[0]:args[0]?.text;const result=(original as any).apply(this,args);
  if(!result?.then)return result;
  return result.then((value:any)=>{if(/insert into \"?contacts\"?\s/i.test(text??''))contactInserted=true;
   if(contactInserted&&/^COMMIT\b/i.test(text??''))process.exit(74);return value;});
 };
}
const {pool}=await import('../../../server/db');
const {processDiscoveryTick}=await import('../../../server/services/scheduled-discovery/service');
const mode=process.env.TASK2161_CRASH_POINT;
try{
 await processDiscoveryTick({
  afterReservation:async()=>{if(mode==='before-dispatch')process.exit(71);},
  afterTaskId:async()=>{if(mode==='after-id')process.exit(73);},
  fetchImpl:(async(url:any)=>{
   const u=new URL(String(url));
   if(u.pathname==='/google-maps-search'){
    await pool.query("INSERT INTO task2161_fake_requests(path) VALUES($1)",[u.pathname]);
    if(mode==='accepted-before-id')process.exit(72);
    return new Response(JSON.stringify({id:`restart-${process.pid}`,status:'Pending'}),{status:202});
   }
   if(!/^\/requests\/restart-\d+$/.test(u.pathname))throw new Error('UNEXPECTED_FAKE_ENDPOINT');
   await pool.query("INSERT INTO task2161_fake_requests(path) VALUES($1)",[u.pathname]);
   return new Response(JSON.stringify({id:u.pathname.split('/').at(-1),status:'Success',data:[[]]}));
  }) as typeof fetch,
 });
}finally{await pool.end();}
process.exit(0);
