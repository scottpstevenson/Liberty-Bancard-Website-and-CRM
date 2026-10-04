import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } from "./contact-business-system-links";
import { assertSystemLinkDatabaseGuard } from "./commercial-link-authority";
import {
  claimSfpRuntimeDeploymentOwner,
  lockCurrentSfpRuntimeOwner,
} from "./cro03/sfp-provider-operations";

const KEY = "contact_link_automation_v1";
const RULE = "independent_guarded_system_links_v2";
type Program = {
  version: 1; rule: string; runId: string; enabled: boolean; authorizedBy: string;
  cursor: number; scanned: number; committed: number; replayed: number; held: number;
  reasons: Record<string, number>; leaseToken: string | null; leaseUntil: string | null;
  updatedAt: string; lastError: string | null; complete: boolean;
  scanStartedAt?: string; changedSince?: string; backfillComplete?: boolean;
};
export async function getContactLinkAutomationStatus(): Promise<Program | null> {
  const result = await pool.query("SELECT value FROM system_settings WHERE key=$1", [KEY]);
  const state = result.rows[0]?.value;
  return state?.version === 1 && state?.rule === RULE ? state : null;
}

/** Operator enable/disable override; routine initialization is automatic. */
export async function setContactLinkAutomation(enabled: boolean, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [KEY]);
    const stored = await client.query("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [KEY]);
    const previous = stored.rows[0]?.value as Program | undefined;
    if (previous && (previous.version !== 1 || previous.rule !== RULE)) {
      throw new Error("CONTACT_LINK_AUTOMATION_RULE_UPGRADE_REQUIRED");
    }
    const state: Program = previous ?? {
      version: 1, rule: RULE, runId: crypto.randomUUID(), enabled: false, authorizedBy: actorId,
      cursor: 0, scanned: 0, committed: 0, replayed: 0, held: 0, reasons: {},
      leaseToken: null, leaseUntil: null, complete: false, lastError: null, updatedAt: new Date().toISOString(),
    };
    state.enabled = enabled;
    state.authorizedBy = actorId;
    state.updatedAt = new Date().toISOString();
    await client.query(`INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=NOW()`, [KEY, JSON.stringify(state)]);
    await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES($1,'contact_link_automation_authorized','contact_link_program',$2,$3::jsonb,'user',$1)`,
      [actorId, state.runId, JSON.stringify({ enabled, rule: RULE, paidProviderCalls: 0, outboundChanges: 0 })]);
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/**
 * DB-backed claim, bounded keyset pages and token-fenced checkpoints.
 * Never impersonates a reviewer. The canonical writer rechecks the immutable
 * evidence/snapshot and actual database guard for every automatic decision.
 */
export async function processContactLinkAutomationTick() {
  // A policy repair must revisit earlier held records even when their source
  // rows did not change. Preserve authorization/off state and live leases.
  await pool.query(`UPDATE system_settings SET value=value ||
    '{"rule":"independent_guarded_system_links_v2","cursor":0,"complete":false,
      "changedSince":null,"scanStartedAt":null,"backfillComplete":false}'::jsonb,
    updated_at=NOW()
    WHERE key=$1 AND value->>'rule'='independent_guarded_system_links_v1'
      AND (value->>'leaseUntil' IS NULL OR (value->>'leaseUntil')::timestamptz<=NOW())`, [KEY]);
  const exists = await pool.query("SELECT value FROM system_settings WHERE key=$1", [KEY]);
  // Do not renew deployment ownership or implicitly reactivate an operator hold.
  if (exists.rows[0] && exists.rows[0].value?.enabled !== true) return { ran: false };
  await assertSystemLinkDatabaseGuard(db);
  // Local identity linking has no cohort or paid-provider admission dependency.
  // Reuse the selected deployment owner; old builds and explicit revocation
  // remain fenced even after a program was initialized by an earlier build.
  const owner = await claimSfpRuntimeDeploymentOwner();
  if (!exists.rowCount) {
    const initial: Program = {version:1,rule:RULE,runId:crypto.randomUUID(),enabled:true,
      authorizedBy:`system:canonical_contact_links_owner_epoch_${owner.ownerEpoch}`,cursor:0,scanned:0,
      committed:0,replayed:0,held:0,reasons:{},leaseToken:null,leaseUntil:null,
      updatedAt:new Date().toISOString(),lastError:null,complete:false};
    await db.transaction(async tx => {
      const currentOwner = await lockCurrentSfpRuntimeOwner(tx);
      if (currentOwner.ownerEpoch !== owner.ownerEpoch || currentOwner.ownerToken !== owner.ownerToken) {
        throw new Error("CONTACT_LINK_AUTOMATION_RUNTIME_OWNER_CHANGED");
      }
      await assertSystemLinkDatabaseGuard(tx);
      // A concurrent explicit off decision always wins over automatic bootstrap.
      await tx.execute(sql`INSERT INTO system_settings(key,value,updated_at)
        VALUES(${KEY},${JSON.stringify(initial)}::jsonb,NOW()) ON CONFLICT(key) DO NOTHING`);
    });
  }
  const token = crypto.randomUUID();
  const claim = await db.transaction(async tx => {
    const currentOwner = await lockCurrentSfpRuntimeOwner(tx);
    if (currentOwner.ownerEpoch !== owner.ownerEpoch || currentOwner.ownerToken !== owner.ownerToken) {
      throw new Error("CONTACT_LINK_AUTOMATION_RUNTIME_OWNER_CHANGED");
    }
    await assertSystemLinkDatabaseGuard(tx);
    const result = await tx.execute(sql`UPDATE system_settings
      SET value=jsonb_set(jsonb_set(value,'{leaseToken}',to_jsonb(${token}::text)),
        '{leaseUntil}',to_jsonb((clock_timestamp()+INTERVAL '2 minutes')::text)),updated_at=NOW()
      WHERE key=${KEY} AND value->>'enabled'='true' AND value->>'version'='1' AND value->>'rule'=${RULE}
        AND (value->>'leaseUntil' IS NULL OR (value->>'leaseUntil')::timestamptz <= clock_timestamp())
      RETURNING value,clock_timestamp()::text AS scan_time`);
    return (result as any).rows as any[];
  });
  const state = claim[0]?.value as Program | undefined;
  if (!state) return { ran: false };
  try {
    if (!state.scanStartedAt || state.complete) {
      if (state.complete) {
        state.backfillComplete = true;
        state.changedSince = state.scanStartedAt;
        state.cursor = 0;
        state.complete = false;
      }
      state.scanStartedAt = claim[0].scan_time;
      await checkpoint(state, token);
    }
    const preview = await previewContactBusinessSystemLinks({
      afterContactId: state.cursor, limit: 25, changedSince: state.changedSince,
    });
    if (!preview.schemaReady) throw new Error("COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING");
    for (const candidate of preview.rows) {
      const current = await getContactLinkAutomationStatus();
      if (!current?.enabled || current.leaseToken !== token) break;
      let outcome: any = null;
      if (candidate.eligible) outcome = await applyContactBusinessSystemLink(candidate as any, async tx => {
        const currentOwner = await lockCurrentSfpRuntimeOwner(tx);
        if (currentOwner.ownerEpoch !== owner.ownerEpoch || currentOwner.ownerToken !== owner.ownerToken) {
          throw new Error("CONTACT_LINK_AUTOMATION_RUNTIME_OWNER_CHANGED");
        }
        const result = await tx.execute(sql`SELECT value,
          (value->>'leaseUntil')::timestamptz > NOW() AS live
          FROM system_settings WHERE key=${KEY} FOR SHARE`);
        const pinned = (result as any).rows?.[0];
        if (pinned?.value?.leaseToken !== token || pinned?.live !== true) {
          throw new Error("CONTACT_LINK_AUTOMATION_LEASE_LOST");
        }
        if (pinned.value.enabled !== true) throw new Error("CONTACT_LINK_AUTOMATION_DISABLED");
        return true;
      });
      // Authority/lease loss is retryable, not an identity-conflict disposition.
      // Keep this contact ahead of the cursor so restoration needs no manual
      // rewind, source-row update, or fresh cohort.
      if (outcome?.status === "rejected" && /(?:AUTHORITY_FENCE_LOST|DATABASE_GUARD_MISSING|RUNTIME_OWNER|LEASE_LOST|AUTOMATION_DISABLED)/.test(outcome.code ?? "")) {
        throw new Error(outcome.code);
      }
      state.scanned++;
      if (outcome?.status === "applied") state.committed++;
      else if (outcome?.status === "replayed") state.replayed++;
      else {
        state.held++;
        for (const reason of outcome?.code ? [outcome.code] : candidate.reasons ?? ["independent_identity_unresolved"]) {
          state.reasons[reason] = (state.reasons[reason] ?? 0) + 1;
        }
      }
      state.cursor = candidate.contactId;
      // Save after every canonical writer receipt; a crash cannot lose page progress.
      await checkpoint(state, token);
    }
    if (state.scanned > 0 && preview.nextCursor === null &&
        state.cursor === preview.rows.at(-1)?.contactId) state.complete = true;
    if (!preview.rows.length) state.complete = true;
    state.lastError = null;
    return { ran: true, scanned: state.scanned, committed: state.committed, held: state.held, complete: state.complete };
  } catch (error: any) {
    state.lastError = String(error?.code ?? error?.message ?? "CONTACT_LINK_AUTOMATION_FAILED").slice(0, 180);
    throw error;
  } finally {
    state.leaseToken = null;
    state.leaseUntil = null;
    await checkpoint(state, token);
  }
}

async function checkpoint(state: Program, token: string) {
  state.updatedAt = new Date().toISOString();
  // Preserve the latest operator enable/pause decision instead of overwriting it.
  const result = await pool.query(`UPDATE system_settings
    SET value=$2::jsonb || jsonb_build_object('enabled',value->'enabled','authorizedBy',value->'authorizedBy'),
        updated_at=NOW()
    WHERE key=$1 AND value->>'leaseToken'=$3 AND (value->>'leaseUntil')::timestamptz > NOW()`,
    [KEY, JSON.stringify(state), token]);
  if (result.rowCount !== 1) throw new Error("CONTACT_LINK_AUTOMATION_LEASE_LOST");
}