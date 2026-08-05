import type { Express, Request, Response, RequestHandler, Router } from "express";
import { requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { desc } from "drizzle-orm";
import { serverError } from "../utils/server-error";

interface RoutePermission {
  method: string;
  path: string;
  requiredRoles: string[];
}

// Express's internal router shape. These properties are stable in Express 4/5
// but not part of the public typings, so we model them locally rather than
// reaching for `any`.
interface ExpressRoute {
  path?: string;
  methods?: Record<string, boolean>;
  stack?: ExpressLayer[];
}

interface ExpressLayer {
  route?: ExpressRoute;
  name?: string;
  handle?: (RequestHandler & { stack?: ExpressLayer[]; _requiredRoles?: readonly string[] })
    | (Router & { stack?: ExpressLayer[] });
}

interface ExpressWithRouter {
  _router?: { stack?: ExpressLayer[] };
}

function extractRoutePermissions(app: Express): RoutePermission[] {
  const out: RoutePermission[] = [];
  const stack: ExpressLayer[] = (app as Express & ExpressWithRouter)._router?.stack ?? [];
  function walk(layers: ExpressLayer[], basePath = ""): void {
    for (const layer of layers) {
      if (layer.route) {
        const path = basePath + (layer.route.path ?? "");
        const methods = Object.keys(layer.route.methods ?? {}).filter(Boolean);
        let roles: readonly string[] = [];
        for (const handler of layer.route.stack ?? []) {
          const r = (handler.handle as { _requiredRoles?: readonly string[] } | undefined)?._requiredRoles;
          if (Array.isArray(r) && r.length > 0) roles = r;
        }
        for (const m of methods) {
          out.push({
            method: m.toUpperCase(),
            path,
            requiredRoles: roles.length > 0 ? [...roles] : ["public"],
          });
        }
      } else if (layer.name === "router") {
        const nested = (layer.handle as { stack?: ExpressLayer[] } | undefined)?.stack;
        if (nested) walk(nested, basePath);
      }
    }
  }
  walk(stack);
  return out
    .filter((r) => r.path.startsWith("/api/"))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function registerPermissionsAuditRoutes(app: Express) {
  // Admin "permissions audit" — lists every registered route + its required role.
  app.get("/api/admin/route-permissions", requireRole("admin"), (req: Request, res: Response) => {
    res.json({ routes: extractRoutePermissions(app) });
  });

  // === Missing list endpoints surfaced by the API surface audit ===

  // Admin user list (alias of /api/admin/users for callers using /api/users).
  app.get("/api/users", requireRole("admin"), async (_req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        authProvider: users.authProvider,
        emailVerified: users.emailVerified,
        totpEnabled: users.totpEnabled,
        createdAt: users.createdAt,
      }).from(users).orderBy(desc(users.createdAt));
      res.json(allUsers);
    } catch (err) {
      serverError(res, err);
    }
  });

  // Paginated merchant index (admin or manager).
  app.get("/api/merchants", requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const profiles = await storage.getMerchantProfiles();
      const total = profiles.length;
      const page = profiles.slice(offset, offset + limit);
      res.json({ data: page, total, limit, offset });
    } catch (err) {
      serverError(res, err);
    }
  });

  // Generic dashboard KPI stats — thin alias of /api/kpi/summary computation
  // so the dashboard can hit a single, predictable endpoint.
  app.get("/api/dashboard/stats", requireRole("admin", "manager", "agent"), async (_req, res) => {
    try {
      const [dealsR, ticketsR, contactsR] = await Promise.all([
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getContacts({ limit: 500 }),
      ]);
      const deals = dealsR.data;
      const tickets = ticketsR.data;
      const contacts = contactsR.data;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const salesDeals = deals.filter((d) => d.pipeline === "sales");
      const closedWon = salesDeals.filter(
        (d) => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= thirtyDaysAgo
      );
      const openTickets = tickets.filter((t) => t.status !== "Resolved" && t.status !== "Closed");
      res.json({
        deals: {
          total: deals.length,
          activeSales: salesDeals.filter((d) => d.stage !== "Closed Won" && d.stage !== "Closed Lost").length,
          closedWon30d: closedWon.length,
        },
        contacts: { total: contacts.length },
        tickets: { open: openTickets.length },
      });
    } catch (err) {
      serverError(res, err);
    }
  });
}
