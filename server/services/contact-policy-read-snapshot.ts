/**
 * Set-read snapshot for ONE whole-population, read-only contact-policy count (the launch inventory aggregate).
 *
 * `evaluateContactDecisions` is the single authority for hygiene, promotion and send readiness. Run once per recipient it
 * issues about a dozen small reads per contact; for the whole inventory that is the cost that exceeded the read deadline.
 * This module does not re-implement any rule. It loads, in a handful of set queries, the exact rows that authority would
 * read for each contact, and the authority consults the snapshot before it reads. A value the snapshot does not hold is
 * read from the database exactly as before, so a gap makes the read slower, never different.
 *
 * Scope is deliberately narrow:
 *   - The snapshot is carried in AsyncLocalStorage, entered only by the aggregate read. No other request, worker, release,
 *     dispatch or enforcement check runs inside it, so none can be served from it.
 *   - Consumers additionally ignore it unless the check is a dry run.
 *   - Inside it the passive commercial-resolution observation in marketing-email eligibility is skipped. That observation
 *     never persists on this path and its result does not enter the decision (only an optional snapshot id, which a
 *     non-persisting observation never has). Every mutation boundary still runs it.
 * Equality with the per-contact result is asserted by `scripts/test-phase6-inventory-set-reads.ts`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { businessHasDbprLineageSql } from "./dbpr";

type ContactRow = typeof contacts.$inferSelect;

export interface ContactPolicyReadSnapshot {
  readonly contacts: ReadonlyMap<number, ContactRow>;
  /** Business ids whose lineage / customer status were read. A business not listed here is read from the database. */
  readonly dbprLineageByBusiness: ReadonlyMap<number, boolean>;
  readonly customerBusinessIds: ReadonlySet<number>;
  readonly customerLoadedBusinessIds: ReadonlySet<number>;
  /** Merge-fence rows per contact id, for contacts whose fence was read. */
  readonly mergeFenceByContact: ReadonlyMap<number, ReadonlyArray<{ status: string; reconciliation_status: string | null }>>;
  /** Canonical outreach permission state per contact id (email channel); null = no state row. */
  readonly canonicalEmailStateByContact: ReadonlyMap<number, string | null>;
  /** Whether verified express-written evidence exists in the contact's most recent 20 consented audit rows. */
  readonly pewcEvidenceByContact: ReadonlyMap<number, boolean>;
}

const als = new AsyncLocalStorage<ContactPolicyReadSnapshot>();
export const currentContactPolicySnapshot = (): ContactPolicyReadSnapshot | undefined => als.getStore();
export const withContactPolicySnapshot = <T>(snapshot: ContactPolicyReadSnapshot, run: () => Promise<T>): Promise<T> =>
  als.run(snapshot, run);

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
/** A real ARRAY[...]::integer[] expression; an interpolated JS array does not bind as a Postgres array in this driver. */
const intArray = (ids: number[]) => ids.length === 0
  ? sql`ARRAY[]::integer[]`
  : sql`ARRAY[${sql.join(ids.map(id => sql`${id}::integer`), sql`, `)}]::integer[]`;
const CHUNK = 1000;
const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

/** Loads what the policy authority reads for these contacts (email channel, dry run) in a fixed number of set queries. */
export async function loadContactPolicySnapshot(
  pairs: ReadonlyArray<{ contactId: number; businessId: number | null }>,
): Promise<ContactPolicyReadSnapshot> {
  const contactIds = [...new Set(pairs.map(p => p.contactId))];
  const businessIds = [...new Set(pairs.map(p => p.businessId).filter((id): id is number => Number.isSafeInteger(id as number)))];

  const contactMap = new Map<number, ContactRow>();
  const mergeFence = new Map<number, Array<{ status: string; reconciliation_status: string | null }>>();
  const canonicalState = new Map<number, string | null>();
  const duplicateState = new Set<number>();
  const pewc = new Map<number, boolean>();

  for (const ids of chunks(contactIds)) {
    for (const row of await db.select().from(contacts).where(inArray(contacts.id, ids))) contactMap.set(row.id, row);

    for (const id of ids) mergeFence.set(id, []);
    const fence = rowsOf(await db.execute(sql`
      SELECT u.cid AS contact_id, m.status, m.reconciliation_status
        FROM unnest(${intArray(ids)}) AS u(cid)
        JOIN contact_merge_operations m ON u.cid IN (m.survivor_contact_id, m.deprecated_contact_id)
       WHERE m.status IN ('committed','reconciliation_pending')`));
    for (const row of fence) {
      mergeFence.get(Number(row.contact_id))!.push({ status: String(row.status), reconciliation_status: row.reconciliation_status ?? null });
    }

    for (const id of ids) canonicalState.set(id, null);
    const states = rowsOf(await db.execute(sql`
      SELECT cs.subject_record_id AS contact_id, st.permission_state
        FROM consent_subject_channel_states st
        JOIN consent_subjects cs ON cs.id = st.subject_id
       WHERE cs.subject_type = 'contact' AND cs.subject_record_id = ANY(${intArray(ids)})
         AND st.channel = 'email' AND st.purpose = 'outreach'`));
    const seen = new Set<number>();
    for (const row of states) {
      const id = Number(row.contact_id);
      if (seen.has(id)) duplicateState.add(id); // ambiguous: the per-contact read decides
      seen.add(id);
      canonicalState.set(id, String(row.permission_state));
    }

    for (const id of ids) pewc.set(id, false);
    const evidence = rowsOf(await db.execute(sql`
      SELECT contact_id, bool_or(consent_type = 'express_written' AND disclosure_version IS NOT NULL) AS verified
        FROM (SELECT contact_id, consent_type, disclosure_version,
                     row_number() OVER (PARTITION BY contact_id ORDER BY created_at DESC) AS rn
                FROM consent_audit_logs
               WHERE contact_id = ANY(${intArray(ids)}) AND consented = TRUE) recent
       WHERE rn <= 20 GROUP BY contact_id`));
    for (const row of evidence) pewc.set(Number(row.contact_id), Boolean(row.verified));
  }
  for (const id of duplicateState) canonicalState.delete(id);

  const lineage = new Map<number, boolean>();
  const customers = new Set<number>();
  const customerLoaded = new Set<number>();
  for (const ids of chunks(businessIds)) {
    const found = rowsOf(await db.execute(sql`
      SELECT b.id, ${businessHasDbprLineageSql(sql`b.id`)} AS has_dbpr
        FROM unnest(${intArray(ids)}) AS b(id)`));
    for (const row of found) lineage.set(Number(row.id), Boolean(row.has_dbpr));
    for (const id of ids) customerLoaded.add(id);
    const status = rowsOf(await db.execute(sql`
      SELECT id FROM businesses WHERE id = ANY(${intArray(ids)}) AND status = 'customer'`));
    for (const row of status) customers.add(Number(row.id));
  }

  return {
    contacts: contactMap, dbprLineageByBusiness: lineage, customerBusinessIds: customers,
    customerLoadedBusinessIds: customerLoaded, mergeFenceByContact: mergeFence,
    canonicalEmailStateByContact: canonicalState, pewcEvidenceByContact: pewc,
  };
}
