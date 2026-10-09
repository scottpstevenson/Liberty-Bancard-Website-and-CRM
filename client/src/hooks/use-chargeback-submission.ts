import { useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { apiRequest, actorIdentity } from "@/lib/queryClient";
import { observeChargebackBeforeNewKey } from "@/lib/chargeback-intent-readback";

type Payload = { midId: number; evidenceNotes?: string; caseNumber?: string };
type Receipt = { accepted: true; command: { id: string; chargebackId: number; state: string } };
type Intent = { key: string; payload: Payload };

/** A failed response does not authorize a second intent. Freeze the request
 * through retries; component/actor boundaries never carry another user's intent. */
export function useChargebackSubmission(chargebackId: number, contactId?: number | null) {
  const { user }=useAuth();
  const actor=actorIdentity(user);
  const boundary=useRef({actor,caseId:chargebackId,active:true});
  if(boundary.current.actor!==actor || boundary.current.caseId!==chargebackId){
    boundary.current.active=false;boundary.current={actor,caseId:chargebackId,active:true};
  }
  useEffect(()=>{const captured=boundary.current;captured.active=true;return()=>{captured.active=false}},[actor,chargebackId]);
  const cache=useQueryClient();
  const intent=useRef<{ actor:string; caseId:number; value:Intent } | null>(null);
  if (intent.current && (intent.current.actor!==actor || intent.current.caseId!==chargebackId)) intent.current=null;
  const commands=useCrmQuery<{data:Array<{id:string;state:string;submitted_at:string|null}>}>({
    queryKey:[`/api/chargebacks/${chargebackId}/submission-commands`],
    enabled:chargebackId>0,
  });
  const mutation=useMutation({
    mutationFn:async (payload:Payload):Promise<Receipt>=>{
       const captured=boundary.current;
      if (!Number.isSafeInteger(payload.midId) || payload.midId<=0) throw new Error("An authorized merchant MID is required.");
       if (!intent.current) await observeChargebackBeforeNewKey(chargebackId);
       if(!captured.active || captured!==boundary.current)throw new Error("Record or actor changed; no new submission was sent.");
       if (!intent.current) intent.current={actor,caseId:chargebackId,
        value:{key:crypto.randomUUID(),payload:{...payload}}};
      const frozen=intent.current.value;
      if (JSON.stringify(frozen.payload)!==JSON.stringify(payload))
        throw new Error("An earlier intent is unresolved. Retry its unchanged payload and read back its status.");
      const response=await apiRequest("POST",`/api/chargebacks/${chargebackId}/submit-to-card-brand`,
        frozen.payload,{"Idempotency-Key":frozen.key});
      const receipt=await response.json();
      if (receipt?.accepted!==true || typeof receipt?.command?.id!=="string" ||
        receipt.command.chargebackId!==chargebackId) throw new Error("Acceptance receipt unavailable. Retry the same intent.");
      return receipt;
    },
    onSettled:async ()=>{
      await Promise.all([
        cache.invalidateQueries({queryKey:[`/api/chargebacks/${chargebackId}/submission-commands`]}),
        cache.invalidateQueries({queryKey:["/api/chargebacks"]}),
        ...(contactId ? [cache.invalidateQueries({queryKey:["/api/chargebacks/contact",contactId]})] : []),
      ]);
    },
  });
  return {mutation,commands};
}
