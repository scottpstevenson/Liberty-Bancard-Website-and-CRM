/**
 * Gmail mailbox reader for the website warm lane. Read-only, default CLOSED, single-leased, no historical backfill.
 *
 * What it proves: that replies, bounces and automatic replies to the connected mailbox are being observed (the reply
 * path proof the lane requires before any send), and it applies stop/bounce evidence to active warm admissions.
 * What it never does: send, delete, label, mark read, or read message bodies (metadata headers only).
 *
 * Cursor rule: the history cursor advances only after every message of the page batch is durably applied (or recorded
 * as unapplied evidence). A failure leaves the cursor in place; replays are idempotent through the unique evidence key.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getGmailReaderClient, readGmailSenderEvidence } from "./gmail-oauth";
import { recordInboundEventInTx } from "./communication-events";
import {
  classifyMailboxMessage,
  extractAddress,
  mailboxEvidenceHash,
  type MailboxClassification,
  type MailboxMessageHeaders,
} from "./website-email-contracts";
import { revokeAdmissionInTx, rowsOf, type Exec } from "./website-email-lane-store";
import { lockForContact, settleAcceptedInTx } from "./website-email-runtime";

export const READER_LEASE_MS = 5 * 60 * 1000;
const MAX_HISTORY_PAGES = 5;
const METADATA_HEADERS = ["From", "Subject", "Message-ID", "In-Reply-To", "References", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Failed-Recipients", "Content-Type"];

export type ReaderStatus =
  | "closed"
  | "leased_elsewhere"
  | "unavailable"
  | "needs_resync"
  | "initialized"
  | "polled"
  | "error";

export interface ReaderTally {
  status: ReaderStatus;
  code?: string;
  messages: number;
  applied: number;
  unapplied: number;
  duplicates: number;
  ignored: number;
}

const tally = (status: ReaderStatus, code?: string): ReaderTally => ({ status, code, messages: 0, applied: 0, unapplied: 0, duplicates: 0, ignored: 0 });

export interface ReaderGmail {
  users: {
    getProfile(args: { userId: string }): Promise<{ data: { historyId?: string | null } }>;
    history: { list(args: Record<string, unknown>): Promise<{ data: { history?: Array<{ messagesAdded?: Array<{ message?: { id?: string | null; labelIds?: string[] | null } }> }>; historyId?: string | null; nextPageToken?: string | null } }> };
    messages: { get(args: Record<string, unknown>): Promise<{ data: { id?: string | null; threadId?: string | null; labelIds?: string[] | null; internalDate?: string | null; payload?: { headers?: Array<{ name?: string | null; value?: string | null }> } } }> };
  };
}

export interface ReaderDeps {
  getClient: () => Promise<{ ok: true; gmail: unknown; account: string } | { ok: false; code: string }>;
  now: () => Date;
}

const defaultDeps = (): ReaderDeps => ({ getClient: getGmailReaderClient as ReaderDeps["getClient"], now: () => new Date() });

const fingerprint = (account: string) => createHash("sha256").update(`gmail-account:${account.toLowerCase()}`).digest("hex");

// ── Admin controls ───────────────────────────────────────────────────────────

/** Open the reader for the connected account. The first poll initializes the cursor to "now": nothing earlier is read. */
export async function openMailboxReader(): Promise<{ ok: true; account: string } | { ok: false; code: "GMAIL_NOT_CONNECTED" }> {
  const { account } = await readGmailSenderEvidence();
  if (!account) return { ok: false, code: "GMAIL_NOT_CONNECTED" };
  await db.execute(sql`
    INSERT INTO gmail_mailbox_reader_state (account_email, state, account_fingerprint, updated_at)
    VALUES (${account}, 'active', ${fingerprint(account)}, now())
    ON CONFLICT (account_email) DO UPDATE
      SET state = 'active', history_cursor = NULL, last_error = NULL, lease_token = NULL, lease_expires_at = NULL,
          account_fingerprint = ${fingerprint(account)}, updated_at = now()
  `);
  return { ok: true, account };
}

export async function closeMailboxReader(): Promise<{ ok: boolean }> {
  const { account } = await readGmailSenderEvidence();
  if (!account) return { ok: false };
  await db.execute(sql`UPDATE gmail_mailbox_reader_state SET state = 'closed', lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE account_email = ${account}`);
  return { ok: true };
}

