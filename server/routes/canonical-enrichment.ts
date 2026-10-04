import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { readCanonicalEnrichmentStatus } from "../services/canonical-enrichment-status";

export function registerCanonicalEnrichmentRoutes(app: Express) {
  app.get("/api/canonical-enrichment/status", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await readCanonicalEnrichmentStatus());
    } catch {
      res.status(503).json({ message: "Canonical enrichment status is unavailable; counts were not calculated." });
    }
  });
}