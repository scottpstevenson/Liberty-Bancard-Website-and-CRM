import { sql } from "drizzle-orm";
const rows = (result: any): any[] => result?.rows ?? result ?? [];
export const SFP_BUSINESS_RECIPIENT_LIMIT = 3;

export class SfpRecipientCapacityError extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * Run inside the staging transaction, before inserting an intent. All typed
 * sources share this reservation boundary. Existing aliases consume no new slot.
 * Commitment rows are retained, so restarting or refreezing cannot reset capacity.
 */
export async function lockSfpRecipientCapacity(
  tx: any, programId: string, objectiveKey: string, businessId: number, addressHash: string,
): Promise<{ slot: number; role: "primary" | "alternate"; replay: boolean }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtextextended(${`sfp-business-recipient-capacity:${businessId}`},0))`);
  // Separate businesses must not concurrently claim the same mailbox through
  // different program-scoped unique indexes. Always take business then address.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtextextended(${`sfp-recipient-address-owner:${addressHash}`},0))`);
  const conflictingOwner = rows(await tx.execute(sql`
    SELECT business_id FROM sfp_recipient_address_commitments
     WHERE recipient_identity_hash=${addressHash} AND business_id<>${businessId}
     LIMIT 1
  `))[0];
  if (conflictingOwner) {
    throw new SfpRecipientCapacityError("SFP_STAGING_RECIPIENT_BUSINESS_CONFLICT");
  }
  const current = rows(await tx.execute(sql`
    SELECT id,business_id,recipient_identity_hash
      FROM sfp_recipient_address_commitments
     WHERE business_id=${businessId}
       AND state IN ('claimed','committed')
     ORDER BY created_at,id FOR UPDATE
  `));
  const businessAddresses = [...new Set(current.filter(row => Number(row.business_id) === businessId)
    .map(row => String(row.recipient_identity_hash)))];
  const existingIndex = businessAddresses.indexOf(addressHash);
  if (existingIndex >= 0) {
    return { slot: existingIndex + 1, role: existingIndex === 0 ? "primary" : "alternate", replay: true };
  }
  if (businessAddresses.length >= SFP_BUSINESS_RECIPIENT_LIMIT) {
    throw new SfpRecipientCapacityError("SFP_STAGING_BUSINESS_RECIPIENT_CAPACITY_REACHED");
  }
  const slot = businessAddresses.length + 1;
  return { slot, role: slot === 1 ? "primary" : "alternate", replay: false };
}