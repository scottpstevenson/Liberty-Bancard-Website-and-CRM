import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { effectiveBusinessVerticalSql } from "@shared/effective-vertical";
import { contactTargetVerticalSql } from "@shared/contact-vertical-taxonomy";
import { assertCanonicalPreparationDatabaseGuard,prepareCanonicalRecipient } from "./canonical-recipient-preparation";
import { claimSfpRuntimeDeploymentOwner,lockCurrentSfpRuntimeOwner } from "./cro03/sfp-provider-operations";

const KEY="canonical_recipient_preparation_cursor";
const rows=(result:any):any[]=>result?.rows ?? result ?? [];
type Cursor={afterContactId:number;cycles:number;scanned:number;prepared:number;held:number;
  reasons:Record<string,number>;leaseToken:string|null;leaseUntil:string|null;lastCycleAt:string|null};

/** Local selection only. Uses the existing published owner, enrollment ledger
 * and queue tick. Provider pauses never gate this pass; it cannot send or spend. */
export async function processCanonicalRecipientPreparationTick() {
  const actorId="system:canonical-recipient-preparation";
  const owner=await claimSfpRuntimeDeploymentOwner();
  const token=randomUUID();
  const fence=async(tx:any)=>{
    const live=await lockCurrentSfpRuntimeOwner(tx);
    if (live.ownerEpoch!==owner.ownerEpoch || live.ownerToken!==owner.ownerToken) {
      throw new Error("CANONICAL_PREPARATION_RUNTIME_OWNER_CHANGED");
    }
    await assertCanonicalPreparationDatabaseGuard(tx);
  };
  const claimed=await db.transaction(async tx=>{
    await fence(tx);
    const initial:Cursor={afterContactId:0,cycles:0,scanned:0,prepared:0,held:0,reasons:{},
      leaseToken:null,leaseUntil:null,lastCycleAt:null};
    await tx.execute(sql`INSERT INTO system_settings(key,value,updated_at)
      VALUES(${KEY},${JSON.stringify(initial)}::jsonb,NOW()) ON CONFLICT(key) DO NOTHING`);
    return rows(await tx.execute(sql`UPDATE system_settings SET
      value=jsonb_set(jsonb_set(value,'{leaseToken}',to_jsonb(${token}::text)),
        '{leaseUntil}',to_jsonb((clock_timestamp()+INTERVAL '2 minutes')::text)),updated_at=NOW()
      WHERE key=${KEY} AND (value->>'leaseUntil' IS NULL
        OR (value->>'leaseUntil')::timestamptz<=clock_timestamp()) RETURNING value`))[0]?.value as Cursor|undefined;
  });
  if (!claimed) return {ran:false,reason:"current_preparation_pass_owned"};
  const state=claimed;
  const guard=async(tx:any)=>{
    await fence(tx);
    const held=rows(await tx.execute(sql`SELECT 1 FROM system_settings
      WHERE key=${KEY} AND value->>'leaseToken'=${token}
        AND (value->>'leaseUntil')::timestamptz>clock_timestamp() FOR SHARE`));
    if (!held.length) throw new Error("CANONICAL_PREPARATION_CURSOR_LEASE_LOST");
  };
  let examined=0,prepared=0;
  const deadline=Date.now()+90_000;
  try {
    const contacts=rows(await db.execute(sql`SELECT c.id,EXISTS (
        SELECT 1 FROM cr04_enrollment_intents owned WHERE owned.contact_id=c.id
          AND owned.preparation_state IN ('pending_validation','ready_held')) AS has_preparation
      FROM contacts c
      WHERE c.id>${state.afterContactId} AND (c.record_class='production' OR EXISTS (
        SELECT 1 FROM cr04_enrollment_intents owned WHERE owned.contact_id=c.id
          AND owned.preparation_state IN ('pending_validation','ready_held')))
      ORDER BY c.id LIMIT 250`));
    // This is candidate retrieval, never write authority. Unbound contacts need
    // no per-row owner-locked transaction; genuine prepared slots still retire
    // under the existing guard, and every actual preparation rechecks its
    // binding and native/runtime authority before writing.
    const bindings=contacts.length ? rows(await db.execute(sql`
      SELECT DISTINCT c.id AS contact_id,p.id AS program_id,seq.id AS sequence_id
      FROM contacts c JOIN businesses b ON b.id=c.business_id
      JOIN sfp_programs p ON p.is_active AND p.taxonomy_version=2
        AND ${sql.raw(effectiveBusinessVerticalSql("b"))}=ANY(p.vertical_ids)
      JOIN follow_up_sequences seq ON seq.trigger_config->>'canonicalProgramId'=p.id::text
        AND seq.trigger_config->'canonicalVerticals' ? ${sql.raw(effectiveBusinessVerticalSql("b"))}
        OR EXISTS(SELECT 1 FROM sfp_campaign_package_versions pkg
          WHERE pkg.sequence_id=seq.id AND pkg.lifecycle_state='current'
            AND ${sql.raw(contactTargetVerticalSql("pkg.vertical"))}=${sql.raw(effectiveBusinessVerticalSql("b"))})
      WHERE c.id IN (${sql.join(contacts.map(contact=>sql`${Number(contact.id)}`),sql`,`)})
        AND c.archived_at IS NULL AND c.do_not_contact IS NOT TRUE
        AND b.record_class='canonical' AND c.email IS NOT NULL
      ORDER BY c.id,p.id,seq.id
    `)) : [];
    const bindingsByContact=new Map<number,Map<string,number[]>>();
    for (const binding of bindings) {
      const contactId=Number(binding.contact_id),programId=String(binding.program_id);
      const programs=bindingsByContact.get(contactId) ?? new Map<string,number[]>();
      programs.set(programId,[...(programs.get(programId) ?? []),Number(binding.sequence_id)]);
      bindingsByContact.set(contactId,programs);
    }
    for (const contact of contacts) {
      if (Date.now()>=deadline) break;
      // Include unavailable/changed recipients: stale paused slots must retire,
      // so suppressions and affiliation changes cannot strand the allowance.
      if (contact.has_preparation===true) await db.transaction(async tx=>{
        await guard(tx);
        const obsolete=rows(await tx.execute(sql`SELECT i.id,i.enrollment_id
          FROM cr04_enrollment_intents i LEFT JOIN contacts c ON c.id=i.contact_id
          LEFT JOIN sfp_programs p ON p.id=i.program_id
          LEFT JOIN businesses b ON b.id=i.business_id
          WHERE i.contact_id=${Number(contact.id)}
            AND i.preparation_state IN ('pending_validation','ready_held')
            AND (c.id IS NULL OR c.record_class IS DISTINCT FROM 'production'
              OR c.archived_at IS NOT NULL OR c.do_not_contact IS TRUE
              OR c.do_not_auto_contact IS TRUE OR c.opted_out_email IS TRUE
              OR c.email_status IN ('invalid','bounced','unsafe','opted_out')
              OR c.business_id IS DISTINCT FROM i.business_id OR p.is_active IS NOT TRUE
              OR i.preparation_snapshot->>'policyVersion' IS DISTINCT FROM p.policy_version::text
              OR i.preparation_snapshot->>'businessSourceFingerprint' IS DISTINCT FROM
                md5(to_jsonb(b)::text||COALESCE((SELECT jsonb_agg(to_jsonb(bl) ORDER BY bl.id)::text
                  FROM business_locations bl WHERE bl.business_id=b.id),'[]'))
              OR encode(sha256(convert_to(lower(trim(c.email)),'UTF8')),'hex')
                IS DISTINCT FROM i.normalized_email_hash)
          FOR UPDATE OF i`));
        for (const intent of obsolete) {
          await tx.execute(sql`UPDATE sequence_enrollments SET status='cancelled',updated_at=NOW()
            WHERE id=${intent.enrollment_id} AND status='paused'
              AND metadata->>'canonicalPreparationId'=${String(intent.id)}`);
          await tx.execute(sql`UPDATE cr04_enrollment_intents SET preparation_state='exception',
            enrollment_id=NULL,reason_code='CURRENT_RECIPIENT_FACTS_CHANGED' WHERE id=${String(intent.id)}::uuid`);
        }
      });
      const programs=bindingsByContact.get(Number(contact.id)) ?? new Map<string,number[]>();
      let advanced=false,reason="NO_CURRENT_PROGRAM_BINDING_OR_AVAILABLE_EMAIL";
      for (const [programId,sequences] of programs) {
        if (sequences.length!==1) {reason="PROGRAM_BINDING_AMBIGUOUS";continue;}
        try {
          const result=await prepareCanonicalRecipient({
            contactId:Number(contact.id),programId,sequenceId:sequences[0],
            actor:{role:"admin",actorId,email:null},source:"canonical_automatic_selection",beforeWrite:guard,
          });
          if (result.enrollmentId) {advanced=true;prepared++;}
          else reason=result.reasonCode;
        } catch(error:any) {
          const message=String(error?.cause?.message ?? error?.message);
          if (!message.includes("CANONICAL_PREPARATION_RECIPIENT_CAPACITY")) throw error;
          reason="USEFUL_RECIPIENT_ALLOWANCE_FILLED";
        }
      }
      state.afterContactId=Number(contact.id);state.scanned++;examined++;
      if (advanced) state.prepared++;
      else {state.held++;state.reasons[reason]=(state.reasons[reason] ?? 0)+1;}
    }
    if (examined===contacts.length && contacts.length<250) {
      state.afterContactId=0;state.cycles++;state.lastCycleAt=new Date().toISOString();
    }
    return {ran:true,examined,prepared,cycles:state.cycles};
  } finally {
    // CAS cannot overwrite a newer pass after crash/expiry.
    state.leaseToken=null;state.leaseUntil=null;
    await db.execute(sql`UPDATE system_settings SET value=${JSON.stringify(state)}::jsonb,updated_at=NOW()
      WHERE key=${KEY} AND value->>'leaseToken'=${token}`);
  }
}