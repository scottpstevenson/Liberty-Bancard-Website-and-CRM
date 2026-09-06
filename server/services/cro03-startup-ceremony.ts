/**
 * cro03-startup-ceremony.ts
 *
 * W13 + W14: Startup ceremony artifacts and attestation are NO LONGER run
 * from ordinary application startup.
 *
 * History:
 *   Phase 1 — runStartupCeremonyArtifacts() was previously called pre-listen
 *     to sign and import approval artifacts using CRO03D_OPERATOR_PRIVATE_KEY.
 *     This was removed for security: signing from the server process collapses
 *     the independent approval boundary. A server compromise would allow
 *     self-authorization.
 *
 *   Phase 2 — runStartupCeremonyAttestation() was called post-worker-start
 *     to create runtime attestation and activation policy. This was also
 *     removed because it depended on Phase 1 receipts that are no longer
 *     produced at startup.
 *
 * CURRENT PATH:
 *   Both phases are performed by the offline CLI ceremony script:
 *     npx tsx scripts/cro03d-run-ceremony.ts --expected-workers N
 *
 *   That script:
 *     1. Loads the operator private key (never stored in server process)
 *     2. Validates pricing, contracts, scope hash, and target SHA
 *     3. Signs and imports 4 approval dimension artifacts
 *     4. Signs and imports a deployment inventory (verified against --expected-workers N)
 *     5. Creates a runtime attestation (14-min TTL)
 *     6. Creates an activation policy revision
 *
 *   W14: Pricing assumptions are in the script's PRICING constant and validated
 *   against CRO03C_PROVIDER_CONTRACTS at runtime, not embedded in server startup.
 *
 * EXPORTS (backward compat stubs — both are no-ops):
 *   These are exported to prevent import errors in any caller that hasn't
 *   been updated yet. They log a clear message and return null/undefined.
 */

export async function runStartupCeremonyArtifacts(): Promise<null> {
  // W13: Phase 1 removed from startup. Use scripts/cro03d-run-ceremony.ts.
  console.log("[CRO03D] Phase 1: artifact signing is an offline operator action (see scripts/cro03d-run-ceremony.ts)");
  return null;
}

export async function runStartupCeremonyAttestation(
  _receiptIds: Partial<Record<string, string>>,
): Promise<void> {
  // W13: Phase 2 removed from startup. Use scripts/cro03d-run-ceremony.ts.
  console.log("[CRO03D] Phase 2: attestation is performed by scripts/cro03d-run-ceremony.ts, not startup.");
}
