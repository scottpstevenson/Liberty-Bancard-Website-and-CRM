/**
 * Field Territory Routes
 * All routes require FIELD_SALES_ENABLED = true (enforced via requireFieldSales middleware).
 * Manager/admin only for mutations.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { requireRole, isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import { salesTerritories, salesTerritoryAssignments, TerritoryCriteriaSchema } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { auditChange } from "../services/audit-change";
import { serverError } from "../utils/server-error";
import { featureFlags } from "../services/feature-flags";
import { storage } from "../storage";

// In-process freeze flag — set by rollback service, checked synchronously in middleware.
// Updated by setFieldSalesFrozen() exported below; persisted to DB by the rollback route.
let _fieldSalesFrozen = false;
export function setFieldSalesFrozen(frozen: boolean): void { _fieldSalesFrozen = frozen; }
export function isFieldSalesFrozen(): boolean { return _fieldSalesFrozen; }

/** Middleware: returns 404 when FIELD_SALES_ENABLED is false.
 *  For mutation routes (claim/visit/cancel), also returns 503 when frozen via rollback. */
export function requireFieldSales(req: Request, res: Response, next: NextFunction): void {
  if (!featureFlags.FIELD_SALES_ENABLED) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  next();
}

/**
 * Middleware: requires FIELD_SALES_ENABLED, checks the freeze flag, AND checks pilot eligibility
 * via an authoritative async DB lookup (no stale-cache fallback for mutation paths).
 *
 * Fails closed: if the DB lookup throws, mutations are denied with 503.
 * This ensures a rep removed from the pilot cannot use a cached empty list to bypass authorization.
 */
export async function requireFieldSalesUnfrozen(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!featureFlags.FIELD_SALES_ENABLED) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  if (_fieldSalesFrozen) {
    res.status(503).json({ message: "Field sales operations are currently frozen by rollback. Contact admin.", code: "FIELD_SALES_FROZEN" });
    return;
  }
  // Authoritative uncached pilot-cohort check — fails closed on DB error.
  // Using getPilotRepIdsUncached() (no cache) guarantees that a de-listed rep whose
  // cache was invalidated cannot bypass this gate even momentarily.
  try {
    const pilotReps = await getPilotRepIdsUncached();
    // Empty cohort is fail-closed: once the pilot list has been established and then emptied,
    // no agents (other than admin/manager) can perform mutations. This prevents "last rep de-listed
    // re-enables everyone" attacks. An empty list from DB is indistinguishable from "no one authorized."
    const userId = (req as any).user?.id ?? "";
    const role = (req as any).user?.role ?? "";
    if (role !== "admin" && role !== "manager") {
      if (pilotReps.length === 0 || !pilotReps.includes(userId)) {
        res.status(403).json({ message: "Field sales not enabled for your account" });
        return;
      }
    }
    next();
  } catch {
    // Fail closed: if DB pilot-membership lookup fails, deny the mutation.
    res.status(503).json({ message: "Field sales authorization temporarily unavailable", code: "PILOT_LOOKUP_FAILED" });
  }
}

// ── Pilot rep list — DB-backed with in-process cache ─────────────────────────

const PILOT_CACHE_TTL_MS = 60_000; // 1 minute
let _pilotCache: { ids: string[]; expiresAt: number } | null = null;

/** Reads pilot rep IDs from DB (system_settings key "field_pilot_reps").
 *  Env var FIELD_PILOT_REPS always wins when non-empty (escape hatch).
 *  On DB failure, returns the stale cache if available, otherwise propagates error. */
