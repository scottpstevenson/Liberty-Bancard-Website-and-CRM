/**
 * Deal Boarding Outbox Worker (item 8)
 * =====================================
 * Durable worker for processor_submit effects. The boarding route enqueues
 * a job and returns 202 immediately; this worker purpose-decrypts protected
 * fields in memory, calls the selected adapter, and writes the redacted result.
 *
 * Guarantees:
 *   - Atomic SKIP LOCKED claim.
 *   - Retry skipped if processorApplicationId already set (idempotent).
 *   - Raw provider errors never logged; scrubbed through audit sanitizer.
 *   - No sensitive values in payload.
 *   - Dead-letter after MAX_ATTEMPTS.
 *   - Stale processing rows reclaimed after 10 min.
 */

import { sql, eq, lt, and, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { deals, dealBoardingOutbox, merchantApplications, tasks } from "@shared/schema";
import type { IProcessorAdapter } from "./processors/IProcessorAdapter";
import { storage } from "../storage";
import { auditChange } from "./audit-change";
import { evaluateBoardingReadiness } from "./boarding-readiness";
import { decryptProtectedFields } from "./merchant-protected-data";
import { getProcessor, getDefaultProcessor, requireConfirmedActivationSnapshot } from "./processors/registry";

const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 20_000;
const STALE_LOCK_MS = 10 * 60 * 1000;
const BASE_BACKOFF_MS = 30_000;

let started = false;
let running = false;

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), 30 * 60 * 1000);
}

/**
 * Return ONLY a safe error class/code — never arbitrary error.message or a raw
 * processor/provider response (both can embed PII, secrets, or payloads that the
 * audit sanitizer, which only strips known KEYS, would pass through unchanged).
 */
const SAFE_ERROR_CODE_ALLOWLIST = new Set<string>([
  "23505", "23503", "23502", "40001", "40P01",
  "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND",
]);

function scrubError(err: unknown): string {
  if (err instanceof Error) {
    const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name) ? err.name : "Error";
    const rawCode = (err as any)?.code;
    const code = typeof rawCode === "string" && SAFE_ERROR_CODE_ALLOWLIST.has(rawCode) ? rawCode : undefined;
    return code ? `${name}:${code}` : name;
  }
  return "NonError";
}

interface BoardingRow {
  id: string;
  dealId: number;
  applicationId: number | null;
  processorName: string | null;
  attempts: number;
  payload: Record<string, any>;
  /** Durable marker of an earlier attempt that began dispatch but never settled (S5-14). */
  lastError?: string | null;
}

/** Written (fenced) immediately before provider I/O; a surviving marker means the outcome is unknown. */
const DISPATCH_STARTED = "DISPATCH_STARTED";

async function claimOne(): Promise<BoardingRow | null> {
  const res = await db.execute(sql`
    UPDATE deal_boarding_outbox
    SET status = 'processing', locked_at = now(), updated_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM deal_boarding_outbox
      WHERE status IN ('pending', 'failed')
        AND attempts < ${MAX_ATTEMPTS}
        AND (available_at IS NULL OR available_at <= now())
      ORDER BY available_at ASC NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, deal_id, application_id, processor_name, attempts, payload, last_error
  `);
  const rows = (res as any).rows ?? res;
  if (!rows?.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    dealId: r.deal_id,
    applicationId: r.application_id ?? null,
    processorName: r.processor_name ?? null,
    attempts: r.attempts,
    payload: r.payload ?? {},
    lastError: r.last_error ?? null,
  };
}

async function reclaimStale(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_LOCK_MS);
  await db
    .update(dealBoardingOutbox)
    .set({ status: "pending", lockedAt: null, updatedAt: new Date() })
    .where(and(eq(dealBoardingOutbox.status, "processing"), lt(dealBoardingOutbox.lockedAt, threshold)));
}

/**
 * Sentinel thrown by handleProcessorSubmit when the outbox row has already been
 * placed in a terminal state (dead_letter) internally. tick() catches this class
 * and skips markDelivered — the DB state is already correct.
 */
class AlreadyTerminalError extends Error {
  readonly alreadyHandled = true;
  constructor(reason: string) {
    super(reason);
    this.name = "AlreadyTerminalError";
  }
}

