/**
 * Website warm lane runtime: claims DURABLE warm admissions only (never an unmarked enrollment), re-decides at the claim
 * boundary and again inside the dispatch fence, owns its own pre-I/O send receipt, and settles the real provider result.
 *
 * Outcome rules (never inferred, never blurred):
 *   accepted  - Gmail accepted the message (not proof of inbox delivery). Receipt, canonical outbound event and the
 *               enrollment advance commit together.
 *   unsent    - proved not accepted. The capacity unit is released exactly once and the SAME step is retried (bounded).
 *   uncertain - a request may have left this process. The admission stays fenced; there is no automatic resend.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { lockCommercialGraph } from "./commercial-graph-locks";
import { lockContactMailboxes } from "./contact-mailbox-identity";
import { communicationContactLockKey } from "./communication-contact-lock";
import { recordOutboundSendInTx } from "./communication-events";
import { NON_COLD_GMAIL_SENDER_CATEGORY, resolvePolicy } from "./sender-policy";
import { releaseWarmCapacity, reserveWarmCapacity } from "./website-email-capacity";
import {
  PROGRAM_PURPOSE,
  decideWarmStop,
  deriveRfcMessageId,
  warmIdempotencyKey,
  warmStopWhereSql,
  type WarmProgram,
  type WarmSnapshot,
} from "./website-email-contracts";
import {
  evaluateWarmDecision,
  loadAdmission,
  loadWarmRevision,
  revokeAdmissionInTx,
  rowsOf,
  type AdmissionRow,
  type Exec,
} from "./website-email-lane-store";
import { WEBSITE_WARM_REQUESTED_FOLLOWUP_CAMPAIGN } from "./contactability";

export const WARM_LEASE_MS = 10 * 60 * 1000;
export const WARM_DEFER_MS = 30 * 60 * 1000;
export const WARM_MAX_DEFER_AGE_MS = 72 * 60 * 60 * 1000;
export const WARM_STALE_PENDING_MS = 15 * 60 * 1000;
export const WARM_UNSENT_BACKOFF_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000] as const;
export const WARM_MAX_UNSENT_ATTEMPTS = WARM_UNSENT_BACKOFF_MS.length;

/** Failures that say nothing about this message (a control is paused) never consume the bounded retry budget. */
const NON_COUNTING_UNSENT = new Set(["OUTBOUND_PAUSED", "PAUSE_GATE_ERROR"]);

export interface WarmRuntimeDeps {
  sendGmail: typeof import("./gmail-oauth").sendGmailEmail;
  evaluateContactability: typeof import("./contactability").evaluateContactability;
  now: () => Date;
}

async function defaultDeps(): Promise<WarmRuntimeDeps> {
  const [{ sendGmailEmail }, { evaluateContactability }] = await Promise.all([import("./gmail-oauth"), import("./contactability")]);
  return { sendGmail: sendGmailEmail, evaluateContactability, now: () => new Date() };
}

export interface WarmTickTally {
  claimed: number;
  accepted: number;
  deferred: number;
  revoked: number;
  unsent: number;
  uncertain: number;
  completed: number;
  skipped: number;
  errors: number;
}

