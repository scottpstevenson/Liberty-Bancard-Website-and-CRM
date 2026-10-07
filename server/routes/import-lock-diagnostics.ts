import type {Express} from "express";
import {isDashboardUser,requireRole} from "../replit_integrations/auth";
import {importLockCapture} from "../services/primary-lock-capture";

/** Evidence only. Neither route runs recovery, alters controls or writes DB data. */
export function registerImportLockDiagnosticRoutes(app: Express) {
  app.get("/api/admin/import-recovery/lock-capture",isDashboardUser,requireRole("admin"),(_req,res)=>{
    res.set("Cache-Control","no-store").json(importLockCapture.status());
  });
  app.post("/api/admin/import-recovery/lock-capture",isDashboardUser,requireRole("admin"),(req,res)=>{
    if (req.body && Object.keys(req.body).length)
      return res.status(400).json({message:"Lock capture accepts no parameters"});
    res.set("Cache-Control","no-store").status(202).json(importLockCapture.start({runtimeDiagnostics:true}));
  });
}
