/**
 * CRO-08A Correction 4: schedule ACTIVATION (the pointer flip on
 * cro08a_schedule_definitions.active). Gate class shared by
 * schedule-authority.ts's pilot-ladder check (assertPilotLadderCompletion).
 *
 * This is a SEPARATE gate from the per-command
 * assertCro03cCommandAuthorityBeforeIo check (Correction 1's requirement):
 * that check still runs for every continuous_occurrence command regardless
 * of this gate. This gate only controls whether a schedule definition's
 * active pointer may ever be flipped to true.
 *
 * 2026-09-13: the separate certification-receipt ceremony (typed
 * confirmation + pricing snapshot + runtime attestation, formerly issued via
 * issueCro08aCertificationReceipt() and assertCurrentCro08aCertification())
 * was removed at the operator's request — a solo operator repeating that
 * ceremony on every release added no additional protection beyond the MI-09
 * pilot ladder and the existing $50 aggregate spend cap enforced per
 * command. Activating a CRO-08A schedule now only requires the pilot ladder
 * (assertPilotLadderCompletion() in schedule-authority.ts) to be complete.
 * The cro08a_certification_receipts table and its unused FK column on
 * cro08a_schedule_definitions were intentionally left in place rather than
 * dropped.
 *
 * Cro08aCertificationDeniedError below remains in use for the pilot-ladder
 * gate in schedule-authority.ts.
 */

export class Cro08aCertificationDeniedError extends Error {
  constructor(reason: string) {
    super(`CRO08A_CERTIFICATION_DENIED:${reason}`);
  }
}