export async function readMailboxReaderStatus(): Promise<{ account: string | null; state: string; lastSuccessAt: string | null; lastError: string | null; hasCursor: boolean; unappliedEvidence: number }> {
  const { account } = await readGmailSenderEvidence();
  if (!account) return { account: null, state: "closed", lastSuccessAt: null, lastError: null, hasCursor: false, unappliedEvidence: 0 };
  const row = rowsOf<any>(await db.execute(sql`SELECT state, last_success_at, last_error, history_cursor FROM gmail_mailbox_reader_state WHERE account_email = ${account}`))[0];
  const unapplied = rowsOf<{ n: string }>(await db.execute(sql`SELECT count(*)::text AS n FROM website_inbound_evidence WHERE account_email = ${account} AND state = 'unapplied'`))[0];
  return {
    account,
    state: row?.state ?? "closed",
    lastSuccessAt: row?.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastError: row?.last_error ?? null,
    hasCursor: Boolean(row?.history_cursor),
    unappliedEvidence: Number(unapplied?.n ?? 0),
  };
}

// ── Message application ──────────────────────────────────────────────────────

type MessageMeta = { providerMessageId: string; threadId: string | null; labelIds: string[]; receivedAt: Date | null; headers: MailboxMessageHeaders };

function headersFrom(raw: Array<{ name?: string | null; value?: string | null }> | undefined, labelIds: string[]): MailboxMessageHeaders {
  const get = (name: string) => raw?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? null;
  return {
    from: get("From"), subject: get("Subject"), messageId: get("Message-ID"), inReplyTo: get("In-Reply-To"), references: get("References"),
    autoSubmitted: get("Auto-Submitted"), precedence: get("Precedence"), xAutoreply: get("X-Autoreply"), xFailedRecipients: get("X-Failed-Recipients"),
    contentType: get("Content-Type"), labelIds,
  };
}

async function receiptsForRfcIds(tx: Exec, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return rowsOf<{ id: number; contact_id: number; admission_id: number; outcome: string; rfc_message_id: string }>(await tx.execute(sql`
    SELECT id, contact_id, admission_id, outcome, rfc_message_id FROM website_email_send_receipts
    WHERE lower(rfc_message_id) IN (${sql.join(ids.map((id) => sql`${id.toLowerCase()}`), sql`, `)})
  `));
}

async function activeAdmissionContactsForAddress(tx: Exec, address: string | null): Promise<number[]> {
  if (!address) return [];
  return rowsOf<{ id: number }>(await tx.execute(sql`
    SELECT DISTINCT a.contact_id AS id FROM website_lifecycle_admissions a JOIN contacts c ON c.id = a.contact_id
    WHERE a.state = 'active' AND lower(c.email) = ${address.toLowerCase()}
  `)).map((r) => Number(r.id));
}

async function insertEvidence(tx: Exec, account: string, meta: MessageMeta, kind: MailboxClassification["kind"], state: "applied" | "unapplied", reason: string, receiptId: number | null, contactId: number | null) {
  return rowsOf<{ id: number }>(await tx.execute(sql`
    INSERT INTO website_inbound_evidence
      (account_email, provider_message_id, thread_id, rfc_message_id, kind, state, reason, send_receipt_id, contact_id, evidence_hash, received_at)
    VALUES (${account}, ${meta.providerMessageId}, ${meta.threadId}, ${meta.headers.messageId}, ${kind}, ${state}, ${reason}, ${receiptId}, ${contactId},
            ${mailboxEvidenceHash({ account, providerMessageId: meta.providerMessageId, kind, messageId: meta.headers.messageId })}, ${meta.receivedAt})
    ON CONFLICT (account_email, provider_message_id) DO NOTHING
    RETURNING id
  `))[0] ?? null;
}

export type ApplyOutcome = "applied" | "unapplied" | "duplicate" | "ignored";

