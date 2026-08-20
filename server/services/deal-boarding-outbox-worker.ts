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
import { getProcessor, getDefaultProcessor } from "./processors/registry";

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
  const result = await processor.boardMerchant(payload);

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
      } catch (err) {
        process.stderr.write(`[BoardingOutbox] processor_submit deal#${row.dealId} attempt#${row.attempts} failed (${scrubError(err)})\n`);
        await markRetryOrDeadLetter(row.id, row.dealId, row.attempts, err);
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
