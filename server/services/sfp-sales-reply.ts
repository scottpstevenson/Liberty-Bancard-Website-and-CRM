import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { recordInboundEventInTx } from "./communication-events";
import { communicationContactLockKey } from "./communication-contact-lock";
import { SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX } from "./cro03/sfp-launch-content";
import { isSfpSalesAddress } from "./sender-policy";
import { recordSeedReply } from "./sfp-seed-authority";
import { classifyMailboxMessage, extractAddresses, type MailboxMessageHeaders } from "./website-email-contracts";

function configuredReaderAccount(): string | undefined {
  return process.env.SFP_COLD_REPLY_GMAIL_ACCOUNT?.trim().toLowerCase() || undefined;
}

export async function isSfpSalesReplyReaderReady(): Promise<boolean> {
  const account = configuredReaderAccount();
  if (!account) return false;
  const { readGmailSenderEvidence } = await import("./gmail-oauth");
  if ((await readGmailSenderEvidence()).account !== account) return false;
  const result = await db.execute(sql`
    SELECT 1 FROM gmail_mailbox_reader_state
    WHERE account_email = ${account} AND state = 'active'
      AND history_cursor IS NOT NULL AND last_error IS NULL AND phase7_history_complete = TRUE
      AND last_success_at > now() - interval '10 minutes'
  `);
  return result.rows.length === 1;
}

type SalesReplyMessage = {
  providerMessageId: string;
  threadId: string | null;
  receivedAt: Date | null;
  headers: MailboxMessageHeaders;
  recipientHeaders: readonly (string | null)[];
};

/** Project a correlated human reply from Gmail into the CRM's existing Inbox and reply-stop authority. */
export async function recordSfpSalesReply(
  account: string,
  message: SalesReplyMessage,
  now: Date,
): Promise<"applied" | "duplicate" | "ignored"> {
  const normalizedAccount = account.toLowerCase();
  if (normalizedAccount !== configuredReaderAccount() || !message.providerMessageId) return "ignored";
  const salesRecipients = [...new Set(message.recipientHeaders.flatMap(extractAddresses).filter(isSfpSalesAddress))];
  if (!salesRecipients.length) return "ignored";
  const { receivedAt, headers } = message;
  if (!receivedAt || !Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > now.getTime() + 60_000) return "ignored";
  if (headers.labelIds.some((label) => ["SPAM", "TRASH", "DRAFT"].includes(label))) return "ignored";
  const classification = classifyMailboxMessage(headers);
  if (classification.fromSentFolder || !classification.fromAddress || classification.kind === "auto_reply" || classification.kind === "bounce") return "ignored";
  const references = headers.inReplyTo?.trim() || headers.references || "";
  const messageIds = [...new Set(references.match(/<[^<>\s]{1,240}@[^<>\s]{1,253}>/g) ?? [])].slice(-32);
  if (!messageIds.length) return "ignored";
  const matches = await db.execute<{ contact_id: number; enrollment_id: number; send_id: number }>(sql`
    SELECT DISTINCT ON (send.contact_id, enrollment.id)
      send.contact_id, enrollment.id AS enrollment_id, send.id AS send_id
    FROM outbound_send_log send
    JOIN sequence_enrollments enrollment
      ON enrollment.id = send.sequence_enrollment_id AND enrollment.contact_id = send.contact_id
    JOIN follow_up_sequences sequence ON sequence.id = send.sequence_id AND sequence.id = enrollment.sequence_id
    WHERE send.channel = 'email_smtp'
      AND lower(send.from_address) IN (${sql.join(salesRecipients.map((address) => sql`${address}`), sql`, `)})
      AND lower(send.to_address) = ${classification.fromAddress}
      AND send.provider_message_id IN (${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)})
      AND send.sent_at <= ${receivedAt}
      AND sequence.sequence_family LIKE ${SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX + "%"}
      AND COALESCE(enrollment.metadata, '{}'::jsonb) ? 'canonicalRelease'
    ORDER BY send.contact_id, enrollment.id, send.sent_at DESC, send.id DESC
    LIMIT 2
  `);
  if (!matches.rows.length) {
    return recordSeedReply({ fromAddress: classification.fromAddress, salesRecipients, messageIds, receivedAt });
  }
  if (matches.rows.length !== 1) return "ignored";
  const match = matches.rows[0];
  const externalId = createHash("sha256").update(`sfp-gmail:${normalizedAccount}:${message.providerMessageId}`).digest("hex");
  const subject = headers.subject?.trim().slice(0, 300) || "Sales email reply";
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${communicationContactLockKey(match.contact_id).toString()}::bigint)`);
    const prior = await tx.execute(sql`
      SELECT 1 FROM communication_events
      WHERE contact_id = ${match.contact_id} AND direction = 'inbound' AND provider = 'gmail'
        AND external_message_id = ${externalId}
    `);
    if (prior.rows.length) return "duplicate";
    const eventId = await recordInboundEventInTx(tx, {
      contactId: match.contact_id,
      channel: "email",
      provider: "gmail",
      subject,
      automationStopped: true,
      automationStopReason: "sfp_sales_reply",
      externalMessageId: externalId,
      occurredAt: receivedAt,
      metadata: { sfp: { sendId: match.send_id, enrollmentId: match.enrollment_id, threadId: message.threadId } },
    });
    await tx.execute(sql`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details)
      VALUES ('email_inbound', 'contact', ${match.contact_id}, 'system',
        ${JSON.stringify({ subject, snippet: `${subject}\nRead the reply in the shared sales inbox.`, channel: "email", communicationEventId: eventId })}::jsonb)
    `);
    return "applied";
  });
}
