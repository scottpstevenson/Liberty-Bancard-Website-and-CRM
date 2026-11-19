import {runFollowupEffect,type EffectIdentity} from '../followup-effects';
import {isAmbiguousDispatchMessage} from '../ghl-dispatch-recorder';
import {reserveSend,rollbackSend} from './inbox-rotation';
/** Existing durable effect authority owns replay; reservation is inside its claim, never repeated by a replay. */
export async function runInboxSendEffect(identity:EffectIdentity,identityId:number,businessId:number,
 send:()=>Promise<{success:boolean;error?:string;messageId?:string}>){
 return runFollowupEffect(identity,async()=>{
  const reservation=await reserveSend(identityId,businessId);
  if(!reservation)return {success:false,error:'daily_cap_reached_or_sender_unusable'};
  try{
   const result=await send();
   if(!result.success&&!isAmbiguousDispatchMessage(result.error))await rollbackSend(identityId,reservation.periodKey);
   return {...result,detail:result.messageId};
  }catch(error){
   // Entering delivery then losing its result is not evidence of non-delivery.
   // Preserve capacity and settle unknown through the existing receipt owner.
   throw new Error('GHL_AMBIGUOUS_DISPATCH: inbox delivery result unavailable',{cause:error});
  }
 });
}
