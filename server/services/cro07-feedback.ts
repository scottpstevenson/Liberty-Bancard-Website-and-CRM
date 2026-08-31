/**
 * CRO-07 authenticated feedback authority.
 *
 * This is a SEPARATE ingress from ingestCr06SyntheticFeedback() in
 * cr06-feedback.ts, which must stay exactly as-is (synthetic/admin-only test
 * ingress). This module is the authenticated, provider-signed webhook path
 * for CRO-07's own release/attempt lineage.
 *
 * Reply vs. suppression matrix (never collapse these):
 *   ordinary_reply        -> stop linked program/attempt; create reply work; NOT suppression
 *   explicit_unsubscribe  -> channel opt-out (consent-authority)
 *   complaint              -> global DNC (consent-authority)
 *   hard_bounce            -> reachability downgrade (consent-authority)
 *   soft_bounce            -> observation only, no suppression
 *   ambiguous_reply         -> stop correlated attempt where possible; review required
 *
 * AI sentiment/reply classification must never be used to infer legal
 * consent withdrawal — only the canonicalEffect values above can trigger a
 * consent-authority suppression command, and only explicit_unsubscribe /
 * complaint / hard_bounce ever do so.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { storage } from "../storage";
import { applyConsentCommand, recordReachabilityObservation, type ConsentSubjectRef } from "./consent-authority";
import { recordCro07AttributionEdge } from "./cro07-attribution";

export type Cro07CanonicalEffect =
  | "ordinary_reply"
  | "explicit_unsubscribe"
  | "complaint"
  | "hard_bounce"
  | "soft_bounce"
  | "delivered"
  | "ambiguous_reply";

/**
 * Server-side, provider-event-type -> canonical-effect mapping. This is the
 * ONLY source of truth for what effect an event applies — a caller-supplied
 * effect label is never trusted, because a compromised/misconfigured
 * provider payload could otherwise claim any effect for any event.
 * `eventType` values are the ones CRO-07 itself defines for provider
 * integration; extend this map (optionally per-source) when a real provider
 * is approved, rather than accepting an arbitrary caller-declared effect.
 */
const EVENT_TYPE_TO_EFFECT: Record<string, Cro07CanonicalEffect> = {
  reply: "ordinary_reply",
  ambiguous_reply: "ambiguous_reply",
  explicit_unsubscribe: "explicit_unsubscribe",
  unsubscribe: "explicit_unsubscribe",
  complaint: "complaint",
  spamreport: "complaint",
  hard_bounce: "hard_bounce",
  soft_bounce: "soft_bounce",
  delivered: "delivered",
};

export function mapCro07EventTypeToEffect(eventType: string): Cro07CanonicalEffect | null {
  return EVENT_TYPE_TO_EFFECT[eventType] ?? null;
}

export interface Cro07WebhookInput {
  source: string;
  // REQUIRED — this is not just descriptive metadata. It is checked against
  // the immutable provider_account_id recorded on the referenced attempt at
  // claim time (see claimCro07Attempt), and a mismatch (or an attempt with
  // no recorded provider_account_id) durably records the receipt as
  // unresolved and applies zero side effects. Without this check, knowing a
  // valid attemptId alone (which a signer for ANY registered source could
  // guess/enumerate/be told) would be sufficient to apply a signed event
  // against that attempt's contact — this closes that gap.
  providerAccountId: string;
  providerEventId: string;
  signatureHeader: string | null;
  rawBody: string;
  eventType: string;
  // The attempt this event is about. REQUIRED — contact/intent/release
  // identity is derived exclusively from this validated attempt's own
  // lineage (never from a caller-supplied contactId/intentId), so an
  // authenticated event can only ever affect the exact contact it was
  // actually sent to. A missing or unknown attemptId durably records the
  // receipt as unresolved and applies zero side effects.
  attemptId: string;
  providerOccurredAt?: Date;
  payload: Record<string, unknown>;
}

const PII_KEYS = new Set(["email", "phone", "body", "message", "content", "text", "notes", "raw"]);

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : sanitizePayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Resolves the ONE secret an approved provider `source` may sign CRO-07
 * feedback webhooks with. Deliberately has NO shared/default fallback: a
 * shared default would let anyone holding it sign a request under ANY
 * `:source` path segment, which would satisfy the source half of the
 * provider-source/provider-account correlation check for an attempt that
 * was never actually claimed under that caller's real source. An
 * unrecognized or unconfigured source resolves to null and must fail
 * closed (never authenticated), not fall through to some other secret.
 */
