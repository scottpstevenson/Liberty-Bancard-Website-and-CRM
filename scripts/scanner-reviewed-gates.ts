/**
 * Reviewed scoped send authorities that the compliance and queue scanners recognize by PROOF, not by file name.
 *
 * A file is recognized only while every marker below is still present in its source. Removing any one marker (the
 * negative control in `scripts/certification/test-stage4d-integrated-acceptance.ts`) makes the scanner fail again.
 * Each entry names the real runtime proof that exercises the gate; this module never relabels cold outreach as internal
 * and never bypasses the global pause authority or the SMTP boundary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReviewedScopedAuthority {
  file: string;
  /** Substrings that together are the reviewed gate. All must be present. */
  markers: string[];
  /** Honest class of the message (the seed is cold outreach to one operator-authorized mailbox, never internal). */
  messageClass: "operational_credential" | "transactional_receipt" | "protected_cold_outreach_seed";
  reason: string;
  runtimeProof: string;
}

export const REVIEWED_SCOPED_AUTHORITIES: ReviewedScopedAuthority[] = [
  {
    file: "server/services/partner-approval-delivery.ts",
    markers: ["authorize({})", "PARTNER_NO_LONGER_ACTIVE", "CREDENTIAL_ALREADY_SET", "NO_EMAIL_ON_FILE", "outbound_paused", 'category: "internal_ops"'],
    messageClass: "operational_credential",
    reason: "One-time partner portal credential link to the approved partner's own recorded address. Sent only while the partner is active, has an email on file and has not set a credential, and only when the global pause authority allows; an ambiguous outcome is never retried automatically.",
    runtimeProof: "scripts/certification/test-partner-approval-delivery.ts",
  },
  {
    file: "server/services/inbound-acknowledgement.ts",
    markers: ["describeSeedLeaseEligibility", "ackCapabilityAllows", "inboundAck: { effectId, attemptToken: token }", 'commercialPurpose: "transactional_response"', "effect_not_claimable"],
    messageClass: "transactional_receipt",
    reason: "Factual receipt to the mailbox a visitor submitted, under a default-closed capability, a one-winner claim and a per-message pause lease re-checked at the transport; never an unpause and never historical catch-up.",
    runtimeProof: "scripts/certification/test-inbound-acknowledgement.ts",
  },
  {
    file: "server/services/sfp-seed-test.ts",
    markers: ["describeSeedLeaseEligibility", "SEED_MAILBOX_IS_A_CONTACT", "seedAuthorizationProblem", "FOR UPDATE", "SEED_CONCURRENT_REQUEST", "seedTest: { receiptKey: key, occurrenceId }"],
    messageClass: "protected_cold_outreach_seed",
    reason: "Cold-sender seed to ONE operator-authorized, non-contact mailbox with a nonce, expiry, message cap, revocation and idempotent receipt; the global pause is not lifted (a per-message lease is granted by the pause authority). No contact, enrollment, release or capacity row is created.",
    runtimeProof: "scripts/certification/test-sfp-seed-test.ts",
  },
];

export function reviewedAuthorityFor(file: string): ReviewedScopedAuthority | undefined {
  return REVIEWED_SCOPED_AUTHORITIES.find((a) => a.file === file || file.endsWith(`/${a.file}`) || a.file.endsWith(`/${file}`));
}

export function missingMarkers(source: string, authority: ReviewedScopedAuthority): string[] {
  return authority.markers.filter((m) => !source.includes(m));
}

/** Returns the authority only when the live source still contains the whole reviewed gate. */
export function provenAuthority(file: string, cwd = process.cwd()): ReviewedScopedAuthority | undefined {
  const authority = reviewedAuthorityFor(file);
  if (!authority) return undefined;
  let source: string;
  try { source = readFileSync(join(cwd, authority.file), "utf8"); } catch { return undefined; }
  return missingMarkers(source, authority).length === 0 ? authority : undefined;
}
