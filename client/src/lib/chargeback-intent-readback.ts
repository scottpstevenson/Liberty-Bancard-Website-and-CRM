import { apiRequest, protectedContextToken } from "@/lib/queryClient";
import { requireNoPriorChargebackIntent } from "./chargeback-intent-observation";

/** This observation is not permission to submit. B still authorizes the actual
 * intent. A bounded history window cannot establish the absence of old intents. */
export async function observeChargebackBeforeNewKey(id:number):Promise<void> {
  const context=protectedContextToken();
  const value=await (await apiRequest("GET",`/api/chargebacks/${id}/submission-commands`)).json();
  if(context!==protectedContextToken())throw new Error("Workspace changed; no new intent was prepared.");
  requireNoPriorChargebackIntent(value,id);
}