export function resolveCro07WebhookSecret(source: string): string | null {
  return process.env[`CRO07_WEBHOOK_SECRET_${source.toUpperCase()}`] ?? null;
}

/** Verifies an HMAC-SHA256 signature over the raw body using a per-source secret. */
export function verifyCro07WebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Ingests one authenticated CRO-07 feedback event. Fails closed on missing
 * signature (persists a receipt with signature_valid=false but processes no
 * side effects). Dedupes on (source, provider_event_id) — a durable
 * unique index, not an in-memory cache.
 */
export async function ingestCro07Feedback(input: Cro07WebhookInput & { signatureValid: boolean }) {
  // Canonical effect is derived server-side from the (CRO-07-defined)
  // eventType — never trusted from the caller/provider payload directly.
  const canonicalEffect = mapCro07EventTypeToEffect(input.eventType);

  // Resolves contact/intent/release identity EXCLUSIVELY from the attempt
  // referenced by attemptId, and requires the incoming event's source AND
  // providerAccountId to both match the immutable correlation recorded on
  // that attempt at claim time (never caller-supplied, never trusted from
  // the webhook payload). A caller can never assert an independent
  // contactId/cr06DeliveryIntentId, and a signer for source A (even with a
  // genuinely valid key for source A) can never assert feedback about an
  // attempt actually claimed under a different source or provider account.
  // An attempt with no recorded correlation fails this check closed.
  async function resolveCorrelation(queryable: { query: typeof pool.query }) {
    const attemptLookup = await queryable.query(
      `SELECT a.release_id, a.cr06_delivery_intent_id, a.provider_account_id, a.provider_source, di.recipient_contact_id
       FROM cro07_attempts a
       JOIN cr06_delivery_intents di ON di.id = a.cr06_delivery_intent_id
       WHERE a.id = $1`,
      [input.attemptId],
    );
    const attemptRow = attemptLookup.rows[0] ?? null;
    const correlationMatches = !!attemptRow
      && !!attemptRow.provider_account_id
      && attemptRow.provider_account_id === input.providerAccountId
      && !!attemptRow.provider_source
      && attemptRow.provider_source === input.source;
    const unresolvedReason = !attemptRow
      ? "CRO07_ATTEMPT_NOT_FOUND"
      : !correlationMatches
        ? "CRO07_PROVIDER_ACCOUNT_MISMATCH"
        : null;
    return {
      // attempt_id has a real FK to cro07_attempts — an attemptId that does
      // not resolve to a real row (or whose source/account correlation
      // fails) must NOT be inserted there; it is preserved in the sanitized
      // payload as evidence instead, and the receipt is durably recorded as
      // unresolved via the null attempt_id/release_id/intent_id/contact_id.
      resolvedAttemptId: correlationMatches ? input.attemptId : null,
      releaseId: correlationMatches ? attemptRow.release_id : null,
      intentId: correlationMatches ? attemptRow.cr06_delivery_intent_id : null,
      contactId: correlationMatches ? attemptRow.recipient_contact_id : null,
      unresolvedReason,
    };
  }

  const client = await pool.connect();
  let receipt: FeedbackReceiptRow;
  let isNewReceipt: boolean;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM cro07_feedback_receipts WHERE source = $1 AND provider_event_id = $2 FOR UPDATE`,
      [input.source, input.providerEventId],
    );
    if (existing.rows[0] && (existing.rows[0].signature_valid || !input.signatureValid)) {
      // Either this exact (source, provider_event_id) was already
      // authenticated before (normal idempotent replay — never re-resolve
      // or re-apply), or the new delivery is ALSO unauthenticated (nothing
      // trustworthy to upgrade to). In both cases the existing row stands.
      receipt = existing.rows[0];
      isNewReceipt = false;
      await client.query("COMMIT");
    } else if (existing.rows[0]) {
      // The stored row was persisted from an earlier UNAUTHENTICATED
      // delivery (signature_valid=false) and this delivery IS validly
      // signed. An attacker who cannot forge a signature could otherwise
      // permanently poison a legitimate provider_event_id by submitting an
      // unsigned/invalid-signature request first — the real, later,
      // correctly signed event must not be silently dropped as "already
      // seen". Re-resolve correlation from the now-trusted request and
      // upgrade the row in place; processed_at stays NULL (it was never
      // set for an invalid-signature receipt) so the normal apply-effect
      // path below runs exactly once for this newly-authenticated event.
      const resolved = await resolveCorrelation(client);
      const update = await client.query(
        `UPDATE cro07_feedback_receipts SET
           provider_account_id = $1, signature_valid = $2, attempt_id = $3, release_id = $4,
           cr06_delivery_intent_id = $5, contact_id = $6, event_type = $7, canonical_effect = $8,
           provider_occurred_at = $9, payload = $10
         WHERE id = $11
         RETURNING *`,
        [
          input.providerAccountId, input.signatureValid, resolved.resolvedAttemptId, resolved.releaseId,
          resolved.intentId, resolved.contactId, input.eventType, canonicalEffect ?? "unresolved_event_type",
          input.providerOccurredAt ?? null,
          JSON.stringify(sanitizePayload({
            ...input.payload,
            claimedAttemptId: input.attemptId,
            ...(resolved.unresolvedReason ? { unresolvedReason: resolved.unresolvedReason } : {}),
          })),
          existing.rows[0].id,
        ],
      );
      receipt = update.rows[0];
      // Treated as a fresh authenticated arrival (not a no-op replay) so
      // the caller/response semantics reflect that this delivery is the
      // one that actually gets evaluated/applied.
      isNewReceipt = true;
      await client.query("COMMIT");
    } else {
      const resolved = await resolveCorrelation(client);
      const insert = await client.query(
        `INSERT INTO cro07_feedback_receipts (
          source, provider_account_id, provider_event_id, signature_valid, attempt_id, release_id,
          cr06_delivery_intent_id, contact_id, event_type, canonical_effect, provider_occurred_at, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *`,
        [
          input.source, input.providerAccountId, input.providerEventId, input.signatureValid,
          resolved.resolvedAttemptId, resolved.releaseId, resolved.intentId, resolved.contactId,
          input.eventType, canonicalEffect ?? "unresolved_event_type", input.providerOccurredAt ?? null,
          JSON.stringify(sanitizePayload({
            ...input.payload,
            claimedAttemptId: input.attemptId,
            ...(resolved.unresolvedReason ? { unresolvedReason: resolved.unresolvedReason } : {}),
          })),
        ],
      );
      receipt = insert.rows[0];
      isNewReceipt = true;
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!receipt.signature_valid) {
    // Persist evidence only; never apply a side effect from an
    // unauthenticated event.
    return { receipt, replayed: !isNewReceipt, applied: false, reason: "CRO07_SIGNATURE_INVALID" };
  }
  if (!receipt.attempt_id || !receipt.cr06_delivery_intent_id || !receipt.contact_id) {
    // A signed event that cannot be correlated to a real, known,
    // provider-account-matched attempt (and through it a real contact) is
    // durable evidence only — it must never apply a side effect against a
    // caller-guessed identity or an attempt sent under a different provider
    // account. The specific reason (unknown attempt vs. provider/account
    // mismatch) was captured in the sanitized payload at insert time.
    const payloadReason = (receipt as any).payload?.unresolvedReason as string | undefined;
    return { receipt, replayed: !isNewReceipt, applied: false, reason: payloadReason ?? "CRO07_ATTEMPT_NOT_FOUND" };
  }
  if (receipt.canonical_effect === "unresolved_event_type") {
    return { receipt, replayed: !isNewReceipt, applied: false, reason: "CRO07_UNKNOWN_EVENT_TYPE" };
  }

  // The receipt row is durable proof-of-delivery for dedup purposes, but it
  // is only "done" once processed_at is set. A receipt with processed_at
  // still NULL (whether brand new, or a replay of a provider retry whose
  // earlier attempt threw before completing) MUST retry the effect — never
  // silently short-circuit to "replayed: true" while consent/stop/reply-work
  // application never actually ran. Every effect below is itself
  // idempotent-safe (dedup on eventKey / existing-row checks), so re-running
  // it on a partial-failure retry is always safe.
  if (receipt.processed_at) {
    return { receipt, replayed: true, applied: true };
  }

  const applied = await applyCro07FeedbackEffect(receipt);
  await pool.query(`UPDATE cro07_feedback_receipts SET processed_at = NOW() WHERE id = $1`, [receipt.id]);
  return { receipt, replayed: !isNewReceipt, applied: true, effect: applied };
}

interface FeedbackReceiptRow {
  id: string;
  contact_id: number | null;
  cr06_delivery_intent_id: string | null;
  attempt_id: string | null;
  // Widened to string (not Cro07CanonicalEffect) because a persisted row may
  // also hold the sentinel "unresolved_event_type" for evidence-only rows
  // whose eventType did not map to any known canonical effect.
  canonical_effect: string;
  event_type: string;
  received_at: string;
  signature_valid: boolean;
  processed_at: string | null;
}

/**
 * Applies the canonical effect for one authenticated receipt, per the reply
 * vs. suppression matrix. Never widens a weaker feedback type into a
 * stronger suppression (e.g. an ordinary reply can never clear or imply a
 * complaint/unsubscribe/hard-bounce).
 */
async function applyCro07FeedbackEffect(receipt: FeedbackReceiptRow) {
  const eventNamespace = "cro07_feedback";
  const eventKey = receipt.id;

  switch (receipt.canonical_effect) {
    case "explicit_unsubscribe": {
      if (!receipt.contact_id) return { kind: "skipped_no_contact" };
      const subject: ConsentSubjectRef = { type: "contact", id: receipt.contact_id };
      const result = await applyConsentCommand({
        subject, kind: "opt_out", channel: "email", eventNamespace, eventKey,
        source: "cro07_feedback", details: { receiptId: receipt.id },
        evidence: { receiptId: receipt.id, eventType: receipt.event_type },
      });
      await stopIncompatibleOutreach(receipt);
      return { kind: "consent_opt_out", result };
    }
    case "complaint": {
      if (!receipt.contact_id) return { kind: "skipped_no_contact" };
      const subject: ConsentSubjectRef = { type: "contact", id: receipt.contact_id };
      const result = await applyConsentCommand({
        subject, kind: "global_dnc", eventNamespace, eventKey,
        source: "cro07_feedback", details: { receiptId: receipt.id },
      });
      await stopIncompatibleOutreach(receipt);
      return { kind: "consent_global_dnc", result };
    }
    case "hard_bounce": {
      if (!receipt.contact_id) return { kind: "skipped_no_contact" };
      await recordReachabilityObservation({
        subject: { type: "contact", id: receipt.contact_id },
        channel: "email", state: "bounced",
        eventNamespace, eventKey, source: "cro07_feedback",
      });
      await stopIncompatibleOutreach(receipt);
      return { kind: "reachability_bounced" };
    }
    case "soft_bounce": {
      if (!receipt.contact_id) return { kind: "skipped_no_contact" };
      await recordReachabilityObservation({
        subject: { type: "contact", id: receipt.contact_id },
        channel: "email", state: "undeliverable",
        eventNamespace, eventKey, source: "cro07_feedback",
      });
      return { kind: "reachability_observation_only" };
    }
    case "ordinary_reply": {
      await stopIncompatibleOutreach(receipt);
      const work = await createCro07ReplyWork(receipt, "deterministic");
      await recordReplyAttributionEdge(receipt);
      return { kind: "reply_stop_and_work", work };
    }
    case "ambiguous_reply": {
      await stopIncompatibleOutreach(receipt);
      const work = await createCro07ReplyWork(receipt, "review_required");
      await recordReplyAttributionEdge(receipt);
      return { kind: "ambiguous_reply_stop_and_review", work };
    }
    case "delivered":
    default:
      return { kind: "no_effect" };
  }
}

/**
 * Immediately stops the linked CR-06 intent's sequence enrollment (if any) —
 * an ordinary/ambiguous reply stops outreach without itself being recorded
 * as a suppression event; explicit_unsubscribe/complaint/hard_bounce stop
 * outreach AND separately record a stronger canonical suppression fact
 * (handled by the caller via consent-authority before this runs).
 */
async function stopIncompatibleOutreach(receipt: FeedbackReceiptRow) {
  const category = receipt.canonical_effect === "ordinary_reply" || receipt.canonical_effect === "ambiguous_reply" ? "reply" : "suppression";
  // Real database failures here MUST propagate — a reply that fails to stop
  // outreach because of a transient DB error must be retried (the caller
  // leaves processed_at NULL on any thrown error), never silently marked
  // "applied". An UPDATE that simply matches zero rows (no linked/active
  // enrollment to stop) is expected and returns normally — that is the only
  // "no-op" case, not a caught exception.

  // Primary path: the exact delivery intent's linked enrollment, when CR-06
  // preparation has populated it (only possible once a future authorized
  // dispatch path exists — never true while final dispatch stays denied).
  if (receipt.cr06_delivery_intent_id) {
    await pool.query(
      `UPDATE sequence_enrollments se
       SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
           metadata = COALESCE(se.metadata, '{}'::jsonb) || jsonb_build_object(
             'terminal', jsonb_build_object('category', $3::text, 'reason', 'cro07_feedback', 'receiptId', $2::text)
           )
       FROM cr06_delivery_intents di
       JOIN cr06_prepared_enrollments pe ON pe.id = di.prepared_enrollment_id
       WHERE di.id = $1
         AND pe.sequence_enrollment_id = se.id
         AND se.status = 'active'`,
      [receipt.cr06_delivery_intent_id, receipt.id, category],
    );
  }
  // Broader path: any other active promotional/cold-outreach enrollment for
  // the same contact must also stop immediately on reply — "incompatible
  // outreach" is contact-scoped, not limited to the one attempt that
  // happened to receive the reply. Transactional sequences are excluded by
  // requiring a non-null sequence_family (cold/marketing sequences are
  // tagged; transactional flows are not part of that taxonomy).
  if (receipt.contact_id) {
    await pool.query(
      `UPDATE sequence_enrollments se
       SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
           metadata = COALESCE(se.metadata, '{}'::jsonb) || jsonb_build_object(
             'terminal', jsonb_build_object('category', $3::text, 'reason', 'cro07_feedback', 'receiptId', $2::text)
           )
       FROM follow_up_sequences fs
       WHERE se.sequence_id = fs.id
         AND se.contact_id = $1
         AND se.status = 'active'
         AND fs.sequence_family IS NOT NULL`,
      [receipt.contact_id, receipt.id, category],
    );
  }
}

/**
 * Creates exactly one idempotent CR-05 task per feedback occurrence via the
 * canonical createAuthorityTask boundary — a NEW versioned occurrence
 * (cro07_feedback/human_reply), never the ghl_webhook|inbound_message
 * policy, which intentionally forbids cr05_task.
 */
async function createCro07ReplyWork(receipt: FeedbackReceiptRow, ownerResolution: "deterministic" | "review_required") {
  const occurrenceKey = `cro07_feedback/human_reply:${receipt.id}`;
  const existing = await pool.query(`SELECT * FROM cro07_reply_work WHERE feedback_receipt_id = $1`, [receipt.id]);
  if (existing.rows[0]) return existing.rows[0];

  if (!receipt.contact_id) {
    const inserted = await pool.query(
      `INSERT INTO cro07_reply_work (feedback_receipt_id, contact_id, occurrence_key, owner_resolution)
       VALUES ($1, NULL, $2, 'review_required')
       ON CONFLICT DO NOTHING RETURNING *`,
      [receipt.id, occurrenceKey],
    );
    return inserted.rows[0] ?? null;
  }

  const task = await storage.createAuthorityTask({
    contactId: receipt.contact_id,
    title: "Review inbound reply to controlled outreach",
    description: `CRO-07 ${receipt.canonical_effect} on delivery intent ${receipt.cr06_delivery_intent_id ?? "unknown"}`,
    status: "pending",
    priority: ownerResolution === "review_required" ? "high" : "normal",
    source: "cro07_feedback",
    automationKey: occurrenceKey,
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
  } as any, {
    producer: "cro07_feedback",
    commandKey: occurrenceKey,
    issueKey: `cro07_feedback/human_reply:${receipt.contact_id}`,
  });

  const inserted = await pool.query(
    `INSERT INTO cro07_reply_work (feedback_receipt_id, contact_id, occurrence_key, cr05_task_id, owner_resolution)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (feedback_receipt_id) DO NOTHING
     RETURNING *`,
    [receipt.id, receipt.contact_id, occurrenceKey, task.id, ownerResolution],
  );
  return inserted.rows[0] ?? (await pool.query(`SELECT * FROM cro07_reply_work WHERE feedback_receipt_id = $1`, [receipt.id])).rows[0];
}

/**
 * Production attribution writer: attempt -> reply edge, so a reply is
 * visible in the source-to-revenue graph as soon as it is authenticated and
 * applied, without requiring a separate manual admin write.
 */
async function recordReplyAttributionEdge(receipt: FeedbackReceiptRow) {
  if (!receipt.attempt_id) return;
  await recordCro07AttributionEdge({
    edgeType: "attempt_reply",
    fromType: "cro07_attempt", fromId: receipt.attempt_id,
    toType: "cro07_feedback_receipt", toId: receipt.id,
  }).catch((err) => {
    console.error("[CRO07] Failed to record attempt_reply attribution edge (non-fatal):", err?.message ?? err);
  });
}

export function newProviderEventId(): string {
  return randomUUID();
}
