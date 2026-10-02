import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { decideContactBusinessLink } from "./commercial-link-authority";
import {
  CORROBORATED_MATCH_RULE, corroboratedIdentitySignals, identityDomain,
  identityName, identityPhone,
} from "./contact-business-corroborated-policy";

const rows = (result: any): any[] => result.rows ?? result;
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizedSqlName = sql.raw(`btrim(regexp_replace(regexp_replace(
  regexp_replace(lower(canonical_name),'[^a-z0-9]+',' ','g'),
  '\\m(inc|incorporated|llc|llp|ltd|limited|corp|corporation|company|co)\\M',' ','g'),
  '[[:space:]]+',' ','g'))`);

async function matchingPage(executor: any, afterContactId: number, limit: number, contactId?: number) {
  const contacts = rows(await executor.execute(sql`
    SELECT c.id,c.company_name,c.website,c.phone,c.email,c.first_name,c.last_name,c.business_id,
           c.do_not_contact,c.opted_out_email,c.unsubscribe_status,c.email_status
      FROM contacts c
     WHERE ${contactId === undefined ? sql`c.id > ${afterContactId}` : sql`c.id=${contactId}`}
       AND c.archived_at IS NULL AND c.business_id IS NULL
       AND COALESCE(c.record_class,'unknown') NOT IN ('test','demo','synthetic')
       AND NULLIF(btrim(c.company_name),'') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM contact_business_link_decisions d
                        WHERE d.contact_id=c.id AND d.superseded_at IS NULL)
     ORDER BY c.id LIMIT ${limit + 1}
  `));
  const page = contacts.slice(0, limit);
  const names = [...new Set(page.map(c => identityName(c.company_name)).filter(Boolean))];
  const businesses = names.length ? rows(await executor.execute(sql`
    SELECT id,canonical_name,website_domain,main_phone,city,state
      FROM businesses WHERE record_class='canonical'
       AND ${normalizedSqlName}=ANY(ARRAY[${sql.join(names.map(n => sql`${n}`), sql`, `)}]::text[])
  `)) : [];
  const byName = new Map<string, any[]>();
  for (const b of businesses) {
    const key = identityName(b.canonical_name);
    byName.set(key, [...(byName.get(key) ?? []), b]);
  }
  const items = page.map(c => {
    const alternatives = (byName.get(identityName(c.company_name)) ?? []).map(b => ({
      business: b,
      signals: corroboratedIdentitySignals(
        { name: c.company_name, website: c.website, phone: c.phone, email: c.email },
        { name: b.canonical_name, website: b.website_domain, phone: b.main_phone },
      ),
    }));
    const corroborated = alternatives.filter(a => a.signals.length > 1);
    const supported = corroborated.length ? corroborated : alternatives.filter(a => a.signals.length > 0);
    const selected = supported.length === 1 ? supported[0] : null;
    const b = selected?.business;
    // Persist actual matching facts, not invented registry/provider evidence.
    // Phone numbers are hashed; no email local part is recorded in the evidence.
    const facts = b ? {
      rule: CORROBORATED_MATCH_RULE, contactId: Number(c.id), businessId: Number(b.id),
      contactName: identityName(c.company_name), businessName: identityName(b.canonical_name),
      contactDomain: identityDomain(c.website), businessDomain: identityDomain(b.website_domain),
      emailDomain: identityDomain(String(c.email ?? "").split("@")[1]),
      contactPhoneHash: identityPhone(c.phone) ? digest(identityPhone(c.phone)) : null,
      businessPhoneHash: identityPhone(b.main_phone) ? digest(identityPhone(b.main_phone)) : null,
      signals: selected!.signals,
    } : null;
    return {
      contactId: Number(c.id), businessId: b ? Number(b.id) : null,
      companyName: c.company_name, contactName: `${c.first_name} ${c.last_name}`.trim(),
      contactEmail: c.email, contactWebsite: c.website, contactPhone: c.phone,
      businessName: b?.canonical_name ?? null, businessWebsite: b?.website_domain ?? null,
      businessPhone: b?.main_phone ?? null,
      businessLocation: b ? [b.city, b.state].filter(Boolean).join(", ") : null,
      signals: selected?.signals ?? [],
      matchBasis: selected ? (selected.signals.length > 1 ? "corroborated" : "unique_company_name") : null,
      reasons: selected ? [] : [supported.length > 1 ? "multiple_corroborated_businesses"
        : alternatives.length ? "conflicting_company_identifiers" : "company_name_not_found"],
      eligible: Boolean(selected), snapshotHash: facts ? digest(facts) : null,
      sourceLinkId: null, sourceEntityId: null, facts,
    };
  });
  return { items, nextCursor: contacts.length > limit ? Number(page[page.length - 1].id) : null };
}

