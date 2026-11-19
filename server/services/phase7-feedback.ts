import {sanitizeAuditPayload} from "./audit-sanitizer";
/** Authenticated mailbox metadata -> exact RFC-message lineage. No nearest-address/time attribution. */
import { pool } from "../db";
import {
  classifyMailboxMessage,
  extractAddress,
  type MailboxMessageHeaders,
} from "./website-email-contracts";
import { experimentDigest, type ExperimentCommand } from "./cro07-experiments";
export async function ingestPhase7MailboxReceipt(
  account: string,
  meta: {
    providerMessageId: string;
    receivedAt: Date | null;
    headers: MailboxMessageHeaders;
  },
) {
  const cls = classifyMailboxMessage(meta.headers);
  if (cls.fromSentFolder) return;
  const refs = [
    ...new Set(
      (
        (meta.headers.inReplyTo ?? "") +
        " " +
        (meta.headers.references ?? "")
      ).match(/<[^<>\s]+@[^<>\s]+>/g) ?? [],
    ),
  ].slice(0, 100);
  // Metadata-only reader cannot qualify business intent or prove hard vs soft DSN status.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const matches = refs.length
      ? (
          await c.query(
            `SELECT x.id,l.contact_id,x.occurred_at FROM cro07_receipt_exposures x JOIN outbound_send_log l ON l.id=x.outbound_log_id JOIN cro07_attempt_envelopes f ON f.outbound_log_id=l.id WHERE x.provider_message_id=ANY($1::text[]) AND lower(f.reply_account)=lower($2) AND lower(l.to_address)=lower($3) ORDER BY x.id LIMIT 2`,
            [refs, account, extractAddress(meta.headers.from) ?? ""],
          )
        ).rows
      : [];
    const hit = matches.length === 1 ? matches[0] : null,
      occurred = meta.receivedAt;
    const validTime =
      !!occurred &&
      Number.isFinite(occurred.getTime()) &&
      occurred.getTime() <= Date.now() + 60000 &&
      (!hit || occurred >= hit.occurred_at);
    const kind =
      cls.kind === "auto_reply"
        ? "automated"
        : hit && cls.kind !== "bounce"
          ? "reply"
          : "unknown";
    const reason = !validTime
      ? "INVALID_PROVIDER_TIME"
      : matches.length > 1
        ? "AMBIGUOUS_MESSAGE_REFERENCES"
        : !hit
          ? "UNMATCHED_MESSAGE_OR_ACCOUNT"
          : kind === "automated"
            ? "AUTOMATED_DIAGNOSTIC_ONLY"
            : kind === "unknown"
              ? "BOUNCE_SEVERITY_UNVERIFIED"
              : "EXACT_MESSAGE_ACCOUNT_AND_RECIPIENT";
    const row = (
      await c.query(
        `INSERT INTO cro07_mailbox_receipts(account_hash,provider_message_id,exposure_id,kind,reason,occurred_at,evidence_hash)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT(account_hash,provider_message_id)DO NOTHING RETURNING *`,
        [
          experimentDigest({ account: account.toLowerCase() }),
          meta.providerMessageId,
          validTime ? (hit?.id ?? null) : null,
          kind,
          reason,
          validTime ? occurred : null,
          experimentDigest({
            account: account.toLowerCase(),
            providerMessageId: meta.providerMessageId,
            refs,
            from: extractAddress(meta.headers.from),
            occurred: validTime ? occurred!.toISOString() : null,
            kind,
          }),
        ],
      )
    ).rows[0];
    if (row?.exposure_id)
      await c.query(
        `INSERT INTO cro07_verified_outcomes(exposure_id,receipt_kind,receipt_id,kind,occurred_at)VALUES($1,'authenticated_mailbox',$2,$3,$4)ON CONFLICT DO NOTHING`,
        [row.exposure_id, row.id, kind, row.occurred_at],
      );
    await c.query("COMMIT");
    return row;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
/** Human intent is a versioned review of a real, exactly correlated, non-automated receipt, never a sample boolean. */
export async function qualifyPhase7Reply(
  input: {
    experimentId: string;
    receiptId: string;
    classification: "qualified" | "not_qualified";
    reason: string;
    dealId?: number;
  },
  command: ExperimentCommand,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const actor = (
      await c.query(`SELECT * FROM users WHERE id=$1 FOR SHARE`, [
        command.actor.id,
      ])
    ).rows[0];
    if (
      !actor ||
      actor.role !== "admin" ||
      actor.account_state !== "active" ||
      actor.auth_epoch !== command.actor.authEpoch ||
      actor.account_version !== command.actor.accountVersion
    )
      throw new Error("CRO07_ACTOR_REVOKED");
    const e = (
      await c.query(`SELECT * FROM cro07_experiments WHERE id=$1 FOR UPDATE`, [
        input.experimentId,
      ])
    ).rows[0];
    const hash = experimentDigest(input),
      prior = (
        await c.query(
          `SELECT * FROM cro07_experiment_commands WHERE actor_id=$1 AND command_id=$2`,
          [command.actor.id, command.commandId],
        )
      ).rows[0];
    if (prior) {
      if (
        prior.payload_hash !== hash ||
        prior.experiment_id !== input.experimentId
      )
        throw new Error("CRO07_COMMAND_REPLAY_CONFLICT");
      await c.query("COMMIT");
      return prior.result;
    }
    if (!e || e.revision !== command.expectedVersion)
      throw new Error("CRO07_REVISION_CONFLICT");
    if (e.state !== "collecting") throw new Error("CRO07_NOT_COLLECTING");
    const r = (
      await c.query(
        `SELECT r.*,l.contact_id,a.business_id FROM cro07_mailbox_receipts r JOIN cro07_receipt_exposures x ON x.id=r.exposure_id JOIN cro07_subject_assignments a ON a.id=x.assignment_id JOIN outbound_send_log l ON l.id=x.outbound_log_id WHERE r.id=$1 AND a.experiment_id=$2 AND a.design_hash=$3 AND r.kind='reply' AND r.reason='EXACT_MESSAGE_ACCOUNT_AND_RECIPIENT' FOR SHARE OF r`,
        [input.receiptId, e.id, e.design_hash],
      )
    ).rows[0];
    if (!r) throw new Error("CRO07_VERIFIED_REPLY_REQUIRED");
    const review = (
      await c.query(
        `INSERT INTO cro07_reply_qualifications(receipt_id,classification,reason,actor_id,command_id)VALUES($1,$2,$3,$4,$5)ON CONFLICT(receipt_id)DO NOTHING RETURNING *`,
        [
          r.id,
          input.classification,
          input.reason,
          command.actor.id,
          command.commandId,
        ],
      )
    ).rows[0];
    if (!review) throw new Error("CRO07_REPLY_ALREADY_REVIEWED");
    if (input.classification === "qualified") {
      await c.query(
        `INSERT INTO cro07_verified_outcomes(exposure_id,receipt_kind,receipt_id,kind,occurred_at)VALUES($1,'human_qualified_mailbox',$2,'qualified_reply',$3)ON CONFLICT DO NOTHING`,
        [r.exposure_id, r.id, r.occurred_at],
      );
      if (input.dealId) {
        const deal = (
          await c.query(
            `SELECT d.id FROM deals d JOIN contacts c ON c.id=d.contact_id WHERE d.id=$1 AND c.business_id=$2 AND d.pipeline='sales' AND d.record_class='production' AND d.archived_at IS NULL FOR SHARE OF d,c`,
            [input.dealId, r.business_id],
          )
        ).rows[0];
        if (!deal) throw new Error("CRO07_FOREIGN_JOURNEY");
      }
      await c.query(
        `SELECT phase7_emit_conversion('qualified_mailbox_reply',$1,'engaged',$2,$3,$4,'{}')`,
        [r.id, r.contact_id, input.dealId ?? null, r.occurred_at],
      );
    }
    const result = {
      receiptId: r.id,
      classification: input.classification,
      reviewId: review.id,
    };
    await c.query(
      `INSERT INTO cro07_experiment_commands(actor_id,command_id,experiment_id,payload_hash,result)VALUES($1,$2,$3,$4,$5)`,
      [command.actor.id, command.commandId, e.id, hash, JSON.stringify(result)],
    );
    await c.query(
      `INSERT INTO audit_logs(action,entity_type,user_id,actor_type,details)VALUES('phase7_reply_qualified','cro07_experiment',$1,'user',$2)`,
      [
        command.actor.id,
        JSON.stringify(sanitizeAuditPayload({
          experimentId: e.id,
          receiptId: r.id,
          classification: input.classification,
        })),
      ],
    );
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function applyPhase7Guardrails(client: any, experimentId: string) {
  const e = (
    await client.query(
      `SELECT * FROM cro07_experiments WHERE id=$1 FOR UPDATE`,
      [experimentId],
    )
  ).rows[0];
  if (
    !e?.phase7_design ||
    !["collecting", "ready_for_review"].includes(e.state)
  )
    return null;
  const attempted = Number(
    (
      await client.query(
        `SELECT count(DISTINCT a.business_id)::int AS n FROM cro07_subject_assignments a JOIN cro07_attempt_bindings b ON b.assignment_id=a.id JOIN cro07_attempt_envelopes f ON f.outbound_log_id=b.outbound_log_id WHERE a.experiment_id=$1 AND a.design_hash=$2`,
        [e.id, e.design_hash],
      )
    ).rows[0].n,
  );
  const breaches = [];
  for (const g of e.phase7_design.guardrails) {
    const count = Number(
      (
        await client.query(
          `SELECT count(DISTINCT a.business_id)::int AS n FROM cro07_verified_outcomes o JOIN cro07_receipt_exposures x ON x.id=o.exposure_id JOIN cro07_subject_assignments a ON a.id=x.assignment_id WHERE a.experiment_id=$1 AND a.design_hash=$2 AND o.kind=$3`,
          [e.id, e.design_hash, g.metric],
        )
      ).rows[0].n,
    );
    if (
      attempted >= g.minimumEvidence &&
      attempted > 0 &&
      count / attempted > g.maxRate
    )
      breaches.push({
        metric: g.metric,
        count,
        attempted,
        threshold: g.maxRate,
      });
  }
  if (breaches.length) {
    await client.query(
      `UPDATE cro07_experiments SET state='stopped_guardrail',revision=revision+1,evaluation_lease_token=NULL,evaluation_lease_expires_at=NULL WHERE id=$1`,
      [e.id],
    );
    await client.query(
      `INSERT INTO audit_logs(action,entity_type,actor_type,details)VALUES('phase7_guardrail_stop','cro07_experiment','system',$1)`,
      [JSON.stringify(sanitizeAuditPayload({ experimentId: e.id, breaches }))],
    );
  }
  return { attempted, breaches };
}
/** Called only after the existing CRO07 HMAC verifier. Sender account, final envelope and provider message must all match. */
export async function ingestPhase7ProviderFeedback(input: {
  source: string;
  providerAccountId: string;
  providerEventId: string;
  providerMessageId: string;
  recipient?: string;
  eventType:
    | "delivered"
    | "hard_bounce"
    | "complaint"
    | "explicit_unsubscribe"
    | "open"
    | "click";
  occurredAt: Date;
  payloadHash: string;
}) {
  const configuredSource = process.env.CRO07_SEQUENCE_FEEDBACK_SOURCE,
    configuredAccount = process.env.CRO07_SEQUENCE_FEEDBACK_ACCOUNT;
  if (
    !configuredSource ||
    !configuredAccount ||
    input.source !== configuredSource ||
    input.providerAccountId !== configuredAccount
  )
    throw new Error("CRO07_PROVIDER_ACCOUNT_MISMATCH");
  if (input.occurredAt.getTime() > Date.now() + 60000)
    throw new Error("CRO07_INVALID_PROVIDER_TIME");
  const c = await pool.connect();
  let receipt: any;
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `phase7-provider:${input.source}:${input.providerEventId}`,
    ]);
    const prior = (
      await c.query(
        `SELECT * FROM cro07_provider_receipts WHERE source=$1 AND provider_event_id=$2`,
        [input.source, input.providerEventId],
      )
    ).rows[0];
    if (
      prior &&
      prior.account_hash !== experimentDigest({ account: configuredAccount })
    )
      throw new Error("CRO07_PROVIDER_ACCOUNT_MISMATCH");
    const matches = (
      await c.query(
        `SELECT x.id,l.contact_id,a.experiment_id,x.occurred_at,f.created_at AS dispatch_at FROM cro07_receipt_exposures x JOIN outbound_send_log l ON l.id=x.outbound_log_id JOIN cro07_attempt_envelopes f ON f.outbound_log_id=l.id JOIN cro07_subject_assignments a ON a.id=x.assignment_id WHERE x.provider_message_id=$1 AND f.sender_account=$2 AND ($3::text IS NULL OR lower(l.to_address)=lower($3)) LIMIT 2`,
        [input.providerMessageId, configuredAccount, input.recipient ?? null],
      )
    ).rows;
    const hit =
      matches.length === 1 &&
      +input.occurredAt + 1000 >= +new Date(matches[0].dispatch_at)
        ? matches[0]
        : null;
    if (prior) {
      if (prior.payload_hash !== input.payloadHash)
        throw new Error("CRO07_FEEDBACK_REPLAY_CONFLICT");
      receipt = prior;
    } else {
      receipt = (
        await c.query(
          `INSERT INTO cro07_provider_receipts(source,provider_event_id,account_hash,exposure_id,contact_id,event_type,occurred_at,payload_hash,reason)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`,
          [
            input.source,
            input.providerEventId,
            experimentDigest({ account: configuredAccount }),
            hit?.id ?? null,
            hit?.contact_id ?? null,
            input.eventType,
            input.occurredAt,
            input.payloadHash,
            hit
              ? "EXACT_MESSAGE_ACCOUNT"
              : matches.length > 1
                ? "AMBIGUOUS"
                : "UNMATCHED_OR_INVALID_TIME",
          ],
        )
      ).rows[0];
    }
    if (hit) {
      const kind =
        input.eventType === "explicit_unsubscribe"
          ? "opt_out"
          : input.eventType;
      if (kind !== "delivered")
        await c.query(
          `INSERT INTO cro07_verified_outcomes(exposure_id,receipt_kind,receipt_id,kind,occurred_at)VALUES($1,'signed_provider',$2,$3,$4)ON CONFLICT DO NOTHING`,
          [hit.id, receipt.id, kind, input.occurredAt],
        );
      await applyPhase7Guardrails(c, hit.experiment_id);
      receipt = { ...receipt, exposure_id: hit.id, contact_id: hit.contact_id };
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  // Existing consent/reachability owners are idempotent and retryable; no parallel suppression projection.
  if (receipt.contact_id) {
    const { applyConsentCommand, recordReachabilityObservation } =
      await import("./consent-authority");
    const common = {
      subject: { type: "contact" as const, id: receipt.contact_id },
      eventNamespace: "cro07_phase7_provider",
      eventKey: receipt.id,
      source: "cro07_feedback",
    };
    if (receipt.event_type === "hard_bounce")
      await recordReachabilityObservation({
        ...common,
        channel: "email",
        state: "bounced",
      });
    if (receipt.event_type === "complaint")
      await applyConsentCommand({ ...common, kind: "global_dnc" });
    if (receipt.event_type === "explicit_unsubscribe")
      await applyConsentCommand({
        ...common,
        kind: "opt_out",
        channel: "email",
        evidence: { receiptId: receipt.id, eventType: receipt.event_type },
      });
  }
  return {
    received: true,
    applied: !!receipt.exposure_id,
    receiptId: receipt.id,
  };
}
