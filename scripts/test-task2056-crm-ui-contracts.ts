#!/usr/bin/env tsx
/**
 * Task #2056 CRM UI source-contract regression checks.
 *
 * These assertions cover the parts of the CRM contract that were previously
 * implicit in component markup: NBA field casing/null handling, explicit
 * blocked/error states, proposed-vs-verified contact language, and masked
 * candidate evidence with unavailable-state messaging.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const contact = readFileSync("client/src/pages/dashboard/ContactDetail.tsx", "utf8");
const business = readFileSync("client/src/pages/dashboard/LeadOps/BusinessDetailPage.tsx", "utf8");
const prospecting = readFileSync("client/src/components/lead-ops/SouthFloridaProspectingPanel.tsx", "utf8");
const leadOps = readFileSync("client/src/pages/dashboard/LeadOpsCenter.tsx", "utf8");
const nbaRoute = readFileSync("server/routes/nba.ts", "utf8");

assert.match(nbaRoute, /actionType:\s*nba\.actionType/);
assert.match(nbaRoute, /reasonCode:\s*nba\.reasonCode/);
assert.match(contact, /actionType:\s*string\s*\|\s*null/);
assert.match(contact, /reasonCode:\s*string\s*\|\s*null/);
assert.match(contact, /nba\.actionType\s*\?\?\s*"Recommended action"/);
assert.match(contact, /nba\.reasonCode\s*\?\?\s*"Reason not provided"/);
assert.match(contact, /nba\.dueAt/);
assert.doesNotMatch(contact, /nba\.(?:action_type|reason_code|due_at|owner_role)/);
assert.match(contact, /data-testid="nba-load-error"/);
assert.match(contact, /This recommendation is blocked/);
assert.match(contact, /never sends outreach/);

assert.match(business, /Potential contact candidate · not a verified link/);
assert.match(business, /Match evidence and an authoritative identity-review decision are not included/);
assert.match(business, /No potential contact candidate was returned/);
assert.match(business, /Contact candidate and verification status unavailable/);

assert.match(prospecting, /Candidate evidence \(masked\)/);
assert.match(prospecting, /bestCandidateMasked/);
assert.match(prospecting, /per-candidate source, observation time, or validation receipt details/);
assert.match(prospecting, /label="Candidate preview"/);
assert.match(prospecting, /Progress counters are unavailable; they are not zero/);

assert.match(leadOps, /user\?\.role === "admin" && <ContactBusinessReconciliationPanel \/>/);
assert.match(leadOps, /CONTACT_RECONCILIATION_PATH = "\/api\/admin\/contact-business-reconciliation"/);
assert.match(leadOps, /CONTACT_SUGGESTIONS_PATH = "\/api\/admin\/contact-business-suggestions"/);
assert.match(leadOps, /CONTACT_RECONCILIATION_PATH}\//);
assert.match(leadOps, /CONTACT_SUGGESTIONS_PATH}\/review-batch/);
assert.match(leadOps, /apiRequest\("POST"/);
assert.match(leadOps, /Resume next bounded batch/);
assert.match(leadOps, /Pause/);
assert.match(leadOps, /currentRevision/);
assert.match(leadOps, /evidenceSourceEventId: evidenceId/);
assert.match(leadOps, /maskContactEmail/);
assert.match(leadOps, /Suggestion only · not verified/);
assert.match(leadOps, /Ambiguous — do not verify/);
assert.match(leadOps, /No suggestions on this page/);

console.log("Task #2056 CRM UI contracts: all assertions passed.");