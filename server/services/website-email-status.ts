/**
 * Read-only status for the website email lifecycle lane. Aggregates and masked identifiers only: no email addresses,
 * no message bodies, no provider tokens. Every number comes from durable rows; nothing here sends, probes or writes.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { readCurrentLaneConfig, readSenderFacts, readProviderLedgerReady, rowsOf, READER_FRESH_MS } from "./website-email-lane-store";
import { readWarmCapacityUsed } from "./website-email-capacity";
import { readMailboxReaderStatus } from "./gmail-mailbox-reader";
import { WARM_PROGRAMS } from "./website-email-contracts";

export interface WebsiteEmailStatus {
  generatedAt: string;
  lane: {
    effectiveState: "closed" | "open" | "revoked" | "malformed";
    revision: number | null;
    senderAccount: string | null;
    senderCategory: string | null;
    eligibilityStartsAt: string | null;
    dailyLimit: number | null;
    sourceProgramMap: unknown;
  };
  sender: { category: string; replyTo: string; replyPathProven: boolean; account: string | null } | null;
  reader: Awaited<ReturnType<typeof readMailboxReaderStatus>> & { freshWithinMs: number };
  /** Whether the communication ledger in this database accepts a Gmail provider value (proved from the catalog, read-only). */
  ledger: { acceptsGmail: boolean };
  capacity: { used: number; limit: number | null; day: string };
  warmRevisions: Array<{ id: number; program: string; state: string; steps: number; unsupportedSteps: number; sourceSequenceId: number | null; snapshotHash: string; createdAt: string; approvedAt: string | null }>;
  intents: Array<{ program: string; state: string; reason: string | null; count: number }>;
  admissions: Array<{ program: string; state: string; count: number }>;
  receipts: Array<{ outcome: string; count: number }>;
  uncertainReceipts: Array<{ id: number; admissionId: number | null; contactId: number | null; stepOrder: number; createdAt: string }>;
  meaning: Record<string, string>;
}

export async function readWebsiteEmailStatus(now: Date = new Date()): Promise<WebsiteEmailStatus> {
  const config = await readCurrentLaneConfig();
  const [sender, reader, ledgerAcceptsGmail] = await Promise.all([readSenderFacts(db, now), readMailboxReaderStatus(), readProviderLedgerReady(db)]);
  const used = reader.account ? await readWarmCapacityUsed(db, reader.account, now) : 0;
  const revisions = rowsOf<any>(await db.execute(sql`
    SELECT id, program, state, source_sequence_id, snapshot_hash, created_at, approved_at,
           COALESCE(jsonb_array_length(snapshot->'steps'), 0) AS steps, COALESCE(jsonb_array_length(unsupported_steps), 0) AS unsupported
    FROM website_warm_revisions ORDER BY id DESC LIMIT 50
  `));
  const intents = rowsOf<any>(await db.execute(sql`
    SELECT program, state, reason, count(*)::int AS n FROM website_lifecycle_intents GROUP BY program, state, reason ORDER BY program, state, reason
  `));
  const admissions = rowsOf<any>(await db.execute(sql`
    SELECT program, state, count(*)::int AS n FROM website_lifecycle_admissions GROUP BY program, state ORDER BY program, state
  `));
  const receipts = rowsOf<any>(await db.execute(sql`
    SELECT outcome, count(*)::int AS n FROM website_email_send_receipts GROUP BY outcome ORDER BY outcome
  `));
  const uncertain = rowsOf<any>(await db.execute(sql`
    SELECT id, admission_id, contact_id, step_order, created_at FROM website_email_send_receipts WHERE outcome = 'uncertain' ORDER BY id ASC LIMIT 25
  `));
  return {
    generatedAt: now.toISOString(),
    lane: {
      effectiveState: config ? (config.status as "closed" | "open" | "revoked" | "malformed") : "closed",
      revision: config?.revision ?? null,
      senderAccount: config?.senderAccount ?? null,
      senderCategory: config?.senderCategory ?? null,
      eligibilityStartsAt: config?.eligibilityStartsAt ? config.eligibilityStartsAt.toISOString() : null,
      dailyLimit: config?.dailyLimit ?? null,
      sourceProgramMap: config?.sourceProgramMap ?? {},
    },
    sender: sender ? { category: sender.category, replyTo: sender.replyTo, replyPathProven: sender.replyPathProven, account: sender.account } : null,
    reader: { ...reader, freshWithinMs: READER_FRESH_MS },
    ledger: { acceptsGmail: ledgerAcceptsGmail },
    capacity: { used, limit: config?.dailyLimit ?? null, day: now.toISOString().slice(0, 10) },
    warmRevisions: revisions.map((r) => ({
      id: Number(r.id), program: String(r.program), state: String(r.state), steps: Number(r.steps), unsupportedSteps: Number(r.unsupported),
      sourceSequenceId: r.source_sequence_id === null ? null : Number(r.source_sequence_id), snapshotHash: String(r.snapshot_hash),
      createdAt: new Date(r.created_at).toISOString(), approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    })),
    intents: intents.map((r) => ({ program: String(r.program), state: String(r.state), reason: r.reason ?? null, count: Number(r.n) })),
    admissions: admissions.map((r) => ({ program: String(r.program), state: String(r.state), count: Number(r.n) })),
    receipts: receipts.map((r) => ({ outcome: String(r.outcome), count: Number(r.n) })),
    uncertainReceipts: uncertain.map((r) => ({
      id: Number(r.id), admissionId: r.admission_id === null ? null : Number(r.admission_id), contactId: r.contact_id === null ? null : Number(r.contact_id),
      stepOrder: Number(r.step_order), createdAt: new Date(r.created_at).toISOString(),
    })),
    meaning: {
      closed: "No website request is admitted and nothing is sent. This is the default.",
      held: "The request is recorded; a named reason says what is missing. Nothing has been sent.",
      accepted: "Accepted by Gmail. This is not proof of inbox delivery.",
      uncertain: "Gmail's answer is unknown. The message is never resent automatically; confirm in the mailbox and resolve it here.",
      replyPathProven: "The reply address belongs to the connected mailbox and the reader reported success recently.",
      ledger: "The message ledger must accept Gmail before the lane can open. If it does not, the schema change in migration 0382 has not reached this database; nothing is admitted or sent.",
      programs: WARM_PROGRAMS.join(", "),
    },
  };
}

