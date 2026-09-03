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
import { createMerchantMid, MerchantMidTransitionError, updateMerchantMid, writeMidAccessReceipt } from "../services/merchant-mid-service";

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
        // REV-05A: Write access receipt for each MID returned — awaited, durable before response.
        const userId = String((req.user as any)?.id ?? "");
        await Promise.all(rows.map((row) =>
          writeMidAccessReceipt({ midId: row.id, contactId, userId, endpoint: req.path, purpose: "list_mids" })
        ));
        // REV-05A: Mask MID in list response; full MID via dedicated receipted endpoint only.
        const { maskMid: _maskMidList } = await import("../utils/mask-mid");
        const maskedRows = rows.map((row) => {
          const { mid: _rawMid, ...rowWithoutMid } = row;
          return {
            ...rowWithoutMid,
            midMasked: _maskMidList(row.mid),
            hasMid: !!row.mid,
          };
        });
        res.json({ mids: maskedRows });
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

        const row = await createMerchantMid({
          contactId, dealId: dealId ?? null, mid, tids: Array.isArray(tids) ? tids : [],
          processorName, monthlyVolumeCap: monthlyVolumeCap != null ? String(monthlyVolumeCap) : null,
          notes, actorId: String((req.user as any)?.id ?? ""), actorType: "user",
        });
        // REV-05A: Mask MID in create response; write access receipt.
        const userId = String((req.user as any)?.id ?? "");
        await writeMidAccessReceipt({ midId: row.id, contactId, userId, endpoint: req.path, purpose: "mid_create" });
        const { mid: _rawMidCreate, ...rowWithoutMidCreate } = row;
        const { maskMid: _maskMidCreate } = await import("../utils/mask-mid");
        res.status(201).json({
          ...rowWithoutMidCreate,
          midMasked: _maskMidCreate(row.mid),
          hasMid: !!row.mid,
        });
      } catch (err: any) {
        if (err instanceof MerchantMidTransitionError) return res.status(422).json({ code: err.code, message: err.message });
        if (err?.code === "23505") return res.status(409).json({ message: "MID already registered" });
        serverError(res, err);
      }
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

        const { status, tids, monthlyVolumeCap, notes, suspensionReason } = req.body as {
          status?: string;
          tids?: string[];
          monthlyVolumeCap?: number | null;
          notes?: string | null;
          suspensionReason?: string | null;
        };

        const updated = await updateMerchantMid({
          id, status, tids, monthlyVolumeCap: monthlyVolumeCap != null ? String(monthlyVolumeCap) : monthlyVolumeCap,
          notes, suspensionReason, actorId: String((req.user as any)?.id ?? ""), actorType: "user",
        });
        // REV-05A: Mask MID in update response.
        const userId = String((req.user as any)?.id ?? "");
        await writeMidAccessReceipt({ midId: updated.id, contactId: updated.contactId ?? 0, userId, endpoint: req.path, purpose: "mid_update" });
        const { mid: _rawMidUpdate, ...updatedWithoutMid } = updated;
        const { maskMid: _maskMidUpdate } = await import("../utils/mask-mid");
        res.json({
          ...updatedWithoutMid,
          midMasked: _maskMidUpdate(updated.mid),
          hasMid: !!updated.mid,
        });
      } catch (err: any) {
        if (err instanceof MerchantMidTransitionError) return res.status(err.code === "MID_NOT_FOUND" ? 404 : 422).json({ code: err.code, message: err.message });
        serverError(res, err);
      }
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
