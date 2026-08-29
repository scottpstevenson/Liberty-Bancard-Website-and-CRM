/**
 * Inbox Ownership Routes — extends AI inbox with routing/ownership metadata.
 *
 * PATCH /api/inbox/items/:id/ownership  — assign owner, dept, status, priority
 * POST  /api/inbox/items/:id/escalate   — escalate to Scott
 * GET   /api/inbox/staff                — list staff users for assignment dropdown
 * POST  /api/inbox/items/:id/book-appointment — enhanced booking with personalized link + tasks
 * POST  /api/inbox/items/:id/no-show    — mark no-show, create reschedule task
 */
import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { upsertInboxItem, getInboxItem, updateInboxItem } from "../storage/inbox";
import { serverError } from "../utils/server-error";
import { authorizeDealAccess, authorizeInboxItemAccess } from "../services/crm-object-access";

const DEPARTMENT_SLA_HOURS: Record<string, number> = {
  sales: 4,
  support: 2,
  onboarding: 8,
  accounts: 24,
};

function computeSlaDueAt(department: string): Date {
  const hours = DEPARTMENT_SLA_HOURS[department] ?? 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function registerInboxOwnershipRoutes(app: Express) {
  // GET /api/inbox/staff — list CRM staff for assignment dropdown
  app.get("/api/inbox/staff", isDashboardUser, async (req, res) => {
    try {
      const staff = await storage.getUsersByRole(["admin", "manager", "agent"]);
      res.json(staff);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/inbox/items/:id/ownership — get ownership record for an inbox item
  app.get("/api/inbox/items/:id/ownership", isDashboardUser, async (req, res) => {
    try {
      if (!await authorizeInboxItemAccess(req, res, String(req.params.id))) return;
      const item = await getInboxItem(String(req.params.id));
      if (!item) return;
      res.json(item);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH /api/inbox/items/:id/ownership — assign owner, dept, status, priority
  app.patch(
    "/api/inbox/items/:id/ownership",
    requireRole("admin", "manager", "agent"),
    async (req, res) => {
      try {
        const itemId = String(req.params.id);
        const user = req.user as any;
        const userId = String(user?.id || "");

        const schema = z.object({
          ownerId: z.string().optional(),
          ownerName: z.string().optional(),
          department: z.enum(["sales", "support", "onboarding", "accounts"]).optional(),
          status: z.enum(["new", "in_progress", "waiting", "resolved", "escalated"]).optional(),
          priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
          contactId: z.number().optional(),
          dealId: z.number().optional(),
          nextAction: z.string().optional(),
          notes: z.string().optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.errors[0].message });
        }

        const existing = await getInboxItem(itemId);
        const resolved = await authorizeInboxItemAccess(req, res, itemId, { exactAssignment: true });
        if (!resolved) return;
        const resolvedContactId = resolved.contact.id;
        if (parsed.data.dealId !== undefined) {
          const deal = await authorizeDealAccess(req, res, parsed.data.dealId, { exactAssignment: true });
          if (!deal) return;
          if (deal.contactId !== resolvedContactId) {
            return res.status(409).json({ message: "Deal does not belong to the inbox item's contact" });
          }
        }

        const department = parsed.data.department || existing?.department || "sales";
        const slaDueAt = existing?.slaDueAt ?? computeSlaDueAt(department);

        const updated = await upsertInboxItem({
          sourceItemId: itemId,
          sourceItemType: existing?.sourceItemType || "email",
          ...existing ? {} : { dealId: parsed.data.dealId },
          contactId: resolvedContactId,
          ...(parsed.data.dealId !== undefined && { dealId: parsed.data.dealId }),
          ownerId: parsed.data.ownerId ?? existing?.ownerId ?? null,
          ownerName: parsed.data.ownerName ?? existing?.ownerName ?? null,
          department,
          status: parsed.data.status ?? existing?.status ?? "new",
          priority: parsed.data.priority ?? existing?.priority ?? "normal",
          slaDueAt,
          nextAction: parsed.data.nextAction ?? existing?.nextAction ?? null,
          notes: parsed.data.notes ?? existing?.notes ?? null,
        });

        await storage.createAuditLog({
          userId,
          action: "inbox_item_ownership_updated",
          entityType: "inbox_item",
          entityId: updated.id,
          actorType: "user",
          actorId: userId,
          details: {
            sourceItemId: itemId,
            ownerId: parsed.data.ownerId,
            ownerName: parsed.data.ownerName,
            department: parsed.data.department,
            status: parsed.data.status,
            priority: parsed.data.priority,
          },
        });

        res.json(updated);
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/inbox/items/:id/escalate — escalate to Scott
  app.post(
    "/api/inbox/items/:id/escalate",
    requireRole("admin", "manager", "agent"),
    async (req, res) => {
      try {
        const itemId = String(req.params.id);
        const user = req.user as any;
        const userId = String(user?.id || "");
        const { contactId, intent, reason } = req.body as {
          contactId?: number;
          intent?: string;
          reason?: string;
        };

        const existing = await getInboxItem(itemId);
        const resolved = await authorizeInboxItemAccess(req, res, itemId, { exactAssignment: true });
        if (!resolved) return;
        const resolvedContactId = resolved.contact.id;

        // Set priority=urgent, owner=Scott, status=escalated
        const SCOTT_NAME = "Scott Stevenson";
        const updated = await upsertInboxItem({
          sourceItemId: itemId,
          sourceItemType: existing?.sourceItemType || "email",
          contactId: resolvedContactId,
          dealId: existing?.dealId ?? null,
          ownerId: "scott",
          ownerName: SCOTT_NAME,
          department: existing?.department || "sales",
          status: "escalated",
          priority: "urgent",
          slaDueAt: existing?.slaDueAt ?? computeSlaDueAt("sales"),
          escalationPath: reason || `Escalated by ${user?.firstName || "rep"}: intent=${intent || "unknown"}`,
          nextAction: "escalated_to_scott",
          notes: existing?.notes ?? null,
        });

        // Create escalation task
        if (resolvedContactId) {
          await storage.createAuthorityTask({
            title: `🚨 Escalated to Scott — Review Required`,
            description: `AI Inbox item ${itemId} escalated. Intent: ${intent || "unknown"}. Reason: ${reason || "Manual escalation"}. Review and respond ASAP.`,
            contactId: resolvedContactId,
            status: "pending",
            priority: "high",
            dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h SLA
            assignedTo: SCOTT_NAME,
            source: "ai_inbox",
            automationKey: `inbox_escalate_${itemId}`,
          });
        }

        // Send internal notification
        storage.createNotification({
          channel: "internal",
          title: "⚠️ Inbox Escalation — Scott Review Required",
          message: `Inbox item ${itemId} escalated to Scott (priority=urgent). Contact: #${resolvedContactId}. Intent: ${intent || "unknown"}.`,
          type: "urgent",
          metadata: { sourceItemId: itemId, contactId: resolvedContactId, intent, escalationReason: reason },
        } as any).catch(() => {});

        await storage.createAuditLog({
          userId,
          action: "inbox_item_escalated_to_scott",
          entityType: "inbox_item",
          entityId: updated.id,
          actorType: "user",
          actorId: userId,
          details: { sourceItemId: itemId, contactId: resolvedContactId, intent, reason },
        });

        res.json({ ok: true, item: updated });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/inbox/items/:id/book-appointment — enhanced appointment booking
  app.post(
    "/api/inbox/items/:id/book-appointment",
    requireRole("admin", "manager", "agent"),
    async (req, res) => {
      try {
        const itemId = String(req.params.id);
        const resolved = await authorizeInboxItemAccess(req, res, itemId, { exactAssignment: true });
        if (!resolved) return;
        const resolvedContactId = resolved.contact.id;
        const user = req.user as any;
        const userId = String(user?.id || "");

        const { intent } = req.body as { intent?: string };
        const contactName = [resolved.contact.firstName, resolved.contact.lastName].filter(Boolean).join(" ") || resolved.contact.email || "Contact";
        const contactEmail = resolved.contact.email || "";
        const companyName = resolved.contact.companyName || "";

        const calendarId = process.env.GHL_CALENDAR_ID;

        let bookingUrl: string;
        let taskTitle: string;
        let taskDescription: string;

        if (calendarId) {
          // Personalized booking link with contact pre-fill
          const baseUrl = `https://api.leadconnectorhq.com/widget/booking/${calendarId}`;
          const params = new URLSearchParams();
          if (contactName) params.set("name", contactName);
          if (contactEmail) params.set("email", contactEmail);
          bookingUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;

          taskTitle = `Confirm booking — ${contactName || companyName || "Contact"}`;
          taskDescription = `Booking link sent via AI Inbox. Confirm appointment is booked and set up reminders. Booking URL: ${bookingUrl}`;
        } else {
          bookingUrl =
            process.env.GHL_CALENDAR_BOOKING_URL ||
            "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr";

          taskTitle = `Book appointment for ${contactName || companyName || "Contact"}`;
          taskDescription = `AI Inbox: manual booking required. Intent: ${intent || "meeting_intent"}. Contact ID: ${resolvedContactId}. Use booking link: ${bookingUrl}`;
        }

        const assignedTo = user?.firstName
          ? `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Scott Stevenson"
          : "Scott Stevenson";

        // Create "Confirm booking" task
        if (resolvedContactId) {
          await storage.createAuthorityTask({
            title: taskTitle,
            description: taskDescription,
            contactId: resolvedContactId,
            status: "pending",
            priority: "high",
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
            assignedTo,
            source: "ai_inbox",
            automationKey: `inbox_book_${itemId}`,
          });
        }

        await storage.createAuditLog({
          userId,
          action: "inbox_book_appointment",
          entityType: "inbox_item",
          entityId: 0,
          actorType: "user",
          actorId: userId,
          details: {
            sourceItemId: itemId,
            contactId: resolvedContactId,
            calendarId: calendarId || null,
            bookingUrl,
            hasCalendar: !!calendarId,
          },
        });

        res.json({ ok: true, bookingUrl, hasCalendar: !!calendarId, taskCreated: true });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/inbox/items/:id/no-show — mark no-show, create reschedule task
  app.post(
    "/api/inbox/items/:id/no-show",
    requireRole("admin", "manager", "agent"),
    async (req, res) => {
      try {
        const itemId = String(req.params.id);
        const resolved = await authorizeInboxItemAccess(req, res, itemId, { exactAssignment: true });
        if (!resolved) return;
        const resolvedContactId = resolved.contact.id;
        const user = req.user as any;
        const userId = String(user?.id || "");
        // An Inbox item is authoritative for its contact, not a client-supplied
        // merchant ID. This route intentionally does not mutate SDR lead state
        // until a reviewed server-side contact→merchant mapping exists.

        // Persist the state only after the server resolved the Inbox item to its
        // owning contact. Aggregated feed entries may not yet have metadata.
        const updatedItem = await updateInboxItem(itemId, { status: "waiting", nextAction: "reschedule_appointment" });
        if (!updatedItem) {
          await upsertInboxItem({
            sourceItemId: itemId,
            sourceItemType: resolved.channel || "email",
            contactId: resolvedContactId,
            status: "waiting",
            nextAction: "reschedule_appointment",
          });
        }

        // Create reschedule task
        const calendarId = process.env.GHL_CALENDAR_ID;
        const bookingUrl = calendarId
          ? `https://api.leadconnectorhq.com/widget/booking/${calendarId}`
          : process.env.GHL_CALENDAR_BOOKING_URL || "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr";

        if (resolvedContactId) {
          await storage.createAuthorityTask({
            title: `Reschedule appointment — No-Show`,
            description: `Contact did not show for scheduled appointment. Send reschedule link: ${bookingUrl}`,
            contactId: resolvedContactId,
            status: "pending",
            priority: "high",
            dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h
            assignedTo: user?.firstName
              ? `${user.firstName} ${user.lastName || ""}`.trim()
              : "Scott Stevenson",
            source: "ai_inbox",
            automationKey: `inbox_noshow_reschedule_${itemId}`,
          });
        }

        await storage.createAuditLog({
          userId,
          action: "inbox_appointment_no_show",
          entityType: "inbox_item",
          entityId: 0,
          actorType: "user",
          actorId: userId,
          details: { sourceItemId: itemId, contactId: resolvedContactId, bookingUrl },
        });

        res.json({ ok: true, rescheduleDraft: `Here's our booking link to reschedule at your convenience: ${bookingUrl}` });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/inbox/sla-check — check for SLA breaches and send notifications (called by scheduler)
  app.post("/api/inbox/sla-check", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { getInboxItemsWithSlaBreaches } = await import("../storage/inbox");
      const breaches = await getInboxItemsWithSlaBreaches();

      for (const item of breaches) {
        storage.createNotification({
          channel: "internal",
          title: "⏰ Inbox SLA Breach",
          message: `Inbox item ${item.sourceItemId} (${item.department} / ${item.priority}) has breached its SLA. Status: ${item.status}.`,
          type: "urgent",
          metadata: { sourceItemId: item.sourceItemId, contactId: item.contactId, department: item.department },
        } as any).catch(() => {});

        // Mark the item as escalated if not already
        if (item.status !== "escalated") {
          await updateInboxItem(item.sourceItemId, { status: "escalated", priority: "urgent" });
        }
      }

      await storage.createAuditLog({
        action: "inbox_sla_check_ran",
        entityType: "inbox_item",
        entityId: 0,
        actorType: "system",
        details: { breachCount: breaches.length, itemIds: breaches.map((b) => b.sourceItemId) },
      });

      res.json({ breaches: breaches.length, itemIds: breaches.map((b) => b.sourceItemId) });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
