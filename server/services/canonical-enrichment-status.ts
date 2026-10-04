import { pool, db } from "../db";
import { assertSystemLinkDatabaseGuard, assertSfpLinkDatabaseGuard, assertSfpPipelineDatabaseGuard } from "./commercial-link-authority";
import { assertSfpRecipientCapacityDatabaseGuard } from "./cro03/sfp-recipient-capacity";
import { effectiveBusinessVerticalStatusSql } from "@shared/effective-vertical";
import type { CanonicalEnrichmentStatus } from "@shared/canonical-enrichment-status";

/** Observational projection only. Counts are not enrollment, transport,
 * qualification or completion authority. Failed reads never become zeroes. */
export async function readCanonicalEnrichmentStatus(): Promise<CanonicalEnrichmentStatus> {
  const [contacts, businesses, preparations, imports, providers, nativeContracts] = await Promise.all([
    pool.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE email_status='valid')::int valid,
      count(*) FILTER (WHERE email_status IS NULL OR email_status IN ('active','unvalidated'))::int unvalidated,
      count(*) FILTER (WHERE do_not_contact OR do_not_auto_contact OR opted_out_email
        OR email_status IN ('bounced','invalid','opted_out','unsafe'))::int blocked
      FROM contacts WHERE record_class='production' AND archived_at IS NULL`),
    pool.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE vertical_status='mapped')::int mapped,
      count(*) FILTER (WHERE vertical_status='excluded')::int excluded,
      count(*) FILTER (WHERE vertical_status NOT IN ('mapped','excluded'))::int unresolved
      FROM (SELECT ${effectiveBusinessVerticalStatusSql("b")} vertical_status
        FROM businesses b WHERE b.record_class='canonical') current_businesses`),
    pool.query("SELECT state,count(*)::int n FROM sfp_campaign_staging_intents GROUP BY state"),
    pool.query("SELECT status AS state,count(*)::int n FROM import_executions GROUP BY status"),
    pool.query("SELECT state,count(*)::int n FROM provider_operations GROUP BY state"),
    Promise.all([
      assertSystemLinkDatabaseGuard(db), assertSfpLinkDatabaseGuard(db),
      assertSfpPipelineDatabaseGuard(db), assertSfpRecipientCapacityDatabaseGuard(db),
    ]).then(() => ({
      state: "verified" as const, reason: null,
    })).catch(error => ({
      state: "blocked" as const,
      reason: /DATABASE_GUARD_MISSING/.test(String(error?.message))
        ? String(error.message).slice(0, 250) : "Native contract verification unavailable",
    })),
  ]);
  const states = (result: { rows: any[] }) => ({
    total: result.rows.reduce((total, row) => total + Number(row.n), 0),
    byState: Object.fromEntries(result.rows.map(row => [String(row.state), Number(row.n)])),
  });
  return {
    observedAt: new Date().toISOString(), scope: "production_records_with_historical_work",
    contacts: contacts.rows[0], businesses: businesses.rows[0],
    preparations: states(preparations), imports: states(imports), providers: states(providers),
    nativeContracts,
    limitations: [
      "Contact, business, import, provider and preparation totals describe different populations.",
      "Valid email status alone does not establish current recipient eligibility or sending permission.",
      "Native contracts verify database safeguards, not deployed progression or full completion.",
      "Provider operation state and recorded usage do not prove vendor credits or invoices.",
      "Preparation, import and provider state totals include historical work; they are not a production-only cohort.",
    ],
  };
}