import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { merchantApplications, dealBoardingOutbox, deals } from "@shared/schema";
import { getProcessor, getDefaultProcessor, getEnabledAdapterNames, ingestMidDataForActiveMids } from "../services/processors/registry";
import { serverError, safeMessage } from "../utils/server-error";
import { startDealBoardingOutboxWorker } from "../services/deal-boarding-outbox-worker";
import { auditChange } from "../services/audit-change";
import { advanceDealStage } from "../services/deal-stage-service";
import crypto from "crypto";

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

    }

    await storage.updateDeal(dealId, updates);
    if (result.status === "approved" && deal.pipeline === "onboarding") {
      await advanceDealStage(dealId, "Approved", "boarding_status_refresh", {
        reason: "Processor boarding status approved",
        actor: "system",
        expectedStage: deal.stage,
      });
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
  // Start the durable boarding outbox worker exactly once (unref'd timer inside).
  startDealBoardingOutboxWorker();

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

      const isUnderwriting =
        deal.pipeline === "onboarding" ||
        (deal.stage ?? "").toLowerCase().includes("underwriting") ||
        (deal.stage ?? "").toLowerCase().includes("approved");
      if (!isUnderwriting) {
        return res.status(400).json({
          message: "Deal must be in the onboarding pipeline or an underwriting/approved stage before submitting to the processor.",
        });
      }

      // Require an application explicitly linked to THIS deal via deal_id.
      // Contact-id fallback is intentionally removed: it could silently select
      // a different application for the same contact (different deal), disclosing
      // another merchant's protected financial/identity data to the processor.
      // Pre-check before entering the transaction (no lock yet — definitive
      // binding happens inside the TX below).
      const appRows = await db
        .select({ id: merchantApplications.id })
        .from(merchantApplications)
        .where(eq(merchantApplications.dealId, dealId))
        .limit(1);
      if (!appRows.length) {
        return res.status(409).json({ message: "No merchant application linked to this deal. Complete application before boarding." });
      }
      const applicationId = appRows[0].id;

      // Idempotent replay: same key returns queued/submitted status immediately.
      const [existing] = await db
        .select({ id: dealBoardingOutbox.id, status: dealBoardingOutbox.status })
        .from(dealBoardingOutbox)
        .where(eq(dealBoardingOutbox.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        return res.status(202).json({ status: "queued", message: "Submission already enqueued", outboxId: existing.id });
      }

      const processorName = (req.body.processorName as string | undefined) || undefined;

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
        await tx
          .insert(dealBoardingOutbox)
          .values({
            dealId,
            applicationId,
            eventType: "processor_submit",
            processorName: processorName ?? null,
            idempotencyKey,
            // providerIdempotencyKey and applicationLinkageVersion stored in
            // payload — never exposed in logs/responses.
            payload: { dealId, applicationId, providerIdempotencyKey, applicationLinkageVersion },
            status: "pending",
          })
          .onConflictDoNothing({ target: dealBoardingOutbox.idempotencyKey });

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

      return res.status(202).json({ status: "queued", message: "Processor submission queued for durable processing" });
    } catch (err: any) {
      // A re-linked application detected inside the TX throws "boarding_application_relinked".
      // Treat it as a 409 conflict, not a 500.
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
