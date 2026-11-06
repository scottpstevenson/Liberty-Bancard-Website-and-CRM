/**
 * Merchant Application Outbox Worker — v2
 * =========================================
 * Hardened improvements:
 *   2. No catch-and-swallow. Required effects (GHL/consent/risk/email/deal/
 *      lifecycle) propagate errors so the row stays retryable. Optional/not-
 *      configured paths are explicitly classified only where truthful.
 *   3. Finalize/status effects are individually-keyed rows (contact_link,
 *      consent_record, ghl_sync, workflow_enroll, risk_scan, approval_email,
 *      deal_stage, lifecycle_approved, decline_email, lifecycle_declined).
 *      Each handler checks durable evidence before reapplying.
 *   4. Stale processing rows (locked > 10 min) are reclaimed as pending on
 *      each tick. Terminal rows become dead_letter (attempts >= MAX_ATTEMPTS).
 *      last_error is scrubbed through audit-sanitizer before persist/log.
 */

import { sql, eq, lt, and } from "drizzle-orm";
import { db, pool } from "../db";
import { merchantApplications, merchantApplicationProtectedOutbox, contacts, auditLogs, deals } from "@shared/schema";
import { storage } from "../storage";
import { applyEsignDocumentState, applyEsignSendState } from "./merchant-application-service";
import { createContactLocalFirst } from "./contact-writer";
import { isLocalOutboxWorkerSelected } from "./background-profile";
import { isAmbiguousDispatchMessage } from "./ghl-dispatch-recorder";

const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 15_000;
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 min
const BASE_BACKOFF_MS = 30_000;

let started = false;
let running = false;

/**
 * A prerequisite wait (outbound paused, contact not linked yet, GHL id not yet
 * populated) is not a failed attempt. It must not consume the retry budget or
 * reach dead_letter; the row stays pending and is re-checked on a fixed, bounded
 * interval. Genuine failures keep the exponential backoff and attempt budget.
 */
export class OutboxWaitError extends Error {
  constructor(public readonly reason: "outbound_paused" | "contact_not_linked" | "ghl_contact_pending" | "contact_link_ambiguous" | "contact_link_conflict") {
    super(`outbox wait: ${reason}`);
    this.name = "OutboxWaitError";
  }
}
const WAIT_RECHECK_MS = 5 * 60 * 1000;

/**
 * The effect's outcome is unknown or the step must not be repeated (a recipient-facing send may already have been
 * delivered). The row is parked in dead_letter with an allowlisted `held:<code>` marker for operator recovery;
 * it is never retried automatically and never counted as delivered.
 */
export class OutboxHoldError extends Error {
  constructor(public readonly code: "possible_send_unconfirmed" | "esign_state_update_refused" | "workflow_enroll_not_delivered") {
    super(`outbox hold: ${code}`);
    this.name = "OutboxHoldError";
  }
}

/** The originating transition is no longer current; the queued effect was recorded and skipped. */
class EffectObsoleteError extends Error {
  constructor() { super("outbox effect obsolete"); this.name = "EffectObsoleteError"; }
}

/** This worker no longer owns the row (stale reclaim handed it to a newer claim). No effect may run. */
export class ClaimLostError extends Error {
  constructor() { super("outbox claim lost"); this.name = "ClaimLostError"; }
}

/** Test-only effect seams (honoured only when NODE_ENV === "test"); production always uses the real adapters. */
const testOverrides: {
  approvedEmail?: (input: any, hooks: any) => Promise<any>;
  declinedEmail?: (input: any, hooks: any) => Promise<any>;
  sendDocumentForEsign?: (opts: any) => Promise<any>;
  enroll?: (params: any) => Promise<any>;
} = {};
const override = <K extends keyof typeof testOverrides>(k: K) => (process.env.NODE_ENV === "test" ? testOverrides[k] : undefined);

/** Current-claim check, run immediately before an effect (and before each recipient-facing dispatch). */
async function assertCurrentClaim(row: { id: string; attempts: number }): Promise<void> {
  const res = await db.execute(sql`
    SELECT 1 FROM merchant_application_protected_outbox
    WHERE id = ${row.id} AND status = 'processing' AND attempts = ${row.attempts}`);
  const rows = (res as any).rows ?? res;
  if (!rows || rows.length === 0) throw new ClaimLostError();
}

/**
 * Atomic effect fence. Locks the outbox row for the duration of `fn` (only while this worker still owns the claim),
 * so a stale reclaim or newer claim cannot take the row over between the ownership check and the effect, and runs
 * `fn` inside that same transaction. `fn` receives the transaction executor for transaction-bound writes.
 * Never wrap provider network I/O in this fence; use it for the dispatch-start marker and for local effects.
 */