const emptyTally = (): WarmTickTally => ({ claimed: 0, accepted: 0, deferred: 0, revoked: 0, unsent: 0, uncertain: 0, completed: 0, skipped: 0, errors: 0 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Claim ────────────────────────────────────────────────────────────────────

/**
 * Select due MARKED enrollments only. The predicate starts from the admission marker, so an unmarked row (old active
 * enrollments, paused/retired/test sequences) is never read, locked or mutated here, however many exist.
 */
export async function claimDueWarmEnrollments(limit: number, now: Date): Promise<number[]> {
  // A pending receipt that outlived its lease means the process died around provider I/O: the outcome is unknown.
  await db.execute(sql`
    UPDATE website_email_send_receipts SET outcome = 'uncertain', updated_at = now()
    WHERE outcome = 'pending' AND updated_at < ${new Date(now.getTime() - WARM_STALE_PENDING_MS)}
  `);
  const leaseUntil = new Date(now.getTime() + WARM_LEASE_MS);
  const rows = rowsOf<{ id: number }>(await db.execute(sql`
    WITH due AS (
      SELECT e.id FROM sequence_enrollments e
      JOIN website_lifecycle_admissions a ON a.id = e.website_admission_id
      WHERE e.website_admission_id IS NOT NULL AND e.status = 'active' AND a.state = 'active' AND e.next_action_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM website_email_send_receipts r WHERE r.admission_id = a.id AND r.outcome IN ('uncertain', 'pending')
        )
      ORDER BY e.next_action_at ASC
      LIMIT ${limit}
      FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE sequence_enrollments e SET next_action_at = ${leaseUntil}, updated_at = now()
    FROM due WHERE e.id = due.id
    RETURNING e.id
  `));
  return rows.map((r) => Number(r.id));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function deferEnrollment(enrollmentId: number, reason: string, now: Date, delayMs = WARM_DEFER_MS): Promise<{ firstDeferredAt: Date }> {
  const row = rowsOf<{ first: string }>(await db.execute(sql`
    UPDATE sequence_enrollments
    SET next_action_at = ${new Date(now.getTime() + delayMs)},
        metadata = jsonb_set(
          jsonb_set(COALESCE(metadata, '{}'::jsonb), '{websiteLifecycle,deferredReason}', to_jsonb(${reason}::text), true),
          '{websiteLifecycle,firstDeferredAt}',
          COALESCE(metadata->'websiteLifecycle'->'firstDeferredAt', to_jsonb(${now.toISOString()}::text)), true),
        updated_at = now()
    WHERE id = ${enrollmentId} AND status = 'active'
    RETURNING metadata->'websiteLifecycle'->>'firstDeferredAt' AS first
  `))[0];
  return { firstDeferredAt: row?.first ? new Date(row.first) : now };
}

export async function lockForContact(tx: Exec, contactId: number): Promise<{ email: string | null }> {
  const row = rowsOf<{ email: string | null }>(await tx.execute(sql`SELECT email FROM contacts WHERE id = ${contactId}`))[0];
  await lockContactMailboxes(tx as never, [row?.email ?? null]);
  await lockCommercialGraph(tx as never, [{ type: "contact", id: contactId }], ["identity"]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${communicationContactLockKey(contactId).toString()}::bigint)`);
  return { email: row?.email ?? null };
}

/** Advance (or complete) the journey after an ACCEPTED step. Compare-and-swap on current_step; idempotent. */
export async function advanceAfterAcceptedInTx(tx: Exec, receipt: { admissionId: number; stepOrder: number }, now: Date): Promise<"advanced" | "completed" | "noop"> {
  const admission = await loadAdmission(tx, receipt.admissionId);
  if (!admission) return "noop";
  const revision = await loadWarmRevision(tx, admission.warmRevisionId);
  const steps = (revision?.snapshot as WarmSnapshot | undefined)?.steps ?? [];
  const enrollment = rowsOf<{ id: number; current_step: number }>(await tx.execute(sql`
    SELECT id, current_step FROM sequence_enrollments WHERE website_admission_id = ${admission.id} FOR UPDATE
  `))[0];
  if (!enrollment || Number(enrollment.current_step) !== receipt.stepOrder) return "noop";
  const nextIndex = receipt.stepOrder + 1;
  if (nextIndex >= steps.length) {
    await tx.execute(sql`
      UPDATE sequence_enrollments SET status = 'completed', current_step = ${nextIndex}, completed_at = now(), updated_at = now()
      WHERE id = ${enrollment.id} AND status = 'active'
    `);
    await tx.execute(sql`UPDATE website_lifecycle_admissions SET state = 'completed' WHERE id = ${admission.id} AND state = 'active'`);
    await tx.execute(sql`UPDATE website_lifecycle_intents SET state = 'completed', updated_at = now() WHERE id = ${admission.intentId} AND state = 'admitted'`);
    await tx.execute(sql`
      UPDATE inbound_request_effects SET state = 'sent', provider_receipt = ${`website_admission:${admission.id}`}, updated_at = now()
      WHERE request_id = ${admission.requestId}::uuid AND effect_key = ${`warm_${admission.program}`} AND state IN ('held', 'ready', 'attempting')
    `);
    return "completed";
  }
  await tx.execute(sql`
    UPDATE sequence_enrollments
    SET current_step = ${nextIndex}, next_action_at = ${new Date(now.getTime() + steps[nextIndex].delayMinutes * 60_000)},
        metadata = (COALESCE(metadata, '{}'::jsonb) #- '{websiteLifecycle,firstDeferredAt}') #- '{websiteLifecycle,deferredReason}',
        updated_at = now()
    WHERE id = ${enrollment.id} AND status = 'active'
  `);
  return "advanced";
}

type ReceiptRow = {
  id: number; admission_id: number; step_order: number; contact_id: number; rfc_message_id: string; from_address: string;
  provider_account: string | null; outcome: string; unsent_attempts: number; capacity_day: string | null; capacity_scope: string | null; purpose: string;
};

/** Mark a pending/uncertain receipt accepted and commit the canonical event + enrollment advance with it. */
export async function settleAcceptedInTx(
  tx: Exec,
  receiptId: number,
  provider: { messageId?: string | null; threadId?: string | null },
  now: Date,
  subject: string | null,
): Promise<"settled" | "already_settled"> {
  const receipt = rowsOf<ReceiptRow>(await tx.execute(sql`
    UPDATE website_email_send_receipts
    SET outcome = 'accepted', provider_message_id = ${provider.messageId ?? null}, provider_thread_id = ${provider.threadId ?? null}, updated_at = now()
    WHERE id = ${receiptId} AND outcome IN ('pending', 'uncertain')
    RETURNING id, admission_id, step_order, contact_id, rfc_message_id, from_address, provider_account, outcome, unsent_attempts, capacity_day, capacity_scope, purpose
  `))[0];
  if (!receipt) return "already_settled";
  const admission = await loadAdmission(tx, Number(receipt.admission_id));
  await recordOutboundSendInTx(tx as never, {
    contactId: Number(receipt.contact_id),
    channel: "email",
    provider: "gmail",
    subject,
    sequenceId: null,
    externalMessageId: receipt.rfc_message_id,
    metadata: {
      websiteLifecycle: { admissionId: Number(receipt.admission_id), step: Number(receipt.step_order), program: admission?.program ?? null, receiptId: Number(receipt.id) },
      providerMessageId: provider.messageId ?? null, providerThreadId: provider.threadId ?? null, accepted: true, deliveryConfirmed: false,
    },
  });
  await advanceAfterAcceptedInTx(tx, { admissionId: Number(receipt.admission_id), stepOrder: Number(receipt.step_order) }, now);
  return "settled";
}

/** Mark a pending/uncertain receipt as proved-unsent, releasing its capacity unit exactly once. */
export async function settleUnsentInTx(tx: Exec, receiptId: number, countsAgainstBudget: boolean): Promise<ReceiptRow | null> {
  const receipt = rowsOf<ReceiptRow>(await tx.execute(sql`
    UPDATE website_email_send_receipts
    SET outcome = 'unsent', unsent_attempts = unsent_attempts + ${countsAgainstBudget ? 1 : 0}, updated_at = now()
    WHERE id = ${receiptId} AND outcome IN ('pending', 'uncertain')
    RETURNING id, admission_id, step_order, contact_id, rfc_message_id, from_address, provider_account, outcome, unsent_attempts, capacity_day, capacity_scope, purpose
  `))[0];
  if (!receipt) return null;
  if (receipt.capacity_day && receipt.capacity_scope) await releaseWarmCapacity(tx, { day: receipt.capacity_day, scope: receipt.capacity_scope });
  return receipt;
}

// ── One enrollment ───────────────────────────────────────────────────────────

type FenceResult =
  | { ok: true; receiptId: number; rfcMessageId: string; idempotencyKey: string; to: string; fromAddress: string }
  | { ok: false; kind: "defer" | "revoked" | "skip"; reason: string };

async function fenceAndReserve(input: {
  admission: AdmissionRow; stepIndex: number; enrollmentId: number; now: Date;
}): Promise<FenceResult> {
  const { admission, stepIndex, enrollmentId, now } = input;
  const idempotencyKey = warmIdempotencyKey(admission.id, stepIndex);
  return db.transaction(async (tx): Promise<FenceResult> => {
    const { email } = await lockForContact(tx, admission.contactId);
    const live = await loadAdmission(tx, admission.id);
    const enrollment = rowsOf<{ status: string; current_step: number }>(await tx.execute(sql`
      SELECT status, current_step FROM sequence_enrollments WHERE id = ${enrollmentId} AND website_admission_id = ${admission.id} FOR UPDATE
    `))[0];
    if (!live || live.state !== "active" || !enrollment || enrollment.status !== "active" || Number(enrollment.current_step) !== stepIndex) {
      return { ok: false, kind: "skip", reason: "STATE_CHANGED_BEFORE_DISPATCH" };
    }

    const ctx = await evaluateWarmDecision(tx, {
      boundary: "before_io", program: live.program, requestId: live.requestId, contactId: live.contactId, admission: live, heldSince: null, now,
    });
    if (!ctx.decision.allowed) {
      if (ctx.decision.held) return { ok: false, kind: "defer", reason: ctx.decision.reason };
      await revokeAdmissionInTx(tx, live.id, ctx.decision.reason);
      return { ok: false, kind: "revoked", reason: ctx.decision.reason };
    }

    // Stop predicate: one definition shared with the read decision. Fails closed when it cannot be evaluated.
    if (!UUID.test(live.requestId)) return { ok: false, kind: "defer", reason: "STOP_PREDICATE_UNAVAILABLE" };
    let stopRows: Array<{ id: number }> | null;
    try {
      stopRows = rowsOf<{ id: number }>(await tx.execute(sql.raw(
        `SELECT inbound.id FROM communication_events inbound WHERE ${warmStopWhereSql({
          contact: String(Number(live.contactId)), entry: String(Number(live.entryEventId)), request: `'${live.requestId}'`,
        })} LIMIT 1`,
      )));
    } catch {
      stopRows = null;
    }
    const stop = decideWarmStop(stopRows);
    if (stop.stop === "unavailable") return { ok: false, kind: "defer", reason: "STOP_PREDICATE_UNAVAILABLE" };
    if (stop.stop) {
      await revokeAdmissionInTx(tx, live.id, stop.reason);
      return { ok: false, kind: "revoked", reason: stop.reason };
    }

    const config = ctx.config!;
    const reserved = await reserveWarmCapacity(tx, { account: config.senderAccount ?? "", dailyLimit: config.dailyLimit, now });
    if (!reserved.ok) return { ok: false, kind: "defer", reason: reserved.reason };

    const policy = resolvePolicy(NON_COLD_GMAIL_SENDER_CATEGORY);
    const rfcMessageId = deriveRfcMessageId(idempotencyKey);
    const existing = rowsOf<{ id: number; outcome: string }>(await tx.execute(sql`
      SELECT id, outcome FROM website_email_send_receipts WHERE idempotency_key = ${idempotencyKey} FOR UPDATE
    `))[0];
    let receiptId: number;
    if (!existing) {
      receiptId = Number(rowsOf<{ id: number }>(await tx.execute(sql`
        INSERT INTO website_email_send_receipts
          (idempotency_key, admission_id, step_order, contact_id, rfc_message_id, provider_account, from_address, reply_to, purpose,
           recipient_token_hash, recipient_generation, outcome, capacity_day, capacity_scope)
        VALUES (${idempotencyKey}, ${live.id}, ${stepIndex}, ${live.contactId}, ${rfcMessageId}, ${config.senderAccount}, ${policy.from}, ${policy.replyTo ?? policy.from},
                ${PROGRAM_PURPOSE[live.program as WarmProgram].warm}, ${live.emailTokenHash}, ${live.emailGeneration}, 'pending',
                ${reserved.reservation.day}, ${reserved.reservation.scope})
        RETURNING id
      `))[0].id);
    } else if (existing.outcome === "unsent") {
      // Same step, same stable Message-ID: a definite-unsent attempt may be retried exactly once per re-arm.
      await tx.execute(sql`
        UPDATE website_email_send_receipts
        SET outcome = 'pending', capacity_day = ${reserved.reservation.day}, capacity_scope = ${reserved.reservation.scope}, updated_at = now()
        WHERE id = ${existing.id} AND outcome = 'unsent'
      `);
      receiptId = Number(existing.id);
    } else {
      // accepted / pending / uncertain: another path owns this attempt. Hand back the unit we just reserved.
      await releaseWarmCapacity(tx, reserved.reservation);
      return { ok: false, kind: "skip", reason: `RECEIPT_${existing.outcome.toUpperCase()}` };
    }
    return { ok: true, receiptId, rfcMessageId, idempotencyKey, to: email ?? "", fromAddress: policy.from };
  });
}

async function processOne(enrollmentId: number, deps: WarmRuntimeDeps, tally: WarmTickTally): Promise<void> {
  const now = deps.now();
  const row = rowsOf<{ current_step: number; website_admission_id: number | null; status: string }>(await db.execute(sql`
    SELECT current_step, website_admission_id, status FROM sequence_enrollments WHERE id = ${enrollmentId}
  `))[0];
  if (!row || row.website_admission_id === null || row.status !== "active") { tally.skipped++; return; }
  const admission = await loadAdmission(db, Number(row.website_admission_id));
  if (!admission || admission.state !== "active") { tally.skipped++; return; }
  const revision = await loadWarmRevision(db, admission.warmRevisionId);
  const steps = (revision?.snapshot as WarmSnapshot | undefined)?.steps ?? [];
  const stepIndex = Number(row.current_step);
  if (stepIndex >= steps.length) {
    await db.transaction(async (tx) => {
      await lockForContact(tx, admission.contactId);
      await advanceAfterAcceptedInTx(tx, { admissionId: admission.id, stepOrder: stepIndex - 1 }, now);
    });
    tally.completed++;
    return;
  }
  const step = steps[stepIndex];

  // Claim-boundary decision: frozen revision, exact address generation, consent, class, sender, lane state.
  const claim = await evaluateWarmDecision(db, {
    boundary: "claim", program: admission.program, requestId: admission.requestId, contactId: admission.contactId, admission, heldSince: null, now,
  });
  if (!claim.decision.allowed) {
    await handleRefusal(enrollmentId, admission.id, claim.decision.reason, claim.decision.held, now, tally);
    return;
  }

  // Existing contactability authority (suppression, unsubscribe, deliverability, marketing validation for nurture).
  const program = admission.program as WarmProgram;
  const purpose = PROGRAM_PURPOSE[program];
  const contactability = await deps.evaluateContactability({
    contactId: admission.contactId,
    channel: "email",
    campaignType: program === "requested_followup" ? WEBSITE_WARM_REQUESTED_FOLLOWUP_CAMPAIGN : `website_warm:${program}`,
    mode: "enforcement",
    commercialPurpose: purpose.transport,
    inboundRequestId: admission.requestId,
    intendedRecipientContactId: admission.contactId,
    websiteWarmAdmissionId: admission.id,
  });
  if (!contactability.allowed) {
    await handleRefusal(enrollmentId, admission.id, `CONTACTABILITY_BLOCKED:${contactability.reason}`.slice(0, 200), true, now, tally);
    return;
  }

  // Render before reserving anything: unresolved tokens or unsafe links are a deterministic content failure.
  const contact = rowsOf<any>(await db.execute(sql`SELECT first_name, last_name, company_name, phone, email FROM contacts WHERE id = ${admission.contactId}`))[0];
  let subject: string;
  let html: string;
  try {
    const { renderMessage } = await import("./message-token-registry");
    const source = { contact: { firstName: contact?.first_name, lastName: contact?.last_name, companyName: contact?.company_name, phone: contact?.phone, email: contact?.email } };
    subject = renderMessage("template", step.subject, source, "subject").output;
    html = renderMessage("template", step.bodyHtml, source, "html").output;
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code ?? error.name : "RENDER_FAILED";
    await db.transaction(async (tx) => {
      await lockForContact(tx, admission.contactId);
      await revokeAdmissionInTx(tx, admission.id, `TEMPLATE_RENDER_FAILED:${code}`);
    });
    tally.revoked++;
    return;
  }

  const fence = await fenceAndReserve({ admission, stepIndex, enrollmentId, now });
  if (!fence.ok) {
    if (fence.kind === "defer") await handleRefusal(enrollmentId, admission.id, fence.reason, true, now, tally, fence.reason === "WARM_DAILY_LIMIT" ? nextUtcDayMs(now) : WARM_DEFER_MS);
    else if (fence.kind === "revoked") tally.revoked++;
    else tally.skipped++;
    return;
  }

  const { generateUnsubscribeToken } = await import("./unsubscribe-token");
  const { getCanonicalUrl } = await import("../lib/canonical-url");
  const unsubscribeUrl = `${getCanonicalUrl()}/unsubscribe?t=${encodeURIComponent(generateUnsubscribeToken(admission.contactId))}`;

  let result: Awaited<ReturnType<WarmRuntimeDeps["sendGmail"]>>;
  try {
    result = await deps.sendGmail({
      to: fence.to, subject, html, category: NON_COLD_GMAIL_SENDER_CATEGORY, contactId: admission.contactId,
      commercialPurpose: purpose.transport, rfcMessageId: fence.rfcMessageId, requireAcceptedAlias: true, unsubscribeUrl,
    });
  } catch {
    // An exception after the request may have been dispatched: never assume unsent.
    result = { success: false, outcome: "uncertain", failureCode: "GMAIL_TRANSPORT_UNCERTAIN", error: "send threw" };
  }

  await db.transaction(async (tx) => {
    await lockForContact(tx, admission.contactId);
    if (result.outcome === "accepted") {
      await settleAcceptedInTx(tx, fence.receiptId, { messageId: result.messageId, threadId: result.threadId }, deps.now(), subject);
      tally.accepted++;
      return;
    }
    if (result.outcome === "uncertain") {
      await tx.execute(sql`UPDATE website_email_send_receipts SET outcome = 'uncertain', updated_at = now() WHERE id = ${fence.receiptId} AND outcome = 'pending'`);
      tally.uncertain++;
      return;
    }
    const counts = !NON_COUNTING_UNSENT.has(String(result.failureCode ?? ""));
    const settled = await settleUnsentInTx(tx, fence.receiptId, counts);
    tally.unsent++;
    if (!settled) return;
    const attempts = Number(settled.unsent_attempts);
    if (counts && attempts >= WARM_MAX_UNSENT_ATTEMPTS) {
      await revokeAdmissionInTx(tx, admission.id, `SEND_REFUSED_REPEATEDLY:${result.failureCode ?? "UNKNOWN"}`);
      tally.revoked++;
      return;
    }
    const delay = counts ? WARM_UNSENT_BACKOFF_MS[Math.min(attempts, WARM_UNSENT_BACKOFF_MS.length) - 1] : 5 * 60 * 1000;
    await tx.execute(sql`
      UPDATE sequence_enrollments SET next_action_at = ${new Date(deps.now().getTime() + delay)}, updated_at = now()
      WHERE id = ${enrollmentId} AND status = 'active'
    `);
  });
}

const nextUtcDayMs = (now: Date) => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0);
  return Math.max(WARM_DEFER_MS, next - now.getTime());
};

async function handleRefusal(
  enrollmentId: number, admissionId: number, reason: string, held: boolean, now: Date, tally: WarmTickTally, delayMs = WARM_DEFER_MS,
): Promise<void> {
  if (held) {
    const { firstDeferredAt } = await deferEnrollment(enrollmentId, reason, now, delayMs);
    if (now.getTime() - firstDeferredAt.getTime() > WARM_MAX_DEFER_AGE_MS) {
      const admission = await loadAdmission(db, admissionId);
      if (admission) {
        await db.transaction(async (tx) => {
          await lockForContact(tx, admission.contactId);
          await revokeAdmissionInTx(tx, admissionId, "HELD_TOO_LONG");
        });
        tally.revoked++;
        return;
      }
    }
    tally.deferred++;
    return;
  }
  const admission = await loadAdmission(db, admissionId);
  if (admission) {
    await db.transaction(async (tx) => {
      await lockForContact(tx, admission.contactId);
      await revokeAdmissionInTx(tx, admissionId, reason);
    });
  }
  tally.revoked++;
}

// ── Tick ─────────────────────────────────────────────────────────────────────

export async function processWebsiteWarmEnrollments(opts: { limit?: number; deps?: Partial<WarmRuntimeDeps> } = {}): Promise<WarmTickTally> {
  const deps = { ...(await defaultDeps()), ...opts.deps } as WarmRuntimeDeps;
  const tally = emptyTally();
  const ids = await claimDueWarmEnrollments(opts.limit ?? 25, deps.now());
  tally.claimed = ids.length;
  for (const id of ids) {
    try {
      await processOne(id, deps, tally);
    } catch (error) {
      tally.errors++;
      // Only structural identifiers are logged: a Postgres error message can echo row values (contact details).
      const pg = (error as { cause?: { code?: unknown; constraint?: unknown; table?: unknown } } | null)?.cause ?? (error as { code?: unknown; constraint?: unknown; table?: unknown } | null);
      const where = [pg?.code, pg?.table, pg?.constraint].filter((v) => typeof v === "string" && v.length > 0).join("/");
      process.stderr.write(`[WebsiteWarm] enrollment ${id} error (${error instanceof Error ? error.name : "NonError"}${where ? ` ${where}` : ""})\n`);
    }
  }
  return tally;
}

// ── Admin: resolve an uncertain attempt ──────────────────────────────────────

export type ResolveUncertainResult = { ok: true; resolution: "accepted" | "not_sent" } | { ok: false; code: "NOT_FOUND" | "NOT_UNCERTAIN" };

/**
 * An operator who verified the mailbox's Sent folder attests the outcome. `accepted` settles exactly like a real
 * acceptance; `not_sent` releases the capacity unit and lets the same step retry with the same stable Message-ID.
 */
export async function resolveUncertainReceipt(input: { receiptId: number; resolution: "accepted" | "not_sent"; providerMessageId?: string | null; threadId?: string | null }): Promise<ResolveUncertainResult> {
  const receipt = rowsOf<{ contact_id: number; outcome: string }>(await db.execute(sql`SELECT contact_id, outcome FROM website_email_send_receipts WHERE id = ${input.receiptId}`))[0];
  if (!receipt) return { ok: false, code: "NOT_FOUND" };
  if (receipt.outcome !== "uncertain") return { ok: false, code: "NOT_UNCERTAIN" };
  await db.transaction(async (tx) => {
    await lockForContact(tx, Number(receipt.contact_id));
    if (input.resolution === "accepted") await settleAcceptedInTx(tx, input.receiptId, { messageId: input.providerMessageId, threadId: input.threadId }, new Date(), null);
    else {
      const settled = await settleUnsentInTx(tx, input.receiptId, false);
      if (settled) {
        await tx.execute(sql`
          UPDATE sequence_enrollments SET next_action_at = now(), updated_at = now()
          WHERE website_admission_id = ${Number(settled.admission_id)} AND status = 'active'
        `);
      }
    }
  });
  return { ok: true, resolution: input.resolution };
}