export async function getPilotRepIdsAsync(): Promise<string[]> {
  const envRaw = process.env.FIELD_PILOT_REPS ?? "";
  if (envRaw.trim().length > 0) {
    return envRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const now = Date.now();
  if (_pilotCache && now < _pilotCache.expiresAt) return _pilotCache.ids;

  try {
    const raw = await storage.getSystemSetting("field_pilot_reps");
    const ids: string[] = Array.isArray(raw)
      ? (raw as unknown[]).map(String).filter(Boolean)
      : [];
    _pilotCache = { ids, expiresAt: now + PILOT_CACHE_TTL_MS };
    return ids;
  } catch (err) {
    // No stale cache — propagate so callers can fail closed
    throw err;
  }
}

/**
 * Uncached, direct DB read of pilot rep IDs for mutation authorization.
 * Never returns a cached value. Propagates DB errors so callers can fail closed.
 * Env var FIELD_PILOT_REPS wins when non-empty (escape hatch, considered authoritative).
 */
export async function getPilotRepIdsUncached(): Promise<string[]> {
  const envRaw = process.env.FIELD_PILOT_REPS ?? "";
  if (envRaw.trim().length > 0) {
    return envRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Direct DB read — no cache, propagates errors (fail-closed callers require this)
  const raw = await storage.getSystemSetting("field_pilot_reps");
  return Array.isArray(raw) ? (raw as unknown[]).map(String).filter(Boolean) : [];
}

/** Synchronous read from the in-process cache (populated by getPilotRepIdsAsync).
 *  Falls back to env var. Safe to call from sync middleware. */
export function getPilotRepIds(): string[] {
  const envRaw = process.env.FIELD_PILOT_REPS ?? "";
  if (envRaw.trim().length > 0) {
    return envRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (_pilotCache && Date.now() < _pilotCache.expiresAt) return _pilotCache.ids;
  return [];
}

/** Invalidate the pilot cache (call after any write). */
export function invalidatePilotCache(): void {
  _pilotCache = null;
}

/**
 * Middleware: when FIELD_SALES_ENABLED, also enforce that the caller is in
 * the pilot list (or there is no pilot list = everyone eligible).
 */
export function requireFieldSalesEligible(req: Request, res: Response, next: NextFunction): void {
  if (!featureFlags.FIELD_SALES_ENABLED) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  const pilotReps = getPilotRepIds();
  if (pilotReps.length > 0) {
    const userId = (req as any).user?.id ?? "";
    // Managers and admins bypass pilot list restriction
    const role = (req as any).user?.role ?? "";
    if (role !== "admin" && role !== "manager" && !pilotReps.includes(userId)) {
      res.status(403).json({ message: "Field sales not enabled for your account" });
      return;
    }
  }
  next();
}

const CreateTerritorySchema = z.object({
  name: z.string().min(1).max(200),
  criteria: TerritoryCriteriaSchema,
  timezone: z.string().default("America/New_York"),
  effectiveDate: z.string().optional(),
});

const AssignTerritorySchema = z.object({
  agentUserId: z.string().min(1),
  isPrimary: z.boolean().default(true),
  overrideReason: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

/** Check for overlap: any active territory covering shared postal codes or city+state */
async function checkOverlap(
  criteria: z.infer<typeof TerritoryCriteriaSchema>,
  excludeTerritoryId?: string
): Promise<string[]> {
  const warnings: string[] = [];

  const activeRows = await db
    .select({ id: salesTerritories.id, name: salesTerritories.name, criteria: salesTerritories.criteria })
    .from(salesTerritories)
    .where(isNull(salesTerritories.expiredAt));

  for (const row of activeRows) {
    if (excludeTerritoryId && row.id === excludeTerritoryId) continue;
    const other = row.criteria as z.infer<typeof TerritoryCriteriaSchema>;

    if (criteria.postalCodes?.length && other.postalCodes?.length) {
      const shared = criteria.postalCodes.filter((p) => other.postalCodes!.includes(p));
      if (shared.length > 0) {
        warnings.push(`Overlaps territory "${row.name}" on postal codes: ${shared.join(", ")}`);
      }
    }

    if (criteria.cities?.length && other.cities?.length) {
      const shared = criteria.cities.filter((c) => other.cities!.includes(c));
      if (shared.length > 0 && criteria.states?.some((s) => other.states?.includes(s))) {
        warnings.push(`Overlaps territory "${row.name}" on cities: ${shared.join(", ")}`);
      }
    }

    if (criteria.states?.length && other.states?.length) {
      const shared = criteria.states.filter((s) => other.states!.includes(s));
      if (shared.length > 0) {
        warnings.push(`Overlaps territory "${row.name}" on states: ${shared.join(", ")}`);
      }
    }
  }

  return warnings;
}

export function registerFieldTerritoriesRoutes(app: Express) {
  // GET /api/field-territories — list all territories (paginated)
  app.get(
    "/api/field-territories",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
        const offset = parseInt(String(req.query.offset ?? "0"));
        const rows = await db
          .select()
          .from(salesTerritories)
          .orderBy(sql`created_at DESC`)
          .limit(limit)
          .offset(offset);
        res.json({ territories: rows, limit, offset });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // GET /api/field-territories/:id
  app.get(
    "/api/field-territories/:id",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const [territory] = await db
          .select()
          .from(salesTerritories)
          .where(eq(salesTerritories.id, id))
          .limit(1);
        if (!territory) return res.status(404).json({ message: "Territory not found" });
        const assignments = await db
          .select()
          .from(salesTerritoryAssignments)
          .where(eq(salesTerritoryAssignments.territoryId, id));
        res.json({ territory, assignments });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/field-territories — create
  app.post(
    "/api/field-territories",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const parsed = CreateTerritorySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation error", errors: parsed.error.issues });
        }
        const { name, criteria, timezone, effectiveDate } = parsed.data;
        const overlapWarnings = await checkOverlap(criteria);

        const [territory] = await db
          .insert(salesTerritories)
          .values({
            name,
            criteria: criteria as any,
            timezone,
            effectiveDate: effectiveDate ?? null,
            version: 1,
            createdByUserId: (req as any).user?.id ?? null,
          })
          .returning();

        await auditChange({
          action: "territory_created",
          entityType: "sales_territory",
          entityKey: territory.id,
          userId: (req as any).user?.id ?? null,
          details: { name, version: 1, overlapWarnings },
        });

        res.status(201).json({ territory, overlapWarnings });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // PUT /api/field-territories/:id — version (inserts new row; prior is immutable)
  app.put(
    "/api/field-territories/:id",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const [prior] = await db
          .select()
          .from(salesTerritories)
          .where(eq(salesTerritories.id, id))
          .limit(1);
        if (!prior) return res.status(404).json({ message: "Territory not found" });

        const parsed = CreateTerritorySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation error", errors: parsed.error.issues });
        }
        const { name, criteria, timezone, effectiveDate } = parsed.data;
        const overlapWarnings = await checkOverlap(criteria, id);

        const [newVersion] = await db
          .insert(salesTerritories)
          .values({
            name,
            criteria: criteria as any,
            timezone,
            effectiveDate: effectiveDate ?? null,
            version: (prior.version ?? 1) + 1,
            createdByUserId: (req as any).user?.id ?? null,
          })
          .returning();

        await auditChange({
          action: "territory_versioned",
          entityType: "sales_territory",
          entityKey: newVersion.id,
          userId: (req as any).user?.id ?? null,
          details: { priorId: prior.id, newVersion: newVersion.version, overlapWarnings },
        });

        res.json({ territory: newVersion, overlapWarnings });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // POST /api/field-territories/:id/assignments — assign rep
  app.post(
    "/api/field-territories/:id/assignments",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const territoryId = String(req.params.id);
        const [territory] = await db
          .select()
          .from(salesTerritories)
          .where(eq(salesTerritories.id, territoryId))
          .limit(1);
        if (!territory) return res.status(404).json({ message: "Territory not found" });

        const parsed = AssignTerritorySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation error", errors: parsed.error.issues });
        }

        const { agentUserId, isPrimary, overrideReason, startsAt, endsAt } = parsed.data;

        if (!isPrimary && !overrideReason) {
          return res.status(400).json({ message: "override_reason is required for non-primary (shared) assignments" });
        }

        const assignment = await db.transaction(async (tx) => {
          if (isPrimary) {
            const existing = await tx
              .select({ id: salesTerritoryAssignments.id })
              .from(salesTerritoryAssignments)
              .where(
                and(
                  eq(salesTerritoryAssignments.territoryId, territoryId),
                  eq(salesTerritoryAssignments.isPrimary, true),
                  isNull(salesTerritoryAssignments.endsAt)
                )
              )
              .limit(1);
            if (existing.length > 0) {
              throw Object.assign(new Error("A primary assignment already exists for this territory"), { code: "CONFLICT" });
            }
          }

          const [row] = await tx
            .insert(salesTerritoryAssignments)
            .values({
              territoryId,
              agentUserId,
              isPrimary,
              overrideApproverUserId: isPrimary ? null : ((req as any).user?.id ?? null),
              overrideReason: isPrimary ? null : (overrideReason ?? null),
              overrideAt: isPrimary ? null : new Date(),
              startsAt: startsAt ? new Date(startsAt) : new Date(),
              endsAt: endsAt ? new Date(endsAt) : null,
              createdByUserId: (req as any).user?.id ?? null,
            })
            .returning();
          return row;
        });

        await auditChange({
          action: "territory_assigned",
          entityType: "sales_territory_assignment",
          entityKey: assignment.id,
          userId: (req as any).user?.id ?? null,
          details: { territoryId, agentUserId, isPrimary },
        });

        res.status(201).json({ assignment });
      } catch (err: any) {
        if ((err as any).code === "CONFLICT" || (err as any).code === "23505") {
          return res.status(409).json({ message: (err as any).message || "A primary assignment already exists for this territory" });
        }
        serverError(res, err);
      }
    }
  );

  // DELETE /api/field-territories/:id/assignments/:assignmentId — expire assignment
  app.delete(
    "/api/field-territories/:id/assignments/:assignmentId",
    requireFieldSales,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const territoryId = String(req.params.id);
        const assignmentId = String(req.params.assignmentId);

        const [assignment] = await db
          .select()
          .from(salesTerritoryAssignments)
          .where(
            and(
              eq(salesTerritoryAssignments.id, assignmentId),
              eq(salesTerritoryAssignments.territoryId, territoryId)
            )
          )
          .limit(1);
        if (!assignment) return res.status(404).json({ message: "Assignment not found" });

        await db
          .update(salesTerritoryAssignments)
          .set({ endsAt: new Date() })
          .where(eq(salesTerritoryAssignments.id, assignmentId));

        await auditChange({
          action: "territory_unassigned",
          entityType: "sales_territory_assignment",
          entityKey: assignmentId,
          userId: (req as any).user?.id ?? null,
          details: { territoryId },
        });

        res.json({ success: true });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );
}
