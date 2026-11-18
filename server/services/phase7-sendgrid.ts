/** Non-sending SendGrid evidence owner. Provider configuration is read, never changed. */
import { createHash, createPublicKey } from "node:crypto";
import { pool } from "../db";
import { canonicalJson } from "../../shared/phase7-experiment";
import { resolvePolicy } from "./sender-policy";
import { ingestPhase7ProviderFeedback } from "./phase7-feedback";
import {
  sendGridKind,
  verifySendGridSignature,
  SENDGRID_RETRY_GRACE_HOURS,
  verifiesSendGridSmtpKey,
} from "./phase7-sendgrid-contract";
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const keyHash = (key: string) => {
  const k = key.includes("BEGIN PUBLIC KEY")
    ? createPublicKey(key)
    : createPublicKey({
        key: Buffer.from(key, "base64"),
        format: "der",
        type: "spki",
      });
  return createHash("sha256")
    .update(k.export({ format: "der", type: "spki" }))
    .digest("hex");
};
export function phase7SenderIdentity() {
  const p = resolvePolicy("cold_outreach");
  return {
    senderAccount: p.from,
    replyAccount: p.replyTo || p.from,
    displayName: p.displayName.replace(/["\\]/g, ""),
  };
}
function sendGridSmtpKeyId() {
  const parts = (process.env.SMTP_PASS || "").split(".");
  return process.env.SMTP_HOST?.toLowerCase() === "smtp.sendgrid.net" &&
    process.env.SMTP_USER === "apikey" &&
    parts.length === 3 &&
    parts[0] === "SG" &&
    /^[A-Za-z0-9_-]{10,100}$/.test(parts[1])
    ? parts[1]
    : null;
}
export async function assertPhase7FeedbackReady(
  client: any,
  identity:
    | { senderAccount: string; replyAccount: string; displayName: string }
    | undefined,
) {
  if (!identity) throw new Error("CRO07_FROZEN_SENDER_REQUIRED");
  if(process.env.PHASE7_MEASUREMENT_ENABLED!=="true")throw new Error("CRO07_FEEDBACK_COVERAGE_NOT_READY");
  if (digest(identity) !== digest(phase7SenderIdentity()))
    throw new Error("CRO07_SENDER_IDENTITY_DRIFT");
  const smtpKeyId = sendGridSmtpKeyId();
  if (
    !smtpKeyId ||
    !process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY ||
    !process.env.SENDGRID_EVENT_WEBHOOK_ID ||
    process.env.CRO07_SEQUENCE_FEEDBACK_SOURCE !== "sendgrid" ||
    process.env.CRO07_SEQUENCE_FEEDBACK_ACCOUNT !== identity.senderAccount
  )
    throw new Error("CRO07_FEEDBACK_COVERAGE_NOT_READY");
  const row = (
    await client.query(
      `SELECT o.id FROM cro07_feedback_coverage_observations o JOIN gmail_mailbox_reader_state g ON lower(g.account_email)=lower(o.reply_account) AND g.phase7_generation::text=o.proof->>'readerGeneration' WHERE o.sender_account=$1 AND o.reply_account=$2 AND o.proof->>'smtpKeyIdHash'=$3 AND o.proof->>'publicKeyHash'=$4 AND o.proof->>'webhookId'=$5 AND o.proof->>'senderIdentityHash'=$6 AND o.healthy AND o.observed_at>clock_timestamp()-interval '5 minutes' AND g.state='active' AND g.last_error IS NULL AND g.phase7_history_complete AND g.last_success_at>clock_timestamp()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM cro07_feedback_coverage_observations later WHERE later.id>o.id AND later.sender_account=o.sender_account AND later.reply_account=o.reply_account) ORDER BY o.id DESC LIMIT 1`,
      [
        identity.senderAccount,
        identity.replyAccount,
        digest(smtpKeyId),
        keyHash(process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY!),
        process.env.SENDGRID_EVENT_WEBHOOK_ID,
        digest(identity),
      ],
    )
  ).rows[0];
  if (!row) throw new Error("CRO07_FEEDBACK_COVERAGE_NOT_READY");
}
export async function observePhase7SendGridCoverage(
  fetcher: typeof fetch = fetch,
) {
  const identity = phase7SenderIdentity(),
    c = await pool.connect();
  let locked = false;
  try {
    locked = (
      await c.query(
        "SELECT pg_try_advisory_lock(hashtext('phase7-sendgrid-coverage-owner')) AS ok",
      )
    ).rows[0].ok;
    if (!locked) return { state: "leased_elsewhere" };
    const recent = (
      await c.query(
        `SELECT id FROM cro07_feedback_coverage_observations WHERE observed_at>clock_timestamp()-interval '60 seconds' ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0];
    if (recent) return { state: "recent_observation" };
    let healthy = false,
      reason = "SENDGRID_COVERAGE_NOT_CONFIGURED",
      proof: any = { contractVersion: 1, maxProbeGapSeconds: 600 };
    const apiKey = process.env.SENDGRID_API_KEY,
      id = process.env.SENDGRID_EVENT_WEBHOOK_ID,
      publicKey = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
    try {
      if (
        process.env.PHASE7_MEASUREMENT_ENABLED === "true" &&
        apiKey &&
        id &&
        publicKey &&
        process.env.CRO07_SEQUENCE_FEEDBACK_SOURCE === "sendgrid" &&
        process.env.CRO07_SEQUENCE_FEEDBACK_ACCOUNT === identity.senderAccount
      ) {
        const read = async (path: string) => {
          const r = await fetcher("https://api.sendgrid.com/v3/" + path, {
            method: "GET",
            redirect: "error",
            headers: { Authorization: "Bearer " + apiKey },
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) throw Error("SENDGRID_SETTINGS_READ_REFUSED");
          const text = await r.text();
          if (text.length > 65536) throw Error("SENDGRID_SETTINGS_OVERSIZED");
          return JSON.parse(text);
        };
        const smtpKeyId = sendGridSmtpKeyId();
        if (!smtpKeyId) throw Error("SENDGRID_SMTP_IDENTITY_NOT_CONFIGURED");
        const smtpKey = await read("api_keys/" + encodeURIComponent(smtpKeyId));
        if (!verifiesSendGridSmtpKey(smtpKey, smtpKeyId))
          throw Error("SENDGRID_SMTP_ACCOUNT_NOT_VERIFIED");
        const settings = await read(
          "user/webhooks/event/settings/" + encodeURIComponent(id),
        );
        const signed = await read(
          "user/webhooks/event/settings/signed/" + encodeURIComponent(id),
        );
        const callback = new URL(
          "/api/webhooks/cro07/sendgrid",
          process.env.APP_URL || "https://libertybancard.com",
        ).href;
        if (
          !callback.startsWith("https://") ||
          settings.id !== id ||
          signed.id !== id ||
          settings.enabled !== true ||
          settings.url !== callback ||
          ![
            "delivered",
            "bounce",
            "spam_report",
            "unsubscribe",
            "group_unsubscribe",
            "processed",
            "dropped",
          ].every((k) => settings[k] === true) ||
          keyHash(String(signed.public_key)) !== keyHash(publicKey) ||
          keyHash(String(settings.public_key)) !== keyHash(publicKey)
        )
          throw Error("SENDGRID_SUBSCRIPTION_NOT_VERIFIED");
        const reader = (
          await c.query(
            `SELECT phase7_generation,account_fingerprint,state,history_cursor,phase7_history_complete,last_error,last_success_at,last_success_at>clock_timestamp()-interval '5 minutes' AS fresh FROM gmail_mailbox_reader_state WHERE lower(account_email)=lower($1)`,
            [identity.replyAccount],
          )
        ).rows[0];
        proof = {
          ...proof,
          webhookId: id,
          smtpKeyIdHash: digest(smtpKeyId),
          senderIdentityHash: digest(identity),
          url: callback,
          publicKeyHash: keyHash(publicKey),
          settingsHash: digest(settings),
          readerGeneration: reader?.phase7_generation ?? null,
          readerCursorHash: reader?.history_cursor
            ? digest(reader.history_cursor)
            : null,
          readerLastSuccess: reader?.last_success_at ?? null,
        };
        if (
          !reader ||
          reader.state !== "active" ||
          !reader.phase7_history_complete ||
          !reader.fresh ||
          reader.last_error ||
          !reader.history_cursor ||
          reader.account_fingerprint !==
            createHash("sha256")
              .update("gmail-account:" + identity.replyAccount.toLowerCase())
              .digest("hex")
        )
          throw Error("MAILBOX_CONTINUITY_NOT_VERIFIED");
        healthy = true;
        reason = "OBSERVED_SENDGRID_SUBSCRIPTION_AND_COMPLETE_MAILBOX_POLL";
      }
    } catch (e) {
      reason =
        e instanceof Error && /^(SENDGRID_|MAILBOX_)/.test(e.message)
          ? e.message
          : "SENDGRID_COVERAGE_PROBE_FAILED";
    }
    const identityHash = digest({
      identity,
      webhookId: proof.webhookId ?? null,
      smtpKeyIdHash: proof.smtpKeyIdHash ?? null,
      senderIdentityHash: proof.senderIdentityHash ?? null,
      publicKeyHash: proof.publicKeyHash ?? null,
      settingsHash: proof.settingsHash ?? null,
      readerGeneration: proof.readerGeneration ?? null,
    });
    const row = (
      await c.query(
        `INSERT INTO cro07_feedback_coverage_observations(sender_account,reply_account,identity_hash,healthy,reason,proof)VALUES($1,$2,$3,$4,$5,$6)RETURNING id,observed_at`,
        [
          identity.senderAccount,
          identity.replyAccount,
          identityHash,
          healthy,
          reason,
          JSON.stringify(proof),
        ],
      )
    ).rows[0];
    await c.query(
      `UPDATE conversion_evidence_checkpoints SET status=$1,reason=$2,observed_at=clock_timestamp() WHERE source_type='phase7_feedback'`,
      [
        healthy ? "partial" : "unavailable",
        healthy
          ? "Forward observed SendGrid/mailbox health only; fixed-horizon coverage is evaluated per experiment"
          : reason,
      ],
    );
    return {
      state: healthy ? "observed_healthy" : "unavailable",
      reason,
      ...row,
    };
  } finally {
    try {
      if (locked)
        await c.query(
          "SELECT pg_advisory_unlock(hashtext('phase7-sendgrid-coverage-owner'))",
        );
    } finally {
      c.release();
    }
  }
}
export async function readPhase7CurrentFeedbackStatus(client: any = pool) {
  const identity = phase7SenderIdentity();
  const row = (
    await client.query(
      `SELECT healthy,reason,observed_at,proof->>'readerGeneration' AS reader_generation,observed_at>clock_timestamp()-interval '5 minutes' AS fresh FROM cro07_feedback_coverage_observations WHERE sender_account=$1 AND reply_account=$2 ORDER BY id DESC LIMIT 1`,
      [identity.senderAccount, identity.replyAccount],
    )
  ).rows[0];
  let ready = false;
  try {
    await assertPhase7FeedbackReady(client, identity);
    ready = true;
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("CRO07_")) throw e;
  }
  return {
    ready,
    status: ready ? "observed_healthy" : "unavailable",
    reason: ready
      ? row.reason
      : row?.healthy
        ? "Current mailbox state or provider observation is stale, unavailable, or changed"
        : row?.reason ||
          "SendGrid subscription and mailbox continuity have not been observed",
    observedAt: row?.observed_at ?? null,
    measurementEnabled: process.env.PHASE7_MEASUREMENT_ENABLED === "true",
    provider: "sendgrid",
    historicalCoverage: false,
  };
}
/** Exact horizon-specific coverage; changing settings, reader generation, missing probes or errors breaks the chain. */
export async function readPhase7FeedbackCoverage(client: any, e: any) {
  const identity = e.phase7_design?.senderIdentity;
  if (!identity || !e.started_at || !e.maturity_ends_at)
    return {
      status: "unavailable",
      reason: "Frozen sender and collection horizon required",
    };
  const graceEnd = new Date(
    +new Date(e.maturity_ends_at) + SENDGRID_RETRY_GRACE_HOURS * 3600_000,
  );
  const missingTerminal = (
    await client.query(
      `SELECT count(*)::int AS n FROM cro07_receipt_exposures x JOIN cro07_subject_assignments a ON a.id=x.assignment_id JOIN outbound_send_log l ON l.id=x.outbound_log_id JOIN cro07_attempt_envelopes f ON f.outbound_log_id=l.id WHERE a.experiment_id=$1 AND NOT EXISTS(SELECT 1 FROM cro07_sendgrid_event_observations o WHERE o.sender_account=$2 AND lower(o.recipient)=lower(l.to_address) AND o.event_type IN ('delivered','hard_bounce') AND o.occurred_at>=f.created_at-interval '1 second' AND o.occurred_at<=$3 AND (o.provider_message_id=x.provider_message_id OR (o.provider_message_id IS NULL AND o.sendgrid_message_id IS NOT NULL AND (SELECT count(DISTINCT m.provider_message_id) FROM cro07_sendgrid_event_observations m WHERE m.sender_account=o.sender_account AND m.sendgrid_message_id=o.sendgrid_message_id AND lower(m.recipient)=lower(o.recipient) AND m.provider_message_id IS NOT NULL)=1 AND EXISTS(SELECT 1 FROM cro07_sendgrid_event_observations m WHERE m.sender_account=o.sender_account AND m.sendgrid_message_id=o.sendgrid_message_id AND lower(m.recipient)=lower(o.recipient) AND m.provider_message_id=x.provider_message_id))))`,
      [e.id, identity.senderAccount, graceEnd],
    )
  ).rows[0].n;
  if (missingTerminal)
    return {
      status: "unavailable",
      reason:
        "Accepted exposures still lack exact signed SendGrid delivery or hard-bounce evidence",
      missingTerminal,
      graceEndsAt: graceEnd.toISOString(),
    };
  const unresolved = (
    await client.query(
      `SELECT count(*)::int AS n FROM cro07_sendgrid_event_observations o WHERE o.sender_account=$1 AND o.event_type IN ('hard_bounce','complaint','explicit_unsubscribe','unclassified_safety') AND COALESCE(o.occurred_at,o.created_at) >= $2::timestamptz-interval '1 second' AND COALESCE(o.occurred_at,o.created_at) <= $3 AND (o.recipient IS NULL OR EXISTS(SELECT 1 FROM cro07_receipt_exposures x JOIN outbound_send_log l ON l.id=x.outbound_log_id JOIN cro07_subject_assignments a ON a.id=x.assignment_id WHERE a.experiment_id=$4 AND lower(l.to_address)=lower(o.recipient))) AND NOT EXISTS(SELECT 1 FROM cro07_provider_receipts r JOIN cro07_verified_outcomes v ON v.receipt_id=r.id::text AND v.receipt_kind='signed_provider' WHERE r.source='sendgrid' AND r.provider_event_id=o.provider_event_id)`,
      [identity.senderAccount, e.started_at, e.maturity_ends_at, e.id],
    )
  ).rows[0].n;
  if (unresolved)
    return {
      status: "unavailable",
      reason:
        "Signed SendGrid safety observations still lack an exact verified message relation",
      unresolved,
      graceEndsAt: graceEnd.toISOString(),
    };
  const result = (
    await client.query(
      `WITH anchor AS(SELECT * FROM cro07_feedback_coverage_observations WHERE sender_account=$1 AND reply_account=$2 AND observed_at<=$3 AND observed_at>=$3::timestamptz-interval '10 minutes' ORDER BY observed_at DESC,id DESC LIMIT 1), ending AS(SELECT observed_at,id FROM cro07_feedback_coverage_observations WHERE sender_account=$1 AND reply_account=$2 AND observed_at>=$4 AND observed_at<=$4::timestamptz+interval '10 minutes' ORDER BY observed_at,id LIMIT 1), chain AS(SELECT o.*,lag(o.observed_at)OVER(ORDER BY o.observed_at,o.id) AS previous_at FROM cro07_feedback_coverage_observations o,anchor a,ending z WHERE o.sender_account=$1 AND o.reply_account=$2 AND (o.observed_at,o.id)>=(a.observed_at,a.id) AND (o.observed_at,o.id)<=(z.observed_at,z.id)) SELECT EXISTS(SELECT 1 FROM anchor a,ending z WHERE a.healthy AND z.observed_at<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM chain c,anchor a WHERE NOT c.healthy OR c.identity_hash<>a.identity_hash OR c.observed_at-c.previous_at>interval '10 minutes') AS complete`,
      [identity.senderAccount, identity.replyAccount, e.started_at, graceEnd],
    )
  ).rows[0];
  return {
    status: result.complete ? "complete" : "unavailable",
    reason: result.complete
      ? "Forward observed SendGrid/mailbox coverage through fixed horizon and 24-hour retry grace"
      : "Continuous SendGrid/mailbox observations through horizon and retry grace are incomplete",
    graceEndsAt: graceEnd.toISOString(),
    maxProbeGapSeconds: 600,
  };
}
export async function receivePhase7SendGrid(
  raw: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
) {
  const key = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
  if (!key || !verifySendGridSignature(raw, signature, timestamp, key))
    throw Error("SENDGRID_SIGNATURE_REQUIRED");
  const events = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(events) || events.length > 1000)
    throw Error("SENDGRID_BATCH_INVALID");
  const identity = phase7SenderIdentity();
  let applied = 0;
  for (const value of events) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("SENDGRID_EVENT_INVALID");
    const event = value as Record<string, unknown>,
      hash = digest(event),
      eventId =
        typeof event.sg_event_id === "string" &&
        event.sg_event_id.length > 0 &&
        event.sg_event_id.length <= 500
          ? event.sg_event_id
          : "missing:" + hash;
    const message =
      typeof event["smtp-id"] === "string" && event["smtp-id"].length <= 500
        ? event["smtp-id"]
        : null;
    const recipient =
      typeof event.email === "string" &&
      event.email.length > 0 &&
      event.email.length <= 500
        ? event.email
        : null;
    const at =
      typeof event.timestamp === "number"
        ? new Date(event.timestamp * 1000)
        : null;
    const validTime = at && Number.isFinite(+at) && +at <= Date.now() + 60_000;
    const sgMessage =
      typeof event.sg_message_id === "string" &&
      event.sg_message_id.length <= 1000
        ? event.sg_message_id
        : null;
    const kind = sendGridKind(event),
      usable = !!(
        kind &&
        recipient &&
        validTime &&
        !eventId.startsWith("missing:")
      );
    const knownNonHardBounce =
      event.event === "bounce" &&
      (event.type === "blocked" || /^4\./.test(String(event.status ?? "")));
    const safetyEvent =
      [
        "bounce",
        "spamreport",
        "unsubscribe",
        "group_unsubscribe",
        "dropped",
      ].includes(String(event.event)) && !knownNonHardBounce;
    const observedKind = usable
      ? kind
      : safetyEvent
        ? "unclassified_safety"
        : null;
    const row = (
      await pool.query(
        `INSERT INTO cro07_sendgrid_event_observations(provider_event_id,sender_account,provider_message_id,sendgrid_message_id,recipient,event_type,occurred_at,payload_hash,reason)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)ON CONFLICT(provider_event_id)DO NOTHING RETURNING id`,
        [
          eventId,
          identity.senderAccount,
          message,
          sgMessage,
          recipient,
          observedKind,
          validTime ? at : null,
          hash,
          usable ? "SIGNED_PROVIDER_EVENT" : "SIGNED_UNSUPPORTED_OR_INCOMPLETE",
        ],
      )
    ).rows[0];
    if (!row) {
      const prior = (
        await pool.query(
          "SELECT payload_hash FROM cro07_sendgrid_event_observations WHERE provider_event_id=$1",
          [eventId],
        )
      ).rows[0];
      if (prior.payload_hash !== hash)
        throw Error("SENDGRID_EVENT_REPLAY_CONFLICT");
    }
    if (usable) {
      const linked =
        message ??
        (await resolveSendGridSmtpMessage(
          identity.senderAccount,
          sgMessage,
          recipient!,
        ));
      if (linked) {
        const r = await ingestPhase7ProviderFeedback({
          source: "sendgrid",
          providerAccountId: identity.senderAccount,
          providerEventId: eventId,
          providerMessageId: linked,
          recipient: recipient!,
          eventType: kind!,
          occurredAt: at!,
          payloadHash: hash,
        });
        if (r.applied) applied++;
      }
    }
  }
  return { received: events.length, applied };
}
async function resolveSendGridSmtpMessage(
  sender: string,
  message: string | null,
  recipient: string,
) {
  if (!message) return null;
  const rows = (
    await pool.query(
      `SELECT DISTINCT provider_message_id FROM cro07_sendgrid_event_observations WHERE sender_account=$1 AND sendgrid_message_id=$2 AND lower(recipient)=lower($3) AND provider_message_id IS NOT NULL LIMIT 2`,
      [sender, message, recipient],
    )
  ).rows;
  return rows.length === 1 ? rows[0].provider_message_id : null;
}
/** Retry retained exact signed observations after receipt projection; never re-read a historical mailbox. */
export async function reconcilePhase7SendGridEvents() {
  const cursor =
    (
      await pool.query(
        "SELECT cursor_value FROM conversion_evidence_checkpoints WHERE source_type='phase7_sendgrid_cursor'",
      )
    ).rows[0]?.cursor_value ?? "0";
  let rows = (
    await pool.query(
      "SELECT * FROM cro07_sendgrid_event_observations WHERE id>$1 AND event_type IN ('delivered','hard_bounce','complaint','explicit_unsubscribe','open','click') ORDER BY id LIMIT 100",
      [cursor],
    )
  ).rows;
  if (!rows.length && cursor !== "0")
    rows = (
      await pool.query(
        "SELECT * FROM cro07_sendgrid_event_observations WHERE event_type IN ('delivered','hard_bounce','complaint','explicit_unsubscribe','open','click') ORDER BY id LIMIT 100",
      )
    ).rows;
  for (const r of rows) {
    const linked =
      r.provider_message_id ??
      (await resolveSendGridSmtpMessage(
        r.sender_account,
        r.sendgrid_message_id,
        r.recipient,
      ));
    if (linked)
      await ingestPhase7ProviderFeedback({
        source: "sendgrid",
        providerAccountId: r.sender_account,
        providerEventId: r.provider_event_id,
        providerMessageId: linked,
        recipient: r.recipient,
        eventType: r.event_type,
        occurredAt: r.occurred_at,
        payloadHash: r.payload_hash,
      });
  }
  if (rows.length)
    await pool.query(
      "INSERT INTO conversion_evidence_checkpoints(source_type,cursor_value,status,reason)VALUES('phase7_sendgrid_cursor',$1,'partial','Bounded signed-event continuation cursor')ON CONFLICT(source_type)DO UPDATE SET cursor_value=excluded.cursor_value,observed_at=now()",
      [String(rows.at(-1).id)],
    );
  return rows.length;
}
