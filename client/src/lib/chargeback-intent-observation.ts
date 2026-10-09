/** Absence in a bounded window is not evidence that an earlier intent is absent.
 * This read never grants permission; B remains the actual command authority. */
export function requireNoPriorChargebackIntent(value:unknown,id:number):void {
  const v=value as {chargebackId?:number;hasPriorIntent?:boolean;intentExistenceCompleteness?:string}|null;
  if(!v || v.chargebackId!==id || typeof v.hasPriorIntent!=="boolean" || v.intentExistenceCompleteness!=="all_case_commands")
    throw new Error("Complete intent readback unavailable; no new key was created.");
  if(v.hasPriorIntent)throw new Error("An earlier intent is recorded. Refresh its durable status and reconcile it before starting another intent. No new key was created.");
}