/** Apply one classified message in its own transaction. Exported for the disposable certification. */
export async function applyMailboxMessage(account: string, meta: MessageMeta, now: Date = new Date()): Promise<ApplyOutcome> {
  const cls = classifyMailboxMessage(meta.headers);
  const known = await db.execute(sql`SELECT 1 FROM website_inbound_evidence WHERE account_email = ${account} AND provider_message_id = ${meta.providerMessageId}`);
  if (rowsOf(known).length > 0) return "duplicate";

  // Resolve correlation outside the write transaction to learn which contact(s) to lock.
  const ownIds = cls.fromSentFolder && meta.headers.messageId ? [meta.headers.messageId] : cls.ourRfcIds;
  const preReceipts = await receiptsForRfcIds(db, ownIds);
  const preContacts = new Set<number>(preReceipts.map((r) => Number(r.contact_id)));
  if (!cls.fromSentFolder && (cls.kind === "reply" || cls.kind === "other")) {
    for (const id of await activeAdmissionContactsForAddress(db, cls.fromAddress)) preContacts.add(id);
  }
  if (cls.kind === "bounce") {
    for (const addr of cls.failedRecipients) for (const id of await activeAdmissionContactsForAddress(db, addr)) preContacts.add(id);
  }

  if (cls.fromSentFolder && preReceipts.length === 0) return "ignored";

  return db.transaction(async (tx): Promise<ApplyOutcome> => {
    for (const contactId of [...preContacts].sort((a, b) => a - b)) await lockForContact(tx, contactId);
    const receipts = await receiptsForRfcIds(tx, ownIds);
    const receipt = receipts[0] ?? null;

    if (cls.fromSentFolder) {
      const row = await insertEvidence(tx, account, meta, "other", "applied", receipt!.outcome === "uncertain" ? "SENT_COPY_SETTLED_UNCERTAIN" : "SENT_COPY_MATCHED", Number(receipt!.id), Number(receipt!.contact_id));
      if (!row) return "duplicate";
      if (receipt!.outcome === "uncertain") await settleAcceptedInTx(tx, Number(receipt!.id), { messageId: meta.providerMessageId, threadId: meta.threadId }, now, null);
      return "applied";
    }

    if (cls.kind === "auto_reply") {
      const row = await insertEvidence(tx, account, meta, "auto_reply", "applied", "AUTO_REPLY_EVIDENCE_ONLY", receipt ? Number(receipt.id) : null, receipt ? Number(receipt.contact_id) : null);
      return row ? "applied" : "duplicate";
    }

    if (cls.kind === "bounce") {
      const contactIds = new Set<number>(receipts.map((r) => Number(r.contact_id)));
      for (const addr of cls.failedRecipients) for (const id of await activeAdmissionContactsForAddress(tx, addr)) contactIds.add(id);
      if (contactIds.size === 0) {
        const row = await insertEvidence(tx, account, meta, "bounce", "unapplied", cls.failedRecipients.length ? "NO_MATCHING_ADMISSION" : "BOUNCE_RECIPIENT_UNKNOWN", null, null);
        return row ? "unapplied" : "duplicate";
      }
      const row = await insertEvidence(tx, account, meta, "bounce", "applied", "BOUNCE_REVOKED_ADMISSIONS", receipt ? Number(receipt.id) : null, [...contactIds][0]);
      if (!row) return "duplicate";
      for (const contactId of contactIds) {
        const admissions = rowsOf<{ id: number }>(await tx.execute(sql`SELECT id FROM website_lifecycle_admissions WHERE contact_id = ${contactId} AND state = 'active'`));
        for (const a of admissions) await revokeAdmissionInTx(tx, Number(a.id), "BOUNCE_EVIDENCE");
      }
      return "applied";
    }

    // reply, or an uncorrelated message from an address that has an active admission (conservative: stop the journey)
    const contactIds = new Set<number>(receipts.map((r) => Number(r.contact_id)));
    if (contactIds.size === 0) for (const id of await activeAdmissionContactsForAddress(tx, cls.fromAddress)) contactIds.add(id);
    if (contactIds.size === 0) {
      const row = await insertEvidence(tx, account, meta, cls.kind === "reply" ? "reply" : "other", "unapplied", cls.kind === "reply" ? "REPLY_RECEIPT_NOT_FOUND" : "NO_CORRELATION", null, null);
      return row ? "unapplied" : "duplicate";
    }
    const primary = [...contactIds][0];
    const row = await insertEvidence(tx, account, meta, "reply", "applied", receipt ? "REPLY_CORRELATED_BY_MESSAGE_ID" : "REPLY_CORRELATED_BY_ADDRESS", receipt ? Number(receipt.id) : null, primary);
    if (!row) return "duplicate";
    for (const contactId of contactIds) {
      await recordInboundEventInTx(tx as never, {
        contactId,
        channel: "email",
        provider: "gmail",
        subject: meta.headers.subject,
        status: "received",
        automationStopped: true,
        automationStopReason: "website_warm_reply",
        externalMessageId: meta.providerMessageId,
        metadata: { websiteLifecycle: { evidenceId: Number(row.id), receiptId: receipt ? Number(receipt.id) : null } },
        occurredAt: meta.receivedAt ?? now,
      } as never);
      const admissions = rowsOf<{ id: number }>(await tx.execute(sql`SELECT id FROM website_lifecycle_admissions WHERE contact_id = ${contactId} AND state = 'active'`));
      for (const a of admissions) await revokeAdmissionInTx(tx, Number(a.id), "REPLY_RECEIVED");
    }
    return "applied";
  });
}

// ── Poll ─────────────────────────────────────────────────────────────────────

