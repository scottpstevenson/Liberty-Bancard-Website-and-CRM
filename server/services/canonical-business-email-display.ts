export interface CanonicalBusinessEmailDisplayInput {
  emailDiscoveryStatus: string | null | undefined;
  candidateCount: number | null | undefined;
  maskedCandidateEmailPreview: string | null | undefined;
  selectedWinner?: {
    state?: string | null;
    masked_value?: string | null;
    source?: string | null;
    confidence?: number | null;
  } | null;
  validationIntent?: {
    state?: string | null;
    approval_required?: boolean | null;
    disposition?: string | null;
    attempt_count?: number | null;
  } | null;
}

function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator === value.length - 1) return null;
  return `${value.slice(0, 1)}***@${value.slice(separator + 1)}`;
}

/** Display-only projection: staged candidates remain explicitly unvalidated. */
export function buildCanonicalBusinessEmailDisplay(input: CanonicalBusinessEmailDisplayInput) {
  const candidateCount = Math.max(0, Number(input.candidateCount ?? 0));
  const status = input.emailDiscoveryStatus ?? null;
  const winner = input.selectedWinner;
  const intent = input.validationIntent;

  return {
    candidateCount,
    maskedCandidateEmailPreview: candidateCount > 0 ? maskEmail(input.maskedCandidateEmailPreview) : null,
    candidateValidationState: candidateCount > 0 ? "unvalidated" as const : "none" as const,
    providerValidated: status === "provider_valid",
    statusLabel: status === "discovered"
      ? "discovered — not a validated address"
      : status?.replace(/_/g, " ") ?? "not started",
    selectedWinner: winner ? {
      state: winner.state ?? null,
      maskedValue: maskEmail(winner.masked_value),
      source: winner.source ?? null,
      confidence: winner.confidence ?? null,
    } : null,
    validationIntent: intent ? {
      state: intent.state ?? null,
      approvalRequired: intent.approval_required ?? false,
      disposition: intent.disposition ?? null,
      attemptCount: intent.attempt_count ?? 0,
    } : null,
  };
}