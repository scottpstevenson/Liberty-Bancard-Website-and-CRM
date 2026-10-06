import {useQuery} from "@tanstack/react-query";
import {useAuth} from "./use-auth";
export function useAuthorizedSelectedRecord<T>(path:string,search:string) {
  const {user}=useAuth();
  const parameters=new URLSearchParams(search),raw=parameters.get("id");
  const id=raw && /^[1-9]\d*$/.test(raw) && Number(raw)<=2147483647?Number(raw):null;
  const query=useQuery<T>({
    queryKey:[path,"authorized-selected-record",id,user?.id,user?.accountVersion],
    enabled:id!==null && !!user?.id,staleTime:0,gcTime:0,retry:false,
    queryFn:async()=>{
      const response=await fetch(`${path}/${id}`,{credentials:"include"});
      if(!response.ok) throw new Error("Requested record unavailable");
      return response.json();
    },
  });
  return {...query,id,invalid:parameters.has("id") && id===null};
}
