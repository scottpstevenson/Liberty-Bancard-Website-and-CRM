import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

async function main() {
  // 1. Feature flags / guards
  const flags = await db.execute(sql`
    SELECT key, value FROM system_settings
    WHERE key IN (
      'deliveryNoProspectSendEmail','deliveryNoProspectSendSms',
      'SMS_ENABLED','VOICE_AI_ENABLED','RINGLESS_VM_ENABLED','SDR_ENABLED'
    ) ORDER BY key
  `);
  console.log("FLAGS:", JSON.stringify(Object.fromEntries((flags.rows as any[]).map(r=>[r.key,r.value]))));

  // 2. Live enrollment counts
  const enroll = await db.execute(sql`
    SELECT s.name, COUNT(*) as cnt
    FROM sequence_enrollments e
    JOIN follow_up_sequences s ON s.id = e.sequence_id
    WHERE e.status='active'
    GROUP BY s.name ORDER BY cnt DESC LIMIT 10
  `);
  console.log("LIVE_ENROLLMENTS:", JSON.stringify(enroll.rows));

  // 3. Raw template vars still in step bodies
  const tmpl = await db.execute(sql`
    SELECT ss.id, s.name, ss.step_order
    FROM sequence_steps ss JOIN follow_up_sequences s ON s.id=ss.sequence_id
    WHERE ss.action_type='email'
      AND (ss.body ILIKE '%{{agentPhone}}%' OR ss.body ILIKE '%{{agentEmail}}%')
    ORDER BY s.name, ss.step_order
  `);
  console.log("RAW_TEMPLATE_VARS:", JSON.stringify(tmpl.rows));

  // 4. Contacts schema KL columns
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='contacts'
      AND column_name IN ('phoneType','phone_type','consentTier','consent_tier',
        'lifecycleStage','lifecycle_stage','timezone','doNotAutoContact','do_not_auto_contact',
        'pewcCapturedAt','pewc_captured_at')
    ORDER BY column_name
  `);
  console.log("KL_COLS_PRESENT:", JSON.stringify((cols.rows as any[]).map(r=>r.column_name)));

  // 5. Consent audit log columns
  const pewc = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='consent_audit_logs' ORDER BY column_name
  `).catch(()=>({rows:[]}));
  console.log("CONSENT_AUDIT_COLS:", JSON.stringify((pewc.rows as any[]).map(r=>r.column_name)));

  // 6. Channel permissions
  const cp = await db.execute(sql`SELECT channel, is_enabled, approved_at FROM channel_permissions ORDER BY channel`).catch(()=>({rows:"NO_TABLE"}));
  console.log("CHANNEL_PERMS:", JSON.stringify(cp.rows));

  // 7. Top audit actions
  const acts = await db.execute(sql`
    SELECT action, COUNT(*) as cnt FROM audit_logs
    GROUP BY action ORDER BY cnt DESC LIMIT 25
  `);
  console.log("AUDIT_ACTIONS:", JSON.stringify((acts.rows as any[]).map(r=>({a:r.action,n:r.cnt}))));

  // 8. Sequence counts
  const seqs = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM follow_up_sequences GROUP BY status
  `);
  console.log("SEQ_COUNTS:", JSON.stringify(seqs.rows));

  // 9. DNC contacts
  const dnc = await db.execute(sql`SELECT COUNT(*) as cnt FROM contacts WHERE "doNotAutoContact"=true`);
  console.log("DNC_CONTACTS:", (dnc.rows[0] as any).cnt);

  // 10. Contacts total + with email
  const cts = await db.execute(sql`
    SELECT COUNT(*) as total,
      COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '') as with_email
    FROM contacts
  `);
  console.log("CONTACTS:", JSON.stringify(cts.rows[0]));
}
main().catch(e=>{console.error(e);process.exit(1);});
