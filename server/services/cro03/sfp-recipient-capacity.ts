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
): Promise<{ slot: number; role: "primary" | "alternate"; replay: boolean; globalSlotId: string }> {
  const guard = rows(await tx.execute(sql`SELECT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=to_regclass('public.sfp_recipient_address_commitments')
      AND t.tgname='sfp_global_recipient_capacity_contract' AND t.tgenabled IN ('O','A')
      AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgtype=7
      AND p.pronamespace='public'::regnamespace
      AND p.proname='crm_enforce_global_recipient_capacity'
      AND md5(p.prosrc)='f539e6284a16e3686ab61df964c16779'
    ) AS installed,
    EXISTS (SELECT 1 FROM pg_constraint c
      WHERE c.conrelid=to_regclass('public.sfp_recipient_address_commitments')
        AND c.conname='sfp_recipient_global_slot_subject_fk' AND c.contype='f'
        AND c.convalidated AND c.confrelid=to_regclass('public.sfp_global_recipient_slots')
        AND array_length(c.conkey,1)=3 AND array_length(c.confkey,1)=3
    ) AS matching_subject_fk`))[0];
  if (!guard?.installed || !guard?.matching_subject_fk) {
    throw new SfpRecipientCapacityError("SFP_GLOBAL_RECIPIENT_DATABASE_GUARD_MISSING");
  }
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
  if (businessAddresses.length > SFP_BUSINESS_RECIPIENT_LIMIT) {
    throw new SfpRecipientCapacityError("SFP_STAGING_LEGACY_CAPACITY_CONFLICT");
  }
  // Lazily reserve historical addresses without modifying their immutable
  // commitments. This prevents a schema rollout from resetting prior capacity.
  for (const [index, value] of businessAddresses.entries()) {
    await tx.execute(sql`INSERT INTO sfp_global_recipient_slots
      (business_id,recipient_identity_hash,slot) VALUES (${businessId},${value},${index + 1})
      ON CONFLICT (recipient_identity_hash) DO NOTHING`);
  }
  const reserve = async (slot: number) => {
    const row = rows(await tx.execute(sql`INSERT INTO sfp_global_recipient_slots
      (business_id,recipient_identity_hash,slot) VALUES (${businessId},${addressHash},${slot})
      ON CONFLICT (recipient_identity_hash) DO UPDATE
        SET recipient_identity_hash=EXCLUDED.recipient_identity_hash
        WHERE sfp_global_recipient_slots.business_id=EXCLUDED.business_id
      RETURNING id,business_id,slot`))[0];
    if (!row || Number(row.business_id) !== businessId) {
      throw new SfpRecipientCapacityError("SFP_STAGING_RECIPIENT_BUSINESS_CONFLICT");
    }
    return String(row.id);
  };
  if (existingIndex >= 0) {
    return { slot: existingIndex + 1, role: existingIndex === 0 ? "primary" : "alternate", replay: true,
      globalSlotId: await reserve(existingIndex + 1) };
  }
  if (businessAddresses.length >= SFP_BUSINESS_RECIPIENT_LIMIT) {
    throw new SfpRecipientCapacityError("SFP_STAGING_BUSINESS_RECIPIENT_CAPACITY_REACHED");
  }
  const slot = businessAddresses.length + 1;
  return { slot, role: slot === 1 ? "primary" : "alternate", replay: false, globalSlotId: await reserve(slot) };
}