async function withOwnedClaim<T>(row: { id: string; attempts: number }, fn: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      SELECT 1 FROM merchant_application_protected_outbox
      WHERE id = ${row.id} AND status = 'processing' AND attempts = ${row.attempts}
      FOR UPDATE`);
    const rows = (res as any).rows ?? res;
    if (!rows || rows.length === 0) throw new ClaimLostError();
    return fn(tx);
  });
}

/** Claim-fenced durable marker: ownership is verified and the marker committed in one transaction. */
async function recordFencedMarker(row: { id: string; attempts: number }, action: string, appId: number, details: Record<string, unknown>): Promise<void> {
  await withOwnedClaim(row, async (tx) => {
    await storage.createAuditLog({ action, entityType: "merchant_application", entityId: appId, details }, tx);
  });
}

/**
 * The originating transition of a status effect (approved/declined) must still be the application's current
 * status; an obsolete queued effect is recorded and skipped, never applied after a later transition.
 */
async function statusEffectIsCurrent(tx: any, row: OutboxRow, expected: "approved" | "declined", record = true): Promise<boolean> {
  const res = await tx.execute(sql`SELECT status FROM merchant_applications WHERE id = ${row.applicationId}`);
  const current = ((res as any).rows ?? res)?.[0]?.status as string | undefined;
  if (current === expected) return true;
  if (record) await storage.createAuditLog({
    action: "merchant_application_effect_obsolete", entityType: "merchant_application", entityId: row.applicationId,
    details: { outboxId: row.id, eventType: row.eventType, expected, current: current ?? null },
  }, tx);
  return false;
}

async function assertOutboundNotPaused(): Promise<void> {
  const { authorize } = await import("./outbound-pause-authority");
  const decision = await authorize({});
  if (!decision.allowed) throw new OutboxWaitError("outbound_paused");
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), 30 * 60 * 1000);
}

/**
 * Return ONLY a safe, non-sensitive error class/code for persistence & logging.
 * Arbitrary error.message / provider response text is NEVER returned, because it
 * can embed PII, secrets, or provider payloads that the audit sanitizer (which
 * only strips known KEYS, not arbitrary VALUES) would happily pass through.
 * We emit the error's constructor name plus an optional allowlisted code.
 */
const SAFE_ERROR_CODE_ALLOWLIST = new Set<string>([
  "23505", // unique_violation
  "23503", // foreign_key_violation
  "23502", // not_null_violation
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
]);

function scrubError(err: unknown): string {
  if (err instanceof Error) {
    const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name) ? err.name : "Error";
    const rawCode = (err as any)?.code;
    const code = typeof rawCode === "string" && SAFE_ERROR_CODE_ALLOWLIST.has(rawCode) ? rawCode : undefined;
    return code ? `${name}:${code}` : name;
  }
  // Never stringify unknown values (may be a raw provider response object).
  return "NonError";
}

interface OutboxRow {
  id: string;
  applicationId: number;
  eventType: string;
  payload: Record<string, any>;
  attempts: number;
}

/** Claim one claimable pending/failed row atomically (SKIP LOCKED). */
async function claimOne(): Promise<OutboxRow | null> {
  const res = await db.execute(sql`
    UPDATE merchant_application_protected_outbox
    SET status = 'processing', locked_at = now(), updated_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM merchant_application_protected_outbox
      WHERE status IN ('pending', 'failed')
        AND attempts < ${MAX_ATTEMPTS}
        AND (available_at IS NULL OR available_at <= now())
      ORDER BY available_at ASC NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, application_id, event_type, payload, attempts
  `);
  const rows = (res as any).rows ?? res;
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    applicationId: r.application_id,
    eventType: r.event_type,
    payload: r.payload ?? {},
    attempts: r.attempts,
  };
}

/** Reclaim stale processing rows (locked > STALE_LOCK_MS) as pending. */
async function reclaimStale(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);
  await db
    .update(merchantApplicationProtectedOutbox)
    .set({ status: "pending", lockedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(merchantApplicationProtectedOutbox.status, "processing"),
        lt(merchantApplicationProtectedOutbox.lockedAt, staleThreshold),
      ),
    );
}

/**
 * Claim-fenced settlement (S5-06): only the claim that still owns the row
 * (status='processing' with the same attempt counter) may settle it, so a
 * worker resuming after a stale reclaim cannot overwrite a newer claim's or a
 * terminal outcome. Returns whether this call settled the row.
 */
function ownedClaim(id: string, attempts: number) {
  return and(
    eq(merchantApplicationProtectedOutbox.id, id),
    eq(merchantApplicationProtectedOutbox.status, "processing"),
    eq(merchantApplicationProtectedOutbox.attempts, attempts),
  );
}

async function markDelivered(id: string, attempts: number): Promise<boolean> {
  const settled = await db
    .update(merchantApplicationProtectedOutbox)
    .set({ status: "delivered", processedAt: new Date(), lockedAt: null, updatedAt: new Date(), lastError: null })
    .where(ownedClaim(id, attempts))
    .returning({ id: merchantApplicationProtectedOutbox.id });
  return settled.length > 0;
}

async function markRetryOrDeadLetter(id: string, attempts: number, err: unknown): Promise<void> {
  if (err instanceof OutboxWaitError) {
    // Give back the attempt consumed by claimOne(); a wait is not a failure.
    await db
      .update(merchantApplicationProtectedOutbox)
      .set({
        status: "pending",
        lockedAt: null,
        attempts: sql`GREATEST(${merchantApplicationProtectedOutbox.attempts} - 1, 0)`,
        lastError: `waiting:${err.reason}`,
        availableAt: new Date(Date.now() + WAIT_RECHECK_MS),
        updatedAt: new Date(),
      })
      .where(ownedClaim(id, attempts));
    return;
  }
  if (err instanceof OutboxHoldError) {
    await db
      .update(merchantApplicationProtectedOutbox)
      .set({ status: "dead_letter", lockedAt: null, lastError: `held:${err.code}`, availableAt: new Date(), updatedAt: new Date() })
      .where(ownedClaim(id, attempts));
    return;
  }
  const safeErr = scrubError(err);
  const terminal = attempts >= MAX_ATTEMPTS;
  await db
    .update(merchantApplicationProtectedOutbox)
    .set({
      status: terminal ? "dead_letter" : "pending",
      lockedAt: null,
      lastError: safeErr,
      availableAt: terminal ? new Date() : new Date(Date.now() + backoffMs(attempts)),
      updatedAt: new Date(),
    })
    .where(ownedClaim(id, attempts));
}

// ── Durable evidence helpers ──────────────────────────────────────────────

/** Check audit_logs for evidence of a completed action on this entity. */
async function hasAuditEvidence(action: string, entityType: string, entityId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.entityType, entityType),
        eq(auditLogs.entityId, entityId),
      ),
    )
    .limit(1);
  return !!row;
}

// ── Individual effect handlers (no catch-and-swallow) ─────────────────────

async function handleContactLink(row: OutboxRow): Promise<void> {
  const appId = row.applicationId;
  const p = row.payload;
  const contactEmail: string | null = (p.ownerEmail || p.businessEmail) as string | null;

  const [appRow] = await db
    .select({ contactId: merchantApplications.contactId, dealId: merchantApplications.dealId })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!appRow) throw new Error(`Application #${appId} not found`);

  // Already linked (by the applicant flow, a prefill binding or an operator) — idempotent.
  if (appRow.contactId) return;

  if (!contactEmail) return; // no email: nothing to link

  // S5-05: mailbox uniqueness is not guaranteed, so a mailbox can resolve to several contacts. Never pick
  // one arbitrarily; hold the step (and every step that needs the link) for an operator to link explicitly.
  const matches = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${contactEmail.toLowerCase()}`)
    .limit(3);
  if (matches.length > 1) throw new OutboxWaitError("contact_link_ambiguous");

  let dealContactId: number | null = null;
  if (appRow.dealId) {
    const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, appRow.dealId)).limit(1);
    dealContactId = d?.contactId ?? null;
  }
  // The deal the application is bound to already names its contact; a different mailbox owner is a conflict.
  if (dealContactId != null && matches.length === 1 && matches[0].id !== dealContactId) {
    throw new OutboxWaitError("contact_link_conflict");
  }

  let resolvedContactId: number | null = matches[0]?.id ?? dealContactId;
  if (resolvedContactId == null) {
    // Canonical writer: local-first, provenance + source event + identity observation in one transaction.
    const created = await createContactLocalFirst({
      firstName: String(p.ownerFirstName || ""),
      lastName: String(p.ownerLastName || ""),
      email: contactEmail,
      // Same number the consent step records (owner first), so a new contact and its consent agree.
      phone: String(p.ownerPhone || p.businessPhone || ""),
      companyName: String(p.legalBusinessName || p.dba || ""),
      status: "New",
      tags: ["src_merchant_app", "merchant_application"],
    } as any, undefined, {
      sourceCategory: "merchant_application",
      sourceType: "merchant_application",
      eventKey: `merchant-application-contact:${appId}:${contactEmail.toLowerCase()}`,
    });
    resolvedContactId = created.id;
  }

  // Compare-and-set: never overwrite a link an operator set while this step was running.
  await withOwnedClaim(row, async (tx) => {
    await tx
      .update(merchantApplications)
      .set({ contactId: resolvedContactId, updatedAt: new Date() })
      .where(and(eq(merchantApplications.id, appId), sql`${merchantApplications.contactId} IS NULL`));
  });
}

async function handleConsentRecord(row: OutboxRow): Promise<void> {
  const appId = row.applicationId;
  const p = row.payload;
  const [appRow] = await db
    .select({ contactId: merchantApplications.contactId })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!appRow?.contactId) throw new OutboxWaitError("contact_not_linked");

  // S5-05: the consent evidence is what the applicant submitted: the disclosure version they saw, the phone
  // number on the form, and the request's address and agent, captured at submission and carried in the payload.
  // Idempotency is the per-submission event key in the consent reducer, never "any prior consent exists",
  // which would suppress a new disclosure/phone and silently drop evidence.
  const consentedPhone = typeof p.consentedPhone === "string" ? p.consentedPhone : "";
  const disclosureVersion = typeof p.disclosureVersion === "string" ? p.disclosureVersion : "";
  if (!consentedPhone || !disclosureVersion) {
    throw new Error("consent_record payload lacks submission evidence (phone/disclosure); refusing to record consent");
  }
  // R02 chronology: the grant takes effect when the applicant submitted, not when this queued step runs, so an
  // old queued grant can never override a STOP recorded later. The disclosure hash is the one captured at
  // submission; rows queued before the hash was captured can only be matched to the CURRENT text when their
  // version is still current, otherwise recording is refused rather than re-stamping an unseen disclosure.
  const submittedAtMs = typeof p.submittedAt === "string" ? Date.parse(p.submittedAt) : NaN;
  if (!Number.isFinite(submittedAtMs)) throw new Error("consent_record payload lacks a submission time; refusing to record consent");
  let capturedHash = typeof p.disclosureHash === "string" && p.disclosureHash ? p.disclosureHash : undefined;
  if (!capturedHash) {
    const { PEWC_DISCLOSURE_VERSION: CURRENT_VERSION, PEWC_DISCLOSURE_TEXT } = await import("@shared/consent-disclosures");
    if (disclosureVersion !== CURRENT_VERSION) throw new Error("consent_record payload lacks the captured disclosure hash for a superseded disclosure version");
    const { disclosureHash } = await import("./consent-authority");
    capturedHash = disclosureHash(PEWC_DISCLOSURE_TEXT);
  }
  const submissionId = typeof p.submissionId === "string" ? p.submissionId : `application-${appId}`;
  const { recordPewcDecision } = await import("./consent-evidence");
  await withOwnedClaim(row, () => recordPewcDecision({
    contactId: appRow.contactId,
    checked: true,
    source: "merchant_application_finalize",
    ipAddress: typeof p.ipAddress === "string" && p.ipAddress ? p.ipAddress : "unknown",
    userAgent: typeof p.userAgent === "string" && p.userAgent ? p.userAgent : "unknown",
    disclosureVersion,
    disclosureHash: capturedHash,
    effectiveAt: new Date(submittedAtMs),
    eventKey: `merchant_application:${appId}:${submissionId}`,
    details: { applicationId: appId, submissionId, consentedPhone, submittedAt: p.submittedAt ?? null },
  }));
}

async function handleGhlSync(row: OutboxRow): Promise<void> {
  // This step only records the durable contact-projection handoff (an idempotent local upsert consumed by the
  // projection worker). Recording it must NOT depend on the email/outbound pause: the pause is enforced where the
  // provider is actually called, and a handoff skipped here would never be recorded at all. Handoff, provider
  // completion and message completion are separate facts; this handler asserts only the first.
  const appId = row.applicationId;
  const [appRow] = await db
    .select({ contactId: merchantApplications.contactId })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!appRow?.contactId) throw new OutboxWaitError("contact_not_linked");

  const { syncMerchantApplicationToGhl } = await import("./ghl-form-sync");
  const result = await syncMerchantApplicationToGhl(appId, appRow.contactId);
  if (!result.success && result.error) {
    // Propagate so row stays retryable (item 2).
    throw new Error(`GHL sync failed: ${result.error}`);
  }
}

async function handleWorkflowEnroll(row: OutboxRow): Promise<void> {
  const appId = row.applicationId;
  const [appRow] = await db
    .select({ contactId: merchantApplications.contactId })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!appRow?.contactId) throw new OutboxWaitError("contact_not_linked");

  const ghlContact = await storage.getContact(appRow.contactId);
  const ghlContactId = ghlContact?.ghlContactId ?? "";
  if (!ghlContactId) {
    // GHL ID not yet populated — durable wait, not a failed attempt.
    throw new OutboxWaitError("ghl_contact_pending");
  }

  const dispatchState = await workflowDispatchState(row.id, appId);
  // A confirmed enrollment whose delivery settlement was lost is already done; never trigger a second one.
  if (dispatchState.confirmed) return;
  if (dispatchState.unsettled) {
    // An earlier attempt of this very row began a dispatch that was never settled: the trigger may have been
    // accepted. Never trigger a second enrollment; hold for operator recovery.
    await recordWorkflowUnconfirmed(row, appId, "earlier_dispatch_unsettled");
    throw new OutboxHoldError("possible_send_unconfirmed");
  }

  await assertOutboundNotPaused();
  const { enrollInGhlWorkflowCompliant } = await import("./ghl-workflows");
  const enroll = override("enroll") ?? enrollInGhlWorkflowCompliant;
  await recordFencedMarker(row, "merchant_application_workflow_enroll_dispatch_started", appId, { outboxId: row.id, attempt: row.attempts });
  let result: Awaited<ReturnType<typeof enrollInGhlWorkflowCompliant>>;
  try {
    result = await enroll({
      workflowKey: "merchant_app",
      ghlContactId,
      contactId: appRow.contactId,
      metadata: { applicationId: appId },
      // This outbox row is the single retry owner for a definite transient refusal. Without the flag the lower helper
      // also writes an unscoped deferred-enrollment obligation, and both would re-trigger the same enrollment.
      _callerOwnsDeferral: true,
    });
  } catch {
    // A throw after the marker cannot prove the trigger was not accepted.
    await recordWorkflowUnconfirmed(row, appId, "enroll_threw_after_dispatch_started");
    throw new OutboxHoldError("possible_send_unconfirmed");
  }
  if (result?.success === true) {
    await storage.createAuditLog({ action: "merchant_application_workflow_enroll_dispatch_settled", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, outcome: "confirmed" } });
    return;
  }

  // R02: a resolved {success:false} is NOT a delivery. Preserve the typed outcome through the outbox:
  //  - unknown (the trigger may have been accepted) is held, never retried;
  //  - a pause refusal is a durable wait; any other definite refusal keeps the row visible or retryable.
  const ambiguous = result?.outcome === "unknown" || (result?.outcome === undefined && isAmbiguousDispatchMessage(result?.error));
  if (ambiguous) {
    await recordWorkflowUnconfirmed(row, appId, "trigger_outcome_unknown");
    throw new OutboxHoldError("possible_send_unconfirmed");
  }
  // Definite non-dispatch: settle the marker so a later attempt is not mistaken for an unsettled dispatch.
  await storage.createAuditLog({ action: "merchant_application_workflow_enroll_dispatch_settled", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, outcome: "unsent" } });
  if (result?.skipped === true) {
    if (/pause/i.test(String(result.error ?? ""))) throw new OutboxWaitError("outbound_paused");
    await storage.createAuditLog({
      action: "merchant_application_workflow_enroll_not_delivered",
      entityType: "merchant_application",
      entityId: appId,
      details: { outboxId: row.id, skipped: true },
    });
    throw new OutboxHoldError("workflow_enroll_not_delivered");
  }
  if (/pause|Outbound blocked/i.test(String(result?.error ?? ""))) throw new OutboxWaitError("outbound_paused");
  throw new Error("workflow enrollment was not accepted");
}

/** Dispatch markers of one outbox row: started without settlement is unsettled; a confirmed settlement is final. */
async function workflowDispatchState(outboxId: string, appId: number): Promise<{ unsettled: boolean; confirmed: boolean }> {
  const counts = (((await db.execute(sql`
    SELECT count(*) FILTER (WHERE action = 'merchant_application_workflow_enroll_dispatch_started')::int AS started,
           count(*) FILTER (WHERE action = 'merchant_application_workflow_enroll_dispatch_settled')::int AS settled,
           count(*) FILTER (WHERE action = 'merchant_application_workflow_enroll_dispatch_settled' AND details->>'outcome' = 'confirmed')::int AS confirmed
    FROM audit_logs WHERE entity_type = 'merchant_application' AND entity_id = ${appId}
      AND details->>'outboxId' = ${outboxId}
      AND action IN ('merchant_application_workflow_enroll_dispatch_started','merchant_application_workflow_enroll_dispatch_settled')`)) as any).rows ?? [{ started: 0, settled: 0, confirmed: 0 }])[0];
  return { unsettled: Number(counts.started) > Number(counts.settled), confirmed: Number(counts.confirmed) > 0 };
}

async function recordWorkflowUnconfirmed(row: OutboxRow, appId: number, reason: string): Promise<void> {
  if (await hasAuditEvidence("merchant_application_workflow_enroll_unconfirmed", "merchant_application", appId)) return;
  await storage.createAuditLog({ action: "merchant_application_workflow_enroll_unconfirmed", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason } });
}

async function handleRiskScan(row: OutboxRow): Promise<void> {
  const appId = row.applicationId;
  const [appRow] = await db
    .select({ contactId: merchantApplications.contactId })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!appRow?.contactId) throw new OutboxWaitError("contact_not_linked");

  const { scanApplicationRisk } = await import("./relationship-extractor");
  await scanApplicationRisk(appRow.contactId, appId);
}

/**
 * Explicit, least-privilege projection for status emails. NEVER selects
 * protected ciphertext, fingerprints, masks, tokens, or capability columns.
 */
async function loadStatusEmailInput(appId: number): Promise<import("./merchant-application-status").ApplicationStatusEmailInput> {
  const [app] = await db
    .select({
      contactId: merchantApplications.contactId,
      ownerEmail: merchantApplications.ownerEmail,
      businessEmail: merchantApplications.businessEmail,
      ownerFirstName: merchantApplications.ownerFirstName,
      ownerLastName: merchantApplications.ownerLastName,
      legalBusinessName: merchantApplications.legalBusinessName,
      dba: merchantApplications.dba,
      businessPhone: merchantApplications.businessPhone,
      ownerPhone: merchantApplications.ownerPhone,
      vertical: merchantApplications.vertical,
      declineReason: merchantApplications.declineReason,
    })
    .from(merchantApplications)
    .where(eq(merchantApplications.id, appId))
    .limit(1);
  if (!app) throw new Error(`Application #${appId} not found`);
  return { applicationId: appId, ...app };
}

