import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateGhlInboundIdentity,
  findDuplicateGhlInboundIdentities,
  normalizeGhlInboundLocalContactRow,
  sanitizeGhlInboundContact,
} from "../server/services/ghl-inbound-sync";

const source = sanitizeGhlInboundContact({
  id: "ghl-001", firstName: "Remote", lastName: "Person", email: " New@Example.com ",
  phone: "+15550000000", companyName: "Remote Co", tags: ["must-not-copy"], customFields: [{ value: "private" }],
});
assert.deepEqual(source, {
  id: "ghl-001", firstName: "Remote", lastName: "Person", email: "new@example.com",
  phone: "+15550000000", companyName: "Remote Co",
});
assert.equal(sanitizeGhlInboundContact({ email: "x@example.com" }), null);
assert.equal(sanitizeGhlInboundContact({ id: { toString: () => "fake" }, email: "x@example.com" }), null);
assert.equal(sanitizeGhlInboundContact({ id: "x".repeat(201), email: "x@example.com" }), null);
assert.equal(evaluateGhlInboundIdentity(source!, []).kind, "create");

const existing = {
  id: 7, ghlContactId: null, email: "new@example.com", firstName: "", lastName: "Local",
  phone: "", companyName: "Local Co", archivedAt: null,
};
const byEmail = evaluateGhlInboundIdentity(source!, [existing]);
assert.equal(byEmail.kind, "update");
assert.deepEqual(byEmail.fill, { firstName: "Remote", phone: "+15550000000", ghlContactId: "ghl-001" });
assert.equal(byEmail.targetId, 7);
assert.equal(byEmail.reason, "existing_nonblank_value_preserved");
const snakeCaseLocal = normalizeGhlInboundLocalContactRow({
  id: 18, first_name: "Keep", last_name: "These", company_name: "Local Biz",
  email: "new@example.com", phone: "+15550000000", ghl_contact_id: null, archived_at: null,
});
const snakePlan = evaluateGhlInboundIdentity(source!, [snakeCaseLocal]);
assert.equal(snakePlan.fill.firstName, undefined);
assert.equal(snakePlan.fill.lastName, undefined);
assert.equal(snakePlan.fill.companyName, undefined);

assert.equal(evaluateGhlInboundIdentity(source!, [{ ...existing, ghlContactId: "other-ghl" }]).reason,
  "ghl_id_owned_by_different_contact");
assert.equal(evaluateGhlInboundIdentity(source!, [{ ...existing, email: "other@example.com", ghlContactId: "ghl-001" }]).reason,
  "linked_email_disagrees");
assert.equal(evaluateGhlInboundIdentity(source!, [{ ...existing, archivedAt: new Date() }]).kind, "conflict");
assert.equal(evaluateGhlInboundIdentity(source!, [existing, { ...existing, id: 8 }]).reason,
  "ambiguous_local_identity");
assert.equal(evaluateGhlInboundIdentity(source!, [], true).reason, "duplicate_remote_identity");
const otherRemote = sanitizeGhlInboundContact({ id: "ghl-002", email: "NEW@example.com", phone: "+15551112222" })!;
const crossPageDuplicates = findDuplicateGhlInboundIdentities([source!, otherRemote]);
assert.equal(crossPageDuplicates.emails.has("new@example.com"), true);
assert.equal(crossPageDuplicates.ids.has("ghl-001"), false);
assert.equal(evaluateGhlInboundIdentity(sanitizeGhlInboundContact({ id: "phone-only", phone: "+1 555 000 0000" })!, []).kind, "create");
assert.equal(evaluateGhlInboundIdentity(sanitizeGhlInboundContact({ id: "empty" })!, []).kind, "skip");
const partialUpdate = sanitizeGhlInboundContact({ id: "ghl-linked", firstName: "Fill", companyName: "Fill Co" })!;
assert.equal(evaluateGhlInboundIdentity(partialUpdate, [{
  id: 31, ghlContactId: "ghl-linked", email: "existing@example.com",
  firstName: "", lastName: "Kept", phone: "", companyName: "",
}]).kind, "update");
assert.equal(evaluateGhlInboundIdentity(partialUpdate, []).kind, "skip");

const service = await readFile(new URL("../server/services/ghl-inbound-sync.ts", import.meta.url), "utf8");
const writer = await readFile(new URL("../server/services/contact-writer.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../server/routes/ghl-inbound-sync.ts", import.meta.url), "utf8");
assert.match(service, /method: "GET"/);
assert.match(service, /mode: "ghl_inbound_no_echo"/);
assert.match(service, /deferValidation: true, deferReadiness: true/);
assert.match(service, /deferLeadScoring: true/);
assert.match(service, /suppressProviderProjection: true/);
assert.match(service, /GHL_INBOUND_GLOBAL_OUTBOUND_NOT_PAUSED/);
assert.match(service, /FOR SHARE/);
assert.match(service, /MAX_REMOTE_CONTACTS = 50_000/);
assert.match(service, /GHL_INBOUND_PAGINATION_INCOMPLETE/);
assert.match(service, /GHL_INBOUND_WEBHOOK_LOCATION_MISMATCH/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(writer, /CONTACT_WRITE_INVALID_GHL_INBOUND_HOOK_POLICY/);
assert.match(route, /requireRole\("admin"\)/);
assert.match(route, /json\(\{ run: await createGhlInboundPreview/);
assert.match(route, /Idempotency-Key/);
assert.doesNotMatch(service, /sendGhlEmail|sendGhlSms|enroll|scoreLead|paidValidation/i);
console.log("GHL inbound sync focused checks passed.");