import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { insertTaskSchema, insertTicketCommentSchema, insertTicketSchema } from "@shared/schema";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { createPreferenceAwareNotification } from "../services/digest-service";
import { parse } from "csv-parse/sync";

export function registerTicketsTasksRoutes(app: Express) {
  // === TICKETS ===
  app.get("/api/tickets", isAuthenticated, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const result = await storage.getTickets({ limit, offset });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tickets", isAuthenticated, async (req, res) => {
    try {
      const input = insertTicketSchema.parse(req.body);
      const ticket = await storage.createTicket(input);
      await storage.createAuditLog({ action: "ticket_created", entityType: "ticket", entityId: ticket.id, details: { category: ticket.category, priority: ticket.priority } });
      await createPreferenceAwareNotification({ channel: "internal", title: `New ${ticket.priority} Support Ticket`, message: `${ticket.subject} - Category: ${ticket.category}`, type: ticket.priority === "Urgent" ? "urgent" : "info", metadata: { ticketId: ticket.id, eventType: "ticket_created" } }, "ticket_created");
      triggerWorkflowsByEvent("ticket_created", { entityType: "ticket", entityId: ticket.id }).catch(err => console.error("Workflow trigger error:", err));
      res.status(201).json(ticket);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tickets/:id", isAuthenticated, async (req, res) => {
    try {
      const ticket = await storage.getTicket(Number(req.params.id));
      if (!ticket) return res.status(404).json({ message: "Not found" });
      res.json(ticket);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/tickets/:id", isAuthenticated, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      const { data: existing } = await storage.getTickets({ limit: 500 });
      const oldTicket = existing.find(t => t.id === ticketId);
      const updated = await storage.updateTicket(ticketId, req.body);
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
      res.status(500).json({ message: err.message });
    }
  });


  // === TASKS ===
  app.get("/api/tasks", isAuthenticated, async (req, res) => {
    try {
      const tasks = await storage.getTasks();
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks", isAuthenticated, async (req, res) => {
    try {
      const input = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(input);
      if (task.assignedTo) {
        await createPreferenceAwareNotification({ channel: "internal", title: "Task Assigned", message: `"${task.title}" has been assigned to ${task.assignedTo}.`, type: "info", metadata: { taskId: task.id, eventType: "task_assigned", assignedTo: task.assignedTo } }, "task_assigned");
      }
      res.status(201).json(task);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/tasks/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateTask(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === TICKET COMMENTS (Conversation Threading) ===
  app.get("/api/tickets/:id/comments", isAuthenticated, async (req, res) => {
    try {
      const result = await storage.getTicketComments(Number(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tickets/:id/comments", isAuthenticated, async (req, res) => {
    try {
      const input = insertTicketCommentSchema.parse({
        ...req.body,
        ticketId: Number(req.params.id),
      });
      const comment = await storage.createTicketComment({
        ...input,
        authorId: (req.user as any)?.id || null,
        authorName: (req.user as any)?.firstName ? `${(req.user as any).firstName} ${(req.user as any).lastName || ''}`.trim() : (req.user as any)?.email || 'System',
      });
      res.status(201).json(comment);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

}
