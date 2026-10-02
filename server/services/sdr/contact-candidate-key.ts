import { createHash } from "node:crypto";

/**
 * A proposal belongs to a contact/business pair, not just a business.
 * Keep the old key available so retries of an existing legacy proposal still
 * pass through the authority's unchanged immutable-tuple replay check.
 */
export function getSdrContactCandidateKeys(input: {
  contactId: number;
  businessId: number;
  sourceType: string;
  sourceLabel?: string;
}): { legacy: string; scoped: string } {
  const sourceLabel = input.sourceLabel || `contact_${input.contactId}`;
  const digest = createHash("sha256")
    .update(JSON.stringify([input.sourceType, sourceLabel, input.contactId, input.businessId]))
    .digest("hex");
  return {
    legacy: `sdr-contact:${input.sourceType}:${sourceLabel}:${input.businessId}`,
    scoped: `sdr-contact:pair:${digest}`,
  };
}