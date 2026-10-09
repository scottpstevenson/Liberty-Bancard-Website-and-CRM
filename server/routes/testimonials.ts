import type {Express} from "express";
import {isAuthenticated,requireRole} from "../replit_integrations/auth";
import {storage} from "../storage";
import {serverError} from "../utils/server-error";

/** Retained staff story reader/moderation handlers; no send or provider work. */
export function registerTestimonialRoutes(app:Express){
  const staff=requireRole("admin","manager");
  const recordId=(raw:string)=>/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
  app.get("/api/testimonial-submissions",isAuthenticated,staff,async(req,res)=>{
    try{
      const raw=req.query.status;
      if(raw!==undefined&&(typeof raw!=="string"||!["pending","approved","rejected","all"].includes(raw)))
        return res.status(400).json({message:"Invalid/conflicting story status"});
      res.json(await storage.getTestimonialSubmissions(raw==="all"?undefined:raw as string|undefined));
    }catch(error){serverError(res,error);}
  });
  app.get("/api/testimonial-submissions/:id",isAuthenticated,staff,async(req,res)=>{
    try{
      const id=recordId(String(req.params.id));
      if(id==null)return res.status(400).json({message:"Valid story ID required"});
      const submission=await storage.getTestimonialSubmission(id);
      if(!submission)return res.status(404).json({message:"Not found"});
      res.json(submission);
    }catch(error){serverError(res,error);}
  });
  app.patch("/api/testimonial-submissions/:id",isAuthenticated,staff,async(req,res)=>{
    try{
      const id=recordId(String(req.params.id));
      if(id==null)return res.status(400).json({message:"Valid story ID required"});
      // Preserve the retained command contract; this extraction is not a
      // durable acceptance, publication, concurrency or version certificate.
      const allowed=["status","publish","reviewNotes","reviewedBy"] as const;
      const updates:Record<string,any>={};
      for(const key of allowed)if(key in req.body)updates[key]=req.body[key];
      if(updates.status&&!["pending","approved","rejected"].includes(updates.status))
        return res.status(400).json({message:"Invalid status"});
      const user=req.user as any;
      if(updates.status&&updates.status!=="pending"&&!updates.reviewedBy)
        updates.reviewedBy=user?.email||user?.id||"staff";
      const updated=await storage.updateTestimonialSubmission(id,updates);
      if(!updated)return res.status(404).json({message:"Not found"});
      res.json(updated);
    }catch(error){serverError(res,error);}
  });
}