/**
 * Typed settlement returned by handleProcessorSubmit. Every outcome is settled
 * inside the handler's own claim-fenced transaction: "delivered" commits the local
 * submission effects together with the delivered outbox state, "ambiguous" settles
 * terminally (reconciliation required), and "stale_claim" means the claim was no
 * longer owned so nothing was written.
 */
type BoardingSettlement =
  | { settlement: "delivered" }                       // local effects + delivered settlement committed together
  | { settlement: "ambiguous_reconciliation_required" }
  | { settlement: "stale_claim" };                    // claim no longer owned: nothing was written

/** Required provider payload fields — missing values refuse the submission; no identity is fabricated. */
const REQUIRED_PROVIDER_FIELDS = [
  "legalBusinessName", "ein", "businessAddress", "businessCity", "businessState", "businessZip",
  "ownerFirstName", "ownerLastName", "ownerSsn", "ownerDob", "bankRoutingNumber", "bankAccountNumber",
] as const;

/** Names (never values) of required provider fields that are absent/blank. */
function missingProviderFields(payload: Record<string, unknown>): string[] {
  return REQUIRED_PROVIDER_FIELDS.filter((k) => {
    const v = payload[k];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

let processorOverrideForTest: ((name?: string | null) => IProcessorAdapter) | null = null;
function resolveProcessor(name: string | null): IProcessorAdapter {
  if (processorOverrideForTest && process.env.NODE_ENV === "test") return processorOverrideForTest(name);
  return name ? getProcessor(name) : getDefaultProcessor();
}

async function markRetryOrDeadLetter(id: string, dealId: number, attempts: number, err: unknown): Promise<void> {
  const safeErr = scrubError(err);
  const terminal = attempts >= MAX_ATTEMPTS;
  if (terminal) {
    // On terminal dead-letter, transactionally flip the deal to dead_letter and
    // write a redacted audit alongside the outbox row so state stays consistent.
    await db.transaction(async (tx) => {
      const fenced = await tx
        .update(dealBoardingOutbox)
        .set({ status: "dead_letter", lockedAt: null, lastError: safeErr, availableAt: new Date(), updatedAt: new Date() })
        .where(and(eq(dealBoardingOutbox.id, id), eq(dealBoardingOutbox.status, "processing"), eq(dealBoardingOutbox.attempts, attempts)))
        .returning({ id: dealBoardingOutbox.id });
      // Row already settled by someone else (e.g. ambiguous/terminal) — do not
      // flip the deal over a settlement this claim does not own.
      if (fenced.length === 0) return;
      await tx
        .update(deals)
        .set({ boardingStatus: "dead_letter", updatedAt: new Date() })
        .where(eq(deals.id, dealId));
      await auditChange({
        actorType: "system",
        action: "deal_boarding_dead_letter",
        entityType: "deal",
        entityId: dealId,
        details: { errorClass: safeErr, attempts },
      }, tx);
    });
    return;
  }
  await db
    .update(dealBoardingOutbox)
    .set({
      status: "pending",
      lockedAt: null,
      lastError: safeErr,
      availableAt: new Date(Date.now() + backoffMs(attempts)),
      updatedAt: new Date(),
    })
    .where(and(eq(dealBoardingOutbox.id, id), eq(dealBoardingOutbox.status, "processing"), eq(dealBoardingOutbox.attempts, attempts)));
}

const BOARDING_MONITOR_SOURCE = "boarding";
function boardingMonitorAutomationKey(dealId: number): string {
  return `boarding_monitor_${dealId}`;
}

/**
 * Reconcile the local post-provider state (deal fields), redacted audit, and the
 * idempotent monitoring task in ONE transaction. Safe to call when the provider
 * has already succeeded (processorApplicationId known) whether or not a prior
 * attempt crashed before committing these local effects.
 */
async function commitBoardingSuccess(params: {
  dealId: number;
  contactId: number | null;
  owner: string | null;
  processorName: string;
  processorApplicationId: string;
  estimatedDecisionDate?: string | Date | null;
  existingLog: any[];
  setSubmittedFields: boolean;
  /** Confirmed program from the activation snapshot; committed with the success state, not before I/O. */
  processorProgram?: string | null;
  /** The outbox claim this success belongs to; local effects commit only while it is still owned. */
  claim: { id: string; attempts: number };
}): Promise<boolean> {
  const {
    dealId, contactId, owner, processorName, processorApplicationId,
    estimatedDecisionDate, existingLog, setSubmittedFields, processorProgram, claim,
  } = params;
  const automationKey = boardingMonitorAutomationKey(dealId);

  return db.transaction(async (tx) => {
    // S5-12/14: settle the outbox row FIRST, fenced on the still-owned claim. A stale
    // claim (row reclaimed or already settled by a newer claim) matches nothing and
    // writes no deal state, audit or task.
    const owned = await tx
      .update(dealBoardingOutbox)
      .set({ status: "delivered", processedAt: new Date(), lockedAt: null, updatedAt: new Date(), lastError: null })
      .where(and(
        eq(dealBoardingOutbox.id, claim.id),
        eq(dealBoardingOutbox.status, "processing"),
        eq(dealBoardingOutbox.attempts, claim.attempts),
      ))
      .returning({ id: dealBoardingOutbox.id });
    if (owned.length === 0) return false;
    if (setSubmittedFields) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        event: "submitted",
        processor: processorName,
        processorApplicationId,
        estimatedDecisionDate: estimatedDecisionDate ?? null,
      };
      await tx
        .update(deals)
        .set({
          boardingStatus: "submitted",
          processorApplicationId,
          boardingSubmittedAt: new Date(),
          boardingLog: [...existingLog, logEntry],
          ...(processorProgram ? { processorProgram } : {}),
          updatedAt: new Date(),
        } as any)
        .where(eq(deals.id, dealId));
    }

    // Redacted audit — no PII/provider payload, only the processor app id.
    const [existingAudit] = await tx.execute(sql`
      SELECT 1 FROM audit_logs
      WHERE action = 'deal_submitted_to_processor'
        AND entity_type = 'deal'
        AND entity_id = ${dealId}
      LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]);
    if (!existingAudit) {
      await auditChange({
        actorType: "system",
        action: "deal_submitted_to_processor",
        entityType: "deal",
        entityId: dealId,
        details: { processorApplicationId, status: "submitted" },
      }, tx);
    }

    // Idempotent monitoring task keyed by deterministic automationKey.
    const [existingTask] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(
        eq(tasks.automationKey, automationKey),
        eq(tasks.source, BOARDING_MONITOR_SOURCE),
        isNull(tasks.deletedAt),
      ))
      .limit(1);
    if (!existingTask) {
      await tx.insert(tasks).values({
        dealId,
        contactId: contactId ?? undefined,
        title: `Monitor boarding status for Deal #${dealId} — App ${processorApplicationId}`,
        assignedTo: owner || "Scott Stevenson",
        priority: "high",
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        description: `Application ${processorApplicationId} submitted to processor. Check status in 24–48 hours.`,
        source: BOARDING_MONITOR_SOURCE,
        automationKey,
      } as typeof tasks.$inferInsert);
    }
    return true;
  });
}

