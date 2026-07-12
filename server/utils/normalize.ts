/**
 * normalizeGhlId — canonical GHL contact ID normalizer.
 *
 * Trims whitespace and converts empty strings to null.
 * Does NOT lowercase: GHL contact ID case-sensitivity is unconfirmed.
 *
 * Call this at every write path before persisting ghl_contact_id to the DB.
 */
export function normalizeGhlId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
