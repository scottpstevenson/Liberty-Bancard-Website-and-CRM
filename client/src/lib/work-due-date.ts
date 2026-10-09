import {localCalendarDateAtTime} from "./calendar-date-repair";

/** Presentation only: the stored deadline remains an instant, not a date-only
 * carrier. An unchanged day must not round or reconstruct that instant. */
export function workDueDay(value:string|null|undefined):string {
  if(!value)return "";
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return "";
  return `${String(date.getFullYear()).padStart(4,"0")}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function workDueDateChange(day:string,original?:string|null):{dueDate?:string|null} {
  if(day===workDueDay(original))return {};
  if(!day)return {dueDate:null};
  return {dueDate:localCalendarDateAtTime(day,"00:00").toISOString()};
}
