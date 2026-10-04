import { sql } from "drizzle-orm";
import { db } from "../db";
import { effectiveBusinessVerticalSql,effectiveContactVerticalSql,
  effectiveBusinessVerticalStatusSql,effectiveContactVerticalStatusSql } from "@shared/effective-vertical";

const KEY = "crm_effective_vertical_projection_v1";
const rows = (result: any): any[] => result?.rows ?? result ?? [];
/** Bounded/resumable, entirely DB-local. Does not classify from a filename,
 * modify raw labels/history, contact providers, or change outbound state. */
export async function processEffectiveVerticalProjectionTick(limit = 2500) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("CRM_PROJECTION_PAGE_LIMIT_INVALID");
  const pageLimit=Math.min(limit,5000);
  return db.transaction(async tx => {
    const locked = rows(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(
      hashtextextended(${KEY},0)) AS locked`))[0]?.locked;
    if (!locked) return { ran: false };
    await tx.execute(sql`INSERT INTO system_settings(key,value,updated_at)
      VALUES (${KEY},'{"businessCursor":0,"contactCursor":0,"cycles":0}'::jsonb,NOW())
      ON CONFLICT(key) DO NOTHING`);
    let state = rows(await tx.execute(sql`SELECT value FROM system_settings WHERE key=${KEY} FOR UPDATE`))[0].value;
    if (state.coverageVersion!==2 || state.scanStartedAt == null) {
      // Legacy cursors have no frozen population or scanned-row accounting.
      // Start a verifiable pass rather than rebrand an old partial pass as one.
      const population=rows(await tx.execute(sql`SELECT clock_timestamp()::text AS started_at,
        (SELECT COALESCE(max(id),0) FROM businesses)::integer AS business_high_water,
        (SELECT COALESCE(max(id),0) FROM contacts)::integer AS contact_high_water,
        (SELECT count(*) FROM businesses)::integer AS business_total,
        (SELECT count(*) FROM contacts)::integer AS contact_total`))[0];
      state={...state,coverageVersion:2,scope:"all_record_classes",
        businessCursor:0,contactCursor:0,scanStartedAt:population.started_at,
        businessHighWater:population.business_high_water,contactHighWater:population.contact_high_water,
        populationBusinesses:population.business_total,populationContacts:population.contact_total,
        businessesScanned:0,contactsScanned:0,businessesChanged:0,contactsChanged:0,
        verifiedCycles:Number(state.verifiedCycles ?? 0)};
    }
    const businessPage = rows(await tx.execute(sql`SELECT b.id,
      ${sql.raw(effectiveBusinessVerticalSql("b"))} AS vertical,
      ${sql.raw(effectiveBusinessVerticalStatusSql("b"))} AS status
      FROM businesses b WHERE b.id>${Number(state.businessCursor ?? 0)}
        AND b.id<=${Number(state.businessHighWater)}
      ORDER BY b.id LIMIT ${pageLimit}`));
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
        AND c.id<=${Number(state.contactHighWater)}
      ORDER BY c.id LIMIT ${pageLimit}`));
    const contactChanged = contactPage.length ? rows(await tx.execute(sql`
      UPDATE contacts c SET effective_vertical_id=v.vertical,effective_vertical_status=v.status
      FROM (VALUES ${sql.join(contactPage.map((c: any) => sql`(${c.id}::integer,${c.vertical}::text,
         ${c.status}::text)`),sql`, `)})
        v(id,vertical,status) WHERE c.id=v.id AND (c.effective_vertical_id,c.effective_vertical_status)
          IS DISTINCT FROM (v.vertical,v.status) RETURNING c.id`)).length : 0;
    const complete = !businessPage.length && !contactPage.length;
    const next = {...state,businessCursor: businessPage.at(-1)?.id ?? state.businessCursor,
      contactCursor: contactPage.at(-1)?.id ?? state.contactCursor,
      cycles: Number(state.cycles ?? 0)+(complete ? 1 : 0),
      verifiedCycles:Number(state.verifiedCycles ?? 0)+(complete ? 1 : 0),
      businessesScanned:Number(state.businessesScanned)+businessPage.length,
      contactsScanned:Number(state.contactsScanned)+contactPage.length,
      businessesChanged:Number(state.businessesChanged)+businessChanged,
      contactsChanged:Number(state.contactsChanged)+contactChanged,
      businessChanged,contactChanged,lastCompletedAt: complete ? new Date().toISOString() : state.lastCompletedAt ?? null,
      lastTickAt: new Date().toISOString(),
      outboundChanges: 0,providerCalls: 0 };
    if (complete) {
      next.lastCompletedCoverage={
        scope:next.scope,startedAt:next.scanStartedAt,completedAt:next.lastCompletedAt,
        businessHighWater:next.businessHighWater,contactHighWater:next.contactHighWater,
        populationBusinesses:next.populationBusinesses,populationContacts:next.populationContacts,
        businessesScanned:next.businessesScanned,contactsScanned:next.contactsScanned,
        businessesChanged:next.businessesChanged,contactsChanged:next.contactsChanged,
      };
      next.scanStartedAt=null;
      next.businessCursor = 0; next.contactCursor = 0;
    }
    await tx.execute(sql`UPDATE system_settings SET value=${JSON.stringify(next)}::jsonb,
      updated_at=NOW() WHERE key=${KEY}`);
    return { ran: true,...next };
  });
}