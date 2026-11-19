/** Synthetic receipt prerequisite for tests on launcher-verified disposable databases. No provider calls. */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
export async function completedValidationOperation(executor: {execute: (query: any) => Promise<any>}, contactId: number): Promise<string> {
  await assertDisposableTestInfrastructure({operation: "synthetic completed validation receipt"});
  const id = randomUUID();
  await executor.execute(sql`INSERT INTO provider_operations
    (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
    VALUES(${id},'zerobounce','email_validation','certification',${id},'system',${`contact:${contactId}`},'completed')`);
  return id;
}
