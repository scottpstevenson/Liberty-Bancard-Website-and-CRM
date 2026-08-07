/**
 * RETIRED ONE-TIME MIGRATION — DO NOT RUN.
 *
 * Status  : COMPLETED August 2026
 * Ran by  : Engineering team during Liberty Bancard sequence CTA audit
 *
 * What it did:
 *   Rewrote anchor CTA hrefs in sequence_steps email bodies — replaced
 *   incorrect GHL calendar booking URLs with the correct destination URLs
 *   (upload-statement, get-started, shop, free-analysis, etc.) based on
 *   button label text. Also updated variant_b_body for A/B steps.
 *
 * Safe to re-run? NO.
 *   Re-running will silently re-process all matching rows. The operation is
 *   a no-op for already-correct URLs, but it will log misleading "updated"
 *   counts and could overwrite any CTAs that were intentionally changed
 *   after the migration ran.
 *
 * If you're looking for CTA routing logic, see instead:
 *   - server/services/sequence-worker.ts   (live sequence processing)
 *   - server/routes/sequences.ts            (sequence management API)
 *   - client/src/pages/dashboard/Sequences.tsx (CTA editor UI)
 *
 * This file is kept in scripts/archive/ for audit-trail purposes ONLY.
 * The runnable code has been removed to prevent accidental re-execution.
 */
throw new Error(
  "RETIRED SCRIPT — reroute-sequence-ctas has already been executed.\n" +
  "Do NOT run this file again. See the header comment for full context."
);
