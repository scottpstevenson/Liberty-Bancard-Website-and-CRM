import type { Express } from "express";
import { isDashboardUser } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertTaskSchema, insertTicketCommentSchema, insertTicketSchema } from "@shared/schema";
import { normalizeTaskCompletionState } from "../services/task-normalization";
import { createPreferenceAwareNotification } from "../services/digest-service";
import { serverError } from "../utils/server-error";
import { authorizeContactAccess, authorizeDealAccess, denyCrmObject } from "../services/crm-object-access";
import { legacyTaskStatusToAuthorityState } from "../storage/tasks";

const updateTicketSchema = insertTicketSchema.partial().extend({
  slaDeadline: z.coerce.date().optional().nullable(),
  firstResponseAt: z.coerce.date().optional().nullable(),
  resolvedAt: z.coerce.date().optional().nullable(),
});

const updateTaskSchema = insertTaskSchema.partial().extend({
  dueDate: z.coerce.date().optional().nullable(),
  completedAt: z.coerce.date().optional().nullable(),
});

function legacyTicketStatusToAuthorityState(status: string | null | undefined): "open" | "in_progress" | "completed" | "cancelled" {
  switch ((status ?? "").toLowerCase()) {
    case "in progress": return "in_progress";
    case "resolved": case "closed": case "completed": return "completed";
    case "cancelled": case "canceled": return "cancelled";
    default: return "open";
  }
}

async function authorizeTicketScope(req: any, res: any, ticket: { contactId: number | null }) {
  if (!ticket.contactId) return req.user?.role === "agent" ? denyCrmObject(res) : true;
  return !!await authorizeContactAccess(req, res, ticket.contactId);
}

async function authorizeTaskScope(req: any, res: any, task: { contactId?: number | null; dealId?: number | null; ticketId?: number | null }) {
  if (task.contactId && !await authorizeContactAccess(req, res, task.contactId)) return false;
  if (task.dealId && !await authorizeDealAccess(req, res, task.dealId)) return false;
  if (task.ticketId) {
    const ticket = await storage.getTicket(task.ticketId);
    if (!ticket || !await authorizeTicketScope(req, res, ticket)) return false;
  }
  return task.contactId || task.dealId || task.ticketId || req.user?.role !== "agent" ? true : denyCrmObject(res);
}

async function canListTask(req: any, task: any) {
  if (req.user?.role !== "agent") return true;
  const email = req.user?.email;
  let hasLinkedObject = false;
  if (task.contactId) {
    hasLinkedObject = true;
    const contact = await storage.getContact(task.contactId);
    if (!contact || contact.assignedTo !== email) return false;
  }
  if (task.dealId) {
    hasLinkedObject = true;
    const deal = await storage.getDeal(task.dealId);
    if (!deal || deal.owner !== email) return false;
  }
  if (task.ticketId) {
    hasLinkedObject = true;
    const ticket = await storage.getTicket(task.ticketId);
    const contact = ticket?.contactId ? await storage.getContact(ticket.contactId) : null;
    if (!contact || contact.assignedTo !== email) return false;
  }
  return hasLinkedObject;
}

