export class DealTransitionObservationError extends Error {
  constructor(message:string, readonly scope?:string){super(message);this.name="DealTransitionObservationError";}
}

/** Consumes the command owner's structural read. Never grants role, object,
 * readiness, version or pause authority; the actual command must recheck those. */
export function requireDealTransitionObservation(value:unknown,id:number,expectedStage:string,target:string):void {
  const v=value as {dealId?:number;stage?:string;stages?:unknown;capability?:string}|null;
  if(!v || v.dealId!==id || v.stage!==expectedStage || v.capability!=="structural_policy_observation_only" ||
    !Array.isArray(v.stages) || v.stages.some(s=>typeof s!=="string"))
    throw new DealTransitionObservationError("Structural transition observation unavailable or stale; no move was sent.");
  if(target!==expectedStage && !v.stages.includes(target))
    throw new DealTransitionObservationError("The existing structural policy does not permit this move; no command was sent.");
}
