#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import { sanitizeDeadLetterEvent } from "../server/services/audit-sanitizer";

const raw = {
  jobId: 44, queueName: "new_lead", failureCode: "timeout",
  payload: { email: "person@example.com" }, stack: "secret stack",
  error: "raw provider body", callbackUrl: "https://provider.invalid/private",
  contactId: 12,
};
const snapshot = sanitizeDeadLetterEvent(raw);
const serialized = JSON.stringify(snapshot);
for (const forbidden of ["person@example.com", "secret stack", "raw provider body", "provider.invalid", "contactId"]) {
  assert(!serialized.includes(forbidden), `DLQ sanitizer leaked ${forbidden}`);
}
assert.equal(snapshot.jobId, 44);
assert.equal(snapshot.failureCode, "timeout");

const route = fs.readFileSync("server/routes/review-queue.ts", "utf8");
assert.match(route, /DLQ_CURSOR_VERSION/);
assert.match(route, /timingSafeEqual/);
assert.match(route, /MAX_DLQ_CURSOR_BYTES/);
assert.match(route, /dead-letter-events/);
const alerts = fs.readFileSync("server/services/alert-feed.ts", "utf8");
assert.match(alerts, /pg_advisory_xact_lock/);
assert.match(alerts, /system_alert_acknowledged/);
assert.doesNotMatch(alerts, /UPDATE audit_logs/);
console.log("Task 1720 DLQ/alert static checks passed");