/**
 * Recipient-facing dispatch with durable possible-send uncertainty. The marker is written BEFORE the network call;
 * if a prior attempt left a marker without sent/skipped evidence (or the send threw after the marker), the message
 * may already be delivered, so the row is held for operator recovery and is never re-sent.
 */
async function dispatchStatusEmailOnce(
  row: OutboxRow,
  kind: "approved" | "declined",
  send: (input: import("./merchant-application-status").ApplicationStatusEmailInput, hooks: { beforeDispatch: () => Promise<void> }) => Promise<import("./merchant-application-status").ApplicationEmailResult>,
): Promise<void> {
  const appId = row.applicationId;
  const sentAction = `merchant_application_${kind}_email_sent`;
  const skippedAction = `merchant_application_${kind}_email_skipped`;
  const startedAction = `merchant_application_${kind}_email_dispatch_started`;
  const unconfirmedAction = `merchant_application_${kind}_email_send_unconfirmed`;
  if (await hasAuditEvidence(sentAction, "merchant_application", appId)) return;
  if (await hasAuditEvidence(skippedAction, "merchant_application", appId)) return;
  if (await hasAuditEvidence(startedAction, "merchant_application", appId)) {
    if (!(await hasAuditEvidence(unconfirmedAction, "merchant_application", appId))) {
      await storage.createAuditLog({ action: unconfirmedAction, entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "earlier_dispatch_unsettled" } });
    }
    throw new OutboxHoldError("possible_send_unconfirmed");
  }

  await assertOutboundNotPaused();
  const input = await loadStatusEmailInput(appId);
  let dispatched = false;
  let result: import("./merchant-application-status").ApplicationEmailResult;
  try {
    result = await send(input, {
      beforeDispatch: async () => {
        // Ownership, the originating transition and the dispatch-start marker commit atomically.
        await withOwnedClaim(row, async (tx) => {
          if (!(await statusEffectIsCurrent(tx, row, kind, false))) throw new EffectObsoleteError();
          await storage.createAuditLog({ action: startedAction, entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, attempt: row.attempts } }, tx);
        });
        dispatched = true;
      },
    });
  } catch (err) {
    if (err instanceof EffectObsoleteError) {
      await storage.createAuditLog({
        action: "merchant_application_effect_obsolete", entityType: "merchant_application", entityId: appId,
        details: { outboxId: row.id, eventType: row.eventType, expected: kind },
      });
      return;
    }
    if (dispatched && !(err instanceof OutboxWaitError) && !(err instanceof ClaimLostError)) {
      await storage.createAuditLog({ action: unconfirmedAction, entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "send_threw_after_dispatch_started" } });
      throw new OutboxHoldError("possible_send_unconfirmed");
    }
    throw err;
  }

  // No GHL contact id yet is a durable wait, not a completed skip: completing here would lose the message.
  if (result.status === "skipped" && result.reason === "no_ghl_contact") throw new OutboxWaitError("ghl_contact_pending");

  if (result.status === "sent") {
    // Evidence written ONLY when the email was actually sent.
    await storage.createAuditLog({ action: sentAction, entityType: "merchant_application", entityId: appId, details: {} });
  } else {
    await storage.createAuditLog({ action: skippedAction, entityType: "merchant_application", entityId: appId, details: { reason: result.reason } });
  }
}

