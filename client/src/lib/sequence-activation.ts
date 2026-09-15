// Wave 6 sequences (carrying sequenceFamily or eligibleConsentTiers) begin
// enrolling contacts immediately on activation, so activating one requires a
// guided acknowledgement checklist rather than a single click (see
// Sequences.tsx). Extracted as a pure predicate so it can be covered by a
// plain regression script (scripts/test-sequence-activation-gate.ts) without
// mounting the full dashboard page.
export function isGovernedSequence(seq: { sequenceFamily?: string | null; eligibleConsentTiers?: string[] | null } | null | undefined): boolean {
  return Boolean(seq?.sequenceFamily) || (seq?.eligibleConsentTiers?.length ?? 0) > 0;
}
