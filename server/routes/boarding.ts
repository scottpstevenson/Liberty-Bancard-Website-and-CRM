import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import {readBoardingDealPopulation} from "../storage/deals";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { merchantApplications, dealBoardingOutbox, deals } from "@shared/schema";
import { getProcessor, getDefaultProcessor, getEnabledAdapterNames, ingestMidDataForActiveMids } from "../services/processors/registry";
import { serverError, safeMessage } from "../utils/server-error";
import { startDealBoardingOutboxWorker } from "../services/deal-boarding-outbox-worker";
import { isLocalOutboxWorkerSelected } from "../services/background-profile";
import { auditChange } from "../services/audit-change";
import { advanceDealStage, advanceDealStageInTx, advanceDealStageAfterCommit } from "../services/deal-stage-service";
import { evaluateBoardingReadiness } from "../services/boarding-readiness";
import { canAccessOwner } from "../services/crm-object-access";
import crypto from "crypto";


const IN_FLIGHT_BOARDING_STATUSES = ["submitted", "under_review", "more_info_needed"];

interface BoardingRefreshResult {
  dealId: number;
  outcome: "success" | "failed" | "skipped";
  status?: string;
  mid?: string;
  midMasked?: string;
  message?: string;
  moreInfoRequest?: string;
  declineReason?: string;
  error?: string;
  alertCreated?: boolean;
  existingAlert?: boolean;
}

async function recordBoardingFailureAndAlert(
  deal: any,
  dealId: number,
  errorMessage: string
): Promise<{ alertCreated: boolean; existingAlert: boolean }> {
  const existingLog = (deal.boardingLog as any[]) || [];

  const lastStatusCheck = [...existingLog].reverse().find((e: any) => e.event === "status_check");
  const isConsecutiveFailure = lastStatusCheck?.outcome === "failed";

  // REV-05A: Redact provider-derived error text before persisting into boardingLog.
  const { redactProviderText: _redactErrText, sanitizeBoardingLog: _sanitizeFailLog } = await import("../utils/mask-mid");
  const failureEntry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    event: "status_check",
    outcome: "failed",
    error: _redactErrText(errorMessage),
  };

  await storage.updateDeal(dealId, {
    boardingLog: _sanitizeFailLog([...existingLog, failureEntry]),
  });

  if (!isConsecutiveFailure) {
    return { alertCreated: false, existingAlert: false };
  }

  const existingTasks = await storage.getTasks();
  const hasPersistentAlert = existingTasks.some(
    (t: any) =>
      t.dealId === dealId &&
      t.title?.includes("Persistent Boarding Failure") &&
      t.status === "pending"
  );

  if (hasPersistentAlert) {
    return { alertCreated: false, existingAlert: true };
  }

  await storage.createAuthorityTask({
    dealId,
    contactId: deal.contactId || undefined,
    title: `Persistent Boarding Failure — Deal #${dealId}`,
    assignedTo: deal.owner || "Scott Stevenson",
    priority: "high",
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    description: `Boarding status refresh has failed on consecutive attempts. Latest error: ${(await import("../utils/mask-mid")).redactProviderText(errorMessage)}`,
  });

  await storage.createNotification({
    channel: "internal",
    title: "Persistent Boarding Failure",
    message: `Deal #${dealId} has failed consecutive boarding status refreshes. Error: ${(await import("../utils/mask-mid")).redactProviderText(errorMessage)}`,
    type: "urgent",
    metadata: { dealId, eventType: "boarding_persistent_failure" },
  });

  return { alertCreated: true, existingAlert: false };
}

let statusProcessorOverrideForTest: ((name: string) => any) | null = null;
export const __boardingTest__ = {
  setStatusProcessorOverride(fn: ((name: string) => any) | null) {
    if (process.env.NODE_ENV !== "test") throw new Error("test seam only");
    statusProcessorOverrideForTest = fn;
  },
};
function resolveStatusProcessor(name: string) {
  if (statusProcessorOverrideForTest && process.env.NODE_ENV === "test") return statusProcessorOverrideForTest(name);
  return getProcessor(name);
}