async function handleApprovalEmail(row: OutboxRow): Promise<void> {
  const { sendApplicationApprovedEmail } = await import("./merchant-application-status");
  const send = override("approvedEmail") ?? sendApplicationApprovedEmail;
  await dispatchStatusEmailOnce(row, "approved", (input, hooks) => send(input, hooks));
}

async function handleDealStage(row: OutboxRow): Promise<void> {
  const dealId = row.payload.dealId as number | null;
  if (!dealId) return;
  const { advanceDealStage } = await import("./deal-stage-service");
  await withOwnedClaim(row, async (tx) => {
    if (!(await statusEffectIsCurrent(tx, row, "approved"))) return;
    await advanceDealStage(dealId, "Closed Won", "merchant_approval");
  });
}

async function handleLifecycleApproved(row: OutboxRow): Promise<void> {
  const contactId = row.payload.contactId as number | null;
  if (!contactId) return;
  const { LifecycleService } = await import("./lifecycle-service");
  await withOwnedClaim(row, async (tx) => {
    if (!(await statusEffectIsCurrent(tx, row, "approved"))) return;
    await LifecycleService.transition(contactId, "APPROVED", {
      trigger: "merchant_application_approved",
      source: "outbox-worker",
      metadata: { applicationId: row.applicationId },
    });
  });
}

