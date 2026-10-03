import { sql } from "drizzle-orm";
import { db } from "../db";
import { effectiveBusinessVerticalSql,effectiveContactVerticalSql,
  effectiveBusinessVerticalStatusSql,effectiveContactVerticalStatusSql } from "@shared/effective-vertical";

const KEY = "crm_effective_vertical_projection_v1";
const rows = (result: any): any[] => result?.rows ?? result ?? [];
/** Bounded/resumable, entirely DB-local. Does not classify from a filename,
 * modify raw labels/history, contact providers, or change outbound state. */
export async function processEffectiveVerticalProjectionTick(limit = 2500) {
  return db.transaction(async tx => {
    const locked = rows(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(
      hashtextextended(${KEY},0)) AS locked`))[0]?.locked;
    if (!locked) return { ran: false };
    await tx.execute(sql`INSERT INTO system_settings(key,value,updated_at)
      VALUES (${KEY},'{"businessCursor":0,"contactCursor":0,"cycles":0}'::jsonb,NOW())
      ON CONFLICT(key) DO NOTHING`);
    const state = rows(await tx.execute(sql`SELECT value FROM system_settings WHERE key=${KEY} FOR UPDATE`))[0].value;
    const businessPage = rows(await tx.execute(sql`SELECT b.id,
      ${sql.raw(effectiveBusinessVerticalSql("b"))} AS vertical,
      ${sql.raw(effectiveBusinessVerticalStatusSql("b"))} AS status
      FROM businesses b WHERE b.id>${Number(state.businessCursor ?? 0)}
      ORDER BY b.id LIMIT ${Math.max(1,Math.min(limit,5000))}`));
    const businessChanged = businessPage.length ? rows(await tx.execute(sql`
      UPDATE businesses b SET effective_vertical_id=v.vertical,
        effective_vertical_status=v.status
      FROM (VALUES ${sql.join(businessPage.map((b: any) => sql`(${b.id}::integer,${b.vertical}::text,${b.status}::text)`),sql`, `)})
        v(id,vertical,status) WHERE b.id=v.id AND (b.effective_vertical_id,b.effective_vertical_status)
          IS DISTINCT FROM (v.vertical,v.status)
      RETURNING b.id`)).length : 0;
    const contactPage = rows(await tx.execute(sql`SELECT c.id,
      ${sql.raw(effectiveContactVerticalSql("c"))} AS vertical,
      ${sql.raw(effectiveContactVerticalStatusSql("c"))} AS status
      FROM contacts c WHERE c.id>${Number(state.contactCursor ?? 0)}
      ORDER BY c.id LIMIT ${Math.max(1,Math.min(limit,5000))}`));
    const contactChanged = contactPage.length ? rows(await tx.execute(sql`
      UPDATE contacts c SET effective_vertical_id=v.vertical,effective_vertical_status=v.status
      FROM (VALUES ${sql.join(contactPage.map((c: any) => sql`(${c.id}::integer,${c.vertical}::text,
         ${c.status}::text)`),sql`, `)})
        v(id,vertical,status) WHERE c.id=v.id AND (c.effective_vertical_id,c.effective_vertical_status)
          IS DISTINCT FROM (v.vertical,v.status) RETURNING c.id`)).length : 0;
    const complete = !businessPage.length && !contactPage.length;
    const next = { businessCursor: businessPage.at(-1)?.id ?? state.businessCursor,
      contactCursor: contactPage.at(-1)?.id ?? state.contactCursor,
      cycles: Number(state.cycles ?? 0)+(complete ? 1 : 0),
      businessChanged,contactChanged,lastCompletedAt: complete ? new Date().toISOString() : state.lastCompletedAt ?? null,
      lastTickAt: new Date().toISOString(),
      outboundChanges: 0,providerCalls: 0 };
    if (complete) { next.businessCursor = 0; next.contactCursor = 0; }
    await tx.execute(sql`UPDATE system_settings SET value=${JSON.stringify(next)}::jsonb,
      updated_at=NOW() WHERE key=${KEY}`);
    return { ran: true,...next };
  });
}