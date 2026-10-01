import { sql } from "drizzle-orm";
import { db } from "../../db";

export const SFP_SELECTED_CONTACTS_MAX = 25;

export interface SfpSelectedContactTarget {
  contactId: number;
  businessId: number;
  linkDecisionId: string;
  linkRevision: number;
}

type QueryExecutor = { execute: (query: any) => Promise<any> };
const rows = (result: any): any[] => result?.rows ?? result ?? [];

/** Undefined preserves the legacy unscoped behavior; any supplied value is strict and bounded. */
export function normalizeSelectedContactIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > SFP_SELECTED_CONTACTS_MAX) {
    throw new Error(`SFP_SELECTED_CONTACT_IDS_INVALID:provide_1_to_${SFP_SELECTED_CONTACTS_MAX}_IDs`);
  }
  const ids = value.map((item) => {
    if (typeof item === "number") return item;
    if (typeof item === "string" && /^\d+$/.test(item.trim())) return Number(item.trim());
    return Number.NaN;
  });
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new Error("SFP_SELECTED_CONTACT_IDS_INVALID:IDs_must_be_unique_positive_integers");
  }
  return ids.sort((a, b) => a - b);
}

/**
 * Resolve an explicit scope only through the current verified link ledger and
 * the matching live contacts.business_id projection. This also requires the
 * contact to still be present in the normal SFP contact-candidate source pool;
 * preview/execute re-run the full candidate, policy, consent, suppression,
 * identity, MX, and provider gates independently.
 */
export async function resolveVerifiedSfpContactTargets(
  selectedContactIds: number[],
  executor: QueryExecutor = db,
): Promise<SfpSelectedContactTarget[]> {
  const normalized = normalizeSelectedContactIds(selectedContactIds);
  if (!normalized) return [];
  const idList = sql.join(normalized.map((id) => sql`${id}`), sql`, `);
  const resolved = rows(await executor.execute(sql`
    SELECT c.id AS contact_id,c.business_id,d.id AS link_decision_id,d.revision
      FROM contacts c
      JOIN businesses b ON b.id=c.business_id AND b.record_class='canonical'
      JOIN contact_business_link_decisions d
        ON d.contact_id=c.id AND d.business_id=c.business_id
       AND d.decision='verified' AND d.superseded_at IS NULL
     WHERE c.id=ANY(ARRAY[${idList}]::integer[])
       AND c.business_id IS NOT NULL
       AND c.archived_at IS NULL
       AND c.record_class NOT IN ('test','demo','synthetic')
       AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
       AND COALESCE(c.do_not_contact,FALSE)=FALSE
       AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
       AND COALESCE(c.opted_out_email,FALSE)=FALSE
       AND c.opt_out_status IS DISTINCT FROM 'opted_out'
       AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
       AND c.complaint_status IS DISTINCT FROM 'reported'
       AND c.bounce_status IS DISTINCT FROM 'hard'
       AND c.email_status IS DISTINCT FROM 'bounced'
       AND c.email_status IS DISTINCT FROM 'invalid'
       AND c.email_status IS DISTINCT FROM 'opted_out'
       AND c.email IS NOT NULL AND BTRIM(c.email)<>''
       AND c.suppression_reason IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM sfp_identity_quarantines q
          WHERE q.business_id=c.business_id AND q.cleared_at IS NULL
       )
     ORDER BY c.id
  `));
  const targets: SfpSelectedContactTarget[] = resolved.map((row: any) => ({
    contactId: Number(row.contact_id),
    businessId: Number(row.business_id),
    linkDecisionId: String(row.link_decision_id),
    linkRevision: Number(row.revision),
  }));
  const resolvedIds = new Set(targets.map((target) => target.contactId));
  const unresolved = normalized.filter((id) => !resolvedIds.has(id));
  if (unresolved.length) {
    throw new Error(`SFP_SELECTED_CONTACT_LINK_NOT_CURRENT_VERIFIED_CANONICAL_OR_CONTACT_SAFE:${unresolved.join(",")}`);
  }
  if (new Set(targets.map((target) => target.businessId)).size !== targets.length) {
    throw new Error("SFP_SELECTED_CONTACT_BUSINESS_NOT_UNIQUE:select_at_most_one_contact_per_business");
  }
  return targets;
}

export function normalizeFrozenContactScope(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  let decoded = value;
  if (typeof decoded === "string") {
    try { decoded = JSON.parse(decoded); } catch {
      throw new Error("SFP_FROZEN_CONTACT_SCOPE_CORRUPT");
    }
  }
  return normalizeSelectedContactIds(decoded);
}