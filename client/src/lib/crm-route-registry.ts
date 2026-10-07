import rows from "./crm-route-registry.generated.json";
import { parseLocalEntityId, destinationUrl, safeFragment, safeParams, safeContextKeys, type LocalEntityId } from "./crm-destination-state";
export type WorkspaceOwner = "C2" | "C3" | "C4" | "C5";
export type CrmRoute = typeof rows[number];
/** Census rows record actual conditional wrappers, not permission grants. */
export const crmRoutes: readonly CrmRoute[] = rows;
export function routeById(id: string) {
  return crmRoutes.find(route=>route.id===id) ?? null;
}
export function buildCrmDestination(id: string, entity?: LocalEntityId, query = new URLSearchParams(), hash = "") {
  const route=routeById(id);
  if(!route) throw new Error("Unknown CRM route");
  let pattern=route.pattern;
  if(route.entityParameters.length) {
    const namespace=route.entityParameters[0].namespace;
    const key=namespace==="company"?"companyId":namespace==="business"?"businessId":"contactId";
    if(!entity || entity.kind!==key || !parseLocalEntityId(key,entity.value)) throw new Error("Invalid typed local entity ID");
    pattern=pattern.replace(":id",entity.value);
  }
  const safe=new URLSearchParams();
  for(const [key,value] of query) {
    if(!route.queryPolicy.allowed.includes(key)) throw new Error(`Unregistered query key: ${key}`);
    const previous=safe.get(key);
    if(previous!==null && previous!==value) throw new Error(`Conflicting query key: ${key}`);
    if((safeContextKeys as readonly string[]).includes(key) && !safeParams(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,[key]).has(key))
      throw new Error(`Invalid typed context: ${key}`);
    safe.set(key,value);
  }
  if(hash && !safeFragment(hash)) throw new Error("Invalid record anchor");
  return destinationUrl(pattern,safe,hash);
}
