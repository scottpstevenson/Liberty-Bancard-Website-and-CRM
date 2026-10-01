import { sql } from "drizzle-orm";

/** Shared sentinel for mutable business-level exclusions with possible absent rows. */
export async function lockSfpBusinessSafetySentinel(
  executor: { execute: (query: any) => Promise<any> },
  businessId: number,
  mode: "shared" | "exclusive" = "shared",
): Promise<void> {
  if (mode === "exclusive") {
    await executor.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('sfp-business-safety-v1:' || ${businessId}::text, 0)
      )
    `);
    return;
  }
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock_shared(
      hashtextextended('sfp-business-safety-v1:' || ${businessId}::text, 0)
    )
  `);
}

/** Serializes both an eligibility-row upsert and readers when its unique row is absent. */
export async function lockSfpEligibilityProjectionKey(
  executor: { execute: (query: any) => Promise<any> },
  cohortRunId: string,
  businessId: number,
  policyVersion: number,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        'sfp-outreach-eligibility-v1:' ||
        ${cohortRunId}::text || ':' || ${businessId}::text || ':' || ${policyVersion}::text,
        0
      )
    )
  `);
}

/** Shared global fence used before eligibility readers inspect a possibly absent row. */
export async function lockSfpEligibilityProjectionReadGate(
  executor: { execute: (query: any) => Promise<any> },
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock_shared(
      hashtextextended('sfp-eligibility-projection-global-v1', 0)
    )
  `);
}

/** Exclusive global fence; acquire before row locks when this transaction will mutate eligibility. */
export async function lockSfpEligibilityProjectionWriteGate(
  executor: { execute: (query: any) => Promise<any> },
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('sfp-eligibility-projection-global-v1', 0)
    )
  `);
}