async function handleDeclineEmail(row: OutboxRow): Promise<void> {
  const { sendApplicationDeclinedEmail } = await import("./merchant-application-status");
  const send = override("declinedEmail") ?? sendApplicationDeclinedEmail;
  await dispatchStatusEmailOnce(row, "declined", (input, hooks) => send(input, hooks));
}

async function handleLifecycleDeclined(row: OutboxRow): Promise<void> {
  const contactId = row.payload.contactId as number | null;
  if (!contactId) return;
  const { LifecycleService } = await import("./lifecycle-service");
  await withOwnedClaim(row, async (tx) => {
    if (!(await statusEffectIsCurrent(tx, row, "declined"))) return;
    await LifecycleService.transition(contactId, "CLOSED_LOST", {
      trigger: "merchant_application_declined",
      source: "outbox-worker",
      reason: (row.payload.declineReason as string) ?? undefined,
      metadata: { applicationId: row.applicationId },
    });
  });
}

/** Apply a conditional e-sign write, re-reading on a version conflict. Returns whether it was applied. */
async function applyEsignWithRetry(write: () => Promise<{ updated: boolean }>): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    if ((await write()).updated) return true;
  }
  return false;
}

type EsignOutcome = "confirmed" | "unsent" | "wait" | "unknown";
/** Normalizes a send result to its typed outcome; untyped results fall back to their evidence, never to success. */
function classifyEsignResult(result: any): EsignOutcome {
  const typed = result?.outcome;
  if (typed === "confirmed") return typeof result.documentId === "string" && result.documentId ? "confirmed" : "unknown";
  if (typed === "unsent" || typed === "wait" || typed === "unknown") return typed;
  if (result?.success === true) return typeof result.documentId === "string" && result.documentId ? "confirmed" : "unknown";
  const error = String(result?.error ?? "");
  if (isAmbiguousDispatchMessage(error)) return "unknown";
  if (/Outbound paused|pause authority|Outbound blocked/i.test(error)) return "wait";
  return "unsent";
}

