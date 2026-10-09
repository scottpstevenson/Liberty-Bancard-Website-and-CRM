import type { Express } from "express";
import { strictRecordId, taskEditCommand, ticketEditCommand, taskCreateCommand,ticketCreateCommand } from "@shared/work-item-commands";
import { commandWorkItems, WorkCommandError, bindWorkActor, createHumanTask,createHumanTicket } from "../services/work-item-command";
import { isDashboardUser } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertTicketCommentSchema, insertTicketSchema } from "@shared/schema";
import { createPreferenceAwareNotification } from "../services/digest-service";
import { serverError } from "../utils/server-error";
import { authorizeContactAccess, authorizeDealAccess, denyCrmObject } from "../services/crm-object-access";
import { readTaskMetrics } from "../services/task-read-authority";

export async function authorizeTicketScope(req: any, res: any, ticket: { contactId: number | null }) {
  if (!ticket.contactId) return req.user?.role === "agent" ? denyCrmObject(res) : true;
  return !!await authorizeContactAccess(req, res, ticket.contactId);
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
      const {commandId,expectedActorId,expectedAccountVersion,...fields}=ticketCreateCommand.parse(req.body);
      const result=await createHumanTicket({commandId,fields,
        actor:bindWorkActor(req.user,expectedActorId,expectedAccountVersion)});
      res.status(result.replayed||result.reused?200:201).json({...result.ticket,
        command:{id:commandId,replayed:result.replayed,reused:result.reused,nativeDelivery:"not_attempted"}});
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
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
      const ticketId = strictRecordId.parse(req.params.id);
      const { expectedFence, commandId, recordClass, expectedActorId,expectedAccountVersion, ...updates } = ticketEditCommand.parse(req.body);
      const user = req.user as any;
      const command = await commandWorkItems({ kind: "ticket", items: [{ id: ticketId, expectedFence }],
        commandId, recordClass, actor: bindWorkActor(user, expectedActorId,expectedAccountVersion), updates });
      const updated = command.results[0].item;
      const oldTicket = command.results[0].prior;
      if (command.replayed || !command.changed) return res.json(updated);

      if (oldTicket) {
        const changes: string[] = [];
        if (req.body.status && req.body.status !== oldTicket.status) changes.push(`status: ${oldTicket.status} → ${updated.status}`);
        if (req.body.assignedTo && req.body.assignedTo !== oldTicket.assignedTo) changes.push(`assigned to: ${updated.assignedTo}`);
        if (req.body.priority && req.body.priority !== oldTicket.priority) changes.push(`priority: ${updated.priority}`);
        if (changes.length > 0) {
          await createPreferenceAwareNotification({ channel: "internal", title: "Ticket Updated", message: `Ticket #${ticketId} "${updated.subject}" updated: ${changes.join(", ")}`, type: "info", metadata: { ticketId, eventType: "ticket_updated", changes } }, "ticket_updated");
        }
      }

      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({ message: err.message });
      serverError(res, err);
    }
  });


  // === TASKS ===
  // #385 — Overdue task count for sidebar badge
  app.get("/api/tasks/overdue-count", isDashboardUser, async (req, res) => {
    try {
      const now = new Date();
      const metrics = await readTaskMetrics({ actor: req.user as any, asOf: now, timezone: "UTC" });
      res.json({ count: Number(metrics.rows[0]?.overdue), meta: metrics.meta });
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
        const tasks = await storage.getTasksByDeal(dealId, { actor: req.user as any, asOf: new Date(), timezone: "UTC" });
        if (!await authorizeDealAccess(req, res, dealId)) return;
        return res.json(tasks);
      }
      let source: "sla" | "manual" | undefined;
      try {
        source = z.enum(["sla", "manual"]).optional().parse(req.query.source);
      } catch {
        return res.status(400).json({ message: "Invalid source filter. Allowed values: sla, manual" });
      }
      const tasks = await storage.getTasks({ source, scope: { actor: req.user as any, asOf: new Date(), timezone: "UTC" } });
      res.json(tasks);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/tasks", isDashboardUser, async (req, res) => {
    try {
      const {expectedActorId,expectedAccountVersion,commandId,recordClass,...fields} = taskCreateCommand.parse(req.body);
      const result = await createHumanTask({actor:bindWorkActor(req.user,expectedActorId,expectedAccountVersion),commandId,recordClass,fields});
      res.status(result.replayed?200:201).json({...result.task,creationReplayed:result.replayed});
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      serverError(res, err);
    }
  });

  app.put("/api/tasks/:id", isDashboardUser, async (req, res) => {
    try {
      const taskId = strictRecordId.parse(req.params.id);
      const { expectedFence, commandId, recordClass, expectedActorId,expectedAccountVersion, ...updates } = taskEditCommand.parse(req.body);
      const user = req.user as any;
      const command = await commandWorkItems({ kind: "task", items: [{ id: taskId, expectedFence }],
        commandId, recordClass, actor: bindWorkActor(user, expectedActorId,expectedAccountVersion), updates });
      res.json(command.results[0].item);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({ message: err.message });
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