/**
 * ONE claim-fenced transaction settles an unknown provider outcome: outbox dead_letter
 * (never delivered, never auto-retried) + deal state + audit. A stale claim writes nothing.
 */
async function settleAmbiguous(
  row: BoardingRow,
  dealId: number,
  processorProgram: string | null | undefined,
  note: string,
): Promise<BoardingSettlement> {
  const settled = await db.transaction(async (tx) => {
    const fenced = await tx.update(dealBoardingOutbox)
      .set({ status: "dead_letter", lockedAt: null, lastError: "ambiguous_reconciliation_required",
             availableAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(dealBoardingOutbox.id, row.id),
        eq(dealBoardingOutbox.status, "processing"),
        eq(dealBoardingOutbox.attempts, row.attempts),
      ))
      .returning({ id: dealBoardingOutbox.id });
    if (fenced.length === 0) return false;
    await tx.update(deals)
      .set({
        boardingStatus: "ambiguous_reconciliation_required",
        boardingAmbiguousAt: new Date(),
        ...(processorProgram ? { processorProgram } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(deals.id, dealId));
    await auditChange({
      actorType: "system",
      action: "deal_boarding_ambiguous",
      entityType: "deal",
      entityId: dealId,
      details: { errorClass: "ambiguous_reconciliation_required", attempts: row.attempts, note },
    }, tx);
    return true;
  });
  return settled ? { settlement: "ambiguous_reconciliation_required" } : { settlement: "stale_claim" };
}

async function handleProcessorSubmit(row: BoardingRow): Promise<BoardingSettlement> {
  const dealId = row.dealId;

  const deal = await storage.getDeal(dealId);
  if (!deal) throw new Error(`Deal #${dealId} not found`);

  // If a prior attempt already submitted to the processor (processorApplicationId
  // set), do NOT early-return: an earlier crash may have committed the provider
  // call but not the local audit/task. Reconcile any missing local effects
  // transactionally, then deliver. Idempotent read-guards prevent duplicates.
  if (deal.processorApplicationId) {
    const reconciled = await commitBoardingSuccess({
      dealId,
      contactId: deal.contactId ?? null,
      owner: deal.owner ?? null,
      processorName: resolveProcessor(row.processorName).name,
      processorApplicationId: deal.processorApplicationId,
      estimatedDecisionDate: null,
      existingLog: (deal.boardingLog as any[]) || [],
      // Deal fields already carry submitted state; don't overwrite/re-append log.
      setSubmittedFields: false,
      claim: { id: row.id, attempts: row.attempts },
    });
    return { settlement: reconciled ? "delivered" : "stale_claim" };
  }

  // Immutable version-checked linkage: the enqueue route captured the
  // application's `updatedAt` inside its atomic deal-claim transaction
  // (with FOR UPDATE) and stored it as `applicationLinkageVersion` in the
  // outbox payload.  We verify that the application has not changed since
  // enqueue before decrypting — if it has been re-linked or modified the
  // version will not match and we dead-letter without reading protected data.
  if (!row.applicationId) {
    throw new Error(`No applicationId in boarding outbox row for deal #${dealId}`);
  }
  const applicationLinkageVersion =
    (row.payload as any)?.applicationLinkageVersion as string | undefined;
  if (!applicationLinkageVersion) {
    // Outbox row predates the version field — treat as stale/unsafe and
    // dead-letter without decrypting.
    throw new Error(
      `applicationLinkageVersion missing from outbox payload for deal #${dealId} — refusing to decrypt.`,
    );
  }

  // Fetch only if the version and deal linkage are BOTH still valid.
  // Both the enqueue capture and this comparison use updated_at::text (PostgreSQL
  // canonical text representation) so the byte comparison is always consistent.
  // S5-11: typed Drizzle select (camel-case columns) — a raw `SELECT *` returns
  // snake-case keys that silently lose every multi-word protected/business field.
  const [appRow] = await db
    .select()
    .from(merchantApplications)
    .where(and(
      eq(merchantApplications.id, row.applicationId),
      eq(merchantApplications.dealId, dealId),
      sql`${merchantApplications.updatedAt}::text = ${applicationLinkageVersion}`,
    ))
    .limit(1);
  // Version mismatch or re-linked → dead-letter without decrypting.
  if (!appRow) {
    throw new Error(
      `Cross-deal linkage mismatch or stale version: application #${row.applicationId} has been modified or re-linked since boarding was queued for deal #${dealId}. Refusing to decrypt.`,
    );
  }
  const application: typeof merchantApplications.$inferSelect = appRow;

  // S5-15: the same readiness contract as enqueue, re-evaluated at dispatch before any
  // protected read. Field completeness is validated on the decrypted payload below.
  const readiness = await evaluateBoardingReadiness(dealId, { includeFieldCompleteness: false });
  if (!readiness.ready) {
    await db.transaction(async (tx) => {
      const fenced = await tx.update(dealBoardingOutbox)
        .set({ status: "dead_letter", lockedAt: null, lastError: "BOARDING_NOT_READY",
               availableAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(dealBoardingOutbox.id, row.id),
          eq(dealBoardingOutbox.status, "processing"),
          eq(dealBoardingOutbox.attempts, row.attempts),
        ))
        .returning({ id: dealBoardingOutbox.id });
      if (fenced.length === 0) return;
      await tx.update(deals)
        .set({ boardingStatus: "dead_letter", updatedAt: new Date() })
        .where(eq(deals.id, dealId));
      await auditChange({
        actorType: "system",
        action: "deal_boarding_blocked_not_ready",
        entityType: "deal",
        entityId: dealId,
        details: { errorCode: "BOARDING_NOT_READY", blockers: readiness.blockers.map((b) => b.code) },
      }, tx);
    });
    throw new AlreadyTerminalError("BOARDING_NOT_READY: dead_letter written, no transport");
  }

  const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;

  // Purpose-decrypt protected fields in memory only — never stored in outbox payload.
  // Decryption occurs after the linkage lock is confirmed — never before.
  const protectedFields = decryptProtectedFields(application, {
    role: "system",
    purpose: "boarding_processor_submission",
  });

  // Stable provider idempotency key stored in outbox payload at enqueue time.
  const providerIdempotencyKey =
    (row.payload as any)?.providerIdempotencyKey as string | undefined;

  const payload = {
    dealId,
    // S5-11: identity/legal/address/banking fields come ONLY from the reviewed
    // application — no contact fallback and no fabricated "Unknown Business".
    legalBusinessName: application.legalBusinessName || undefined,
    dba: application.dba || undefined,
    ein: protectedFields.ein || undefined,
    businessType: application?.businessType || undefined,
    businessAddress: application.businessAddress || undefined,
    businessCity: application.businessCity || undefined,
    businessState: application.businessState || undefined,
    businessZip: application?.businessZip || undefined,
    businessPhone: application?.businessPhone || contact?.phone || undefined,
    businessEmail: application?.businessEmail || contact?.email || undefined,
    website: application?.website || contact?.website || undefined,
    vertical: application?.vertical || contact?.vertical || deal.offerPath || undefined,
    ownerFirstName: application.ownerFirstName || undefined,
    ownerLastName: application.ownerLastName || undefined,
    ownerEmail: application.ownerEmail || undefined,
    ownerPhone: application.ownerPhone || undefined,
    ownerDob: protectedFields.ownerDob || undefined,
    ownerSsn: protectedFields.ownerSsn || undefined,
    ownerAddress: application?.ownerAddress || undefined,
    ownerCity: application?.ownerCity || undefined,
    ownerState: application?.ownerState || undefined,
    ownerZip: application?.ownerZip || undefined,
    bankRoutingNumber: protectedFields.bankRoutingNumber || undefined,
    bankAccountNumber: protectedFields.bankAccountNumber || undefined,
    bankAccountType: application?.bankAccountType || undefined,
    estimatedMonthlyVolume: application?.estimatedMonthlyVolume || deal.totalVolume || contact?.monthlyVolume || undefined,
    estimatedAvgTicket: application?.estimatedAvgTicket || deal.avgTicket || contact?.avgTicket || undefined,
    preferredProgram: application?.preferredProgram || deal.recommendedProgram || deal.offerPath || undefined,
    offerPath: deal.offerPath || undefined,
    providerIdempotencyKey,
  };

  // S5-11: validate the complete reviewed payload BEFORE any snapshot read or
  // transport. Names only are recorded — never values.
  const missing = missingProviderFields(payload as Record<string, unknown>);
  if (missing.length > 0) {
    await db.transaction(async (tx) => {
      const fenced = await tx.update(dealBoardingOutbox)
        .set({ status: "dead_letter", lockedAt: null, lastError: "BOARDING_PAYLOAD_INCOMPLETE",
               availableAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(dealBoardingOutbox.id, row.id),
          eq(dealBoardingOutbox.status, "processing"),
          eq(dealBoardingOutbox.attempts, row.attempts),
        ))
        .returning({ id: dealBoardingOutbox.id });
      if (fenced.length === 0) return;
      await tx.update(deals)
        .set({ boardingStatus: "dead_letter", updatedAt: new Date() })
        .where(eq(deals.id, dealId));
      await auditChange({
        actorType: "system",
        action: "deal_boarding_blocked_incomplete_payload",
        entityType: "deal",
        entityId: dealId,
        details: { errorCode: "BOARDING_PAYLOAD_INCOMPLETE", missingFields: missing },
      }, tx);
    });
    throw new AlreadyTerminalError("BOARDING_PAYLOAD_INCOMPLETE: dead_letter written, no transport");
  }

  const processor = resolveProcessor(row.processorName);

  // REV-05A §6: Activation snapshot gate — fail-closed before any provider I/O.
  // No boarding transport without an owner-confirmed activation snapshot.
  //
  // Exception: Mock adapter in non-production environments is explicitly exempt.
  // Mock is a test-only adapter that has no activation snapshot (creating one is
  // rejected by the snapshot management endpoint). Requiring a snapshot from Mock
  // would dead-letter every dev/test boarding, which contradicts the registry's
  // stated non-production sandbox support. Production Mock is already hard-disabled.
  const isMockInNonProd = processor.name === "mock" && process.env.NODE_ENV !== "production";

  // Build a synthetic snapshot for Mock so the rest of the boarding flow proceeds
  // identically without branching on adapter type.
  // "mock://internal.mock.local" is a clearly non-network synthetic URL so
  // adapter transport guards (which require a non-null authorizedBaseUrl) can
  // proceed. Mock never makes real network calls, so the URL is a sentinel only.
  const MOCK_SYNTHETIC_SNAPSHOT = {
    processorProgram: "traditional",
    authorizedBaseUrl: "mock://internal.mock.local",
    supportedOperations: ["board_merchant", "get_merchant_status"],
    status: "sandbox_only",
  };

  let snapshot: Awaited<ReturnType<typeof requireConfirmedActivationSnapshot>>;
  if (isMockInNonProd) {
    snapshot = MOCK_SYNTHETIC_SNAPSHOT;
  } else try {
    snapshot = await requireConfirmedActivationSnapshot(processor.name);
  } catch (err: any) {
    if (err?.code === "ACTIVATION_SNAPSHOT_REQUIRED") {
      // Dead-letter + audit in ONE transaction, only if this claim still owns the row.
      // This is a configuration gap, not a transient error.
      await db.transaction(async (tx) => {
        const fenced = await tx.update(dealBoardingOutbox)
          .set({ status: "dead_letter", lockedAt: null,
                 lastError: "ACTIVATION_SNAPSHOT_REQUIRED",
                 availableAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(dealBoardingOutbox.id, row.id),
            eq(dealBoardingOutbox.status, "processing"),
            eq(dealBoardingOutbox.attempts, row.attempts),
          ))
          .returning({ id: dealBoardingOutbox.id });
        if (fenced.length === 0) return;
        await auditChange({
          actorType: "system",
          action: "deal_boarding_blocked_no_snapshot",
          entityType: "deal",
          entityId: dealId,
          details: {
            errorCode: "ACTIVATION_SNAPSHOT_REQUIRED",
            processorName: processor.name,
            note: "Transport blocked: owner has not confirmed activation snapshot. " +
                  "Create a snapshot via POST /api/admin/processor-activation-snapshots.",
          },
        }, tx);
      });
      // Throw AlreadyTerminalError so tick() skips markDelivered and
      // markRetryOrDeadLetter — the outbox row is already in terminal state.
      throw new AlreadyTerminalError("ACTIVATION_SNAPSHOT_REQUIRED: dead_letter written, skip markDelivered");
    }
    throw err;
  }

  // The confirmed program is committed atomically with the provider outcome
  // (success or ambiguous) below — never as a standalone write before I/O.

  // Pass processorProgram and authorizedBaseUrl from the activation snapshot to
  // boardMerchant so the adapter can route to the correct endpoint and use
  // only the owner-authorized base URL (not the environment-configured default).
  (payload as any).processorProgram = snapshot.processorProgram;
  (payload as any).snapshotAuthorizedBaseUrl = snapshot.authorizedBaseUrl;

  // S5-14: a previous attempt wrote DISPATCH_STARTED and never settled (crash, takeover or
  // lost response). The provider may already hold the application, and Payarc dedupe by
  // header is not certified, so re-sending could create a duplicate. Hold for reconciliation.
  if (row.lastError === DISPATCH_STARTED) {
    return settleAmbiguous(row, dealId, snapshot.processorProgram,
      "An earlier attempt began provider dispatch and never settled — outcome unknown. " +
      "Reconcile via the provider status endpoint before any resubmission.");
  }

  // Final recheck of the application revision immediately before I/O, then write the
  // durable pre-dispatch marker fenced on the still-owned claim. Not owned => no I/O.
  const [recheck] = await db
    .select({ id: merchantApplications.id })
    .from(merchantApplications)
    .where(and(
      eq(merchantApplications.id, row.applicationId),
      eq(merchantApplications.dealId, dealId),
      sql`${merchantApplications.updatedAt}::text = ${applicationLinkageVersion}`,
    ))
    .limit(1);
  if (!recheck) {
    throw new Error("Application changed immediately before dispatch — refusing to send.");
  }
  const marked = await db.update(dealBoardingOutbox)
    .set({ lastError: DISPATCH_STARTED, updatedAt: new Date() })
    .where(and(
      eq(dealBoardingOutbox.id, row.id),
      eq(dealBoardingOutbox.status, "processing"),
      eq(dealBoardingOutbox.attempts, row.attempts),
    ))
    .returning({ id: dealBoardingOutbox.id });
  if (marked.length === 0) return { settlement: "stale_claim" };

  const result = await processor.boardMerchant(payload);

  // REV-05A: Ambiguous result handling.
  // If the provider call timed out or returned no application ID, classify as
  // ambiguous_reconciliation_required. Do NOT retry immediately — the operator
  // must reconcile via provider status poll before retrying.
  if (!result.success && result.ambiguous) {
    return settleAmbiguous(row, dealId, snapshot.processorProgram,
      "Submission result is ambiguous — provider call timed out or returned no application ID. " +
      "Do NOT retry without reconciliation via provider status endpoint.");
  }

  if (!result.success) {
    // Do NOT log result.error (may contain provider payload) — just propagate.
    throw new Error("processor_submit_failed");
  }

  // Post-provider: local deal state + redacted audit + idempotent monitoring
  // task are committed in ONE transaction, so a crash can never leave the
  // deal marked submitted while the audit/task are missing (item 6).
  const committed = await commitBoardingSuccess({
    dealId,
    contactId: deal.contactId ?? null,
    owner: deal.owner ?? null,
    processorName: processor.name,
    processorApplicationId: result.processorApplicationId as string,
    estimatedDecisionDate: result.estimatedDecisionDate ?? null,
    existingLog: (deal.boardingLog as any[]) || [],
    setSubmittedFields: true,
    processorProgram: snapshot.processorProgram,
    claim: { id: row.id, attempts: row.attempts },
  });
  return { settlement: committed ? "delivered" : "stale_claim" };
}

async function tick(): Promise<void> {
  if (running) return;
  // Pool-pressure backpressure: yield if other callers are already waiting
  // for a DB connection. Retried on next scheduled tick (20 s later).
  if (pool.waitingCount > 0) {
    process.stderr.write(`[BoardingOutbox] Pool pressure — ${pool.waitingCount} waiter(s), skipping tick\n`);
    return;
  }
  running = true;
  try {
    await reclaimStale();
    for (let i = 0; i < 5; i++) {
      const row = await claimOne();
      if (!row) break;
      try {
        const outcome = await handleProcessorSubmit(row);
        // "delivered" was already settled inside the same transaction as the local
        // submission effects; a stale claim wrote nothing.
        if (outcome.settlement === "stale_claim") {
          process.stderr.write(`[BoardingOutbox] deal#${row.dealId} result discarded — row no longer owned by this claim\n`);
        }
      } catch (err: any) {
        if (err?.alreadyHandled) {
          // AlreadyTerminalError: handleProcessorSubmit already wrote dead_letter.
          // Skip markDelivered and markRetryOrDeadLetter — DB state is correct.
          process.stderr.write(`[BoardingOutbox] deal#${row.dealId} already terminal: ${scrubError(err)}\n`);
        } else {
          process.stderr.write(`[BoardingOutbox] processor_submit deal#${row.dealId} attempt#${row.attempts} failed (${scrubError(err)})\n`);
          await markRetryOrDeadLetter(row.id, row.dealId, row.attempts, err);
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[BoardingOutbox] Tick error: ${scrubError(err)}\n`);
  } finally {
    running = false;
  }
}

export function startDealBoardingOutboxWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  const initial = setTimeout(() => void tick(), 5000);
  if (typeof initial.unref === "function") initial.unref();
}

export const __test__ = {
  backoffMs, MAX_ATTEMPTS, STALE_LOCK_MS, scrubError,
  tick, claimOne, handleProcessorSubmit, missingProviderFields, REQUIRED_PROVIDER_FIELDS,
  setProcessorOverride(fn: ((name?: string | null) => IProcessorAdapter) | null) { processorOverrideForTest = fn; },
};
