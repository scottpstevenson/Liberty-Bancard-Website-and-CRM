#!/usr/bin/env tsx
/**
 * Focused no-provider tests for Task #1698's canonical reply authority.
 * The decision reader is injected, so these assertions do not use a DB.
 */
import { decideReplySinceEnrollment } from "../server/services/communication-events";
import { readFile } from "node:fs/promises";

let failures = 0;
function assert(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures++;
    console.error(`✗ ${label}: expected ${expected}, received ${actual}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const enrolledAt = new Date("2025-01-01T00:00:00.000Z");
assert("inbound event is replied",
  await decideReplySinceEnrollment(1, enrolledAt, { findInboundSince: async () => true }),
  "REPLIED");
assert("empty canonical read is confirmed absent",
  await decideReplySinceEnrollment(1, enrolledAt, { findInboundSince: async () => false }),
  "CONFIRMED_ABSENT");
assert("DB failure is unavailable",
  await decideReplySinceEnrollment(1, enrolledAt, { findInboundSince: async () => { throw new Error("db down"); } }),
  "UNAVAILABLE");
assert("timeout is unavailable",
  await decideReplySinceEnrollment(1, enrolledAt, {
    timeoutMs: 1,
    findInboundSince: async () => new Promise<boolean>(() => {}),
  }),
  "UNAVAILABLE");

// Static boundary assertions: these validate the no-provider lost-claim paths
// without importing transport implementations or requiring a production DB.
const [sendLogSource, workerSource, ghlTransportSource, communicationSource, lockSource, leaseMigrationSource, campaignsRouteSource] = await Promise.all([
  readFile(new URL("../server/services/outbound-send-log.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/services/sequence-worker.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/services/transports/ghl-email-transport.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/services/communication-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/services/communication-contact-lock.ts", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0165_outbound_send_claim_lease.sql", import.meta.url), "utf8"),
  readFile(new URL("../server/routes/campaigns.ts", import.meta.url), "utf8"),
]);
assert("send claims carry a five-minute token lease",
  sendLogSource.includes("claim_token") &&
    sendLogSource.includes("claim_expires_at") &&
    sendLogSource.includes("INTERVAL '5 minutes'") &&
    sendLogSource.includes("randomUUID()"),
  true);
assert("only expired pending attempts are reclaimable",
  sendLogSource.includes("outbound_send_log.status = 'pending'") &&
    sendLogSource.includes("outbound_send_log.claim_expires_at < NOW()"),
  true);
assert("dispatching/failed/sent attempts are not reclaim predicates",
  !sendLogSource.includes("outbound_send_log.status = 'dispatching'") &&
    !sendLogSource.includes("outbound_send_log.status = 'failed'") &&
    !sendLogSource.includes("outbound_send_log.status = 'sent'"),
  true);
assert("email lost claim blocks provider path",
  workerSource.includes("if (emailSendClaimId === null)"),
  true);
assert("SMS lost claim blocks provider path",
  workerSource.includes("if (smsSendClaimId === null)"),
  true);
assert("GHL adapter does not inject a second footer",
  !ghlTransportSource.includes("injectCanSpamFooter"),
  true);
assert("dispatch authorization fences active enrollment step",
  sendLogSource.includes("enrollment.status = 'active'") &&
    sendLogSource.includes("enrollment.current_step = $5") &&
    sendLogSource.includes("send_attempt.claim_token = $2::uuid") &&
    sendLogSource.includes("send_attempt.claim_expires_at > NOW()"),
  true);
assert("dispatch authorization excludes canonical inbound",
  sendLogSource.includes("NOT EXISTS (") &&
    sendLogSource.includes("FROM communication_events AS inbound") &&
    sendLogSource.includes("inbound.created_at > $7"),
  true);
assert("inbound persistence failure is acknowledged",
  communicationSource.includes('throw new Error("Canonical inbound communication event persistence failed"'),
  true);
assert("dispatch authorization is a two-statement locked transaction",
  sendLogSource.includes('client.query("BEGIN")') &&
    sendLogSource.includes("pg_advisory_xact_lock") &&
    sendLogSource.indexOf("pg_advisory_xact_lock") < sendLogSource.indexOf("UPDATE outbound_send_log AS send_attempt"),
  true);
assert("inbound and dispatch use the same contact lock helper",
  sendLogSource.includes('from "./communication-contact-lock"') &&
    communicationSource.includes('from "./communication-contact-lock"') &&
    sendLogSource.includes("communicationContactLockKey(params.contactId)") &&
    communicationSource.includes("communicationContactLockKey(opts.contactId)") &&
    lockSource.includes("COMMUNICATION_CONTACT_LOCK_NAMESPACE"),
  true);
assert("lease migration adds token, expiry, and pending index",
  leaseMigrationSource.includes("claim_token uuid") &&
    leaseMigrationSource.includes("claim_expires_at timestamptz") &&
    leaseMigrationSource.includes("WHERE status = 'pending'"),
  true);
assert("human sequence mutation routes are retired without transport imports",
  campaignsRouteSource.includes("Human sequence enrollment creation is disabled") &&
    campaignsRouteSource.includes("Human sequence cohort enrollment is disabled") &&
    campaignsRouteSource.includes("Human sequence provider test sends are disabled") &&
    !campaignsRouteSource.includes("sendSmtpEmail") &&
    !campaignsRouteSource.includes("sequence_enrollment_resumed"),
  true);

if (failures) process.exit(1);