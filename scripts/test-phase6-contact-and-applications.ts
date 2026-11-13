/**
 * Phase 6 Contact and Applications contracts (no database): the Contact header is a person with a separately verified business
 * and a three-state consent; documents are lifecycle-aware and create no request; the Applications Draft filter covers both draft
 * states with one filter for list and count, and the production record scope never hides unknown-class records silently.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  businessIdentity, consentState, contactDisplayName, headerNextAction, personName, sharedNotRecordedNote,
} from "../client/src/lib/contact-header-presentation";
import { expectedDocumentsFor } from "../client/src/lib/contact-documents-stage";
import { applicationStatuses } from "../client/src/lib/crm-destination-state";
import { DRAFT_STATUSES, statusesForFilter } from "../shared/merchant-application-status";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── CRM-18: a Contact is a person ───────────────────────────────────────────────────────────────────────────────────
eq(personName({ firstName: " Ada ", lastName: "Lovelace" }), "Ada Lovelace", "the person name is the first and last name");
eq(personName({ companyName: "Acme" }), null, "a company name is never a person name");
eq(contactDisplayName({ companyName: "Acme Pizza" }), "Acme Pizza", "with no person recorded the best identifier is used");
eq(contactDisplayName({ email: "a@b.test" }), "a@b.test", "email is the next best identifier");
eq(contactDisplayName({}), "Unnamed Contact", "an empty record still gets a heading");
eq(contactDisplayName({ firstName: "Ada", companyName: "Acme" }), "Ada", "the person outranks the company field");

const verified = businessIdentity({ companyName: "Acme" }, { state: "verified", businessName: "Acme LLC" });
ok(verified.tone === "verified" && verified.verifiedName === "Acme LLC" && verified.enteredName === "Acme", "a verified link shows the recorded business beside the entered name");
for (const state of ["missing", "none", "legacy_unknown"] as const) {
  const view = businessIdentity({ companyName: "Acme" }, { state });
  ok(view.tone === "neutral" && view.verifiedName === null && view.relationshipLabel.includes("not verified"), `${state}: an entered name is never presented as verified`);
}
eq(businessIdentity({}, { state: "none" }).relationshipLabel, "No business recorded", "no business and no link says so");
ok(businessIdentity({ companyName: "Acme" }, { state: "conflicted", businessName: "Other Co" }).relationshipLabel.includes("candidate: Other Co"), "a conflict names the candidate and needs review");
eq(businessIdentity({ companyName: "Acme" }, { state: "conflicted", businessName: "Other Co" }).verifiedName, null, "a conflicted link never provides a verified name");
eq(businessIdentity({ companyName: "Acme" }, { state: "rejected" }).tone, "attention", "a rejected link needs attention");
eq(businessIdentity({ companyName: "Acme" }, { state: "unavailable" }).relationshipLabel, "Business relationship unavailable right now", "a failed read is unavailable, not none");
eq(businessIdentity({ companyName: "Acme" }, undefined).relationshipLabel, "Business relationship not yet loaded", "a missing fact reads as not yet loaded");

eq(consentState({ consentEmail: true }, "email").state, "recorded", "recorded email consent");
eq(consentState({}, "email").state, "not_recorded", "no consent value is not recorded, not denied");
ok(consentState({}, "sms").label.includes("not a refusal"), "the not-recorded label says it is not a refusal");
{
  // Compact header: the explanation is said once only when both channels are not recorded; mixed states keep their own labels.
  const both = sharedNotRecordedNote(consentState({}, "email"), consentState({}, "sms"));
  ok(both?.note.includes("not a refusal") === true && both?.short === "Not recorded", "both channels not recorded: one shared 'unknown, not a refusal' note");
  eq(sharedNotRecordedNote(consentState({ consentEmail: true }, "email"), consentState({}, "sms")), null, "a recorded channel next to a not-recorded one keeps full per-channel labels");
  eq(sharedNotRecordedNote(consentState({ doNotContact: true }, "email"), consentState({ doNotContact: true }, "sms")), null, "a denial is never folded into the shared note");
  const entered = businessIdentity({ companyName: "Acme" }, { state: "none" });
  ok(entered.relationshipLabel.includes("not verified") && /no reviewed business link verifies it/.test(entered.relationshipTitle), "the short entered-name label keeps its full explanation as the title");
}
eq(consentState({ doNotContact: true, consentEmail: true }, "email").state, "denied", "do-not-contact wins over a recorded consent");
eq(consentState({ emailStatus: "Unsubscribed", consentEmail: true }, "email").state, "denied", "an unsubscribed address is denied for email");
eq(consentState({ emailStatus: "unsubscribed" }, "sms").state, "not_recorded", "an email unsubscribe does not deny SMS");

eq(headerNextAction({ nextFollowUp: undefined, activeDealId: 9, pendingTask: null, pendingTasksLoaded: false }).text, "Scheduled action unavailable", "an unloaded read is unavailable, not none");
eq(headerNextAction({ nextFollowUp: null, activeDealId: null, pendingTask: null, pendingTasksLoaded: true }).text, "No next action scheduled", "a loaded empty read says none");
const task = headerNextAction({ nextFollowUp: null, activeDealId: null, pendingTask: { id: 12, title: "Call back" }, pendingTasksLoaded: true });
ok(task.text === "Complete task: Call back" && task.href === "/dashboard/tasks-appointments?tab=tasks&taskId=12", "a pending task links to that exact task");
eq(headerNextAction({ nextFollowUp: "bogus", activeDealId: 9, pendingTask: null, pendingTasksLoaded: true }).text, "Follow-up date needs review", "an invalid follow-up date is reported");
eq(headerNextAction({ nextFollowUp: "2026-12-01T15:00:00Z", activeDealId: 9, pendingTask: null, pendingTasksLoaded: true }).href, "/dashboard/pipeline?id=9", "a follow-up links to the active deal");

// Documents: lifecycle-aware, display only.
eq(expectedDocumentsFor({ lifecycleState: "PROSPECT" }).expected, [], "an early lead is asked for nothing");
eq(expectedDocumentsFor({ lifecycleState: "engaged" }).purpose, "early", "state matching ignores case");
eq(expectedDocumentsFor({ lifecycleState: "STATEMENT_REQUESTED" }).expected.map(d => d.category), ["Processing Statement"], "a statement-stage lead is asked only for a statement");
ok(expectedDocumentsFor({ lifecycleState: "STATEMENT_REQUESTED" }).note.includes("once underwriting begins"), "the note says when other documents begin");
eq(expectedDocumentsFor({ lifecycleState: "APPLICATION_STARTED" }).expected.map(d => d.category), ["Application", "Processing Statement"], "an application stage does not ask for ID or banking");
eq(expectedDocumentsFor({ lifecycleState: "UNDERWRITING" }).expected.map(d => d.category), ["Application", "Photo ID", "Voided Check", "Processing Statement"], "underwriting lists the sensitive documents");
eq(expectedDocumentsFor({ lifecycleState: "ACTIVE_PROCESSING" }).expected, [], "a processing account is asked for nothing automatically");
eq(expectedDocumentsFor({ lifecycleState: "CHURNED" }).purpose, "ended", "a closed relationship is not asked for anything");
eq(expectedDocumentsFor({ lifecycleState: null }).purpose, "unknown", "an unrecorded stage lists nothing as required");
eq(expectedDocumentsFor({ lifecycleState: "SOMETHING_NEW" }).expected, [], "an unrecognized stage lists nothing as required");
eq(expectedDocumentsFor({ lifecycleState: "PROSPECT", isPartner: true }).expected.map(d => d.category), ["EIN Letter", "Signed Proposal"], "a partner contact lists partner documents");
const documents = read("client/src/lib/contact-documents-stage.ts");
ok(!/apiRequest|fetch\(|useMutation/.test(documents), "the document expectation module cannot create a request");

// ── CRM-19: the Draft filter and the Applications list contract ─────────────────────────────────────────────────────
ok(applicationStatuses.includes("in_progress") && applicationStatuses.includes("draft"), "both draft states are valid URL selections");
eq(statusesForFilter("draft"), [...DRAFT_STATUSES], "the server's Draft filter covers every draft status");
ok(DRAFT_STATUSES.includes("in_progress" as never) && DRAFT_STATUSES.includes("draft" as never), "draft and in_progress are both inside it");
eq(statusesForFilter("approved"), ["approved"], "other filters stay exact");
const list = read("client/src/pages/dashboard/MerchantApplicationsList.tsx");
ok(list.includes('{ value: "draft", label: "Draft + in progress" }'), "the tab says it includes in-progress applications");
ok(list.includes('statusState.value==="in_progress" ? "draft" : statusState.value'), "a retained in_progress selection resolves to the one Draft tab, not to an unsupported status");
ok(list.includes('params.set("recordScope", recordScope)') && list.includes("recordScope]"), "the record scope is sent to the server and part of the cache key");
ok(list.includes('useState<"production" | "all">("production")'), "production is the default scope");
ok(list.includes("hidden by this filter"), "the number removed by the record-class rule is stated");
ok(list.includes("text-draft-filter-scope"), "the Draft tab states that the count and list share one filter");
const route = read("server/routes/merchants.ts");
ok(route.includes('code: "INVALID_RECORD_SCOPE"'), "an unsupported recordScope is a 400, never a silent broadening");
ok(route.includes("hiddenByRecordClass: page.hiddenByRecordClass"), "the response carries the hidden count");
const model = read("server/services/merchant-application-read-model.ts");
ok(model.includes('NON_PRODUCTION_CLASSES = ["test", "demo", "synthetic"]'), "only authoritative non-production classes are hidden");
ok(!model.includes('"unknown"]') && model.includes("`unknown` is unreviewed, not test"), "unknown-class records stay visible");
ok(model.includes("productionScope()") && model.split("productionScope()").length >= 3, "the list and the pending count share the same scope rule");
ok(model.includes("opts.recordScope === \"all\" ? \"all\" : \"production\""), "anything but all is production");

console.log(`phase6 contact and applications: ${checks} checks passed`);
