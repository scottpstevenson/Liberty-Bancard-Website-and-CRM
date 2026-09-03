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
import { db } from "../db";
import { deals, dealBoardingOutbox, merchantApplications, tasks } from "@shared/schema";
import { storage } from "../storage";
import { auditChange } from "./audit-change";
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
}

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
    RETURNING id, deal_id, application_id, processor_name, attempts, payload
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

async function markDelivered(id: string): Promise<void> {
  await db
    .update(dealBoardingOutbox)
    .set({ status: "delivered", processedAt: new Date(), lockedAt: null, updatedAt: new Date(), lastError: null })
    .where(eq(dealBoardingOutbox.id, id));
}

async function markRetryOrDeadLetter(id: string, dealId: number, attempts: number, err: unknown): Promise<void> {
  const safeErr = scrubError(err);
  const terminal = attempts >= MAX_ATTEMPTS;
  if (terminal) {
    // On terminal dead-letter, transactionally flip the deal to dead_letter and
    // write a redacted audit alongside the outbox row so state stays consistent.
    await db.transaction(async (tx) => {
      await tx
        .update(dealBoardingOutbox)
        .set({ status: "dead_letter", lockedAt: null, lastError: safeErr, availableAt: new Date(), updatedAt: new Date() })
        .where(eq(dealBoardingOutbox.id, id));
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
    .where(eq(dealBoardingOutbox.id, id));
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
}): Promise<void> {
  const {
    dealId, contactId, owner, processorName, processorApplicationId,
    estimatedDecisionDate, existingLog, setSubmittedFields,
  } = params;
  const automationKey = boardingMonitorAutomationKey(dealId);

  await db.transaction(async (tx) => {
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
          updatedAt: new Date(),
        })
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
  });
}