export async function performBoardingStatusRefresh(dealId: number): Promise<BoardingRefreshResult> {
  let deal: Awaited<ReturnType<typeof storage.getDeal>> | undefined = undefined;
  try {
    deal = await storage.getDeal(dealId);
    if (!deal) return { dealId, outcome: "skipped", error: "Deal not found" };
    if (!deal.processorApplicationId) {
      return { dealId, outcome: "skipped", error: "No processor application ID on this deal. Submit first." };
    }

    const dealLog = (deal.boardingLog as any[]) || [];
    const submittedEntry = [...dealLog].reverse().find((e: any) => e.event === "submitted");
    const dealProcessorName = submittedEntry?.processor || undefined;
    // S5-18: the adapter identity comes from the recorded submission. It is never inferred
    // or defaulted — polling the wrong provider could apply a foreign application's status.
    if (!dealProcessorName) {
      return { dealId, outcome: "skipped", error: "No processor recorded for this deal's submission; refusing to infer one." };
    }
    const processor = resolveStatusProcessor(dealProcessorName);

    // REV-05A: Status polling is provider I/O that can mutate deal state (approved, MID).
    // It must be gated by the activation snapshot — including latest-only check,
    // entitlement, supportedOperations, and authorizedBaseUrl — before any poll.
    //
    // Exception: Mock adapter in non-production is exempt from the snapshot gate
    // (same reason as the outbox worker — Mock never has a snapshot, and rejecting
    // it here would make dev/test status polls always skip).
    const { requireConfirmedActivationSnapshot } = await import("../services/processors/registry");
    const processorNameForGate = dealProcessorName;
    const isMockNonProd = processorNameForGate === "mock" && process.env.NODE_ENV !== "production";
    // For Mock in non-production, supply the same synthetic URL used by the outbox worker.
    // Mock never makes real network calls, so the URL is a sentinel only — but all
    // adapter transport methods require a non-null snapshotAuthorizedBaseUrl.
    let statusPollingBaseUrl: string | null = isMockNonProd ? "mock://internal.mock.local" : null;
    let statusSnapshotProgram: string | null = isMockNonProd ? "traditional" : null;
    if (!isMockNonProd) {
      try {
        // REV-05A: Status polling requires the "get_merchant_status" operation to
        // be listed in supportedOperations — not "board_merchant". A snapshot that
        // only authorizes boarding does not implicitly authorize provider polling.
        const snapshot = await requireConfirmedActivationSnapshot(processorNameForGate, "get_merchant_status");
        statusPollingBaseUrl = snapshot.authorizedBaseUrl;
        statusSnapshotProgram = snapshot.processorProgram ?? null;
      } catch (snapErr: any) {
        // Fail closed — if no valid snapshot, skip the poll (do not mutate state).
        return {
          dealId,
          outcome: "skipped",
          error: `[REV-05A] Status poll blocked — no valid activation snapshot for '${processorNameForGate}': ${snapErr?.message ?? "unknown"}`,
        };
      }
    }

    // Pass snapshotAuthorizedBaseUrl so the adapter uses the owner-authorized URL.
    const merchantStatusOptions = statusPollingBaseUrl
      ? { snapshotAuthorizedBaseUrl: statusPollingBaseUrl }
      : {};
    // R04: the fence covers the FULL case tuple the observation was read against — deal identity/stage/class and
    // the bound application's revision — not just the status and log length.
    const readCaseTuple = async (q: { execute: (x: any) => Promise<any> }, lock: boolean) => {
      const r = await q.execute(sql`
        SELECT d.processor_application_id, d.boarding_status, d.boarding_log, d.pipeline, d.stage, d.contact_id,
               d.sales_deal_id, d.archived_at IS NOT NULL AS archived, COALESCE(d.record_class,'unknown') AS record_class,
               (SELECT a.id::text || ':' || a.updated_at::text FROM merchant_applications a WHERE a.deal_id = d.id ORDER BY a.id LIMIT 1) AS application_rev
        FROM deals d WHERE d.id = ${dealId} ${lock ? sql.raw("FOR UPDATE OF d") : sql.raw("")}`);
      return ((r as any).rows ?? r)[0] as any;
    };
    const observedRow = await readCaseTuple(db as any, false);
    const caseKey = (c: any) => JSON.stringify([c?.pipeline, c?.stage, c?.contact_id, c?.sales_deal_id, c?.archived, c?.record_class, c?.application_rev]);
    const observedCaseKey = caseKey(observedRow);
    const result = await processor.getMerchantStatus(deal.processorApplicationId, merchantStatusOptions as any);

    if (!result.success) {
      const alertInfo = await recordBoardingFailureAndAlert(
        deal,
        dealId,
        result.error || "Failed to check boarding status"
      );
      return {
        dealId,
        outcome: "failed",
        error: result.error || "Failed to check boarding status",
        ...alertInfo,
      };
    }

    const logEntry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      event: "status_check",
      status: result.status,
      message: result.message,
      // R05: which adapter, program and operation produced this observation, and whether the provider named the application.
      adapter: processor.name,
      program: statusSnapshotProgram,
      operation: "get_merchant_status",
      identityEchoed: result.identityEchoed ?? null,
    };

    if (result.moreInfoRequest) logEntry.moreInfoRequest = result.moreInfoRequest;
    if (result.declineReason) logEntry.declineReason = result.declineReason;
    // REV-05A: Never write raw MID into boardingLog; use masked value only.
    if (result.mid) {
      const { maskMid: _maskMidLog } = await import("../utils/mask-mid");
      logEntry.midMasked = _maskMidLog(result.mid);
    }

    const existingLog = (deal.boardingLog as any[]) || [];
    const { sanitizeBoardingLog: _sanitizeForPersist, maskMid: _maskMidApply, redactProviderText: _redactApply } =
      await import("../utils/mask-mid");
    const nextLog = _sanitizeForPersist([...existingLog, logEntry]);
    const observed = {
      processorApplicationId: deal.processorApplicationId,
      boardingStatus: deal.boardingStatus ?? null,
      logLength: existingLog.length,
    };
    const TERMINAL_BOARDING = new Set(["approved", "declined"]);

    // S5-18: ONE versioned transaction applies the observation — canonical MID, deal status,
    // log and audit commit together or not at all. The deal row is locked and compared with
    // the version this observation was read against; an older or foreign observation is
    // ignored, and recorded terminal truth is never replaced by a different status.
    let stageOutcome: Awaited<ReturnType<typeof advanceDealStageInTx>> | null = null;
    const applied = await db.transaction(async (tx) => {
      const cur = await readCaseTuple(tx as any, true);
      if (!cur) return { kind: "stale" as const };
      if (caseKey(cur) !== observedCaseKey) return { kind: "stale" as const };
      const curLogLen = Array.isArray(cur.boarding_log) ? cur.boarding_log.length : 0;
      if (
        cur.processor_application_id !== observed.processorApplicationId ||
        (cur.boarding_status ?? null) !== observed.boardingStatus ||
        curLogLen !== observed.logLength
      ) return { kind: "stale" as const };
      if (cur.boarding_status && TERMINAL_BOARDING.has(cur.boarding_status) && cur.boarding_status !== result.status) {
        return { kind: "terminal" as const, current: cur.boarding_status as string };
      }
      if (result.status === "approved" && result.mid) {
        const { assignMerchantMidToCanonical } = await import("../services/merchant-mid-service");
        await assignMerchantMidToCanonical({
          dealId,
          contactId: deal!.contactId ?? null,
          mid: result.mid,
          processorName: dealProcessorName,
          actorId: null,
          actorEmail: "system:boarding_status_refresh",
          tx,
        });
      }
      await tx.update(deals)
        .set({
          boardingStatus: result.status,
          boardingLog: nextLog,
          ...(result.status === "approved" && result.mid ? { boardingApprovedAt: new Date() } : {}),
          updatedAt: new Date(),
        } as any)
        .where(eq(deals.id, dealId));
      // R04: the stage/handoff intent commits WITH the observation (durable intent ledger rows are written by the
      // canonical stage service inside this transaction); post-commit telemetry runs only after commit.
      if (result.status === "approved" && deal!.pipeline === "onboarding") {
        stageOutcome = await advanceDealStageInTx(tx, dealId, "Approved", "boarding_status_refresh", {
          reason: "Processor boarding status approved", actor: "system", expectedStage: deal!.stage,
        });
      }
      await auditChange({
        actorType: "system",
        action: "boarding_status_refreshed",
        entityType: "deal",
        entityId: dealId,
        // REV-05A: raw MID omitted from audit — midMasked only.
        details: {
          status: result.status,
          processor: dealProcessorName,
          midMasked: result.mid ? _maskMidApply(result.mid) : undefined,
          message: _redactApply(result.message),
        },
      }, tx);
      return { kind: "applied" as const };
    });
    if (applied.kind === "stale") {
      return { dealId, outcome: "skipped", error: "Status observation is stale (the deal changed after it was read); not applied." };
    }
    if (applied.kind === "terminal") {
      return { dealId, outcome: "skipped", error: `Provider status '${result.status}' conflicts with recorded terminal status '${applied.current}'; not applied.` };
    }

    const committedStage = stageOutcome as Awaited<ReturnType<typeof advanceDealStageInTx>> | null;
    if (committedStage && committedStage.applied && committedStage.stagedDeal) {
      await advanceDealStageAfterCommit(committedStage.stagedDeal, dealId, "Approved", "boarding_status_refresh");
    }

    // When the processor approves the deal, fire the merchant portal invitation
    // so the merchant gets their access link. The canonical stage service owns
    // the durable intent; this remains a best-effort duplicate-safe nudge.
    if (result.status === "approved" && deal.pipeline === "onboarding") {
      import("../services/merchant-portal-invite").then(({ sendMerchantPortalInvite }) =>
        sendMerchantPortalInvite(dealId).then((inviteResult) => {
          if (!inviteResult.sent) {
            console.log(
              `[Boarding] Portal invite skipped for deal ${dealId} (reason: ${inviteResult.reason})`,
            );
          }
        })
      ).catch((err: Error) =>
        console.error(`[Boarding] Portal invite error for deal ${dealId}:`, err.message),
      );
    }

    if (result.status === "more_info_needed" && result.moreInfoRequest) {
      const existingTasks = await storage.getTasks();
      const hasInfoTask = existingTasks.some(
        (t: any) => t.dealId === dealId && t.title?.includes("More Info Required") && t.status === "pending"
      );
      if (!hasInfoTask) {
        // REV-05A: Redact provider-derived text before persisting in task/notification.
        const { redactProviderText: _redactMoreInfo } = await import("../utils/mask-mid");
        const safeMoreInfo = _redactMoreInfo(result.moreInfoRequest) ?? "(no details provided)";
        await storage.createAuthorityTask({
          dealId,
          contactId: deal.contactId || undefined,
          title: `More Info Required — Processor for Deal #${dealId}`,
          assignedTo: deal.owner || "Scott Stevenson",
          priority: "high",
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          description: `Processor request: ${safeMoreInfo}`,
        });

        await storage.createNotification({
          channel: "internal",
          title: "Processor Needs More Info",
          message: `Deal #${dealId} — ${safeMoreInfo}`,
          type: "urgent",
          metadata: { dealId, eventType: "boarding_more_info" },
        });
      }
    }

    // REV-05A: Return masked MID from status refresh result (not raw value).
    const { maskMid: _maskMidRefreshResult } = await import("../utils/mask-mid");
    const maskedMid = result.mid ? _maskMidRefreshResult(result.mid) : undefined;
    const { redactProviderText: _redactMsg } = await import("../utils/mask-mid");
    return {
      dealId,
      outcome: "success",
      status: result.status,
      midMasked: maskedMid ?? undefined,
      message: _redactMsg(result.message) ?? undefined,
      moreInfoRequest: _redactMsg(result.moreInfoRequest) ?? undefined,
      declineReason: _redactMsg(result.declineReason) ?? undefined,
    };
  } catch (err: any) {
    if (deal != null) {
      try {
        const alertInfo = await recordBoardingFailureAndAlert(deal, dealId, err.message || "Unknown error");
        return { dealId, outcome: "failed", error: err.message || "Unknown error", ...alertInfo };
      } catch {
        // ignore secondary failure — return bare failed result
      }
    }
    return { dealId, outcome: "failed", error: err.message || "Unknown error" };
  }
}

