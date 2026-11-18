import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import {
  funnelQuerySchema,
  defaultFunnelDates,
} from "../../shared/conversion-funnel";
import {
  readConversionFunnel,
  exportConversionFunnel,
} from "../services/conversion-funnel";
export function registerConversionFunnelRoutes(app: Express) {
  app.get(
    "/api/analytics/conversion-cohort",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const q = funnelQuerySchema.parse({
          ...defaultFunnelDates(),
          ...req.query,
        });
        res.set("Cache-Control", "private, no-store");
        res.json(await readConversionFunnel(q));
      } catch (e) {
        if (e instanceof z.ZodError)
          return res
            .status(400)
            .json({
              code: "FUNNEL_INVALID_FILTERS",
              message:
                "Invalid funnel filters; no broader population was read.",
            });
        const code = e instanceof Error ? e.message : "";
        res
          .status(code === "FUNNEL_FUTURE_SNAPSHOT" ? 400 : 503)
          .json({
            code:
              code === "FUNNEL_FUTURE_SNAPSHOT" ? code : "FUNNEL_UNAVAILABLE",
            message:
              "Cohort evidence unavailable; no zero counts were inferred.",
          });
      }
    },
  );
  app.get(
    "/api/analytics/conversion-cohort/export",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const q = funnelQuerySchema.parse({
          ...defaultFunnelDates(),
          ...req.query,
        });
        res.set({
          "Cache-Control": "private, no-store",
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="liberty-conversion-funnel.csv"',
          "X-Content-Type-Options": "nosniff",
        });
        for await (const chunk of exportConversionFunnel(q)) {
          if (res.destroyed) break;
          if (!res.write(chunk))
            await new Promise<void>((resolve) => res.once("drain", resolve));
        }
        res.end();
      } catch (e) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res
          .status(e instanceof z.ZodError ? 400 : 503)
          .json({
            code: "FUNNEL_EXPORT_UNAVAILABLE",
            message:
              "Export not completed; retry with the same observation cutoff.",
          });
      }
    },
  );
}
