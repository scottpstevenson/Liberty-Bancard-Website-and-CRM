/**
 * Field Routes — Route preview, freeze, stop management, and visit recording.
 * All routes except /api/field-sales/status require FIELD_SALES_ENABLED=true.
 */

import type { Express, Request, Response } from "express";
import { requireRole, isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import {
  fieldRoutePreviews,
  fieldRoutes,
  fieldRouteStops,
  fieldVisits,
  businesses,
  contacts,
  salesTerritories,
  FIELD_VISIT_OUTCOME_CODES,
} from "@shared/schema";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditChange } from "../services/audit-change";
import { serverError } from "../utils/server-error";
import { requireFieldSales, requireFieldSalesEligible, getPilotRepIds } from "./field-territories";
import { checkFieldEligibility, computeStopFingerprint } from "../services/field-eligibility";
import { onStatementRequested } from "../services/statement-acquisition";
import { storage } from "../storage";
import { featureFlags } from "../services/feature-flags";
import crypto from "crypto";

const PREVIEW_MAX_STOPS = 30;
const POLICY_VERSION = "v1.0";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildMapsUrl(lat?: number | string | null, lng?: number | string | null, address?: string): string | null {
  if (lat != null && lng != null) {
    const url = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
    if (!url.startsWith("https://maps.google.com/")) return null;
    return url;
  }
  if (address && address.trim().length > 0) {
    const url = `https://maps.google.com/?q=${encodeURIComponent(address.trim())}`;
    if (!url.startsWith("https://maps.google.com/")) return null;
    return url;
  }
  return null;
}

function roundCoord(val: number): number {
  return parseFloat(val.toFixed(6));
}

