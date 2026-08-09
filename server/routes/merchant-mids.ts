/**
 * #1404 — MID/TID Master Registry and Boarding Tracking
 *
 * Endpoints:
 *   GET  /api/merchants/:contactId/mids           — list MIDs for a merchant
 *   POST /api/merchants/:contactId/mids           — register a new MID
 *   PATCH /api/merchant-mids/:id                  — update MID status/fields
 *   GET  /api/merchants/:contactId/shipments      — list equipment shipments
 *   POST /api/merchants/:contactId/shipments      — add a shipment record
 *   PATCH /api/equipment-shipments/:id            — update shipment tracking/status
 */

import type { Express } from "express";
import { db } from "../db";
import { merchantMids, equipmentShipments, deals } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";

export function registerMerchantMidRoutes(app: Express) {
  // ── MID Registry ─────────────────────────────────────────────────────────────

  // GET /api/merchants/:contactId/mids
  app.get(
    "/api/merchants/:contactId/mids",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const contactId = parseInt(String(req.params.contactId), 10);
        if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });
        const rows = await db.select().from(merchantMids).where(eq(merchantMids.contactId, contactId));
        res.json({ mids: rows });
      } catch (err: any) { serverError(res, err); }
    }
  );

  // POST /api/merchants/:contactId/mids
  app.post(
    "/api/merchants/:contactId/mids",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const contactId = parseInt(String(req.params.contactId), 10);
        if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

        const { mid, tids, dealId, processorName, monthlyVolumeCap, notes } = req.body as {
          mid?: string;
          tids?: string[];
          dealId?: number | null;
          processorName?: string;
          monthlyVolumeCap?: number | null;
          notes?: string | null;
        };

        if (!mid) return res.status(400).json({ message: "mid is required" });

        const [row] = await db
          .insert(merchantMids)
          .values({
            contactId,
            dealId: dealId ?? null,
            mid,
            tids: Array.isArray(tids) ? tids : [],
            processorName: processorName ?? "payarc",
            monthlyVolumeCap: monthlyVolumeCap != null ? String(monthlyVolumeCap) : null,
            notes: notes ?? null,
          })
          .onConflictDoNothing()
          .returning();

        if (!row) return res.status(409).json({ message: "MID already registered" });
        res.status(201).json(row);
      } catch (err: any) { serverError(res, err); }
    }
  );

  // PATCH /api/merchant-mids/:id
  app.patch(
    "/api/merchant-mids/:id",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

        const allowedStatuses = ["assigned", "active", "suspended", "closed"];
        const { status, tids, monthlyVolumeCap, notes, suspensionReason } = req.body as {
          status?: string;
          tids?: string[];
          monthlyVolumeCap?: number | null;
          notes?: string | null;
          suspensionReason?: string | null;
        };

        if (status && !allowedStatuses.includes(status)) {
          return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(", ")}` });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (status !== undefined) {
          updates.status = status;
          if (status === "active")    updates.activatedAt  = new Date();
          if (status === "suspended") updates.suspendedAt  = new Date();
          if (status === "closed")    updates.closedAt     = new Date();
        }
        if (tids !== undefined) updates.tids = tids;
        if (monthlyVolumeCap !== undefined) updates.monthlyVolumeCap = monthlyVolumeCap != null ? String(monthlyVolumeCap) : null;
        if (notes !== undefined) updates.notes = notes;
        if (suspensionReason !== undefined) updates.suspensionReason = suspensionReason;

        const [updated] = await db
          .update(merchantMids)
          .set(updates as any)
          .where(eq(merchantMids.id, id))
          .returning();

        if (!updated) return res.status(404).json({ message: "MID record not found" });
        res.json(updated);
      } catch (err: any) { serverError(res, err); }
    }
  );

  // ── Equipment Shipments ───────────────────────────────────────────────────────

  // GET /api/merchants/:contactId/shipments
  app.get(
    "/api/merchants/:contactId/shipments",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const contactId = parseInt(String(req.params.contactId), 10);
        if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });
        const rows = await db
          .select()
          .from(equipmentShipments)
          .where(eq(equipmentShipments.contactId, contactId))
          .orderBy(equipmentShipments.createdAt);
        res.json({ shipments: rows });
      } catch (err: any) { serverError(res, err); }
    }
  );

  // POST /api/merchants/:contactId/shipments
  app.post(
    "/api/merchants/:contactId/shipments",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const contactId = parseInt(String(req.params.contactId), 10);
        if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

        const { dealId, carrier, trackingNumber, estimatedDelivery, notes, equipmentOrderId } = req.body as {
          dealId?: number | null;
          carrier?: string | null;
          trackingNumber?: string | null;
          estimatedDelivery?: string | null;
          notes?: string | null;
          equipmentOrderId?: number | null;
        };

        const [row] = await db
          .insert(equipmentShipments)
          .values({
            contactId,
            dealId: dealId ?? null,
            equipmentOrderId: equipmentOrderId ?? null,
            carrier: carrier ?? null,
            trackingNumber: trackingNumber ?? null,
            estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
            notes: notes ?? null,
          })
          .returning();

        res.status(201).json(row);
      } catch (err: any) { serverError(res, err); }
    }
  );

  // PATCH /api/equipment-shipments/:id
  app.patch(
    "/api/equipment-shipments/:id",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

        const allowedStatuses = ["pending", "shipped", "delivered", "returned"];
        const { status, carrier, trackingNumber, estimatedDelivery, notes } = req.body as {
          status?: string;
          carrier?: string | null;
          trackingNumber?: string | null;
          estimatedDelivery?: string | null;
          notes?: string | null;
        };

        if (status && !allowedStatuses.includes(status)) {
          return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(", ")}` });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (status !== undefined) {
          updates.status = status;
          if (status === "shipped")   updates.shippedAt   = new Date();
          if (status === "delivered") updates.deliveredAt = new Date();
        }
        if (carrier !== undefined)           updates.carrier = carrier;
        if (trackingNumber !== undefined)     updates.trackingNumber = trackingNumber;
        if (estimatedDelivery !== undefined)  updates.estimatedDelivery = estimatedDelivery ? new Date(estimatedDelivery) : null;
        if (notes !== undefined)              updates.notes = notes;

        const [updated] = await db
          .update(equipmentShipments)
          .set(updates as any)
          .where(eq(equipmentShipments.id, id))
          .returning();

        if (!updated) return res.status(404).json({ message: "Shipment record not found" });
        res.json(updated);
      } catch (err: any) { serverError(res, err); }
    }
  );
}
