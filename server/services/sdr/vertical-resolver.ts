/**
 * Shared canonical-vertical resolution for inbox tagging and AI reply context.
 *
 * Many downstream consumers (inbox tag generation, AI reply intent classification,
 * conversation-ai smart replies) need "the vertical" for a lead/merchant, but two
 * fields can carry that information:
 *   - sdrMerchants.subvertical — the fine-grained canonical vertical set by
 *     normalizeDiscoveryVertical() at discovery time (e.g. "Med Spa", "Retail").
 *   - sdrMerchants.vertical / sdrLeadState.vertical — the coarse bucket from
 *     classifyVertical() (e.g. "Salon/Spa").
 *
 * This helper generically prefers the more specific value without needing to
 * enumerate any vertical names. Callers should always pass this through instead
 * of reading `.vertical` directly, so outbound sequence targeting and inbound
 * tagging/reply context stay consistent.
 */
export interface CanonicalVerticalInput {
  subvertical?: string | null;
  vertical?: string | null;
}

export function getCanonicalLeadVertical(input: CanonicalVerticalInput): string {
  return input.subvertical?.trim() || input.vertical?.trim() || "Unknown";
}
