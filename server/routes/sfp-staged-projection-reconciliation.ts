import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";

const idsSchema = z.array(z.string().uuid()).min(1).max(25)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length);

export function registerSfpStagedProjectionReconciliationRoutes(app: Express) {
  app.get("/api/lead-ops/sfp/staged-projection-reconciliation/preview", requireRole("admin"), async (req, res) => {
    const userId = String((req.user as any)?.id ?? "").trim();
    if (!userId) return res.status(401).json({ error: "Authenticated admin identity required" });
    const rawIds = Array.isArray(req.query.id) ? req.query.id : typeof req.query.id === "string" ? [req.query.id] : [];
    const parsed = idsSchema.safeParse(rawIds);
    if (!parsed.success) {
      return res.status(400).json({ error: "Select 1-25 unique staging intent UUIDs explicitly", issues: parsed.error.issues });
    }
    try {
      const { previewSfpStagedProjectionReconciliation } =
        await import("../services/cro03/sfp-staged-projection-reconciliation");
      return res.json(await previewSfpStagedProjectionReconciliation(parsed.data));
    } catch (error: any) {
      return res.status(503).json({
        error: "SFP_STAGED_PROJECTION_RECONCILIATION_PREVIEW_UNAVAILABLE",
        reason: String(error?.message ?? error).slice(0, 300),
      });
    }
  });

  app.post("/api/lead-ops/sfp/staged-projection-reconciliation/execute", requireRole("admin"), async (req, res) => {
    const userId = String((req.user as any)?.id ?? "").trim();
    if (!userId) return res.status(401).json({ error: "Authenticated admin identity required" });
    const schema = z.object({
      ids: idsSchema,
      expectedSnapshotHashes: z.record(z.string().uuid(), z.string().regex(/^[a-f0-9]{32}$/i)),
    }).strict().superRefine((input, ctx) => {
      const normalizedHashes = new Set(Object.keys(input.expectedSnapshotHashes).map((id) => id.toLowerCase()));
      if (Object.keys(input.expectedSnapshotHashes).length !== input.ids.length
          || input.ids.some((id) => !normalizedHashes.has(id.toLowerCase()))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one preview snapshot hash per selected intent" });
      }
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid explicit reconciliation selection or preview CAS", issues: parsed.error.issues });
    }
    try {
      const { executeSfpStagedProjectionReconciliation } =
        await import("../services/cro03/sfp-staged-projection-reconciliation");
      const result = await executeSfpStagedProjectionReconciliation({
        ...parsed.data, actorId: userId,
      });
      return res.json(result);
    } catch (error: any) {
      const reason = String(error?.message ?? error);
      const conflict = reason.startsWith("SFP_RECONCILIATION_PREVIEW_CHANGED");
      const rejected = reason.startsWith("SFP_RECONCILIATION_REJECTED")
        || reason.includes("OUTBOUND_NOT_PAUSED") || reason.includes("OWNER_FENCE");
      return res.status(conflict ? 409 : rejected ? 422 : 503).json({
        error: conflict ? "SFP_STAGED_PROJECTION_RECONCILIATION_PREVIEW_CHANGED"
          : "SFP_STAGED_PROJECTION_RECONCILIATION_FAILED",
        reason: reason.slice(0, 300),
      });
    }
  });
}