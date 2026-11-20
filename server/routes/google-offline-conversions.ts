import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import {
  processOfflineConversions,
  qualifyOfflineLead,
  readOfflineConversionStatus,
  revokeOfflineAttribution,
} from "../services/google-offline-conversions";

export function registerGoogleOfflineRoutes(app: Express) {
  app.get(
    "/api/acquisition/offline-conversions/status",
    requireRole("admin", "manager"),
    async (_req, res) => {
      res.set("Cache-Control", "private, no-store");
      try {
        res.json(await readOfflineConversionStatus());
      } catch {
        res.status(503).json({ error: "OFFLINE_MEASUREMENT_UNAVAILABLE" });
      }
    },
  );
  app.post(
    "/api/acquisition/offline-conversions/qualify",
    requireRole("admin", "manager"),
    async (req, res) => {
      const input = z
        .object({
          dealId: z.number().int().positive(),
          expectedStage: z.string().min(1).max(80),
          reason: z.string().trim().min(10).max(500),
          confirm: z.literal("RECORD REVIEWED QUALIFIED LEAD"),
        })
        .strict()
        .safeParse(req.body);
      if (!input.success)
        return res.status(400).json({ error: "INVALID_QUALIFICATION_COMMAND" });
      try {
        res.json(
          await qualifyOfflineLead({
            ...input.data,
            actorId: String((req.user as any).id),
          }),
        );
      } catch (e) {
        const error = e instanceof Error ? e.message : "";
        res
          .status(409)
          .json({
            error: /^OFFLINE_[A-Z_]+$/.test(error)
              ? error
              : "OFFLINE_QUALIFICATION_UNAVAILABLE",
          });
      }
    },
  );
  app.post(
    "/api/acquisition/offline-conversions/process",
    requireRole("admin"),
    async (req, res) => {
      const input = z
        .object({ mode: z.enum(["validate", "send"]), confirm: z.string() })
        .strict()
        .safeParse(req.body);
      if (
        !input.success ||
        input.data.confirm !==
          (input.data.mode === "send"
            ? "UPLOAD CONSENTED CRM OUTCOMES"
            : "VALIDATE CONSENTED CRM OUTCOMES")
      )
        return res
          .status(400)
          .json({ error: "EXPLICIT_MEASUREMENT_COMMAND_REQUIRED" });
      try {
        res.json(
          await processOfflineConversions({
            validateOnly: input.data.mode === "validate",
          }),
        );
      } catch {
        res.status(503).json({ error: "OFFLINE_PROCESSING_UNAVAILABLE" });
      }
    },
  );
  app.post(
    "/api/public/ads-measurement/revoke",
    publicLeadRateLimit,
    async (req, res) => {
      const input = z
        .object({ key: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .safeParse(req.body);
      if (!input.success)
        return res.status(400).json({ error: "INVALID_REVOCATION" });
      try {
        await revokeOfflineAttribution(input.data.key);
        res.status(204).end();
      } catch {
        res.status(503).json({ error: "REVOCATION_UNAVAILABLE" });
      }
    },
  );
}
