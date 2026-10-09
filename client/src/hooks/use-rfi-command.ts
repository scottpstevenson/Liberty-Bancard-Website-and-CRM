import {useEffect,useRef,useState} from "react";
import {apiRequest} from "@/lib/queryClient";
import {useWorkCommands,invalidateWorkFacts} from "./use-work-commands";
import {useCrmActorIdentity} from "./use-crm-query";
type Row={id:number;authorityFence:number};
type Intent={key:string;url:string;method:"POST"|"PUT";fields:Record<string,unknown>;
  body:Record<string,unknown>;promise?:Promise<any>;unconfirmed?:boolean};
/** B consumer: one frozen payload/version/UUID until confirmed or a definite
 * pre-effect rejection. Network/5xx loss never silently becomes a new intent. */
function useFrozenWorkCommand(kind:"rfi"|"ticket",scope:string){
  const commands=useWorkCommands(kind),actor=useCrmActorIdentity();
  const context=JSON.stringify([actor,kind,scope]);
  const label=kind==="rfi"?"RFI":"Ticket",collection=kind==="rfi"?"rfis":"tickets";
  const currentActor=useRef(context);currentActor.current=context;
  const intents=useRef(new Map<string,Intent>());
  const [uncertain,setUncertain]=useState<string[]>([]);
  useEffect(()=>{intents.current.clear();setUncertain([]);},[context]);
  function send(intent:Intent):Promise<any>{
    if(intent.promise)return intent.promise;
    const capturedActor=context;
    intent.promise=(async()=>{
      try{
        const res=await apiRequest(intent.method,intent.url,intent.body),result=await res.json();
        if(!Number.isSafeInteger(result?.id)||result?.command?.id!==intent.body.commandId)
          throw new Error(`${label} command confirmation shape unavailable. Reconcile the frozen intent.`);
        if(currentActor.current!==capturedActor)throw new Error(`${label} account context changed. Reconcile through the current authorized reader.`);
        if(intent.method==="POST")commands.finishCreate(intent.fields);
        intents.current.delete(intent.key);setUncertain(keys=>keys.filter(key=>key!==intent.key));
        void invalidateWorkFacts();return result;
      }catch(error:any){
        if(currentActor.current===capturedActor){
          // These statuses are rejected before B commits. 5xx/transport loss is
          // deliberately not classified as no-effect.
          if(!intent.unconfirmed&&/^(400|401|403|404|409|422):/.test(error?.message??""))intents.current.delete(intent.key);
          else{
            // A later denial establishes no effect for that retry, not for the
            // original lost reply. Retain its identity until reconciliation.
            intent.unconfirmed=true;
            setUncertain(keys=>keys.includes(intent.key)?keys:[...keys,intent.key]);
            // An authorized refresh may expose the current row/facts, but it
            // cannot confirm this command's UUID or release its frozen payload.
            void invalidateWorkFacts();
          }
        }
        throw error;
      }finally{intent.promise=undefined;}
    })();
    return intent.promise;
  }
  function execute(fields:Record<string,unknown>,row?:Row){
    const key=row?`edit:${row.id}`:"create",prior=intents.current.get(key);
    if(prior){
      if(JSON.stringify(prior.fields)!==JSON.stringify(fields))
        return Promise.reject(new Error(`The original ${label} intent is unconfirmed. Retry its frozen payload before starting a changed intent.`));
      return send(prior);
    }
    const intent:Intent={key,fields,body:row?commands.edit(row,fields):commands.create(fields),
      method:row?"PUT":"POST",url:row?`/api/${collection}/${row.id}`:`/api/${collection}`};
    intents.current.set(key,intent);return send(intent);
  }
  return {context,execute,uncertain,retry(key:string){
    const intent=intents.current.get(key);
    return intent?send(intent):Promise.reject(new Error(`Captured ${label} intent unavailable.`));
  }};
}
export function useRfiCommand(scope="rfi-workspace"){return useFrozenWorkCommand("rfi",scope);}
/** Ticket edits keep their existing B consumer; this shares frozen creation only. */
export function useTicketCreateCommand(scope="ticket-workspace"){
  const command=useFrozenWorkCommand("ticket",scope);
  return {...command,execute:(fields:Record<string,unknown>)=>command.execute(fields)};
}
