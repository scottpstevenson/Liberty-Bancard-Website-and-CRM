/**
 * Shared transaction advisory-lock namespace for canonical inbound persistence
 * and sequence dispatch authorization. Keep both paths on this exact helper.
 */
const COMMUNICATION_CONTACT_LOCK_NAMESPACE = 1_698_000_000_000n;

export function communicationContactLockKey(contactId: number): bigint {
  if (!Number.isSafeInteger(contactId) || contactId <= 0) {
    throw new Error(`Invalid contact id for communication lock: ${contactId}`);
  }
  return COMMUNICATION_CONTACT_LOCK_NAMESPACE + BigInt(contactId);
}