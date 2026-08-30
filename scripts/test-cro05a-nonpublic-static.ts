#!/usr/bin/env tsx
/**
 * CRO-05A non-public adapter certification.  This remains source-only so it
 * can prove the default classifications without a database or provider.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");
const authority = read("server/services/inbound-request-authority.ts");
const contacts = read("server/routes/contacts.ts");
const imports = read("server/routes/imports.ts");
const sdr = read("server/routes/sdr.ts");
const ghlSync = read("server/services/ghl-sync.ts");

assert.match(contacts, /app\.post\("\/api\/contacts"[\s\S]*Idempotency-Key[\s\S]*claimInboundRequest/);
assert.match(contacts, /eventKey:\s*`manual:\$\{inboundClaim\.request\.id\}`/);
assert.match(contacts, /await orchestrateInboundRequest\(\{ requestId: inboundClaim\.request\.id, contactId: contact\.id \}\)/);
assert.doesNotMatch(contacts.slice(contacts.indexOf('app.post("/api/contacts"'), contacts.indexOf("// === COLD LEADS")), /\b(?:syncContactToGhl|enrollContactInGhlWorkflow|enqueuePromotionalEnrollment|sendPushToAllReps)\s*\(/);

assert.match(imports, /CSV rows are acquisition evidence, never an inbound occurrence/);
assert.doesNotMatch(imports.slice(imports.indexOf("for (const _row of result)"), imports.indexOf("} catch (batchErr")), /\b(?:claimInboundRequest|createDeal|scoreContact)\s*\(/);
assert.match(authority, /sourceCategory: "csv_import"[\s\S]*sourceClass: "imported_provider_event"/);
assert.match(ghlSync, /sourceCategory: "ghl_sync",[\s\S]*sourceType: "inbound"/);
assert.doesNotMatch(ghlSync, /\bclaim(?:InboundRequest|VerifiedProviderEvent)\s*\(/);
assert.doesNotMatch(ghlSync.slice(ghlSync.indexOf("const stableEventKey"), ghlSync.indexOf("return { contactId: contact.id, created: true }")), /\benqueuePromotionalEnrollment\s*\(/);
assert.match(imports, /app\.post\("\/api\/affiliate\/referral"[\s\S]*Idempotency-Key[\s\S]*occurrenceKey:\s*`partner-referral:\$\{partner\.id\}:\$\{idempotencyKey\}`/);
assert.match(imports, /eventKey:\s*`partner-referral:\$\{inboundClaim\.request\.id\}`/);
assert.match(imports, /await orchestrateInboundRequest\(\{ requestId: inboundClaim\.request\.id, contactId: contact\.id \}\)/);

for (const sourceType of ["inbound_message", "inbound_call", "appointment_booked", "chat_message", "chat_booking"]) {
  assert.match(authority, new RegExp(`sourceType: "${sourceType}"[\\s\\S]{0,250}sourceClass: "lifecycle_event"`));
  assert.match(sdr, new RegExp(`claimExplicitGhlOccurrence\\("${sourceType}"`));
}
assert.match(sdr, /claimVerifiedProviderEvent/);
assert.match(authority, /export function providerEventCommandId/);
assert.match(authority, /occurrenceKey: `ghl:\$\{input\.sourceType\}:\$\{input\.eventId\}`/);

console.log("CRO-05A non-public static certification passed");