import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

// Existing system_settings owns the cache version, not a new fact/metric
// registry. Cross-process mutations must invalidate another instance's cache.
export async function crmFactRevision() {
  const {db}=await import("../db");
  const {sql}=await import("drizzle-orm");
  const result=await db.execute(sql`SELECT value FROM system_settings WHERE key='crm_fact_cache_revision'`);
  return String((result.rows[0] as any)?.value ?? "initial");
}
export async function advanceCrmFacts() {
  const {db}=await import("../db");
  const {sql}=await import("drizzle-orm");
  const revision=randomUUID();
  await db.execute(sql`INSERT INTO system_settings(key,value,updated_at)
    VALUES('crm_fact_cache_revision',${JSON.stringify(revision)}::jsonb,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`);
}
const commandFamilies = /^\/api\/(?:contacts|companies|deals|tasks|tickets|rfis|notes|call-logs|calendar-events|my-day|crm)(?:\/|$)/;
export const crmFactFreshnessMiddleware: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !commandFamilies.test(req.originalUrl.split("?")[0])) return next();
  // Invalidate also on an error: a multi-step legacy command may already have
  // committed. This is conservative freshness, never rollback/success inference.
  const send = res.json;
  let advanced = false;
  res.json = function(body) {
    if(advanced || res.statusCode>=400 && res.statusCode<500) return send.call(this,body);
    advanced=true;
    void advanceCrmFacts().then(()=>send.call(res,body),()=>{
      res.status(503);
      send.call(res,{code:"CRM_FACT_FRESHNESS_UNCONFIRMED",
        message:"The command may have committed. Reload, or retry the same saved intent; server freshness could not be confirmed."});
    });
    return this;
  };
  next();
};
