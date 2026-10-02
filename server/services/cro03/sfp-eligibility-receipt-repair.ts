/**
 * A repair marker is scheduling permission, never validation authority.
 * The ordinary validator must reopen the exact source and recheck the receipt,
 * policy, suppression, safety gates, and ownership before projecting it.
 */
export function isSfpReceiptProjectionRepairCandidate(
  prior: {
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
    sourceKind: string;
    evidenceId: string;
    normalizedValueHash?: string | null;
    normalizedValueHashVersion?: number | null;
  },
): boolean {
  if (prior?.receipt_projection_needs_repair !== true ||
      prior.status !== "validated_outreach_eligible" ||
      prior.source_kind !== candidate.sourceKind ||
      !candidate.normalizedValueHash ||
      prior.normalized_value_hash !== candidate.normalizedValueHash ||
      prior.normalized_value_hash_version == null ||
      ![0, 1].includes(Number(candidate.normalizedValueHashVersion)) ||
      Number(prior.normalized_value_hash_version) !== candidate.normalizedValueHashVersion) {
    return false;
  }
  const sourceId = candidate.sourceKind === "free" ? prior.candidate_id
    : candidate.sourceKind === "paid" ? prior.paid_id
      : candidate.sourceKind === "contact" ? prior.contact_id : null;
  const candidateId = candidate.sourceKind === "contact"
    ? candidate.evidenceId.replace(/^contact:/, "")
    : candidate.evidenceId;
  return sourceId != null && String(sourceId) === candidateId;
}