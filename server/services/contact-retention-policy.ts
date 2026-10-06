/**
 * Product erasure is unavailable until the complete FK AND semantic/worker
 * retention graph is certified. A disposable label is not evidence authority.
 * Keep this independent of DB startup so every boundary can use the same rule.
 */
export const CONTACT_ERASURE_BLOCK = Object.freeze({
  reason: "retention_contract_unverified",
  details: "Permanent deletion is unavailable: retained contact/deal evidence, child authority and pending work cannot yet be certified. Archive the record instead.",
});

export function blockedContactErasure(ids: readonly number[]) {
  return [...new Set(ids)].map(contactId => ({ contactId, ...CONTACT_ERASURE_BLOCK }));
}
