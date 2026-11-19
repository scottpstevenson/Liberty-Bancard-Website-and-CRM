import {easternDate,easternDayStart,nextDate} from './conversion-funnel';
export function previousEasternDate(now=new Date()):string{return new Date(Date.parse(easternDate(now)+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
/** Midnight uses IANA dates: a local day may contain 23, 24 or 25 hours. */
export function nextEasternMidnight(now=new Date()):Date{return easternDayStart(nextDate(easternDate(now)));}
export interface DailyTimer {start():void;stop():void;isRunning():boolean}
/** One owned timeout, including across async callbacks. Stop invalidates already queued callbacks. */
export function createDailyTimer(run:()=>Promise<unknown>,options:{now?:()=>Date;setTimeout?:typeof setTimeout;clearTimeout?:typeof clearTimeout;onError?:(e:unknown)=>void}={}):DailyTimer{
 const now=options.now??(()=>new Date()),schedule=options.setTimeout??setTimeout,cancel=options.clearTimeout??clearTimeout;
 let handle:ReturnType<typeof setTimeout>|null=null,running=false,generation=0;
 const arm=(token:number)=>{
  if(!running||token!==generation)return;
  handle=schedule(async()=>{
   handle=null;if(!running||token!==generation)return;
   try{await run();}catch(e){options.onError?.(e);}finally{arm(token);}
  },Math.max(1,nextEasternMidnight(now()).getTime()-now().getTime()));
  handle.unref?.();
 };
 return {start(){if(running)return;running=true;arm(++generation);},stop(){running=false;generation++;if(handle!==null)cancel(handle);handle=null;},isRunning(){return running;}};
}
