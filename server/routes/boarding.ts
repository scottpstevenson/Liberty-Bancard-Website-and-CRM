import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import {
  submitMerchantToProcessor,
  checkBoardingStatus,
  fetchMidDailyStats,
  ingestMidDataForActiveMids,
} from "../services/processor-api";

export function registerBoardingRoutes(app: Express) {
  app.post("/api/deals/:id/submit-to-processor", isAuthenticated, async (req, res) => {
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

      const result = await submitMerchantToProcessor(payload);

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to submit to processor" });
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        event: "submitted",
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/refresh-boarding-status", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.processorApplicationId) {
        return res.status(400).json({ message: "No processor application ID on this deal. Submit first." });
      }

      const result = await checkBoardingStatus(deal.processorApplicationId);

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to check boarding status" });
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

      await storage.createAuditLog({
        action: "boarding_status_refreshed",
        entityType: "deal",
        entityId: dealId,
        details: { status: result.status, mid: result.mid, message: result.message },
      });

      if (result.status === "more_info_needed" && result.moreInfoRequest) {
        const existingTasks = await storage.getTasks();
        const hasInfoTask = existingTasks.some(
          t => t.dealId === dealId && t.title?.includes("More Info Required") && t.status === "pending"
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
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/deals/:id/boarding-status", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/deals/:id/mid-stats", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/refresh-mid-stats", isAuthenticated, async (req, res) => {
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

      const stats = await fetchMidDailyStats(
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/run-mid-ingestion", isAuthenticated, async (req, res) => {
    try {
      const result = await ingestMidDataForActiveMids();
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/mid-stats/summary", isAuthenticated, async (req, res) => {
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
          latestVolume: latest?.volume ?? null,
          latestTxCount: latest?.txCount ?? null,
          latestAvgTicket: latest?.avgTicket ?? null,
          latestEffectiveRate: latest?.effectiveRate ?? null,
          latestChargebackCount: latest?.chargebackCount ?? null,
          fetchedAt: latest?.fetchedAt ? new Date(latest.fetchedAt).toISOString() : null,
          merchantName: deal?.name ?? null,
        });
      }

      res.json({
        stats: recentStatsByMid,
        latestFetch: overallLatestFetch ? overallLatestFetch.toISOString() : null,
        totalMids: uniqueMids.length,
        activeMids: recentStatsByMid.filter((s) => s.latestDate !== null).length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