async function runWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export function registerBoardingRoutes(app: Express) {
  // CRO-02 observation moved to the CRO02_OBSERVATION BullMQ job — not on HTTP requests.
  // Start the durable boarding outbox worker only when background workers are enabled.
  // Off mode = HTTP/API only, no background processing.
  if (isLocalOutboxWorkerSelected()) {
    startDealBoardingOutboxWorker();
  } else {
    console.log("[BackgroundProfile] not selected — DealBoardingOutboxWorker not started");
  }

  app.get("/api/deals/:id/boarding-readiness", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal id" });
      const readiness = await evaluateBoardingReadiness(dealId);
      if (readiness.blockers.some((b) => b.code === "deal_not_found")) return res.status(404).json({ message: "Deal not found" });
      res.json(readiness);
    } catch (error) {
      serverError(res, error, "Failed to evaluate boarding readiness");
    }
  });

  // R01-3: explicit, audited Sales→Onboarding application bridge (exact salesDealId relationship only).
  app.post("/api/deals/:id/bridge-application", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal id" });
      const { bridgeApplicationToOnboarding } = await import("../services/boarding-case");
      const result = await bridgeApplicationToOnboarding(dealId, String((req.user as any)?.id ?? "") || null);
      if (!result.bridged) {
        const status = result.reason === "already_direct" ? 200 : 409;
        return res.status(status).json({ bridged: false, reason: result.reason });
      }
      res.json(result);
    } catch (error) {
      serverError(res, error, "Failed to bridge application");
    }
  });

  // Read-only saved receipt for a previously used Idempotency-Key. It evaluates no readiness and changes nothing, so
  // it is safe after the application, decision or policy has moved on.
  app.get("/api/deals/:id/boarding-receipt", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal id" });
      const key = String(req.query?.key ?? "").trim();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return res.status(400).json({ message: "A saved command key is required" });
      const actorId = String((req.user as any)?.id ?? "");
      const [row] = await db.select({
        id: dealBoardingOutbox.id, status: dealBoardingOutbox.status, dealId: dealBoardingOutbox.dealId,
        applicationId: dealBoardingOutbox.applicationId, processorName: dealBoardingOutbox.processorName,
        payload: dealBoardingOutbox.payload, lastError: dealBoardingOutbox.lastError,
      }).from(dealBoardingOutbox).where(eq(dealBoardingOutbox.idempotencyKey, key)).limit(1);
      const bound = ((row?.payload as any)?.command ?? {}) as Record<string, unknown>;
      // Not found and not-yours look identical: nothing about another command is disclosed.
      if (!row || row.dealId !== dealId || (bound.actorId ?? null) !== actorId) return res.json({ found: false });
      const [freshDeal] = await db.select({ b: deals.boardingStatus }).from(deals).where(eq(deals.id, dealId)).limit(1);
      res.json({
        found: true,
        status: row.status,
        outboxId: row.id,
        applicationId: row.applicationId,
        processorName: row.processorName ?? null,
        boardingStatus: freshDeal?.b ?? null,
        savedApplicationRevision: typeof bound.applicationRevision === "string" ? bound.applicationRevision : null,
        reconciliationRequired: row.lastError === "ambiguous_reconciliation_required",
      });
    } catch (error) {
      serverError(res, error, "Failed to read the saved boarding result");
    }
  });

  app.post("/api/deals/:id/submit-to-processor", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);

      // Idempotency-Key required for durable submission (item 8).
      const idempotencyKey = (req.headers["idempotency-key"] as string) || "";
      if (!idempotencyKey) {
        return res.status(400).json({ message: "Idempotency-Key header required" });
      }

      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      // Idempotent replay (S5-13), resolved from the STORED command before any current readiness is evaluated: a
      // saved command reports what it became even if the application, decision or policy has since moved on.
      // The key is globally unique, so a replay is honoured only for the same command (deal, actor, action,
      // explicitly requested processor and, when the caller states one, the reviewed application revision).
      // A key bound to a different command is a conflict, never a silent "already queued".
      const actorId = String((req.user as any)?.id ?? "");
      const expectedApplicationRevision = typeof req.body?.expectedApplicationRevision === "string" ? req.body.expectedApplicationRevision : null;
      const requestedProcessor = (req.body?.processorName as string | undefined) || null;
      const [existing] = await db
        .select({
          id: dealBoardingOutbox.id,
          status: dealBoardingOutbox.status,
          dealId: dealBoardingOutbox.dealId,
          applicationId: dealBoardingOutbox.applicationId,
          processorName: dealBoardingOutbox.processorName,
          payload: dealBoardingOutbox.payload,
        })
        .from(dealBoardingOutbox)
        .where(eq(dealBoardingOutbox.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        const bound = ((existing.payload as any)?.command ?? {}) as Record<string, unknown>;
        const sameCommand =
          existing.dealId === dealId &&
          (bound.actorId ?? null) === actorId &&
          (bound.action ?? null) === "processor_submit" &&
          (requestedProcessor == null || (existing.processorName ?? null) === requestedProcessor) &&
          (expectedApplicationRevision == null || bound.applicationRevision === expectedApplicationRevision);
        if (!sameCommand) {
          return res.status(409).json({
            message: "Idempotency-Key is already bound to a different boarding command. Use a new key for a different deal, application or processor.",
          });
        }
        // R04: a replay returns the ACTUAL saved outcome and a receipt, never a blanket "queued".
        const [freshDeal] = await db.select({ b: deals.boardingStatus }).from(deals).where(eq(deals.id, dealId)).limit(1);
        const replayHttp = existing.status === "pending" || existing.status === "processing" || existing.status === "failed" ? 202 : 200;
        return res.status(replayHttp).json({
          status: existing.status,
          replayed: true,
          message: "This command was already accepted; reporting its saved outcome",
          outboxId: existing.id,
          receipt: { outboxId: existing.id, dealId, applicationId: existing.applicationId, processorName: existing.processorName ?? null, boardingStatus: freshDeal?.b ?? null },
        });
      }

      // S5-15: one shared readiness contract (same evaluation the readiness route and the
      // dispatch use). Replaces the loose "stage text contains underwriting/approved" check.
      const readiness = await evaluateBoardingReadiness(dealId);
      if (!readiness.ready) {
        const noApp = readiness.blockers.some((b) => b.code === "no_linked_application");
        return res.status(noApp ? 409 : 400).json({
          message: noApp
            ? "No merchant application linked to this deal. Complete application before boarding."
            : `Deal is not ready to submit to the processor: ${readiness.blockers.map((b) => b.code).join(", ")}.`,
          blockers: readiness.blockers,
          policyGates: readiness.policyGates,
        });
      }

      // The application must be bound DIRECTLY to this deal (merchant_applications.deal_id = deal). The
      // readiness evaluator already refused every other relationship (a sales-deal source reports
      // application_on_sales_deal and must be bridged explicitly); there is no contact fallback.
      const applicationId = readiness.facts.applicationId;
      if (!applicationId || readiness.facts.applicationBinding !== "direct") {
        return res.status(409).json({ message: "No merchant application linked to this deal. Complete application before boarding." });
      }

      // R04: pin the adapter selection at enqueue. A null request name resolves to the default adapter NOW,
      // so a later default change cannot redirect an already-accepted command.
      let pinnedDefaultProcessor: string | undefined;
      if (!(req.body.processorName as string | undefined)) {
        try { pinnedDefaultProcessor = getDefaultProcessor().name; } catch { pinnedDefaultProcessor = undefined; }
      }
      const processorName = (req.body.processorName as string | undefined) || pinnedDefaultProcessor || undefined;
      const [appProgramRow] = await db.select({ p: merchantApplications.preferredProgram })
        .from(merchantApplications).where(eq(merchantApplications.id, applicationId)).limit(1);
      const programForCommand = appProgramRow?.p ?? null;

      // Stable provider-level idempotency key derived from dealId + request key.
      // Stored in the outbox payload so the worker passes it to the adapter on
      // every retry, enabling provider-side deduplication without storing plaintext.
      const providerIdempotencyKey = crypto
        .createHash("sha256")
        .update(`deal:${dealId}:${idempotencyKey}`)
        .digest("hex")
        .slice(0, 48);

      // Atomic claim — ordering matters:
      //  1. Lock the application first (FOR UPDATE). If it is gone/re-linked,
      //     throw so the whole transaction rolls back cleanly.
      //  2. Conditionally update the deal to "queued" (eligible states only).
      //     If another concurrent request already advanced the deal, exit cleanly.
      //  3. Insert the outbox row with an immutable linkage version derived from
      //     the locked application's updated_at TEXT (PostgreSQL canonical format,
      //     not JS ISO-8601) so the worker's SQL comparison uses the same bytes.
      //  4. Set claimed = true only after the outbox insert succeeds.
      let claimed = false;
      let queuedOutboxId: string | null = null;
      await db.transaction(async (tx) => {
        // Step 1 — Lock the linked application row. Use updated_at::text so the
        // exact PostgreSQL text representation is captured here; the worker will
        // compare with the same cast. Throw on missing/re-linked to roll back.
        const lockedApp = await tx.execute(sql`
          SELECT id, updated_at::text AS updated_at_text
          FROM merchant_applications
          WHERE id = ${applicationId} AND deal_id = ${dealId}
          LIMIT 1
          FOR UPDATE
        `);
        const lockedRow = (lockedApp.rows ?? lockedApp)[0] as
          | { updated_at_text?: string | null }
          | undefined;
        if (!lockedRow || !lockedRow.updated_at_text) {
          // Application was re-linked between the pre-check and this TX — roll back.
          throw new Error("boarding_application_relinked");
        }
        // Immutable linkage version in PostgreSQL text format — both sides use
        // `::text` cast so the string comparison is always byte-for-byte equal.
        const applicationLinkageVersion = lockedRow.updated_at_text;
        if (expectedApplicationRevision != null && expectedApplicationRevision !== applicationLinkageVersion) {
          throw new Error("boarding_application_revision_conflict");
        }
        // R03: re-evaluate under the application lock; the case tuple that was checked is the one stored.
        const lockedReadiness = await evaluateBoardingReadiness(dealId, {}, tx);
        if (!lockedReadiness.ready || lockedReadiness.caseVersion !== readiness.caseVersion) {
          throw new Error("boarding_case_changed");
        }

        // Step 2 — Conditionally advance the deal to "queued". The WHERE guard
        // prevents two concurrent requests from both claiming the same deal.
        const updated = await tx.execute(sql`
          UPDATE deals
          SET boarding_status = 'queued',
              boarding_idempotency_key = ${idempotencyKey},
              updated_at = NOW()
          WHERE id = ${dealId}
            AND (boarding_status IS NULL
                 OR boarding_status IN ('not_submitted', 'declined', 'dead_letter'))
          RETURNING id
        `);
        if (!updated.rows || updated.rows.length === 0) {
          // Another concurrent request already claimed this deal — abort silently.
          return;
        }

        // Step 3 — Insert outbox row with the immutable linkage version.
        const inserted = await tx
          .insert(dealBoardingOutbox)
          .values({
            dealId,
            applicationId,
            eventType: "processor_submit",
            processorName: processorName ?? null,
            idempotencyKey,
            // providerIdempotencyKey and applicationLinkageVersion stored in
            // payload — never exposed in logs/responses.
            payload: {
              dealId, applicationId, providerIdempotencyKey, applicationLinkageVersion,
              readinessCaseVersion: readiness.caseVersion,
              command: { actorId, action: "processor_submit", dealId, applicationId, applicationRevision: applicationLinkageVersion, processorName: processorName ?? null, program: programForCommand },
            },
            status: "pending",
          })
          .onConflictDoNothing({ target: dealBoardingOutbox.idempotencyKey })
          .returning({ id: dealBoardingOutbox.id });
        if (inserted.length === 0) {
          // A concurrent request with the same key won the insert. Roll back the
          // deal claim made above instead of reporting this request as queued.
          throw new Error("boarding_idempotency_conflict");
        }

        // Step 4 — Audit within the same TX (atomically linked to the outbox row).
        // Never store the raw Idempotency-Key — persist only a short hash prefix.
        const idempotencyKeyHashPrefix = crypto
          .createHash("sha256")
          .update(idempotencyKey)
          .digest("hex")
          .slice(0, 12);
        await auditChange({
          actorType: "user",
          action: "deal_boarding_queued",
          entityType: "deal",
          entityId: dealId,
          details: { applicationId, processorName: processorName ?? "default", idempotencyKeyHashPrefix },
        }, tx);

        // claimed is set last — only after the outbox insert succeeds.
        queuedOutboxId = String(inserted[0].id);
        claimed = true;
      });

      if (!claimed) {
        // Either another concurrent request already advanced the deal, or the
        // application was re-linked between pre-check and transaction (which
        // throws "boarding_application_relinked" — caught above and surfaced here).
        const fresh = await storage.getDeal(dealId);
        return res.status(409).json({
          message: `Deal is already in boarding status: ${fresh?.boardingStatus ?? "unknown"}. Use a new idempotency key only if resubmitting after a decline.`,
        });
      }

      return res.status(202).json({
        status: "queued",
        replayed: false,
        message: "Processor submission queued for durable processing",
        outboxId: queuedOutboxId,
        receipt: { outboxId: queuedOutboxId, dealId, applicationId, processorName: processorName ?? null, boardingStatus: "queued" },
      });
    } catch (err: any) {
      // A re-linked application detected inside the TX throws "boarding_application_relinked".
      // Treat it as a 409 conflict, not a 500.
      if (err?.message === "boarding_idempotency_conflict") {
        return res.status(409).json({ message: "A boarding submission with this Idempotency-Key is already in progress. Re-send the same request to read its status." });
      }
      if (err?.message === "boarding_case_changed") {
        return res.status(409).json({ message: "The case changed while submitting (application, decision or policy). Review readiness and retry." });
      }
      if (err?.message === "boarding_application_revision_conflict") {
        return res.status(409).json({ message: "The application changed since you reviewed it. Reload and review again." });
      }
      if (err?.message === "boarding_application_relinked") {
        return res.status(409).json({ message: "The merchant application linked to this deal changed during submission. Please retry." });
      }
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/refresh-boarding-status", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const result = await performBoardingStatusRefresh(dealId);

      if (result.outcome === "skipped") {
        const status = result.error === "Deal not found" ? 404 : 400;
        return res.status(status).json({ message: result.error });
      }
      if (result.outcome === "failed") {
        console.error("[Boarding] Status refresh failed:", result.error);
        return res.status(500).json({ message: safeMessage(result.error, "Failed to check boarding status") });
      }

      // REV-05A: Raw MID omitted from general status refresh response.
      // Full MID is only returned from dedicated purpose-bound endpoints with access receipts.
      const { midMasked: _mid, ...refreshResult } = result;
      res.json({
        success: true,
        ...refreshResult,
        midMasked: (result as any).midMasked,
      });
    } catch (err: any) {
      console.error("[Boarding] Status refresh error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/boarding/refresh-all", isDashboardUser, async (req, res) => {
    try {
      // S5-19: bulk refresh is scoped per deal. Body ids are validated, de-duplicated,
      // bounded and each one must pass the same owner authorization as the
      // per-deal route; the unscoped selection is a bounded SQL read of the
      // caller's in-flight, non-archived deals — never a 10,000-row global load.
      const BULK_REFRESH_MAX = 200;
      const user = req.user as { role?: string; email?: string | null } | undefined;
      let targetDealIds: number[];
      let unauthorizedOrMissing = 0;
      if (req.body?.dealIds !== undefined) {
        if (!Array.isArray(req.body.dealIds)) {
          return res.status(400).json({ message: "dealIds must be an array of positive integers" });
        }
        const ids = req.body.dealIds as unknown[];
        if (ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) {
          return res.status(400).json({ message: "dealIds must contain only positive integers" });
        }
        const unique = Array.from(new Set(ids as number[]));
        if (unique.length > BULK_REFRESH_MAX) {
          return res.status(400).json({ message: `At most ${BULK_REFRESH_MAX} deals can be refreshed per request` });
        }
        targetDealIds = [];
        for (const id of unique) {
          const d = await storage.getDeal(id);
          if (!d || d.archivedAt || !canAccessOwner(user, d.owner, false)) { unauthorizedOrMissing++; continue; }
          targetDealIds.push(id);
        }
      } else {
        const privileged = user?.role === "admin" || user?.role === "manager";
        if (!privileged && !user?.email) return res.status(403).json({ message: "Forbidden" });
        const rows = await db.execute(sql`
          SELECT id FROM deals
          WHERE boarding_status IN (${sql.join(IN_FLIGHT_BOARDING_STATUSES.map((v) => sql`${v}`), sql`, `)})
            AND archived_at IS NULL
            ${privileged ? sql`` : sql`AND owner = ${user!.email}`}
          ORDER BY id
          LIMIT ${BULK_REFRESH_MAX}
        `);
        targetDealIds = (((rows as any).rows ?? rows) as Array<{ id: number }>).map((r) => Number(r.id));
      }

      if (targetDealIds.length === 0) {
        return res.json({
          resultState: "no_op_with_reason",
          reason: "No in-flight boarding deals to refresh.",
          attempted: 0,
          succeeded: 0,
          failed: 0,
          skipped: unauthorizedOrMissing,
          results: [],
        });
      }

      const CONCURRENCY = 4;
      const results = await runWithConcurrencyLimit(targetDealIds, CONCURRENCY, performBoardingStatusRefresh);

      const succeeded = results.filter((r) => r.outcome === "success").length;
      const failed = results.filter((r) => r.outcome === "failed").length;
      const skipped = results.filter((r) => r.outcome === "skipped").length + unauthorizedOrMissing;

      let resultState: "success" | "partial_success" | "failed" | "no_op_with_reason";
      if (succeeded === results.length) {
        resultState = "success";
      } else if (succeeded > 0) {
        resultState = "partial_success";
      } else {
        resultState = "failed";
      }

      await storage.createAuditLog({
        action: "boarding_bulk_refresh",
        entityType: "deal",
        details: { attempted: results.length, succeeded, failed, skipped },
      });

      res.json({ resultState, attempted: results.length, succeeded, failed, skipped, results });
    } catch (err: any) {
      console.error("[Boarding] Bulk refresh error:", err.message);
      serverError(res, err);
    }
  });

  app.get("/api/deals/:id/boarding-status", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const { maskMid, sanitizeBoardingLog } = await import("../utils/mask-mid");
      // REV-05A: Full MID omitted; sanitize ALL boardingLog entries (historical
      // records may contain raw MID values written before REV-05A).
      const rawMid = deal.mid ?? null;
      res.json({
        boardingStatus: deal.boardingStatus || "not_submitted",
        processorApplicationId: deal.processorApplicationId,
        midMasked: maskMid(rawMid),
        hasMid: !!rawMid,
        boardingLog: sanitizeBoardingLog((deal.boardingLog as unknown[]) || []),
        boardingSubmittedAt: deal.boardingSubmittedAt,
        boardingApprovedAt: deal.boardingApprovedAt,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * PUT /api/admin/merchants/:id/mid
   * #1445 — Assign or update a MID for a merchant deal.
   * The `:id` is the deal ID. Sets the `mid` field and logs the assignment.
   */
  app.put("/api/admin/merchants/:id/mid", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isFinite(dealId) || dealId <= 0) {
        return res.status(400).json({ message: "Invalid deal ID" });
      }

      const { mid, processorName, status } = req.body as {
        mid?: string;
        processorName?: string;
        status?: string;
      };

      if (!mid || !mid.trim()) {
        return res.status(400).json({ message: "MID is required" });
      }

      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      // REV-05A: Route all MID writes through canonical service.
      // deals.mid is a compatibility alias updated AFTER merchant_mids commit.
      const { assignMerchantMidToCanonical } = await import("../services/merchant-mid-service");
      const { midRow, isPrimary, created } = await assignMerchantMidToCanonical({
        dealId,
        contactId: deal.contactId ?? null,
        mid: mid.trim(),
        processorName: processorName ?? undefined,
        status: status && status.trim() ? status.trim() : undefined,
        actorId: (req.user as any)?.id ?? null,
        actorEmail: (req.user as any)?.email ?? "admin",
      });

      // REV-05A: Raw MID and full deal object omitted from response; masked value only.
      // Full MID is only returned from dedicated purpose-bound endpoints with access receipts.
      const rawMidVal = mid.trim();
      const { maskMid: _maskMidAssignRoute } = await import("../utils/mask-mid");
      const midMaskedVal = _maskMidAssignRoute(rawMidVal);
      res.json({
        success: true,
        midMasked: midMaskedVal,
        hasMid: true,
        midId: midRow.id,
        isPrimary,
        created,
        status: midRow.status,
      });
    } catch (err: any) {
      const { MerchantMidTransitionError: _MidErr } = await import("../services/merchant-mid-service");
      if (err instanceof _MidErr) {
        return res.status(err.code === "MID_INVALID_STATUS" ? 400 : 409).json({ message: err.message, code: err.code });
      }
      serverError(res, err);
    }
  });

  /**
   * GET /api/boarding/mid-registry
   * #1445 — Return all merchant deals eligible for MID assignment, with status classification.
   * Includes deals WITHOUT a MID (status=pending) as well as those with one (assigned/live).
   * Scoped to deals in the Sales or Boarding pipeline that have not been archived or lost.
   */
  app.get("/api/boarding/mid-registry", requireRole("admin", "manager"), async (req, res) => {
    try {
      // REV-05A: masked MID only. S5-21/R08: canonical merchant_mids is the MID source; the deals.mid alias is read ONLY
      // for a legacy deal that has no canonical rows at all, so a closed MID can never reappear through the alias.
      // Unit: ONE ROW PER DEAL (a deal with several MIDs shows its primary and `mid_count`). The page, the total and
      // the per-status counts come from one SQL statement (one snapshot) over the same scope, with a stable total order.
      const { operationalDealSql } = await import("../services/deal-production-scope");
      const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
      const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
      const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
      const STATUSES = ["pending", "assigned", "scheduled", "live"] as const;
      const midStatusRaw = typeof req.query.midStatus === "string" ? req.query.midStatus : "";
      if (midStatusRaw && !(STATUSES as readonly string[]).includes(midStatusRaw)) {
        return res.status(400).json({ message: `midStatus must be one of: ${STATUSES.join(", ")}`, code: "INVALID_MID_STATUS" });
      }
      const midStatusFilter = midStatusRaw ? sql`WHERE s.mid_status = ${midStatusRaw}` : sql``;
      const result = await db.execute(sql`
        WITH scoped AS (
          SELECT
            d.id AS deal_id,
            CASE
              WHEN pm.mid IS NOT NULL AND length(pm.mid) > 4 THEN repeat('*', length(pm.mid) - 4) || right(pm.mid, 4)
              WHEN pm.mid IS NOT NULL THEN repeat('*', length(pm.mid))
              ELSE NULL
            END AS mid_masked,
            (pm.mid IS NOT NULL) AS has_mid,
            pm.mid_record_status,
            pm.mid_id AS primary_mid_id,
            COALESCE(mc.n, CASE WHEN pm.mid IS NOT NULL THEN 1 ELSE 0 END)::int AS mid_count,
            d.pipeline, d.stage, d.owner,
            c.id AS contact_id, c.first_name, c.last_name, c.company_name, c.email,
            COALESCE(d.record_class, 'unknown') AS record_class,
            d.created_at, d.updated_at,
            CASE
              WHEN d.stage = 'Live' THEN 'live'
              WHEN d.stage = 'Go-Live Scheduled' THEN 'scheduled'
              WHEN pm.mid IS NOT NULL THEN 'assigned'
              ELSE 'pending'
            END AS mid_status
          FROM deals d
          LEFT JOIN contacts c ON c.id = d.contact_id
          LEFT JOIN LATERAL (
            SELECT count(*)::int AS n FROM merchant_mids mm WHERE mm.deal_id = d.id AND mm.status <> 'closed'
          ) mc ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              (SELECT mm.mid FROM merchant_mids mm
                WHERE mm.deal_id = d.id AND mm.status <> 'closed'
                ORDER BY (mm.mid = d.mid) DESC, mm.id LIMIT 1),
              CASE WHEN NOT EXISTS (SELECT 1 FROM merchant_mids x WHERE x.deal_id = d.id) THEN NULLIF(d.mid, '') END
            ) AS mid,
            (SELECT mm.id FROM merchant_mids mm
               WHERE mm.deal_id = d.id AND mm.status <> 'closed'
               ORDER BY (mm.mid = d.mid) DESC, mm.id LIMIT 1) AS mid_id,
            (SELECT mm.status FROM merchant_mids mm
               WHERE mm.deal_id = d.id AND mm.status <> 'closed'
               ORDER BY (mm.mid = d.mid) DESC, mm.id LIMIT 1) AS mid_record_status
          ) pm ON TRUE
          WHERE ${sql.raw(operationalDealSql("d"))}
            AND (
              lower(d.pipeline) IN ('sales', 'onboarding', 'boarding', 'merchant boarding')
              OR d.stage IN ('Approved', 'Underwriting', 'Underwriting Review', 'Underwriting Submitted',
                             'Go-Live Scheduled', 'Live', 'Closed Won')
            )
        ),
        filtered AS (
          SELECT s.* FROM scoped s ${midStatusFilter}
        ),
        page AS (
          SELECT f.*, row_number() OVER (ORDER BY
            CASE f.mid_status WHEN 'live' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'assigned' THEN 3 ELSE 4 END,
            f.updated_at DESC, f.deal_id DESC) AS ord
          FROM filtered f
          ORDER BY ord
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT
          (SELECT count(*)::int FROM filtered) AS total,
          (SELECT count(*)::int FROM scoped) AS scope_total,
          COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT mid_status AS k, count(*)::int AS n FROM scoped GROUP BY mid_status) t), '{}'::jsonb) AS by_status,
          COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT record_class AS k, count(*)::int AS n FROM scoped GROUP BY record_class) t), '{}'::jsonb) AS by_class,
          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS as_of,
          COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'ord' - 'record_class' ORDER BY p.ord) FROM page p), '[]'::jsonb) AS merchants
      `);
      const row = (((result as any).rows ?? result)[0]) as any;
      const merchants = Array.isArray(row.merchants) ? row.merchants : JSON.parse(row.merchants ?? "[]");
      const total = Number(row.total);
      const byStatus = typeof row.by_status === "string" ? JSON.parse(row.by_status) : row.by_status;
      const byClass = typeof row.by_class === "string" ? JSON.parse(row.by_class) : (row.by_class ?? {});
      res.json({
        merchants,
        byClass,
        unit: "deals",
        total,
        scopeTotal: Number(row.scope_total),
        returned: merchants.length,
        limit,
        offset,
        hasMore: offset + merchants.length < total,
        truncated: offset + merchants.length < total,
        byStatus: { pending: 0, assigned: 0, scheduled: 0, live: 0, ...byStatus },
        asOf: row.as_of,
        filter: midStatusRaw || null,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * GET /api/boarding/mid-registry/:dealId/mids
   * Masked MID history for one deal (every canonical record, closed included). Read-only; the full MID is never
   * returned, and the deal must be inside the registry's operational scope.
   */
  app.get("/api/boarding/mid-registry/:dealId/mids", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal id" });
      const { operationalDealSql } = await import("../services/deal-production-scope");
      const result = await db.execute(sql`
        SELECT mm.id, mm.status, mm.processor_name,
          CASE WHEN length(mm.mid) > 4 THEN repeat('*', length(mm.mid) - 4) || right(mm.mid, 4) ELSE repeat('*', length(mm.mid)) END AS mid_masked,
          (mm.mid = d.mid) AS is_primary_alias,
          mm.assigned_at, mm.activated_at, mm.suspended_at, mm.closed_at
        FROM deals d JOIN merchant_mids mm ON mm.deal_id = d.id
        WHERE d.id = ${dealId} AND ${sql.raw(operationalDealSql("d"))}
        ORDER BY (mm.status <> 'closed') DESC, mm.id`);
      const rows = ((result as any).rows ?? result) as any[];
      res.json({
        dealId,
        mids: rows.map((r) => ({
          id: r.id, status: r.status, processorName: r.processor_name, midMasked: r.mid_masked, isPrimaryAlias: !!r.is_primary_alias,
          assignedAt: r.assigned_at, activatedAt: r.activated_at, suspendedAt: r.suspended_at, closedAt: r.closed_at,
        })),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * POST /api/boarding/equipment
   * #1404 — Create an equipment shipment record with device type and serial number.
   */
  app.post("/api/boarding/equipment", requireRole("admin", "manager"), async (req, res) => {
    try {
      const body = req.body as {
        contactId: number;
        dealId?: number;
        deviceType?: string;
        serialNumber?: string;
        carrier?: string;
        trackingNumber?: string;
        status?: string;
        shippedAt?: string;
        estimatedDelivery?: string;
        notes?: string;
      };

      if (!body.contactId) return res.status(400).json({ message: "contactId is required" });

      const { equipmentShipments } = await import("@shared/schema");
      const [row] = await db.insert(equipmentShipments).values({
        contactId:         body.contactId,
        dealId:            body.dealId ?? null,
        deviceType:        body.deviceType ?? null,
        serialNumber:      body.serialNumber ?? null,
        carrier:           body.carrier ?? null,
        trackingNumber:    body.trackingNumber ?? null,
        status:            body.status ?? "pending",
        shippedAt:         body.shippedAt  ? new Date(body.shippedAt)  : null,
        estimatedDelivery: body.estimatedDelivery ? new Date(body.estimatedDelivery) : null,
        notes:             body.notes ?? null,
      }).returning();

      res.status(201).json({ shipment: row });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * PATCH /api/boarding/equipment/:id
   * #1404 — Update an equipment shipment (status, tracking, delivery, device details).
   */
  app.patch("/api/boarding/equipment/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid shipment id" });

      const body = req.body as {
        deviceType?: string;
        serialNumber?: string;
        carrier?: string;
        trackingNumber?: string;
        status?: string;
        shippedAt?: string | null;
        estimatedDelivery?: string | null;
        deliveredAt?: string | null;
        notes?: string;
      };

      const { equipmentShipments } = await import("@shared/schema");
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.deviceType        !== undefined) updates.deviceType        = body.deviceType;
      if (body.serialNumber      !== undefined) updates.serialNumber      = body.serialNumber;
      if (body.carrier           !== undefined) updates.carrier           = body.carrier;
      if (body.trackingNumber    !== undefined) updates.trackingNumber    = body.trackingNumber;
      if (body.status            !== undefined) updates.status            = body.status;
      if (body.shippedAt         !== undefined) updates.shippedAt         = body.shippedAt  ? new Date(body.shippedAt)  : null;
      if (body.estimatedDelivery !== undefined) updates.estimatedDelivery = body.estimatedDelivery ? new Date(body.estimatedDelivery) : null;
      if (body.deliveredAt       !== undefined) updates.deliveredAt       = body.deliveredAt ? new Date(body.deliveredAt) : null;
      if (body.notes             !== undefined) updates.notes             = body.notes;

      const [updated] = await db
        .update(equipmentShipments)
        .set(updates as any)
        .where(eq(equipmentShipments.id, id))
        .returning();

      if (!updated) return res.status(404).json({ message: "Shipment not found" });
      res.json({ shipment: updated });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * GET /api/boarding/equipment
   * #1404 — List equipment shipments for a contact or deal.
   */
  app.get("/api/boarding/equipment", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = req.query.contactId ? Number(req.query.contactId) : null;
      const dealId    = req.query.dealId    ? Number(req.query.dealId)    : null;
      if (!contactId && !dealId) return res.status(400).json({ message: "contactId or dealId required" });

      const { equipmentShipments } = await import("@shared/schema");
      const conditions = [];
      if (contactId) conditions.push(eq(equipmentShipments.contactId, contactId));
      if (dealId)    conditions.push(eq(equipmentShipments.dealId, dealId));

      const rows = await db.select().from(equipmentShipments)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(equipmentShipments.createdAt);

      res.json({ shipments: rows });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/deals/:id/mid-stats", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const days = req.query.days ? Number(req.query.days) : 30;
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      if (!deal.mid) {
        return res.json({ stats: [], midMasked: null, hasMid: false, fetchedAt: null, message: "No MID assigned to this deal" });
      }

      const rawStats = await storage.getMidDailyStatsByDeal(dealId, days);

      const mostRecent = rawStats.length > 0 ? rawStats[0] : null;
      const fetchedAt = mostRecent?.fetchedAt || null;

      // REV-05A: Raw MID omitted from all stat rows and top-level response; masked value only.
      const rawMidMs = deal.mid ?? null;
      const { maskMid: _maskMidStats } = await import("../utils/mask-mid");
      const midMaskedVal = _maskMidStats(rawMidMs);
      // Strip raw `mid` from every stat row before returning.
      const stats = rawStats.map(({ mid: _rawMid, ...rest }: any) => ({ ...rest, midMasked: midMaskedVal }));
      res.json({
        stats,
        midMasked: midMaskedVal,
        hasMid: !!rawMidMs,
        fetchedAt,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/refresh-mid-stats", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.mid) {
        return res.status(400).json({ message: "No MID assigned to this deal" });
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const midLog = (deal.boardingLog as any[]) || [];
      const midSubmittedEntry = [...midLog].reverse().find((e: any) => e.event === "submitted");
      const midProcessorName = midSubmittedEntry?.processor || "payarc";

      // REV-06A §14: requireConfirmedActivationSnapshot MUST be the first gate before
      // any provider I/O. Thread the snapshot-authorized base URL into the adapter so
      // the transport host is never selected independently of the activation authority.
      const { requireConfirmedActivationSnapshot: requireSnapshot } = await import("../services/processors/registry");
      let snapshotAuthorizedBaseUrl: string | null = null;
      try {
        const snap = await requireSnapshot(midProcessorName, "get_daily_stats");
        snapshotAuthorizedBaseUrl = snap.authorizedBaseUrl;
      } catch (snapErr: any) {
        return res.json({
          success: false,
          held: true,
          reason: snapErr?.message ?? "Activation snapshot gate blocked get_daily_stats",
          code: snapErr?.code ?? "ACTIVATION_SNAPSHOT_REQUIRED",
          upserted: 0,
        });
      }

      const midProcessor = midProcessorName ? getProcessor(midProcessorName) : getDefaultProcessor();
      const stats = await midProcessor.getDailyStats(
        deal.mid,
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0],
        { snapshotAuthorizedBaseUrl },
      );

      // REV-06A: getDailyStats returns HeldResult when not authorized or when provider fails.
      if (!Array.isArray(stats)) {
        return res.json({ success: false, held: true, reason: (stats as any).reason ?? "provider_held", upserted: 0 });
      }
      let upserted = 0;
      for (const stat of stats) {
        // REV-06A: pass null (not undefined) for absent optional fields so Drizzle
        // explicitly clears any stale prior value on upsert rather than omitting the
        // column (which would silently retain the old value).
        await storage.upsertMidDailyStat({
          mid: deal.mid,
          dealId,
          contactId: deal.contactId || undefined,
          date: stat.date,
          volume: stat.volume,
          txCount: stat.txCount ?? null,
          avgTicket: stat.avgTicket ?? null,
          effectiveRate: stat.effectiveRate ?? null,
          chargebackCount: stat.chargebackCount ?? null,
          chargebackAmount: stat.chargebackAmount ?? null,
          refundCount: stat.refundCount ?? null,
          fetchedAt: new Date(),
        });
        upserted++;
      }

      const rawMidRefresh = deal.mid ?? "";
      const { maskMid: _maskMidRefresh } = await import("../utils/mask-mid");
      const midMaskedRefresh = _maskMidRefresh(rawMidRefresh);
      await storage.createAuditLog({
        action: "mid_stats_refreshed",
        entityType: "deal",
        entityId: dealId,
        // REV-05A: raw MID omitted from audit — masked value only.
        details: { midMasked: midMaskedRefresh, daysRefreshed: 30, rowsUpserted: upserted },
      });

      const rawFreshStats = await storage.getMidDailyStatsByDeal(dealId, 30);
      // REV-05A: Strip raw `mid` from every stat row — return masked value only.
      const freshStats = rawFreshStats.map(({ mid: _rawMid, ...rest }: any) => ({ ...rest, midMasked: midMaskedRefresh }));
      res.json({ success: true, rowsUpserted: upserted, stats: freshStats, midMasked: midMaskedRefresh, hasMid: !!rawMidRefresh, fetchedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[MID Stats] Refresh error:", err.message);
      serverError(res, err);
    }
  });

  app.get("/api/boarding/enabled-processors", isDashboardUser, async (_req, res) => {
    try {
      const names = getEnabledAdapterNames();
      res.json({ processors: names });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/run-mid-ingestion", requireRole("admin"), async (req, res) => {
    try {
      const result = await ingestMidDataForActiveMids();
      res.json({ success: true, ...result });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/mid-stats/pipeline-summary", isDashboardUser, async (req, res) => {
    try {
      const days = req.query.days ? Number(req.query.days) : 30;
      const allDealsResult = await storage.getDeals({ limit: 10000 });
      const dealsWithMid = allDealsResult.data.filter((d) => d.mid);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const summaries: Record<string, {
        dealId: number;
        midMasked: string | null;
        hasMid: boolean;
        totalVolume: number;
        txCount: number;
        chargebackCount: number;
        trendPct: number;
        sparkline: number[];
        latestDate: string | null;
        fetchedAt: string | null;
      }> = {};

      for (const deal of dealsWithMid) {
        const stats = await storage.getMidDailyStatsByDeal(deal.id, days);
        const inWindow = stats.filter((s) => s.date >= cutoffStr);
        const asc = [...inWindow].sort((a, b) => a.date.localeCompare(b.date));

        const totalVolume = asc.reduce((s, r) => s + (Number(r.volume) || 0), 0);
        const txCount = asc.reduce((s, r) => s + (r.txCount || 0), 0);
        const chargebackCount = asc.reduce((s, r) => s + (r.chargebackCount || 0), 0);

        const half = Math.floor(asc.length / 2);
        const firstVol = asc.slice(0, half).reduce((s, r) => s + (Number(r.volume) || 0), 0);
        const secondVol = asc.slice(half).reduce((s, r) => s + (Number(r.volume) || 0), 0);
        const trendPct = firstVol > 0 ? ((secondVol - firstVol) / firstVol) * 100 : 0;

        const sparkline = asc.slice(-14).map((r) => Number(r.volume) || 0);
        const latest = asc[asc.length - 1] || null;

        // REV-05A: Raw MID omitted from pipeline summary; masked value only.
        const { maskMid: _maskMidPs } = await import("../utils/mask-mid");
        const rawMidPs = deal.mid as string;
        summaries[String(deal.id)] = {
          dealId: deal.id,
          midMasked: _maskMidPs(rawMidPs),
          hasMid: !!rawMidPs,
          totalVolume,
          txCount,
          chargebackCount,
          trendPct,
          sparkline,
          latestDate: latest?.date ?? null,
          fetchedAt: latest?.fetchedAt ? new Date(latest.fetchedAt).toISOString() : null,
        };
      }

      res.json({ summaries, days });
    } catch (err: any) {
      console.error("[MID Stats] Pipeline summary error:", err.message);
      serverError(res, err);
    }
  });

  app.get("/api/boarding/submissions", isDashboardUser, async (req, res) => {
    try {
      const actor=req.user as {id:string;role:string;email?:string};
      if(!["admin","manager","agent"].includes(actor.role)||(actor.role==="agent"&&!actor.email))
        return res.status(403).json({message:"Boarding read scope unavailable"});
      const rawStatus=req.query.status;
      if(rawStatus!==undefined&&(typeof rawStatus!=="string"||
        !["all","submitted","under_review","more_info_needed","approved","declined"].includes(rawStatus)))
        return res.status(400).json({message:"Invalid/conflicting boarding status"});
      const statusFilter=rawStatus==="all"?undefined:rawStatus as string|undefined;
      const population=await readBoardingDealPopulation({recordClass:"production",
        ownerEmail:actor.role==="agent"?actor.email:undefined});
      const allDeals = population.data;

      const inFlight = allDeals.filter((d) => {
        const s = d.boardingStatus || "not_submitted";
        if (s === "not_submitted") return false;
        if (statusFilter && statusFilter !== "all" && s !== statusFilter) return false;
        return true;
      });

      const now = new Date(population.asOf).getTime();
      const { maskMid: _maskMidSubmissions, sanitizeLatestLogMessage: _sanitizeMsg } = await import("../utils/mask-mid");
      const submissions = inFlight.map((d) => {
        const fullName = [d.contactFirstName,d.contactLastName].filter(Boolean).join(" ").trim();
        const merchantName =
          d.contactCompanyName?.trim() ||
          fullName ||
          d.contactEmail?.trim() ||
          d.contactPhone?.trim() ||
          (d.contactId?`Contact #${d.contactId} — identifying fields unavailable`:"No linked contact recorded");
        const log = (d.boardingLog as any[]) || [];
        const latestLog = log.length > 0 ? log[log.length - 1] : null;
        const submittedAt = d.boardingSubmittedAt ? new Date(d.boardingSubmittedAt) : null;
        const daysPending = submittedAt
          ? Math.max(0, Math.floor((now - submittedAt.getTime()) / (1000 * 60 * 60 * 24)))
          : null;

        return {
          dealId: d.id,
          contactId: d.contactId,
          relatedData:{contact:d.contactId==null?"not_linked":d.contactResolvedId==null?"missing":"resolved"},
          merchantName,
          processorApplicationId: d.processorApplicationId,
          boardingStatus: d.boardingStatus || "not_submitted",
          boardingSubmittedAt: d.boardingSubmittedAt,
          boardingApprovedAt: d.boardingApprovedAt,
          daysPending,
          latestLogMessage: _sanitizeMsg(latestLog?.message || latestLog?.event || null),
          latestLogTimestamp: latestLog?.timestamp || null,
          // REV-05A: Raw MID omitted from submissions list; masked value only.
          midMasked: _maskMidSubmissions(d.mid as string | null),
          hasMid: !!d.mid,
          owner: d.owner,
          pipeline: d.pipeline,
          stage: d.stage,
        };
      });

      submissions.sort((a, b) => {
        const at = a.boardingSubmittedAt ? new Date(a.boardingSubmittedAt).getTime() : 0;
        const bt = b.boardingSubmittedAt ? new Date(b.boardingSubmittedAt).getTime() : 0;
        return bt - at || b.dealId-a.dealId;
      });

      const counts: Record<string, number> = {
        submitted: 0,
        under_review: 0,
        more_info_needed: 0,
        approved: 0,
        declined: 0,
      };
      for (const s of submissions) {
        if (counts[s.boardingStatus] !== undefined) counts[s.boardingStatus]++;
      }

      const read={source:"local_recorded_boarding_deals_joined_contacts",asOf:population.asOf,timezone:"UTC",
        consistency:"one_repeatable_read_cohort",completeness:"complete_authorized_recorded_cohort",
        actorId:actor.id,recordClass:"production",archive:"excluded",status:statusFilter||"all",
        ownerScope:actor.role==="agent"?"self_or_unassigned":"administrative_global",
        meaning:"stored_boarding_state_not_native_refresh_or_ingestion_receipt"};
      res.json({ submissions, counts,total:submissions.length,read,
        snapshot:crypto.createHash("sha256").update(JSON.stringify({read,submissions,counts})).digest("hex") });
    } catch (err: any) {
      console.error("[Boarding] List error:", err.message);
      serverError(res, err);
    }
  });

  app.get("/api/mid-stats/summary", isDashboardUser, async (req, res) => {
    try {
      const allDealsResult = await storage.getDeals({ limit: 10000 });
      const allDeals = allDealsResult.data;
      const midsWithDeals = allDeals.filter((d) => d.mid);
      const uniqueMids = [...new Set(midsWithDeals.map((d) => d.mid as string))];

      const recentStatsByMid: Array<{
        // REV-05A: raw MID omitted; masked value only
        midMasked: string | null;
        hasMid: boolean;
        dealId: number | null;
        latestDate: string | null;
        latestVolume: string | null;
        latestTxCount: number | null;
        latestAvgTicket: string | null;
        latestEffectiveRate: string | null;
        latestChargebackCount: number | null;
        fetchedAt: string | null;
        merchantName: string | null;
      }> = [];

      let overallLatestFetch: Date | null = null;

      for (const mid of uniqueMids) {
        const deal = midsWithDeals.find((d) => d.mid === mid) || null;
        const stats = await storage.getMidDailyStats(mid);
        const latest = stats[0] || null;
        if (latest?.fetchedAt) {
          const fetchDate = new Date(latest.fetchedAt);
          if (!overallLatestFetch || fetchDate > overallLatestFetch) {
            overallLatestFetch = fetchDate;
          }
        }
        // REV-05A: Mask MID — do not return raw value in summary endpoint.
        const { maskMid: _maskMidSummary } = await import("../utils/mask-mid");
        const midMasked = _maskMidSummary(mid);
        recentStatsByMid.push({
          midMasked,
          hasMid: !!mid,
          dealId: deal?.id ?? null,
          latestDate: latest?.date ?? null,
          latestVolume: latest?.volume != null ? String(latest.volume) : null,
          latestTxCount: latest?.txCount ?? null,
          latestAvgTicket: latest?.avgTicket != null ? String(latest.avgTicket) : null,
          latestEffectiveRate: latest?.effectiveRate != null ? String(latest.effectiveRate) : null,
          latestChargebackCount: latest?.chargebackCount ?? null,
          fetchedAt: latest?.fetchedAt ? new Date(latest.fetchedAt).toISOString() : null,
          merchantName: (deal as any)?.name ?? deal?.contactName ?? null,
        });
      }

      res.json({
        stats: recentStatsByMid,
        latestFetch: overallLatestFetch ? overallLatestFetch.toISOString() : null,
        totalMids: uniqueMids.length,
        activeMids: recentStatsByMid.filter((s) => s.latestDate !== null).length,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Onboarding Checklist Routes ───────────────────────────────────────────

  app.get("/api/deals/:id/onboarding-checklist", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      const user = req.user as any;
      // Merchants may only read the checklist for their own deal.
      if (user.role === "merchant") {
        const profile = await storage.getMerchantProfileByUser(user.id);
        if (!profile || profile.dealId !== dealId) {
          return res.status(403).json({ message: "Forbidden" });
        }
      } else if (user.role !== "admin" && user.role !== "manager" && user.role !== "agent") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const items = await storage.getOnboardingChecklistItems(dealId);
      res.json(items);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/onboarding-checklist/init", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const items = await storage.initializeOnboardingChecklist(dealId);
      res.json(items);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.patch("/api/deals/:id/onboarding-checklist/:itemKey", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const itemKey = req.params.itemKey as string;
      const { status, documentId, notes } = req.body as { status?: string; documentId?: number | null; notes?: string | null };

      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });

      const validStatuses = ["not_requested", "requested", "received", "approved", "rejected"];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      if (status === "approved" || status === "rejected") {
        const user = (req as any).user;
        if (!user || !["admin", "manager"].includes(user.role)) {
          return res.status(403).json({ message: "Only admins and managers can approve or reject documents" });
        }
      }

      const item = await storage.updateOnboardingChecklistItemStatus(dealId, itemKey, status || "not_requested", documentId, notes);
      if (!item) {
        const upserted = await storage.upsertOnboardingChecklistItem({ dealId, itemKey, status: status || "not_requested", documentId, notes });
        return res.json(upserted);
      }
      res.json(item);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * Defines which checklist keys are required for each onboarding stage (#432).
   * Stages not listed inherit no automatic requirements (manual checklist only).
   */
  const STAGE_REQUIRED_DOCS: Record<string, string[]> = {
    "Application Started":       ["signed_agreement"],
    "Docs Requested":            ["voided_check", "government_id", "signed_agreement", "bank_letter"],
    "Docs Received":             ["voided_check", "government_id", "signed_agreement", "bank_letter"],
    "Underwriting Submitted":    ["voided_check", "government_id", "signed_agreement", "bank_letter", "business_license"],
    "Contract Sent":             ["voided_check", "government_id", "signed_agreement", "bank_letter", "business_license"],
    "Boarding Complete":         ["voided_check", "government_id", "signed_agreement", "bank_letter", "business_license"],
  };

  app.get("/api/onboarding-board", isDashboardUser, async (req, res) => {
    try {
      const { data: allDeals } = await storage.getDeals({ limit: 5000 });
      const onboardingDeals = allDeals.filter((d) => d.pipeline === "onboarding" && !d.archivedAt);

      const results = await Promise.all(
        onboardingDeals.map(async (deal) => {
          const [checklistItems, contact] = await Promise.all([
            storage.getOnboardingChecklistItems(deal.id),
            deal.contactId ? storage.getContact(deal.contactId) : null,
          ]);
          const totalItems = checklistItems.length;
          const approvedItems = checklistItems.filter((i) => i.status === "approved").length;
          const pendingItems = checklistItems.filter((i) => i.status === "not_requested" || i.status === "requested").length;
          const overdueItems = checklistItems.filter((i) => {
            const isStale = i.status === "not_requested" || i.status === "requested";
            const lastUpdated = new Date(i.updatedAt || i.createdAt || Date.now());
            return isStale && lastUpdated < new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
          }).length;

          // Compute which required docs for the current stage are not yet approved (#432)
          const requiredForStage = STAGE_REQUIRED_DOCS[deal.stage ?? ""] ?? [];
          const missingRequired = requiredForStage.filter((key) => {
            const item = checklistItems.find((i) => i.itemKey === key);
            return !item || item.status !== "approved";
          });

          // Count uploaded documents for this deal (#142)
          const docsResult = await db.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM documents WHERE deal_id = ${deal.id}`
          );
          const documentsCount = (docsResult.rows[0] as any)?.cnt ?? 0;

          // REV-05A: Serialize deal — masks mid AND sanitizes boardingLog
          // (historical entries may contain raw mid fields or MID-like text).
          const { serializeDeal: _serializeDealBoard, maskMid: _maskMidBoard } = await import("../utils/mask-mid");
          const serialized = _serializeDealBoard(deal as any);
          // Also expose midMasked alias for onboarding-board consumers.
          const maskedDeal = { ...serialized, midMasked: _maskMidBoard((deal as any).mid) };

          return {
            deal: maskedDeal,
            contact: contact ? { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName, email: contact.email, phone: contact.phone } : null,
            checklistItems,
            documentsCount,
            stats: {
              totalItems,
              approvedItems,
              pendingItems,
              overdueItems,
              progressPct: totalItems > 0 ? Math.round((approvedItems / totalItems) * 100) : 0,
              requiredForStage,
              missingRequired,
            },
          };
        })
      );

      res.json(results);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/operator/onboarding-kpis", isDashboardUser, async (req, res) => {
    try {
      const kpis = await storage.getOnboardingKpis();
      res.json(kpis);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Statement occurrences with the real state of each handoff step. Read-only: it derives held/manual/analysis truth from
  // the retained command, the occurrence and the deal, never from a step that merely reported success. A failure is a
  // 503 so the panel shows "unavailable" with Retry instead of an empty all-clear.
  app.get("/api/operator/statement-chain", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { readStatementChain } = await import("../services/statement-chain-read-model");
      res.set("Cache-Control", "no-store");
      res.json(await readStatementChain({
        limit: Number(req.query.limit) || 60,
        failuresOnly: req.query.failuresOnly === "true",
      }));
    } catch (err: any) {
      console.error("[Operator] statement chain read failed:", err instanceof Error ? err.name : "unknown");
      res.status(503).json({ error: "STATEMENT_CHAIN_UNAVAILABLE", message: "Statement handoff status could not be loaded." });
    }
  });

  // ─── POST /api/webhooks/payarc ───────────────────────────────────────────────
  // REV-05A: Inert Payarc webhook endpoint.
  //
  // SECURITY CONTRACT:
  //   - Returns 200 immediately; logs raw payload with timestamp.
  //   - Does NOT mutate canonical state.
  //   - No signature verification implemented — awaiting Payarc spec + fixtures.
  //   - PAYARC_WEBHOOK_VERIFIED=true flag gate required before any future mutation.
  //   - Webhook payloads are non-authoritative hints only. Lifecycle transitions
  //     require confirmation via authenticated provider poll before applying.
  //
  // Registration process:
  //   1. Deploy this endpoint so stable *.replit.app URL is live.
  //   2. Email Payarc implementations team with URL + desired events.
  //   3. Request signing spec and authentic signed fixtures.
  //   4. Only then implement signature verification and canonical mutations.
  app.post("/api/webhooks/payarc", async (req, res) => {
    try {
      // Return 200 immediately — Payarc expects quick acknowledgment.
      res.status(200).json({ received: true });

      // Log raw payload + headers for operator inspection (non-blocking).
      const receivedAt = new Date().toISOString();
      const safeHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        // Never log Authorization header
        if (k.toLowerCase() !== "authorization") {
          safeHeaders[k] = String(v);
        }
      }

      // PAYARC_WEBHOOK_VERIFIED guard: if not set, log and skip all processing.
      if (!process.env.PAYARC_WEBHOOK_VERIFIED) {
        console.log(
          `[Payarc Webhook] Received at ${receivedAt} — PAYARC_WEBHOOK_VERIFIED not set. ` +
          `Payload logged to payarc_webhook_events table only. No canonical mutations.`
        );
      }

      // Persist a bounded, safe event record for operator inspection.
      // REV-05A §8: Headers are NOT persisted — they can contain signatures,
      // cookies, or bearer tokens that must not be stored until Payarc provides
      // the signing spec. Payload is bounded to 8 KB and validated as an object
      // before storage; arbitrary or oversized payloads are truncated/rejected.
      const rawBody = req.body ?? {};
      const isObject = typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody);
      const safePayload = isObject ? rawBody : {};
      const payloadStr = JSON.stringify(safePayload);
      const boundedPayload = payloadStr.length <= 8192 ? safePayload : { _truncated: true, _reason: "payload_too_large" };
      try {
        await db.execute(sql`
          INSERT INTO payarc_webhook_events (received_at, raw_payload)
          VALUES (${receivedAt}::timestamptz, ${JSON.stringify(boundedPayload)}::jsonb)
        `);
      } catch (dbErr: any) {
        // Logging failure must not affect the 200 response already sent.
        console.error("[Payarc Webhook] Failed to persist event:", dbErr?.message ?? "unknown");
      }
    } catch (err: any) {
      // Should not happen since response was already sent, but guard anyway.
      console.error("[Payarc Webhook] Handler error:", err?.message ?? "unknown");
    }
  });
}
