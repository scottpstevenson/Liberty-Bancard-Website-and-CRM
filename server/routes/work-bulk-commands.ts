import type { Express } from "express";
import { z } from "zod";
import { workCommandEnvelope, workSelection } from "@shared/work-item-commands";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { commandWorkItems, WorkCommandError, bindWorkActor } from "../services/work-item-command";
import { serverError } from "../utils/server-error";

const bodySchema = workCommandEnvelope.omit({ expectedFence: true }).extend({ items: workSelection });
export function registerWorkBulkRoutes(app: Express) {
  for (const kind of ["task","ticket"] as const) {
    app.post(`/api/${kind}s/bulk-complete`, isDashboardUser, async (req, res) => {
      try {
        const body = bodySchema.strict().parse(req.body);
        const user = req.user as any;
        const command = await commandWorkItems({ kind, ...body,
          actor: bindWorkActor(user, body.expectedActorId),
          updates: { status: kind === "task" ? "completed" : "Resolved" } });
        res.json({ changed: command.changed, replayed: command.replayed });
      } catch (error) { fail(res, error); }
    });
  }
  app.post("/api/tickets/bulk-assign", requireRole("admin","manager"), async (req, res) => {
    try {
      const { assignedTo, ...body } = bodySchema.extend({ assignedTo: z.string().min(1).max(190) }).strict().parse(req.body);
      const user = req.user as any;
      const command = await commandWorkItems({ kind: "ticket", ...body,
        actor: bindWorkActor(user, body.expectedActorId), updates: { assignedTo } });
      res.json({ changed: command.changed, replayed: command.replayed });
    } catch (error) { fail(res, error); }
  });
}
function fail(res: import("express").Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
  if (error instanceof WorkCommandError) return res.status(error.status).json({ message: error.message });
  serverError(res, error);
}
