// Register of customer results that may be shown publicly. Server-only: nothing in this file is
// imported by client code, and only the projection in shared/public-proof.ts ever leaves the server.
//
// This register is intentionally empty. No existing record carries the full basis the projection
// requires (traceable private source, reporting period, matched volume/fee scope, calculation and
// annualization, program intervention, limits, review date, recorded permission and publication
// scope), so /case-studies and /testimonials ship the fallback copy. The earlier invented case
// studies, the demo testimonials and the two unreviewed drafts in the contract appendix are not
// stored here: drafts stay out of importable modules.
//
// To publish a result, add a ProofCandidate with every field below. proofGaps() lists whatever is
// missing, and an incomplete entry is simply not shown.

import { projectPublicProof, type ProofCandidate, type ProofSurface, type PublicProofItem } from "@shared/public-proof";

export const PUBLIC_PROOF_CANDIDATES: readonly ProofCandidate[] = [];

/** The single server-side read used by first-HTML renderers and the public API. */
export function publicProofFor(
  surface: ProofSurface,
  approvedSubmissionIds?: ReadonlySet<number>,
): PublicProofItem[] {
  return projectPublicProof(PUBLIC_PROOF_CANDIDATES, surface, { approvedSubmissionIds });
}
