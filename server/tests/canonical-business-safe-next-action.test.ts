import assert from "node:assert/strict";
import { deriveCanonicalBusinessSafeNextAction } from "../services/canonical-business-safe-next-action";

const base = {
  masterLeadStatus: "discovered",
  emailDiscoveryStatus: "provider_valid",
  mainEmail: "owner@example.com",
  freeEnrichmentStatus: "complete",
};

assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  emailDiscoveryStatus: "discovered",
  mainEmail: null,
}), "run_email_discovery", "discovered without an email must request discovery");

assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  emailDiscoveryStatus: "discovered",
  mainEmail: "legacy@example.com",
}), "run_email_discovery", "a legacy email without provider validation is not valid");

assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "staged",
  conflictEvidenceAvailable: true,
  contactMatchAvailable: true,
  openConflictCount: 0,
}), "ready_to_promote");

assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "promoted",
  emailDiscoveryStatus: null,
}), "already_promoted", "promoted is terminal");
assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "suppressed",
  emailDiscoveryStatus: null,
}), "suppressed_no_action", "suppressed is terminal");

assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "staged",
  conflictEvidenceAvailable: false,
  contactMatchAvailable: true,
  openConflictCount: 0,
}), "resolve_conflicts_before_promotion", "a conflict query failure must fail closed");
assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "staged",
  conflictEvidenceAvailable: true,
  contactMatchAvailable: false,
  openConflictCount: 0,
}), "resolve_conflicts_before_promotion", "unknown contact-match state must fail closed");
assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "staged",
  conflictEvidenceAvailable: true,
  contactMatchAvailable: true,
  openConflictCount: 1,
}), "resolve_conflicts_before_promotion");
assert.equal(deriveCanonicalBusinessSafeNextAction({
  ...base,
  masterLeadStatus: "staged",
  conflictEvidenceAvailable: true,
  contactMatchAvailable: true,
  hasExistingContact: true,
  openConflictCount: 0,
}), "resolve_duplicate_contact_before_promotion");

console.log("Canonical business safe-next-action tests passed");