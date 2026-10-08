/** Civil calendar boundaries in an explicit IANA zone. Never add 24h across DST. */
export function crmDayWindow(asOf:Date, timezone:string) {
  if(!Number.isFinite(asOf.getTime())) throw new Error("CRM_TIME_INVALID");
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const parts=(date:Date)=>Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));
  const p=parts(asOf), civil=Date.UTC(p.year,p.month-1,p.day);
  const midnight=(target:number)=>{
    let result=target;
    for(let i=0;i<6;i++){
      const observed=parts(new Date(result));
      const represented=Date.UTC(observed.year,observed.month-1,observed.day,observed.hour,observed.minute,observed.second);
      const correction=target-represented;
      if(!correction)return new Date(result);
      result+=correction;
    }
    throw new Error("CRM_CIVIL_BOUNDARY_UNAVAILABLE");
  };
  return {start:midnight(civil),endExclusive:midnight(civil+86400000),timezone};
}
