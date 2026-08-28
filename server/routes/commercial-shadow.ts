import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { CRO02_EFFECTS, readCommercialShadowReport } from "../services/commercial-shadow-reporting";
import { serverError } from "../utils/server-error";

export function registerCommercialShadowRoutes(app: Express) {
  const report = async (req: any, res: any) => {
    const purpose = req.query.purpose;
    if (typeof purpose !== "string" || !(CRO02_EFFECTS as readonly string[]).includes(purpose)) {
      return res.status(400).json({ code: "INVALID_COMMERCIAL_PURPOSE", message: "purpose must be a supported commercial effect" });
    }
    try {
      return res.json(await readCommercialShadowReport(req.user, purpose as any));
    } catch (error) {
      return serverError(res, error, "CRO-02 shadow report");
    }
  };
  app.get("/api/commercial/coverage", requireRole("admin", "manager"), report);
  app.get("/api/commercial/discrepancies", requireRole("admin", "manager"), report);
}