async function handleEsignSend(row: OutboxRow): Promise<void> {
  const appId = row.applicationId;
  const [app] = await db.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
  if (!app) throw new Error(`Application #${appId} not found`);

  if (app.esignDocumentId && app.esignStatus === "sent") {
    await applyEsignSendState({ applicationId: appId, sendState: "sent" });
    return;
  }
  // R02: a dispatch marker without a recorded document means an earlier attempt may have reached the provider.
  // Never send a second agreement; hold for operator recovery.
  const markerCounts = (((await db.execute(sql`
    SELECT count(*) FILTER (WHERE action = 'merchant_application_esign_dispatch_started')::int AS started,
           count(*) FILTER (WHERE action = 'merchant_application_esign_dispatch_refused')::int AS refused
    FROM audit_logs WHERE entity_type = 'merchant_application' AND entity_id = ${appId}
      AND action IN ('merchant_application_esign_dispatch_started','merchant_application_esign_dispatch_refused')`)) as any).rows ?? [{ started: 0, refused: 0 }])[0];
  if (Number(markerCounts.started) > Number(markerCounts.refused) && !app.esignDocumentId) {
    if (!(await hasAuditEvidence("merchant_application_esign_send_unconfirmed", "merchant_application", appId))) {
      await storage.createAuditLog({ action: "merchant_application_esign_send_unconfirmed", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "earlier_dispatch_unsettled" } });
    }
    throw new OutboxHoldError("possible_send_unconfirmed");
  }

  const templateId = process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID;
  if (!templateId) {
    // Template genuinely not configured — this is a configuration gap, not
    // an effect failure. Mark idle so it stops looping; operator must configure.
    await applyEsignSendState({ applicationId: appId, sendState: "idle" });
    return;
  }

  const recipientName = `${app.ownerFirstName || ""} ${app.ownerLastName || ""}`.trim() || app.legalBusinessName || "Merchant";
  const recipientEmail = app.ownerEmail || app.businessEmail || "";
  if (!recipientEmail) {
    await applyEsignSendState({ applicationId: appId, sendState: "idle" });
    // No email is a data-quality issue, not transient — treat as terminal config problem.
    return;
  }

  await assertOutboundNotPaused();
  // Ownership and the dispatch-start marker commit atomically: a worker that lost the claim writes no marker.
  await recordFencedMarker(row, "merchant_application_esign_dispatch_started", appId, { outboxId: row.id, attempt: row.attempts });
  const { sendDocumentForEsign: realSendDocumentForEsign } = await import("./ghl");
  const sendDocumentForEsign = override("sendDocumentForEsign") ?? realSendDocumentForEsign;
  let sent: Awaited<ReturnType<typeof realSendDocumentForEsign>>;
  try {
    sent = await sendDocumentForEsign({ documentTemplateId: templateId, recipientName, recipientEmail, applicationId: appId });
  } catch (err) {
    // A throw after the marker cannot prove the agreement was not delivered.
    await storage.createAuditLog({ action: "merchant_application_esign_send_unconfirmed", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "send_threw_after_dispatch_started" } });
    throw new OutboxHoldError("possible_send_unconfirmed");
  }

  // The typed transport outcome is preserved end to end: only a definite refusal settles the marker as refused.
  const outcome = classifyEsignResult(sent);
  if (outcome === "unknown") {
    // The request may have been processed (lost response, 5xx, unreadable or identity-less success). It is neither
    // a refusal nor a sent agreement: no refused marker, no retry, held for operator recovery.
    await storage.createAuditLog({ action: "merchant_application_esign_send_unconfirmed", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "transport_outcome_unknown" } });
    throw new OutboxHoldError("possible_send_unconfirmed");
  }
  if (outcome === "wait") {
    // Refused before the request left this process (pause/coordinator/control): owed, not failed.
    await storage.createAuditLog({ action: "merchant_application_esign_dispatch_refused", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "pre_io_wait" } });
    throw new OutboxWaitError("outbound_paused");
  }
  if (outcome === "unsent") {
    // A definite refusal: nothing was sent. The refusal marker settles the dispatch marker so a retry is not
    // mistaken for an unsettled dispatch.
    await storage.createAuditLog({ action: "merchant_application_esign_dispatch_refused", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, reason: "definite_refusal" } });
    await applyEsignSendState({ applicationId: appId, sendState: "failed" });
    // Propagate so row stays retryable. Error scrubbed before logging.
    throw new Error("e-sign provider send failed");
  }
  const result = sent as { documentId?: string; signingUrl?: string };

  // The agreement has been sent. Record it with conditional writes; a refusal must be re-read, never ignored.
  const documentApplied = await applyEsignWithRetry(() => applyEsignDocumentState({
    applicationId: appId,
    esignStatus: "sent",
    esignDocumentId: result.documentId || null,
    esignSigningUrl: result.signingUrl || null,
  }));
  if (!documentApplied) {
    const [cur] = await db.select({ status: merchantApplications.esignStatus, doc: merchantApplications.esignDocumentId }).from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
    if (cur?.status === "signed") {
      // Signed before the send was recorded: the signed state stands; keep the document id as evidence only.
      await storage.createAuditLog({ action: "merchant_application_esign_sent_after_signed", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, documentId: result.documentId ?? null } });
      return;
    }
    await storage.createAuditLog({ action: "merchant_application_esign_sent_unrecorded", entityType: "merchant_application", entityId: appId, details: { outboxId: row.id, documentId: result.documentId ?? null } });
    throw new OutboxHoldError("esign_state_update_refused");
  }
  const sendStateApplied = await applyEsignWithRetry(() => applyEsignSendState({ applicationId: appId, sendState: "sent" }));

  await storage.createAuditLog({
    action: "merchant_application_esign_sent",
    entityType: "merchant_application",
    entityId: appId,
    details: { sendStateRecorded: sendStateApplied },
  });
}