export async function pollMailboxOnce(overrides: Partial<ReaderDeps> = {}): Promise<ReaderTally> {
  const deps = { ...defaultDeps(), ...overrides };
  const { account } = await readGmailSenderEvidence();
  if (!account) return tally("closed", "GMAIL_NOT_CONNECTED");
  const state = rowsOf<any>(await db.execute(sql`SELECT state, history_cursor, account_fingerprint FROM gmail_mailbox_reader_state WHERE account_email = ${account}`))[0];
  if (!state || state.state !== "active") return tally(state?.state === "needs_resync" ? "needs_resync" : "closed");

  const now = deps.now();
  const token = randomUUID();
  const claimed = rowsOf(await db.execute(sql`
    UPDATE gmail_mailbox_reader_state SET lease_token = ${token}, lease_expires_at = ${new Date(now.getTime() + READER_LEASE_MS)}, updated_at = now()
    WHERE account_email = ${account} AND state = 'active' AND (lease_token IS NULL OR lease_expires_at < ${now})
    RETURNING history_cursor, account_fingerprint
  `))[0];
  if (!claimed) return tally("leased_elsewhere");

  const release = (extra: ReturnType<typeof sql>) => db.execute(sql`
    UPDATE gmail_mailbox_reader_state SET ${extra}, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE account_email = ${account} AND lease_token = ${token}
  `);
  const fail = async (code: string, status: ReaderStatus = "unavailable", needsResync = false): Promise<ReaderTally> => {
    await release(needsResync ? sql`state = 'needs_resync', last_error = ${code}` : sql`last_error = ${code}`);
    return tally(status, code);
  };

  if (claimed.account_fingerprint && claimed.account_fingerprint !== fingerprint(account)) return fail("MAILBOX_ACCOUNT_CHANGED", "needs_resync", true);

  const client = await deps.getClient();
  if (!client.ok) return fail(client.code);
  const gmail = client.gmail as ReaderGmail;
  try {
    if (!claimed.history_cursor) {
      const profile = await gmail.users.getProfile({ userId: "me" });
      const historyId = profile.data.historyId;
      if (!historyId) return fail("PROFILE_HISTORY_ID_MISSING", "error");
      await release(sql`history_cursor = ${String(historyId)}, account_fingerprint = ${fingerprint(account)}, last_success_at = now(), last_error = NULL`);
      return tally("initialized");
    }

    const out = tally("polled");
    let cursor = String(claimed.history_cursor);
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const res = await gmail.users.history.list({ userId: "me", startHistoryId: cursor, historyTypes: ["messageAdded"], maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      const added = new Map<string, string[]>();
      let lastRecordId: string | null = null;
      for (const h of res.data.history ?? []) {
        const recordId = (h as { id?: string | null }).id;
        if (recordId) lastRecordId = String(recordId);
        for (const m of h.messagesAdded ?? []) if (m.message?.id) added.set(m.message.id, m.message.labelIds ?? []);
      }
      out.messages += added.size;
      for (const [id] of added) {
        const msg = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: METADATA_HEADERS });
        const labelIds = (msg.data.labelIds ?? added.get(id) ?? []) as string[];
        const meta: MessageMeta = {
          providerMessageId: id, threadId: msg.data.threadId ?? null, labelIds,
          receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : null,
          headers: headersFrom(msg.data.payload?.headers, labelIds),
        };
        const result = await applyMailboxMessage(account, meta, deps.now());
        if (result === "applied") out.applied++;
        else if (result === "unapplied") out.unapplied++;
        else if (result === "duplicate") out.duplicates++;
        else out.ignored++;
      }
      // Every message of this page is durably applied or recorded as evidence: only now may the cursor move.
      pageToken = res.data.nextPageToken ?? undefined;
      cursor = pageToken ? (lastRecordId ?? cursor) : String(res.data.historyId ?? lastRecordId ?? cursor);
      await db.execute(sql`UPDATE gmail_mailbox_reader_state SET history_cursor = ${cursor}, updated_at = now() WHERE account_email = ${account} AND lease_token = ${token}`);
      if (!pageToken) break;
    }
    // A remaining page token is fine: the cursor already sits at the last durably applied record, so the next tick continues.
    await release(sql`history_cursor = ${cursor}, last_success_at = now(), last_error = NULL`);
    return out;
  } catch (error) {
    const status = Number((error as { code?: unknown; response?: { status?: unknown } })?.response?.status ?? (error as { code?: unknown })?.code);
    // 404 on a history id means Google no longer holds the cursor. Never guess a range or backfill: require a resync.
    if (status === 404) return fail("HISTORY_CURSOR_EXPIRED", "needs_resync", true);
    if (status === 401 || status === 403) return fail("GMAIL_READ_ACCESS_REFUSED", "unavailable");
    return fail("GMAIL_READ_FAILED", "error");
  }
}

/** Test helper: the sender address a reply claims, normalized. */
export const replySenderAddress = (headers: MailboxMessageHeaders) => extractAddress(headers.from);
