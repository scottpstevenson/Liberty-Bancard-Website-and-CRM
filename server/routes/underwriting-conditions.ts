/**
 * #1403 — Underwriting Orchestration: Conditional Approval Checklist (S5-10 hardened)
 *
 *   GET    /api/underwriting/deals/:id/conditions       — list conditions (superseded hidden unless ?includeSuperseded=1)
 *   POST   /api/underwriting/deals/:id/conditions       — add a condition
 *   PATCH  /api/underwriting/conditions/:id             — legal status transition / evidence binding / notes
 *   DELETE /api/underwriting/conditions/:id             — supersede (history preserved; admin only; body {reason})
 *   POST   /api/underwriting/deals/:id/conditions/chase — retry the owed merchant chase (admin/manager)
 *   GET    /api/underwriting/deals/:id/conditions/chase — read-only chase state (owed / sent / held unknown outcome)
 *   GET    /api/underwriting/conditions/:id/history     — preserved audit history of one condition (admin/manager)
 *
 * The commands, transitions and evidence binding live in services/underwriting-conditions-service.ts.
 */

import type { Express, Response } from "express";
import { ZodError } from "zod";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import {
  ConditionError, listConditions, createCondition, updateCondition, supersedeCondition, readChaseState, readConditionHistory,
} from "../services/underwriting-conditions-service";

function respond(res: Response, err: unknown) {
  if (err instanceof ConditionError) return res.status(err.status).json({ message: err.message, code: err.code });
  if (err instanceof ZodError) return res.status(400).json({ message: "Invalid request", fields: err.issues.map((i) => i.path.join(".")) });
  return serverError(res, err as any);
}

const actorOf = (req: any) => ({ id: typeof req.user?.id === "string" ? req.user.id : null, role: req.user?.role ?? null });
const parseId = (v: unknown) => (/^\d{1,10}$/.test(String(v)) ? Number(v) : NaN);

export function registerUnderwritingConditionRoutes(app: Express) {
  app.get("/api/underwriting/deals/:id/conditions", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      const rows = await listConditions(dealId, { includeSuperseded: String(req.query?.includeSuperseded ?? "") === "1" });
      res.json({ conditions: rows });
    } catch (err) { respond(res, err); }
  });

  app.post("/api/underwriting/deals/:id/conditions", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      res.status(201).json(await createCondition(dealId, req.body, actorOf(req)));
    } catch (err) { respond(res, err); }
  });

  app.patch("/api/underwriting/conditions/:id", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid condition ID" });
      res.json(await updateCondition(id, req.body, actorOf(req)));
    } catch (err) { respond(res, err); }
  });

  app.delete("/api/underwriting/conditions/:id", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid condition ID" });
      const out = await supersedeCondition(id, req.body, actorOf(req));
      res.json({ superseded: true, alreadySuperseded: out.alreadySuperseded, condition: out.condition });
    } catch (err) { respond(res, err); }
  });

  app.get("/api/underwriting/deals/:id/conditions/chase", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      res.json({ chase: await readChaseState(dealId) });
    } catch (err) { respond(res, err); }
  });

  app.get("/api/underwriting/conditions/:id/history", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid condition ID" });
      res.json({ history: await readConditionHistory(id) });
    } catch (err) { respond(res, err); }
  });

  app.post("/api/underwriting/deals/:id/conditions/chase", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ message: "Invalid deal ID" });
      const { retryOwedConditionChases } = await import("../services/underwriting-checklist-service");
      res.json(await retryOwedConditionChases({ dealId }));
    } catch (err) { respond(res, err); }
  });
}
