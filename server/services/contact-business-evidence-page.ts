import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { SystemLinkFacts } from "./contact-business-system-link-policy";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Match generation and the native write fence call the SAME database evaluator.
 * A candidate or a matching company name alone is never relationship authority.
 */
export async function loadEvidenceRelationshipPage(
  executor: any, afterContactId: number, limit: number, onlyContactId?: number, changedSince?: string,
) {
  const contacts = rows(await executor.execute(sql`
    SELECT c.id contact_id,c.company_name,c.website contact_website,c.email contact_email,
      c.record_class contact_record_class,c.email_status,c.archived_at,c.address,c.city,c.state,c.phone,
      c.updated_at::text AS contact_revision,c.business_id projected_business_id,
      c.existing_merchant_customer,c.do_not_contact,c.do_not_auto_contact,c.opted_out_email,
      c.opt_out_status,c.unsubscribe_status,c.bounce_status,c.complaint_status,c.suppression_reason,
      d.id current_decision_id,d.decision current_decision
    FROM contacts c LEFT JOIN contact_business_link_decisions d
      ON d.contact_id=c.id AND d.superseded_at IS NULL
    WHERE ${onlyContactId === undefined ? sql`c.id>${afterContactId}` : sql`c.id=${onlyContactId}`}
      AND ${changedSince && onlyContactId === undefined ? sql`(c.updated_at>=${changedSince}::timestamptz OR
        EXISTS (SELECT 1 FROM businesses changed WHERE changed.updated_at>=${changedSince}::timestamptz
          AND crm_identity_name(changed.canonical_name)=crm_identity_name(c.company_name)))` : sql`TRUE`}
    ORDER BY c.id LIMIT ${limit + (onlyContactId === undefined ? 1 : 0)}
  `));
  const page = contacts.slice(0, limit);
  const ids = page.map((c: any) => Number(c.contact_id));
  const matches = ids.length ? rows(await executor.execute(sql`
    SELECT c.id contact_id,b.id business_id,b.canonical_name,b.website_domain business_domain,
      b.record_class business_record_class,b.do_not_visit,b.updated_at::text business_revision,
      sl.id source_link_id,sl.source_system,sl.source_type,sl.stable_key source_stable_key,
      sl.updated_at::text source_revision,se.id source_entity_id,se.entity_name sunbiz_name,
      se.dba sunbiz_dba,se.principal_address,se.principal_city,se.principal_state,
      to_jsonb(se)->>'updated_at' entity_revision,
      se.website sunbiz_website,se.source sunbiz_entity_source,se.filing_number,
      crm_automatic_relationship_reasons(c.id,b.id,sl.id,se.id) relationship_reasons
    FROM contacts c JOIN businesses b ON b.record_class='canonical'
    JOIN canonical_source_links sl ON sl.business_id=b.id
    LEFT JOIN sunbiz_entities se ON sl.source_system='sunbiz' AND sl.source_type='sunbiz_entity'
      AND se.filing_number=sl.stable_key AND se.source IN ('sunbiz','cordata','corevt')
    WHERE c.id=ANY(ARRAY[${sql.join(ids.map((id: number) => sql`${id}`),sql`, `)}]::integer[])
      AND (crm_identity_name(c.company_name)<>'' AND
        crm_identity_name(c.company_name) IN (crm_identity_name(b.canonical_name),
          crm_identity_name(se.entity_name),crm_identity_name(se.dba))
        OR crm_identity_domain(c.website) IS NOT NULL
          AND crm_identity_domain(c.website)=crm_identity_domain(b.website_domain)
        OR EXISTS (SELECT 1 FROM contact_source_events ev WHERE ev.contact_id=c.id
          AND (ev.metadata->>'filingNumber'=sl.stable_key OR ev.metadata->>'filing_number'=sl.stable_key
            OR ev.metadata->>'place_id'=sl.stable_key OR ev.metadata->>'placeId'=sl.stable_key
            OR ev.metadata->>'google_place_id'=sl.stable_key)))
    ORDER BY c.id,b.id,sl.source_system,sl.id,se.id
  `)) : [];
  const selected: SystemLinkFacts[] = [];
  const previews = page.map((c: any) => {
    const alternatives = matches.filter((m: any) => Number(m.contact_id) === Number(c.contact_id));
    const eligible = alternatives.filter((m: any) => m.relationship_reasons?.length === 0);
    const eligibleBusinesses = new Set(eligible.map((m: any) => Number(m.business_id)));
    const winner = eligibleBusinesses.size === 1 ? eligible[0] : undefined;
    const reasons = winner ? [] : eligibleBusinesses.size > 1 ? ["competing_corroborated_businesses"]
      : alternatives.length ? [...new Set(alternatives.flatMap((m: any) => m.relationship_reasons))]
        : ["independent_business_identity_not_found"];
    const facts = winner ? {
      ...c,...winner,contactId: Number(c.contact_id),businessId: Number(winner.business_id),
      sourceLinkId: String(winner.source_link_id),
      sourceEntityId: winner.source_entity_id == null ? null : Number(winner.source_entity_id),
      companyName: c.company_name,contactWebsite: c.contact_website,contactEmail: c.contact_email,
      canonicalName: winner.canonical_name,businessDomain: winner.business_domain,
      sourceSystem: winner.source_system,sourceType: winner.source_type,
      sourceStableKey: winner.source_stable_key,filingNumber: winner.filing_number,
      relationshipReasons: reasons,
      identityRevision: hash([c.contact_revision,winner.business_revision,winner.source_revision,
        c.company_name,c.address,c.city,c.state,c.phone,winner.source_entity_id,winner.entity_revision,
        winner.sunbiz_name,winner.sunbiz_dba,winner.principal_address,winner.principal_city,winner.principal_state]),
    } as SystemLinkFacts : undefined;
    if (facts) selected.push(facts);
    return {
      contactId: Number(c.contact_id),businessId: winner ? Number(winner.business_id) : null,
      companyName: c.company_name ?? null,sourceLinkId: facts?.sourceLinkId ?? null,
      sourceEntityId: facts?.sourceEntityId ?? null,eligible: !!winner,reasons,
      snapshotHash: hash(facts ? [facts.contactId,facts.businessId,facts.sourceLinkId,
        facts.sourceEntityId,facts.identityRevision] : [c.contact_id,reasons]),
    };
  });
  return { previews,selectedFacts: onlyContactId === undefined ? undefined : selected[0],
    selectedFactsForPage: selected,lastContactId: page.length ? Number(page.at(-1).contact_id) : afterContactId,
    hasMore: contacts.length > limit };
}