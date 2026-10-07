/** Cache/presentation context only; never authentication or permission authority. */
export type ProtectedActor={id:string;role?:string|null;accountVersion?:number|null;permissions?:string[]|null};
let identity="anonymous",generation=0;
const listeners=new Set<()=>void>();
export function actorIdentity(actor:ProtectedActor|null|undefined){
  return actor?`${actor.id}:${actor.role??""}:${actor.accountVersion??""}:${JSON.stringify([...(actor.permissions??[])].sort())}`:"anonymous";
}
export function currentProtectedIdentity(){return identity;}
export function protectedScope(actor:ProtectedActor|null|undefined){return {actor:actorIdentity(actor),generation};}
export function protectedContextToken(){return `${identity}:${generation}`;}
export function subscribeProtectedIdentity(listener:()=>void){
  listeners.add(listener);return ()=>{listeners.delete(listener);};
}
export function advanceProtectedIdentity(next:string){identity=next;return ++generation;}
export function currentProtectedGeneration(){return generation;}
export function notifyProtectedIdentity(){for(const listener of listeners)listener();}
