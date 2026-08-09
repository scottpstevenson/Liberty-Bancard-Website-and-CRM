/**
 * #1403 — Underwriting Orchestration: Conditional Approval Checklist
 *
 * Endpoints:
 *   GET  /api/underwriting/deals/:id/conditions       — list conditions for a deal
 *   POST /api/underwriting/deals/:id/conditions       — add a condition
 *   PATCH /api/underwriting/conditions/:id            — update condition status/notes
 *   DELETE /api/underwriting/conditions/:id           — remove a condition (admin only)
 */

import type { Express } from "express";
import { db } from "../db";
import { underwritingConditions, deals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";

export function registerUnderwritingConditionRoutes(app: Express) {
  // GET /api/underwriting/deals/:id/conditions
  app.get(
    "/api/underwriting/deals/:id/conditions",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseInt(String(req.params.id), 10);
        if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });

        const rows = await db
          .select()
          .from(underwritingConditions)
          .where(eq(underwritingConditions.dealId, dealId))
          .orderBy(underwritingConditions.createdAt);

        res.json({ conditions: rows });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/underwriting/deals/:id/conditions
  app.post(
    "/api/underwriting/deals/:id/conditions",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseInt(String(req.params.id), 10);
        if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });

        const { conditionType, description, merchantVisible, dueDate, decisionId, notes } = req.body as {
          conditionType?: string;
          description?: string;
          merchantVisible?: boolean;
          dueDate?: string | null;
          decisionId?: number | null;
          notes?: string | null;
        };

        if (!conditionType || !description) {
          return res.status(400).json({ message: "conditionType and description are required" });
        }

        // Verify deal exists
        const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
        if (!deal) return res.status(404).json({ message: "Deal not found" });

        const userId = (req.user as any)?.id ?? null;
        const [row] = await db
          .insert(underwritingConditions)
          .values({
            dealId,
            decisionId: decisionId ?? null,
            conditionType,
            description,
            merchantVisible: merchantVisible !== false,
            dueDate: dueDate ? new Date(dueDate) : null,
            notes: notes ?? null,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning();

        res.status(201).json(row);
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // PATCH /api/underwriting/conditions/:id
  app.patch(
    "/api/underwriting/conditions/:id",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid condition ID" });

        const userId = (req.user as any)?.id ?? null;
        const allowedStatuses = ["pending", "submitted", "approved", "waived"];
        const { status, notes, waivedReason, dueDate } = req.body as {
          status?: string;
          notes?: string | null;
          waivedReason?: string | null;
          dueDate?: string | null;
        };

        if (status && !allowedStatuses.includes(status)) {
          return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(", ")}` });
        }

        const updates: Partial<typeof underwritingConditions.$inferInsert> = {
          updatedBy: userId,
          updatedAt: new Date(),
        };
        if (status !== undefined) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (waivedReason !== undefined) updates.waivedReason = waivedReason;
        if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

        // Set timestamp fields based on status transitions
        if (status === "submitted") updates.submittedAt = new Date();
        if (status === "approved")  updates.approvedAt  = new Date();
        if (status === "waived")    updates.waivedAt    = new Date();

        const [updated] = await db
          .update(underwritingConditions)
          .set(updates)
          .where(eq(underwritingConditions.id, id))
          .returning();

        if (!updated) return res.status(404).json({ message: "Condition not found" });
        res.json(updated);
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // DELETE /api/underwriting/conditions/:id
  app.delete(
    "/api/underwriting/conditions/:id",
    isAuthenticated,
    requireRole("admin"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid condition ID" });

        const [deleted] = await db
          .delete(underwritingConditions)
          .where(eq(underwritingConditions.id, id))
          .returning({ id: underwritingConditions.id });

        if (!deleted) return res.status(404).json({ message: "Condition not found" });
        res.json({ deleted: true });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );
}
