import {sql} from "drizzle-orm";
const rows=(value:any):any[]=>value?.rows ?? value ?? [];

export async function assertCanonicalPreparationLease(tx:any,key:string,token:string) {
  const held=rows(await tx.execute(sql`WITH pinned AS MATERIALIZED (
    SELECT value FROM system_settings WHERE key=${key} AND value->>'leaseToken'=${token}
    FOR SHARE
  ) SELECT 1 FROM pinned WHERE (value->>'leaseUntil')::timestamptz>clock_timestamp()`));
  if (!held.length) throw new Error("CANONICAL_PREPARATION_CURSOR_LEASE_LOST");
}

/** Persist progress at bounded units, with an exact-token, live-lease CAS.
 * Expired owners cannot renew, release progress, or overwrite a successor. */
export async function checkpointCanonicalPreparationLease(
  tx:any,key:string,token:string,state:Record<string,any>,release=false,
) {
  const value={...state,leaseToken:release ? null : token,leaseUntil:null};
  const held=rows(await tx.execute(sql`WITH pinned AS MATERIALIZED (
    SELECT value FROM system_settings WHERE key=${key} AND value->>'leaseToken'=${token}
    FOR UPDATE
  ) UPDATE system_settings current SET value=${release
    ? sql`${JSON.stringify(value)}::jsonb`
    : sql`jsonb_set(${JSON.stringify(value)}::jsonb,'{leaseUntil}',
        to_jsonb((clock_timestamp()+INTERVAL '2 minutes')::text))`},
    updated_at=clock_timestamp()
    FROM pinned WHERE current.key=${key} AND current.value->>'leaseToken'=${token}
      AND (pinned.value->>'leaseUntil')::timestamptz>clock_timestamp()
    RETURNING current.value`));
  if (!held.length) throw new Error("CANONICAL_PREPARATION_CURSOR_LEASE_LOST");
  if (!release) state.leaseUntil=held[0].value.leaseUntil;
}