export async function previewCorroboratedContactBusinessLinks(input: { afterContactId: number; limit: number }) {
  const page = await matchingPage(db, input.afterContactId, Math.min(25, Math.max(1, input.limit)));
  return {
    rows: page.items.map(({ facts, ...item }) => item), nextCursor: page.nextCursor,
    schemaReady: true, writes: 0, paidProviderCalls: 0, rule: CORROBORATED_MATCH_RULE,
  };
}

export async function confirmCorroboratedContactBusinessLink(
  item: { contactId: number; businessId: number; snapshotHash: string }, reviewerId: string,
) {
  const decisionKey = `${CORROBORATED_MATCH_RULE}:${item.contactId}:${item.businessId}:${item.snapshotHash}`;
  const eventKey = `identity_match:${decisionKey}`;
  try {
    const reviewer = rows(await db.execute(sql`SELECT role FROM users WHERE id=${reviewerId}`))[0];
    if (reviewer?.role !== "admin") throw new Error("COMMERCIAL_LINK_REVIEWER_ROLE_INVALID");
    const replay = rows(await db.execute(sql`
      SELECT d.id,d.contact_id,d.business_id,d.reviewed_by,e.metadata
        FROM contact_business_link_decisions d
        JOIN contact_source_events e ON e.id=d.evidence_source_event_id
       WHERE d.decision_key=${decisionKey} AND d.superseded_at IS NULL
    `))[0];
    if (replay) {
      if (Number(replay.contact_id) !== item.contactId || Number(replay.business_id) !== item.businessId
          || replay.metadata?.factsHash !== item.snapshotHash) throw new Error("LINK_REPLAY_CONFLICT");
      return { ...item, status: "replayed", decisionId: replay.id };
    }
    const row = (await matchingPage(db, 0, 1, item.contactId)).items[0];
    if (!row?.eligible || row.businessId !== item.businessId || row.snapshotHash !== item.snapshotHash) {
      throw new Error("MATCH_CHANGED_REFRESH_PREVIEW");
    }
    // This is a software-produced observation of real CRM/business matching
    // facts. It does not claim a Sunbiz verification, provider call, or approval.
    // The authenticated admin's explicit confirmation is the separate decision.
    const metadata = {
      businessId: item.businessId, rule: CORROBORATED_MATCH_RULE,
      factsHash: item.snapshotHash, matchingFacts: row.facts,
      evidenceKind: row.matchBasis === "corroborated"
        ? "corroborated_crm_identity_match" : "unique_company_name_match_for_operator_confirmation",
    };
    await db.execute(sql`INSERT INTO contact_source_events
      (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
      VALUES (${item.contactId},${eventKey},'identity_matching',${CORROBORATED_MATCH_RULE},
        ${String(item.businessId)},'system','company-contact-matcher',${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT (contact_id,event_key) DO NOTHING`);
    const evidence = rows(await db.execute(sql`
      SELECT id,metadata FROM contact_source_events WHERE contact_id=${item.contactId} AND event_key=${eventKey}
    `))[0];
    if (!evidence || evidence.metadata?.businessId !== item.businessId
        || evidence.metadata?.factsHash !== item.snapshotHash) throw new Error("MATCH_EVIDENCE_CONFLICT");
    const decision = await decideContactBusinessLink({
      contactId: item.contactId, businessId: item.businessId, decision: "verified",
      decisionKey, reviewerId, evidenceSourceEventId: Number(evidence.id), expectedRevision: 0,
      authorityCheck: async tx => {
        const fresh = (await matchingPage(tx, 0, 1, item.contactId)).items[0];
        return Boolean(fresh?.eligible && fresh.businessId === item.businessId
          && fresh.snapshotHash === item.snapshotHash);
      },
    });
    return { ...item, status: "applied", decisionId: decision.id };
  } catch (error: any) {
    return { ...item, status: "rejected", code: String(error?.message ?? "LINK_FAILED").slice(0, 160) };
  }
}