export function registerTicketsTasksRoutes(app: Express) {
  // === TICKETS ===
  app.get("/api/tickets", isDashboardUser, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const user = req.user as any;
      const result = user?.role === "agent"
        ? await storage.getTicketsForActor(user.email, { limit, offset })
        : await storage.getTickets({ limit, offset });
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/tickets", isDashboardUser, async (req, res) => {
    try {
      const input = insertTicketSchema.parse(req.body);
      if (input.contactId && !await authorizeContactAccess(req, res, input.contactId, { exactAssignment: true })) return;
      if (!input.contactId && (req.user as any)?.role === "agent") return void denyCrmObject(res);
      const ticket = await storage.createAuthorityTicket(input, { producer: "dashboard" });
      res.status(201).json(ticket);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.get("/api/tickets/:id", isDashboardUser, async (req, res) => {
    try {
      const ticket = await storage.getTicket(Number(req.params.id));
      if (!ticket) return res.status(404).json({ message: "Not found" });
      if (!await authorizeTicketScope(req, res, ticket)) return;
      res.json(ticket);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/tickets/:id", isDashboardUser, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      const parseResult = updateTicketSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const oldTicket = await storage.getTicket(ticketId);
      if (!oldTicket) return res.status(404).json({ message: "Not found" });
      if (!await authorizeTicketScope(req, res, oldTicket)) return;
      const candidateContactId = parseResult.data.contactId === undefined ? oldTicket.contactId : parseResult.data.contactId;
      if (candidateContactId) {
        if (!await authorizeContactAccess(req, res, candidateContactId, { exactAssignment: true })) return;
      }
      if ((parseResult.data.status !== undefined && parseResult.data.status !== oldTicket.status)
        || (parseResult.data.assignedTo !== undefined && parseResult.data.assignedTo !== oldTicket.assignedTo)) {
        const transitioned = await storage.transitionAuthorityTicket(ticketId, {
          toState: parseResult.data.status === undefined ? oldTicket.authorityState as any : legacyTicketStatusToAuthorityState(parseResult.data.status),
          expectedFence: oldTicket.authorityFence,
          producer: "dashboard",
          eventKey: `dashboard-update:${ticketId}:${oldTicket.authorityFence}`,
          canonicalAssignee: parseResult.data.assignedTo,
        });
        if (!transitioned) return res.status(409).json({ message: "Ticket was updated concurrently; refresh and retry" });
      }
      const updated = await storage.updateTicket(ticketId, parseResult.data);
      if (!updated) return res.status(404).json({ message: "Not found" });

      if (oldTicket) {
        const changes: string[] = [];
        if (req.body.status && req.body.status !== oldTicket.status) changes.push(`status: ${oldTicket.status} → ${updated.status}`);
        if (req.body.assignedTo && req.body.assignedTo !== oldTicket.assignedTo) changes.push(`assigned to: ${updated.assignedTo}`);
        if (req.body.priority && req.body.priority !== oldTicket.priority) changes.push(`priority: ${updated.priority}`);
        if (changes.length > 0) {
          await createPreferenceAwareNotification({ channel: "internal", title: "Ticket Updated", message: `Ticket #${ticketId} "${updated.subject}" updated: ${changes.join(", ")}`, type: "info", metadata: { ticketId, eventType: "ticket_updated", changes } }, "ticket_updated");
        }
      }

      if (oldTicket && req.body.status && req.body.status !== oldTicket.status) {
        let contact: any = null;
        if (updated.contactId) {
          contact = await storage.getContact(updated.contactId);
        }
        const merchantName = contact?.firstName || "there";

        const statusMessages: Record<string, string> = {
          "In Progress": `Hi ${merchantName} — just a quick heads up that we've picked this up and are actively working on it. You don't need to do anything right now — we'll follow up as soon as we have something for you.\n\nIf anything changes on your end in the meantime, feel free to reply here or give us a call at 954-266-8214.`,
          "Waiting on Merchant": `Hey ${merchantName} — we've looked into this and we need a couple of things from your side before we can move forward. Check the notes above for details on what we need.\n\nNo rush, but the sooner we get that info the faster we can wrap this up for you. Just reply here or email support@libertybancard.com and we'll pick it right back up.`,
          "Resolved": `Hi ${merchantName} — good news, this one's been taken care of. Here's a quick recap of what we did:\n\nIf everything looks good on your end, you're all set. If anything comes up again or doesn't seem right, just let us know — we're always here.\n\nThanks for your patience, and thanks for being with Liberty Bancard.`,
          "Closed": `This ticket has been closed. If you need further help with this issue or anything else, you can always open a new request at libertybancard.com/support or call us at 954-266-8214.\n\nWe appreciate your business.`,
        };

        const statusMsg = statusMessages[req.body.status];
        if (statusMsg) {
          await storage.createTicketComment({
            ticketId,
            content: statusMsg,
            authorName: "Liberty Bancard Support",
            isInternal: false,
          });
        }
      }

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === TASKS ===
  // #385 — Overdue task count for sidebar badge
  app.get("/api/tasks/overdue-count", isDashboardUser, async (req, res) => {
    try {
      const allTasks = await storage.getTasks({});
      const now = new Date();
      const visibility = await Promise.all(allTasks.map((t: any) => canListTask(req, t)));
      const count = allTasks.filter((t: any, i: number) => visibility[i] &&
        t.dueDate && new Date(t.dueDate) < now && t.status !== "completed" && t.status !== "done"
      ).length;
      res.json({ count });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/tasks", isDashboardUser, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      if (dealId && !isNaN(dealId)) {
        if (req.query.source !== undefined) {
          return res.status(400).json({ message: "Cannot combine dealId and source filters" });
        }
        const tasks = await storage.getTasksByDeal(dealId);
        if (!await authorizeDealAccess(req, res, dealId)) return;
        return res.json((await Promise.all(tasks.map(async task => await canListTask(req, task) ? task : null))).filter(Boolean));
      }
      let source: "sla" | "manual" | undefined;
      try {
        source = z.enum(["sla", "manual"]).optional().parse(req.query.source);
      } catch {
        return res.status(400).json({ message: "Invalid source filter. Allowed values: sla, manual" });
      }
      const tasks = await storage.getTasks({ source });
      res.json((await Promise.all(tasks.map(async (task: any) => await canListTask(req, task) ? task : null))).filter(Boolean));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/tasks", isDashboardUser, async (req, res) => {
    try {
      const input = insertTaskSchema.parse(req.body);
      if (!await authorizeTaskScope(req, res, input)) return;
      await storage.assertTaskLinkedObjectScope(input);
      const task = await storage.createTask(input);
      if (task.assignedTo) {
        await createPreferenceAwareNotification({ channel: "internal", title: "Task Assigned", message: `"${task.title}" has been assigned to ${task.assignedTo}.`, type: "info", metadata: { taskId: task.id, eventType: "task_assigned", assignedTo: task.assignedTo } }, "task_assigned");
      }
      res.status(201).json(task);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/tasks/:id", isDashboardUser, async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const parseResult = updateTaskSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const allTasks = await storage.getTasks();
      const existing = allTasks.find((t: any) => t.id === taskId);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!await authorizeTaskScope(req, res, existing)) return;
      const normalized = normalizeTaskCompletionState(parseResult.data, existing);
      await storage.assertTaskLinkedObjectScope({
        contactId: normalized.contactId === undefined ? existing.contactId : normalized.contactId,
        dealId: normalized.dealId === undefined ? existing.dealId : normalized.dealId,
        ticketId: normalized.ticketId === undefined ? existing.ticketId : normalized.ticketId,
      });
      const { status, completedAt: _completedAt, ...nonStateChanges } = normalized;
      if (status !== undefined || normalized.assignedTo !== undefined) {
        const transitioned = await storage.transitionAuthorityTask(taskId, {
          toState: status === undefined ? existing.authorityState : legacyTaskStatusToAuthorityState(status),
          expectedFence: existing.authorityFence,
          producer: "dashboard",
          eventKey: `dashboard-update:${taskId}:${existing.authorityFence}`,
          canonicalAssignee: normalized.assignedTo,
        });
        if (!transitioned) return res.status(409).json({ message: "Task was updated concurrently; refresh and retry" });
      }
      const updated = await storage.updateTask(taskId, nonStateChanges);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === TICKET COMMENTS (Conversation Threading) ===
  app.get("/api/tickets/:id/comments", isDashboardUser, async (req, res) => {
    try {
      const ticket = await storage.getTicket(Number(req.params.id));
      if (!ticket) return res.status(404).json({ message: "Not found" });
      if (!await authorizeTicketScope(req, res, ticket)) return;
      const result = await storage.getTicketComments(ticket.id);
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/tickets/:id/comments", isDashboardUser, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      const ticket = await storage.getTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: "Not found" });
      if (!await authorizeTicketScope(req, res, ticket)) return;
      const input = insertTicketCommentSchema.parse({
        ...req.body,
        ticketId,
      });
      const comment = await storage.createTicketComment({
        ...input,
        authorId: (req.user as any)?.id || null,
        authorName: (req.user as any)?.firstName ? `${(req.user as any).firstName} ${(req.user as any).lastName || ''}`.trim() : (req.user as any)?.email || 'System',
      });
      res.status(201).json(comment);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

}