const RecordVisitSchema = z.object({
  stopId: z.string().uuid("stopId must be a UUID"),
  idempotencyKey: z.string().regex(UUID_V4_RE, "idempotency_key must be a UUIDv4"),
  outcomeCode: z.enum(FIELD_VISIT_OUTCOME_CODES as unknown as [string, ...string[]]),
  note: z.string().max(280).optional(),
  confirmed: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export function registerFieldRoutesRoutes(app: Express) {
  // ── Status endpoint — exempt from requireFieldSales ──────────────────────
  app.get("/api/field-sales/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const enabled = featureFlags.FIELD_SALES_ENABLED;
      const pilotReps = getPilotRepIds();
      const userId = String((req as any).user?.id ?? "");
      const role = String((req as any).user?.role ?? "");
      const inPilot =
        pilotReps.length === 0 || role === "admin" || role === "manager" || pilotReps.includes(userId);
      const eligible = enabled && inPilot;
      res.json({ enabled, eligible });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Preview — bounded candidate set ──────────────────────────────────────
  app.post(
    "/api/field-routes/preview",
    requireFieldSalesEligible,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const repUserId = String(req.body.repUserId ?? "");
        const territoryId: string | undefined = req.body.territoryId;
        const routeDate: string | undefined = req.body.routeDate;

        if (!repUserId) return res.status(400).json({ message: "repUserId is required" });

        // Optionally load territory criteria for geographic filtering
        let territoryCriteria: { postalCodes?: string[]; cities?: string[]; states?: string[] } | null = null;
        if (territoryId) {
          const [territory] = await db
            .select({ criteria: salesTerritories.criteria })
            .from(salesTerritories)
            .where(eq(salesTerritories.id, territoryId))
            .limit(1);
          if (!territory) return res.status(404).json({ message: "Territory not found" });
          territoryCriteria = territory.criteria as typeof territoryCriteria;
        }

        // Build territory-scoped WHERE clause for businesses
        // NEVER from sunbiz_entities, prospects, or master_leads
        let bizQuery = db
          .select()
          .from(businesses)
          .where(eq(businesses.recordClass, "canonical"))
          .$dynamic();

        if (territoryCriteria?.postalCodes?.length) {
          bizQuery = bizQuery.where(
            inArray(businesses.postalCode, territoryCriteria.postalCodes)
          );
        } else if (territoryCriteria?.cities?.length) {
          bizQuery = bizQuery.where(
            inArray(businesses.city, territoryCriteria.cities)
          );
        } else if (territoryCriteria?.states?.length) {
          bizQuery = bizQuery.where(
            inArray(businesses.state, territoryCriteria.states)
          );
        }

        const bizRows = await bizQuery.limit(PREVIEW_MAX_STOPS * 3);

        const candidates: any[] = [];
        for (const biz of bizRows) {
          if (candidates.length >= PREVIEW_MAX_STOPS) break;

          const elig = await checkFieldEligibility(biz.id);

          // Fetch updated_at for fingerprint
          const [bizFull] = await db
            .select({ updatedAt: businesses.updatedAt })
            .from(businesses)
            .where(eq(businesses.id, biz.id))
            .limit(1);

          let contactUpdatedAt: Date | null = null;
          if (elig.eligible && elig.canonicalContactId) {
            const [ct] = await db
              .select({ updatedAt: contacts.updatedAt })
              .from(contacts)
              .where(eq(contacts.id, elig.canonicalContactId))
              .limit(1);
            contactUpdatedAt = ct?.updatedAt ?? null;
          }

          const fingerprint = computeStopFingerprint(
            biz.id,
            bizFull?.updatedAt ?? null,
            elig.canonicalContactId ?? 0,
            contactUpdatedAt
          );

          const fullAddress = [biz.streetAddress, biz.city, biz.state, biz.postalCode]
            .filter(Boolean)
            .join(", ");

          candidates.push({
            businessId: biz.id,
            businessName: biz.canonicalName,
            streetAddress: biz.streetAddress,
            city: biz.city,
            state: biz.state,
            postalCode: biz.postalCode,
            mapsUrl: buildMapsUrl(biz.latitude, biz.longitude, fullAddress),
            eligible: elig.eligible,
            blockReason: elig.blockReason,
            canonicalContactId: elig.canonicalContactId,
            fingerprint,
            businessUpdatedAt: bizFull?.updatedAt ?? null,
            contactUpdatedAt,
          });
        }

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const [preview] = await db
          .insert(fieldRoutePreviews)
          .values({
            territoryId: territoryId ?? null,
            repUserId,
            routeDate: routeDate ?? new Date().toISOString().slice(0, 10),
            createdByUserId: (req as any).user?.id ?? null,
            expiresAt,
            candidateSnapshot: candidates as any,
          })
          .returning();

        res.json({
          previewId: preview.id,
          expiresAt: preview.expiresAt,
          candidates: candidates.filter((c) => c.eligible),
          blocked: candidates.filter((c) => !c.eligible),
        });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── Freeze route ──────────────────────────────────────────────────────────
  app.post(
    "/api/field-routes",
    requireFieldSalesEligible,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const previewId = String(req.body.previewId ?? "");
        const allowMultipleRoutesOverride: boolean = req.body.allowMultipleRoutesOverride === true;

        if (!previewId) {
          return res.status(400).json({ message: "previewId is required" });
        }

        const [preview] = await db
          .select()
          .from(fieldRoutePreviews)
          .where(eq(fieldRoutePreviews.id, previewId))
          .limit(1);
        if (!preview) return res.status(404).json({ message: "Preview not found" });
        if (new Date(preview.expiresAt as unknown as string) < new Date()) {
          return res.status(409).json({ message: "Preview has expired; generate a new preview" });
        }

        // repUserId is taken from the preview row (bound at preview time) — not from request body
        const repUserId = preview.repUserId;
        const snapshot = preview.candidateSnapshot as any[];
        const eligible = snapshot.filter((c: any) => c.eligible);

        const route = await db.transaction(async (tx) => {
          // Fingerprint re-validation under SELECT ... FOR UPDATE
          for (const candidate of eligible) {
            const [bizRow] = await tx
              .select({ id: businesses.id, updatedAt: businesses.updatedAt })
              .from(businesses)
              .where(eq(businesses.id, candidate.businessId as number))
              .for("update")
              .limit(1);

            const [ctRow] = await tx
              .select({ id: contacts.id, updatedAt: contacts.updatedAt })
              .from(contacts)
              .where(eq(contacts.id, candidate.canonicalContactId as number))
              .for("update")
              .limit(1);

            const currentFingerprint = computeStopFingerprint(
              bizRow?.id ?? (candidate.businessId as number),
              bizRow?.updatedAt ?? null,
              ctRow?.id ?? (candidate.canonicalContactId as number),
              ctRow?.updatedAt ?? null
            );

            if (currentFingerprint !== candidate.fingerprint) {
              throw Object.assign(
                new Error(`Record drift detected for business ${candidate.businessId as number} — regenerate preview`),
                { code: "FINGERPRINT_MISMATCH", businessId: candidate.businessId }
              );
            }
          }

          if (!allowMultipleRoutesOverride) {
            const routeDate = (preview.routeDate as string | null) ?? new Date().toISOString().slice(0, 10);
            const existing = await tx
              .select({ id: fieldRoutes.id })
              .from(fieldRoutes)
              .where(
                and(
                  eq(fieldRoutes.repUserId, repUserId),
                  eq(fieldRoutes.routeDate, routeDate),
                  eq(fieldRoutes.status, "open")
                )
              )
              .limit(1);
            if (existing.length > 0) {
              throw Object.assign(
                new Error("An open route already exists for this rep on this date"),
                { code: "CONFLICT" }
              );
            }
          }

          const [frozenRoute] = await tx
            .insert(fieldRoutes)
            .values({
              previewId,
              territoryId: preview.territoryId ?? null,
              repUserId,
              routeDate: (preview.routeDate as string | null) ?? new Date().toISOString().slice(0, 10),
              status: "open",
              frozenAt: new Date(),
              frozenByUserId: (req as any).user?.id ?? null,
              policyVersion: POLICY_VERSION,
              stopCount: eligible.length,
            })
            .returning();

          if (eligible.length > 0) {
            await tx.insert(fieldRouteStops).values(
              eligible.map((c: any, i: number) => ({
                routeId: frozenRoute.id,
                businessId: c.businessId as number,
                contactId: c.canonicalContactId as number,
                plannedOrder: i + 1,
                recordFingerprint: String(c.fingerprint),
                status: "available",
              }))
            );
          }

          return frozenRoute;
        });

        await auditChange({
          action: "route_frozen",
          entityType: "field_route",
          entityKey: route.id,
          userId: (req as any).user?.id ?? null,
          details: { repUserId, stopCount: eligible.length, previewId },
        });

        res.status(201).json({ route });
      } catch (err: any) {
        if ((err as any).code === "FINGERPRINT_MISMATCH") {
          return res.status(409).json({ message: err.message, businessId: (err as any).businessId });
        }
        if ((err as any).code === "CONFLICT" || (err as any).code === "23505") {
          return res.status(409).json({ message: err.message || "Route conflict" });
        }
        serverError(res, err);
      }
    }
  );

  // ── Cancel route ──────────────────────────────────────────────────────────
  app.delete(
    "/api/field-routes/:id",
    requireFieldSalesEligible,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const [route] = await db
          .select()
          .from(fieldRoutes)
          .where(eq(fieldRoutes.id, id))
          .limit(1);
        if (!route) return res.status(404).json({ message: "Route not found" });
        if (route.status === "cancelled") return res.status(409).json({ message: "Route is already cancelled" });

        const nonAvailable = await db
          .select({ id: fieldRouteStops.id })
          .from(fieldRouteStops)
          .where(
            and(
              eq(fieldRouteStops.routeId, id),
              sql`${fieldRouteStops.status} != 'available'`
            )
          )
          .limit(1);
        if (nonAvailable.length > 0) {
          return res.status(409).json({ message: "Cannot cancel a route with claimed or completed stops" });
        }

        await db
          .update(fieldRoutes)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledByUserId: (req as any).user?.id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(fieldRoutes.id, id));

        await auditChange({
          action: "route_cancelled",
          entityType: "field_route",
          entityKey: id,
          userId: (req as any).user?.id ?? null,
          details: {},
        });

        res.json({ success: true });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── List routes (manager/admin) ───────────────────────────────────────────
  app.get(
    "/api/field-routes",
    requireFieldSalesEligible,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
        const offset = parseInt(String(req.query.offset ?? "0"));
        const filters: ReturnType<typeof eq>[] = [];
        if (req.query.repUserId) filters.push(eq(fieldRoutes.repUserId, String(req.query.repUserId)));
        if (req.query.routeDate) filters.push(eq(fieldRoutes.routeDate, String(req.query.routeDate)));
        if (req.query.territoryId) filters.push(eq(fieldRoutes.territoryId, String(req.query.territoryId)));

        const rows = await db
          .select()
          .from(fieldRoutes)
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(desc(fieldRoutes.createdAt))
          .limit(limit)
          .offset(offset);

        res.json({ routes: rows, limit, offset });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── My Today's Route (agent — rep identity from req.user.id only) ─────────
  app.get(
    "/api/field-routes/my-today",
    requireFieldSalesEligible,
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const repUserId = String((req as any).user?.id ?? "");
        if (!repUserId) return res.status(401).json({ message: "Unauthorized" });

        const today = new Date().toISOString().slice(0, 10);

        const [route] = await db
          .select()
          .from(fieldRoutes)
          .where(
            and(
              eq(fieldRoutes.repUserId, repUserId),
              eq(fieldRoutes.routeDate, today),
              eq(fieldRoutes.status, "open")
            )
          )
          .limit(1);

        if (!route) return res.json({ route: null, stops: [] });

        const stops = await db
          .select()
          .from(fieldRouteStops)
          .where(eq(fieldRouteStops.routeId, route.id))
          .orderBy(fieldRouteStops.plannedOrder);

        const enriched = await Promise.all(
          stops.map(async (stop) => {
            const [biz] = await db
              .select({
                id: businesses.id,
                canonicalName: businesses.canonicalName,
                streetAddress: businesses.streetAddress,
                city: businesses.city,
                state: businesses.state,
                postalCode: businesses.postalCode,
                latitude: businesses.latitude,
                longitude: businesses.longitude,
              })
              .from(businesses)
              .where(eq(businesses.id, stop.businessId))
              .limit(1);

            const fullAddress = [biz?.streetAddress, biz?.city, biz?.state, biz?.postalCode]
              .filter(Boolean)
              .join(", ");

            const mapsUrl = buildMapsUrl(biz?.latitude, biz?.longitude, fullAddress);

            const [lastVisit] = await db
              .select({ visitedAt: fieldVisits.visitedAt, outcomeCode: fieldVisits.outcomeCode })
              .from(fieldVisits)
              .where(eq(fieldVisits.businessId, stop.businessId))
              .orderBy(desc(fieldVisits.visitedAt))
              .limit(1);

            return {
              ...stop,
              businessName: biz?.canonicalName,
              address: fullAddress,
              mapsUrl,
              lastVisit: lastVisit ?? null,
            };
          })
        );

        res.json({ route, stops: enriched });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── Field ops metrics (manager/admin) ─────────────────────────────────────
  app.get(
    "/api/field-routes/metrics",
    requireFieldSalesEligible,
    requireRole("admin", "manager"),
    async (req: Request, res: Response) => {
      try {
        const filters: ReturnType<typeof eq>[] = [];
        if (req.query.repUserId) filters.push(eq(fieldRoutes.repUserId, String(req.query.repUserId)));
        if (req.query.routeDate) filters.push(eq(fieldRoutes.routeDate, String(req.query.routeDate)));
        if (req.query.territoryId) filters.push(eq(fieldRoutes.territoryId, String(req.query.territoryId)));

        const routes = await db
          .select({ id: fieldRoutes.id, repUserId: fieldRoutes.repUserId, stopCount: fieldRoutes.stopCount })
          .from(fieldRoutes)
          .where(filters.length > 0 ? and(...filters) : undefined);

        const metrics = await Promise.all(
          routes.map(async (route) => {
            try {
              // Select stop IDs and statuses so we can join to field_visits by stop_id
              const stops = await db
                .select({ id: fieldRouteStops.id, status: fieldRouteStops.status })
                .from(fieldRouteStops)
                .where(eq(fieldRouteStops.routeId, route.id));

              const stopIds = stops.map((s) => s.id);
              const stopsAssigned = stops.length;
              const stopsClaimed = stops.filter((s) => s.status === "claimed").length;
              const visitsCompleted = stops.filter((s) => s.status === "completed").length;

              // Fetch visits for THIS route's stops only (route-scoped, not all rep visits)
              const visits = stopIds.length > 0
                ? await db
                    .select({ outcomeCode: fieldVisits.outcomeCode })
                    .from(fieldVisits)
                    .where(inArray(fieldVisits.stopId, stopIds))
                : [];

              const count = (code: string) => visits.filter((v) => v.outcomeCode === code).length;
              const totalVisits = visits.length;
              const spokeToOwner = count("visited_owner_spoke");

              return {
                routeId: route.id,
                repUserId: route.repUserId,
                stops_assigned: stopsAssigned,
                stops_claimed: stopsClaimed,
                visits_completed: visitsCompleted,
                visited_owner_spoke: spokeToOwner,
                follow_ups: count("follow_up_requested"),
                statement_requests: count("statement_requested"),
                do_not_visit_flags: count("do_not_visit"),
                outcome_conversion_rate: totalVisits > 0 ? spokeToOwner / totalVisits : null,
              };
            } catch {
              return {
                routeId: route.id,
                repUserId: route.repUserId,
                stops_assigned: null,
                stops_claimed: null,
                visits_completed: null,
                visited_owner_spoke: null,
                follow_ups: null,
                statement_requests: null,
                do_not_visit_flags: null,
                outcome_conversion_rate: null,
                dataUnavailable: true,
              };
            }
          })
        );

        res.json({ metrics });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── Claim stop ────────────────────────────────────────────────────────────
  app.post(
    "/api/field-routes/:routeId/stops/:stopId/claim",
    requireFieldSalesEligible,
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const repUserId = String((req as any).user?.id ?? "");
        const routeId = String(req.params.routeId);
        const stopId = String(req.params.stopId);

        // Verify route belongs to this rep
        const [route] = await db
          .select({ id: fieldRoutes.id, repUserId: fieldRoutes.repUserId })
          .from(fieldRoutes)
          .where(
            and(eq(fieldRoutes.id, routeId), eq(fieldRoutes.repUserId, repUserId))
          )
          .limit(1);
        if (!route) return res.status(404).json({ message: "Route not found or not yours" });

        const stop = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(fieldRouteStops)
            .where(
              and(
                eq(fieldRouteStops.id, stopId),
                eq(fieldRouteStops.routeId, routeId)
              )
            )
            .for("update")
            .limit(1);

          if (!row) throw Object.assign(new Error("Stop not found"), { code: "NOT_FOUND" });
          if (row.status !== "available") {
            throw Object.assign(new Error(`Stop is not available (current: ${row.status})`), { code: "CONFLICT" });
          }

          const [updated] = await tx
            .update(fieldRouteStops)
            .set({ status: "claimed", claimedAt: new Date(), claimedByUserId: repUserId })
            .where(eq(fieldRouteStops.id, stopId))
            .returning();
          return updated;
        });

        await auditChange({
          action: "stop_claimed",
          entityType: "field_route_stop",
          entityKey: stopId,
          userId: repUserId,
          details: { routeId },
        });

        res.json({ stop });
      } catch (err: any) {
        if ((err as any).code === "CONFLICT") return res.status(409).json({ message: err.message });
        if ((err as any).code === "NOT_FOUND") return res.status(404).json({ message: err.message });
        serverError(res, err);
      }
    }
  );

  // ── Release stop claim ────────────────────────────────────────────────────
  app.delete(
    "/api/field-routes/:routeId/stops/:stopId/claim",
    requireFieldSalesEligible,
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const repUserId = String((req as any).user?.id ?? "");
        const routeId = String(req.params.routeId);
        const stopId = String(req.params.stopId);

        const [route] = await db
          .select({ id: fieldRoutes.id })
          .from(fieldRoutes)
          .where(and(eq(fieldRoutes.id, routeId), eq(fieldRoutes.repUserId, repUserId)))
          .limit(1);
        if (!route) return res.status(404).json({ message: "Route not found or not yours" });

        const [stop] = await db
          .select({ id: fieldRouteStops.id })
          .from(fieldRouteStops)
          .where(
            and(
              eq(fieldRouteStops.id, stopId),
              eq(fieldRouteStops.routeId, routeId),
              eq(fieldRouteStops.claimedByUserId, repUserId)
            )
          )
          .limit(1);
        if (!stop) return res.status(404).json({ message: "Claimed stop not found" });

        await db
          .update(fieldRouteStops)
          .set({
            status: "released",
            releasedAt: new Date(),
            claimedAt: null,
            claimedByUserId: null,
          })
          .where(eq(fieldRouteStops.id, stopId));

        await auditChange({
          action: "stop_released",
          entityType: "field_route_stop",
          entityKey: stopId,
          userId: repUserId,
          details: { routeId },
        });

        res.json({ success: true });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  // ── Record visit ──────────────────────────────────────────────────────────
  app.post(
    "/api/field-visits",
    requireFieldSalesEligible,
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const repUserId = String((req as any).user?.id ?? "");
        const parsed = RecordVisitSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation error", errors: parsed.error.issues });
        }
        const { stopId, idempotencyKey, outcomeCode, note, confirmed, latitude, longitude } = parsed.data;

        // Validate stop ownership FIRST (before idempotency check — security)
        const [stop] = await db
          .select()
          .from(fieldRouteStops)
          .where(eq(fieldRouteStops.id, stopId))
          .limit(1);
        if (!stop) return res.status(404).json({ message: "Stop not found" });
        if (stop.claimedByUserId !== repUserId || stop.status !== "claimed") {
          return res.status(403).json({ message: "Stop is not claimed by you" });
        }

        // Idempotency check — return existing visit if key already used
        const [existing] = await db
          .select()
          .from(fieldVisits)
          .where(eq(fieldVisits.idempotencyKey, idempotencyKey))
          .limit(1);
        if (existing) {
          return res.json(existing);
        }

        // Round coordinates
        const lat = latitude != null ? roundCoord(latitude) : null;
        const lng = longitude != null ? roundCoord(longitude) : null;

        if (lat != null && lng != null) {
          const url = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
          if (!url.startsWith("https://maps.google.com/")) {
            return res.status(400).json({ message: "Invalid coordinate values for maps URL construction" });
          }
        }

        const visitId = crypto.randomUUID();
        const visitValues: any = {
          id: visitId,
          idempotencyKey,
          stopId,
          repUserId,
          businessId: stop.businessId,
          contactId: stop.contactId,
          outcomeCode,
          note: note ?? null,
          confirmed: confirmed ?? false,
          latitude: lat != null ? String(lat) : null,
          longitude: lng != null ? String(lng) : null,
          visitedAt: new Date(),
        };

        // ── do_not_visit ──────────────────────────────────────────────────
        if (outcomeCode === "do_not_visit") {
          const visit = await db.transaction(async (tx) => {
            // Set do_not_visit flag on the business in the same transaction
            await tx
              .update(businesses)
              .set({ doNotVisit: true } as any)
              .where(eq(businesses.id, stop.businessId));

            const [v] = await tx.insert(fieldVisits).values(visitValues).returning();

            await tx
              .update(fieldRouteStops)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(fieldRouteStops.id, stopId));

            return v;
          });

          await auditChange({
            action: "field_visit_recorded",
            entityType: "field_visit",
            entityKey: visit.id,
            userId: repUserId,
            details: { outcomeCode, stopId, businessId: stop.businessId },
          });

          return res.status(201).json(visit);
        }

        // ── statement_requested ───────────────────────────────────────────
        if (outcomeCode === "statement_requested") {
          const [ct] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(eq(contacts.id, stop.contactId))
            .limit(1);
          if (!ct) {
            await auditChange({
              action: "field_visit_outcome_failed",
              entityType: "field_visit",
              entityKey: visitId,
              userId: repUserId,
              details: { reason: "no_canonical_contact", stopId, outcomeCode },
            });
            return res.status(422).json({
              message: "No canonical contact linked to this stop",
              code: "NO_CANONICAL_CONTACT",
            });
          }

          try {
            await onStatementRequested(stop.contactId);
          } catch (stmtErr: any) {
            await auditChange({
              action: "field_visit_outcome_failed",
              entityType: "field_visit",
              entityKey: visitId,
              userId: repUserId,
              details: { reason: stmtErr.message, stopId, outcomeCode },
            });
            return res.status(422).json({
              message: stmtErr.message || "Statement acquisition failed",
              code: "STATEMENT_ACQUISITION_FAILED",
            });
          }

          const visit = await db.transaction(async (tx) => {
            const [v] = await tx.insert(fieldVisits).values(visitValues).returning();
            await tx
              .update(fieldRouteStops)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(fieldRouteStops.id, stopId));
            return v;
          });

          await auditChange({
            action: "field_visit_recorded",
            entityType: "field_visit",
            entityKey: visit.id,
            userId: repUserId,
            details: { outcomeCode, stopId },
          });

          return res.status(201).json({ ...visit, statement_acquisition_started: true });
        }

        // ── follow_up_requested ───────────────────────────────────────────
        if (outcomeCode === "follow_up_requested") {
          const visit = await db.transaction(async (tx) => {
            const [v] = await tx.insert(fieldVisits).values(visitValues).returning();
            await tx
              .update(fieldRouteStops)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(fieldRouteStops.id, stopId));
            return v;
          });

          const task = await storage.createTask({
            title: "Field visit follow-up",
            subjectType: "contact",
            subjectId: stop.contactId,
            automationKey: `field_visit_follow_up:${visit.id}`,
            source: "field_visit",
            status: "open",
            priority: "medium",
            contactId: stop.contactId,
          } as any);

          await auditChange({
            action: "field_visit_recorded",
            entityType: "field_visit",
            entityKey: visit.id,
            userId: repUserId,
            details: { outcomeCode, stopId, taskId: task.id },
          });

          return res.status(201).json({ ...visit, task_id: task.id });
        }

        // ── All other outcomes ────────────────────────────────────────────
        const visit = await db.transaction(async (tx) => {
          const [v] = await tx.insert(fieldVisits).values(visitValues).returning();
          await tx
            .update(fieldRouteStops)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(fieldRouteStops.id, stopId));
          return v;
        });

        await auditChange({
          action: "field_visit_recorded",
          entityType: "field_visit",
          entityKey: visit.id,
          userId: repUserId,
          details: { outcomeCode, stopId },
        });

        res.status(201).json(visit);
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );
}
