/** Existing timestamp column is a compatibility carrier for a calendar day,
 * not a claim that UTC noon is the same local date in every timezone. */
export function portfolioFollowupDay(value:string|null):Date|undefined {
  const match=value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if(!match)return;
  const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]);
  const date=new Date(year,month,day);
  if(date.getFullYear()!==year || date.getMonth()!==month || date.getDate()!==day)return;
  return date;
}
export function portfolioFollowupDays(value:string|null,now=new Date()):number|null {
  const date=portfolioFollowupDay(value);
  if(!date)return null;
  return (Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-
    Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000;
}
export function portfolioFollowupCarrier(day:Date):string {
  if(!Number.isFinite(day.getTime()))throw new Error("Invalid follow-up day");
  const month=String(day.getMonth()+1).padStart(2,"0");
  const date=String(day.getDate()).padStart(2,"0");
  return `${day.getFullYear()}-${month}-${date}T12:00:00.000Z`;
}
