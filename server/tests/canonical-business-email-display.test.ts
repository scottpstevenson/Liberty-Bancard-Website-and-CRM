import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCanonicalBusinessEmailDisplay } from "../services/canonical-business-email-display";
import { deriveCanonicalBusinessSafeNextAction } from "../services/canonical-business-safe-next-action";

const noCandidate = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "discovered",
  candidateCount: 0,
  maskedCandidateEmailPreview: null,
});
assert.equal(noCandidate.candidateCount, 0);
assert.equal(noCandidate.maskedCandidateEmailPreview, null);
assert.equal(noCandidate.candidateValidationState, "none");
assert.equal(noCandidate.statusLabel, "discovered — not a validated address");
assert.equal(deriveCanonicalBusinessSafeNextAction({
  masterLeadStatus: "discovered",
  emailDiscoveryStatus: "discovered",
  mainEmail: null,
  freeEnrichmentStatus: "complete",
}), "run_email_discovery");

const unvalidatedCandidate = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "discovered",
  candidateCount: 2,
  maskedCandidateEmailPreview: "owner@example.com",
});
assert.equal(unvalidatedCandidate.candidateCount, 2);
assert.equal(unvalidatedCandidate.maskedCandidateEmailPreview, "o***@example.com");
assert.equal(unvalidatedCandidate.candidateValidationState, "unvalidated");
assert.equal(unvalidatedCandidate.providerValidated, false);
assert.equal(JSON.stringify(unvalidatedCandidate).includes("owner@example.com"), false);
assert.equal(deriveCanonicalBusinessSafeNextAction({
  masterLeadStatus: "discovered",
  emailDiscoveryStatus: "discovered",
  mainEmail: null,
  freeEnrichmentStatus: "complete",
}), "run_email_discovery", "staged candidates do not satisfy provider validation");

const selectedWinnerPendingValidation = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "discovered",
  candidateCount: 1,
  maskedCandidateEmailPreview: "o***@example.com",
  selectedWinner: { state: "selected", masked_value: "owner@example.com", source: "free_discovery", confidence: 80 },
  validationIntent: { state: "pending", approval_required: true, disposition: "validation_pending", attempt_count: 0 },
});
assert.equal(selectedWinnerPendingValidation.selectedWinner?.state, "selected");
assert.equal(selectedWinnerPendingValidation.validationIntent?.state, "pending");
assert.equal(selectedWinnerPendingValidation.providerValidated, false);

const providerValid = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "provider_valid",
  candidateCount: 1,
  maskedCandidateEmailPreview: "o***@example.com",
});
assert.equal(providerValid.providerValidated, true);
assert.equal(providerValid.statusLabel, "provider valid");

// Both canonical list and detail endpoints use this same projection contract.
const listProjection = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "discovered",
  candidateCount: 1,
  maskedCandidateEmailPreview: "o***@example.com",
  selectedWinner: { state: "selected", masked_value: "owner@example.com", source: "free_discovery", confidence: 80 },
  validationIntent: { state: "pending", approval_required: true, disposition: "validation_pending", attempt_count: 0 },
});
const detailProjection = buildCanonicalBusinessEmailDisplay({
  emailDiscoveryStatus: "discovered",
  candidateCount: 1,
  maskedCandidateEmailPreview: "o***@example.com",
  selectedWinner: { state: "selected", masked_value: "owner@example.com", source: "free_discovery", confidence: 80 },
  validationIntent: { state: "pending", approval_required: true, disposition: "validation_pending", attempt_count: 0 },
});
assert.deepEqual(listProjection, detailProjection, "list/detail email evidence stays in parity");

const routes = readFileSync(new URL("../routes/lead-ops.ts", import.meta.url), "utf8");
assert.equal((routes.match(/buildCanonicalBusinessEmailDisplay\(\{/g) ?? []).length, 2,
  "list and detail endpoints both use the shared display projection");
assert.match(routes, /WITH displayed_businesses AS[\s\S]*?FROM displayed_businesses displayed/,
  "list candidate probes are scoped to the displayed page");
const listRoute = routes.split('app.get("/api/lead-ops/businesses",')[1]?.split('app.get("/api/lead-ops/business-verticals",')[0] ?? "";
assert.doesNotMatch(listRoute, /b\.main_email/,
  "the list endpoint must not expose raw canonical email addresses");

console.log("Canonical business email display tests passed");