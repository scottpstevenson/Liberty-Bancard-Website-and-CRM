#!/usr/bin/env tsx
/**
 * Protected-object authority structural gate.
 * Runs without a database and ensures read-like operations cannot regress to
 * reference-only access or link inbound rows to protected-object internal IDs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authority = readFileSync("server/services/protected-object.ts", "utf8");
const schema = readFileSync("shared/schema.ts", "utf8");
const migration = readFileSync("migrations/0204_cro05a_inbound_revenue_operations.sql", "utf8");

for (const operation of ["getProtectedObject", "getProtectedObjectMetadata", "markProtectedObjectDeleted"]) {
  assert.match(
    authority,
    new RegExp(`export async function ${operation}\\([\\s\\S]{0,180}authorization: ProtectedObjectAuthorizationContext`),
    `${operation} must require an authorization context`,
  );
}

assert.match(authority, /PROTECTED_OBJECT_AUTH_CONTEXT_REQUIRED/);
for (const field of ["tenantScope", "environmentScope"]) {
  assert.match(authority, new RegExp(`eq\\(protectedObjects\\.${field}, context\\.${field}\\)`));
}
assert.match(authority, /eq\(protectedObjects\.legalHold, false\)/);
assert.match(authority, /PROTECTED_OBJECT_CHECKSUM_MISMATCH/);

assert.match(schema, /protectedObjectRef: uuid\("protected_object_ref"\)\.references\(\(\) => protectedObjects\.objectRef\)/);
assert.doesNotMatch(schema, /protectedObjectId: uuid\("protected_object_id"\)/);
assert.match(migration, /protected_object_ref UUID REFERENCES protected_objects\(object_ref\)/);
assert.doesNotMatch(migration, /protected_object_id UUID REFERENCES protected_objects\(id\)/);

console.log("Protected-object authority static certification passed");