export interface CanonicalBusinessSafeNextActionInput {
  masterLeadStatus: string | null | undefined;
  emailDiscoveryStatus: string | null | undefined;
  mainEmail?: string | null;
  freeEnrichmentStatus: string | null | undefined;
  catchAllOutreachApprovedAt?: unknown;
  openConflictCount?: number;
  conflictEvidenceAvailable?: boolean;
  contactMatchAvailable?: boolean;
  hasExistingContact?: boolean;
}

/**
 * Derive the operator guidance for a canonical business.
 * Staged leads are never considered promotable unless conflict and duplicate
 * contact checks are known to have completed successfully.
 */
export function deriveCanonicalBusinessSafeNextAction(
  input: CanonicalBusinessSafeNextActionInput,
): string {
  const {
    masterLeadStatus,
    emailDiscoveryStatus,
    freeEnrichmentStatus,
    catchAllOutreachApprovedAt,
    openConflictCount = 0,
    conflictEvidenceAvailable = false,
    contactMatchAvailable = false,
    hasExistingContact = false,
  } = input;
  const emailValid = emailDiscoveryStatus === "provider_valid";

  if (masterLeadStatus === "promoted") return "already_promoted";
  if (masterLeadStatus === "suppressed") return "suppressed_no_action";

  if (masterLeadStatus === "staged") {
    if (!conflictEvidenceAvailable || !contactMatchAvailable || openConflictCount > 0) {
      return "resolve_conflicts_before_promotion";
    }
    if (emailValid && hasExistingContact) return "resolve_duplicate_contact_before_promotion";
    if (emailValid) return "ready_to_promote";
  }

  if (!emailDiscoveryStatus || emailDiscoveryStatus === "no_valid_candidate") {
    return "run_email_discovery";
  }
  if (emailDiscoveryStatus === "provider_catch_all" && !catchAllOutreachApprovedAt) {
    return "approve_catch_all_for_outreach";
  }
  if (!emailValid) return "run_email_discovery";
  if (freeEnrichmentStatus === null || freeEnrichmentStatus === "failed") {
    return "run_free_enrichment";
  }
  return "monitor";
}