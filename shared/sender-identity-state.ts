/** Same explicit eligibility as inbox selection; configuration alone never authorizes a send. */
export interface SenderIdentityLike {
 isActive?:boolean|null;warmupStatus?:string|null;dailyLimit?:number|null;sentToday?:number|null;counterDate?:string|null;warmupStartedAt?:Date|string|null;
}
export const SENDABLE_WARMUP_STATES=['warm','warming'] as const;
export function isUsableSenderIdentity(identity:SenderIdentityLike):boolean{
 return identity.isActive===true&&SENDABLE_WARMUP_STATES.includes(identity.warmupStatus as typeof SENDABLE_WARMUP_STATES[number]);
}
/** Same warmup and hard ceiling used by the native inbox reservation. */
export function effectiveSenderDailyLimit(identity:SenderIdentityLike,now=new Date()):number{
 if(!isUsableSenderIdentity(identity))return 0;
 const configured=Math.max(0,Math.min(identity.dailyLimit||30,35));
 if(identity.warmupStatus==='warm')return configured;
 const started=identity.warmupStartedAt?new Date(identity.warmupStartedAt).getTime():null;
 const days=started===null?999:Math.max(0,Math.floor((now.getTime()-started)/86400000));
 return Number.isFinite(days)?Math.min(5+days*3,configured):0;
}
export function remainingDailyCapacity(identity:SenderIdentityLike,now=new Date()):number{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 const today=`${value('year')}-${value('month')}-${value('day')}`;
 const used=identity.counterDate&&identity.counterDate<today?0:Number(identity.sentToday??0);
 return Math.max(0,effectiveSenderDailyLimit(identity,now)-used);
}
