import type { Express, Request } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { ingestCr06SyntheticFeedback } from "../services/cr06-feedback";

function actorId(req: Request): string {
  const user = req.user as any;
  return String(user?.email ?? user?.id ?? "unknown-admin");
}

/** Admin-only test ingress; it records feedback but never enables transport. */
export function registerCr06FeedbackRoutes(app: Express) {
  app.post("/api/admin/cr06/feedback/synthetic", requireRole("admin"), async (req, res) => {
    try {
      const body = z.object({
        deliveryIntentId: z.string().uuid(),
        eventKey: z.string().min(8).max(250),
        eventType: z.enum([
          "delivered", "hard_bounce", "soft_bounce", "complaint", "unsubscribe",
          "provider_rejected", "provider_failed", "replied",
        ]),
        payload: z.object({
          provider: z.string().trim().min(1).max(80).optional(),
          providerMessageId: z.string().trim().min(1).max(250).optional(),
          occurredAt: z.string().datetime({ offset: true }).optional(),
          reasonCode: z.string().trim().min(1).max(120).optional(),
          diagnosticCode: z.string().trim().min(1).max(120).optional(),
          smtpStatus: z.number().int().min(100).max(599).optional(),
        }).strict().optional(),
      }).strict().parse(req.body);
      const result = await ingestCr06SyntheticFeedback({ ...body, actorId: actorId(req) });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ code: "CR06_FEEDBACK_INVALID_COMMAND", dispatchAvailable: false });
      }
      const code = error instanceof Error ? error.message : "CR06_FEEDBACK_FAILED";
      if (code.startsWith("CR06_")) return res.status(409).json({ code, dispatchAvailable: false });
      return serverError(res, error);
    }
  });
}