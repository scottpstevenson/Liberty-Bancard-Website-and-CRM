import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { invalidPagination, parseStrictPagination } from "../services/crm-object-access";
import { readRevenueLeads, readRevenueReconciliation, readResidualGroupScope } from "../services/revenue-read-authority";
import { authorizeContactAccess } from "../services/crm-object-access";
import { serverError } from "../utils/server-error";

export function registerRevenueRoutes(app: Express) {
  app.get("/api/revenue/residual-group-scope",isDashboardUser,requireRole("admin","manager"),async(req,res)=>{
    try {
      const raw=req.query.parentId;
      if(raw!==undefined && (typeof raw!=="string" || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw)>2147483647))
        return res.status(400).json({message:"Invalid parent identity"});
      const id=raw===undefined ? undefined : Number(raw);
      const search=req.query.search,period=req.query.period;
      if(search!==undefined && (typeof search!=="string" || search.length>200 || /[\u0000-\u001f\u007f]/.test(search)))
        return res.status(400).json({message:"Invalid observation search"});
      if(period!==undefined && (typeof period!=="string" || (period!=="all" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))))
        return res.status(400).json({message:"Invalid recorded observation period"});
      if(id && !await authorizeContactAccess(req,res,id)) return;
      res.json(await readResidualGroupScope(req.user as any,id,{search:search as string|undefined,period:period as string|undefined}));
    } catch(error) {
      if(error instanceof Error && error.message==="RESIDUAL_GROUP_TARGET_UNAVAILABLE")
        return res.status(409).json({code:error.message,message:"Parent group relationship is unavailable in the authorized report population."});
      serverError(res,error);
    }
  });
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