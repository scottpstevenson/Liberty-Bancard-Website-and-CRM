import { sql } from "drizzle-orm";

/**
 * Must match cro03_sfp_contact_address_commit_serialization() in migration
 * 0322. The database trigger takes this lock for every contact insert and
 * every address/suppression mutation, including direct SQL writers.
 */
export function normalizeSfpContactAddress(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "").toLowerCase();
  return normalized || null;
}

export async function lockSfpContactAddress(
  executor: { execute: (query: any) => Promise<any> },
  email: unknown,
): Promise<void> {
  const normalized = normalizeSfpContactAddress(email);
  if (!normalized) return;
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      ${`sfp-contact-address-v1:${normalized}`},0
    ))
  `);
}