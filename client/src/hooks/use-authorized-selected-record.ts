import {useCrmQuery as useQuery} from "./use-crm-query";
import {useAuth} from "./use-auth";
/** `param` is the registered selector name (default `id`; Work tasks use `taskId`). */
export function useAuthorizedSelectedRecord<T>(path:string,search:string,param:string="id") {
  const {user}=useAuth();
  const parameters=new URLSearchParams(search),values=[...new Set(parameters.getAll(param))];
  const raw=values.length===1?values[0]:null;
  const id=raw && /^[1-9]\d*$/.test(raw) && Number(raw)<=2147483647?Number(raw):null;
  const query=useQuery<T>({
    queryKey:[path,"authorized-selected-record",param,id,user?.id,user?.accountVersion],
    enabled:id!==null && !!user?.id,staleTime:0,gcTime:0,retry:false,
    queryFn:async({signal})=>{
      const response=await fetch(`${path}/${id}`,{credentials:"include",signal});
      if(!response.ok) throw new Error(`${response.status}: Requested record unavailable`);
      return response.json();
    },
  });
  return {...query,id,invalid:parameters.has(param) && id===null};
}
