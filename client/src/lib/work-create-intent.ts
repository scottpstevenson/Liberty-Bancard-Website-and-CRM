const pending = new Map<string,{commandId:string;expectedActorId:string}>();
/** Pure until a user action calls it; safe to import during SSR. Never infer
 * ownership from names, and keep the exact UUID across a lost-response retry. */
export function prepareWorkCreation(actorId:string|undefined,fields:any) {
  if (!actorId) throw new Error("Sign-in unavailable. Reload before creating work.");
  if (fields?.commandId) {
    if (fields.expectedActorId!==actorId) throw new Error("Sign-in changed. Review the captured work before retrying.");
    return fields;
  }
  const key = JSON.stringify([actorId,fields]);
  if (!pending.has(key)) {
    if (pending.size>=128) throw new Error("Too many unresolved work creations. Review pending work before creating more.");
    pending.set(key,{commandId:crypto.randomUUID(),expectedActorId:actorId});
  }
  return {...fields,...pending.get(key)};
}
export function acknowledgeWorkCreation(fields:any) {
  for (const [key,intent] of pending) if (intent.commandId===fields?.commandId) pending.delete(key);
}
