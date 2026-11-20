import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { requireRole } from "../replit_integrations/auth";
import { canAccessOwner } from "../services/crm-object-access";
import {
  savePayarcPreparation,
  PAYARC_EXTRA_FIELDS,
} from "../services/payarc-preparation";
import { payarcRequestSchema } from "@shared/payarc-traditional";
import { serverError } from "../utils/server-error";
export function registerPayarcPreparationRoutes(app: Express) {
  app.get(
    "/api/deals/:id/payarc-preparation",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        const r: any = await db.execute(
          sql`SELECT d.owner,a.id,p.application_revision=a.updated_at::text AS prepared,c.phase,c.signature_state FROM deals d LEFT JOIN merchant_applications a ON a.deal_id=d.id LEFT JOIN payarc_preparations p ON p.application_id=a.id LEFT JOIN payarc_cases c ON c.deal_id=d.id WHERE d.id=${id} AND d.archived_at IS NULL ORDER BY a.id LIMIT 2`,
        );
        const items = r.rows ?? r;
        if (
          !items.length ||
          !canAccessOwner(req.user as any, items[0].owner, false)
        )
          return res.status(404).json({ message: "Case unavailable." });
        if (items.length !== 1 || !items[0].id)
          return res.status(409).json({
            message: "A single directly linked application is required.",
          });
        res.setHeader("Cache-Control", "no-store");
        res.json({
          applicationId: items[0].id,
          prepared: items[0].prepared === true,
          canCorrect:
            [
              "lead_created",
              "awaiting_signature",
              "documents_needed",
              "declined",
            ].includes(items[0].phase) &&
            !["attempting", "uncertain"].includes(items[0].signature_state),
          fields: Object.fromEntries(
            PAYARC_EXTRA_FIELDS.map((k) => [
              k,
              payarcRequestSchema.properties.Lead.properties[k],
            ]),
          ),
          ownerTitles:
            payarcRequestSchema.properties.Owners.items.properties.Title.enum,
          pricing: {
            tiered: payarcRequestSchema.properties.TieredPricing.properties,
            interchange:
              payarcRequestSchema.properties.InterchangePlusPricing.properties,
            bundleRate:
              payarcRequestSchema.properties.BlendedRatePricing.properties,
          },
        });
      } catch (e) {
        if (e instanceof z.ZodError)
          return res.status(400).json({ message: "Invalid case." });
        serverError(res, e);
      }
    },
  );
  app.post(
    "/api/deals/:id/payarc-correction",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        const body = z
          .object({ commandKey: z.string().uuid() })
          .strict()
          .parse(req.body);
        const r: any = await db.execute(
          sql`SELECT owner FROM deals WHERE id=${id} AND archived_at IS NULL`,
        );
        const row = (r.rows ?? r)[0];
        if (!row || !canAccessOwner(req.user as any, row.owner, false))
          return res.status(404).json({ message: "Case unavailable." });
        const { queuePayarcCorrection } = await import(
          "../services/payarc-lifecycle"
        );
        res.json(
          await queuePayarcCorrection(
            id,
            body.commandKey,
            String((req.user as any).id),
          ),
        );
      } catch (e) {
        if (e instanceof z.ZodError)
          return res
            .status(400)
            .json({ message: "Invalid correction command." });
        if (e instanceof Error && e.message.startsWith("PAYARC_"))
          return res.status(409).json({ message: e.message });
        serverError(res, e);
      }
    },
  );
  app.post(
    "/api/deals/:id/payarc-preparation",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        const body = z
          .object({
            applicationId: z.number().int().positive(),
            extras: z.record(z.string(), z.unknown()),
          })
          .strict()
          .parse(req.body);
        const r: any = await db.execute(
          sql`SELECT owner FROM deals d WHERE id=${id} AND archived_at IS NULL AND EXISTS(SELECT 1 FROM merchant_applications a WHERE a.id=${body.applicationId} AND a.deal_id=d.id)`,
        );
        const row = (r.rows ?? r)[0];
        if (!row || !canAccessOwner(req.user as any, row.owner, false))
          return res.status(404).json({ message: "Case unavailable." });
        res.setHeader("Cache-Control", "no-store");
        res.json(
          await savePayarcPreparation(
            body.applicationId,
            body.extras,
            String((req.user as any).id),
          ),
        );
      } catch (e) {
        if (e instanceof z.ZodError)
          return res.status(400).json({ message: "Invalid preparation." });
        if (e instanceof Error && e.message.startsWith("PAYARC_"))
          return res
            .status(409)
            .json({ message: e.message, fields: (e as any).fields ?? [] });
        serverError(res, e);
      }
    },
  );
}
