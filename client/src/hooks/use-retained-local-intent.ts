import {useRef} from "react";
import {useAuth} from "./use-auth";
/** Retains a command ID across transport failure; never persists credentials. */
export function useRetainedLocalIntent() {
  const {user}=useAuth();
  const intents=useRef<Record<string,{key:string;payload:any}>>({});
  return {
    payload(operation:string,fields:Record<string,unknown>) {
      if(!user?.id || !Number.isSafeInteger(user.accountVersion)) throw new Error("Current account unavailable. Reload before saving.");
      const key=JSON.stringify([user.id,user.accountVersion,fields]);
      if(intents.current[operation]?.key!==key) intents.current[operation]={key,payload:{
        ...fields,commandId:crypto.randomUUID(),expectedActorId:user.id,expectedAccountVersion:user.accountVersion}};
      return intents.current[operation].payload;
    },
    accepted(operation:string) {delete intents.current[operation];},
  };
}
