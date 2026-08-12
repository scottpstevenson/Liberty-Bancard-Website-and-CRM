import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getProcessor, getDefaultProcessor, getEnabledAdapterNames, ingestMidDataForActiveMids } from "../services/processors/registry";
import { serverError, safeMessage } from "../utils/server-error";

const IN_FLIGHT_BOARDING_STATUSES = ["submitted", "under_review", "more_info_needed"];

interface BoardingRefreshResult {
  dealId: number;
  outcome: "success" | "failed" | "skipped";
  status?: string;
  mid?: string;
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

  const failureEntry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    event: "status_check",
    outcome: "failed",
    error: errorMessage,
  };

  await storage.updateDeal(dealId, {
    boardingLog: [...existingLog, failureEntry],
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

  await storage.createTask({
    dealId,
    contactId: deal.contactId || undefined,
    title: `Persistent Boarding Failure — Deal #${dealId}`,
    assignedTo: deal.owner || "Scott Stevenson",
    priority: "high",
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    description: `Boarding status refresh has failed on consecutive attempts. Latest error: ${errorMessage}`,
  });

  await storage.createNotification({
    channel: "internal",
    title: "Persistent Boarding Failure",
    message: `Deal #${dealId} has failed consecutive boarding status refreshes. Error: ${errorMessage}`,
    type: "urgent",
    metadata: { dealId, eventType: "boarding_persistent_failure" },
  });

  return { alertCreated: true, existingAlert: false };
}

async function performBoardingStatusRefresh(dealId: number): Promise<BoardingRefreshResult> {
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
    const processor = dealProcessorName ? getProcessor(dealProcessorName) : getDefaultProcessor();
    const result = await processor.getMerchantStatus(deal.processorApplicationId);

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
    };

    if (result.moreInfoRequest) logEntry.moreInfoRequest = result.moreInfoRequest;
    if (result.declineReason) logEntry.declineReason = result.declineReason;
    if (result.mid) logEntry.mid = result.mid;

    const existingLog = (deal.boardingLog as any[]) || [];

    const updates: Record<string, any> = {
      boardingStatus: result.status,
      boardingLog: [...existingLog, logEntry],
    };

    if (result.status === "approved" && result.mid) {
      updates.mid = result.mid;
      updates.boardingApprovedAt = new Date();

      if (deal.pipeline === "onboarding") {
        updates.stage = "Approved";
      }
    }

    await storage.updateDeal(dealId, updates);

    // When the processor approves the deal, fire the merchant portal invitation
    // so the merchant gets their access link. This mirrors the same hook in
    // advanceDealStage — boarding.ts sets stage directly to preserve the extra
    // boarding fields, so the invite must be triggered here explicitly.
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

    await storage.createAuditLog({
      action: "boarding_status_refreshed",
      entityType: "deal",
      entityId: dealId,
      details: { status: result.status, mid: result.mid, message: result.message },
    });

    if (result.status === "more_info_needed" && result.moreInfoRequest) {
      const existingTasks = await storage.getTasks();
      const hasInfoTask = existingTasks.some(
        (t: any) => t.dealId === dealId && t.title?.includes("More Info Required") && t.status === "pending"
      );
      if (!hasInfoTask) {
        await storage.createTask({
          dealId,
          contactId: deal.contactId || undefined,
          title: `More Info Required — Processor for Deal #${dealId}`,
          assignedTo: deal.owner || "Scott Stevenson",
          priority: "high",
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          description: `Processor request: ${result.moreInfoRequest}`,
        });

        await storage.createNotification({
          channel: "internal",
          title: "Processor Needs More Info",
          message: `Deal #${dealId} — ${result.moreInfoRequest}`,
          type: "urgent",
          metadata: { dealId, eventType: "boarding_more_info" },
        });
      }
    }

    return {
      dealId,
      outcome: "success",
      status: result.status,
      mid: result.mid,
      message: result.message,
      moreInfoRequest: result.moreInfoRequest,
      declineReason: result.declineReason,
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
  app.post("/api/deals/:id/submit-to-processor", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      if (deal.boardingStatus && deal.boardingStatus !== "not_submitted" && deal.boardingStatus !== "declined") {
        return res.status(400).json({
          message: `Deal is already in boarding status: ${deal.boardingStatus}. Cannot resubmit.`,
        });
      }

      const isUnderwriting =
        deal.pipeline === "onboarding" ||
        (deal.stage ?? "").toLowerCase().includes("underwriting") ||
        (deal.stage ?? "").toLowerCase().includes("approved");
      if (!isUnderwriting) {
        return res.status(400).json({
          message: "Deal must be in the onboarding pipeline or an underwriting/approved stage before submitting to the processor.",
        });
      }

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      let application = null;
      if (deal.contactId) {
        const apps = await storage.getMerchantApplications();
        application = apps.find(a => a.contactId === deal.contactId || a.dealId === dealId) || null;
      }

      const payload = {
        dealId,
        legalBusinessName:
          application?.legalBusinessName ||
          contact?.companyName ||
          `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() ||
          "Unknown Business",
        dba: application?.dba || contact?.companyName || undefined,
        ein: application?.ein || undefined,
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
        ownerDob: application?.ownerDob || undefined,
        ownerSsn: application?.ownerSsn || undefined,
        ownerAddress: application?.ownerAddress || undefined,
        ownerCity: application?.ownerCity || undefined,
        ownerState: application?.ownerState || undefined,
        ownerZip: application?.ownerZip || undefined,
        bankRoutingNumber: application?.bankRoutingNumber || undefined,
        bankAccountNumber: application?.bankAccountNumber || undefined,
        bankAccountType: application?.bankAccountType || undefined,
        estimatedMonthlyVolume: application?.estimatedMonthlyVolume || deal.totalVolume || contact?.monthlyVolume || undefined,
        estimatedAvgTicket: application?.estimatedAvgTicket || deal.avgTicket || contact?.avgTicket || undefined,
        preferredProgram: application?.preferredProgram || deal.recommendedProgram || deal.offerPath || undefined,
        offerPath: deal.offerPath || undefined,
      };

      const processorName = (req.body.processorName as string | undefined) || undefined;
      const processor = processorName ? getProcessor(processorName) : getDefaultProcessor();
      const result = await processor.boardMerchant(payload);

      if (!result.success) {
        console.error("[Boarding] Processor submit failed:", result.error);
        return res.status(500).json({ message: safeMessage(result.error, "Failed to submit to processor") });
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        event: "submitted",
        processor: processor.name,
        processorApplicationId: result.processorApplicationId,
        message: result.message,
        estimatedDecisionDate: result.estimatedDecisionDate,
      };

      const existingLog = (deal.boardingLog as any[]) || [];
      await storage.updateDeal(dealId, {
        boardingStatus: "submitted",
        processorApplicationId: result.processorApplicationId,
        boardingSubmittedAt: new Date(),
        boardingLog: [...existingLog, logEntry],
      });

      await storage.createAuditLog({
        action: "deal_submitted_to_processor",
        entityType: "deal",
        entityId: dealId,
        details: {
          processorApplicationId: result.processorApplicationId,
          status: "submitted",
          message: result.message,
        },
      });

      await storage.createTask({
        dealId,
        contactId: deal.contactId || undefined,
        title: `Monitor boarding status for Deal #${dealId} — App ${result.processorApplicationId}`,
        assignedTo: deal.owner || "Scott Stevenson",
        priority: "high",
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        description: `Application ${result.processorApplicationId} submitted to processor. Check status in 24–48 hours.`,
      });

      res.json({
        success: true,
        processorApplicationId: result.processorApplicationId,
        status: "submitted",
        message: result.message,
        estimatedDecisionDate: result.estimatedDecisionDate,
      });
    } catch (err: any) {
      console.error("[Boarding] Submit error:", err.message);
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

      res.json({
        success: true,
        status: result.status,
        mid: result.mid,
        message: result.message,
        moreInfoRequest: result.moreInfoRequest,
        declineReason: result.declineReason,
      });
    } catch (err: any) {
      console.error("[Boarding] Status refresh error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/boarding/refresh-all", isDashboardUser, async (req, res) => {
    try {
      const requestedIds = Array.isArray(req.body?.dealIds)
        ? (req.body.dealIds as any[]).map((id) => Number(id)).filter((id) => !isNaN(id))
        : undefined;

      let targetDealIds: number[];
      if (requestedIds && requestedIds.length > 0) {
        targetDealIds = requestedIds;
      } else {
        const allDealsResult = await storage.getDeals({ limit: 10000 });
        targetDealIds = allDealsResult.data
          .filter((d) => IN_FLIGHT_BOARDING_STATUSES.includes(d.boardingStatus || ""))
          .map((d) => d.id);
      }

      if (targetDealIds.length === 0) {
        return res.json({
          resultState: "no_op_with_reason",
          reason: "No in-flight boarding deals to refresh.",
          attempted: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          results: [],
        });
      }

      const CONCURRENCY = 4;
      const results = await runWithConcurrencyLimit(targetDealIds, CONCURRENCY, performBoardingStatusRefresh);

      const succeeded = results.filter((r) => r.outcome === "success").length;
      const failed = results.filter((r) => r.outcome === "failed").length;
      const skipped = results.filter((r) => r.outcome === "skipped").length;

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

      res.json({
        boardingStatus: deal.boardingStatus || "not_submitted",
        processorApplicationId: deal.processorApplicationId,
        mid: deal.mid,
        boardingLog: deal.boardingLog || [],
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

      const updatedDeal = await storage.updateDeal(dealId, { mid: mid.trim() } as any);

      await storage.createAuditLog({
        action: "mid_assigned",
        entityType: "deal",
        entityId: dealId,
        details: {
          mid: mid.trim(),
          processorName: processorName ?? null,
          status: status ?? "assigned",
          assignedBy: (req.user as any)?.email ?? "admin",
          previousMid: deal.mid ?? null,
        },
      });

      res.json({
        success: true,
        mid: mid.trim(),
        deal: updatedDeal,
      });
    } catch (err: any) {
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
      const result = await db.execute(sql`
        SELECT
          d.id          AS deal_id,
          d.mid,
          d.pipeline,
          d.stage,
          d.owner,
          c.id          AS contact_id,
          c.first_name,
          c.last_name,
          c.company_name,
          c.email,
          d.created_at,
          d.updated_at,
          CASE
            WHEN d.stage IN ('Live', 'Go-Live Scheduled') THEN 'live'
            WHEN d.mid IS NOT NULL AND d.mid != ''         THEN 'assigned'
            ELSE 'pending'
          END AS mid_status
        FROM deals d
        LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.archived_at IS NULL
          AND d.stage NOT IN ('Closed Lost', 'Disqualified')
          AND (
            d.pipeline IN ('Sales', 'Boarding', 'Merchant Boarding')
            OR d.stage IN (
              'Approved', 'Underwriting', 'Underwriting Review', 'Underwriting Submitted',
              'Go-Live Scheduled', 'Live', 'Closed Won'
            )
          )
        ORDER BY
          CASE
            WHEN d.stage IN ('Live', 'Go-Live Scheduled') THEN 1
            WHEN d.mid IS NOT NULL AND d.mid != ''         THEN 2
            ELSE 3
          END,
          d.updated_at DESC
        LIMIT 500
      `);
      res.json({ merchants: result.rows });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/deals/:id/mid-stats", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const days = req.query.days ? Number(req.query.days) : 30;
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      if (!deal.mid) {
        return res.json({ stats: [], mid: null, fetchedAt: null, message: "No MID assigned to this deal" });
      }

      const stats = await storage.getMidDailyStatsByDeal(dealId, days);

      const mostRecent = stats.length > 0 ? stats[0] : null;
      const fetchedAt = mostRecent?.fetchedAt || null;

      res.json({
        stats,
        mid: deal.mid,
        fetchedAt,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/refresh-mid-stats", isDashboardUser, async (req, res) => {
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
      const midProcessorName = midSubmittedEntry?.processor || undefined;
      const midProcessor = midProcessorName ? getProcessor(midProcessorName) : getDefaultProcessor();
      const stats = await midProcessor.getDailyStats(
        deal.mid,
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0]
      );

      let upserted = 0;
      for (const stat of stats) {
        await storage.upsertMidDailyStat({
          mid: deal.mid,
          dealId,
          contactId: deal.contactId || undefined,
          date: stat.date,
          volume: stat.volume,
          txCount: stat.txCount,
          avgTicket: stat.avgTicket,
          effectiveRate: stat.effectiveRate,
          chargebackCount: stat.chargebackCount,
          chargebackAmount: stat.chargebackAmount,
          refundCount: stat.refundCount,
          fetchedAt: new Date(),
        });
        upserted++;
      }

      await storage.createAuditLog({
        action: "mid_stats_refreshed",
        entityType: "deal",
        entityId: dealId,
        details: { mid: deal.mid, daysRefreshed: 30, rowsUpserted: upserted },
      });

      const freshStats = await storage.getMidDailyStatsByDeal(dealId, 30);
      res.json({ success: true, rowsUpserted: upserted, stats: freshStats, mid: deal.mid, fetchedAt: new Date().toISOString() });
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
        mid: string;
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

        summaries[String(deal.id)] = {
          dealId: deal.id,
          mid: deal.mid as string,
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
      const statusFilter = (req.query.status as string | undefined) || undefined;
      const allDealsResult = await storage.getDeals({ limit: 10000 });
      const allDeals = allDealsResult.data;

      const inFlight = allDeals.filter((d) => {
        const s = d.boardingStatus || "not_submitted";
        if (s === "not_submitted") return false;
        if (statusFilter && statusFilter !== "all" && s !== statusFilter) return false;
        return true;
      });

      const contactIds = Array.from(
        new Set(inFlight.map((d) => d.contactId).filter((id): id is number => !!id))
      );
      const contactMap = new Map<number, any>();
      for (const id of contactIds) {
        const c = await storage.getContact(id);
        if (c) contactMap.set(id, c);
      }

      const now = Date.now();
      const submissions = inFlight.map((d) => {
        const contact = d.contactId ? contactMap.get(d.contactId) : null;
        const fullName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
        const merchantName =
          contact?.companyName?.trim() ||
          fullName ||
          contact?.email?.trim() ||
          contact?.phone?.trim() ||
          "Unnamed contact";
        const log = (d.boardingLog as any[]) || [];
        const latestLog = log.length > 0 ? log[log.length - 1] : null;
        const submittedAt = d.boardingSubmittedAt ? new Date(d.boardingSubmittedAt) : null;
        const daysPending = submittedAt
          ? Math.max(0, Math.floor((now - submittedAt.getTime()) / (1000 * 60 * 60 * 24)))
          : null;

        return {
          dealId: d.id,
          contactId: d.contactId,
          merchantName,
          processorApplicationId: d.processorApplicationId,
          boardingStatus: d.boardingStatus || "not_submitted",
          boardingSubmittedAt: d.boardingSubmittedAt,
          boardingApprovedAt: d.boardingApprovedAt,
          daysPending,
          latestLogMessage: latestLog?.message || latestLog?.event || null,
          latestLogTimestamp: latestLog?.timestamp || null,
          mid: d.mid,
          owner: d.owner,
          pipeline: d.pipeline,
          stage: d.stage,
        };
      });

      submissions.sort((a, b) => {
        const at = a.boardingSubmittedAt ? new Date(a.boardingSubmittedAt).getTime() : 0;
        const bt = b.boardingSubmittedAt ? new Date(b.boardingSubmittedAt).getTime() : 0;
        return bt - at;
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

      res.json({ submissions, counts, total: submissions.length });
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
        mid: string;
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
        recentStatsByMid.push({
          mid,
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

          return {
            deal,
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

  app.get("/api/operator/statement-chain", requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 60, 200);
      const failuresOnly = req.query.failuresOnly === "true";
      const all = await storage.getAuditLogs({ limit: limit * 4 });
      const filtered = all
        .filter((l) =>
          failuresOnly
            ? l.action === "statement_chain_partial_failure"
            : l.action === "statement_chain_complete" || l.action === "statement_chain_partial_failure"
        )
        .slice(0, limit);
      res.json(filtered);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