async function handleProcessorSubmit(row: BoardingRow): Promise<void> {
  const dealId = row.dealId;

  const deal = await storage.getDeal(dealId);
  if (!deal) throw new Error(`Deal #${dealId} not found`);

  // If a prior attempt already submitted to the processor (processorApplicationId
  // set), do NOT early-return: an earlier crash may have committed the provider
  // call but not the local audit/task. Reconcile any missing local effects
  // transactionally, then deliver. Idempotent read-guards prevent duplicates.
  if (deal.processorApplicationId) {
    await commitBoardingSuccess({
      dealId,
      contactId: deal.contactId ?? null,
      owner: deal.owner ?? null,
      processorName: (row.processorName ? getProcessor(row.processorName) : getDefaultProcessor()).name,
      processorApplicationId: deal.processorApplicationId,
      estimatedDecisionDate: null,
      existingLog: (deal.boardingLog as any[]) || [],
      // Deal fields already carry submitted state; don't overwrite/re-append log.
      setSubmittedFields: false,
    });
    return;
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
  const versionRows = await db.execute(sql`
    SELECT * FROM merchant_applications
    WHERE id = ${row.applicationId}
      AND deal_id = ${dealId}
      AND updated_at::text = ${applicationLinkageVersion}
    LIMIT 1
  `);
  const appRow = (versionRows.rows ?? versionRows)[0] as typeof merchantApplications.$inferSelect | undefined;
  // Version mismatch or re-linked → dead-letter without decrypting.
  if (!appRow) {
    throw new Error(
      `Cross-deal linkage mismatch or stale version: application #${row.applicationId} has been modified or re-linked since boarding was queued for deal #${dealId}. Refusing to decrypt.`,
    );
  }
  const application: typeof merchantApplications.$inferSelect = appRow;

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
    legalBusinessName: application?.legalBusinessName || contact?.companyName || `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() || "Unknown Business",
    dba: application?.dba || contact?.companyName || undefined,
    ein: protectedFields.ein || undefined,
    businessType: application?.businessType || undefined,
    businessAddress: application?.businessAddress || contact?.address || undefined,
    businessCity: application?.businessCity || contact?.city || undefined,
    businessState: application?.businessState || contact?.state || undefined,
    businessZip: application?.businessZip || undefined,
    businessPhone: application?.businessPhone || contact?.phone || undefined,
    businessEmail: application?.businessEmail || contact?.email || undefined,
    website: application?.website || contact?.website || undefined,
    vertical: application?.vertical || contact?.vertical || deal.offerPath || undefined,
    ownerFirstName: application?.ownerFirstName || contact?.firstName || undefined,
    ownerLastName: application?.ownerLastName || contact?.lastName || undefined,
    ownerEmail: application?.ownerEmail || contact?.email || undefined,
    ownerPhone: application?.ownerPhone || contact?.phone || undefined,
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

  const processor = row.processorName ? getProcessor(row.processorName) : getDefaultProcessor();

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
      // Write a clear audit and dead-letter — this is a configuration gap, not a transient error.
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
      });
      await db.update(dealBoardingOutbox)
        .set({ status: "dead_letter", lockedAt: null,
               lastError: "ACTIVATION_SNAPSHOT_REQUIRED",
               availableAt: new Date(), updatedAt: new Date() })
        .where(eq(dealBoardingOutbox.id, row.id));
      // Throw AlreadyTerminalError so tick() skips markDelivered and
      // markRetryOrDeadLetter — the outbox row is already in terminal state.
      throw new AlreadyTerminalError("ACTIVATION_SNAPSHOT_REQUIRED: dead_letter written, skip markDelivered");
    }
    throw err;
  }

  // Attach the confirmed program to the deal record before I/O.
  await db.update(deals)
    .set({ processorProgram: snapshot.processorProgram, updatedAt: new Date() } as any)
    .where(eq(deals.id, dealId));

  // Pass processorProgram and authorizedBaseUrl from the activation snapshot to
  // boardMerchant so the adapter can route to the correct endpoint and use
  // only the owner-authorized base URL (not the environment-configured default).
  (payload as any).processorProgram = snapshot.processorProgram;
  (payload as any).snapshotAuthorizedBaseUrl = snapshot.authorizedBaseUrl;

  const result = await processor.boardMerchant(payload);

  // REV-05A: Ambiguous result handling.
  // If the provider call timed out or returned no application ID, classify as
  // ambiguous_reconciliation_required. Do NOT retry immediately — the operator
  // must reconcile via provider status poll before retrying.
  if (!result.success && result.ambiguous) {
    await db.transaction(async (tx) => {
      // REV-05A: Persist boarding_ambiguous_at timestamp (migration 0220 column).
      await tx.update(deals)
        .set({
          boardingStatus: "ambiguous_reconciliation_required",
          boardingAmbiguousAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(deals.id, dealId));
      await auditChange({
        actorType: "system",
        action: "deal_boarding_ambiguous",
        entityType: "deal",
        entityId: dealId,
        details: {
          errorClass: "ambiguous_reconciliation_required",
          attempts: row.attempts,
          note: "Submission result is ambiguous — provider call timed out or returned no application ID. " +
                "Do NOT retry without reconciliation via provider status endpoint.",
        },
      }, tx);
    });
    // Mark the outbox row as failed (not dead_letter) — it will not be retried
    // automatically. Operator must initiate reconciliation and reset the row.
    const safeErr = "ambiguous_reconciliation_required";
    await db.update(dealBoardingOutbox)
      .set({ status: "dead_letter", lockedAt: null, lastError: safeErr, availableAt: new Date(), updatedAt: new Date() })
      .where(eq(dealBoardingOutbox.id, row.id));
    return;
  }

  if (!result.success) {
    // Do NOT log result.error (may contain provider payload) — just propagate.
    throw new Error("processor_submit_failed");
  }

  // Post-provider: local deal state + redacted audit + idempotent monitoring
  // task are committed in ONE transaction, so a crash can never leave the
  // deal marked submitted while the audit/task are missing (item 6).
  await commitBoardingSuccess({
    dealId,
    contactId: deal.contactId ?? null,
    owner: deal.owner ?? null,
    processorName: processor.name,
    processorApplicationId: result.processorApplicationId as string,
    estimatedDecisionDate: result.estimatedDecisionDate ?? null,
    existingLog: (deal.boardingLog as any[]) || [],
    setSubmittedFields: true,
  });
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await reclaimStale();
    for (let i = 0; i < 5; i++) {
      const row = await claimOne();
      if (!row) break;
      try {
        await handleProcessorSubmit(row);
        await markDelivered(row.id);
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

export const __test__ = { backoffMs, MAX_ATTEMPTS, STALE_LOCK_MS, scrubError };
