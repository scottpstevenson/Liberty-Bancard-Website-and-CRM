import { useState } from "react";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CrmDataState } from "./CrmPresentation";

export type ContactChoice={id:number;name:string};
type ContactOption={id:number;firstName:string|null;lastName:string|null;companyName:string|null;email:string|null};
/** Presentation of the existing authorized People reader, not an identity authority. */
export function AuthorizedContactPicker({value,onSelect,label="Contact",parentOnly=false,testId="contact-picker"}:{
  value:ContactChoice|null;onSelect:(value:ContactChoice|null)=>void;label?:string;parentOnly?:boolean;testId?:string;
}){
  const [search,setSearch]=useState("");
  const [offset,setOffset]=useState(0);
  const params={search,limit:25,offset,...(parentOnly?{isParentAccount:true}:{})};
  const query=useCrmQuery<{data:ContactOption[];limit:number;offset:number}>({
    queryKey:["/api/contacts",params],
    enabled:!value,
    queryFn:async({signal})=>{
      const q=new URLSearchParams(Object.entries(params).map(([key,value])=>[key,String(value)]));
      const response=await fetch(`/api/contacts?${q}`,{credentials:"include",signal});
      if(!response.ok)throw new Error("Authorized contact search is unavailable");
      const result=await response.json();
       if(!result||!Array.isArray(result.data)||result.data.length>25||result.limit!==25||result.offset!==offset||
         !result.filters||typeof result.filters!=="object"||Array.isArray(result.filters)||!["all","owned_or_unassigned"].includes(result.scope)||
         result.data.some((item:ContactOption)=>!item||!Number.isInteger(item.id)||item.id<=0||
           [item.firstName,item.lastName,item.companyName,item.email].some(value=>value!==null&&typeof value!=="string")))
        throw new Error("Invalid contact search response; no empty result is assumed");
      return result;
    },
  });
  return <div className="space-y-2">
    {value?<div className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-2">
      <span className="min-w-0 break-words">{value.name}</span>
      <Button type="button" variant="ghost" onClick={()=>onSelect(null)} data-testid={`${testId}-clear`}>Clear</Button>
    </div>:<>
      <Input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`}
        value={search} onChange={event=>{setSearch(event.target.value);setOffset(0);}} data-testid={`${testId}-search`}/>
      {query.isError?<CrmDataState state="unavailable" message="Contact search unavailable. Retry the authorized search; this is not a no-match result." onRetry={()=>void query.refetch()}/>:
        query.isPending?<p role="status">Searching authorized contacts…</p>:<div className="max-h-56 overflow-y-auto rounded-md border">
          {query.data?.data.length===0?<p className="p-3" role="status">{offset?"No contacts on this page.":"No authorized contacts match."}</p>:
            query.data?.data.map(contact=>{
              const name=[contact.firstName,contact.lastName].filter(Boolean).join(" ")||contact.companyName||contact.email||`Contact ${contact.id}`;
              return <Button key={contact.id} type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                onClick={()=>onSelect({id:contact.id,name})} data-testid={`${testId}-option-${contact.id}`}>
                {name}{contact.companyName&&contact.companyName!==name?` — ${contact.companyName}`:""}
              </Button>;
            })}
        </div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={offset===0||query.isFetching} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous contacts</Button>
        <Button type="button" variant="outline" disabled={query.isFetching||query.isError||query.data?.data.length!==25} onClick={()=>setOffset(offset+25)}>Next contacts</Button>
        <span className="text-xs text-muted-foreground">Page {offset/25+1}; no population total inferred.</span>
      </div>
    </>}
  </div>;
}
