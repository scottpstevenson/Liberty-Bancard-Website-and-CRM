import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { getGhlSyncControl } from "../services/ghl-sync-control";
import { getGhlSyncRuntimeTruth } from "../services/ghl-sync-runtime";
import { getGhlStatus } from "../services/ghl";

/** Passive runtime evidence. Connection probes have their own checked-at state. */
export function registerGhlSyncTruthRoutes(app: Express): void {
  app.get("/api/admin/ghl/sync-truth", requireRole("admin"), async (_req, res) => {
    const [control, runtime] = await Promise.allSettled([
      getGhlSyncControl(),
      getGhlSyncRuntimeTruth(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      observedAt: new Date().toISOString(),
      configured: getGhlStatus(),
      control: control.status === "fulfilled" ? control.value : null,
      runtime: runtime.status === "fulfilled" ? runtime.value : null,
      errors: {
        control: control.status === "rejected" ? "GHL sync control unavailable" : null,
        runtime: runtime.status === "rejected" ? "GHL runtime evidence unavailable" : null,
      },
    });
  });
}