// ── Dispatch ─────────────────────────────────────────────────────────────

async function processRow(row: OutboxRow): Promise<void> {
  // R02: no effect runs unless this worker still owns the claim.
  await assertCurrentClaim(row);
  switch (row.eventType) {
    case "contact_link":       return handleContactLink(row);
    case "consent_record":     return handleConsentRecord(row);
    case "ghl_sync":           return handleGhlSync(row);
    case "workflow_enroll":    return handleWorkflowEnroll(row);
    case "risk_scan":          return handleRiskScan(row);
    case "approval_email":     return handleApprovalEmail(row);
    case "deal_stage":         return handleDealStage(row);
    case "lifecycle_approved": return handleLifecycleApproved(row);
    case "decline_email":      return handleDeclineEmail(row);
    case "lifecycle_declined": return handleLifecycleDeclined(row);
    case "esign_send":         return handleEsignSend(row);
    default:
      // Unknown / legacy combined event types (including the pre-split
      // finalize_side_effects and status_changed) must NOT be silently marked
      // delivered — that could drop a real, unhandled side effect. Throw so the
      // row retries and ultimately dead-letters for operator inspection (item 4).
      throw new Error(`Unknown outbox event type: ${row.eventType}`);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  // Pool-pressure backpressure: if callers are already queued waiting for a
  // DB connection, skip this tick rather than adding more pressure. The next
  // scheduled tick (15 s later) will retry. This prevents the outbox worker
  // from contributing to pool saturation during high-load windows.
  if (pool.waitingCount > 0) {
    process.stderr.write(`[MerchantOutbox] Pool pressure — ${pool.waitingCount} waiter(s), skipping tick\n`);
    return;
  }
  // NOTE: No top-level pause check here. Pure data-operations (contact_link,
  // consent_record, risk_scan, deal_stage, lifecycle_*) must run regardless of
  // the global outbound pause so that contact creation and PEWC consent recording
  // are never blocked.  GHL-sending events (ghl_sync, workflow_enroll, esign_send)
  // fail naturally at the service layer (pause authority blocks GHL calls there)
  // and are retried with exponential back-off until the pause is lifted.
  running = true;
  try {
    await reclaimStale();

    for (let i = 0; i < 10; i++) {
      const row = await claimOne();
      if (!row) break;
      try {
        await processRow(row);
        await markDelivered(row.id, row.attempts);
      } catch (err) {
        if (err instanceof ClaimLostError) {
          process.stderr.write(`[MerchantOutbox] ${row.eventType} app#${row.applicationId} claim lost before effect; not settled by this worker\n`);
          continue;
        }
        // Minimal operational log — no app/profile data, no provider payloads.
        process.stderr.write(`[MerchantOutbox] ${row.eventType} app#${row.applicationId} attempt#${row.attempts} failed (${scrubError(err)})\n`);
        await markRetryOrDeadLetter(row.id, row.attempts, err);
      }
    }
  } catch (err) {
    process.stderr.write(`[MerchantOutbox] Tick error: ${scrubError(err)}\n`);
  } finally {
    running = false;
  }
}

export function startMerchantApplicationOutboxWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  const initial = setTimeout(() => void tick(), 3000);
  if (typeof initial.unref === "function") initial.unref();
}

/**
 * Schedule an expedited outbox tick ~100 ms from now.
 * Call after a finalize/status mutation to ensure contact_link and consent_record
 * rows are processed promptly rather than waiting up to POLL_INTERVAL_MS (15 s).
 * Safe to call concurrently — the re-entrancy guard in tick() prevents double-work.
 *
 * No-op when BACKGROUND_JOB_PROFILE=off — the recurring worker was not started
 * and triggering an ad-hoc tick would execute background work in HTTP/API-only mode.
 */
export function triggerOutboxTick(): void {
  // Same selection rule as the interval worker: invalid/missing/ghl-sync-only fail closed,
  // selective needs the critical-commands group.
  if (!isLocalOutboxWorkerSelected()) return;
  const t = setTimeout(() => { void tick(); }, 100);
  if (typeof t.unref === "function") t.unref();
}

export const __test__ = { testOverrides, processRow, assertCurrentClaim, withOwnedClaim, __handleEsignSend: handleEsignSend, ClaimLostError, OutboxHoldError, handleContactLink, handleConsentRecord, backoffMs, MAX_ATTEMPTS, STALE_LOCK_MS, scrubError, tick, claimOne, markDelivered, markRetryOrDeadLetter };
