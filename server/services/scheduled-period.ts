/** Atomic receipts for local database-only periodic effects. Never wrap provider I/O in a retryable callback. */
import {db} from '../db';
import {sql} from 'drizzle-orm';
import {easternDayStart} from '../../shared/conversion-funnel';
export type PeriodTransaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PeriodJob='inbox-maintenance'|'funnel-aggregation';
function retryable(error:any):boolean{
 for(let e=error;e;e=e.cause)if(['40001','40P01'].includes(e.code))return true;
 return false;
}
export async function runScheduledPeriod<T>(job:PeriodJob,period:string,work:(tx:PeriodTransaction)=>Promise<T>,once=true):Promise<{replayed:boolean;value:T|null}>{
 easternDayStart(period); // strict real calendar date, shared IANA-time contract
 if(!['inbox-maintenance','funnel-aggregation'].includes(job))throw Error('PERIOD_JOB_INVALID');
 for(let attempt=0;;attempt++){
  try{return await db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${job+':'+period}))`);
   if(once){
    const receipt=await tx.execute(sql`INSERT INTO scheduled_period_receipts(job_key,period_key) VALUES(${job},${period}::date) ON CONFLICT DO NOTHING RETURNING job_key`);
    if(!receipt.rows.length)return {replayed:true,value:null};
   }
   const value=await work(tx);
   return {replayed:false,value};
  },{isolationLevel:'serializable'});}
  catch(error){if(attempt>=2||!retryable(error))throw error;}
 }
}
