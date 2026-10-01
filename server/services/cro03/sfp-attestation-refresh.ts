/**
 * Compatibility tick for the retired routine-SFP fleet-certificate refresh.
 *
 * Routine SFP provider authority now comes from durable deployment ownership
 * and renewable operation leases in sfp-provider-operations.ts. This tick
 * deliberately performs no CRO03C attestation issuance or verification.
 * Independent CRO03C certificate-dependent flows remain unchanged.
 */
export interface SfpAttestationRefreshResult {
  refreshed: false;
  reason: "ROUTINE_SFP_ATTESTATION_REFRESH_RETIRED";
}

export async function processSfpAttestationRefreshTick(): Promise<SfpAttestationRefreshResult> {
  return { refreshed: false, reason: "ROUTINE_SFP_ATTESTATION_REFRESH_RETIRED" };
}