export interface WarmRevisionPreview {
  revisionId: number;
  program: string;
  state: string;
  snapshotHash: string;
  sourceSequence: { id: number | null; name: string | null };
  unsupportedSteps: Array<{ stepOrder: number; actionType: string; reason: string }>;
  steps: Array<{
    order: number;
    delayMinutes: number;
    subject: string;
    html: string | null;
    text: string | null;
    links: string[];
    /** A step whose tokens or links cannot render is reported with its typed code instead of being shown as fine. */
    renderError: string | null;
  }>;
  note: string;
}

/**
 * Read-only preview of a frozen warm revision, rendered with a fixed sample contact (no real person's data). It uses the
 * same token registry and final-link gate as the real send, so a step that would be refused is shown as refused.
 */
export async function readWarmRevisionPreview(revisionId: number): Promise<WarmRevisionPreview | null> {
  const row = rowsOf<any>(await db.execute(sql`
    SELECT id, program, state, snapshot, snapshot_hash, unsupported_steps FROM website_warm_revisions WHERE id = ${revisionId}
  `))[0];
  if (!row) return null;
  const snapshot = row.snapshot as { steps?: Array<{ order: number; delayMinutes: number; subject: string; bodyHtml: string }>; sourceSequence?: { id: number | null; name: string | null } };
  const { renderMessage } = await import("./message-token-registry");
  const { htmlToPlainText } = await import("./gmail-mime");
  const source = { contact: { firstName: "Alex", lastName: "Sample", companyName: "Sample Business", phone: "", email: "sample@example.test" } };
  const steps = (snapshot.steps ?? []).map((step) => {
    try {
      const subject = renderMessage("template", step.subject, source, "subject").output;
      const html = renderMessage("template", step.bodyHtml, source, "html").output;
      const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      return { order: step.order, delayMinutes: step.delayMinutes, subject, html, text: htmlToPlainText(html), links, renderError: null };
    } catch (error) {
      const code = error instanceof Error ? (error as { code?: string }).code ?? error.name : "RENDER_FAILED";
      return { order: step.order, delayMinutes: step.delayMinutes, subject: step.subject, html: null, text: null, links: [], renderError: String(code).slice(0, 80) };
    }
  });
  return {
    revisionId: Number(row.id),
    program: String(row.program),
    state: String(row.state),
    snapshotHash: String(row.snapshot_hash),
    sourceSequence: { id: snapshot.sourceSequence?.id ?? null, name: snapshot.sourceSequence?.name ?? null },
    unsupportedSteps: Array.isArray(row.unsupported_steps) ? row.unsupported_steps : [],
    steps,
    note: "Preview uses a sample contact. The sender adds its compliance footer for the message purpose at send time; the footer is not shown here.",
  };
}
