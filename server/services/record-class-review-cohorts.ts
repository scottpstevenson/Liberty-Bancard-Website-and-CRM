/**
 * Read-only review cohorts for record class and website provenance.
 *
 * This reads; it never repairs. Record class stays owned by the classification command authority, and nothing here
 * reclassifies, archives, deletes, re-enriches or contacts anyone. Each section is bounded (sample ids only, no
 * personal contact fields) and fails independently to an explicit unavailable state rather than a zero.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { syntheticQaIdentitySql } from "@shared/synthetic-qa-identity";
import { INDEPENDENT_OWNERSHIP_SOURCE_TYPES, sourceDomainSqlPatterns } from "@shared/source-domain-provenance";

export const REVIEW_COHORT_SAMPLE_LIMIT = 25;
const SECTION_TIMEOUT_MS = 8000;

type Section<T> = ({ available: true } & T) | { available: false; reason: string };

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

async function bounded<T>(work: (tx: any) => Promise<T>): Promise<Section<T extends object ? T : never>> {
  try {
    const value = await db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout='${SECTION_TIMEOUT_MS}ms'`));
      return work(tx);
    });
    return { available: true, ...(value as object) } as any;
  } catch (err: any) {
    const timedOut = String(err?.code ?? err?.cause?.code ?? "") === "57014";
    return { available: false, reason: timedOut ? "This read exceeded its time limit and was not completed." : "This read could not be completed." };
  }
}

/** SQL predicate for a lowercase host column: a directory, profile or government host (mirrors the shared TS rule). */
export function sourceDomainMatchSql(hostSql: string) {
  const { exact, like } = sourceDomainSqlPatterns();
  return sql`(${sql.raw(hostSql)} IN (${sql.join(exact.map(d => sql`${d}`), sql`,`)})
    OR ${sql.raw(hostSql)} LIKE ANY(ARRAY[${sql.join(like.map(p => sql`${p}`), sql`,`)}]::text[]))`;
}

export const independentOwnershipSourceTypesSql = () =>
  sql`ARRAY[${sql.join(INDEPENDENT_OWNERSHIP_SOURCE_TYPES.map(t => sql`${t}`), sql`,`)}]::text[]`;

export async function getRecordClassReviewCohorts() {
  const limit = REVIEW_COHORT_SAMPLE_LIMIT;
  const asOf = new Date().toISOString();

  const nonProductionRecords = await bounded(async tx => {
    const deals = rowsOf(await tx.execute(sql`SELECT COALESCE(record_class,'unknown') AS record_class, count(*)::int AS n
      FROM deals WHERE record_class IS DISTINCT FROM 'production' GROUP BY 1 ORDER BY 1`));
    const applications = rowsOf(await tx.execute(sql`SELECT COALESCE(c.record_class,'unlinked') AS record_class, count(*)::int AS n
      FROM merchant_applications a LEFT JOIN contacts c ON c.id=a.contact_id
      WHERE c.id IS NULL OR c.record_class IS DISTINCT FROM 'production' GROUP BY 1 ORDER BY 1`));
    const dealSample = rowsOf(await tx.execute(sql`SELECT id, record_class FROM deals
      WHERE record_class IS DISTINCT FROM 'production' ORDER BY id DESC LIMIT ${limit}`));
    const applicationSample = rowsOf(await tx.execute(sql`SELECT a.id, a.status, a.contact_id, c.record_class AS contact_record_class
      FROM merchant_applications a JOIN contacts c ON c.id=a.contact_id
      WHERE c.record_class IS DISTINCT FROM 'production' ORDER BY a.id DESC LIMIT ${limit}`));
    return {
      dealsByClass: deals.map(r => ({ recordClass: String(r.record_class), count: Number(r.n) })),
      applicationsByLinkedContactClass: applications.map(r => ({ recordClass: String(r.record_class), count: Number(r.n) })),
      dealSample: dealSample.map(r => ({ dealId: String(r.id), recordClass: r.record_class ?? null })),
      applicationSample: applicationSample.map(r => ({
        applicationId: String(r.id), status: r.status ?? null, contactId: Number(r.contact_id), contactRecordClass: r.contact_record_class ?? null,
      })),
    };
  });

  const legacyQaSignatureInProduction = await bounded(async tx => {
    const [count] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM contacts c
      WHERE c.record_class='production' AND ${sql.raw(syntheticQaIdentitySql("c"))}`));
    const [deals] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM deals d JOIN contacts c ON c.id=d.contact_id
      WHERE d.record_class='production' AND c.record_class='production' AND ${sql.raw(syntheticQaIdentitySql("c"))}`));
    const sample = rowsOf(await tx.execute(sql`SELECT c.id, c.created_at, c.archived_at FROM contacts c
      WHERE c.record_class='production' AND ${sql.raw(syntheticQaIdentitySql("c"))} ORDER BY c.id DESC LIMIT ${limit}`));
    return {
      contactCount: Number(count?.n ?? 0),
      dealsExcludedFromProductionReads: Number(deals?.n ?? 0),
      sample: sample.map(r => ({
        contactId: Number(r.id), createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, archived: r.archived_at != null,
      })),
    };
  });

  const directoryDomainBusinesses = await bounded(async tx => {
    const host = `regexp_replace(lower(b.website_domain),'^www\\.','')`;
    const match = sourceDomainMatchSql(host);
    const independent = independentOwnershipSourceTypesSql();
    const [count] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM businesses b
      WHERE b.record_class='canonical' AND b.website_domain IS NOT NULL AND ${match}
        AND NOT EXISTS (SELECT 1 FROM canonical_source_links s WHERE s.business_id=b.id AND s.source_type = ANY(${independent}))`));
    const sample = rowsOf(await tx.execute(sql`SELECT b.id, b.website_domain,
        (SELECT count(*)::int FROM canonical_source_links s WHERE s.business_id=b.id) AS source_link_count,
        COALESCE((SELECT array_agg(DISTINCT s.source_type) FROM canonical_source_links s WHERE s.business_id=b.id), ARRAY[]::text[]) AS source_types,
        (SELECT count(*)::int FROM contacts c WHERE c.business_id=b.id AND c.record_class='production') AS linked_contacts,
        (SELECT count(*)::int FROM contacts c WHERE c.business_id=b.id AND c.record_class='production' AND c.email_status='valid') AS contacts_with_valid_email
      FROM businesses b
      WHERE b.record_class='canonical' AND b.website_domain IS NOT NULL AND ${match}
        AND NOT EXISTS (SELECT 1 FROM canonical_source_links s WHERE s.business_id=b.id AND s.source_type = ANY(${independent}))
      ORDER BY b.id DESC LIMIT ${limit}`));
    return {
      businessCount: Number(count?.n ?? 0),
      sample: sample.map(r => ({
        businessId: Number(r.id), websiteDomain: String(r.website_domain), sourceLinkCount: Number(r.source_link_count),
        sourceTypes: (r.source_types ?? []) as string[], linkedProductionContacts: Number(r.linked_contacts),
        contactsWithValidEmail: Number(r.contacts_with_valid_email),
        matchBasis: "Website host is a directory, profile or government host with no registry or CRM organization link.",
      })),
    };
  });

  return {
    asOf,
    readOnly: true as const,
    sampleLimit: limit,
    note: "Nothing here changes a record. Corrections to record class go through the reviewed classification command; website-source holds release only when independent ownership evidence is recorded.",
    nonProductionRecords,
    legacyQaSignatureInProduction,
    directoryDomainBusinesses,
  };
}
