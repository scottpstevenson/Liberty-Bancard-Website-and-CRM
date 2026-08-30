import { createHash } from "crypto";

export const EMAIL_VALIDATION_POLICY_VERSION = 1;
export const EMAIL_VALIDATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type MarketingValidationReason =
  | "positive_current_evidence" | "missing_email" | "not_validated"
  | "risky_or_catch_all" | "invalid" | "provider_unavailable"
  | "stale_evidence" | "mismatched_email_token" | "mismatched_generation"
  | "identity_conflict" | "missing_prerequisite";

export type MarketingValidationDecision = {
  allowed: boolean;
  decision: "eligible" | "blocked" | "deferred" | "unavailable";
  reason: MarketingValidationReason;
  emailTokenHash: string | null;
  subjectGeneration: number | null;
  evidenceAt: Date | null;
  commercialResolutionSnapshotId?: string;
};

export type ValidationEvidence = {
  emailStatus?: string | null;
  emailTokenHash?: string | null;
  subjectGeneration?: number | null;
  evidenceGeneration?: number | null;
  verifiedAt?: Date | string | null;
  providerOutcome?: string | null;
};

export function normalizeEmailToken(email: string | null | undefined): string | null {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  if (normalized.endsWith(".internal") || normalized.startsWith("no-email-")) return null;
  return normalized;
}

export function hashEmailToken(email: string | null | undefined): string | null {
  const token = normalizeEmailToken(email);
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

export function decideMarketingEmailValidation(
  email: string | null | undefined,
  evidence: ValidationEvidence,
  now: Date = new Date(),
  maxAgeMs: number = EMAIL_VALIDATION_MAX_AGE_MS,
): MarketingValidationDecision {
  const tokenHash = hashEmailToken(email);
  const generation = evidence.subjectGeneration ?? null;
  const verifiedAt = evidence.verifiedAt ? new Date(evidence.verifiedAt) : null;
  const status = (evidence.providerOutcome ?? evidence.emailStatus ?? "").toLowerCase();
  if (!tokenHash) return { allowed: false, decision: "blocked", reason: "missing_email", emailTokenHash: null, subjectGeneration: generation, evidenceAt: null };
  if (evidence.emailTokenHash !== tokenHash) return { allowed: false, decision: "deferred", reason: "mismatched_email_token", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (generation === null || evidence.evidenceGeneration !== generation) return { allowed: false, decision: "deferred", reason: "mismatched_generation", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime()) || now.getTime() - verifiedAt.getTime() > maxAgeMs) return { allowed: false, decision: "deferred", reason: "stale_evidence", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (status === "valid") return { allowed: true, decision: "eligible", reason: "positive_current_evidence", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (["invalid", "unsafe", "bounced", "do_not_mail", "spam_trap", "abuse"].includes(status)) return { allowed: false, decision: "blocked", reason: "invalid", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (["unverified", "catch_all", "risky"].includes(status)) return { allowed: false, decision: "blocked", reason: "risky_or_catch_all", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  if (["not_configured", "budget_blocked", "circuit_blocked", "rate_limited", "timeout", "transport", "parse_error", "ambiguous_billing"].includes(status)) return { allowed: false, decision: "unavailable", reason: "provider_unavailable", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  return { allowed: false, decision: "deferred", reason: "not_validated", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
}