import { storage } from "../storage";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { deals } from "@shared/schema";
import { getProcessor } from "./processors/registry";
import { auditChange } from "./audit-change";
import {
  advanceDealStageInTx,
  advanceDealStageAfterCommit,
} from "./deal-stage-service";
export interface BoardingRefreshResult {
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
  errorMessage: string,
): Promise<{ alertCreated: boolean; existingAlert: boolean }> {
  const existingLog = (deal.boardingLog as any[]) || [];

  const lastStatusCheck = [...existingLog]
    .reverse()
    .find((e: any) => e.event === "status_check");
  const isConsecutiveFailure = lastStatusCheck?.outcome === "failed";

  // REV-05A: Redact provider-derived error text before persisting into boardingLog.
  const {
    redactProviderText: _redactErrText,
    sanitizeBoardingLog: _sanitizeFailLog,
  } = await import("../utils/mask-mid");
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
      t.status === "pending",
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
  if (statusProcessorOverrideForTest && process.env.NODE_ENV === "test")
    return statusProcessorOverrideForTest(name);
  return getProcessor(name);
}

export async function performBoardingStatusRefresh(
  dealId: number,
): Promise<BoardingRefreshResult> {
  let deal: Awaited<ReturnType<typeof storage.getDeal>> | undefined = undefined;
  try {
    deal = await storage.getDeal(dealId);
    if (!deal) return { dealId, outcome: "skipped", error: "Deal not found" };
    if (!deal.processorApplicationId) {
      return {
        dealId,
        outcome: "skipped",
        error: "No processor application ID on this deal. Submit first.",
      };
    }

    const dealLog = (deal.boardingLog as any[]) || [];
    const submittedEntry = [...dealLog]
      .reverse()
      .find((e: any) => e.event === "submitted");
    const dealProcessorName = submittedEntry?.processor || undefined;
    // S5-18: the adapter identity comes from the recorded submission. It is never inferred
    // or defaulted — polling the wrong provider could apply a foreign application's status.
    if (!dealProcessorName) {
      return {
        dealId,
        outcome: "skipped",
        error:
          "No processor recorded for this deal's submission; refusing to infer one.",
      };
    }
    let payarcEnvironment: string | null = null;
    if (dealProcessorName === "payarc") {
      const result: any = await db.execute(
        sql`SELECT merchant_code,contract_version,environment FROM payarc_cases WHERE deal_id=${dealId}`,
      );
      const c = (result.rows ?? result)[0];
      if (
        !c ||
        c.merchant_code !== deal.processorApplicationId ||
        c.contract_version !== "traditional-apply-v1"
      )
        return {
          dealId,
          outcome: "skipped",
          error:
            "Legacy or unbound Payarc identity requires explicit reconciliation.",
        };
      payarcEnvironment = c.environment;
    }
    const processor = resolveStatusProcessor(dealProcessorName);

    // REV-05A: Status polling is provider I/O that can mutate deal state (approved, MID).
    // It must be gated by the activation snapshot — including latest-only check,
    // entitlement, supportedOperations, and authorizedBaseUrl — before any poll.
    //
    // Exception: Mock adapter in non-production is exempt from the snapshot gate
    // (same reason as the outbox worker — Mock never has a snapshot, and rejecting
    // it here would make dev/test status polls always skip).
    const { requireConfirmedActivationSnapshot } = await import(
      "./processors/registry"
    );
    const processorNameForGate = dealProcessorName;
    const isMockNonProd =
      processorNameForGate === "mock" && process.env.NODE_ENV !== "production";
    // For Mock in non-production, supply the same synthetic URL used by the outbox worker.
    // Mock never makes real network calls, so the URL is a sentinel only — but all
    // adapter transport methods require a non-null snapshotAuthorizedBaseUrl.
    let statusPollingBaseUrl: string | null = isMockNonProd
      ? "mock://internal.mock.local"
      : null;
    let statusSnapshotProgram: string | null = isMockNonProd
      ? "traditional"
      : null;
    if (!isMockNonProd) {
      try {
        // REV-05A: Status polling requires the "get_merchant_status" operation to
        // be listed in supportedOperations — not "board_merchant". A snapshot that
        // only authorizes boarding does not implicitly authorize provider polling.
        const snapshot = await requireConfirmedActivationSnapshot(
          processorNameForGate,
          "get_merchant_status",
        );
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
    const readCaseTuple = async (
      q: { execute: (x: any) => Promise<any> },
      lock: boolean,
    ) => {
      const r = await q.execute(sql`
        SELECT d.processor_application_id, d.boarding_status, d.boarding_log, d.pipeline, d.stage, d.contact_id,
               d.sales_deal_id, d.archived_at IS NOT NULL AS archived, COALESCE(d.record_class,'unknown') AS record_class,
               (SELECT a.id::text || ':' || a.updated_at::text FROM merchant_applications a WHERE a.deal_id = d.id ORDER BY a.id LIMIT 1) AS application_rev
        FROM deals d WHERE d.id = ${dealId} ${lock ? sql.raw("FOR UPDATE OF d") : sql.raw("")}`);
      return ((r as any).rows ?? r)[0] as any;
    };
    if (payarcEnvironment) {
      const { checkProcessorBaseUrl } = await import(
        "./processors/processor-base-url"
      );
      const base = checkProcessorBaseUrl("payarc", statusPollingBaseUrl);
      if (!base.ok || base.environment !== payarcEnvironment)
        return {
          dealId,
          outcome: "skipped",
          error: "Payarc case environment differs from status authority.",
        };
    }
    const observedRow = await readCaseTuple(db as any, false);
    const caseKey = (c: any) =>
      JSON.stringify([
        c?.pipeline,
        c?.stage,
        c?.contact_id,
        c?.sales_deal_id,
        c?.archived,
        c?.record_class,
        c?.application_rev,
      ]);
    const observedCaseKey = caseKey(observedRow);
    const result = await processor.getMerchantStatus(
      deal.processorApplicationId,
      merchantStatusOptions as any,
    );

    if (!result.success) {
      const alertInfo = await recordBoardingFailureAndAlert(
        deal,
        dealId,
        result.error || "Failed to check boarding status",
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

    if (result.moreInfoRequest)
      logEntry.moreInfoRequest = result.moreInfoRequest;
    if (result.declineReason) logEntry.declineReason = result.declineReason;
    // REV-05A: Never write raw MID into boardingLog; use masked value only.
    if (result.mid) {
      const { maskMid: _maskMidLog } = await import("../utils/mask-mid");
      logEntry.midMasked = _maskMidLog(result.mid);
    }

    const existingLog = (deal.boardingLog as any[]) || [];
    const {
      sanitizeBoardingLog: _sanitizeForPersist,
      maskMid: _maskMidApply,
      redactProviderText: _redactApply,
    } = await import("../utils/mask-mid");
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
    let stageOutcome: Awaited<ReturnType<typeof advanceDealStageInTx>> | null =
      null;
    const applied = await db.transaction(async (tx) => {
      const cur = await readCaseTuple(tx as any, true);
      if (!cur) return { kind: "stale" as const };
      if (caseKey(cur) !== observedCaseKey) return { kind: "stale" as const };
      const curLogLen = Array.isArray(cur.boarding_log)
        ? cur.boarding_log.length
        : 0;
      if (
        cur.processor_application_id !== observed.processorApplicationId ||
        (cur.boarding_status ?? null) !== observed.boardingStatus ||
        curLogLen !== observed.logLength
      )
        return { kind: "stale" as const };
      if (
        !result.payarcLifecycle &&
        cur.boarding_status &&
        TERMINAL_BOARDING.has(cur.boarding_status) &&
        cur.boarding_status !== result.status
      ) {
        return {
          kind: "terminal" as const,
          current: cur.boarding_status as string,
        };
      }
      if (result.payarcLifecycle) {
        const c: any = await tx.execute(
          sql`SELECT phase,observation FROM payarc_cases WHERE deal_id=${dealId} AND merchant_code=${deal!.processorApplicationId} FOR UPDATE`,
        );
        const prior = (c.rows ?? c)[0];
        const { payarcObservationCanAdvance } = await import(
          "@shared/payarc-traditional"
        );
        if (
          !prior ||
          !payarcObservationCanAdvance(
            prior.phase,
            result.payarcLifecycle.phase,
            {
              nextStatus: result.payarcLifecycle.applicationStatus,
              moduleChanged:
                !!prior.observation?.leadModule &&
                prior.observation.leadModule !==
                  result.payarcLifecycle.leadModule,
            },
          )
        )
          return { kind: "stale" as const };
        const { mid: _privateMid, ...observation } = result.payarcLifecycle;
        await tx.execute(sql`UPDATE payarc_cases SET phase=${observation.phase},observation=${JSON.stringify(observation)}::jsonb,last_polled_at=now(),last_error=NULL,
          next_poll_at=now()+CASE WHEN ${observation.phase === "processing_ready"} THEN interval '24 hours' ELSE interval '5 minutes' END,
          signature_state=CASE WHEN ${![0, 1, 2, 16].includes(observation.applicationStatus)} AND signature_state IN ('pending','attempting','uncertain') THEN 'sent' ELSE signature_state END,
          updated_at=now() WHERE deal_id=${dealId} AND merchant_code=${deal!.processorApplicationId}`);
      }
      if (result.status === "approved" && result.mid) {
        const { assignMerchantMidToCanonical } = await import(
          "./merchant-mid-service"
        );
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
      await tx
        .update(deals)
        .set({
          boardingStatus:
            result.payarcLifecycle &&
            cur.boarding_status === "approved" &&
            ["on_hold", "closed"].includes(result.payarcLifecycle.phase)
              ? "approved"
              : result.status,
          boardingLog: nextLog,
          ...(result.status === "approved" && result.mid
            ? { boardingApprovedAt: new Date() }
            : {}),
          updatedAt: new Date(),
        } as any)
        .where(eq(deals.id, dealId));
      // R04: the stage/handoff intent commits WITH the observation (durable intent ledger rows are written by the
      // canonical stage service inside this transaction); post-commit telemetry runs only after commit.
      if (result.status === "approved" && deal!.pipeline === "onboarding") {
        stageOutcome = await advanceDealStageInTx(
          tx,
          dealId,
          "Approved",
          "boarding_status_refresh",
          {
            reason: "Processor boarding status approved",
            actor: "system",
            expectedStage: deal!.stage,
          },
        );
      }
      await auditChange(
        {
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
        },
        tx,
      );
      return { kind: "applied" as const };
    });
    if (applied.kind === "stale") {
      return {
        dealId,
        outcome: "skipped",
        error:
          "Status observation is stale (the deal changed after it was read); not applied.",
      };
    }
    if (applied.kind === "terminal") {
      return {
        dealId,
        outcome: "skipped",
        error: `Provider status '${result.status}' conflicts with recorded terminal status '${applied.current}'; not applied.`,
      };
    }

    const committedStage = stageOutcome as Awaited<
      ReturnType<typeof advanceDealStageInTx>
    > | null;
    if (committedStage && committedStage.applied && committedStage.stagedDeal) {
      await advanceDealStageAfterCommit(
        committedStage.stagedDeal,
        dealId,
        "Approved",
        "boarding_status_refresh",
      );
    }

    // When the processor approves the deal, fire the merchant portal invitation
    // so the merchant gets their access link. The canonical stage service owns
    // the durable intent; this remains a best-effort duplicate-safe nudge.
    if (result.status === "approved" && deal.pipeline === "onboarding") {
      import("./merchant-portal-invite")
        .then(({ sendMerchantPortalInvite }) =>
          sendMerchantPortalInvite(dealId).then((inviteResult) => {
            if (!inviteResult.sent) {
              console.log(
                `[Boarding] Portal invite skipped for deal ${dealId} (reason: ${inviteResult.reason})`,
              );
            }
          }),
        )
        .catch((err: Error) =>
          console.error(
            `[Boarding] Portal invite error for deal ${dealId}:`,
            err.message,
          ),
        );
    }

    if (result.status === "more_info_needed" && result.moreInfoRequest) {
      const existingTasks = await storage.getTasks();
      const hasInfoTask = existingTasks.some(
        (t: any) =>
          t.dealId === dealId &&
          t.title?.includes("More Info Required") &&
          t.status === "pending",
      );
      if (!hasInfoTask) {
        // REV-05A: Redact provider-derived text before persisting in task/notification.
        const { redactProviderText: _redactMoreInfo } = await import(
          "../utils/mask-mid"
        );
        const safeMoreInfo =
          _redactMoreInfo(result.moreInfoRequest) ?? "(no details provided)";
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
    const { maskMid: _maskMidRefreshResult } = await import(
      "../utils/mask-mid"
    );
    const maskedMid = result.mid
      ? _maskMidRefreshResult(result.mid)
      : undefined;
    const { redactProviderText: _redactMsg } = await import(
      "../utils/mask-mid"
    );
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
        const alertInfo = await recordBoardingFailureAndAlert(
          deal,
          dealId,
          err.message || "Unknown error",
        );
        return {
          dealId,
          outcome: "failed",
          error: err.message || "Unknown error",
          ...alertInfo,
        };
      } catch {
        // ignore secondary failure — return bare failed result
      }
    }
    return { dealId, outcome: "failed", error: err.message || "Unknown error" };
  }
}
