/**
 * Field Sales Rollback Service
 *
 * Admin-only rollback controls. No automatic triggers.
 * All actions are non-destructive — historical records are preserved.
 * Every action writes a durable audit_logs entry.
 */

import { type Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { storage } from "../storage";
import { setWizardFlagOverride } from "./wizard-flag-overrides";
import { setFieldSalesFrozen, isFieldSalesFrozen } from "../routes/field-territories";
import { sanitizeAuditPayload } from "./audit-sanitizer";

async function writeRollbackAudit(action: string, actorUserId: string, detail: Record<string, unknown>) {
  try {
    await db.execute(sql`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_user_id, details)
      VALUES (${action}, 'system', 0, ${actorUserId}, ${JSON.stringify(sanitizeAuditPayload(detail))}::jsonb)
    `);
  } catch (err: any) {
    console.error(`[FieldSalesRollback] Audit write failed for ${action}:`, err.message);
  }
}

/**
 * Restore in-process freeze flag from DB at server startup.
 * MUST be called BEFORE httpServer.listen() so the rollback kill switch is active
 * before the server accepts any field-sales mutation traffic.
 * Defaults to FROZEN (fail-closed) on DB read error, so a restart after rollback
 * cannot accidentally accept mutations while the DB is unreachable.
 */
export async function initializeFieldSalesFreezeState(): Promise<void> {
  try {
    const raw = await storage.getSystemSetting("field_sales_frozen");
    const frozen = !!(raw as any)?.value === true;
    setFieldSalesFrozen(frozen);
    if (frozen) {
      console.log("[FieldSalesRollback] Field sales operations are FROZEN (restored from DB — rollback in effect)");
    } else {
      console.log("[FieldSalesRollback] Field sales freeze state loaded: unfrozen");
    }
  } catch (err: any) {
    // Fail-closed: on DB read error, freeze mutations until explicitly unfrozen.
    setFieldSalesFrozen(true);
    console.warn("[FieldSalesRollback] Could not read freeze state from DB — defaulting to FROZEN (fail-closed):", err.message);
  }
}

export function registerFieldSalesRollbackRoutes(app: Express) {
  // 1. PATCH /api/admin/field-sales/freeze — sets in-process freeze flag AND persists to system_settings
  app.patch("/api/admin/field-sales/freeze", requireRole("admin"), async (req, res) => {
    try {
      const frozen = req.body?.frozen !== false; // default true (freeze)
      // Update in-process singleton so requireFieldSalesUnfrozen sees it immediately (no restart needed)
      setFieldSalesFrozen(frozen);
      // Persist to DB for recovery across restarts
      await storage.setSystemSetting("field_sales_frozen", { value: frozen, updatedAt: new Date().toISOString() });

      const actorId = String((req.user as any)?.id ?? "unknown");
      await writeRollbackAudit(frozen ? "field_sales_frozen" : "field_sales_unfrozen", actorId, { frozen });

      res.json({ ok: true, frozen, message: frozen ? "Field sales mutations frozen — new claims/visits blocked immediately" : "Field sales mutations unfrozen" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // 2. POST /api/admin/field-sales/release-claims — transitions claimed stops → released for pilot reps
  app.post("/api/admin/field-sales/release-claims", requireRole("admin"), async (req, res) => {
    try {
      const pilotRepUserIds: string[] = req.body?.pilotRepUserIds ?? [];
      const actorId = String((req.user as any)?.id ?? "unknown");

      let releasedCount = 0;

      if (pilotRepUserIds.length > 0) {
        // field_routes uses rep_user_id (varchar → users.id), not rep_id
        const result = await db.execute(sql`
          UPDATE field_route_stops frs
          SET status = 'released',
              released_at = NOW()
          FROM field_routes fr
          WHERE frs.route_id = fr.id
            AND fr.rep_user_id = ANY(${pilotRepUserIds}::varchar[])
            AND frs.status = 'claimed'
          RETURNING frs.id
        `);
        releasedCount = result.rows.length;
      } else {
        // Release ALL claimed stops (no filter)
        const result = await db.execute(sql`
          UPDATE field_route_stops SET status = 'released', released_at = NOW()
          WHERE status = 'claimed'
          RETURNING id
        `);
        releasedCount = result.rows.length;
      }

      await writeRollbackAudit("stop_released_by_rollback", actorId, {
        pilotRepUserIds,
        releasedCount,
      });

      res.json({ ok: true, releasedCount });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // 3. POST /api/admin/field-sales/cancel-routes — sets field_routes.status='cancelled' for open pilot routes
  app.post("/api/admin/field-sales/cancel-routes", requireRole("admin"), async (req, res) => {
    try {
      const pilotRepUserIds: string[] = req.body?.pilotRepUserIds ?? [];
      const actorId = String((req.user as any)?.id ?? "unknown");

      let cancelledCount = 0;

      if (pilotRepUserIds.length > 0) {
        // field_routes uses rep_user_id (varchar → users.id), not rep_id
        const result = await db.execute(sql`
          UPDATE field_routes
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by_user_id = ${actorId}
          WHERE rep_user_id = ANY(${pilotRepUserIds}::varchar[])
            AND status = 'open'
          RETURNING id
        `);
        cancelledCount = result.rows.length;
      } else {
        const result = await db.execute(sql`
          UPDATE field_routes SET status = 'cancelled', cancelled_at = NOW(), cancelled_by_user_id = ${actorId}
          WHERE status = 'open'
          RETURNING id
        `);
        cancelledCount = result.rows.length;
      }

      await writeRollbackAudit("route_cancelled_by_rollback", actorId, {
        pilotRepUserIds,
        cancelledCount,
      });

      res.json({ ok: true, cancelledCount });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // 4. POST /api/admin/field-sales/disable-flags — wizard flag override via setWizardFlagOverride()
  //    Uses the canonical API so dbFallbackBool() picks up the override immediately.
  //    IMPORTANT: if the flag is set via environment variable, the DB override has no effect
  //    at runtime; the env var must be unset and the server restarted. This endpoint always
  //    writes the DB override (for after restart) and returns a warning if env overrides exist.
  app.post("/api/admin/field-sales/disable-flags", requireRole("admin"), async (req, res) => {
    try {
      const actor = req.user as any;
      const actorEmail = actor?.email ?? "admin";
      const actorId = String(actor?.id ?? "unknown");

      // Check if flags are overridden by env var (env wins over DB in dbFallbackBool)
      const callAssistEnvSet = !!process.env.CALL_ASSIST_ENABLED;
      const fieldSalesEnvSet = !!process.env.FIELD_SALES_ENABLED;
      const envWarnings: string[] = [];
      if (callAssistEnvSet && process.env.CALL_ASSIST_ENABLED !== "false") {
        envWarnings.push("CALL_ASSIST_ENABLED is set via environment variable — server must be restarted with CALL_ASSIST_ENABLED=false to take effect");
      }
      if (fieldSalesEnvSet && process.env.FIELD_SALES_ENABLED !== "false") {
        envWarnings.push("FIELD_SALES_ENABLED is set via environment variable — server must be restarted with FIELD_SALES_ENABLED=false to take effect");
      }

      // Write DB override via canonical API (takes effect immediately if no env var override)
      await Promise.all([
        setWizardFlagOverride("CALL_ASSIST_ENABLED", false, actorEmail, "rollback: pilot deactivation"),
        setWizardFlagOverride("FIELD_SALES_ENABLED", false, actorEmail, "rollback: pilot deactivation"),
      ]);

      await writeRollbackAudit("call_assist_disabled", actorId, { source: "rollback", envWarnings });
      await writeRollbackAudit("field_sales_disabled", actorId, { source: "rollback", envWarnings });

      res.json({
        ok: true,
        message: "CALL_ASSIST_ENABLED and FIELD_SALES_ENABLED DB overrides set to false. Flag cache invalidated.",
        envWarnings: envWarnings.length > 0 ? envWarnings : undefined,
        effectiveNow: envWarnings.length === 0,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // 5. GET /api/admin/field-sales/rollback-status — current state of rollback controls
  app.get("/api/admin/field-sales/rollback-status", requireRole("admin"), async (_req, res) => {
    try {
      const [frozenSetting, openClaims, openRoutes] = await Promise.all([
        storage.getSystemSetting("field_sales_frozen"),
        db.execute(sql`SELECT COUNT(*) AS cnt FROM field_route_stops WHERE status = 'claimed'`),
        db.execute(sql`SELECT COUNT(*) AS cnt FROM field_routes WHERE status = 'open'`),
      ]);

      res.json({
        frozen: isFieldSalesFrozen() || (frozenSetting as any)?.value === true,
        openClaims: Number((openClaims.rows[0] as any)?.cnt ?? 0),
        openRoutes: Number((openRoutes.rows[0] as any)?.cnt ?? 0),
        rollbackChecklist: [
          { step: "disable_flags", description: "POST /api/admin/field-sales/disable-flags — sets both feature flags to false", required: true },
          { step: "freeze_mutations", description: "PATCH /api/admin/field-sales/freeze — blocks new claim/visit mutations", required: true },
          { step: "release_claims", description: "POST /api/admin/field-sales/release-claims — transitions claimed stops to released", required: false },
          { step: "cancel_routes", description: "POST /api/admin/field-sales/cancel-routes — cancels open field routes", required: false },
          { step: "unassign_cohort", description: "DELETE /api/field-territories/:id/assignments/:assignmentId — expires territory assignments; preserves all historical records", required: false },
        ],
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
