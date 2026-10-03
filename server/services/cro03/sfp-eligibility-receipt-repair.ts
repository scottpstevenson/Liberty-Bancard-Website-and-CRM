/**
 * A repair marker is scheduling permission, never validation authority.
 * The ordinary validator must reopen the exact source and recheck the receipt,
 * policy, suppression, safety gates, and ownership before projecting it.
 */
export function isSfpReceiptProjectionRepairCandidate(
  prior: {
    business_id?: unknown;
    receipt_projection_needs_repair?: unknown;
    status?: unknown;
    source_kind?: unknown;
    candidate_id?: unknown;
    paid_id?: unknown;
    contact_id?: unknown;
    normalized_value_hash?: unknown;
    normalized_value_hash_version?: unknown;
  } | undefined,
  candidate: {
    businessId: number;
    sourceKind: string;
    evidenceId: string;
    normalizedValueHash?: string | null;
    normalizedValueHashVersion?: number | null;
  },
): boolean {
  if (prior?.receipt_projection_needs_repair !== true ||
      prior.status !== "validated_outreach_eligible" ||
      prior.business_id == null ||
      Number(prior.business_id) !== candidate.businessId ||
      !["free", "paid", "contact"].includes(candidate.sourceKind) ||
      !candidate.normalizedValueHash ||
      prior.normalized_value_hash !== candidate.normalizedValueHash ||
      prior.normalized_value_hash_version == null ||
      ![0, 1].includes(Number(candidate.normalizedValueHashVersion)) ||
      Number(prior.normalized_value_hash_version) !== candidate.normalizedValueHashVersion) {
    return false;
  }
  // An identical address may be retained by a different source or cohort.
  // This only schedules a recheck; the ordinary validator must reopen that
  // source and match its plaintext to a fresh provider observation.
  return true;
}