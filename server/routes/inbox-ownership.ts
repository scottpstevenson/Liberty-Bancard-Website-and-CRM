/**
 * Existing inbox routing controls. All human mutations use the same retained
 * local-work command; these endpoints never send or book anything.
 */
import type {Express,Request,Response} from "express";
import {isDashboardUser,requireRole} from "../replit_integrations/auth";
import {z} from "zod";
import {and,asc,eq,inArray} from "drizzle-orm";
import {db} from "../db";
import {users} from "@shared/schema";
import {storage} from "../storage";
import {getInboxItem,updateInboxItem} from "../storage/inbox";
import {serverError} from "../utils/server-error";
import {authorizeInboxItemAccess} from "../services/crm-object-access";
import {bindWorkActor,resolveWorkAssignee,workPrincipalFields,WorkCommandError} from "../services/work-item-command";
import {commandInboxWork,inboxWorkFields} from "../services/inbox-work-command";

export function registerInboxOwnershipRoutes(app:Express) {
  app.get("/api/inbox/staff",isDashboardUser,async(req,res)=>{
    try {
      const staff=await db.transaction(async tx=>{
        const accounts=await tx.select(workPrincipalFields).from(users).where(and(
          eq(users.accountState,"active"),inArray(users.role,["admin","manager","agent"]))).orderBy(asc(users.id)).for("share");
        const result=[];
        for(const account of accounts) {
          try {
            const eligible=await resolveWorkAssignee(account.id,tx,accounts,account.role==="agent");
            result.push({id:eligible.id,email:eligible.email,role:eligible.role});
          } catch(error) {if(!(error instanceof WorkCommandError)) throw error;}
        }
        return result;
      });
      res.json(staff);
    } catch(error) {serverError(res,error);}
  });
  app.get("/api/inbox/items/:id/ownership",isDashboardUser,async(req,res)=>{
    try {
      if(!await authorizeInboxItemAccess(req,res,String(req.params.id))) return;
      const item=await getInboxItem(String(req.params.id));
      if(!item) return res.status(404).json({message:"Inbox work unavailable"});
      res.json(item);
    } catch(error) {serverError(res,error);}
  });
  function handler(operation:"edit"|"escalate"|"book"|"no_show") {
    return async(req:Request,res:Response)=>{
      try {
        const fields=inboxWorkFields.parse(req.body);
        const actor=bindWorkActor(req.user,fields.expectedActorId,fields.expectedAccountVersion);
        res.json(await commandInboxWork({actor,sourceKey:String(req.params.id),operation,fields}));
      } catch(error) {
        if(error instanceof z.ZodError) return res.status(400).json({message:error.errors[0].message});
        if(error instanceof WorkCommandError) return res.status(error.status).json({message:error.message});
        serverError(res,error);
      }
    };
  }
  app.patch("/api/inbox/items/:id/ownership",requireRole("admin","manager","agent"),handler("edit"));
  app.post("/api/inbox/items/:id/escalate",requireRole("admin","manager","agent"),handler("escalate"));
  app.post("/api/inbox/items/:id/book-appointment",requireRole("admin","manager","agent"),handler("book"));
  app.post("/api/inbox/items/:id/no-show",requireRole("admin","manager","agent"),handler("no_show"));

  // Existing scheduled local metadata action; no outbound transport.
  app.post("/api/inbox/sla-check",requireRole("admin","manager"),async(req,res)=>{
    try {
      const {getInboxItemsWithSlaBreaches}=await import("../storage/inbox");
      const breaches=await getInboxItemsWithSlaBreaches();
      // Resolve the complete set before mutation; source keys include namespace.
      for(const item of breaches) {
        if(!await authorizeInboxItemAccess(req,res,`${item.sourceNamespace ?? "legacy"}::${item.sourceItemId}`)) return;
      }
      for(const item of breaches) {
        await storage.createNotification({channel:"internal",title:"Inbox SLA review",
          message:"Local inbox work requires management review.",type:"urgent",
          metadata:{sourceItemId:`${item.sourceNamespace ?? "legacy"}::${item.sourceItemId}`,contactId:item.contactId,
            eventType:"sla_breach",audienceRoles:["admin","manager"]}});
        if(item.status!=="escalated") await updateInboxItem(`${item.sourceNamespace ?? "legacy"}::${item.sourceItemId}`,
          {status:"escalated",priority:"urgent"});
      }
      await storage.createAuditLog({action:"inbox_sla_check_ran",entityType:"inbox_item",entityId:0,actorType:"system",
        details:{breachCount:breaches.length,itemIds:breaches.map(item=>`${item.sourceNamespace ?? "legacy"}::${item.sourceItemId}`)}});
      res.json({breaches:breaches.length,itemIds:breaches.map(item=>`${item.sourceNamespace ?? "legacy"}::${item.sourceItemId}`)});
    } catch(error) {serverError(res,error);}
  });
}
