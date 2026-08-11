/**
 * #1407 — Churn/Save Desk Automation
 *
 * Endpoints:
 *   GET  /api/save-cases                — list open save cases (admin/manager)
 *   GET  /api/save-cases/:id            — get a single save case
 *   PATCH /api/save-cases/:id           — update outcome / advance playbook
 *   POST /api/save-cases/:id/advance    — advance to next playbook day
 */

import type { Express } from "express";
import { db } from "../db";
import { saveCases, contacts, deals } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";

export function registerSaveCaseRoutes(app: Express) {
  // GET /api/save-cases
  app.get(
    "/api/save-cases",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const statusFilter = (req.query.status as string) ?? "open";
        const contactIdFilter = req.query.contactId ? parseInt(String(req.query.contactId), 10) : undefined;

        const whereConditions = [
          ...(statusFilter !== "all" ? [eq(saveCases.status, statusFilter)] : []),
          ...(contactIdFilter && !isNaN(contactIdFilter) ? [eq(saveCases.contactId, contactIdFilter)] : []),
        ];

        const rows = await db
          .select({
            case: saveCases,
            contactFirstName: contacts.firstName,
            contactLastName:  contacts.lastName,
            contactEmail:     contacts.email,
          })
          .from(saveCases)
          .leftJoin(contacts, eq(saveCases.contactId, contacts.id))
          .where(whereConditions.length > 0 ? and(...(whereConditions as any)) : undefined)
          .orderBy(desc(saveCases.createdAt))
          .limit(200);

        res.json({
          cases: rows.map(r => ({
            ...r.case,
            contact: {
              firstName: r.contactFirstName,
              lastName:  r.contactLastName,
              email:     r.contactEmail,
            },
          })),
        });
      } catch (err: any) { serverError(res, err); }
    }
  );

  // GET /api/save-cases/:id
  app.get(
    "/api/save-cases/:id",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
        const [row] = await db.select().from(saveCases).where(eq(saveCases.id, id)).limit(1);
        if (!row) return res.status(404).json({ message: "Save case not found" });
        res.json(row);
      } catch (err: any) { serverError(res, err); }
    }
  );

  // PATCH /api/save-cases/:id — log outcome, assign rep, etc.
  app.patch(
    "/api/save-cases/:id",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

        const allowedStatuses  = ["open", "retained", "churned", "escalated", "closed"];
        const allowedOutcomes  = ["retained", "churned", "transferred", "pending"];
        const { status, outcome, outcomeNotes, assignedTo, playbookDay, escalationLevel } = req.body as {
          status?: string;
          outcome?: string;
          outcomeNotes?: string | null;
          assignedTo?: string | null;
          playbookDay?: number;
          escalationLevel?: number;
        };

        if (status && !allowedStatuses.includes(status)) {
          return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(", ")}` });
        }
        if (outcome && !allowedOutcomes.includes(outcome)) {
          return res.status(400).json({ message: `outcome must be one of: ${allowedOutcomes.join(", ")}` });
        }

        const updates: Record<string, unknown> = {
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };
        if (status !== undefined) {
          updates.status = status;
          if (status === "retained" || status === "churned" || status === "closed") {
            updates.resolvedAt = new Date();
          }
        }
        if (outcome !== undefined)       updates.outcome       = outcome;
        if (outcomeNotes !== undefined)  updates.outcomeNotes  = outcomeNotes;
        if (assignedTo !== undefined)    updates.assignedTo    = assignedTo;
        if (playbookDay !== undefined)   updates.playbookDay   = playbookDay;
        if (escalationLevel !== undefined) updates.escalationLevel = escalationLevel;

        const [updated] = await db
          .update(saveCases)
          .set(updates as any)
          .where(eq(saveCases.id, id))
          .returning();

        if (!updated) return res.status(404).json({ message: "Save case not found" });
        res.json(updated);
      } catch (err: any) { serverError(res, err); }
    }
  );

  // POST /api/save-cases/:id/advance — advance playbook day and fire day-2/day-5/day-10 automations
  app.post(
    "/api/save-cases/:id/advance",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

        const [sc] = await db.select().from(saveCases).where(eq(saveCases.id, id)).limit(1);
        if (!sc) return res.status(404).json({ message: "Save case not found" });
        if (sc.status !== "open") return res.status(409).json({ message: "Cannot advance a closed save case" });

        const newDay = (sc.playbookDay ?? 0) + 1;
        const patches: Record<string, unknown> = {
          playbookDay: newDay,
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        // Day-2: value-reminder email flag
        if (newDay >= 2 && !sc.day2EmailSent)   patches.day2EmailSent = true;
        // Day-5: manager notification flag
        if (newDay >= 5 && !sc.day5ManagerNotified) {
          patches.day5ManagerNotified = true;
          patches.escalationLevel = Math.max(sc.escalationLevel ?? 0, 1);
        }
        // Day-10: executive escalation flag
        if (newDay >= 10 && !sc.day10ExecNotified) {
          patches.day10ExecNotified = true;
          patches.escalationLevel = Math.max(sc.escalationLevel ?? 0, 2);
        }

        const [updated] = await db
          .update(saveCases)
          .set(patches as any)
          .where(eq(saveCases.id, id))
          .returning();

        res.json({ updated, playbookDay: newDay });
      } catch (err: any) { serverError(res, err); }
    }
  );
}
