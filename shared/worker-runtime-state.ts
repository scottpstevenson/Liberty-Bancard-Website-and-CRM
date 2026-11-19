export type WorkerObservation={queueName:string;expectedSelected:boolean;workerActive:boolean;stale:boolean;lastSeenAt:string|null;freshnessModel:string;backlogAvailable:boolean;queuePaused?:boolean|null};
export type WorkerRuntime={asOf:string;backgroundProfile:string;selectedGroups:string[];pauseReason:{state:string};heartbeats:WorkerObservation[]};
/** Invalid/partial diagnostics are unavailable, never zero or healthy. */
export function decodeWorkerRuntime(value:unknown):WorkerRuntime|null{
 const v=value as any;
 if(!v||typeof v.backgroundProfile!=='string'||!Array.isArray(v.selectedGroups)||!v.selectedGroups.every((s:unknown)=>typeof s==='string')||!Number.isFinite(Date.parse(v.asOf))||typeof v.pauseReason?.state!=='string'||!Array.isArray(v.heartbeats))return null;
 if(!v.heartbeats.every((w:any)=>w&&typeof w.queueName==='string'&&['expectedSelected','workerActive','stale','backlogAvailable'].every(k=>typeof w[k]==='boolean')&&(w.queuePaused===undefined||w.queuePaused===null||typeof w.queuePaused==='boolean')&&typeof w.freshnessModel==='string'&&(w.lastSeenAt===null||typeof w.lastSeenAt==='string'&&Number.isFinite(Date.parse(w.lastSeenAt)))))return null;
 return v;
}
export function workerObservationLabel(w:WorkerObservation):string{
 if(!w.expectedSelected)return 'Not selected';
 if(!w.workerActive)return 'Selected, not ready';
 if(!w.backlogAvailable)return 'Queue unavailable';
 if(w.queuePaused===true)return 'Queue paused';
 if(w.stale)return 'Heartbeat stale';
 if(w.freshnessModel!=='interval')return 'Worker active; event/cron driven';
 return w.lastSeenAt?'Observed':'Awaiting heartbeat';
}
