import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { invalidPagination, parseStrictPagination } from "../services/crm-object-access";
import { readRevenueLeads, readRevenueReconciliation } from "../services/revenue-read-authority";
import { serverError } from "../utils/server-error";

export function registerRevenueRoutes(app: Express) {
  app.get("/api/revenue/leads", isDashboardUser, async (req, res) => {
    try {
      const pagination = parseStrictPagination(req.query as Record<string, unknown>, { defaultLimit: 100, maxLimit: 500 });
      if ("error" in pagination) return invalidPagination(res);
      const sort = req.query.sort ? String(req.query.sort) : undefined;
      if (sort && sort !== "primaryDeal") {
        return res.status(400).json({ code: "INVALID_LEAD_SORT", message: "Unsupported Lead sort" });
      }
      const result = await readRevenueLeads(req.user as any, {
        ...pagination,
        search: req.query.search ? String(req.query.search) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        emailHealth: req.query.emailHealth ? String(req.query.emailHealth) : undefined,
        assignedTo: req.query.assignedTo ? String(req.query.assignedTo) : undefined,
        sort,
      });
      return res.json(result);
    } catch (error) {
      return serverError(res, error);
    }
  });

  app.get("/api/revenue/reconciliation", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      return res.json(await readRevenueReconciliation(req.user as any));
    } catch (error) {
      return serverError(res, error);
    }
  });
}