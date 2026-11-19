/** Retained pre-selection-gate recovery fixture. Never grants execution authority. */
import {sql} from "drizzle-orm";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
export async function retainedCro03bFinalization(db: any,itemId:string,contactId:number) {
  await assertDisposableTestInfrastructure({operation:"retained CRO03B deferred finalization fixture"});
  const c=(await db.execute(sql`SELECT * FROM contacts WHERE id=${contactId}`)).rows[0];
  const intent=(await db.execute(sql`INSERT INTO validation_intents
    (contact_id,normalized_email_token_hash,subject_generation,policy_version,purpose,state,enqueue_state,terminal_code)
    VALUES(${contactId},${c.email_token_hash},${c.email_mutation_generation},1,'cro03_winning_email','pending','deferred','cro03b_provider_denied') RETURNING id`)).rows[0];
  await db.execute(sql`INSERT INTO cro03b_finalization_receipts
    (item_id,contact_id,validation_intent_id,subject_generation,email_token_hash,link_disposition,scoring_request_key)
    VALUES(${itemId}::uuid,${contactId},${intent.id}::uuid,${c.email_mutation_generation},${c.email_token_hash},'verified',${`cro03b:${itemId}:score:g${c.email_mutation_generation}`})`);
  await db.execute(sql`UPDATE cro03b_recipe_items SET state='waiting',terminal_code='validation_pending' WHERE id=${itemId}::uuid`);
}
