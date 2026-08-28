#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { enforceAuditJson } from "./dependency-audit-policy";

const valid = JSON.stringify({
  metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 2, low: 1, total: 3 } },
});
assert.equal(enforceAuditJson(valid, 0).total, 3);
assert.equal(enforceAuditJson(valid, 1).moderate, 2, "npm exits 1 for allowed lower-severity findings");
assert.throws(() => enforceAuditJson("{", 1), /malformed/);
assert.throws(() => enforceAuditJson("{}", 0), /summary/);
assert.throws(() => enforceAuditJson(valid, 2), /scanner failed/);
assert.throws(
  () => enforceAuditJson(JSON.stringify({
    metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 } },
  }), 1),
  /rejected/,
);
console.log("test-dependency-audit-policy: PASS — clean, lower, high, malformed, and scanner-failure fixtures verified");